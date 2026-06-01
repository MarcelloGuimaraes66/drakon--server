// JobRuntime.cpp
#include "JobRuntime.h"
#include "JobPayloadParser.h"

#include "../core/AgentCore.h"      // adjust include paths to your tree
#include "../core/AnalysisRegionGeometry.h"
#include "../core/TemporalEngine.h"
#include "../core/VideoPolygonOverlayRenderer.h"
#include "../camera/CameraSession.h"
#include "../camera/PortalCounter.h"
#include "../comm/TelegramNotifier.h"
#include "../generated/Branding.h"
#include "../orchestrator/ConfigUtils.h"


#include <algorithm>
#include <stdexcept>

#include <fstream>
#include <cctype>
#include <cstdint>
#include <ctime>
#include <cstdio>
#include <sstream>
#include <iomanip>

#include <iterator>
#include <tuple>
#include <utility>
#include <chrono>
#include <thread>
#include <vector>
#include <unordered_set>
#include <unordered_map>
#include <string>
#include <system_error>
#include <queue>
#include <condition_variable>
#include <functional>

#include <filesystem>
#include <optional>
#include <cmath>

#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <opencv2/videoio.hpp>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include <windows.h>
#include <objbase.h>
#include <wincrypt.h>
#pragma comment(lib, "Crypt32.lib")
#endif


#include "../logging/Logging.h"

namespace fs = std::filesystem;

static int runProcessAndWaitWin_(const std::wstring& cmdLine);
static std::string getExecutableDir_();
static std::wstring utf8ToWide(const std::string& str);
static bool transcodeToWebMp4_(
    const fs::path& srcMp4Path,
    const fs::path& dstMp4Path,
    std::string* outErr);
static bool cropVideoClipByFrameWindowWithFfmpeg_(
    const fs::path& srcClipPath,
    const JobFrameWindowNorm& frameWindow,
    fs::path& outClipPath,
    std::string* outErr);
static bool cutMp4SegmentWithFfmpeg_(
    const fs::path& srcPath,
    const fs::path& dstPath,
    double offsetSeconds,
    double durationSeconds,
    std::string* outErr);
static bool parseCoverageTimePoint_(
    const std::string& rawIsoUtc,
    std::chrono::system_clock::time_point& out);
static std::string trimCopyRuntime_(std::string s);
static bool extractBoundaryFrameToMatFromMp4_(
    const fs::path& srcMp4Path,
    bool useLastMoment,
    cv::Mat& outFrame,
    std::string* outErr);

namespace {
    constexpr int kTimeoutDrainGraceSeconds_ = 60;
    constexpr int kTimeoutDrainIdleWaitSeconds_ = 2;
    constexpr int kNormalInferenceRequestTimeoutCapSeconds_ = 60;
    constexpr int kTimeoutDrainInferenceRequestTimeoutCapSeconds_ = 60;

    struct ClipBoundaryFrames_ {
        cv::Mat firstFrame;
        cv::Mat lastFrame;
    };

    static ErrorLogContext makeJobErrorContext_(
        const std::string& flow,
        const std::string& functionName,
        const std::string& operation,
        const json& context = json::object())
    {
        ErrorLogContext ctx;
        ctx.flow = flow;
        ctx.functionName = functionName;
        ctx.operation = operation;
        if (!context.is_null() && !context.empty()) {
            ctx.contextJson = context.dump();
        }
        return ctx;
    }

    static void logJobException_(
        const std::string& sourceId,
        const std::string& flow,
        const std::string& functionName,
        const std::string& operation,
        const json& context,
        const std::exception& ex)
    {
        Logger::instance().logException(
            sourceId,
            makeJobErrorContext_(flow, functionName, operation, context),
            ex
        );
    }

    static void logJobUnknownException_(
        const std::string& sourceId,
        const std::string& flow,
        const std::string& functionName,
        const std::string& operation,
        const json& context)
    {
        Logger::instance().logUnknownException(
            sourceId,
            makeJobErrorContext_(flow, functionName, operation, context)
        );
    }

    static std::string buildJobTemporalReportScopeKey_(
        int jobId,
        int stepId,
        int cameraId,
        int agentId,
        const std::string& jobRunId,
        const std::string& stepRunId,
        const std::string& agentRunId)
    {
        std::ostringstream oss;
        oss << "job=" << jobId
            << "|step=" << stepId
            << "|camera=" << cameraId
            << "|agent=" << agentId;
        if (!jobRunId.empty()) {
            oss << "|job_run_id=" << jobRunId;
        }
        if (!stepRunId.empty()) {
            oss << "|step_run_id=" << stepRunId;
        }
        if (!agentRunId.empty()) {
            oss << "|agent_run_id=" << agentRunId;
        }
        return oss.str();
    }

    struct JobTokenUsageTask {
        AgentCore* owner = nullptr;
        int jobId = -1;
        int stepId = -1;
        int cameraId = -1;
        int promptTokens = 0;
        int outputTokens = 0;
        int totalTokens = 0;
        std::string inferenceModel;
        std::string agentKey;
    };

    std::queue<JobTokenUsageTask> g_jobTokenUsageQueue;
    std::mutex g_jobTokenUsageMutex;
    std::condition_variable g_jobTokenUsageCv;
    std::atomic<bool> g_jobTokenUsageWorkerRunning{ false };
    std::thread g_jobTokenUsageWorkerThread;

    void jobTokenUsageWorkerLoop() {
        for (;;) {
            JobTokenUsageTask task;
            {
                std::unique_lock<std::mutex> lk(g_jobTokenUsageMutex);
                g_jobTokenUsageCv.wait_for(
                    lk,
                    std::chrono::seconds(1),
                    [] {
                        return !g_jobTokenUsageWorkerRunning.load() ||
                               !g_jobTokenUsageQueue.empty();
                    }
                );

                if (!g_jobTokenUsageWorkerRunning.load() && g_jobTokenUsageQueue.empty()) {
                    break;
                }

                if (g_jobTokenUsageQueue.empty()) {
                    continue;
                }

                task = std::move(g_jobTokenUsageQueue.front());
                g_jobTokenUsageQueue.pop();
            }

            if (!task.owner) {
                continue;
            }

            try {
                nlohmann::json details;
                details["job_id"] = task.jobId;
                details["step_id"] = task.stepId;
                details["camera_id"] = task.cameraId;
                details["prompt_tokens"] = task.promptTokens;
                details["output_tokens"] = task.outputTokens;
                details["total_tokens"] = task.totalTokens;
                details["source"] = "job";
                details["algo_type"] = "job_step_inference";
                if (!task.inferenceModel.empty()) {
                    details["inference_model"] = task.inferenceModel;
                }
                if (!task.agentKey.empty()) {
                    details["agent_key"] = task.agentKey;
                }

                task.owner->postAgentEvent(
                    "job_token_usage",
                    task.cameraId > 0 ? std::optional<int>(task.cameraId) : std::nullopt,
                    /*userId*/ "",
                    /*message*/ "",
                    details
                );
            }
            catch (const std::exception& ex) {
                logJobException_(
                    "job",
                    "jobs",
                    "jobTokenUsageWorkerLoop",
                    "post_agent_event",
                    {
                        { "job_id", task.jobId },
                        { "step_id", task.stepId },
                        { "camera_id", task.cameraId },
                        { "agent_key", task.agentKey },
                        { "inference_model", task.inferenceModel }
                    },
                    ex
                );
            }
            catch (...) {
                logJobUnknownException_(
                    "job",
                    "jobs",
                    "jobTokenUsageWorkerLoop",
                    "post_agent_event",
                    {
                        { "job_id", task.jobId },
                        { "step_id", task.stepId },
                        { "camera_id", task.cameraId },
                        { "agent_key", task.agentKey },
                        { "inference_model", task.inferenceModel }
                    }
                );
            }
        }

        Logger::instance().logDebug("job", "jobTokenUsageWorkerLoop: worker exiting");
    }

    void ensureJobTokenUsageWorkerStarted() {
        bool expected = false;
        if (!g_jobTokenUsageWorkerRunning.compare_exchange_strong(expected, true)) {
            return;
        }

        g_jobTokenUsageWorkerThread = std::thread(jobTokenUsageWorkerLoop);
        Logger::instance().logDebug("job", "jobTokenUsageWorkerLoop: worker started");
    }

    void stopJobTokenUsageWorker() {
        if (!g_jobTokenUsageWorkerRunning.load()) {
            return;
        }

        g_jobTokenUsageWorkerRunning.store(false);
        g_jobTokenUsageCv.notify_all();

        if (g_jobTokenUsageWorkerThread.joinable()) {
            g_jobTokenUsageWorkerThread.join();
        }
    }

    void enqueueJobTokenUsageAsync(
        AgentCore* owner,
        int jobId,
        int stepId,
        int cameraId,
        int promptTokens,
        int outputTokens,
        int totalTokens,
        const std::string& inferenceModel,
        const std::string& agentKey)
    {
        if (!owner) {
            return;
        }

        const int safePrompt = std::max(0, promptTokens);
        const int safeOutput = std::max(0, outputTokens);
        const int safeTotal = totalTokens > 0 ? totalTokens : (safePrompt + safeOutput);

        if (safePrompt <= 0 && safeOutput <= 0 && safeTotal <= 0) {
            return;
        }

        ensureJobTokenUsageWorkerStarted();

        JobTokenUsageTask task;
        task.owner = owner;
        task.jobId = jobId;
        task.stepId = stepId;
        task.cameraId = cameraId;
        task.promptTokens = safePrompt;
        task.outputTokens = safeOutput;
        task.totalTokens = safeTotal;
        task.inferenceModel = inferenceModel;
        task.agentKey = agentKey;

        {
            std::lock_guard<std::mutex> lk(g_jobTokenUsageMutex);
            if (g_jobTokenUsageQueue.size() >= 1000) {
                Logger::instance().logDebug(
                    "job",
                    "enqueueJobTokenUsageAsync: queue full, dropping token usage report"
                );
                return;
            }
            g_jobTokenUsageQueue.push(std::move(task));
        }

        g_jobTokenUsageCv.notify_one();
    }
}
static std::string sanitizeBase64_(std::string b64)
{
    // 1) remove prefixo data URL se tiver
    const auto pos = b64.find("base64,");
    if (pos != std::string::npos) b64 = b64.substr(pos + 7);

    // 2) remove whitespace
    b64.erase(std::remove_if(b64.begin(), b64.end(), [](unsigned char c) {
        return c == '\r' || c == '\n' || c == '\t' || c == ' ';
        }), b64.end());

    // 3) url-safe -> standard
    for (char& c : b64) {
        if (c == '-') c = '+';
        else if (c == '_') c = '/';
    }

    // 4) padding
    const size_t mod = b64.size() % 4;
    if (mod != 0) b64.append(4 - mod, '=');

    return b64;
}

static bool writeJpegBase64ToFile_(const std::string& jpegB64, const fs::path& dst)
{
#ifdef _WIN32
    if (jpegB64.empty()) {
        Logger::instance().logDebug("job", "writeJpegBase64ToFile_: jpegB64 is empty");
        return false;
    }

    const bool hadPrefix = (jpegB64.find("base64,") != std::string::npos);
    std::string b64 = sanitizeBase64_(jpegB64);

    if (b64.empty()) {
        Logger::instance().logDebug("job", "writeJpegBase64ToFile_: sanitized base64 empty (hadPrefix=" + std::string(hadPrefix ? "true" : "false") + ")");
        return false;
    }

    // Base64 decode (Windows native)
    DWORD needed = 0;
    const DWORD flags = CRYPT_STRING_BASE64 | CRYPT_STRING_BASE64_ANY;

    if (!CryptStringToBinaryA(b64.c_str(), (DWORD)b64.size(), flags,
        nullptr, &needed, nullptr, nullptr))
    {
        const DWORD err = GetLastError();
        Logger::instance().logDebug("job",
            "writeJpegBase64ToFile_: CryptStringToBinaryA(sizeOnly) failed err=" + std::to_string(err) +
            " b64_len=" + std::to_string(b64.size()) +
            " hadPrefix=" + std::string(hadPrefix ? "true" : "false"));
        return false;
    }

    if (needed == 0) {
        Logger::instance().logDebug("job",
            "writeJpegBase64ToFile_: decoded size needed==0 b64_len=" + std::to_string(b64.size()));
        return false;
    }

    std::vector<unsigned char> bytes(needed);
    DWORD written = needed;

    if (!CryptStringToBinaryA(b64.c_str(), (DWORD)b64.size(), flags,
        bytes.data(), &written, nullptr, nullptr))
    {
        const DWORD err = GetLastError();
        Logger::instance().logDebug("job",
            "writeJpegBase64ToFile_: CryptStringToBinaryA(decode) failed err=" + std::to_string(err) +
            " b64_len=" + std::to_string(b64.size()) +
            " needed=" + std::to_string(needed) +
            " hadPrefix=" + std::string(hadPrefix ? "true" : "false"));
        return false;
    }

    bytes.resize(written);
    if (bytes.empty()) {
        Logger::instance().logDebug("job",
            "writeJpegBase64ToFile_: decoded bytes empty written=" + std::to_string(written));
        return false;
    }

    // Ensure folder exists
    std::error_code ec;
    fs::create_directories(dst.parent_path(), ec);
    if (ec) {
        Logger::instance().logDebug("job",
            "writeJpegBase64ToFile_: create_directories failed: " + ec.message() +
            " dir=" + dst.parent_path().string());
    }

    // Write file
    FILE* f = nullptr;
    _wfopen_s(&f, dst.wstring().c_str(), L"wb");
    if (!f) {
        const DWORD err = GetLastError();
        Logger::instance().logDebug("job",
            "writeJpegBase64ToFile_: fopen failed err=" + std::to_string(err) +
            " dst=" + dst.string());
        return false;
    }

    const size_t w = fwrite(bytes.data(), 1, bytes.size(), f);
    fclose(f);

    if (w != bytes.size()) {
        Logger::instance().logDebug("job",
            "writeJpegBase64ToFile_: fwrite incomplete wrote=" + std::to_string((uint64_t)w) +
            " expected=" + std::to_string((uint64_t)bytes.size()) +
            " dst=" + dst.string());
        return false;
    }

    Logger::instance().logDebug("job",
        "writeJpegBase64ToFile_: OK bytes=" + std::to_string((uint64_t)bytes.size()) +
        " dst=" + dst.string());

    return true;
#else
    (void)jpegB64; (void)dst;
    return false;
#endif
}

static bool decodeBase64ToBytes_(
    const std::string& rawBase64OrDataUrl,
    std::vector<unsigned char>& outBytes,
    std::string* outErr = nullptr)
{
    outBytes.clear();
#ifdef _WIN32
    const std::string b64 = sanitizeBase64_(rawBase64OrDataUrl);
    if (b64.empty()) {
        if (outErr) *outErr = "base64 empty after sanitize";
        return false;
    }

    DWORD needed = 0;
    const DWORD flags = CRYPT_STRING_BASE64 | CRYPT_STRING_BASE64_ANY;
    if (!CryptStringToBinaryA(
            b64.c_str(),
            (DWORD)b64.size(),
            flags,
            nullptr,
            &needed,
            nullptr,
            nullptr)) {
        if (outErr) *outErr = "CryptStringToBinaryA(sizeOnly) failed err=" + std::to_string(GetLastError());
        return false;
    }

    if (needed == 0) {
        if (outErr) *outErr = "decoded size is zero";
        return false;
    }

    outBytes.resize(needed);
    DWORD written = needed;
    if (!CryptStringToBinaryA(
            b64.c_str(),
            (DWORD)b64.size(),
            flags,
            outBytes.data(),
            &written,
            nullptr,
            nullptr)) {
        if (outErr) *outErr = "CryptStringToBinaryA(decode) failed err=" + std::to_string(GetLastError());
        outBytes.clear();
        return false;
    }

    outBytes.resize((size_t)written);
    if (outBytes.empty()) {
        if (outErr) *outErr = "decoded bytes empty";
        return false;
    }
    return true;
#else
    (void)rawBase64OrDataUrl;
    if (outErr) *outErr = "base64 decode unsupported on this platform";
    return false;
#endif
}

static bool isHealthyStillJpegBase64_(
    const std::string& rawBase64OrDataUrl,
    std::string* outErr = nullptr)
{
    std::vector<unsigned char> bytes;
    if (!decodeBase64ToBytes_(rawBase64OrDataUrl, bytes, outErr)) {
        return false;
    }

    // Basic JPEG sanity. This does not validate visual quality, only payload integrity.
    if (bytes.size() < 512) {
        if (outErr) *outErr = "jpeg payload too small";
        return false;
    }

    if (bytes[0] != 0xFF || bytes[1] != 0xD8) {
        if (outErr) *outErr = "jpeg SOI marker missing";
        return false;
    }

    const size_t n = bytes.size();
    if (bytes[n - 2] != 0xFF || bytes[n - 1] != 0xD9) {
        if (outErr) *outErr = "jpeg EOI marker missing";
        return false;
    }

    return true;
}

static bool readBinaryFile_(const fs::path& filePath, std::vector<unsigned char>& outBytes)
{
    outBytes.clear();
    std::ifstream in(filePath, std::ios::binary);
    if (!in) return false;

    in.seekg(0, std::ios::end);
    const std::streamoff size = in.tellg();
    if (size <= 0) return false;
    in.seekg(0, std::ios::beg);

    outBytes.resize(static_cast<size_t>(size));
    in.read(reinterpret_cast<char*>(outBytes.data()), size);
    return in.good();
}

#ifdef _WIN32
static std::string base64EncodeBytes_(const unsigned char* data, size_t len)
{
    if (!data || len == 0) return "";

    DWORD needed = 0;
    const DWORD flags = CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF;
    if (!CryptBinaryToStringA(data, static_cast<DWORD>(len), flags, nullptr, &needed) || needed == 0) {
        return "";
    }

    std::string out;
    out.resize(needed);
    if (!CryptBinaryToStringA(data, static_cast<DWORD>(len), flags, &out[0], &needed)) {
        return "";
    }

    while (!out.empty() && (out.back() == '\0' || out.back() == '\r' || out.back() == '\n')) {
        out.pop_back();
    }
    return out;
}
#endif

static std::string ensureDataUrlBase64_(const std::string& rawBase64OrDataUrl, const std::string& mimeType)
{
    if (rawBase64OrDataUrl.empty()) return "";
    if (rawBase64OrDataUrl.find("base64,") != std::string::npos) return rawBase64OrDataUrl;
    return "data:" + mimeType + ";base64," + sanitizeBase64_(rawBase64OrDataUrl);
}

struct DailyReportDatePartsJob_ {
    std::string compactToken;
    std::string dashedToken;
    std::string year;
    std::string month;
    std::string day;
    std::string localTimestampToken;
    std::string localSampleLineTimestamp;
    std::string sampleBucketToken;
};

static DailyReportDatePartsJob_ localDatePartsForJobDailyReport_()
{
    SYSTEMTIME st{};
    GetLocalTime(&st);

    const unsigned sampleBucketMinute = static_cast<unsigned>((st.wMinute / 10) * 10);

    char compact[16];
    char dashed[16];
    char year[8];
    char month[4];
    char day[4];
    char localTs[32];
    char lineTs[32];
    char bucketTs[24];

    std::snprintf(
        compact,
        sizeof(compact),
        "%04u%02u%02u",
        static_cast<unsigned>(st.wYear),
        static_cast<unsigned>(st.wMonth),
        static_cast<unsigned>(st.wDay)
    );
    std::snprintf(
        dashed,
        sizeof(dashed),
        "%04u-%02u-%02u",
        static_cast<unsigned>(st.wYear),
        static_cast<unsigned>(st.wMonth),
        static_cast<unsigned>(st.wDay)
    );
    std::snprintf(year, sizeof(year), "%04u", static_cast<unsigned>(st.wYear));
    std::snprintf(month, sizeof(month), "%02u", static_cast<unsigned>(st.wMonth));
    std::snprintf(day, sizeof(day), "%02u", static_cast<unsigned>(st.wDay));
    std::snprintf(
        localTs,
        sizeof(localTs),
        "%04u%02u%02u_%02u%02u%02u_%03u",
        static_cast<unsigned>(st.wYear),
        static_cast<unsigned>(st.wMonth),
        static_cast<unsigned>(st.wDay),
        static_cast<unsigned>(st.wHour),
        static_cast<unsigned>(st.wMinute),
        static_cast<unsigned>(st.wSecond),
        static_cast<unsigned>(st.wMilliseconds)
    );
    std::snprintf(
        lineTs,
        sizeof(lineTs),
        "%04u-%02u-%02u %02u:%02u:%02u.%03u",
        static_cast<unsigned>(st.wYear),
        static_cast<unsigned>(st.wMonth),
        static_cast<unsigned>(st.wDay),
        static_cast<unsigned>(st.wHour),
        static_cast<unsigned>(st.wMinute),
        static_cast<unsigned>(st.wSecond),
        static_cast<unsigned>(st.wMilliseconds)
    );
    std::snprintf(
        bucketTs,
        sizeof(bucketTs),
        "%04u-%02u-%02u %02u:%02u",
        static_cast<unsigned>(st.wYear),
        static_cast<unsigned>(st.wMonth),
        static_cast<unsigned>(st.wDay),
        static_cast<unsigned>(st.wHour),
        sampleBucketMinute
    );

    return DailyReportDatePartsJob_{
        std::string(compact),
        std::string(dashed),
        std::string(year),
        std::string(month),
        std::string(day),
        std::string(localTs),
        std::string(lineTs),
        std::string(bucketTs)
    };
}

static bool dailyReportJobsEnabled_()
{
    static const bool enabled = [] {
        return chatv2::parseBoolValue(
            chatv2::loadConfigValue("DAILY_REPORTS", { "daily_reports_enabled.txt" }),
            false
        );
    }();
    return enabled;
}

static std::string sanitizeDailyReportToken_(
    const std::string& rawValue,
    const std::string& fallback)
{
    const std::string trimmed = trimCopyRuntime_(rawValue);
    const std::string source = trimmed.empty() ? fallback : trimmed;
    const std::string safeFallback = fallback.empty() ? std::string("item") : fallback;

    std::string out;
    out.reserve(source.size());

    bool prevSeparator = false;
    for (unsigned char ch : source) {
        const bool allowed =
            std::isalnum(ch) ||
            ch == '-' ||
            ch == '_';

        if (allowed) {
            out.push_back(static_cast<char>(ch));
            prevSeparator = false;
            continue;
        }

        if (std::isspace(ch) || ch == '.' || ch == '/' || ch == '\\' || ch == ':') {
            if (!prevSeparator && !out.empty()) {
                out.push_back('_');
                prevSeparator = true;
            }
        }
    }

    while (!out.empty() && (out.front() == '_' || out.front() == '-')) out.erase(out.begin());
    while (!out.empty() && (out.back() == '_' || out.back() == '-')) out.pop_back();

    if (!out.empty()) {
        return out;
    }

    if (source != safeFallback) {
        return sanitizeDailyReportToken_(safeFallback, "item");
    }

    return "item";
}

static std::string resolveDailyReportCameraName_(
    const JobStartPayload& payload,
    const JobStepDef& step,
    int cameraId)
{
    std::string cameraName;

    auto it = payload.camera_start_payload_by_id.find(cameraId);
    if (it != payload.camera_start_payload_by_id.end()) {
        try {
            cameraName = trimCopyRuntime_(it->second.value("name", std::string()));
        }
        catch (...) {
            cameraName.clear();
        }
    }

    if (cameraName.empty()) {
        for (const auto& target : step.targets) {
            if (target.camera_id != cameraId) continue;
            cameraName = trimCopyRuntime_(target.camera_name);
            if (!cameraName.empty()) break;
        }
    }

    if (!cameraName.empty()) {
        return cameraName;
    }

    return "camera_" + std::to_string(cameraId > 0 ? cameraId : 0);
}

static std::string dailyReportAgentToken_(const JobAgentDef& agent)
{
    if (!trimCopyRuntime_(agent.agent_key).empty()) {
        return sanitizeDailyReportToken_(agent.agent_key, "agent");
    }
    if (agent.id > 0) {
        return "agent_" + std::to_string(agent.id);
    }
    return "agent";
}

static fs::path buildDailyReportCameraDirJob_(
    int cameraId,
    const DailyReportDatePartsJob_& dateParts)
{
    fs::path dir("C:\\daily_reports");
    dir /= dateParts.year;
    dir /= dateParts.month;
    dir /= dateParts.day;
    dir /= "camera_" + std::to_string(cameraId > 0 ? cameraId : 0);
    return dir;
}

static fs::path buildDailyReportStepDirJob_(
    const JobStartPayload& payload,
    const JobStepDef& step,
    int cameraId,
    const DailyReportDatePartsJob_& dateParts)
{
    fs::path dir = buildDailyReportCameraDirJob_(cameraId, dateParts);
    dir /=
        "job_" + std::to_string(payload.job.id > 0 ? payload.job.id : 0) +
        "__" + sanitizeDailyReportToken_(payload.job.name, "job");
    dir /=
        "step_" + std::to_string(step.id > 0 ? step.id : 0) +
        "__" + sanitizeDailyReportToken_(step.name, "step");
    return dir;
}

static bool writeDailyReportBytesAtomic_(
    const std::string& logKey,
    const fs::path& finalPath,
    const std::vector<unsigned char>& bytes,
    const std::string& context)
{
    try {
        if (bytes.empty()) return false;

        std::error_code ec;
        fs::create_directories(finalPath.parent_path(), ec);
        if (ec) {
            Logger::instance().logDebug(
                logKey,
                context + ": create_directories failed: " + ec.message() +
                " dir=" + finalPath.parent_path().string()
            );
            return false;
        }

        fs::path tmpPath = finalPath;
        tmpPath += ".tmp";

        {
            std::ofstream ofs(tmpPath, std::ios::binary | std::ios::trunc);
            if (!ofs) {
                Logger::instance().logDebug(
                    logKey,
                    context + ": failed opening temp path: " + tmpPath.string()
                );
                return false;
            }
            ofs.write(
                reinterpret_cast<const char*>(bytes.data()),
                static_cast<std::streamsize>(bytes.size())
            );
            if (!ofs) {
                Logger::instance().logDebug(
                    logKey,
                    context + ": failed writing temp path: " + tmpPath.string()
                );
                ofs.close();
                fs::remove(tmpPath, ec);
                return false;
            }
        }

        bool moved = false;
#ifdef _WIN32
        const std::wstring tmpWide = utf8ToWide(tmpPath.string());
        const std::wstring finalWide = utf8ToWide(finalPath.string());
        if (MoveFileExW(
                tmpWide.c_str(),
                finalWide.c_str(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_COPY_ALLOWED))
        {
            moved = true;
        }
        else {
            const DWORD moveErr = GetLastError();
            Logger::instance().logDebug(
                logKey,
                context + ": MoveFileExW failed: " + std::to_string(static_cast<unsigned long>(moveErr)) +
                " tmp=" + tmpPath.string() + " final=" + finalPath.string()
            );
        }
#else
        fs::rename(tmpPath, finalPath, ec);
        moved = !ec;
#endif
        if (!moved) {
            fs::remove(tmpPath, ec);
            return false;
        }

        return true;
    }
    catch (const std::exception& ex) {
        Logger::instance().logDebug(
            logKey,
            context + ": exception writing file: " + ex.what()
        );
    }
    catch (...) {
        Logger::instance().logDebug(
            logKey,
            context + ": unknown exception writing file"
        );
    }

    return false;
}

static bool writeDailyReportTextAtomic_(
    const std::string& logKey,
    const fs::path& finalPath,
    const std::string& text,
    const std::string& context)
{
    const std::vector<unsigned char> bytes(text.begin(), text.end());
    return writeDailyReportBytesAtomic_(logKey, finalPath, bytes, context);
}

static bool appendDailyReportSampleLineIfMissingBucket_(
    const std::string& logKey,
    const fs::path& filePath,
    const std::string& bucketToken,
    const std::string& line)
{
    static std::mutex appendMu;
    const std::string marker = "[bucket=" + bucketToken + "]";

    try {
        std::lock_guard<std::mutex> lock(appendMu);

        std::error_code ec;
        fs::create_directories(filePath.parent_path(), ec);
        if (ec) {
            Logger::instance().logDebug(
                logKey,
                "daily_reports: failed to create sample directory: " + ec.message() +
                " dir=" + filePath.parent_path().string()
            );
            return false;
        }

        {
            std::ifstream existing(filePath, std::ios::binary);
            if (existing) {
                std::string contents(
                    (std::istreambuf_iterator<char>(existing)),
                    std::istreambuf_iterator<char>()
                );
                if (contents.find(marker) != std::string::npos) {
                    return true;
                }
            }
        }

        std::ofstream ofs(filePath, std::ios::app | std::ios::binary);
        if (!ofs) {
            Logger::instance().logDebug(
                logKey,
                "daily_reports: failed opening sample file: " + filePath.string()
            );
            return false;
        }

        ofs << line;
        if (line.empty() || line.back() != '\n') {
            ofs << '\n';
        }

        if (!ofs) {
            Logger::instance().logDebug(
                logKey,
                "daily_reports: failed appending sample file: " + filePath.string()
            );
            return false;
        }

        return true;
    }
    catch (const std::exception& ex) {
        Logger::instance().logDebug(
            logKey,
            std::string("daily_reports: exception appending sample file: ") + ex.what()
        );
    }
    catch (...) {
        Logger::instance().logDebug(
            logKey,
            "daily_reports: unknown exception appending sample file"
        );
    }

    return false;
}

static void stripInlineMediaForDailyReportJson_(json& node)
{
    if (node.is_object()) {
        node.erase("image_jpeg_b64");
        node.erase("frame_jpeg_base64");
        node.erase("temp_clip_cleanup_paths");
        for (auto it = node.begin(); it != node.end(); ++it) {
            stripInlineMediaForDailyReportJson_(it.value());
        }
        return;
    }

    if (node.is_array()) {
        for (auto& item : node) {
            stripInlineMediaForDailyReportJson_(item);
        }
    }
}

static std::string bestDailyReportImageDataUrlFromJson_(const json& node)
{
    if (!node.is_object()) return "";

    if (node.contains("image_jpeg_b64") && node["image_jpeg_b64"].is_string()) {
        const std::string value = ensureDataUrlBase64_(node["image_jpeg_b64"].get<std::string>(), "image/jpeg");
        if (!value.empty()) return value;
    }

    if (node.contains("frame_jpeg_base64") && node["frame_jpeg_base64"].is_string()) {
        const std::string value = ensureDataUrlBase64_(node["frame_jpeg_base64"].get<std::string>(), "image/jpeg");
        if (!value.empty()) return value;
    }

    if (node.contains("group_images") && node["group_images"].is_array()) {
        for (const auto& item : node["group_images"]) {
            if (!item.is_object()) continue;
            if (item.contains("is_offline_placeholder") &&
                item["is_offline_placeholder"].is_boolean() &&
                item["is_offline_placeholder"].get<bool>())
            {
                continue;
            }

            if (item.contains("image_jpeg_b64") && item["image_jpeg_b64"].is_string()) {
                const std::string value = ensureDataUrlBase64_(item["image_jpeg_b64"].get<std::string>(), "image/jpeg");
                if (!value.empty()) return value;
            }
            if (item.contains("frame_jpeg_base64") && item["frame_jpeg_base64"].is_string()) {
                const std::string value = ensureDataUrlBase64_(item["frame_jpeg_base64"].get<std::string>(), "image/jpeg");
                if (!value.empty()) return value;
            }
        }
    }

    return "";
}

static bool writeDailyReportImageFromDataUrl_(
    const std::string& logKey,
    const fs::path& finalPath,
    const std::string& rawBase64OrDataUrl,
    const std::string& context)
{
    if (rawBase64OrDataUrl.empty()) return false;

    std::vector<unsigned char> bytes;
    std::string err;
    if (!decodeBase64ToBytes_(rawBase64OrDataUrl, bytes, &err) || bytes.empty()) {
        Logger::instance().logDebug(
            logKey,
            context + ": failed decoding image data for daily report: " + err
        );
        return false;
    }

    return writeDailyReportBytesAtomic_(logKey, finalPath, bytes, context);
}

static std::string singleLineDailyReportText_(const std::string& rawValue)
{
    std::string out;
    out.reserve(rawValue.size());

    bool prevSpace = false;
    for (unsigned char ch : rawValue) {
        if (ch == '\r' || ch == '\n' || ch == '\t') {
            if (!prevSpace && !out.empty()) {
                out.push_back(' ');
                prevSpace = true;
            }
            continue;
        }

        if (std::isspace(ch)) {
            if (!prevSpace && !out.empty()) {
                out.push_back(' ');
                prevSpace = true;
            }
            continue;
        }

        out.push_back(static_cast<char>(ch));
        prevSpace = false;
    }

    return trimCopyRuntime_(out);
}

static void persistDailyReportExecutionArtifacts_(
    AgentCore* owner,
    const JobStartPayload& payload,
    const JobStepDef& step,
    int cameraId,
    const JobAgentDef& agent,
    const std::string& inferenceOutput,
    const std::string& fallbackImageDataUrl,
    bool allowSampleAppend)
{
    if (!dailyReportJobsEnabled_() || inferenceOutput.empty()) {
        return;
    }

    json parsed;
    try {
        parsed = json::parse(inferenceOutput);
    }
    catch (...) {
        return;
    }

    if (!parsed.is_object()) {
        return;
    }

    const DailyReportDatePartsJob_ dateParts = localDatePartsForJobDailyReport_();
    const std::string logKey = cameraId > 0 ? std::to_string(cameraId) : std::string("job");
    const std::string cameraName = resolveDailyReportCameraName_(payload, step, cameraId);
    const std::string agentToken = dailyReportAgentToken_(agent);
    const fs::path stepDir = buildDailyReportStepDirJob_(payload, step, cameraId, dateParts);

    std::string executionImageDataUrl = bestDailyReportImageDataUrlFromJson_(parsed);
    if (executionImageDataUrl.empty() && !fallbackImageDataUrl.empty()) {
        executionImageDataUrl = ensureDataUrlBase64_(fallbackImageDataUrl, "image/jpeg");
    }
    if (executionImageDataUrl.empty() && owner) {
        if (CameraSession* session = owner->getCameraSession(cameraId)) {
            executionImageDataUrl = ensureDataUrlBase64_(session->getLastJobStillJpegBase64(), "image/jpeg");
        }
    }

    const fs::path imagePath = stepDir / ("execution_latest__agent_" + agentToken + ".jpg");
    if (!executionImageDataUrl.empty()) {
        (void)writeDailyReportImageFromDataUrl_(
            logKey,
            imagePath,
            executionImageDataUrl,
            "daily_reports: write execution image"
        );
    }

    json metadata = parsed;
    stripInlineMediaForDailyReportJson_(metadata);
    metadata["daily_report_type"] = "job_execution";
    metadata["camera_id"] = cameraId;
    metadata["camera_name"] = cameraName;
    metadata["job_id"] = payload.job.id;
    metadata["job_name"] = payload.job.name;
    if (!payload.job_run_id.empty()) {
        metadata["job_run_id"] = payload.job_run_id;
    }
    metadata["step_id"] = step.id;
    metadata["step_name"] = step.name;
    metadata["step_order"] = step.step_order;
    if (!step.step_run_id.empty()) {
        metadata["step_run_id"] = step.step_run_id;
    }
    metadata["agent_id"] = agent.id;
    metadata["agent_key"] = agent.agent_key;
    if (!agent.agent_run_id.empty()) {
        metadata["agent_run_id"] = agent.agent_run_id;
    }
    metadata["daily_report_generated_local"] = dateParts.localSampleLineTimestamp;
    if (!executionImageDataUrl.empty()) {
        metadata["execution_image_file"] = imagePath.filename().string();
    }

    const fs::path metadataPath = stepDir / ("execution_latest__agent_" + agentToken + ".json");
    (void)writeDailyReportTextAtomic_(
        logKey,
        metadataPath,
        metadata.dump(2),
        "daily_reports: write execution metadata"
    );

    const std::string provider = trimCopyRuntime_(parsed.value("provider", std::string()));
    const std::string executionBackend = trimCopyRuntime_(parsed.value("execution_backend", std::string()));
    const std::string decisionSource = trimCopyRuntime_(parsed.value("decision_source", std::string()));
    const std::string answer = trimCopyRuntime_(parsed.value("answer", std::string()));

    if (!allowSampleAppend ||
        answer.empty() ||
        provider == "native" ||
        executionBackend == "opencv_portal_counter" ||
        decisionSource == "temporal_engine")
    {
        return;
    }

    const fs::path samplePath = stepDir / ("llm_samples__agent_" + agentToken + ".txt");
    std::ostringstream line;
    line
        << "[bucket=" << dateParts.sampleBucketToken << "] "
        << "ts_local=" << dateParts.localSampleLineTimestamp
        << " camera_id=" << cameraId
        << " camera_name=\"" << singleLineDailyReportText_(cameraName) << "\""
        << " job_id=" << payload.job.id
        << " step_id=" << step.id
        << " agent_key=\"" << singleLineDailyReportText_(agent.agent_key) << "\"";

    if (!provider.empty()) {
        line << " provider=" << provider;
    }
    if (parsed.contains("model") && parsed["model"].is_string()) {
        line << " model=\"" << singleLineDailyReportText_(parsed["model"].get<std::string>()) << "\"";
    }
    line << " answer=\"" << singleLineDailyReportText_(answer) << "\"";

    (void)appendDailyReportSampleLineIfMissingBucket_(
        logKey,
        samplePath,
        dateParts.sampleBucketToken,
        line.str()
    );
}

static std::vector<FaceReferenceImage> resolveFaceReferenceImagesForJob_(
    AgentCore* owner,
    const std::vector<JobFaceTarget>& faceTargets)
{
    std::vector<FaceReferenceImage> out;
    if (!owner) return out;

    static std::mutex cacheMu;
    static std::unordered_map<std::string, std::string> dataUrlByImageUrl;

    constexpr size_t kMaxReferenceImages = 12;
    out.reserve((std::min)(kMaxReferenceImages, faceTargets.size() * (size_t)2));

    std::vector<JobFaceTarget> orderedTargets = faceTargets;
    std::stable_sort(
        orderedTargets.begin(),
        orderedTargets.end(),
        [](const JobFaceTarget& lhs, const JobFaceTarget& rhs) {
            if (lhs.id != rhs.id) return lhs.id < rhs.id;
            if (lhs.name != rhs.name) return lhs.name < rhs.name;
            return lhs.description < rhs.description;
        });

    for (const auto& target : orderedTargets) {
        std::vector<JobFaceTargetImage> orderedImages = target.images;
        std::stable_sort(
            orderedImages.begin(),
            orderedImages.end(),
            [](const JobFaceTargetImage& lhs, const JobFaceTargetImage& rhs) {
                return lhs.image_url < rhs.image_url;
            });

        for (const auto& image : orderedImages) {
            if (out.size() >= kMaxReferenceImages) break;
            std::string imageUrl = image.image_url;
            auto isSpace = [](unsigned char ch) { return std::isspace(ch); };
            while (!imageUrl.empty() && isSpace((unsigned char)imageUrl.front())) imageUrl.erase(imageUrl.begin());
            while (!imageUrl.empty() && isSpace((unsigned char)imageUrl.back())) imageUrl.pop_back();
            if (imageUrl.empty()) continue;

            std::string dataUrl;
            {
                std::lock_guard<std::mutex> lk(cacheMu);
                auto it = dataUrlByImageUrl.find(imageUrl);
                if (it != dataUrlByImageUrl.end()) {
                    dataUrl = it->second;
                }
            }

            if (dataUrl.empty()) {
                std::vector<uint8_t> bytes;
                if (!owner->downloadUrlToBytes_(imageUrl, bytes) || bytes.empty()) {
                    continue;
                }

#ifdef _WIN32
                const std::string b64 = base64EncodeBytes_(bytes.data(), bytes.size());
                if (b64.empty()) continue;
                dataUrl = "data:image/jpeg;base64," + b64;
#else
                continue;
#endif

                {
                    std::lock_guard<std::mutex> lk(cacheMu);
                    if (dataUrlByImageUrl.size() > 1000) {
                        dataUrlByImageUrl.clear();
                    }
                    dataUrlByImageUrl[imageUrl] = dataUrl;
                }
            }

            FaceReferenceImage ref;
            ref.targetId = target.id;
            ref.targetName = target.name;
            ref.targetDescription = target.description;
            ref.referenceImageUrl = imageUrl;
            ref.imageDataUrl = dataUrl;
            out.push_back(std::move(ref));
        }
        if (out.size() >= kMaxReferenceImages) break;
    }

    return out;
}

static std::vector<NegativeReferenceImage> resolveNegativeReferenceImagesForJob_(
    AgentCore* owner,
    const std::vector<JobNegativeReferenceImage>& negativeImages)
{
    std::vector<NegativeReferenceImage> out;
    if (!owner) return out;

    static std::mutex cacheMu;
    static std::unordered_map<std::string, std::string> dataUrlByImageUrl;

    constexpr size_t kMaxReferenceImages = 8;
    out.reserve((std::min)(kMaxReferenceImages, negativeImages.size()));

    std::vector<JobNegativeReferenceImage> orderedImages = negativeImages;
    std::stable_sort(
        orderedImages.begin(),
        orderedImages.end(),
        [](const JobNegativeReferenceImage& lhs, const JobNegativeReferenceImage& rhs) {
            if (lhs.id != rhs.id) return lhs.id < rhs.id;
            return lhs.image_url < rhs.image_url;
        });

    for (const auto& image : orderedImages) {
        if (out.size() >= kMaxReferenceImages) break;

        std::string imageUrl = image.image_url;
        auto isSpace = [](unsigned char ch) { return std::isspace(ch); };
        while (!imageUrl.empty() && isSpace((unsigned char)imageUrl.front())) imageUrl.erase(imageUrl.begin());
        while (!imageUrl.empty() && isSpace((unsigned char)imageUrl.back())) imageUrl.pop_back();
        if (imageUrl.empty()) continue;

        std::string dataUrl;
        {
            std::lock_guard<std::mutex> lk(cacheMu);
            auto it = dataUrlByImageUrl.find(imageUrl);
            if (it != dataUrlByImageUrl.end()) {
                dataUrl = it->second;
            }
        }

        if (dataUrl.empty()) {
            std::vector<uint8_t> bytes;
            if (!owner->downloadUrlToBytes_(imageUrl, bytes) || bytes.empty()) {
                continue;
            }

#ifdef _WIN32
            const std::string b64 = base64EncodeBytes_(bytes.data(), bytes.size());
            if (b64.empty()) continue;
            dataUrl = "data:image/jpeg;base64," + b64;
#else
            continue;
#endif

            {
                std::lock_guard<std::mutex> lk(cacheMu);
                if (dataUrlByImageUrl.size() > 1000) {
                    dataUrlByImageUrl.clear();
                }
                dataUrlByImageUrl[imageUrl] = dataUrl;
            }
        }

        NegativeReferenceImage ref;
        ref.imageId = image.id;
        ref.imageDataUrl = dataUrl;
        out.push_back(std::move(ref));
    }

    return out;
}

static std::string makeJobStillKey_(const std::string& tsUtcIso, const std::string& jpegB64)
{
    if (!tsUtcIso.empty()) {
        return std::string("ts:") + tsUtcIso;
    }
    if (jpegB64.empty()) return "";

    const size_t n = jpegB64.size();
    const size_t edge = std::min<size_t>(64, n);
    const std::string head = jpegB64.substr(0, edge);
    const std::string tail = jpegB64.substr(n - edge, edge);

    return "b64len:" + std::to_string(n) + "|h:" + head + "|t:" + tail;
}

static bool consumeIfNewImageStillForJobStepCamera_(
    int jobId,
    int stepId,
    int cameraId,
    const std::string& stillKey)
{
    if (stillKey.empty()) return true;

    static std::mutex mu;
    static std::unordered_map<std::string, std::string> lastStillBySlot;

    const std::string slot =
        std::to_string(jobId) + "|" +
        std::to_string(stepId) + "|" +
        std::to_string(cameraId);

    std::lock_guard<std::mutex> lk(mu);
    if (lastStillBySlot.size() > 50000) {
        // Safety bound for long-running processes with many historical jobs.
        lastStillBySlot.clear();
    }
    auto it = lastStillBySlot.find(slot);
    if (it != lastStillBySlot.end() && it->second == stillKey) {
        return false;
    }
    lastStillBySlot[slot] = stillKey;
    return true;
}

static std::string encodeVideoFileAsDataUrl_(const fs::path& filePath)
{
    std::vector<unsigned char> bytes;
    if (!readBinaryFile_(filePath, bytes) || bytes.empty()) return "";
#ifdef _WIN32
    const std::string b64 = base64EncodeBytes_(bytes.data(), bytes.size());
#else
    const std::string b64;
#endif
    if (b64.empty()) return "";
    return "data:video/mp4;base64," + b64;
}





static fs::path getJobsTempDirForJobStepCamera(int jobId, int stepId, const std::string& cameraId)
{
    fs::path base = AppBrand::jobsInferenceTempRoot();
    base /= "Job_" + std::to_string(jobId);
    base /= "step_" + std::to_string(stepId);
    base /= "cam_" + cameraId;
    return base;
}



static fs::path getJobsTempDirForJobCamera(int jobId, const std::string& cameraId)
{
    fs::path base = AppBrand::jobsInferenceTempRoot();
    base /= "Job_" + std::to_string(jobId);
    base /= "cam_" + cameraId;
    return base;
}





// Keep directory conventions in sync with CameraSession / FrameDiskWriter.
// FrameDiskWriter always copies finished 10s clips into the inference temp folder
// used by CameraSession's inference_loop:
//   %TEMP%/inferenceLoopPerceptrum/cam_<cameraId>
// Additionally, when jobs capture is enabled for that camera, it also copies to:
//   %TEMP%/jobsInferencePerceptrum/cam_<cameraId>
//
// The job runner must be able to find the same 10s MP4s the CameraSession produces.
// So we search jobsInferencePerceptrum first (if enabled), and fall back to the
// inferenceLoopPerceptrum folder to guarantee the job can run.

static fs::path getInferenceTempDirForCameraId(const std::string& cameraId)
{
    fs::path base = AppBrand::inferenceLoopTempRoot();
    base /= "cam_" + cameraId;
    return base;
}

static fs::path getJobsTempDirForCameraId(const std::string& cameraId)
{
    fs::path base = AppBrand::jobsInferenceTempRoot();
    base /= "cam_" + cameraId;
    return base;
}

static std::string nowMs_() {
    using namespace std::chrono;
    return std::to_string(duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count());
}

static std::filesystem::path makeTelegramUploadCopyPath_(int cameraId) {
    // Use your temp root. If you already have a helper like getPerceptrumTempDir(), use it.
    // Fallback: std::filesystem::temp_directory_path()
    std::filesystem::path dir = std::filesystem::temp_directory_path()
        / "jobsTelegramUploads"
        / ("cam_" + std::to_string(cameraId));

    std::error_code ec;
    std::filesystem::create_directories(dir, ec);

    return dir / ("alert_" + nowMs_() + ".mp4");
}


struct AlertLimiterState {
    int burstUsed = 0; // how many sent in current burst [0..2]
    std::chrono::steady_clock::time_point cooldownUntil =
        std::chrono::steady_clock::time_point::min();
};

static bool allowTelegramAlert_(
    const std::string& key,
    int burstMax,
    std::chrono::seconds cooldown
) {
    using clock = std::chrono::steady_clock;
    static std::mutex m;
    static std::unordered_map<std::string, AlertLimiterState> st;

    const auto now = clock::now();

    std::lock_guard<std::mutex> lock(m);
    auto& s = st[key];

    // still cooling down
    if (now < s.cooldownUntil) return false;

    // cooldown ended (or never started) ? if we had cooled down, reset burst counter
    // (if cooldownUntil was min, this is harmless)
    if (s.cooldownUntil != clock::time_point::min() && now >= s.cooldownUntil) {
        s.burstUsed = 0;
        s.cooldownUntil = clock::time_point::min();
    }

    // allow within burst
    if (s.burstUsed < burstMax) {
        s.burstUsed++;
        // if we just consumed the last slot, start cooldown immediately
        if (s.burstUsed >= burstMax) {
            s.cooldownUntil = now + cooldown;
        }
        return true;
    }

    // should not normally reach here, but safe fallback:
    s.cooldownUntil = now + cooldown;
    return false;
}

static std::optional<std::string> getNewestImageInDir(const fs::path& dir)
{
    try {
        std::error_code ec;

        if (!fs::exists(dir, ec) || !fs::is_directory(dir, ec)) return std::nullopt;

        auto isImageExt = [](const fs::path& p) {
            std::string ext = p.extension().string();
            std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c) {
                return static_cast<char>(std::tolower(c));
            });
            return ext == ".jpg" || ext == ".jpeg" || ext == ".png";
        };

        fs::path bestPath;
        fs::file_time_type bestTime;
        bool found = false;

        for (const auto& entry : fs::directory_iterator(dir, ec)) {
            if (ec) break;
            if (!entry.is_regular_file()) continue;
            if (!isImageExt(entry.path())) continue;

            auto t = entry.last_write_time(ec);
            if (ec) continue;

            if (!found || t > bestTime) {
                bestPath = entry.path();
                bestTime = t;
                found = true;
            }
        }

        if (!found) return std::nullopt;
        return bestPath.string();
    }
    catch (...) {
        return std::nullopt;
    }
}

static std::optional<std::string> getNewestJobsImageForCamera(int jobId, int stepId, const std::string& cameraId)
{
    return getNewestImageInDir(getJobsTempDirForJobStepCamera(jobId, stepId, cameraId) / "images");
}

static bool encodeMatAsJpegDataUrl_(
    const cv::Mat& frame,
    std::string& outDataUrl,
    std::string* outErr = nullptr)
{
    outDataUrl.clear();
    if (frame.empty()) {
        if (outErr) *outErr = "input frame empty";
        return false;
    }

    std::vector<uchar> jpgBytes;
    if (!cv::imencode(".jpg", frame, jpgBytes) || jpgBytes.empty()) {
        if (outErr) *outErr = "cv::imencode jpg failed";
        return false;
    }

#ifdef _WIN32
    const std::string b64 = base64EncodeBytes_(jpgBytes.data(), jpgBytes.size());
#else
    const std::string b64;
#endif
    if (b64.empty()) {
        if (outErr) *outErr = "base64 encode failed";
        return false;
    }

    outDataUrl = ensureDataUrlBase64_(b64, "image/jpeg");
    return !outDataUrl.empty();
}

static bool encodeImageFileAsJpegDataUrl_(
    const fs::path& imagePath,
    std::string& outDataUrl,
    std::string* outErr)
{
    outDataUrl.clear();
    cv::Mat img = cv::imread(imagePath.string(), cv::IMREAD_COLOR);
    if (img.empty()) {
        if (outErr) *outErr = "cv::imread failed";
        return false;
    }
    return encodeMatAsJpegDataUrl_(img, outDataUrl, outErr);
}

/*
static std::optional<std::string> getOldestJobsClipForCamera(const std::string& cameraId)
{
    // 1) Prefer the dedicated jobs folder (only populated when jobs capture is enabled)
    if (auto p = getOldestMp4InDir(getJobsTempDirForCameraId(cameraId))) return p;

    // 2) Fallback to the main inference_loop folder
    return getOldestMp4InDir(getInferenceTempDirForCameraId(cameraId));
}
*/



static void sleepBackoffMs_(int attempt) {
    // 25, 50, 100, 200, 400, 800, ...
    int ms = 25 * (1 << std::min(attempt, 6));
    std::this_thread::sleep_for(std::chrono::milliseconds(ms));
}

static bool removeAllWithRetry_(const fs::path& dir, int tries, std::string* lastErr = nullptr) {
    std::error_code ec;

    for (int i = 0; i < tries; ++i) {
        ec.clear();

        if (!fs::exists(dir, ec)) return true; // already gone
        fs::remove_all(dir, ec);

        if (!ec) return true;

        if (lastErr) *lastErr = ec.message();
        sleepBackoffMs_(i);
    }

    return false;
}

static void quarantineAndRemove_(const fs::path& dir) {
    std::error_code ec;

    if (!fs::exists(dir, ec) || ec) return;

    // Move folder out of the hot path so new jobs won?t collide with leftovers
    fs::path q = dir;
    q += ".deleting";

    // If .deleting exists, add a timestamp-ish suffix
    if (fs::exists(q, ec)) {
        q = dir;
        q += ".deleting_";
        q += std::to_string(
            (long long)std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now().time_since_epoch()).count()
        );
    }

    ec.clear();
    fs::rename(dir, q, ec);
    if (ec) {
        // Could not rename (maybe in use). We'll just try delete directly with more retries.
        (void)removeAllWithRetry_(dir, 12, nullptr);
        return;
    }

    // Now try deleting the quarantined folder with retries
    (void)removeAllWithRetry_(q, 12, nullptr);
}


static void cleanupJobFolderAsync(int jobId) {
    fs::path dir = AppBrand::jobsInferenceTempRoot()
        / ("Job_" + std::to_string(jobId));

    std::thread([dir]() {
        // 1) first attempts: remove_all with retry
        std::string err;
        bool ok = removeAllWithRetry_(dir, 8, &err);

        if (!ok) {
            // 2) quarantine + remove (handles "in use" better and prevents folder collisions)
            quarantineAndRemove_(dir);

            // 3) final attempt (in case quarantine failed)
            (void)removeAllWithRetry_(dir, 8, nullptr);
        }
        }).detach();
}

static void cleanupJobsTempRootOnStartup_() {
    try {
        const fs::path root = AppBrand::jobsInferenceTempRoot();
        std::error_code ec;
        if (!fs::exists(root, ec) || ec) {
            ec.clear();
            fs::create_directories(root, ec);
            if (ec) {
                Logger::instance().logDebug(
                    "job",
                    "startup temp cleanup: failed to create root " + root.string() +
                    " err=" + ec.message()
                );
                return;
            }
            Logger::instance().logDebug(
                "job",
                "startup temp cleanup: root created " + root.string()
            );
            return;
        }
        if (!fs::is_directory(root, ec) || ec) {
            Logger::instance().logDebug(
                "job",
                "startup temp cleanup: root exists but is not a directory: " + root.string()
            );
            return;
        }

        int removedCount = 0;
        int failedCount = 0;
        int skippedCount = 0;

        for (const auto& entry : fs::directory_iterator(root, ec)) {
            if (ec) break;

            std::error_code tec;
            if (!entry.is_directory(tec) || tec) {
                continue;
            }

            const fs::path dirPath = entry.path();
            const std::string name = dirPath.filename().string();
            const bool isJobFolder = (name.rfind("Job_", 0) == 0);
            const bool isDeletingFolder = (name.find(".deleting") != std::string::npos);

            // Keep non-job folders untouched (ex.: legacy cam_<id> layouts).
            if (!isJobFolder && !isDeletingFolder) {
                ++skippedCount;
                continue;
            }

            bool removed = false;
            std::string err;
            removed = removeAllWithRetry_(dirPath, 8, &err);
            if (!removed) {
                quarantineAndRemove_(dirPath);
                std::error_code existsEc;
                removed = !fs::exists(dirPath, existsEc);
                if (!removed) {
                    (void)removeAllWithRetry_(dirPath, 8, nullptr);
                    removed = !fs::exists(dirPath, existsEc);
                }
            }

            if (removed) {
                ++removedCount;
            }
            else {
                ++failedCount;
                Logger::instance().logDebug(
                    "job",
                    "startup temp cleanup: failed removing " + dirPath.string() +
                    (err.empty() ? "" : (" err=" + err))
                );
            }
        }

        Logger::instance().logDebug(
            "job",
            "startup temp cleanup finished root=" + root.string() +
            " removed=" + std::to_string(removedCount) +
            " failed=" + std::to_string(failedCount) +
            " skipped=" + std::to_string(skippedCount)
        );
    }
    catch (const std::exception& ex) {
        Logger::instance().logDebug(
            "job",
            std::string("startup temp cleanup exception: ") + ex.what()
        );
    }
    catch (...) {
        Logger::instance().logDebug("job", "startup temp cleanup unknown exception");
    }
}







static bool parseJobClipFilename(
    const std::string& filename, // ex: "3_20260214_123943_20260214_123953_10s.mp4"
    int& outCameraId,
    std::string& outStartPretty, // "14/02/2026 12:39:43"
    std::string& outEndPretty    // "14/02/2026 12:39:53"
) {
    // remove extens?o
    std::string base = filename;
    const auto dot = base.rfind('.');
    if (dot != std::string::npos) base = base.substr(0, dot);

    // split por "_"
    std::vector<std::string> t;
    {
        std::stringstream ss(base);
        std::string tok;
        while (std::getline(ss, tok, '_')) t.push_back(tok);
    }

    // Esperado: camId, YYYYMMDD, HHMMSS, YYYYMMDD, HHMMSS, "10s"
    if (t.size() < 6) return false;

    // camera id
    try { outCameraId = std::stoi(t[0]); }
    catch (...) { return false; }

    const std::string& sd = t[1];
    const std::string& st = t[2];
    const std::string& ed = t[3];
    const std::string& et = t[4];

    auto pretty = [](const std::string& yyyymmdd, const std::string& hhmmss) -> std::string {
        if (yyyymmdd.size() != 8 || hhmmss.size() != 6) return "";
        std::ostringstream oss;
        oss << yyyymmdd.substr(6, 2) << "/" << yyyymmdd.substr(4, 2) << "/" << yyyymmdd.substr(0, 4)
            << " " << hhmmss.substr(0, 2) << ":" << hhmmss.substr(2, 2) << ":" << hhmmss.substr(4, 2);
        return oss.str();
        };

    outStartPretty = pretty(sd, st);
    outEndPretty = pretty(ed, et);
    return !outStartPretty.empty() && !outEndPretty.empty();
}

static bool compactLocalClipTokenToUtcIso_(
    const std::string& yyyymmdd,
    const std::string& hhmmss,
    std::string& outUtcIso)
{
    outUtcIso.clear();
    if (yyyymmdd.size() != 8 || hhmmss.size() != 6) return false;

    auto isDigitsLen = [](const std::string& s, size_t n) -> bool {
        if (s.size() != n) return false;
        return std::all_of(s.begin(), s.end(), [](unsigned char c) { return std::isdigit(c) != 0; });
    };
    if (!isDigitsLen(yyyymmdd, 8) || !isDigitsLen(hhmmss, 6)) return false;

    std::tm tmLocal{};
    try {
        tmLocal.tm_year = std::stoi(yyyymmdd.substr(0, 4)) - 1900;
        tmLocal.tm_mon = std::stoi(yyyymmdd.substr(4, 2)) - 1;
        tmLocal.tm_mday = std::stoi(yyyymmdd.substr(6, 2));
        tmLocal.tm_hour = std::stoi(hhmmss.substr(0, 2));
        tmLocal.tm_min = std::stoi(hhmmss.substr(2, 2));
        tmLocal.tm_sec = std::stoi(hhmmss.substr(4, 2));
        tmLocal.tm_isdst = -1;
    }
    catch (...) {
        return false;
    }

    const std::time_t tt = std::mktime(&tmLocal);
    if (tt == static_cast<std::time_t>(-1)) return false;

    std::tm tmUtc{};
#ifdef _WIN32
    gmtime_s(&tmUtc, &tt);
#else
    gmtime_r(&tt, &tmUtc);
#endif
    char buf[32];
    if (std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tmUtc) == 0) {
        return false;
    }
    outUtcIso = std::string(buf);
    return true;
}

static bool parseClipRangeUtcIsoFromPath_(
    const fs::path& clipPath,
    std::string& outStartUtcIso,
    std::string& outEndUtcIso)
{
    outStartUtcIso.clear();
    outEndUtcIso.clear();

    std::string name = clipPath.filename().string();
    const std::string processingSuffix = ".processing";
    if (name.size() > processingSuffix.size() &&
        name.rfind(processingSuffix) == (name.size() - processingSuffix.size()))
    {
        name = name.substr(0, name.size() - processingSuffix.size());
    }

    const auto dot = name.rfind('.');
    if (dot != std::string::npos) {
        name = name.substr(0, dot);
    }

    std::vector<std::string> t;
    {
        std::stringstream ss(name);
        std::string tok;
        while (std::getline(ss, tok, '_')) t.push_back(tok);
    }

    if (t.size() < 5) {
        return false;
    }

    return compactLocalClipTokenToUtcIso_(t[1], t[2], outStartUtcIso) &&
        compactLocalClipTokenToUtcIso_(t[3], t[4], outEndUtcIso);
}

static bool parseClipEndTsUtcIsoFromPath_(
    const fs::path& clipPath,
    std::string& outTsUtcIso)
{
    outTsUtcIso.clear();

    std::string name = clipPath.filename().string();
    const std::string processingSuffix = ".processing";
    if (name.size() > processingSuffix.size() &&
        name.rfind(processingSuffix) == (name.size() - processingSuffix.size()))
    {
        name = name.substr(0, name.size() - processingSuffix.size());
    }

    const auto dot = name.rfind('.');
    if (dot != std::string::npos) {
        name = name.substr(0, dot);
    }

    std::vector<std::string> t;
    {
        std::stringstream ss(name);
        std::string tok;
        while (std::getline(ss, tok, '_')) t.push_back(tok);
    }

    auto isDigitsLen = [](const std::string& s, size_t n) -> bool {
        if (s.size() != n) return false;
        return std::all_of(s.begin(), s.end(), [](unsigned char c) { return std::isdigit(c) != 0; });
    };

    std::string endDate;
    std::string endTime;
    if (t.size() >= 5 && isDigitsLen(t[3], 8) && isDigitsLen(t[4], 6)) {
        endDate = t[3];
        endTime = t[4];
    }
    else if (t.size() >= 3 && isDigitsLen(t[1], 8) && isDigitsLen(t[2], 6)) {
        endDate = t[1];
        endTime = t[2];
    }
    else {
        return false;
    }

    return compactLocalClipTokenToUtcIso_(endDate, endTime, outTsUtcIso);
}

static bool clipStartsBeforeCoverageCutoff_(
    const fs::path& clipPath,
    const std::string& coverageCutoffUtcIso)
{
    const std::string normalizedCutoff =
        temporal::normalizeFlexibleTs(trimCopyRuntime_(coverageCutoffUtcIso));
    if (normalizedCutoff.empty()) {
        return true;
    }

    std::string clipStartUtc;
    std::string clipEndUtc;
    if (!parseClipRangeUtcIsoFromPath_(clipPath, clipStartUtc, clipEndUtc)) {
        return true;
    }

    const std::string normalizedStart = temporal::normalizeFlexibleTs(clipStartUtc);
    if (normalizedStart.empty()) {
        return true;
    }
    return normalizedStart < normalizedCutoff;
}

static bool trimClipToCoverageCutoff_(
    int jobId,
    int stepId,
    int cameraId,
    const fs::path& srcClipPath,
    const std::string& srcStartUtcIso,
    const std::string& srcEndUtcIso,
    const std::string& coverageCutoffUtcIso,
    fs::path& outTrimmedPath,
    std::string& outEffectiveStartUtcIso,
    std::string& outEffectiveEndUtcIso,
    std::string* outErr)
{
    outTrimmedPath.clear();
    outEffectiveStartUtcIso = temporal::normalizeFlexibleTs(srcStartUtcIso);
    outEffectiveEndUtcIso = temporal::normalizeFlexibleTs(srcEndUtcIso);

    const std::string normalizedCutoff =
        temporal::normalizeFlexibleTs(trimCopyRuntime_(coverageCutoffUtcIso));
    if (normalizedCutoff.empty() ||
        outEffectiveStartUtcIso.empty() ||
        outEffectiveEndUtcIso.empty())
    {
        return true;
    }
    if (outEffectiveEndUtcIso <= normalizedCutoff) {
        return true;
    }
    if (outEffectiveStartUtcIso >= normalizedCutoff) {
        if (outErr) {
            *outErr = "clip starts at or after coverage cutoff";
        }
        return false;
    }

    std::chrono::system_clock::time_point startTp;
    std::chrono::system_clock::time_point cutoffTp;
    if (!parseCoverageTimePoint_(outEffectiveStartUtcIso, startTp) ||
        !parseCoverageTimePoint_(normalizedCutoff, cutoffTp) ||
        cutoffTp <= startTp)
    {
        if (outErr) {
            *outErr = "invalid trim range";
        }
        return false;
    }

    const double durationSeconds = std::chrono::duration_cast<std::chrono::milliseconds>(
        cutoffTp - startTp
    ).count() / 1000.0;
    if (durationSeconds <= 0.0) {
        if (outErr) {
            *outErr = "non-positive trim duration";
        }
        return false;
    }

    const std::string safeCutoff = normalizedCutoff;
    std::string trimmedStem = "coverage_trim_" + std::to_string(jobId) +
        "_" + std::to_string(stepId) +
        "_" + std::to_string(cameraId) +
        "_" + std::to_string(std::hash<std::string>{}(srcClipPath.string() + safeCutoff));
    fs::path trimmedPath =
        getJobsTempDirForJobStepCamera(jobId, stepId, std::to_string(cameraId)) /
        (trimmedStem + ".mp4");

    std::string trimErr;
    if (!cutMp4SegmentWithFfmpeg_(srcClipPath, trimmedPath, 0.0, durationSeconds, &trimErr)) {
        if (outErr) {
            *outErr = trimErr;
        }
        return false;
    }

    outTrimmedPath = trimmedPath;
    outEffectiveEndUtcIso = normalizedCutoff;
    return true;
}

static bool hasProcessingSuffix_(const fs::path& clipPath)
{
    const std::string name = clipPath.filename().string();
    const std::string processingSuffix = ".processing";
    return name.size() > processingSuffix.size() &&
        name.rfind(processingSuffix) == (name.size() - processingSuffix.size());
}

static std::string describeClipPathForLogs_(const fs::path& clipPath)
{
    std::error_code ec;
    const bool exists = fs::exists(clipPath, ec) && !ec;
    const std::uintmax_t size = exists ? fs::file_size(clipPath, ec) : 0;
    const bool hasSize = exists && !ec;
    return clipPath.string() +
        " exists=" + std::string(exists ? "1" : "0") +
        " size=" + (hasSize ? std::to_string(size) : std::string("n/a"));
}

#ifdef _WIN32
static void ensureOpenCvVideoIoThreadReady_()
{
    thread_local bool attempted = false;
    if (attempted) return;
    attempted = true;

    const HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(hr) && hr != S_FALSE && hr != RPC_E_CHANGED_MODE) {
        try {
            Logger::instance().logDebug(
                "job",
                "OpenCV video I/O CoInitializeEx failed hr=" + std::to_string(hr)
            );
        }
        catch (...) {
        }
    }
}
#else
static void ensureOpenCvVideoIoThreadReady_() {}
#endif

static bool waitForReadableClipPath_(
    const fs::path& clipPath,
    std::string* outErr = nullptr)
{
    constexpr int kMaxAttempts = 8;
    constexpr auto kRetryDelay = std::chrono::milliseconds(50);
    for (int attempt = 0; attempt < kMaxAttempts; ++attempt) {
        std::error_code ec;
        const bool exists = fs::exists(clipPath, ec) && !ec;
        const std::uintmax_t size = exists ? fs::file_size(clipPath, ec) : 0;
        if (exists && !ec && size > 0) {
            std::ifstream ifs(clipPath, std::ios::binary);
            if (ifs.good()) {
                return true;
            }
        }
        if (attempt + 1 < kMaxAttempts) {
            std::this_thread::sleep_for(kRetryDelay);
        }
    }

    if (outErr) {
        *outErr = "clip not readable yet: " + describeClipPathForLogs_(clipPath);
    }
    return false;
}

struct TempOpenCvClipPathGuard_
{
    fs::path path;

    ~TempOpenCvClipPathGuard_()
    {
        if (path.empty()) return;
        std::error_code ec;
        fs::remove(path, ec);
    }
};

static bool tryOpenVideoCaptureWithPreferredBackends_(
    const fs::path& clipPath,
    cv::VideoCapture& outCap)
{
    ensureOpenCvVideoIoThreadReady_();

    const std::string clipPathUtf8 = clipPath.string();
    if (clipPathUtf8.empty()) {
        outCap.release();
        return false;
    }

    // Prefer the ffmpeg backend for normalized MP4s so jobs and direct camera
    // inference resolve clips consistently before crop / motion-gate.
#ifdef _WIN32
    const std::vector<int> apiPreferences = {
        cv::CAP_FFMPEG,
        cv::CAP_MSMF,
        cv::CAP_ANY
    };
#else
    const std::vector<int> apiPreferences = {
        cv::CAP_FFMPEG,
        cv::CAP_ANY
    };
#endif
    for (const int apiPreference : apiPreferences) {
        outCap.release();
        if (outCap.open(clipPathUtf8, apiPreference)) {
            return true;
        }
    }

    outCap.release();
    return false;
}

static bool tryOpenVideoCaptureWithRetry_(
    const fs::path& clipPath,
    cv::VideoCapture& outCap)
{
    constexpr int kMaxOpenAttempts = 4;
    constexpr auto kRetryDelay = std::chrono::milliseconds(75);
    for (int attempt = 0; attempt < kMaxOpenAttempts; ++attempt) {
        if (tryOpenVideoCaptureWithPreferredBackends_(clipPath, outCap)) {
            return true;
        }
        if (attempt + 1 < kMaxOpenAttempts) {
            std::this_thread::sleep_for(kRetryDelay);
        }
    }
    return false;
}

static bool openVideoCaptureForClipPath_(
    const fs::path& clipPath,
    cv::VideoCapture& outCap,
    fs::path& outTempOpenPath,
    std::string* outErr = nullptr)
{
    outTempOpenPath.clear();
    outCap.release();
    auto clearTempPath = [](const fs::path& path) {
        if (path.empty()) return;
        std::error_code ec;
        fs::remove(path, ec);
    };
    auto tryOpen = [&](const fs::path& path) -> bool {
        return tryOpenVideoCaptureWithRetry_(path, outCap);
    };

    std::string readableErr;
    if (!waitForReadableClipPath_(clipPath, &readableErr)) {
        if (outErr) *outErr = readableErr;
        return false;
    }

    if (tryOpen(clipPath)) {
        return true;
    }

    fs::path normalizedInputPath = clipPath;
    fs::path processingTempPath;
    if (hasProcessingSuffix_(clipPath)) {
        // OpenCV commonly rejects ".processing" even when the bytes are a valid MP4.
        processingTempPath = fs::path(clipPath.string() + ".opencv_source.mp4");
        std::error_code copyEc;
        clearTempPath(processingTempPath);
        if (!fs::copy_file(
                clipPath,
                processingTempPath,
                fs::copy_options::overwrite_existing,
                copyEc))
        {
            if (outErr) {
                *outErr =
                    "failed to create OpenCV temp clip: " + copyEc.message() +
                    " src=" + describeClipPathForLogs_(clipPath) +
                    " dst=" + processingTempPath.string();
            }
            return false;
        }

        normalizedInputPath = processingTempPath;
        if (tryOpen(normalizedInputPath)) {
            outTempOpenPath = normalizedInputPath;
            return true;
        }
    }

    // Some Media Foundation clips are valid for ffmpeg but not directly readable by OpenCV.
    // Normalize them into an H.264/yuv420p temp MP4 and reopen that instead of aborting the
    // job agent before motion-gate / frame-window crop can run.
    const fs::path normalizedOpenPath = fs::path(normalizedInputPath.string() + ".opencv_normalized.mp4");
    clearTempPath(normalizedOpenPath);
    std::string normalizeErr;
    if (!transcodeToWebMp4_(normalizedInputPath, normalizedOpenPath, &normalizeErr)) {
        clearTempPath(processingTempPath);
        if (outErr) {
            *outErr =
                "cv::VideoCapture failed to open source clip; normalize_err=" + normalizeErr +
                " src=" + describeClipPathForLogs_(clipPath) +
                " normalized_input=" + describeClipPathForLogs_(normalizedInputPath) +
                " normalized_output=" + normalizedOpenPath.string();
        }
        return false;
    }

    readableErr.clear();
    if (!waitForReadableClipPath_(normalizedOpenPath, &readableErr)) {
        const std::string normalizedDesc = describeClipPathForLogs_(normalizedOpenPath);
        clearTempPath(normalizedOpenPath);
        clearTempPath(processingTempPath);
        if (outErr) {
            *outErr =
                "normalized clip not readable yet normalized=" + normalizedDesc +
                " src=" + describeClipPathForLogs_(clipPath) +
                " reason=" + readableErr;
        }
        return false;
    }

    if (!tryOpen(normalizedOpenPath)) {
        const std::string normalizedDesc = describeClipPathForLogs_(normalizedOpenPath);
        clearTempPath(normalizedOpenPath);
        clearTempPath(processingTempPath);
        if (outErr) {
            *outErr =
                "cv::VideoCapture failed to open normalized clip normalized=" +
                normalizedDesc +
                " src=" + describeClipPathForLogs_(clipPath);
        }
        return false;
    }

    clearTempPath(processingTempPath);
    outTempOpenPath = normalizedOpenPath;
    return true;
}





JobRuntime::JobRuntime(AgentCore* owner) : owner_(owner) {
    static std::once_flag s_jobsTempStartupCleanupOnce;
    std::call_once(s_jobsTempStartupCleanupOnce, []() {
        cleanupJobsTempRootOnStartup_();
        });
}
JobRuntime::~JobRuntime() {
    std::lock_guard<std::mutex> lk(mu_);
    for (auto& [jobId, inst] : running_) {
        inst->cancel = true;
        if (inst->worker.joinable()) inst->worker.join();
    }
    running_.clear();
    stopJobTokenUsageWorker();
}

void JobRuntime::onJobStartCommand(const json& cmd) {
    JobStartPayload payload = JobPayloadParser::parseJobStartPayloadOrThrow(cmd);

    auto inst = std::make_shared<JobInstance>();
    inst->payload = std::move(payload);

    {
        std::lock_guard<std::mutex> lk(mu_);
        // If already running, stop old instance first (idempotency / safety)
        auto it = running_.find(inst->payload.job.id);
        if (it != running_.end()) {
            it->second->cancel = true;
            if (it->second->worker.joinable()) it->second->worker.join();
            running_.erase(it);
        }
        running_[inst->payload.job.id] = inst;
    }

    clearJobEphemeralState_(inst->payload.job.id);

    inst->worker = std::thread([this, inst]() {
        try {
            this->runJob_(inst);
        }
        catch (const std::exception& ex) {
            logJobException_(
                "job",
                "jobs",
                "JobRuntime::onJobStartCommand::worker",
                "run_job",
                {
                    { "job_id", inst && inst->payload.job.id > 0 ? inst->payload.job.id : -1 },
                    { "job_name", inst ? inst->payload.job.name : std::string() }
                },
                ex
            );
        }
        catch (...) {
            logJobUnknownException_(
                "job",
                "jobs",
                "JobRuntime::onJobStartCommand::worker",
                "run_job",
                {
                    { "job_id", inst && inst->payload.job.id > 0 ? inst->payload.job.id : -1 },
                    { "job_name", inst ? inst->payload.job.name : std::string() }
                }
            );
        }
    });
}

void JobRuntime::onJobStopCommand(const json& cmd) {
    int jobId = -1;
    try {
        if (cmd.contains("payload") && cmd["payload"].is_object()) {
            const auto& p = cmd["payload"];
            if (p.contains("job") && p["job"].is_object()) jobId = p["job"].value("id", -1);
            if (jobId < 0) jobId = p.value("job_id", -1);
        }
    }
    catch (...) {
        Logger::instance().logError(
            "job",
            "invalid payload while reading job id",
            makeJobErrorContext_(
                "jobs",
                "JobRuntime::onJobStopCommand",
                "parse_payload",
                {
                    { "command_type", cmd.value("command_type", std::string()) }
                }
            )
        );
    }

    if (jobId < 0) return;

    std::shared_ptr<JobInstance> inst;
    {
        std::lock_guard<std::mutex> lk(mu_);
        auto it = running_.find(jobId);
        if (it != running_.end()) {
            inst = it->second;
            inst->cancel = true;
        }
    }
    if (inst && inst->worker.joinable()) inst->worker.join();

    {
        std::lock_guard<std::mutex> lk(mu_);
        running_.erase(jobId);
    }

    clearJobEphemeralState_(jobId);
    cleanupJobFolderAsync(jobId);
}

void JobRuntime::onCrossCameraUpdateCommand(const json& cmd) {
    int jobId = -1;
    int stepId = -1;
    json publishedHunts = json::array();
    try {
        if (cmd.contains("payload") && cmd["payload"].is_object()) {
            const json& payload = cmd["payload"];
            jobId = payload.value("job_id", -1);
            stepId = payload.value("step_id", -1);
            if (payload.contains("published_cross_camera_hunts") &&
                payload["published_cross_camera_hunts"].is_array())
            {
                publishedHunts = payload["published_cross_camera_hunts"];
            }
        }
    }
    catch (...) {
        publishedHunts = json::array();
    }

    if (jobId <= 0 || stepId <= 0 || !publishedHunts.is_array() || publishedHunts.empty()) {
        return;
    }

    const std::string crossCameraStepKey =
        "job:" + std::to_string(jobId) + "|step:" + std::to_string(stepId);
    const std::string nowIsoUtc = temporal::nowIso();
    auto normalizeHunt = [&](const json& rawHunt) -> json {
        if (!rawHunt.is_object()) {
            return json::object();
        }
        json normalized = rawHunt;
        if (!normalized.contains("created_at_utc") || !normalized["created_at_utc"].is_string()) {
            normalized["created_at_utc"] = nowIsoUtc;
        }
        if (!normalized.contains("watch_ttl_seconds")) {
            normalized["watch_ttl_seconds"] = 900;
        }
        return normalized;
    };

    {
        std::lock_guard<std::mutex> lock(crossCameraHuntsMu_);
        json& hunts = crossCameraHuntsByStep_[crossCameraStepKey];
        if (!hunts.is_array()) {
            hunts = json::array();
        }
        for (const auto& rawHunt : publishedHunts) {
            const json normalizedHunt = normalizeHunt(rawHunt);
            if (!normalizedHunt.is_object() || normalizedHunt.empty()) {
                continue;
            }
            const std::string huntId =
                temporal::trim(temporal::strField(normalizedHunt, "hunt_id"));
            bool duplicate = false;
            if (!huntId.empty()) {
                for (const auto& existingHunt : hunts) {
                    if (!existingHunt.is_object()) continue;
                    if (temporal::trim(temporal::strField(existingHunt, "hunt_id")) == huntId) {
                        duplicate = true;
                        break;
                    }
                }
            }
            if (!duplicate) {
                hunts.push_back(normalizedHunt);
            }
        }
        if (hunts.size() > 128) {
            hunts.erase(hunts.begin(), hunts.begin() + (hunts.size() - 128));
        }
    }
}

static std::vector<JobStepDef> sortSteps(std::vector<JobStepDef> steps) {
    std::sort(steps.begin(), steps.end(), [](const JobStepDef& a, const JobStepDef& b) {
        return a.step_order < b.step_order;
        });
    return steps;
}

static std::string toLowerCopy(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return (char)std::tolower(c); });
    return s;
}

static std::string normalizeInferenceModel_(std::string s) {
    s = toLowerCopy(std::move(s));
    if (s == "ultra+" || s == "ultra-plus" || s == "ultra_plus") return "ultra_plus";
    if (s == "legacy" || s == "pro" || s == "ultra" || s == "ultra_plus" || s == "light" || s == "core") return s;
    return "legacy";
}

static bool isOpenAIInferenceModel_(const std::string& inferenceModel) {
    const std::string m = normalizeInferenceModel_(inferenceModel);
    return m == "pro" || m == "ultra" || m == "ultra_plus" || m == "light";
}

static bool isCoreInferenceModel_(const std::string& inferenceModel) {
    return normalizeInferenceModel_(inferenceModel) == "core";
}

static std::string openAIModelNameForInferenceModel_(const std::string& inferenceModel) {
    const std::string m = normalizeInferenceModel_(inferenceModel);
    if (m == "core") return "GLM-4.6V-Flash";
    if (m == "ultra") return "gpt-5.1";
    if (m == "ultra_plus") return "gpt-5.4";
    if (m == "light") return "gpt-5.4-mini";
    return "gpt-5-mini"; // "pro" / "legacy"
}

struct AlertValidationMeta_ {
    bool executed = false;
    bool alertCondition = false;
    int promptTokens = 0;
    int outputTokens = 0;
    int totalTokens = 0;
};

static int clampModelInputFps_(int fps) {
    if (fps < 1) return 1;
    if (fps > 5) return 5;
    return fps;
}

static int normalizeModelInputFps_(
    int fps,
    const std::string& inferenceModel,
    const std::string& inputType)
{
    std::string normalizedInputType = inputType;
    std::transform(
        normalizedInputType.begin(),
        normalizedInputType.end(),
        normalizedInputType.begin(),
        [](unsigned char c) { return static_cast<char>(std::tolower(c)); }
    );
    if (normalizedInputType.empty()) normalizedInputType = "video";

    (void)inferenceModel;
    if (normalizedInputType != "video") {
        return 1;
    }
    return clampModelInputFps_(fps);
}

static int normalizeCoreRunningResolution_(int runningResolution) {
    return (runningResolution == 1024) ? 1024 : 640;
}

static int normalizeRunEverySeconds_(int seconds) {
    if (seconds <= 10) return 10;
    if (seconds == 300) return 300;
    if (seconds == 600) return 600;
    return 60;
}

static bool parseCoverageTimePoint_(const std::string& rawIsoUtc, std::chrono::system_clock::time_point& out) {
    return temporal::parseFlexibleTs(rawIsoUtc, out);
}

static std::string formatCoverageIsoUtc_(const std::chrono::system_clock::time_point& tp) {
    return temporal::formatIsoUtcNoSuffix(tp);
}

static bool hasUsableInferenceResult_(const VideoHit& hit, int promptTokens, int outputTokens, int totalTokens) {
    if (hit.analysisFailed) {
        return false;
    }
    if (promptTokens > 0 || outputTokens > 0 || totalTokens > 0) {
        return true;
    }
    if (!trimCopyRuntime_(hit.answer).empty()) {
        return true;
    }
    if (hit.hasMatch || hit.alertCondition || hit.faceIdMatch) {
        return true;
    }
    if (hit.startConditionStepId >= 0) {
        return true;
    }
    if (!hit.alertRegionIds.empty()) {
        return true;
    }
    if (hit.temporalPayloadPresent) {
        return true;
    }
    if (hit.identityPatch.is_array() && !hit.identityPatch.empty()) {
        return true;
    }
    if (hit.observations.is_array() && !hit.observations.empty()) {
        return true;
    }
    if (!hit.temporalEvidenceCandidates.empty()) {
        return true;
    }
    return false;
}

static std::string trimCopyRuntime_(std::string s) {
    auto isSpace = [](unsigned char ch) { return std::isspace(ch); };
    while (!s.empty() && isSpace((unsigned char)s.front())) s.erase(s.begin());
    while (!s.empty() && isSpace((unsigned char)s.back())) s.pop_back();
    return s;
}

std::string JobRuntime::trimTemporalEvidenceValue_(const std::string& value) {
    return trimCopyRuntime_(value);
}

JobRuntime::TemporalEvidenceTrail JobRuntime::loadTemporalEvidenceTrail_(
    const std::string& temporalSlotKey)
{
    if (temporalSlotKey.empty()) {
        return TemporalEvidenceTrail{};
    }
    std::lock_guard<std::mutex> lock(temporalMu_);
    auto it = temporalEvidenceBySlot_.find(temporalSlotKey);
    if (it == temporalEvidenceBySlot_.end()) {
        return TemporalEvidenceTrail{};
    }
    return it->second;
}

void JobRuntime::saveTemporalEvidenceTrail_(
    const std::string& temporalSlotKey,
    const TemporalEvidenceTrail& trail)
{
    if (temporalSlotKey.empty()) {
        return;
    }
    std::lock_guard<std::mutex> lock(temporalMu_);
    temporalEvidenceBySlot_[temporalSlotKey] = trail;
}

void JobRuntime::mergeTemporalEvidenceTrail_(
    TemporalEvidenceTrail& trail,
    const std::vector<TemporalEvidenceCandidate>& candidates,
    const std::vector<std::string>& acceptedEvidenceKeys)
{
    if (trail.empty() && candidates.empty()) {
        return;
    }

    std::unordered_set<std::string> acceptedKeys;
    acceptedKeys.reserve(acceptedEvidenceKeys.size());
    for (const auto& rawKey : acceptedEvidenceKeys) {
        const std::string key = trimTemporalEvidenceValue_(rawKey);
        if (!key.empty()) {
            acceptedKeys.insert(key);
        }
    }

    std::unordered_set<std::string> existingKeys;
    existingKeys.reserve(trail.size());
    for (const auto& item : trail) {
        const std::string key = trimTemporalEvidenceValue_(item.evidenceKey);
        if (!key.empty()) {
            existingKeys.insert(key);
        }
    }

    constexpr std::size_t kMaxTemporalEvidenceTrailItems = 48;
    for (const auto& candidate : candidates) {
        const std::string evidenceKey = trimTemporalEvidenceValue_(candidate.evidenceKey);
        if (evidenceKey.empty()) {
            continue;
        }
        if (!acceptedKeys.empty() && acceptedKeys.find(evidenceKey) == acceptedKeys.end()) {
            continue;
        }
        if (!existingKeys.insert(evidenceKey).second) {
            continue;
        }
        if (trimTemporalEvidenceValue_(candidate.imageJpegBase64).empty()) {
            continue;
        }

        TemporalEvidenceItem item;
        item.evidenceKey = evidenceKey;
        item.eventName = trimTemporalEvidenceValue_(candidate.eventName);
        item.entityId = trimTemporalEvidenceValue_(candidate.entityId);
        item.zone = trimTemporalEvidenceValue_(candidate.zone);
        item.frameIndex = candidate.frameIndex;
        item.frameTimestampInSegment =
            trimTemporalEvidenceValue_(candidate.frameTimestampInSegment);
        item.timestampName = trimTemporalEvidenceValue_(candidate.timestampName);
        item.timestampUtcIso = trimTemporalEvidenceValue_(candidate.timestampUtcIso);
        item.timestampLocalIso = trimTemporalEvidenceValue_(candidate.timestampLocalIso);
        item.reason = trimTemporalEvidenceValue_(candidate.reason);
        item.imageJpegBase64 = trimTemporalEvidenceValue_(candidate.imageJpegBase64);
        trail.push_back(std::move(item));
    }

    while (trail.size() > kMaxTemporalEvidenceTrailItems) {
        trail.pop_front();
    }
}

json JobRuntime::buildTemporalAlertGroupImages_(
    const TemporalEvidenceTrail& trail,
    const json& operatorResults,
    const std::vector<std::string>& fallbackEvidenceKeys,
    int cameraId,
    const std::string& cameraName)
{
    std::unordered_set<std::string> requestedEvidenceKeys;
    auto enqueueRequestedKey = [&](const std::string& rawKey) {
        const std::string key = trimTemporalEvidenceValue_(rawKey);
        if (!key.empty()) {
            requestedEvidenceKeys.insert(key);
        }
    };
    auto enqueueContributingEvents = [&](const json& contributingEvents) {
        if (!contributingEvents.is_array()) {
            return;
        }
        for (const auto& contributing : contributingEvents) {
            if (!contributing.is_object()) {
                continue;
            }
            enqueueRequestedKey(
                temporal::strField(contributing, "temporal_evidence_key"));
        }
    };

    if (operatorResults.is_array()) {
        for (const auto& result : operatorResults) {
            if (!result.is_object()) {
                continue;
            }
            const auto itContributing = result.find("contributing_events");
            if (itContributing != result.end()) {
                enqueueContributingEvents(*itContributing);
            }
            const auto itCheckpoint = result.find("latest_checkpoint");
            if (itCheckpoint != result.end() && itCheckpoint->is_object()) {
                const auto itCheckpointContributing =
                    itCheckpoint->find("contributing_events");
                if (itCheckpointContributing != itCheckpoint->end()) {
                    enqueueContributingEvents(*itCheckpointContributing);
                }
            }
        }
    }

    if (requestedEvidenceKeys.empty()) {
        for (const auto& key : fallbackEvidenceKeys) {
            enqueueRequestedKey(key);
        }
    }

    auto selectImagesForKeys =
        [&](const std::unordered_set<std::string>& selectedKeys) -> json {
        json out = json::array();
        std::unordered_set<std::string> visualKeys;
        constexpr std::size_t kMaxAlertImages = 8;
        for (const auto& item : trail) {
            const std::string evidenceKey =
                trimTemporalEvidenceValue_(item.evidenceKey);
            if (!selectedKeys.empty() &&
                selectedKeys.find(evidenceKey) == selectedKeys.end())
            {
                continue;
            }
            if (trimTemporalEvidenceValue_(item.imageJpegBase64).empty()) {
                continue;
            }

            std::string visualKey = item.timestampName;
            if (visualKey.empty() && item.frameIndex >= 0) {
                visualKey = "frame:" + std::to_string(item.frameIndex);
            }
            if (visualKey.empty()) {
                visualKey = trimTemporalEvidenceValue_(item.timestampUtcIso);
            }
            if (visualKey.empty()) {
                visualKey = evidenceKey;
            }
            if (visualKey.empty() || !visualKeys.insert(visualKey).second) {
                continue;
            }

            json entry = json::object();
            if (cameraId > 0) {
                entry["camera_id"] = cameraId;
            }
            if (!cameraName.empty()) {
                entry["camera_name"] = cameraName;
            }
            entry["image_jpeg_b64"] = item.imageJpegBase64;
            entry["temporal_evidence_key"] = evidenceKey;
            if (!item.timestampUtcIso.empty()) {
                entry["snapshot_ts_utc_iso"] = item.timestampUtcIso;
            }
            if (!item.timestampLocalIso.empty()) {
                entry["snapshot_ts_local_iso"] = item.timestampLocalIso;
            }
            if (!item.timestampName.empty()) {
                entry["timestamp_name"] = item.timestampName;
            }
            if (item.frameIndex >= 0) {
                entry["frame_index"] = item.frameIndex;
            }
            if (!item.frameTimestampInSegment.empty()) {
                entry["frame_timestamp_in_segment"] = item.frameTimestampInSegment;
            }
            if (!item.eventName.empty()) {
                entry["event"] = item.eventName;
            }
            if (!item.entityId.empty()) {
                entry["entity_id"] = item.entityId;
            }
            if (!item.zone.empty()) {
                entry["zone"] = item.zone;
            }
            if (!item.reason.empty()) {
                entry["reason"] = item.reason;
            }
            out.push_back(std::move(entry));
        }

        while (out.size() > kMaxAlertImages) {
            out.erase(out.begin());
        }
        return out;
    };

    json selectedImages = selectImagesForKeys(requestedEvidenceKeys);
    if (selectedImages.empty() && !trail.empty()) {
        std::unordered_set<std::string> fallbackKeys;
        const std::string lastEvidenceKey =
            trimTemporalEvidenceValue_(trail.back().evidenceKey);
        if (!lastEvidenceKey.empty()) {
            fallbackKeys.insert(lastEvidenceKey);
        }
        selectedImages = selectImagesForKeys(fallbackKeys);
    }
    return selectedImages;
}

std::string JobRuntime::extractFirstTemporalGroupImageB64_(const json& groupImages) {
    if (!groupImages.is_array()) {
        return std::string();
    }
    for (const auto& item : groupImages) {
        if (!item.is_object()) {
            continue;
        }
        const auto itImage = item.find("image_jpeg_b64");
        if (itImage != item.end() && itImage->is_string()) {
            const std::string value = trimTemporalEvidenceValue_(itImage->get<std::string>());
            if (!value.empty()) {
                return value;
            }
        }
        const auto itFrame = item.find("frame_jpeg_base64");
        if (itFrame != item.end() && itFrame->is_string()) {
            const std::string value = trimTemporalEvidenceValue_(itFrame->get<std::string>());
            if (!value.empty()) {
                return value;
            }
        }
    }
    return std::string();
}

static std::string normalizeVideoPackagingMode_(std::string s) {
    s = trimCopyRuntime_(std::move(s));
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    if (s == "frame_sequence" || s == "frame-sequence" || s == "full_frame" || s == "full-frame" ||
        s == "frames" || s == "high_resolution" || s == "high-resolution" || s == "high resolution") {
        return "frame_sequence";
    }
    if (s == "mosaic_2x2" || s == "mosaic-2x2" || s == "2x2" ||
        s == "standard_resolution" || s == "standard-resolution" || s == "standard resolution") {
        return "mosaic_2x2";
    }
    // Deprecated: 3x3 mosaics compress temporal/detail evidence too aggressively.
    return "frame_sequence";
}

static bool hasUsableFaceTargets_(const std::vector<JobFaceTarget>& faceTargets) {
    for (const auto& target : faceTargets) {
        for (const auto& image : target.images) {
            if (!trimCopyRuntime_(image.image_url).empty()) {
                return true;
            }
        }
    }
    return false;
}

static bool hasMeaningfulPromptText_(const std::string& text) {
    const std::string t = trimCopyRuntime_(text);
    if (t.empty()) return false;
    for (char ch : t) {
        if (std::isalnum((unsigned char)ch)) return true;
    }
    return false;
}

static bool isFaceIdOnlyMode_(
    const std::string& promptCore,
    const std::string& alertConditionText,
    const std::vector<JobFaceTarget>& faceTargets)
{
    return hasUsableFaceTargets_(faceTargets) &&
        !hasMeaningfulPromptText_(promptCore) &&
        !hasMeaningfulPromptText_(alertConditionText);
}

static std::vector<std::string> collectFaceTargetDisplayNames_(
    const std::vector<JobFaceTarget>& faceTargets)
{
    std::vector<std::string> out;
    out.reserve(faceTargets.size());
    for (const auto& target : faceTargets) {
        std::string name = trimCopyRuntime_(target.name);
        if (name.empty() && target.id > 0) {
            name = "target_" + std::to_string(target.id);
        }
        if (name.empty()) continue;
        if (std::find(out.begin(), out.end(), name) != out.end()) continue;
        out.push_back(std::move(name));
    }
    return out;
}

static std::vector<int> collectFaceTargetIds_(const std::vector<JobFaceTarget>& faceTargets)
{
    std::vector<int> out;
    out.reserve(faceTargets.size());
    for (const auto& target : faceTargets) {
        if (target.id <= 0) continue;
        if (std::find(out.begin(), out.end(), target.id) != out.end()) continue;
        out.push_back(target.id);
    }
    return out;
}

static std::vector<int> collectNegativeImageIds_(const std::vector<JobNegativeReferenceImage>& images)
{
    std::vector<int> out;
    out.reserve(images.size());
    for (const auto& image : images) {
        if (image.id <= 0) continue;
        if (std::find(out.begin(), out.end(), image.id) != out.end()) continue;
        out.push_back(image.id);
    }
    return out;
}

static JobAnalysisRegion buildDefaultAnalysisRegionForAgent_(const JobAgentDef& agent)
{
    JobAnalysisRegion region;
    region.region_id = "full-frame";
    region.label = "Full frame";
    region.enabled = true;
    region.full_frame = true;
    region.context_padding_pct = 0.0;
    region.prompt_core = agent.prompt_template;
    region.alert_condition_text = agent.alert_condition_text;
    region.negative_condition_text = agent.negative_condition_text;
    region.face_target_ids = collectFaceTargetIds_(agent.face_targets);
    region.negative_image_ids = collectNegativeImageIds_(agent.negative_reference_images);
    return region;
}

static std::vector<JobAnalysisRegion> collectEnabledAnalysisRegionsForAgent_(const JobAgentDef& agent)
{
    std::vector<JobAnalysisRegion> out;
    for (const auto& region : agent.analysis_regions) {
        if (!region.enabled) continue;
        JobAnalysisRegion normalized = region;
        if (normalized.region_id.empty()) {
            normalized.region_id = "region-" + std::to_string(out.size() + 1);
        }
        if (normalized.label.empty()) {
            normalized.label = "Region " + std::to_string(out.size() + 1);
        }
        if (!normalized.full_frame && normalized.polygon_norm.size() < 3) {
            normalized.full_frame = true;
        }
        if (normalized.full_frame) {
            normalized.polygon_norm.clear();
        }
        normalized.context_padding_pct = 0.0;
        if (trimCopyRuntime_(normalized.prompt_core).empty()) {
            normalized.prompt_core = agent.prompt_template;
        }
        if (trimCopyRuntime_(normalized.alert_condition_text).empty()) {
            normalized.alert_condition_text = agent.alert_condition_text;
        }
        if (trimCopyRuntime_(normalized.negative_condition_text).empty()) {
            normalized.negative_condition_text = agent.negative_condition_text;
        }
        if (normalized.face_target_ids.empty()) {
            normalized.face_target_ids = collectFaceTargetIds_(agent.face_targets);
        }
        if (normalized.negative_image_ids.empty()) {
            normalized.negative_image_ids = collectNegativeImageIds_(agent.negative_reference_images);
        }
        out.push_back(std::move(normalized));
    }

    if (out.empty()) {
        out.push_back(buildDefaultAnalysisRegionForAgent_(agent));
    }
    return out;
}

static analysisregion::FrameWindowNorm toSharedFrameWindow_(const JobFrameWindowNorm& frameWindow)
{
    analysisregion::FrameWindowNorm out;
    out.enabled = frameWindow.enabled;
    out.x = frameWindow.x;
    out.y = frameWindow.y;
    out.width = frameWindow.width;
    out.height = frameWindow.height;
    return out;
}

static JobFrameWindowNorm fromSharedFrameWindow_(const analysisregion::FrameWindowNorm& frameWindow)
{
    JobFrameWindowNorm out;
    out.enabled = frameWindow.enabled;
    out.x = frameWindow.x;
    out.y = frameWindow.y;
    out.width = frameWindow.width;
    out.height = frameWindow.height;
    return out;
}

static std::vector<analysisregion::PointNorm> toSharedPolygon_(
    const std::vector<JobPolygonPoint>& polygon)
{
    std::vector<analysisregion::PointNorm> out;
    out.reserve(polygon.size());
    for (const auto& point : polygon) {
        out.push_back(analysisregion::PointNorm{ point.x, point.y });
    }
    return out;
}

static std::vector<JobPolygonPoint> fromSharedPolygon_(
    const std::vector<analysisregion::PointNorm>& polygon)
{
    std::vector<JobPolygonPoint> out;
    out.reserve(polygon.size());
    for (const auto& point : polygon) {
        out.push_back(JobPolygonPoint{ point.x, point.y });
    }
    return out;
}

static analysisregion::RegionSpec toSharedRegionSpec_(const JobAnalysisRegion& region)
{
    analysisregion::RegionSpec out;
    out.regionId = region.region_id;
    out.label = region.label;
    out.enabled = region.enabled;
    out.fullFrame = region.full_frame;
    out.polygonNorm = toSharedPolygon_(region.polygon_norm);
    out.drawRefWidth = region.draw_ref_width;
    out.drawRefHeight = region.draw_ref_height;
    out.contextPaddingPct = region.context_padding_pct;
    out.frameWindowNorm = toSharedFrameWindow_(region.frame_window_norm);
    return out;
}

static std::vector<analysisregion::RegionSpec> toSharedRegionSpecs_(
    const std::vector<JobAnalysisRegion>& regions)
{
    std::vector<analysisregion::RegionSpec> out;
    out.reserve(regions.size());
    for (const auto& region : regions) {
        out.push_back(toSharedRegionSpec_(region));
    }
    return out;
}

static JobAnalysisRegion applySharedRegionSpecToJobRegion_(
    const JobAnalysisRegion& source,
    const analysisregion::RegionSpec& shared)
{
    JobAnalysisRegion out = source;
    out.region_id = shared.regionId;
    out.label = shared.label;
    out.enabled = shared.enabled;
    out.full_frame = shared.fullFrame;
    out.polygon_norm = fromSharedPolygon_(shared.polygonNorm);
    out.draw_ref_width = shared.drawRefWidth;
    out.draw_ref_height = shared.drawRefHeight;
    out.context_padding_pct = shared.contextPaddingPct;
    out.frame_window_norm = fromSharedFrameWindow_(shared.frameWindowNorm);
    return out;
}

static bool isFrameWindowActive_(const JobFrameWindowNorm& frameWindow)
{
    return analysisregion::IsFrameWindowActive(toSharedFrameWindow_(frameWindow));
}

static JobFrameWindowNorm resolveFrameWindowFromRegions_(
    const std::vector<JobAnalysisRegion>& regions)
{
    return fromSharedFrameWindow_(
        analysisregion::ResolveFrameWindow(toSharedRegionSpecs_(regions)));
}

static JobAnalysisRegion buildFrameWindowCropRegion_(
    const JobFrameWindowNorm& frameWindow)
{
    return applySharedRegionSpecToJobRegion_(
        JobAnalysisRegion{},
        analysisregion::BuildFrameWindowCropRegion(toSharedFrameWindow_(frameWindow)));
}

static std::vector<JobPolygonPoint> clipPolygonToFrameWindow_(
    const std::vector<JobPolygonPoint>& polygon,
    const JobFrameWindowNorm& frameWindow)
{
    return fromSharedPolygon_(
        analysisregion::ClipPolygonToFrameWindow(
            toSharedPolygon_(polygon),
            toSharedFrameWindow_(frameWindow)));
}

static std::vector<JobAnalysisRegion> remapRegionsToFrameWindow_(
    const std::vector<JobAnalysisRegion>& regions,
    const JobFrameWindowNorm& frameWindow)
{
    if (!isFrameWindowActive_(frameWindow)) return regions;

    const std::vector<analysisregion::RegionSpec> remapped =
        analysisregion::RemapRegionsToFrameWindow(
            toSharedRegionSpecs_(regions),
            toSharedFrameWindow_(frameWindow));

    std::unordered_map<std::string, analysisregion::RegionSpec> remappedById;
    remappedById.reserve(remapped.size());
    std::vector<analysisregion::RegionSpec> unnamedRegions;
    unnamedRegions.reserve(remapped.size());
    for (const auto& region : remapped) {
        if (!region.regionId.empty()) {
            remappedById[region.regionId] = region;
        }
        else {
            unnamedRegions.push_back(region);
        }
    }

    std::vector<JobAnalysisRegion> out;
    out.reserve(remapped.size());
    std::size_t unnamedIndex = 0;
    for (const auto& region : regions) {
        const analysisregion::RegionSpec* shared = nullptr;
        if (!region.region_id.empty()) {
            auto it = remappedById.find(region.region_id);
            if (it != remappedById.end()) {
                shared = &it->second;
            }
        }
        else if (unnamedIndex < unnamedRegions.size()) {
            shared = &unnamedRegions[unnamedIndex++];
        }

        if (!shared) {
            continue;
        }
        out.push_back(applySharedRegionSpecToJobRegion_(region, *shared));
    }
    return out;
}

static std::vector<cv::Point> regionPolygonToPixels_(
    const JobAnalysisRegion& region,
    const cv::Size& size)
{
    return analysisregion::RegionPolygonToPixels(toSharedRegionSpec_(region), size);
}

static cv::Rect computeRegionCropRect_(
    const JobAnalysisRegion& region,
    const cv::Size& imageSize)
{
    return analysisregion::ComputeRegionCropRect(toSharedRegionSpec_(region), imageSize);
}

static bool cropMatByRegion_(
    const cv::Mat& frame,
    const JobAnalysisRegion& region,
    cv::Mat& outFrame,
    std::string* outErr = nullptr)
{
    outFrame.release();
    if (frame.empty()) {
        if (outErr) *outErr = "input frame empty";
        return false;
    }

    if (region.full_frame || region.polygon_norm.size() < 3) {
        outFrame = frame.clone();
        if (outFrame.empty()) {
            if (outErr) *outErr = "frame clone failed";
            return false;
        }
        return true;
    }

    const cv::Rect cropRect = computeRegionCropRect_(region, frame.size());
    if (cropRect.width <= 0 || cropRect.height <= 0) {
        if (outErr) *outErr = "computed crop rect invalid";
        return false;
    }

    outFrame = frame(cropRect).clone();
    if (outFrame.empty()) {
        if (outErr) *outErr = "crop operation returned empty image";
        return false;
    }
    return true;
}

static bool cropMatByFrameWindow_(
    const cv::Mat& frame,
    const JobFrameWindowNorm& frameWindow,
    cv::Mat& outFrame,
    std::string* outErr = nullptr)
{
    outFrame.release();
    if (!isFrameWindowActive_(frameWindow)) {
        outFrame = frame.clone();
        if (outFrame.empty()) {
            if (outErr) *outErr = "frame clone failed";
            return false;
        }
        return true;
    }

    return cropMatByRegion_(
        frame,
        buildFrameWindowCropRegion_(frameWindow),
        outFrame,
        outErr
    );
}

static bool cropJpegDataUrlByRegion_(
    const std::string& jpegDataUrl,
    const JobAnalysisRegion& region,
    std::string& outJpegDataUrl,
    std::string* outErr = nullptr)
{
    outJpegDataUrl = jpegDataUrl;
    if (region.full_frame || region.polygon_norm.size() < 3) {
        return !outJpegDataUrl.empty();
    }

    std::vector<unsigned char> bytes;
    if (!decodeBase64ToBytes_(jpegDataUrl, bytes, outErr) || bytes.empty()) {
        if (outErr && outErr->empty()) *outErr = "jpeg base64 decode failed";
        return false;
    }

    cv::Mat encoded((int)bytes.size(), 1, CV_8UC1, bytes.data());
    cv::Mat frame = cv::imdecode(encoded, cv::IMREAD_COLOR);
    if (frame.empty()) {
        if (outErr) *outErr = "cv::imdecode failed";
        return false;
    }

    const cv::Rect cropRect = computeRegionCropRect_(region, frame.size());
    if (cropRect.width <= 0 || cropRect.height <= 0) {
        if (outErr) *outErr = "computed crop rect invalid";
        return false;
    }

    cv::Mat cropped = frame(cropRect).clone();
    if (cropped.empty()) {
        if (outErr) *outErr = "crop operation returned empty image";
        return false;
    }

    std::vector<unsigned char> outBytes;
    if (!cv::imencode(".jpg", cropped, outBytes) || outBytes.empty()) {
        if (outErr) *outErr = "cv::imencode failed";
        return false;
    }

    const std::string outB64 = base64EncodeBytes_(outBytes.data(), outBytes.size());
    if (outB64.empty()) {
        if (outErr) *outErr = "base64 encode failed";
        return false;
    }

    outJpegDataUrl = ensureDataUrlBase64_(outB64, "image/jpeg");
    return !outJpegDataUrl.empty();
}

static bool cropJpegDataUrlByFrameWindow_(
    const std::string& jpegDataUrl,
    const JobFrameWindowNorm& frameWindow,
    std::string& outJpegDataUrl,
    std::string* outErr = nullptr)
{
    outJpegDataUrl = jpegDataUrl;
    if (!isFrameWindowActive_(frameWindow)) {
        return !outJpegDataUrl.empty();
    }
    return cropJpegDataUrlByRegion_(
        jpegDataUrl,
        buildFrameWindowCropRegion_(frameWindow),
        outJpegDataUrl,
        outErr
    );
}

static bool cropVideoClipByFrameWindowWithFfmpeg_(
    const fs::path& srcClipPath,
    const JobFrameWindowNorm& frameWindow,
    fs::path& outClipPath,
    std::string* outErr)
{
    outClipPath.clear();
    if (!isFrameWindowActive_(frameWindow)) {
        outClipPath = srcClipPath;
        return true;
    }

    std::error_code ec;
    if (!fs::exists(srcClipPath, ec) || ec) {
        if (outErr) *outErr = "source clip missing: " + srcClipPath.string();
        return false;
    }

    fs::path ffmpegPath = fs::path(getExecutableDir_()) / "ffmpeg.exe";
    if (!fs::exists(ffmpegPath, ec) || ec) {
        if (outErr) *outErr = "ffmpeg missing: " + ffmpegPath.string();
        return false;
    }

    const double x1 = (std::max)(0.0, (std::min)(1.0, frameWindow.x));
    const double y1 = (std::max)(0.0, (std::min)(1.0, frameWindow.y));
    const double x2 = (std::max)(x1 + 1e-6, (std::min)(1.0, frameWindow.x + frameWindow.width));
    const double y2 = (std::max)(y1 + 1e-6, (std::min)(1.0, frameWindow.y + frameWindow.height));
    const double widthNorm = x2 - x1;
    const double heightNorm = y2 - y1;
    if (widthNorm <= 1e-6 || heightNorm <= 1e-6) {
        if (outErr) *outErr = "frame window crop rect invalid";
        return false;
    }

    auto fmt = [](double value) {
        std::ostringstream oss;
        oss << std::fixed << std::setprecision(6) << value;
        return oss.str();
    };

    const std::string widthExpr =
        "max(2,trunc(iw*" + fmt(widthNorm) + "/2)*2)";
    const std::string heightExpr =
        "max(2,trunc(ih*" + fmt(heightNorm) + "/2)*2)";
    const std::string xExpr =
        "max(0,trunc(iw*" + fmt(x1) + "/2)*2)";
    const std::string yExpr =
        "max(0,trunc(ih*" + fmt(y1) + "/2)*2)";
    const std::string cropFilter =
        "crop=w='" + widthExpr +
        "':h='" + heightExpr +
        "':x='" + xExpr +
        "':y='" + yExpr + "'";

    fs::path dstClipPath = srcClipPath;
    dstClipPath += ".frame_window.mp4";
    fs::remove(dstClipPath, ec);

    std::wstring ffmpegW = utf8ToWide(ffmpegPath.string());
    std::wstring inW = utf8ToWide(srcClipPath.string());
    std::wstring outW = utf8ToWide(dstClipPath.string());
    std::wstring filterW = utf8ToWide(cropFilter);

    std::wstring cmdLine =
        L"\"" + ffmpegW + L"\""
        L" -y -hide_banner -loglevel error"
        L" -i \"" + inW + L"\""
        L" -vf \"" + filterW + L"\""
        L" -c:v libx264 -pix_fmt yuv420p -movflags +faststart"
        L" -an "
        L" \"" + outW + L"\"";

    const int rc = runProcessAndWaitWin_(cmdLine);
    if (rc != 0) {
        if (outErr) {
            *outErr =
                "ffmpeg frame-window crop failed rc=" + std::to_string(rc) +
                " src=" + describeClipPathForLogs_(srcClipPath) +
                " filter=" + cropFilter;
        }
        return false;
    }

    if (!waitForReadableClipPath_(dstClipPath, outErr)) {
        return false;
    }

    outClipPath = std::move(dstClipPath);
    return true;
}

static bool cropVideoClipByFrameWindow_(
    const fs::path& srcClipPath,
    const JobFrameWindowNorm& frameWindow,
    fs::path& outClipPath,
    std::string* outErr = nullptr)
{
    return cropVideoClipByFrameWindowWithFfmpeg_(srcClipPath, frameWindow, outClipPath, outErr);
}

static std::vector<JobAnalysisRegion> collectPolygonOnlyRegions_(
    const std::vector<JobAnalysisRegion>& regions);

static bool decodeJpegDataUrlToMat_(
    const std::string& jpegDataUrl,
    cv::Mat& outFrame,
    std::string* outErr = nullptr)
{
    outFrame.release();
    std::vector<unsigned char> bytes;
    if (!decodeBase64ToBytes_(jpegDataUrl, bytes, outErr) || bytes.empty()) {
        if (outErr && outErr->empty()) *outErr = "jpeg base64 decode failed";
        return false;
    }

    cv::Mat encoded((int)bytes.size(), 1, CV_8UC1, bytes.data());
    outFrame = cv::imdecode(encoded, cv::IMREAD_COLOR);
    if (outFrame.empty()) {
        if (outErr) *outErr = "cv::imdecode failed";
        return false;
    }
    return true;
}

static bool extractClipBoundaryFramesFromMp4_(
    const fs::path& clipPath,
    ClipBoundaryFrames_& outFrames,
    std::string* outErr = nullptr)
{
    outFrames.firstFrame.release();
    outFrames.lastFrame.release();

    if (!extractBoundaryFrameToMatFromMp4_(clipPath, false, outFrames.firstFrame, outErr) ||
        outFrames.firstFrame.empty())
    {
        return false;
    }

    if (!extractBoundaryFrameToMatFromMp4_(clipPath, true, outFrames.lastFrame, outErr) ||
        outFrames.lastFrame.empty())
    {
        return false;
    }

    if (outFrames.lastFrame.size() != outFrames.firstFrame.size()) {
        cv::resize(outFrames.lastFrame, outFrames.lastFrame, outFrames.firstFrame.size(), 0, 0, cv::INTER_AREA);
    }

    return true;
}

static bool detectMotionInAnyRegionFromStillPair_(
    const cv::Mat& previousFrame,
    const cv::Mat& currentFrame,
    const std::vector<JobAnalysisRegion>& regions,
    bool& outMotion,
    std::vector<std::string>* outTriggeredRegionIds = nullptr,
    std::string* outErr = nullptr)
{
    outMotion = false;
    if (outTriggeredRegionIds) outTriggeredRegionIds->clear();

    const std::vector<JobAnalysisRegion> polygonRegions = collectPolygonOnlyRegions_(regions);
    if (polygonRegions.empty()) {
        outMotion = true;
        return true;
    }

    if (previousFrame.empty() || currentFrame.empty()) {
        if (outErr) *outErr = "previous/current frame empty";
        return false;
    }

    cv::Mat prev = previousFrame;
    cv::Mat cur = currentFrame;
    if (prev.size() != cur.size()) {
        cv::resize(cur, cur, prev.size(), 0, 0, cv::INTER_AREA);
    }

    cv::Mat prevGray;
    cv::Mat curGray;
    cv::cvtColor(prev, prevGray, cv::COLOR_BGR2GRAY);
    cv::cvtColor(cur, curGray, cv::COLOR_BGR2GRAY);
    cv::GaussianBlur(prevGray, prevGray, cv::Size(5, 5), 0);
    cv::GaussianBlur(curGray, curGray, cv::Size(5, 5), 0);

    cv::Mat diff;
    cv::Mat motionMask;
    cv::absdiff(curGray, prevGray, diff);
    cv::threshold(diff, motionMask, 18, 255, cv::THRESH_BINARY);
    cv::erode(motionMask, motionMask, cv::Mat(), cv::Point(-1, -1), 1);
    cv::dilate(motionMask, motionMask, cv::Mat(), cv::Point(-1, -1), 1);

    for (const auto& region : polygonRegions) {
        cv::Mat roiMask(motionMask.size(), CV_8U, cv::Scalar(0));
        const auto polygon = regionPolygonToPixels_(region, motionMask.size());
        if (polygon.size() < 3) continue;
        std::vector<std::vector<cv::Point>> polygons{ polygon };
        cv::fillPoly(roiMask, polygons, cv::Scalar(255));

        cv::Mat roiMotion;
        cv::bitwise_and(motionMask, roiMask, roiMotion);
        const int changed = cv::countNonZero(roiMotion);
        const int area = std::max(1, cv::countNonZero(roiMask));
        const int minChanged = std::max(20, (int)std::llround((double)area * 0.01));
        if (changed >= minChanged) {
            outMotion = true;
            if (outTriggeredRegionIds) {
                outTriggeredRegionIds->push_back(region.region_id);
            }
        }
    }
    return true;
}

static bool detectMotionInAnyRegionFromBoundaryFrames_(
    const ClipBoundaryFrames_& boundaryFrames,
    const std::vector<JobAnalysisRegion>& regions,
    bool& outMotion,
    std::vector<std::string>* outTriggeredRegionIds = nullptr,
    std::string* outErr = nullptr)
{
    return detectMotionInAnyRegionFromStillPair_(
        boundaryFrames.firstFrame,
        boundaryFrames.lastFrame,
        regions,
        outMotion,
        outTriggeredRegionIds,
        outErr
    );
}

static bool detectMotionInAnyRegionFromStillHistory_(
    const std::string& slotKey,
    const cv::Mat& currentFrame,
    const std::vector<JobAnalysisRegion>& regions,
    bool& outMotion,
    std::vector<std::string>* outTriggeredRegionIds = nullptr,
    std::string* outErr = nullptr)
{
    outMotion = false;
    if (outTriggeredRegionIds) outTriggeredRegionIds->clear();

    if (slotKey.empty()) {
        if (outErr) *outErr = "empty still-motion slot key";
        return false;
    }

    const std::vector<JobAnalysisRegion> polygonRegions = collectPolygonOnlyRegions_(regions);
    if (polygonRegions.empty()) {
        outMotion = true;
        return true;
    }

    cv::Mat previousFrame;
    {
        static std::mutex motionHistoryMu;
        static std::unordered_map<std::string, cv::Mat> previousBySlot;
        std::lock_guard<std::mutex> lk(motionHistoryMu);

        auto it = previousBySlot.find(slotKey);
        if (it != previousBySlot.end() && !it->second.empty()) {
            previousFrame = it->second.clone();
        }
        previousBySlot[slotKey] = currentFrame.clone();
        if (previousBySlot.size() > 5000) {
            previousBySlot.clear();
            previousBySlot[slotKey] = currentFrame.clone();
        }
    }

    if (previousFrame.empty()) {
        if (outErr) *outErr = "still motion baseline not available yet";
        return true;
    }

    return detectMotionInAnyRegionFromStillPair_(
        previousFrame,
        currentFrame,
        polygonRegions,
        outMotion,
        outTriggeredRegionIds,
        outErr
    );
}

static std::vector<JobAnalysisRegion> collectPolygonOnlyRegions_(
    const std::vector<JobAnalysisRegion>& regions)
{
    std::vector<JobAnalysisRegion> out;
    out.reserve(regions.size());
    for (const auto& region : regions) {
        if (region.full_frame) continue;
        if (region.polygon_norm.size() < 3) continue;
        out.push_back(region);
    }
    return out;
}

static JobAnalysisRegion buildSyntheticFullFrameMotionRegion_()
{
    JobAnalysisRegion region;
    region.region_id = "full-frame-motion-gate";
    region.label = "Full frame motion gate";
    region.enabled = true;
    region.full_frame = false;
    region.polygon_norm = {
        JobPolygonPoint{ 0.0, 0.0 },
        JobPolygonPoint{ 1.0, 0.0 },
        JobPolygonPoint{ 1.0, 1.0 },
        JobPolygonPoint{ 0.0, 1.0 }
    };
    return region;
}

static bool detectMotionInAnyRegionFromClip_(
    const fs::path& clipPath,
    const std::vector<JobAnalysisRegion>& regions,
    bool& outMotion,
    std::vector<std::string>* outTriggeredRegionIds = nullptr,
    std::string* outErr = nullptr)
{
    if (outTriggeredRegionIds) outTriggeredRegionIds->clear();

    const std::vector<JobAnalysisRegion> polygonRegions = collectPolygonOnlyRegions_(regions);
    if (polygonRegions.empty()) {
        outMotion = true;
        return true;
    }

    ClipBoundaryFrames_ boundaryFrames;
    if (!extractClipBoundaryFramesFromMp4_(clipPath, boundaryFrames, outErr)) {
        return false;
    }

    return detectMotionInAnyRegionFromBoundaryFrames_(
        boundaryFrames,
        polygonRegions,
        outMotion,
        outTriggeredRegionIds,
        outErr
    );
}

static cv::Scalar regionOverlayColorByIndex_(std::size_t index)
{
    return analysisregion::OverlayColorForIndex(index);
}

static int drawAnalysisRegionOverlaysOnFrame_(
    cv::Mat& frame,
    const std::vector<JobAnalysisRegion>& regions,
    std::vector<std::string>* outDrawnRegionIds = nullptr)
{
    return analysisregion::DrawRegionsOnFrame(
        frame,
        toSharedRegionSpecs_(regions),
        outDrawnRegionIds);
}

static bool annotateJpegDataUrlWithRegions_(
    const std::string& jpegDataUrl,
    const std::vector<JobAnalysisRegion>& regions,
    std::string& outJpegDataUrl,
    std::vector<std::string>* outDrawnRegionIds = nullptr,
    std::string* outErr = nullptr)
{
    outJpegDataUrl = jpegDataUrl;
    if (outDrawnRegionIds) outDrawnRegionIds->clear();

    const std::vector<JobAnalysisRegion> polygonRegions = collectPolygonOnlyRegions_(regions);
    if (polygonRegions.empty()) {
        return !outJpegDataUrl.empty();
    }

    std::vector<unsigned char> bytes;
    if (!decodeBase64ToBytes_(jpegDataUrl, bytes, outErr) || bytes.empty()) {
        if (outErr && outErr->empty()) *outErr = "jpeg base64 decode failed";
        return false;
    }

    cv::Mat encoded((int)bytes.size(), 1, CV_8UC1, bytes.data());
    cv::Mat frame = cv::imdecode(encoded, cv::IMREAD_COLOR);
    if (frame.empty()) {
        if (outErr) *outErr = "cv::imdecode failed";
        return false;
    }

    const int drawn = drawAnalysisRegionOverlaysOnFrame_(frame, polygonRegions, outDrawnRegionIds);
    if (drawn <= 0) {
        return !outJpegDataUrl.empty();
    }

    std::vector<unsigned char> outBytes;
    if (!cv::imencode(".jpg", frame, outBytes) || outBytes.empty()) {
        if (outErr) *outErr = "cv::imencode failed";
        return false;
    }

    const std::string outB64 = base64EncodeBytes_(outBytes.data(), outBytes.size());
    if (outB64.empty()) {
        if (outErr) *outErr = "base64 encode failed";
        return false;
    }

    outJpegDataUrl = ensureDataUrlBase64_(outB64, "image/jpeg");
    return !outJpegDataUrl.empty();
}

static bool annotateVideoClipWithRegions_(
    const fs::path& srcClipPath,
    const std::vector<JobAnalysisRegion>& regions,
    fs::path& outClipPath,
    std::vector<std::string>* outDrawnRegionIds = nullptr,
    std::string* outErr = nullptr)
{
    return analysisregion::AnnotateVideoClipWithOverlay(
        srcClipPath,
        toSharedRegionSpecs_(regions),
        outClipPath,
        outDrawnRegionIds,
        outErr);
}

static std::vector<std::string> parseFaceIdTargetNamesFromJsonNode_(
    const json& node)
{
    std::vector<std::string> out;
    if (!node.is_object()) return out;

    auto appendUnique = [&](const std::string& raw) {
        const std::string v = trimCopyRuntime_(raw);
        if (v.empty()) return;
        if (std::find(out.begin(), out.end(), v) != out.end()) return;
        out.push_back(v);
    };

    auto consume = [&](const char* key) {
        if (!node.contains(key)) return;
        const auto& field = node[key];
        if (field.is_string()) {
            appendUnique(field.get<std::string>());
            return;
        }
        if (field.is_array()) {
            for (const auto& item : field) {
                if (!item.is_string()) continue;
                appendUnique(item.get<std::string>());
            }
        }
    };

    consume("faceid_target_names");
    consume("matched_target_names");
    consume("matched_target_name");
    consume("target_names");
    return out;
}

static std::vector<std::string> parseAlertRegionIdsFromJsonNode_(
    const json& node)
{
    std::vector<std::string> out;
    if (!node.is_object()) return out;

    auto appendUnique = [&](const std::string& raw) {
        const std::string v = trimCopyRuntime_(raw);
        if (v.empty()) return;
        if (std::find(out.begin(), out.end(), v) != out.end()) return;
        out.push_back(v);
    };

    auto consume = [&](const char* key) {
        if (!node.contains(key)) return;
        const auto& field = node[key];
        if (field.is_string()) {
            appendUnique(field.get<std::string>());
            return;
        }
        if (field.is_number_integer()) {
            appendUnique(std::to_string(field.get<int>()));
            return;
        }
        if (field.is_array()) {
            for (const auto& item : field) {
                if (item.is_string()) {
                    appendUnique(item.get<std::string>());
                }
                else if (item.is_number_integer()) {
                    appendUnique(std::to_string(item.get<int>()));
                }
            }
        }
    };

    consume("alert_region_ids");
    consume("alert_region_id");
    consume("region_ids");
    consume("region_id");
    return out;
}

static std::unordered_map<std::string, std::string> buildRegionLabelByIdMap_(
    const std::vector<JobAnalysisRegion>& regions)
{
    std::unordered_map<std::string, std::string> out;
    out.reserve(regions.size());
    for (const auto& region : regions) {
        const std::string id = trimCopyRuntime_(region.region_id);
        if (id.empty()) continue;
        std::string label = trimCopyRuntime_(region.label);
        if (label.empty()) label = id;
        out[id] = std::move(label);
    }
    return out;
}

static void appendTemporalZoneAlias_(
    json& aliases,
    std::unordered_set<std::string>& seenAliases,
    const std::string& rawValue)
{
    const std::string trimmedValue = trimCopyRuntime_(rawValue);
    if (trimmedValue.empty()) return;

    if (seenAliases.insert(trimmedValue).second) {
        aliases.push_back(trimmedValue);
    }

    const std::string loweredValue = temporal::lower(trimmedValue);
    if (!loweredValue.empty() && seenAliases.insert(loweredValue).second) {
        aliases.push_back(loweredValue);
    }

    const std::string canonicalValue = temporal::canonicalZoneKey(trimmedValue);
    if (!canonicalValue.empty() && seenAliases.insert(canonicalValue).second) {
        aliases.push_back(canonicalValue);
    }
}

static json buildTemporalZoneCatalogFromRegions_(
    const std::vector<JobAnalysisRegion>& regions)
{
    json out = json::array();
    std::unordered_set<std::string> seenCanonicalKeys;
    for (const auto& region : regions) {
        if (region.full_frame && region.polygon_norm.empty()) continue;

        const std::string regionId = trimCopyRuntime_(region.region_id);
        const std::string label = trimCopyRuntime_(region.label);
        std::string canonicalZoneKey =
            temporal::canonicalZoneKey(label.empty() ? regionId : label);
        if (canonicalZoneKey.empty()) {
            canonicalZoneKey = temporal::canonicalZoneKey(regionId);
        }
        if (canonicalZoneKey.empty()) continue;
        if (!seenCanonicalKeys.insert(canonicalZoneKey).second) continue;

        json aliases = json::array();
        std::unordered_set<std::string> seenAliases;
        appendTemporalZoneAlias_(aliases, seenAliases, canonicalZoneKey);
        appendTemporalZoneAlias_(aliases, seenAliases, regionId);
        appendTemporalZoneAlias_(aliases, seenAliases, label);

        json row = {
            {"canonical_zone_key", canonicalZoneKey},
            {"aliases", aliases}
        };
        if (!regionId.empty()) row["region_id"] = regionId;
        if (!label.empty()) row["label"] = label;
        out.push_back(std::move(row));
    }
    return out;
}

static void attachTemporalZoneCatalog_(
    json& planEnvelope,
    const std::vector<JobAnalysisRegion>& regions)
{
    if (!planEnvelope.is_object()) return;
    const json zoneCatalog = buildTemporalZoneCatalogFromRegions_(regions);
    if (zoneCatalog.is_array() && !zoneCatalog.empty()) {
        planEnvelope["zone_catalog"] = zoneCatalog;
    }
    else if (planEnvelope.contains("zone_catalog")) {
        planEnvelope.erase("zone_catalog");
    }
}

static std::string resolveAlertAnswerText_(
    const std::string& rawAnswer,
    const std::string& temporalDecisionSummary,
    const std::string& decisionSource)
{
    const std::string answer = trimCopyRuntime_(rawAnswer);
    const std::string summary = trimCopyRuntime_(temporalDecisionSummary);
    const std::string source = trimCopyRuntime_(decisionSource);
    if ((source == "temporal_engine" || source == "temporal_engine_cross_camera") && !summary.empty()) {
        return summary;
    }
    if (!answer.empty()) return answer;
    return summary;
}

static std::vector<std::string> sanitizeAlertRegionIds_(
    const std::vector<std::string>& rawIds,
    const std::unordered_map<std::string, std::string>& allowedRegionLabelById,
    std::vector<std::string>* outRejectedIds = nullptr)
{
    if (outRejectedIds) outRejectedIds->clear();
    std::vector<std::string> out;
    out.reserve(rawIds.size());
    for (const auto& rawId : rawIds) {
        const std::string id = trimCopyRuntime_(rawId);
        if (id.empty()) continue;
        if (allowedRegionLabelById.find(id) == allowedRegionLabelById.end()) {
            if (outRejectedIds) {
                outRejectedIds->push_back(id);
            }
            continue;
        }
        if (std::find(out.begin(), out.end(), id) != out.end()) continue;
        out.push_back(id);
    }
    return out;
}

static std::vector<std::string> mapRegionIdsToNames_(
    const std::vector<std::string>& regionIds,
    const std::unordered_map<std::string, std::string>& labelById)
{
    std::vector<std::string> out;
    out.reserve(regionIds.size());
    for (const auto& id : regionIds) {
        auto it = labelById.find(id);
        if (it == labelById.end()) continue;
        if (std::find(out.begin(), out.end(), it->second) != out.end()) continue;
        out.push_back(it->second);
    }
    return out;
}

static bool allExpectedCameraIdsAlertTrueFromGroupResult_(
    const std::string& rawGroupResult,
    const std::vector<int>& expectedCameraIds)
{
    if (expectedCameraIds.empty()) return false;
    if (rawGroupResult.empty()) return false;

    json parsed = json::parse(rawGroupResult, nullptr, false);
    if (!parsed.is_object()) return false;
    if (!parsed.contains("results") || !parsed["results"].is_array()) return false;

    std::unordered_set<int> expected(expectedCameraIds.begin(), expectedCameraIds.end());
    std::unordered_set<int> alerted;

    for (const auto& item : parsed["results"]) {
        if (!item.is_object()) continue;
        if (!item.contains("camera_id") || !item["camera_id"].is_number_integer()) continue;

        const int camId = item["camera_id"].get<int>();
        if (!expected.count(camId)) continue;

        const bool alert = item.value("alert_condition", false);
        if (alert) {
            alerted.insert(camId);
        }
    }

    return alerted.size() == expected.size();
}

static std::string buildFaceIdOnlyShortAnswer_(
    bool faceMatch,
    const std::vector<std::string>& names)
{
    if (!faceMatch) {
        return "FaceID no match";
    }
    if (names.empty()) {
        return "FaceID match";
    }

    std::ostringstream oss;
    oss << "FaceID match: ";
    for (size_t i = 0; i < names.size(); ++i) {
        if (i > 0) oss << ", ";
        oss << names[i];
        if (i >= 2 && names.size() > 3) {
            oss << " +" << (names.size() - (i + 1));
            break;
        }
    }
    return oss.str();
}

struct LocalAlertNormalization_ {
    bool alertCondition = false;
    std::string reason;
};

static LocalAlertNormalization_ normalizeConflictingLocalAlert_(
    bool rawAlertCondition,
    const std::string& alertConditionText,
    const VideoHit& hit)
{
    LocalAlertNormalization_ normalized{ rawAlertCondition, std::string() };
    if (!rawAlertCondition || hit.faceIdMatch) {
        return normalized;
    }

    const bool threatPrompt =
        temporal::looksLikeThreatEvidencePrompt(alertConditionText) ||
        temporal::looksLikeThreatEvidencePrompt(hit.answer);
    if (!threatPrompt) {
        return normalized;
    }

    const bool explicitNegativeCurrentBatch =
        temporal::textSuggestsNoVisiblePerson(hit.answer) ||
        temporal::textSuggestsNoVisibleTarget(hit.answer) ||
        temporal::textSuggestsInactionableVisibility(hit.answer) ||
        temporal::nodeSuggestsNoVisiblePerson(hit.identityPatch) ||
        temporal::nodeSuggestsNoVisibleTarget(hit.identityPatch) ||
        temporal::nodeSuggestsInactionableVisibility(hit.identityPatch) ||
        temporal::nodeSuggestsNoVisiblePerson(hit.observations) ||
        temporal::nodeSuggestsNoVisibleTarget(hit.observations) ||
        temporal::nodeSuggestsInactionableVisibility(hit.observations) ||
        temporal::nodeSuggestsNoVisiblePerson(hit.unknownReasons) ||
        temporal::nodeSuggestsNoVisibleTarget(hit.unknownReasons) ||
        temporal::nodeSuggestsInactionableVisibility(hit.unknownReasons);
    if (!explicitNegativeCurrentBatch) {
        return normalized;
    }

    if (temporal::currentBatchHasEntityEvidence(hit.identityPatch, hit.observations)) {
        return normalized;
    }

    normalized.alertCondition = false;
    normalized.reason = "negative_current_batch_without_entity_evidence";
    return normalized;
}

static std::string buildHiddenFaceIdPrompt_(const std::vector<JobFaceTarget>& faceTargets) {
    if (!hasUsableFaceTargets_(faceTargets)) {
        return "";
    }

    std::ostringstream oss;
    oss << "HIDDEN FACEID TASK (SYSTEM):\n";
    oss << "- In addition to normal analysis, you MUST perform identity search using USER_REFERENCE_IMAGE inputs.\n";
    oss << "- Each USER_REFERENCE_IMAGE may contain TARGET_ID and TARGET_NAME metadata.\n";
    oss << "- Compare conservatively against visible faces (angle/light can vary; identity must remain highly consistent).\n";
    oss << "- If any target identity is confidently present, set `faceid_match=true`.\n";
    oss << "- If faceid_match=true, set `alert_condition=true` even if regular alert text is ambiguous.\n";
    oss << "- If faceid_match=true, include `faceid_target_names` as an array with matched TARGET_NAME values.\n";
    oss << "- If no confident identity match, keep `faceid_match=false`.\n";
    oss << "- If no confident identity match, return `faceid_target_names` as an empty array.\n";
    oss << "- In FaceID-only mode (no prompt core and no alert condition), keep `answer` extremely short.\n";
    oss << "- In FaceID-only mode, preferred answer format is: \"FaceID match: <name>\" or \"FaceID no match\".\n";
    oss << "- Never claim a positive match when face visibility is poor or uncertain.\n";
    return oss.str();
}

static std::string buildHiddenNegativeReferencePrompt_(
    const std::vector<JobNegativeReferenceImage>& negativeReferenceImages)
{
    if (negativeReferenceImages.empty()) {
        return "";
    }

    std::ostringstream oss;
    oss << "HIDDEN NEGATIVE VISUAL REFERENCES TASK (SYSTEM):\n";
    oss << "- You may receive one or more NEGATIVE_REFERENCE_IMAGE inputs.\n";
    oss << "- These are examples of visual conditions that SHOULD NOT trigger an alert.\n";
    oss << "- Compare current scene against these references conservatively.\n";
    oss << "- If current scene strongly matches any negative reference, keep `alert_condition=false` unless a severe explicit alert condition is undeniably present.\n";
    oss << "- Mention in `answer` that the scene matches a configured negative condition when relevant.\n";
    return oss.str();
}

static bool nextUtf8CodepointForLanguageHint_(
    const std::string& text,
    std::size_t& index,
    std::uint32_t& outCodepoint)
{
    if (index >= text.size()) {
        return false;
    }

    const unsigned char first = static_cast<unsigned char>(text[index++]);
    if ((first & 0x80u) == 0u) {
        outCodepoint = static_cast<std::uint32_t>(first);
        return true;
    }

    int continuationCount = 0;
    std::uint32_t codepoint = 0;
    if ((first & 0xE0u) == 0xC0u) {
        continuationCount = 1;
        codepoint = static_cast<std::uint32_t>(first & 0x1Fu);
    }
    else if ((first & 0xF0u) == 0xE0u) {
        continuationCount = 2;
        codepoint = static_cast<std::uint32_t>(first & 0x0Fu);
    }
    else if ((first & 0xF8u) == 0xF0u) {
        continuationCount = 3;
        codepoint = static_cast<std::uint32_t>(first & 0x07u);
    }
    else {
        outCodepoint = static_cast<std::uint32_t>(' ');
        return true;
    }

    if (index + static_cast<std::size_t>(continuationCount) > text.size()) {
        index = text.size();
        outCodepoint = static_cast<std::uint32_t>(' ');
        return true;
    }

    for (int i = 0; i < continuationCount; ++i) {
        const unsigned char next = static_cast<unsigned char>(text[index++]);
        if ((next & 0xC0u) != 0x80u) {
            outCodepoint = static_cast<std::uint32_t>(' ');
            return true;
        }
        codepoint = (codepoint << 6) | static_cast<std::uint32_t>(next & 0x3Fu);
    }

    outCodepoint = codepoint;
    return true;
}

static std::string normalizePromptSampleForLanguageHint_(const std::string& text,
                                                         bool* outHasArabic = nullptr,
                                                         bool* outHasCjk = nullptr)
{
    bool hasArabic = false;
    bool hasCjk = false;
    std::string normalized;
    normalized.reserve(text.size());

    std::size_t index = 0;
    while (index < text.size()) {
        std::uint32_t codepoint = 0;
        if (!nextUtf8CodepointForLanguageHint_(text, index, codepoint)) {
            break;
        }

        if ((codepoint >= 0x0600u && codepoint <= 0x06FFu) ||
            (codepoint >= 0x0750u && codepoint <= 0x077Fu) ||
            (codepoint >= 0x08A0u && codepoint <= 0x08FFu))
        {
            hasArabic = true;
        }
        if ((codepoint >= 0x3400u && codepoint <= 0x4DBFu) ||
            (codepoint >= 0x4E00u && codepoint <= 0x9FFFu) ||
            (codepoint >= 0xF900u && codepoint <= 0xFAFFu))
        {
            hasCjk = true;
        }

        if (codepoint < 128u && std::isalpha(static_cast<unsigned char>(codepoint))) {
            normalized.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(codepoint))));
        }
        else {
            normalized.push_back(' ');
        }
    }

    if (outHasArabic) *outHasArabic = hasArabic;
    if (outHasCjk) *outHasCjk = hasCjk;
    return normalized;
}

static int countWholeWordHitsForLanguageHint_(const std::string& normalizedText,
                                              const char* const* words,
                                              std::size_t wordCount)
{
    if (normalizedText.empty() || words == nullptr || wordCount == 0) {
        return 0;
    }

    const std::string padded = " " + normalizedText + " ";
    int score = 0;
    for (std::size_t i = 0; i < wordCount; ++i) {
        const std::string word = words[i] ? words[i] : "";
        if (word.empty()) continue;
        const std::string needle = " " + word + " ";
        std::size_t pos = 0;
        while ((pos = padded.find(needle, pos)) != std::string::npos) {
            score += word.size() >= 7 ? 3 : (word.size() >= 4 ? 2 : 1);
            pos += needle.size() - 1;
        }
    }
    return score;
}

static std::string detectTaskLanguageTag_(
    const std::string& promptCore,
    const std::string& alertConditionText,
    const std::string& negativeConditionText,
    const std::string& injectedInput)
{
    std::string sample;
    auto appendSample = [&](const std::string& rawValue, int weight = 1) {
        if (weight <= 0) return;
        const std::string trimmed = trimCopyRuntime_(rawValue);
        if (trimmed.empty()) return;
        for (int i = 0; i < weight; ++i) {
            if (!sample.empty()) sample.push_back('\n');
            sample += trimmed;
        }
    };
    appendSample(promptCore, 2);
    appendSample(alertConditionText);
    appendSample(negativeConditionText);
    appendSample(injectedInput);
    if (sample.empty()) return "";

    bool hasArabic = false;
    bool hasCjk = false;
    const std::string normalized =
        normalizePromptSampleForLanguageHint_(sample, &hasArabic, &hasCjk);
    if (hasArabic) return "ar";
    if (hasCjk) return "zh";
    if (normalized.empty()) return "";

    static const char* const kEnglishWords[] = {
        "the", "with", "without", "should", "must", "when", "inside",
        "person", "people", "customer", "item", "items", "bag", "purse",
        "clothes", "their", "own", "clear", "visible", "alert", "camera",
        "scene", "snapshot", "monitoring", "walking", "standing",
        "child", "adult", "pool"
    };
    static const char* const kSpanishWords[] = {
        "el", "los", "las", "con", "sin", "debe", "cuando", "dentro",
        "persona", "personas", "cliente", "articulo", "articulos", "bolsa",
        "cartera", "ropa", "propia", "claro", "visible", "alerta", "camara",
        "escena", "ningun", "ninguna", "cerca", "borde", "piscina",
        "adulto", "adultos", "activar", "patio", "joven"
    };
    static const char* const kPortugueseWords[] = {
        "com", "sem", "deve", "quando", "dentro", "pessoa", "pessoas",
        "cliente", "item", "itens", "bolsa", "carteira", "roupa", "propria",
        "claro", "visivel", "alerta", "camera", "cena", "nenhum", "nenhuma",
        "perto", "borda", "piscina", "adulto", "adultos", "acionar",
        "quintal", "jovem"
    };
    static const char* const kFrenchWords[] = {
        "aucun", "aucune", "proche", "bord", "scene", "alerte",
        "piscine", "adulte", "adultes", "doit", "camera", "visible",
        "jeune", "surveiller"
    };

    const int englishScore =
        countWholeWordHitsForLanguageHint_(normalized, kEnglishWords, std::size(kEnglishWords));
    const int spanishScore =
        countWholeWordHitsForLanguageHint_(normalized, kSpanishWords, std::size(kSpanishWords));
    const int portugueseScore =
        countWholeWordHitsForLanguageHint_(normalized, kPortugueseWords, std::size(kPortugueseWords));
    const int frenchScore =
        countWholeWordHitsForLanguageHint_(normalized, kFrenchWords, std::size(kFrenchWords));

    struct Candidate {
        const char* tag;
        int score;
    };
    const Candidate candidates[] = {
        { "en", englishScore },
        { "es", spanishScore },
        { "pt", portugueseScore },
        { "fr", frenchScore }
    };

    std::string bestTag;
    int bestScore = 0;
    int secondBestScore = 0;
    for (const auto& candidate : candidates) {
        if (candidate.score > bestScore) {
            secondBestScore = bestScore;
            bestScore = candidate.score;
            bestTag = candidate.tag;
        }
        else if (candidate.score > secondBestScore) {
            secondBestScore = candidate.score;
        }
    }

    if (bestScore < 3) {
        return "";
    }
    if (bestScore == secondBestScore) {
        return "";
    }
    return bestTag;
}

static const char* displayNameForTaskLanguageTag_(const std::string& languageTag)
{
    if (languageTag == "pt") return "Portuguese";
    if (languageTag == "es") return "Spanish";
    if (languageTag == "fr") return "French";
    if (languageTag == "ar") return "Arabic";
    if (languageTag == "zh") return "Chinese";
    if (languageTag == "en") return "English";
    return "";
}

static std::string buildTaskLanguageHintPrompt_(
    const std::string& promptCore,
    const std::string& alertConditionText,
    const std::string& negativeConditionText,
    const std::string& injectedInput)
{
    const std::string languageTag =
        detectTaskLanguageTag_(
            promptCore,
            alertConditionText,
            negativeConditionText,
            injectedInput
        );
    if (languageTag.empty()) {
        return "";
    }

    const char* languageName = displayNameForTaskLanguageTag_(languageTag);
    if (languageName == nullptr || *languageName == '\0') {
        return "";
    }

    std::ostringstream oss;
    oss << "TASK LANGUAGE HINT (SYSTEM):\n";
    oss << "- Detected primary language of TASK TEXT: "
        << languageName << " (" << languageTag << ").\n";
    oss << "- Write `answer` in " << languageName << ".\n";
    oss << "- Do not switch languages unless TASK TEXT explicitly asks for translation or quoted output in another language.\n";
    return oss.str();
}

static std::string buildInferencePrompt_(
    const std::string& promptCore,
    const std::string& alertConditionText,
    const std::string& negativeConditionText,
    const std::string& injectedInput,
    const std::vector<JobFaceTarget>& faceTargets,
    const std::vector<JobNegativeReferenceImage>& negativeReferenceImages
) {
    std::string finalPrompt = trimCopyRuntime_(promptCore);
    const std::string negative = trimCopyRuntime_(negativeConditionText);
    const std::string taskLanguageHint = buildTaskLanguageHintPrompt_(
        promptCore,
        alertConditionText,
        negativeConditionText,
        injectedInput
    );
    const std::string hiddenFacePrompt = buildHiddenFaceIdPrompt_(faceTargets);
    const std::string hiddenNegativeRefPrompt = buildHiddenNegativeReferencePrompt_(
        negativeReferenceImages
    );

    if (!taskLanguageHint.empty()) {
        if (!finalPrompt.empty()) finalPrompt = taskLanguageHint + "\n\n" + finalPrompt;
        else finalPrompt = taskLanguageHint;
    }

    if (!negative.empty()) {
        if (!finalPrompt.empty()) finalPrompt += "\n\n";
        finalPrompt += "NEGATIVE CONDITION (when this is true, keep alert_condition as false):\n";
        finalPrompt += negative;
    }

    if (!hiddenFacePrompt.empty()) {
        if (!finalPrompt.empty()) finalPrompt += "\n\n";
        finalPrompt += hiddenFacePrompt;
    }

    if (!hiddenNegativeRefPrompt.empty()) {
        if (!finalPrompt.empty()) finalPrompt += "\n\n";
        finalPrompt += hiddenNegativeRefPrompt;
    }

    if (!injectedInput.empty() && injectedInput != "__MISSING_INPUT__") {
        if (!finalPrompt.empty()) finalPrompt += "\n\n";
        finalPrompt += "INPUT_FROM_PREVIOUS_STEP:\n" + injectedInput + "\n";
    }

    return finalPrompt;
}

static std::string makeMonotonicClipKey_(const fs::path& clipPath) {
    std::string tsUtcIso;
    if (parseClipEndTsUtcIsoFromPath_(clipPath, tsUtcIso) && !tsUtcIso.empty()) {
        return tsUtcIso;
    }
    return clipPath.filename().string();
}

static std::mutex gLastConsumedClipKeyMu_;
static std::unordered_map<std::string, std::string> gLastConsumedClipKeyBySlot_;

static std::string getLastConsumedClipKeyForJobStepCamera_(
    int jobId,
    int stepId,
    int cameraId)
{
    const std::string slot =
        std::to_string(jobId) + "|" +
        std::to_string(stepId) + "|" +
        std::to_string(cameraId);

    std::lock_guard<std::mutex> lk(gLastConsumedClipKeyMu_);
    auto it = gLastConsumedClipKeyBySlot_.find(slot);
    return it == gLastConsumedClipKeyBySlot_.end() ? std::string() : it->second;
}

static std::string makeMonotonicImageKey_(const fs::path& imagePath) {
    return imagePath.filename().string();
}

static bool isNewerClipForJobStepCamera_(
    int jobId,
    int stepId,
    int cameraId,
    const std::string& clipKey)
{
    if (clipKey.empty()) return true;

    const std::string slot =
        std::to_string(jobId) + "|" +
        std::to_string(stepId) + "|" +
        std::to_string(cameraId);

    std::lock_guard<std::mutex> lk(gLastConsumedClipKeyMu_);
    auto it = gLastConsumedClipKeyBySlot_.find(slot);
    if (it == gLastConsumedClipKeyBySlot_.end()) return true;
    return clipKey > it->second;
}

static void markClipConsumedForJobStepCamera_(
    int jobId,
    int stepId,
    int cameraId,
    const std::string& clipKey)
{
    if (clipKey.empty()) return;

    const std::string slot =
        std::to_string(jobId) + "|" +
        std::to_string(stepId) + "|" +
        std::to_string(cameraId);

    std::lock_guard<std::mutex> lk(gLastConsumedClipKeyMu_);
    auto it = gLastConsumedClipKeyBySlot_.find(slot);
    if (it == gLastConsumedClipKeyBySlot_.end() || clipKey > it->second) {
        gLastConsumedClipKeyBySlot_[slot] = clipKey;
    }
}

static std::optional<std::string> getNextReadyJobsClipForCamera_(
    int jobId,
    int stepId,
    int cameraId)
{
    try {
        const fs::path dir =
            getJobsTempDirForJobStepCamera(jobId, stepId, std::to_string(cameraId));

        std::error_code ec;
        if (!fs::exists(dir, ec) || !fs::is_directory(dir, ec)) {
            return std::nullopt;
        }

        const std::string lastConsumedKey =
            getLastConsumedClipKeyForJobStepCamera_(jobId, stepId, cameraId);
        const bool hasCursor = !lastConsumedKey.empty();

        bool found = false;
        std::string bestClipKey;
        fs::path bestPath;
        fs::file_time_type bestTime{};

        for (const auto& entry : fs::directory_iterator(dir, ec)) {
            if (ec) break;
            if (!entry.is_regular_file(ec)) {
                if (ec) break;
                continue;
            }
            if (entry.path().extension() != ".mp4") continue;

            const std::string clipKey = makeMonotonicClipKey_(entry.path());
            if (clipKey.empty()) continue;
            if (hasCursor && clipKey <= lastConsumedKey) {
                continue;
            }

            const auto lastWrite = entry.last_write_time(ec);
            if (ec) break;

            if (!found ||
                clipKey < bestClipKey ||
                (clipKey == bestClipKey && lastWrite < bestTime) ||
                (clipKey == bestClipKey &&
                 lastWrite == bestTime &&
                 entry.path().string() < bestPath.string()))
            {
                found = true;
                bestClipKey = clipKey;
                bestPath = entry.path();
                bestTime = lastWrite;
            }
        }

        if (ec || !found) {
            return std::nullopt;
        }
        return bestPath.string();
    }
    catch (...) {
        return std::nullopt;
    }
}

static int normalizedRunEverySecondsForJobAgent_(const JobAgentDef& agent)
{
    const std::string inferenceModel = normalizeInferenceModel_(agent.inference_model);
    return isCoreInferenceModel_(inferenceModel)
        ? 60
        : normalizeRunEverySeconds_(agent.run_every_seconds);
}

static bool isPortalCounterBackend_(const JobAgentDef& agent)
{
    return agent.execution_backend == "opencv_portal_counter";
}

static int portalCounterCaptureFps_()
{
    return 10;
}

static const JobAnalysisRegion* findPortalCounterRegion_(const JobAgentDef& agent)
{
    if (agent.portal_counter_config.region_id.empty()) return nullptr;
    for (const auto& region : agent.analysis_regions) {
        if (region.region_id == agent.portal_counter_config.region_id &&
            !region.full_frame &&
            region.polygon_norm.size() >= 3)
        {
            return &region;
        }
    }
    return nullptr;
}

static std::optional<std::string> getNextReadyCurrentDayStoredSixtySecondClipPathForJobStepCamera_(
    int jobId,
    int stepId,
    int cameraId,
    const std::string& coverageCutoffUtcIso = std::string())
{
    std::time_t tt = std::time(nullptr);
    std::tm tmLocal{};
#ifdef _WIN32
    localtime_s(&tmLocal, &tt);
#else
    localtime_r(&tt, &tmLocal);
#endif

    char y[5], m[3], d[3];
    std::snprintf(y, sizeof(y), "%04d", tmLocal.tm_year + 1900);
    std::snprintf(m, sizeof(m), "%02d", tmLocal.tm_mon + 1);
    std::snprintf(d, sizeof(d), "%02d", tmLocal.tm_mday);

    const fs::path dayDir =
        fs::path("frames") / ("cam_" + std::to_string(cameraId)) / y / m / d;

    std::error_code ec;
    if (!fs::exists(dayDir, ec) || ec || !fs::is_directory(dayDir, ec) || ec) {
        return std::nullopt;
    }

    const std::string lastConsumedKey =
        getLastConsumedClipKeyForJobStepCamera_(jobId, stepId, cameraId);
    const bool hasCursor = !lastConsumedKey.empty();

    bool found = false;
    std::string bestClipKey;
    fs::path bestPath;
    fs::file_time_type bestTime{};

    for (const auto& entry : fs::directory_iterator(dayDir, ec)) {
        if (ec) break;
        if (!entry.is_regular_file(ec)) {
            if (ec) break;
            continue;
        }

        const std::string filename = entry.path().filename().string();
        const std::string suffix = "_60s.mp4";
        if (suffix.size() > filename.size() ||
            !std::equal(suffix.rbegin(), suffix.rend(), filename.rbegin()))
        {
            continue;
        }
        if (entry.path().string().find("_merge_failed") != std::string::npos) {
            continue;
        }

        int parsedCameraId = -1;
        std::string startPretty;
        std::string endPretty;
        if (!parseJobClipFilename(filename, parsedCameraId, startPretty, endPretty) ||
            parsedCameraId != cameraId)
        {
            continue;
        }

        const auto lastWrite = entry.last_write_time(ec);
        if (ec) break;

        const auto nowFileClock = fs::file_time_type::clock::now();
        if (lastWrite > nowFileClock) {
            continue;
        }
        if (nowFileClock - lastWrite < std::chrono::seconds(2)) {
            continue;
        }

        const std::string clipKey = makeMonotonicClipKey_(entry.path());
        if (clipKey.empty()) continue;
        if (hasCursor && clipKey <= lastConsumedKey) {
            continue;
        }
        if (!clipStartsBeforeCoverageCutoff_(entry.path(), coverageCutoffUtcIso)) {
            continue;
        }

        if (!found) {
            found = true;
            bestClipKey = clipKey;
            bestPath = entry.path();
            bestTime = lastWrite;
            continue;
        }

        if (clipKey < bestClipKey ||
            (clipKey == bestClipKey && lastWrite < bestTime) ||
            (clipKey == bestClipKey &&
             lastWrite == bestTime &&
             entry.path().string() < bestPath.string()))
        {
            bestClipKey = clipKey;
            bestPath = entry.path();
            bestTime = lastWrite;
        }
    }

    if (ec || !found) {
        return std::nullopt;
    }
    return bestPath.string();
}

static std::optional<std::string> peekReadyJobVideoInputForStepCamera_(
    int jobId,
    int stepId,
    int cameraId,
    const JobAgentDef& agent,
    const std::string& coverageCutoffUtcIso = std::string())
{
    std::string inputType = agent.input_type;
    std::transform(inputType.begin(), inputType.end(), inputType.begin(),
        [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    if (inputType == "image") {
        return std::nullopt;
    }

    const int normalizedRunEverySeconds = normalizedRunEverySecondsForJobAgent_(agent);
    if (normalizedRunEverySeconds == 60) {
        return getNextReadyCurrentDayStoredSixtySecondClipPathForJobStepCamera_(
            jobId,
            stepId,
            cameraId,
            coverageCutoffUtcIso
        );
    }

    auto clipOpt = getNextReadyJobsClipForCamera_(jobId, stepId, cameraId);
    if (!clipOpt.has_value()) {
        return std::nullopt;
    }
    if (!clipStartsBeforeCoverageCutoff_(fs::path(*clipOpt), coverageCutoffUtcIso)) {
        return std::nullopt;
    }

    const std::string clipKey = makeMonotonicClipKey_(fs::path(*clipOpt));
    if (!isNewerClipForJobStepCamera_(jobId, stepId, cameraId, clipKey)) {
        return std::nullopt;
    }
    return clipOpt;
}

enum class VideoWindowAssemblyStatus {
    Assembled,
    NoNewWindow,
    Failed,
};

struct VideoWindowAssemblyResult {
    VideoWindowAssemblyStatus status = VideoWindowAssemblyStatus::Failed;
    std::string clipPath;
    std::vector<std::string> cleanupPaths;
    std::string consumedClipKey;
    std::string windowStartPretty;
    std::string windowEndPretty;
    std::string windowStartUtc;
    std::string windowEndUtc;
    int windowSeconds = 0;
    std::string error;
};

static VideoWindowAssemblyResult assembleAdaptivePendingJobsWindow_(
    int jobId,
    int stepId,
    int cameraId,
    const std::string& coverageCutoffUtcIso = std::string());

static VideoWindowAssemblyResult assembleLegacyVideoWindowForRunEvery_(
    int jobId,
    int stepId,
    int cameraId,
    int runEverySeconds);
static VideoWindowAssemblyResult assemblePortalCounterStepWindow_(
    int jobId,
    int stepId,
    int cameraId,
    const std::chrono::system_clock::time_point& windowStart,
    const std::chrono::system_clock::time_point& windowEnd);

JobStepDef::StartCondition JobRuntime::deriveLegacyStartCondition_(const JobStepDef& step) {
    JobStepDef::StartCondition sc;

    // Default legacy behavior: sequential dependency using input_from_step_id
    sc.mode = "sequential";
    sc.from_step_id = step.input_from_step_id;
    sc.raw = step.input_inject_key;

    // If legacy input_inject_key starts with "start:", parse simple modes:
    //   start:positive:... or start:negative:... or start:time:<seconds>
    // We keep this deliberately conservative (non-breaking).
    const std::string k = step.input_inject_key;
    if (k.rfind("start:", 0) == 0) {
        sc.raw = k;
        // split by ':'
        std::vector<std::string> parts;
        std::string cur;
        for (char ch : k) {
            if (ch == ':') {
                parts.push_back(cur);
                cur.clear();
            }
            else {
                cur.push_back(ch);
            }
        }
        parts.push_back(cur);
        if (parts.size() >= 2) {
            std::string mode = toLowerCopy(parts[1]);
            if (mode == "positive" || mode == "negative" || mode == "positivo" || mode == "negativo") {
                sc.mode = (mode == "positive" || mode == "positivo") ? "positive" : "negative";
                // Common legacy format you used:
                // start:positive:result:<camera_name>
                if (parts.size() >= 4) {
                    sc.target_key = parts.back();
                }
            }
            else if (mode == "time" && parts.size() >= 3) {
                sc.mode = "time";
                try { sc.time_offset_seconds = std::stoi(parts[2]); } catch (...) {}
            }
        }
    }

    return sc;
}

std::optional<bool> JobRuntime::extractSentimentPositive_(const std::string& out, const std::string& answerKey) {
    // true = positive, false = negative, nullopt = unknown
    try {
        if (isLikelyJson_(out)) {
            json j = json::parse(out);

            // 1) answerKey (default: Sentimento_Resposta)
            if (!answerKey.empty() && j.contains(answerKey) && j[answerKey].is_string()) {
                std::string v = toLowerCopy(j[answerKey].get<std::string>());
                if (v == "positivo" || v == "positive" || v == "pos" || v == "sim" || v == "yes" || v == "true") return true;
                if (v == "negativo" || v == "negative" || v == "neg" || v == "nao" || v == "n?o" || v == "no" || v == "false") return false;
            }

            // 2) common boolean-ish fields
            const char* keys[] = { "is_positive", "result", "positive", "ok" };
            for (const char* k : keys) {
                if (j.contains(k) && j[k].is_boolean()) return j[k].get<bool>();
            }
        }
    }
    catch (...) {
        // fall through
    }

    // text fallback (very conservative)
    std::string s = toLowerCopy(out);
    if (s.find("positivo") != std::string::npos || s.find("positive") != std::string::npos) return true;
    if (s.find("negativo") != std::string::npos || s.find("negative") != std::string::npos) return false;

    return std::nullopt;
}




static JobAgentDef agentFromGroup_(const JobInferenceGroup& g) {
    JobAgentDef a;
    a.agent_key = g.agent_key;
    a.prompt_template = g.prompt_template;
    a.alert_condition_text = g.alert_condition_text;
    a.negative_condition_text = g.negative_condition_text;
    a.input_type = g.input_type;
    a.video_packaging_mode = normalizeVideoPackagingMode_(g.video_packaging_mode);
    a.priority_level = g.priority_level;
    a.inference_model = normalizeInferenceModel_(g.inference_model);
    a.api_key = g.api_key;
    a.model_fps = normalizeModelInputFps_(g.model_fps, a.inference_model, a.input_type);
    a.run_every_seconds = isCoreInferenceModel_(a.inference_model)
        ? 60
        : normalizeRunEverySeconds_(g.run_every_seconds);
    a.running_resolution = normalizeCoreRunningResolution_(g.running_resolution);
    a.only_capture_on_motion = g.only_capture_on_motion;
    a.face_targets = g.face_targets;
    a.negative_reference_images = g.negative_reference_images;
    a.analysis_regions = g.analysis_regions;
    if (a.priority_level.empty()) a.priority_level = "MEDIUM";
    return a;
}


struct StepCaptureNeeds {
    bool video = false;
    bool image = false;
    int requestedTenSecondVideoFps = 0;
    int requestedSixtySecondVideoFps = 0;
    bool any() const { return video || image; }
};
static StepCaptureNeeds stepCaptureNeedsForCamera_(const JobStepDef& step, int cameraId);
static bool stepNeedsVideoCaptureForCamera_(const JobStepDef& step, int cameraId);
static bool stepOnlyCaptureOnMotionForCamera_(const JobStepDef& step, int cameraId);
static bool sampleMp4ToTargetFps_(
    const std::filesystem::path& srcMp4Path,
    const std::filesystem::path& dstMp4Path,
    int targetFps,
    std::string* outErr);


bool JobRuntime::stepNeedsVideoCaptureForCamera_(const JobStepDef& step, int cameraId) const
{
    return ::stepNeedsVideoCaptureForCamera_(step, cameraId);
}


void JobRuntime::runJob_(std::shared_ptr<JobInstance> job) {
    // Enable ?copy 10s clips to jobs temp? for all cameras used by this job.
    //JobsCaptureGuard jobsCopyGuard(owner_, job->payload.job.id, job->payload.all_camera_ids);

    //JobsCaptureGuard jobsCopyGuard(owner_, job->payload.all_camera_ids);

    const auto& J = job->payload.job;
    auto finalizeJobRuntimeState = [&]() {
        clearJobEphemeralState_(J.id);
        cleanupJobFolderAsync(J.id);
    };

    // Job started event
    postJobEvent_("job_started", J, json{
        {"job_id", J.id},
        {"job_name", J.name},
        {"job_run_id", job->payload.job_run_id},
        {"trigger", job->payload.trigger.raw}
        });


    try {
        auto steps = sortSteps(job->payload.steps);

        // Index helpers
        std::unordered_map<int, JobStepDef> stepsById;
        std::unordered_map<int, int> stepOrderById;
        for (const auto& s : steps) {
            stepsById[s.id] = s;
            stepOrderById[s.id] = s.step_order;
        }

        // Initialize stepRuns
        job->stepRuns.clear();
        for (const auto& s : steps) {
            auto [it, inserted] = job->stepRuns.emplace(
                std::piecewise_construct,
                std::forward_as_tuple(s.id),
                std::forward_as_tuple() // default-construct StepRun in-place
            );
            it->second.def = s;
            it->second.state = JobInstance::StepState::Pending;
        }

        // Pre-scan ALL custom start_condition rules from the payload.
        // IMPORTANT: start_condition.extract is defined on the *downstream* step,
        // but it must be evaluated by Gemini during inference of the *upstream* (from_step_id)
        // step, on the camera whose name matches start_condition.pattern.
        job->customStartHooks.clear();
        for (const auto& s : steps) {
            if (!s.start_condition.has_value()) continue;
            const auto& sc = *s.start_condition;
            if (sc.mode != "custom") continue;
            if (!sc.from_step_id.has_value()) continue;
            if (sc.extract_text.empty()) continue;

            JobInstance::CustomStartHook hook;
            hook.from_step_id = *sc.from_step_id;
            hook.downstream_step_id = s.id;
            hook.pattern = sc.target_key;   // parsed from payload.start_condition.pattern
            hook.extract = sc.extract_text; // parsed from payload.start_condition.extract
            job->customStartHooks.push_back(std::move(hook));
        }

        // Pre-scan ALL pipeline routes from the payload.
        // Pipelines are defined on the DOWNSTREAM step, but they pull outputs from an upstream step
        // and inject them into prompts for a specific target camera in the downstream step.
        job->pipelineHooks.clear();
        for (const auto& s : steps) {
            // Multi-pipeline form
            for (const auto& ps : s.pipelines) {
                for (const auto& inp : ps.inputs) {
                    JobInstance::PipelineHook h;
                    h.to_step_id = s.id;
                    h.target_camera_id = ps.target_camera_id;
                    h.from_step_id = ps.input_from_step_id;
                    if (inp.camera_id.has_value()) h.from_camera_id = *inp.camera_id;
                    h.from_camera_key = inp.input_inject_key;
                    job->pipelineHooks.push_back(std::move(h));
                }
            }

            // Legacy single-pipeline form (step.pipeline) is handled lazily via resolvePipelineInput_().
        }

        // Pre-skip invalid cycles (legacy dependency) if configured to skip.
        for (auto& [sid, run] : job->stepRuns) {
            const auto& step = run.def;
            // Use structured start_condition if present, else legacy dependency
            JobStepDef::StartCondition sc = step.start_condition.has_value() ? *step.start_condition : deriveLegacyStartCondition_(step);
            if (sc.from_step_id.has_value()) {
                int dep = *sc.from_step_id;
                if (!stepOrderById.count(dep) || stepOrderById[dep] >= step.step_order) {
                    if (step.on_missing_input == "skip") {
                        run.state = JobInstance::StepState::Skipped;
                        postStepEvent_("job_step_skipped", J, step, json{
                            {"job_run_id", job->payload.job_run_id},
                            {"reason", "invalid_dependency_or_cycle"},
                            {"from_step_id", dep}
                        });
                    }
                }
            }
        }

        job->jobStartedAt = std::chrono::steady_clock::now();
        constexpr int kMinStepTimeoutSeconds = 120;
        const int maxStepOrder = [&]() -> int {
            int maxOrder = 0;
            for (const auto& step : steps) {
                maxOrder = (std::max)(maxOrder, step.step_order);
            }
            return maxOrder;
        }();

        auto parseOptionalCoverageTimePoint =
            [&](const std::string& rawIsoUtc)
            -> std::optional<std::chrono::system_clock::time_point>
        {
            std::chrono::system_clock::time_point parsed{};
            if (!parseCoverageTimePoint_(rawIsoUtc, parsed)) {
                return std::nullopt;
            }
            return parsed;
        };

        auto completionPhaseToString =
            [&](JobInstance::StepRun::CompletionPhase phase) -> std::string
        {
            switch (phase) {
            case JobInstance::StepRun::CompletionPhase::Idle:
                return "idle";
            case JobInstance::StepRun::CompletionPhase::Capturing:
                return "capturing";
            case JobInstance::StepRun::CompletionPhase::DrainingToTarget:
                return "draining_to_analysis_target";
            case JobInstance::StepRun::CompletionPhase::Finalizing:
                return "finalizing";
            case JobInstance::StepRun::CompletionPhase::Completed:
                return "completed";
            default:
                return "unknown";
            }
        };

        auto stepHasTemporalPlan = [&](const JobStepDef& step) -> bool {
            for (const auto& agent : step.agents) {
                if (temporal::planUsable(agent.temporal_plan_envelope)) {
                    return true;
                }
            }
            for (const auto& group : step.inference_groups) {
                if (temporal::planUsable(group.temporal_plan_envelope)) {
                    return true;
                }
            }
            return false;
        };

        auto shouldUseAnalysisDrivenCompletion = [&](const JobStepDef& step) -> bool {
            const std::string completionMode =
                toLowerCopy(trimCopyRuntime_(step.analysis_completion_mode));
            if (completionMode == "legacy_deadline") {
                return false;
            }
            if (completionMode == "drain_to_analysis_target") {
                return true;
            }
            if (!step.analysis_target_end_utc.empty()) {
                return true;
            }
            if (!job->payload.execution_target_end_utc.empty() &&
                step.step_order >= maxStepOrder)
            {
                return true;
            }
            return stepHasTemporalPlan(step);
        };

        auto resolveAnalysisTargetForStep =
            [&](const JobStepDef& step,
                const std::chrono::system_clock::time_point& startedAtSystemUtc,
                int effectiveTimeoutSeconds)
            -> std::pair<std::chrono::system_clock::time_point, std::string>
        {
            std::chrono::system_clock::time_point targetEndUtc =
                startedAtSystemUtc + std::chrono::seconds(effectiveTimeoutSeconds);
            std::string targetSource = "step_timeout";

            if (const auto explicitTarget =
                    parseOptionalCoverageTimePoint(step.analysis_target_end_utc);
                explicitTarget.has_value())
            {
                targetEndUtc = *explicitTarget;
                targetSource = "step_analysis_target";
            }
            else if (step.step_order >= maxStepOrder) {
                if (const auto executionTarget =
                        parseOptionalCoverageTimePoint(job->payload.execution_target_end_utc);
                    executionTarget.has_value())
                {
                    targetEndUtc = *executionTarget;
                    targetSource = "execution_target_end";
                }
            }

            return { targetEndUtc, targetSource };
        };

        auto resolveAnalysisHardStopSeconds =
            [&](const JobStepDef& step, int effectiveTimeoutSeconds) -> int
        {
            if (step.analysis_hard_stop_seconds > 0) {
                return (std::max)(kTimeoutDrainGraceSeconds_, step.analysis_hard_stop_seconds);
            }
            return (std::max)(kTimeoutDrainGraceSeconds_, effectiveTimeoutSeconds);
        };

        auto resolveEarliestFirstDueForEnvelope =
            [&](const json& envelope,
                const std::chrono::system_clock::time_point& analysisAnchorUtc)
            -> std::optional<std::chrono::system_clock::time_point>
        {
            if (!temporal::planUsable(envelope)) {
                return std::nullopt;
            }

            const json plan = temporal::effectivePlan(envelope);
            if (!plan.is_object() || !plan.contains("operators") || !plan["operators"].is_array()) {
                return std::nullopt;
            }

            const std::string anchorIso = formatCoverageIsoUtc_(analysisAnchorUtc);
            std::optional<std::chrono::system_clock::time_point> earliest;
            for (const auto& op : plan["operators"]) {
                if (!op.is_object()) continue;
                if (toLowerCopy(trimCopyRuntime_(op.value("type", std::string()))) !=
                    "analyze_events_at_interval")
                {
                    continue;
                }

                json params = op.value("params", json::object());
                if (!params.is_object()) continue;
                json schedule = params.value("schedule", json::object());
                if (!schedule.is_object()) continue;

                const std::string anchorMode =
                    temporal::normalizeAnalyzeIntervalAnchorModeToken(
                        temporal::strField(schedule, "anchor_mode", "monitoring_start"));
                std::optional<std::chrono::system_clock::time_point> candidate;

                if (anchorMode == "monitoring_start") {
                    const int intervalSeconds = temporal::intField(schedule, "interval_seconds", 0);
                    if (intervalSeconds > 0) {
                        candidate = analysisAnchorUtc + std::chrono::seconds(intervalSeconds);
                    }
                }
                else if (anchorMode == "fixed_time_local") {
                    const std::string timeLocal =
                        trimCopyRuntime_(temporal::strField(schedule, "time_local"));
                    if (timeLocal.empty()) continue;
                    std::string scheduledTargetTs;
                    if (!temporal::computeFixedLocalCheckpointUtc(
                            anchorIso,
                            trimCopyRuntime_(temporal::strField(schedule, "date_local")),
                            timeLocal,
                            trimCopyRuntime_(temporal::strField(schedule, "timezone")),
                            scheduledTargetTs))
                    {
                        continue;
                    }

                    std::chrono::system_clock::time_point scheduledTp{};
                    if (parseCoverageTimePoint_(scheduledTargetTs, scheduledTp)) {
                        candidate = scheduledTp;
                    }
                }

                if (!candidate.has_value()) continue;
                if (!earliest.has_value() || *candidate < *earliest) {
                    earliest = *candidate;
                }
            }

            return earliest;
        };

        auto resolveEarliestFirstDueForStep =
            [&](const JobStepDef& step,
                const std::chrono::system_clock::time_point& analysisAnchorUtc)
            -> std::optional<std::chrono::system_clock::time_point>
        {
            std::optional<std::chrono::system_clock::time_point> earliest;
            for (const auto& agent : step.agents) {
                const auto candidate =
                    resolveEarliestFirstDueForEnvelope(agent.temporal_plan_envelope, analysisAnchorUtc);
                if (!candidate.has_value()) continue;
                if (!earliest.has_value() || *candidate < *earliest) {
                    earliest = *candidate;
                }
            }
            for (const auto& group : step.inference_groups) {
                const auto candidate =
                    resolveEarliestFirstDueForEnvelope(group.temporal_plan_envelope, analysisAnchorUtc);
                if (!candidate.has_value()) continue;
                if (!earliest.has_value() || *candidate < *earliest) {
                    earliest = *candidate;
                }
            }
            return earliest;
        };

        auto applyAnalysisTargetLocked =
            [&](JobInstance::StepRun& run,
                const std::chrono::system_clock::time_point& analysisTargetEndUtc,
                const std::string& analysisTargetSource,
                bool resolvedFromAnchor,
                bool clampedToFirstDue,
                const std::string& earliestFirstDueUtcIso)
        {
            const int hardStopExtensionSeconds =
                run.configuredAnalysisHardStopSeconds > 0
                    ? run.configuredAnalysisHardStopSeconds
                    : kTimeoutDrainGraceSeconds_;
            const long long captureBudgetSeconds = (std::max)(
                0LL,
                std::chrono::duration_cast<std::chrono::seconds>(
                    analysisTargetEndUtc - run.startedAtSystemUtc).count());

            run.captureDeadline = run.startedAt + std::chrono::seconds(captureBudgetSeconds);
            run.deadline = run.captureDeadline;
            run.captureDeadlineUtc = analysisTargetEndUtc;
            run.requiredCompletionEndUtc = analysisTargetEndUtc;
            run.analysisTargetEndUtc = analysisTargetEndUtc;
            run.hardStopDeadline =
                run.captureDeadline + std::chrono::seconds(hardStopExtensionSeconds);
            run.hardStopDeadlineUtc =
                run.captureDeadlineUtc + std::chrono::seconds(hardStopExtensionSeconds);
            run.captureDeadlineUtcIso = formatCoverageIsoUtc_(run.captureDeadlineUtc);
            run.hardStopDeadlineUtcIso = formatCoverageIsoUtc_(run.hardStopDeadlineUtc);
            run.requiredCompletionEndUtcIso = formatCoverageIsoUtc_(run.requiredCompletionEndUtc);
            run.analysisTargetEndUtcIso = formatCoverageIsoUtc_(run.analysisTargetEndUtc);
            run.analysisTargetSource = analysisTargetSource;
            run.analysisTargetResolvedFromAnchor = resolvedFromAnchor;
            run.analysisTargetPendingAnchor = run.analysisDriven && !resolvedFromAnchor;
            run.analysisTargetClampedToFirstDue = clampedToFirstDue;
            run.earliestFirstDueUtcIso = earliestFirstDueUtcIso;

            for (auto& [cameraId, coverage] : run.coverageByCamera) {
                (void)cameraId;
                if (!coverage.enabled) continue;
                coverage.targetEndUtc = run.requiredCompletionEndUtc;
                coverage.targetEndUtcIso = run.requiredCompletionEndUtcIso;
                coverage.tracker.setCutoff(
                    std::optional<std::chrono::system_clock::time_point>(coverage.targetEndUtc)
                );
            }
        };

        struct RunTimingSnapshot_ {
            std::chrono::steady_clock::time_point captureDeadline;
            std::chrono::steady_clock::time_point hardStopDeadline;
            std::string requiredCompletionEndUtcIso;
            bool analysisTargetPendingAnchor = false;
            bool analysisTargetResolvedFromAnchor = false;
        };

        auto snapshotRunTiming = [&](JobInstance::StepRun& run) -> RunTimingSnapshot_ {
            std::lock_guard<std::mutex> lock(run.coverageMu);
            return RunTimingSnapshot_{
                run.captureDeadline,
                run.hardStopDeadline,
                run.requiredCompletionEndUtcIso,
                run.analysisTargetPendingAnchor,
                run.analysisTargetResolvedFromAnchor
            };
        };

        auto captureWindowOpen = [&](JobInstance::StepRun& run) -> bool {
            const auto now = std::chrono::steady_clock::now();
            const RunTimingSnapshot_ timing = snapshotRunTiming(run);
            if (run.analysisDriven &&
                timing.analysisTargetPendingAnchor &&
                !timing.analysisTargetResolvedFromAnchor)
            {
                return now < timing.hardStopDeadline;
            }
            return now < timing.captureDeadline;
        };

        auto captureDeadlineReached = [&](JobInstance::StepRun& run) -> bool {
            const RunTimingSnapshot_ timing = snapshotRunTiming(run);
            const auto now = std::chrono::steady_clock::now();
            if (run.analysisDriven &&
                timing.analysisTargetPendingAnchor &&
                !timing.analysisTargetResolvedFromAnchor)
            {
                return now >= timing.hardStopDeadline;
            }
            return now >= timing.captureDeadline;
        };

        auto currentCaptureBudgetDeadline =
            [&](JobInstance::StepRun& run) -> std::chrono::steady_clock::time_point
        {
            const RunTimingSnapshot_ timing = snapshotRunTiming(run);
            if (run.analysisDriven &&
                timing.analysisTargetPendingAnchor &&
                !timing.analysisTargetResolvedFromAnchor)
            {
                return timing.hardStopDeadline;
            }
            return timing.captureDeadline;
        };

        auto refreshCameraCoverageLocked = [&](JobInstance::StepRun::CameraCoverageRun& coverage) {
            const contentcoverage::CoverageSnapshot snapshot =
                coverage.tracker.snapshotFromAnchor(coverage.anchorUtc);
            coverage.coveredUntilUtcIso =
                snapshot.hasCoveredUntil ? formatCoverageIsoUtc_(snapshot.coveredUntil) : std::string();
            coverage.latestCapturedUtcIso =
                snapshot.hasLatestCaptured ? formatCoverageIsoUtc_(snapshot.latestCaptured) : std::string();
            coverage.firstGapStartUtcIso =
                snapshot.hasFirstGapStart ? formatCoverageIsoUtc_(snapshot.firstGapStart) : std::string();
            if (snapshot.hasCoveredUntil && snapshot.coveredUntil >= coverage.targetEndUtc) {
                coverage.complete = true;
                coverage.coverageGapSeconds = 0;
            }
            else {
                coverage.complete = false;
                const std::chrono::system_clock::time_point coveredUntil =
                    snapshot.hasCoveredUntil ? snapshot.coveredUntil : coverage.anchorUtc;
                coverage.coverageGapSeconds = std::max<long long>(
                    0,
                    std::chrono::duration_cast<std::chrono::seconds>(
                        coverage.targetEndUtc - coveredUntil).count()
                );
            }
        };

        auto refreshCameraAnalysisLocked =
            [&](JobInstance::StepRun& run, JobInstance::StepRun::CameraCoverageRun& coverage) {
            if (coverage.hasAnalysisAnchor) {
                coverage.analysisAnchorUtcIso = formatCoverageIsoUtc_(coverage.analysisAnchorUtc);
            }
            else {
                coverage.analysisAnchorUtcIso.clear();
            }

            if (coverage.hasAnalysisFrontier) {
                coverage.analysisFrontierUtcIso = formatCoverageIsoUtc_(coverage.analysisFrontierUtc);
            }
            else {
                coverage.analysisFrontierUtcIso.clear();
            }

            const std::chrono::system_clock::time_point analysisTargetEndUtc =
                run.analysisTargetEndUtc.time_since_epoch().count() != 0
                    ? run.analysisTargetEndUtc
                    : run.requiredCompletionEndUtc;
            const std::chrono::system_clock::time_point lagBaseUtc =
                coverage.hasAnalysisFrontier
                    ? coverage.analysisFrontierUtc
                    : (coverage.hasAnalysisAnchor
                           ? coverage.analysisAnchorUtc
                           : run.startedAtSystemUtc);
            coverage.analysisLagSeconds = (std::max)(
                0LL,
                std::chrono::duration_cast<std::chrono::seconds>(
                    analysisTargetEndUtc - lagBaseUtc).count());
            coverage.analysisComplete =
                coverage.hasAnalysisFrontier &&
                coverage.analysisFrontierUtc >= analysisTargetEndUtc;

            const bool terminalTimeoutPhase =
                run.timeoutRequested.load() &&
                (run.completionPhase.load() == JobInstance::StepRun::CompletionPhase::Finalizing ||
                 run.completionPhase.load() == JobInstance::StepRun::CompletionPhase::Completed ||
                 std::chrono::steady_clock::now() >= run.hardStopDeadline);
            const std::string materializedFrontierUtcIso =
                coverage.materializedFrontierUtcIso.empty()
                    ? coverage.latestCapturedUtcIso
                    : coverage.materializedFrontierUtcIso;
            const bool contentGapBeforeTarget =
                !coverage.analysisComplete &&
                (materializedFrontierUtcIso.empty() ||
                 (!run.analysisTargetEndUtcIso.empty() &&
                  materializedFrontierUtcIso < run.analysisTargetEndUtcIso));
            const bool captureReachedTargetWithoutMaterialization =
                !coverage.analysisComplete &&
                !run.analysisTargetEndUtcIso.empty() &&
                !coverage.capturedFrontierUtcIso.empty() &&
                coverage.capturedFrontierUtcIso >= run.analysisTargetEndUtcIso &&
                (materializedFrontierUtcIso.empty() ||
                 materializedFrontierUtcIso < run.analysisTargetEndUtcIso);

            if (run.cancel.load()) {
                coverage.analysisStatus = "step_cancelled";
            }
            else if (coverage.analysisComplete) {
                coverage.analysisStatus = "analysis_target_reached";
            }
            else if (!run.analysisDriven) {
                coverage.analysisStatus = "legacy_deadline";
            }
            else if (terminalTimeoutPhase) {
                coverage.analysisStatus =
                    captureReachedTargetWithoutMaterialization
                        ? "materialization_gap_before_target"
                        : (contentGapBeforeTarget ? "content_gap_before_target"
                                                  : "analysis_backlog_timeout");
            }
            else if (run.timeoutRequested.load() ||
                     run.completionPhase.load() == JobInstance::StepRun::CompletionPhase::DrainingToTarget)
            {
                coverage.analysisStatus = "draining_to_analysis_target";
            }
            else if (coverage.hasAnalysisFrontier || coverage.hasAnalysisAnchor) {
                coverage.analysisStatus = "analysis_in_progress";
            }
            else {
                coverage.analysisStatus = "waiting_for_analysis";
            }
        };

        auto buildCameraCoverageJson = [&](JobInstance::StepRun& run, int cameraId) -> json {
            std::lock_guard<std::mutex> lock(run.coverageMu);
            auto it = run.coverageByCamera.find(cameraId);
            if (it == run.coverageByCamera.end() || !it->second.enabled) {
                return json{
                    {"coverage_required", false},
                    {"coverage_complete", true},
                    {"coverage_status", "not_applicable"},
                    {"captured_frontier_utc", ""},
                    {"materialized_frontier_utc", ""},
                    {"materialization_status", "not_applicable"},
                    {"analysis_driven", run.analysisDriven},
                    {"analysis_completion_mode", run.analysisCompletionMode},
                    {"analysis_complete", true},
                    {"analysis_status", "not_applicable"},
                    {"analysis_target_end_utc", run.analysisTargetEndUtcIso},
                    {"analysis_target_source", run.analysisTargetSource},
                    {"capture_deadline_utc", run.captureDeadlineUtcIso},
                    {"hard_stop_deadline_utc", run.hardStopDeadlineUtcIso},
                    {"step_phase", completionPhaseToString(run.completionPhase.load())}
                };
            }

            refreshCameraCoverageLocked(it->second);
            refreshCameraAnalysisLocked(run, it->second);
            const auto& coverage = it->second;
            return json{
                {"coverage_required", true},
                {"coverage_complete", coverage.complete},
                {"coverage_status", coverage.complete ? "complete" : "coverage_incomplete"},
                {"coverage_anchor_utc", coverage.anchorUtcIso},
                {"required_completion_end_utc", coverage.targetEndUtcIso},
                {"captured_frontier_utc", coverage.capturedFrontierUtcIso},
                {"materialized_frontier_utc",
                 coverage.materializedFrontierUtcIso.empty()
                     ? coverage.latestCapturedUtcIso
                     : coverage.materializedFrontierUtcIso},
                {"materialization_status", coverage.materializationStatus},
                {"covered_until_utc", coverage.coveredUntilUtcIso},
                {"latest_captured_utc", coverage.latestCapturedUtcIso},
                {"first_gap_start_utc", coverage.firstGapStartUtcIso},
                {"coverage_gap_seconds", coverage.coverageGapSeconds},
                {"analysis_driven", run.analysisDriven},
                {"analysis_completion_mode", run.analysisCompletionMode},
                {"analysis_complete", coverage.analysisComplete},
                {"analysis_status", coverage.analysisStatus},
                {"analysis_anchor_utc", coverage.analysisAnchorUtcIso},
                {"analysis_frontier_utc", coverage.analysisFrontierUtcIso},
                {"analysis_target_end_utc", run.analysisTargetEndUtcIso},
                {"analysis_target_source", run.analysisTargetSource},
                {"analysis_lag_seconds", coverage.analysisLagSeconds},
                {"capture_deadline_utc", run.captureDeadlineUtcIso},
                {"hard_stop_deadline_utc", run.hardStopDeadlineUtcIso},
                {"step_phase", completionPhaseToString(run.completionPhase.load())}
            };
        };

        auto isCameraCoverageComplete = [&](JobInstance::StepRun& run, int cameraId) -> bool {
            std::lock_guard<std::mutex> lock(run.coverageMu);
            auto it = run.coverageByCamera.find(cameraId);
            if (it == run.coverageByCamera.end() || !it->second.enabled) {
                return true;
            }
            refreshCameraCoverageLocked(it->second);
            return it->second.complete;
        };

        auto isCameraAnalysisComplete = [&](JobInstance::StepRun& run, int cameraId) -> bool {
            std::lock_guard<std::mutex> lock(run.coverageMu);
            auto it = run.coverageByCamera.find(cameraId);
            if (it == run.coverageByCamera.end() || !it->second.enabled) {
                return true;
            }
            refreshCameraCoverageLocked(it->second);
            refreshCameraAnalysisLocked(run, it->second);
            return it->second.analysisComplete;
        };

        auto observeLatestCapturedForCamera = [&](JobInstance::StepRun& run,
                                                  int cameraId,
                                                  const std::string& latestCapturedEndUtc) {
            std::chrono::system_clock::time_point endTp;
            if (!parseCoverageTimePoint_(latestCapturedEndUtc, endTp)) {
                return;
            }
            std::lock_guard<std::mutex> lock(run.coverageMu);
            auto it = run.coverageByCamera.find(cameraId);
            if (it == run.coverageByCamera.end() || !it->second.enabled) {
                return;
            }
            it->second.capturedFrontierUtcIso = latestCapturedEndUtc;
            it->second.materializedFrontierUtcIso = latestCapturedEndUtc;
            it->second.materializationStatus = "materialized";
            it->second.tracker.observeCapturedEnd(endTp);
            refreshCameraCoverageLocked(it->second);
            refreshCameraAnalysisLocked(run, it->second);
        };

        auto observeCaptureFrontierForCamera = [&](JobInstance::StepRun& run,
                                                   int cameraId,
                                                   const std::string& capturedFrontierUtc,
                                                   const std::string& materializationStatus) {
            if (capturedFrontierUtc.empty()) {
                return;
            }
            std::lock_guard<std::mutex> lock(run.coverageMu);
            auto it = run.coverageByCamera.find(cameraId);
            if (it == run.coverageByCamera.end() || !it->second.enabled) {
                return;
            }
            if (it->second.capturedFrontierUtcIso.empty() ||
                capturedFrontierUtc > it->second.capturedFrontierUtcIso)
            {
                it->second.capturedFrontierUtcIso = capturedFrontierUtc;
            }
            if (!materializationStatus.empty()) {
                it->second.materializationStatus = materializationStatus;
            }
            refreshCameraCoverageLocked(it->second);
            refreshCameraAnalysisLocked(run, it->second);
        };

        auto observeMaterializedFrontierForCamera = [&](JobInstance::StepRun& run,
                                                        int cameraId,
                                                        const std::string& materializedFrontierUtc,
                                                        const std::string& materializationStatus) {
            if (materializedFrontierUtc.empty()) {
                return;
            }
            std::chrono::system_clock::time_point endTp;
            const bool parsedEndTp =
                parseCoverageTimePoint_(materializedFrontierUtc, endTp);
            std::lock_guard<std::mutex> lock(run.coverageMu);
            auto it = run.coverageByCamera.find(cameraId);
            if (it == run.coverageByCamera.end() || !it->second.enabled) {
                return;
            }
            if (it->second.materializedFrontierUtcIso.empty() ||
                materializedFrontierUtc > it->second.materializedFrontierUtcIso)
            {
                it->second.materializedFrontierUtcIso = materializedFrontierUtc;
            }
            if (it->second.capturedFrontierUtcIso.empty() ||
                materializedFrontierUtc > it->second.capturedFrontierUtcIso)
            {
                it->second.capturedFrontierUtcIso = materializedFrontierUtc;
            }
            if (!materializationStatus.empty()) {
                it->second.materializationStatus = materializationStatus;
            }
            if (parsedEndTp) {
                it->second.tracker.observeCapturedEnd(endTp);
            }
            refreshCameraCoverageLocked(it->second);
            refreshCameraAnalysisLocked(run, it->second);
        };

        auto observeSuccessfulCoverageSpanForCamera = [&](JobInstance::StepRun& run,
                                                          int cameraId,
                                                          const std::string& segmentStartUtc,
                                                          const std::string& segmentEndUtc) {
            std::chrono::system_clock::time_point startTp;
            std::chrono::system_clock::time_point endTp;
            if (!parseCoverageTimePoint_(segmentStartUtc, startTp) ||
                !parseCoverageTimePoint_(segmentEndUtc, endTp) ||
                endTp <= startTp)
            {
                return;
            }
            std::lock_guard<std::mutex> lock(run.coverageMu);
            auto it = run.coverageByCamera.find(cameraId);
            if (it == run.coverageByCamera.end() || !it->second.enabled) {
                return;
            }
            it->second.tracker.observeCapturedEnd(endTp);
            it->second.tracker.addSuccessfulSpan(startTp, endTp);
            bool analysisAnchorUpdated = false;
            if (!it->second.hasAnalysisAnchor || startTp < it->second.analysisAnchorUtc) {
                it->second.analysisAnchorUtc = startTp;
                it->second.hasAnalysisAnchor = true;
                analysisAnchorUpdated = true;
            }
            if (!it->second.hasAnalysisFrontier || endTp > it->second.analysisFrontierUtc) {
                it->second.analysisFrontierUtc = endTp;
                it->second.hasAnalysisFrontier = true;
            }
            if (run.analysisDriven &&
                run.analysisTargetPendingAnchor &&
                run.configuredAnalysisDurationSeconds > 0 &&
                analysisAnchorUpdated)
            {
                std::chrono::system_clock::time_point nextAnalysisTargetEndUtc =
                    it->second.analysisAnchorUtc +
                    std::chrono::seconds(run.configuredAnalysisDurationSeconds);
                bool clampedToFirstDue = false;
                std::string earliestFirstDueUtcIso;
                if (const auto earliestFirstDue =
                        resolveEarliestFirstDueForStep(run.def, it->second.analysisAnchorUtc);
                    earliestFirstDue.has_value())
                {
                    earliestFirstDueUtcIso = formatCoverageIsoUtc_(*earliestFirstDue);
                    if (*earliestFirstDue > nextAnalysisTargetEndUtc) {
                        nextAnalysisTargetEndUtc = *earliestFirstDue;
                        clampedToFirstDue = true;
                    }
                }

                applyAnalysisTargetLocked(
                    run,
                    nextAnalysisTargetEndUtc,
                    clampedToFirstDue
                        ? "step_timeout_from_analysis_anchor_clamped_to_first_due"
                        : "step_timeout_from_analysis_anchor",
                    true,
                    clampedToFirstDue,
                    earliestFirstDueUtcIso
                );
                for (auto& [otherCameraId, coverage] : run.coverageByCamera) {
                    (void)otherCameraId;
                    if (!coverage.enabled) continue;
                    refreshCameraCoverageLocked(coverage);
                    refreshCameraAnalysisLocked(run, coverage);
                }
            }
            refreshCameraCoverageLocked(it->second);
            refreshCameraAnalysisLocked(run, it->second);
        };

        auto buildStepCoverageSummary = [&](JobInstance::StepRun& run) -> json {
            std::lock_guard<std::mutex> lock(run.coverageMu);
            if (!run.coverageDriven || run.coverageByCamera.empty()) {
                return json{
                    {"coverage_required", false},
                    {"coverage_complete", true},
                    {"coverage_status", "not_applicable"}
                };
            }

            bool allComplete = true;
            bool haveCoveredUntil = false;
            bool haveLatestCaptured = false;
            bool haveFirstGap = false;
            std::string minCoveredUntilUtc;
            std::string maxLatestCapturedUtc;
            std::string firstGapStartUtc;
            long long maxGapSeconds = 0;
            json perCamera = json::object();
            for (auto& [cameraId, coverage] : run.coverageByCamera) {
                if (!coverage.enabled) {
                    continue;
                }
                refreshCameraCoverageLocked(coverage);
                allComplete = allComplete && coverage.complete;
                if (!coverage.coveredUntilUtcIso.empty() &&
                    (!haveCoveredUntil || coverage.coveredUntilUtcIso < minCoveredUntilUtc))
                {
                    minCoveredUntilUtc = coverage.coveredUntilUtcIso;
                    haveCoveredUntil = true;
                }
                if (!coverage.latestCapturedUtcIso.empty() &&
                    (!haveLatestCaptured || coverage.latestCapturedUtcIso > maxLatestCapturedUtc))
                {
                    maxLatestCapturedUtc = coverage.latestCapturedUtcIso;
                    haveLatestCaptured = true;
                }
                if (!coverage.firstGapStartUtcIso.empty() &&
                    (!haveFirstGap || coverage.firstGapStartUtcIso < firstGapStartUtc))
                {
                    firstGapStartUtc = coverage.firstGapStartUtcIso;
                    haveFirstGap = true;
                }
                maxGapSeconds = std::max(maxGapSeconds, coverage.coverageGapSeconds);
                perCamera[std::to_string(cameraId)] = json{
                    {"coverage_required", true},
                    {"coverage_complete", coverage.complete},
                    {"coverage_status", coverage.complete ? "complete" : "coverage_incomplete"},
                    {"coverage_anchor_utc", coverage.anchorUtcIso},
                    {"required_completion_end_utc", coverage.targetEndUtcIso},
                    {"covered_until_utc", coverage.coveredUntilUtcIso},
                    {"latest_captured_utc", coverage.latestCapturedUtcIso},
                    {"first_gap_start_utc", coverage.firstGapStartUtcIso},
                    {"coverage_gap_seconds", coverage.coverageGapSeconds}
                };
            }

            return json{
                {"coverage_required", true},
                {"coverage_complete", allComplete},
                {"coverage_status", allComplete ? "complete" : "coverage_incomplete"},
                {"required_completion_end_utc", run.requiredCompletionEndUtcIso},
                {"covered_until_utc", haveCoveredUntil ? json(minCoveredUntilUtc) : json(nullptr)},
                {"latest_captured_utc", haveLatestCaptured ? json(maxLatestCapturedUtc) : json(nullptr)},
                {"first_gap_start_utc", haveFirstGap ? json(firstGapStartUtc) : json(nullptr)},
                {"coverage_gap_seconds", maxGapSeconds},
                {"coverage_by_camera", perCamera}
            };
        };

        auto buildStepAnalysisSummary = [&](JobInstance::StepRun& run) -> json {
            std::lock_guard<std::mutex> lock(run.coverageMu);
            if (run.coverageByCamera.empty()) {
                return json{
                    {"analysis_driven", run.analysisDriven},
                    {"analysis_completion_mode", run.analysisCompletionMode},
                    {"analysis_complete", true},
                    {"analysis_status", "not_applicable"},
                    {"analysis_target_end_utc", run.analysisTargetEndUtcIso},
                    {"analysis_target_source", run.analysisTargetSource},
                    {"analysis_lag_seconds", 0},
                    {"capture_deadline_utc", run.captureDeadlineUtcIso},
                    {"hard_stop_deadline_utc", run.hardStopDeadlineUtcIso},
                    {"step_phase", completionPhaseToString(run.completionPhase.load())}
                };
            }

            bool anyEnabled = false;
            bool allComplete = true;
            bool haveFrontier = false;
            bool haveAnchor = false;
            bool sawGap = false;
            bool sawBacklog = false;
            bool sawDraining = false;
            bool sawProgress = false;
            bool sawWaiting = false;
            std::string minFrontierUtc;
            std::string minAnchorUtc;
            long long maxLagSeconds = 0;
            json perCamera = json::object();

            for (auto& [cameraId, coverage] : run.coverageByCamera) {
                if (!coverage.enabled) {
                    continue;
                }
                anyEnabled = true;
                refreshCameraCoverageLocked(coverage);
                refreshCameraAnalysisLocked(run, coverage);
                allComplete = allComplete && coverage.analysisComplete;
                if (!coverage.analysisFrontierUtcIso.empty() &&
                    (!haveFrontier || coverage.analysisFrontierUtcIso < minFrontierUtc))
                {
                    minFrontierUtc = coverage.analysisFrontierUtcIso;
                    haveFrontier = true;
                }
                if (!coverage.analysisAnchorUtcIso.empty() &&
                    (!haveAnchor || coverage.analysisAnchorUtcIso < minAnchorUtc))
                {
                    minAnchorUtc = coverage.analysisAnchorUtcIso;
                    haveAnchor = true;
                }
                maxLagSeconds = (std::max)(maxLagSeconds, coverage.analysisLagSeconds);
                sawGap = sawGap || coverage.analysisStatus == "content_gap_before_target";
                sawBacklog = sawBacklog || coverage.analysisStatus == "analysis_backlog_timeout";
                sawDraining = sawDraining || coverage.analysisStatus == "draining_to_analysis_target";
                sawProgress = sawProgress || coverage.analysisStatus == "analysis_in_progress";
                sawWaiting = sawWaiting || coverage.analysisStatus == "waiting_for_analysis";
                perCamera[std::to_string(cameraId)] = json{
                    {"analysis_complete", coverage.analysisComplete},
                    {"analysis_status", coverage.analysisStatus},
                    {"analysis_anchor_utc", coverage.analysisAnchorUtcIso},
                    {"analysis_frontier_utc", coverage.analysisFrontierUtcIso},
                    {"analysis_target_end_utc", run.analysisTargetEndUtcIso},
                    {"analysis_lag_seconds", coverage.analysisLagSeconds}
                };
            }

            std::string overallStatus = "not_applicable";
            if (anyEnabled) {
                if (allComplete) {
                    overallStatus = "analysis_target_reached";
                }
                else if (!run.analysisDriven) {
                    overallStatus = "legacy_deadline";
                }
                else if (sawGap) {
                    overallStatus = "content_gap_before_target";
                }
                else if (sawBacklog) {
                    overallStatus = "analysis_backlog_timeout";
                }
                else if (sawDraining) {
                    overallStatus = "draining_to_analysis_target";
                }
                else if (sawProgress) {
                    overallStatus = "analysis_in_progress";
                }
                else if (sawWaiting) {
                    overallStatus = "waiting_for_analysis";
                }
                else {
                    overallStatus = "analysis_incomplete";
                }
            }

            return json{
                {"analysis_driven", run.analysisDriven},
                {"analysis_completion_mode", run.analysisCompletionMode},
                {"analysis_complete", anyEnabled ? allComplete : true},
                {"analysis_status", overallStatus},
                {"analysis_anchor_utc", haveAnchor ? json(minAnchorUtc) : json(nullptr)},
                {"analysis_frontier_utc", haveFrontier ? json(minFrontierUtc) : json(nullptr)},
                {"analysis_target_end_utc", run.analysisTargetEndUtcIso},
                {"analysis_target_source", run.analysisTargetSource},
                {"analysis_lag_seconds", maxLagSeconds},
                {"capture_deadline_utc", run.captureDeadlineUtcIso},
                {"hard_stop_deadline_utc", run.hardStopDeadlineUtcIso},
                {"step_phase", completionPhaseToString(run.completionPhase.load())},
                {"analysis_by_camera", perCamera}
            };
        };

        auto buildJobCoverageSummary = [&]() -> json {
            bool anyCoverageRequired = false;
            bool allComplete = true;
            long long maxGapSeconds = 0;
            json perStep = json::object();
            json incompleteSteps = json::array();

            for (auto& [stepId, stepRun] : job->stepRuns) {
                json stepCoverage = buildStepCoverageSummary(stepRun);
                perStep[std::to_string(stepId)] = stepCoverage;

                const bool stepCoverageRequired =
                    stepCoverage.value("coverage_required", false);
                if (!stepCoverageRequired) {
                    continue;
                }

                anyCoverageRequired = true;
                const bool stepCoverageComplete =
                    stepCoverage.value("coverage_complete", true);
                allComplete = allComplete && stepCoverageComplete;
                maxGapSeconds = std::max(
                    maxGapSeconds,
                    stepCoverage.value("coverage_gap_seconds", 0LL)
                );

                if (!stepCoverageComplete) {
                    incompleteSteps.push_back(json{
                        {"step_id", stepId},
                        {"step_order", stepRun.def.step_order},
                        {"coverage_status",
                         stepCoverage.value("coverage_status",
                                            std::string("coverage_incomplete"))}
                    });
                }
            }

            json out = {
                {"coverage_required", anyCoverageRequired},
                {"coverage_complete", anyCoverageRequired ? allComplete : true},
                {"coverage_status",
                 anyCoverageRequired
                     ? (allComplete ? "complete" : "coverage_incomplete")
                     : "not_applicable"},
                {"coverage_gap_seconds", maxGapSeconds},
                {"coverage_by_step", perStep}
            };
            if (!incompleteSteps.empty()) {
                out["coverage_incomplete_steps"] = incompleteSteps;
            }
            return out;
        };

        auto buildJobAnalysisSummary = [&]() -> json {
            bool anyAnalysisDriven = false;
            bool allComplete = true;
            long long maxLagSeconds = 0;
            json perStep = json::object();
            json incompleteSteps = json::array();

            for (auto& [stepId, stepRun] : job->stepRuns) {
                json stepAnalysis = buildStepAnalysisSummary(stepRun);
                perStep[std::to_string(stepId)] = stepAnalysis;

                const bool stepAnalysisDriven =
                    stepAnalysis.value("analysis_driven", false);
                if (!stepAnalysisDriven) {
                    continue;
                }

                anyAnalysisDriven = true;
                const bool stepAnalysisComplete =
                    stepAnalysis.value("analysis_complete", true);
                allComplete = allComplete && stepAnalysisComplete;
                maxLagSeconds = (std::max)(
                    maxLagSeconds,
                    stepAnalysis.value("analysis_lag_seconds", 0LL)
                );

                if (!stepAnalysisComplete) {
                    incompleteSteps.push_back(json{
                        {"step_id", stepId},
                        {"step_order", stepRun.def.step_order},
                        {"analysis_status",
                         stepAnalysis.value("analysis_status",
                                            std::string("analysis_incomplete"))}
                    });
                }
            }

            json out = {
                {"analysis_driven", anyAnalysisDriven},
                {"analysis_complete", anyAnalysisDriven ? allComplete : true},
                {"analysis_status",
                 anyAnalysisDriven
                     ? (allComplete ? "analysis_target_reached" : "analysis_incomplete")
                     : "not_applicable"},
                {"analysis_lag_seconds", maxLagSeconds},
                {"analysis_by_step", perStep}
            };
            if (!incompleteSteps.empty()) {
                out["analysis_incomplete_steps"] = incompleteSteps;
            }
            return out;
        };

        auto startStep = [&](JobInstance::StepRun& run) {
            auto& step = run.def;
            const int effectiveTimeoutSeconds = std::max(kMinStepTimeoutSeconds, step.timeout_seconds);

            run.state = JobInstance::StepState::Running;
            run.startedAt = std::chrono::steady_clock::now();
            run.startedAtSystemUtc = std::chrono::system_clock::now();
            const bool analysisDriven = shouldUseAnalysisDrivenCompletion(step);
            std::chrono::system_clock::time_point analysisTargetEndUtc =
                run.startedAtSystemUtc + std::chrono::seconds(effectiveTimeoutSeconds);
            std::string analysisTargetSource = "step_timeout";
            if (analysisDriven) {
                std::tie(analysisTargetEndUtc, analysisTargetSource) =
                    resolveAnalysisTargetForStep(
                        step,
                        run.startedAtSystemUtc,
                        effectiveTimeoutSeconds
                    );
            }
            const bool analysisTargetPendingAnchor =
                analysisDriven && analysisTargetSource == "step_timeout";
            const int hardStopExtensionSeconds =
                analysisDriven
                    ? resolveAnalysisHardStopSeconds(step, effectiveTimeoutSeconds)
                    : kTimeoutDrainGraceSeconds_;
            const long long captureBudgetSeconds = (std::max)(
                0LL,
                std::chrono::duration_cast<std::chrono::seconds>(
                    analysisTargetEndUtc - run.startedAtSystemUtc).count());
            run.captureDeadline = run.startedAt + std::chrono::seconds(captureBudgetSeconds);
            run.deadline = run.captureDeadline;
            run.captureDeadlineUtc = analysisTargetEndUtc;
            run.requiredCompletionEndUtc = analysisTargetEndUtc;
            run.analysisTargetEndUtc = analysisTargetEndUtc;
            run.hardStopDeadline =
                run.captureDeadline + std::chrono::seconds(hardStopExtensionSeconds);
            run.hardStopDeadlineUtc =
                run.captureDeadlineUtc + std::chrono::seconds(hardStopExtensionSeconds);
            run.cancel = false;
            run.timeoutRequested = false;
            run.injectedInput.clear(); // pipeline input is resolved per target camera (non-blocking)
            run.coverageDriven = false;
            run.coverageIncomplete = false;
            run.analysisDriven = analysisDriven;
            run.configuredAnalysisDurationSeconds = effectiveTimeoutSeconds;
            run.configuredAnalysisHardStopSeconds = hardStopExtensionSeconds;
            run.analysisTargetPendingAnchor = analysisTargetPendingAnchor;
            run.analysisTargetResolvedFromAnchor = !analysisTargetPendingAnchor;
            run.analysisTargetClampedToFirstDue = false;
            run.earliestFirstDueUtcIso.clear();
            run.completionPhase.store(JobInstance::StepRun::CompletionPhase::Capturing);
            run.startedAtSystemUtcIso = formatCoverageIsoUtc_(run.startedAtSystemUtc);
            run.captureDeadlineUtcIso = formatCoverageIsoUtc_(run.captureDeadlineUtc);
            run.hardStopDeadlineUtcIso = formatCoverageIsoUtc_(run.hardStopDeadlineUtc);
            run.requiredCompletionEndUtcIso = formatCoverageIsoUtc_(run.requiredCompletionEndUtc);
            run.analysisTargetEndUtcIso = formatCoverageIsoUtc_(run.analysisTargetEndUtc);
            run.analysisTargetSource =
                analysisTargetPendingAnchor
                    ? std::string("step_timeout_pending_analysis_anchor")
                    : analysisTargetSource;
            run.analysisCompletionMode =
                analysisDriven ? std::string("drain_to_analysis_target")
                               : std::string("legacy_deadline");
            if (!step.analysis_completion_mode.empty()) {
                run.analysisCompletionMode = trimCopyRuntime_(step.analysis_completion_mode);
            }

            // Ensure target cameras are started using the enriched start_camera_payloads map
            if (owner_) {
                std::vector<std::pair<int, nlohmann::json>> stepCameraPayloads;
                stepCameraPayloads.reserve(step.targets.size());
                for (const auto& tgt : step.targets) {
                    auto itP = job->payload.camera_start_payload_by_id.find(tgt.camera_id);
                    if (itP == job->payload.camera_start_payload_by_id.end()) {
                        continue;
                    }
                    stepCameraPayloads.push_back({ tgt.camera_id, itP->second });
                }

                AgentCore::ResourceAdmissionDecision admissionDecision;
                AgentCore::JobStepCameraStartResult cameraStartResult = owner_->startJobStepCameras_(
                    job->payload.job.id,
                    step.id,
                    stepCameraPayloads,
                    admissionDecision
                );
                if (!cameraStartResult.ok) {
                    run.state = JobInstance::StepState::Skipped;
                    run.cancel = true;
                    if (!admissionDecision.allowed) {
                        nlohmann::json blockedDetails =
                            owner_->resourceAdmissionDecisionToJson_(admissionDecision, "job");
                        blockedDetails["job_run_id"] = job->payload.job_run_id;
                        blockedDetails["job_id"] = J.id;
                        blockedDetails["job_name"] = J.name;
                        blockedDetails["step_id"] = step.id;
                        blockedDetails["step_name"] = step.name;
                        blockedDetails["step_order"] = step.step_order;
                        blockedDetails["started_camera_ids"] = cameraStartResult.startedCameraIds;
                        blockedDetails["started_count"] =
                            static_cast<int>(cameraStartResult.startedCameraIds.size());
                        blockedDetails["blocked_count"] =
                            static_cast<int>(admissionDecision.blockedCameras.size());
                        blockedDetails["partial_start"] = false;
                        if (!step.step_run_id.empty()) {
                            blockedDetails["step_run_id"] = step.step_run_id;
                        }

                        owner_->postAgentEvent(
                            "job_step_start_blocked",
                            std::nullopt,
                            J.user_id,
                            admissionDecision.message,
                            blockedDetails
                        );
                        postStepEvent_("job_step_skipped", J, step, json{
                            {"job_run_id", job->payload.job_run_id},
                            {"reason", "resource_admission_blocked"},
                            {"reason_code", admissionDecision.reasonCode},
                            {"device", admissionDecision.device},
                            {"blocked_cameras", blockedDetails["blocked_cameras"]}
                        });
                    }
                    else {
                        postStepEvent_("job_step_skipped", J, step, json{
                            {"job_run_id", job->payload.job_run_id},
                            {"reason", "camera_start_failed"},
                            {"error", cameraStartResult.error}
                        });
                    }
                    return;
                }

                std::unordered_set<int> startedCameraIds(
                    cameraStartResult.startedCameraIds.begin(),
                    cameraStartResult.startedCameraIds.end()
                );
                step.targets.erase(
                    std::remove_if(
                        step.targets.begin(),
                        step.targets.end(),
                        [&](const JobTarget& target) {
                            return startedCameraIds.find(target.camera_id) == startedCameraIds.end();
                        }
                    ),
                    step.targets.end()
                );

                std::unordered_set<int> activeTargetIds;
                activeTargetIds.reserve(step.targets.size());
                for (const auto& target : step.targets) {
                    activeTargetIds.insert(target.id);
                }

                for (auto& group : step.inference_groups) {
                    group.target_ids.erase(
                        std::remove_if(
                            group.target_ids.begin(),
                            group.target_ids.end(),
                            [&](int targetId) {
                                return activeTargetIds.find(targetId) == activeTargetIds.end();
                            }
                        ),
                        group.target_ids.end()
                    );
                }
                step.inference_groups.erase(
                    std::remove_if(
                        step.inference_groups.begin(),
                        step.inference_groups.end(),
                        [](const JobInferenceGroup& group) {
                            return group.target_ids.empty();
                        }
                    ),
                    step.inference_groups.end()
                );

                if (!admissionDecision.allowed) {
                    nlohmann::json blockedDetails =
                        owner_->resourceAdmissionDecisionToJson_(admissionDecision, "job");
                    blockedDetails["job_run_id"] = job->payload.job_run_id;
                    blockedDetails["job_id"] = J.id;
                    blockedDetails["job_name"] = J.name;
                    blockedDetails["step_id"] = step.id;
                    blockedDetails["step_name"] = step.name;
                    blockedDetails["step_order"] = step.step_order;
                    blockedDetails["started_camera_ids"] = cameraStartResult.startedCameraIds;
                    blockedDetails["started_count"] =
                        static_cast<int>(cameraStartResult.startedCameraIds.size());
                    blockedDetails["blocked_count"] =
                        static_cast<int>(admissionDecision.blockedCameras.size());
                    blockedDetails["partial_start"] =
                        !cameraStartResult.startedCameraIds.empty();
                    if (!step.step_run_id.empty()) {
                        blockedDetails["step_run_id"] = step.step_run_id;
                    }

                    owner_->postAgentEvent(
                        "job_step_start_blocked",
                        std::nullopt,
                        J.user_id,
                        admissionDecision.message,
                        blockedDetails
                    );
                }

                if (step.targets.empty()) {
                    run.state = JobInstance::StepState::Skipped;
                    run.cancel = true;
                    if (!admissionDecision.allowed) {
                        postStepEvent_("job_step_skipped", J, step, json{
                            {"job_run_id", job->payload.job_run_id},
                            {"reason", "resource_admission_blocked"},
                            {"reason_code", admissionDecision.reasonCode},
                            {"device", admissionDecision.device},
                            {
                                "blocked_cameras",
                                owner_->resourceAdmissionDecisionToJson_(
                                    admissionDecision,
                                    "job"
                                )["blocked_cameras"]
                            }
                        });
                    }
                    else {
                        postStepEvent_("job_step_skipped", J, step, json{
                            {"job_run_id", job->payload.job_run_id},
                            {"reason", "no_startable_cameras"}
                        });
                    }
                    return;
                }
            }

            {
                std::lock_guard<std::mutex> coverageLock(run.coverageMu);
                run.coverageByCamera.clear();
                for (const auto& tgt : step.targets) {
                    const JobAgentDef* selectedAgent = selectAgentForCamera_(step, tgt.camera_id);
                    if (!selectedAgent) {
                        continue;
                    }
                    std::string inputType = toLowerCopy(selectedAgent->input_type);
                    if (inputType == "image") {
                        continue;
                    }
                    auto& coverage = run.coverageByCamera[tgt.camera_id];
                    coverage.enabled = true;
                    coverage.anchorUtc = run.startedAtSystemUtc;
                    coverage.targetEndUtc = run.requiredCompletionEndUtc;
                    coverage.anchorUtcIso = run.startedAtSystemUtcIso;
                    coverage.targetEndUtcIso = run.requiredCompletionEndUtcIso;
                    coverage.coveredUntilUtcIso.clear();
                    coverage.latestCapturedUtcIso.clear();
                    coverage.firstGapStartUtcIso.clear();
                    coverage.coverageGapSeconds = (std::max)(
                        0LL,
                        std::chrono::duration_cast<std::chrono::seconds>(
                            run.requiredCompletionEndUtc - run.startedAtSystemUtc).count());
                    coverage.complete = false;
                    coverage.hasAnalysisAnchor = false;
                    coverage.analysisAnchorUtc = std::chrono::system_clock::time_point{};
                    coverage.hasAnalysisFrontier = false;
                    coverage.analysisFrontierUtc = std::chrono::system_clock::time_point{};
                    coverage.analysisAnchorUtcIso.clear();
                    coverage.analysisFrontierUtcIso.clear();
                    coverage.analysisLagSeconds = (std::max)(
                        0LL,
                        std::chrono::duration_cast<std::chrono::seconds>(
                            run.analysisTargetEndUtc - run.startedAtSystemUtc).count());
                    coverage.analysisComplete = false;
                    coverage.analysisStatus =
                        run.analysisDriven ? "waiting_for_analysis" : "legacy_deadline";
                    coverage.tracker.clear();
                    coverage.tracker.setCutoff(
                        std::optional<std::chrono::system_clock::time_point>(
                            coverage.targetEndUtc
                        )
                    );
                    run.coverageDriven = true;
                }
            }

            if (owner_) {
                for (const auto& tgt : step.targets) {
                    const int camId = tgt.camera_id;

                    const StepCaptureNeeds captureNeeds = stepCaptureNeedsForCamera_(step, camId);
                    if (captureNeeds.any()) {
                        const bool onlyCaptureOnMotion = stepOnlyCaptureOnMotionForCamera_(step, camId);
                        owner_->jobsCaptureAcquire(
                            camId,
                            job->payload.job.id,
                            step.id,
                            captureNeeds.video,
                            captureNeeds.image,
                            captureNeeds.requestedTenSecondVideoFps,
                            captureNeeds.requestedSixtySecondVideoFps,
                            onlyCaptureOnMotion
                        );
                    }
                }
            }

            postStepEvent_("job_step_started", J, step, json{
                {"job_run_id", job->payload.job_run_id},
                {"timeout_seconds", effectiveTimeoutSeconds},
                {"targets", (int)step.targets.size()},
                {"analysis_driven", run.analysisDriven},
                {"analysis_completion_mode", run.analysisCompletionMode},
                {"analysis_target_end_utc", run.analysisTargetEndUtcIso},
                {"analysis_target_source", run.analysisTargetSource},
                {"capture_deadline_utc", run.captureDeadlineUtcIso},
                {"hard_stop_deadline_utc", run.hardStopDeadlineUtcIso}
            });



            // ------------------------------------------------------------
            // Inference Groups: plan the step BEFORE spawning worker threads
            // 3.1) targetId -> cameraId
            // 3.2) build planned groups (group -> cameraIds)
            // 3.3) legacy targets (targets not included in any group)
            // ------------------------------------------------------------
            std::unordered_map<int, int> targetIdToCam;
            targetIdToCam.reserve(step.targets.size());
            for (const auto& t : step.targets) {
                targetIdToCam[t.id] = t.camera_id;
            }

            struct PlannedGroup {
                JobInferenceGroup g;
                std::vector<int> camera_ids;
            };

            std::vector<PlannedGroup> plannedGroups;
            std::unordered_set<int> camerasInAnyGroup;

            plannedGroups.reserve(step.inference_groups.size());
            for (const auto& g : step.inference_groups) {
                PlannedGroup pg;
                pg.g = g;
                for (int tid : g.target_ids) {
                    auto it = targetIdToCam.find(tid);
                    if (it != targetIdToCam.end()) {
                        pg.camera_ids.push_back(it->second);
                        camerasInAnyGroup.insert(it->second);
                    }
                }
                if (!pg.camera_ids.empty()) plannedGroups.push_back(std::move(pg));
            }

            std::vector<JobTarget> legacyTargets;
            legacyTargets.reserve(step.targets.size());
            for (const auto& t : step.targets) {
                if (!camerasInAnyGroup.count(t.camera_id)) {
                    legacyTargets.push_back(t);
                }
            }




            // One worker thread per target camera
            run.workers.clear();
            run.workers.reserve(plannedGroups.size() + legacyTargets.size());
            //run.workers.reserve(step.targets.size());


            // ------------------------------------------------------------
            // NEW: Group workers (1 thread per PlannedGroup)
            // For now: IMAGE group is fully supported (single request w/ multiple images).
            // VIDEO group can be added next (multi-mp4 inline_data).
            // ------------------------------------------------------------
            for (const auto& pg : plannedGroups) {
                run.workers.emplace_back([this, job, &run, &step, &stepsById, &captureWindowOpen, pg]() {
                    try {
                        const int jobId = job->payload.job.id;

                        // Build quick lookup cameraId -> cameraName for this step (for startCondition patterns)
                        auto cameraNameById = [&](int camId) -> std::string {
                            for (const auto& t : step.targets) {
                                if (t.camera_id == camId) return t.camera_name;
                            }
                            return "";
                            };

                    // Decide model tier for the GROUP: pick the "highest" among cameras (light < plus < pro)
                    auto tierRank = [&](const std::string& t) -> int {
                        std::string s = t;
                        for (auto& ch : s) ch = (char)std::tolower((unsigned char)ch);
                        if (s == "light") return 0;
                        if (s == "plus")  return 1;
                        return 2; // pro default
                        };
                    auto rankToTier = [&](int r) -> std::string {
                        if (r <= 0) return "light";
                        if (r == 1) return "plus";
                        return "pro";
                        };

                    int bestRank = 2; // default pro
                    bestRank = 0;     // start low, then max()
                    for (int camId : pg.camera_ids) {
                        std::string tier = "pro";
                        auto itP = job->payload.camera_start_payload_by_id.find(camId);
                        if (itP != job->payload.camera_start_payload_by_id.end()) {
                            try { tier = itP->second.value("model_tier", tier); }
                            catch (...) {}
                        }
                        bestRank = std::max(bestRank, tierRank(tier));
                    }
                    const std::string modelTier = rankToTier(bestRank);

                    // Build startConditionText for GROUP (explicit per camera)
                    auto buildStartConditionTextForGroup = [&]() -> std::string {
                        std::ostringstream oss;
                        bool first = true;
                        for (int camId : pg.camera_ids) {
                            const std::string camName = cameraNameById(camId);
                            for (const auto& hook : job->customStartHooks) {
                                if (hook.from_step_id != step.id) continue;

                                // If hook.pattern exists, it matches step target camera_name (your current logic)
                                if (!hook.pattern.empty() && hook.pattern != camName) continue;
                                if (hook.extract.empty()) continue;

                                if (!first) oss << "\n";
                                first = false;
                                oss << "FOR CAMERA_ID " << camId << ": If this condition is satisfied: "
                                    << hook.extract
                                    << " => set start_condition_step_id to "
                                    << hook.downstream_step_id;
                            }
                        }
                        return oss.str();
                        };

                    // Normalize group input type
                    std::string it = pg.g.input_type;
                    for (auto& ch : it) ch = (char)std::tolower((unsigned char)ch);
                    const bool isImageGroup = (it == "image");
                    const std::string inferenceModel = normalizeInferenceModel_(pg.g.inference_model);
                    const bool useOpenAI = isOpenAIInferenceModel_(inferenceModel);
                    const bool useCore = isCoreInferenceModel_(inferenceModel);
                    const std::string openAiModelName = openAIModelNameForInferenceModel_(inferenceModel);
                    const std::string modelApiKey = pg.g.api_key;
                    const int runEverySeconds = useCore ? 60 : normalizeRunEverySeconds_(pg.g.run_every_seconds);
                    auto lastRunAt = std::chrono::steady_clock::time_point::min();
                    const bool useRunEverySchedulerGate = true;
                    const bool stampRunTickBeforeInference = !isImageGroup;

                        while (!job->cancel &&
                               !run.cancel &&
                               captureWindowOpen(run)) {
                            const auto nowTick = std::chrono::steady_clock::now();
                            if (useRunEverySchedulerGate &&
                                lastRunAt != std::chrono::steady_clock::time_point::min()) {
                                const auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(nowTick - lastRunAt).count();
                                if (elapsed < runEverySeconds) {
                                    std::this_thread::sleep_for(std::chrono::milliseconds(200));
                                    continue;
                                }
                            }
                            if (stampRunTickBeforeInference) {
                                lastRunAt = nowTick;
                            }

                        const std::string startConditionText = buildStartConditionTextForGroup();

                        // -------------------------------
                        // IMAGE GROUP (single Gemini request)
                        // -------------------------------
                        if (isImageGroup) {
                            if (useCore) {
                                Logger::instance().logDebug(
                                    "job",
                                    "Group image inference skipped: core model requires video input for group " + pg.g.id
                                );
                                std::this_thread::sleep_for(std::chrono::seconds(1));
                                continue;
                            }
                            if (!owner_) break;

                            std::vector<GroupImageInput> inputs;
                            std::unordered_map<int, std::string> jpegByCam;
                            std::unordered_map<int, ClipBoundaryFrames_> clipBoundaryFramesByCamera;
                            inputs.reserve(pg.camera_ids.size());
                            jpegByCam.reserve(pg.camera_ids.size());
                            clipBoundaryFramesByCamera.reserve(pg.camera_ids.size());
                            struct ClaimedClip {
                                int cameraId = -1;
                                std::string originalPath;
                                std::string processingPath;
                                std::string clipKey;
                            };
                            struct ClaimedClipsGuard {
                                std::vector<ClaimedClip> claimed;
                                bool consume = false; // true => delete .processing ; false => rollback rename
                                ~ClaimedClipsGuard() {
                                    for (const auto& c : claimed) {
                                        std::error_code ec;
                                        if (consume) {
                                            fs::remove(fs::path(c.processingPath), ec);
                                        }
                                        else {
                                            fs::rename(fs::path(c.processingPath), fs::path(c.originalPath), ec);
                                        }
                                    }
                                }
                            } claimedClipsGuard;

                            std::vector<int> configuredCameraIds;
                            configuredCameraIds.reserve(pg.camera_ids.size());
                            std::unordered_set<int> configuredCameraSet;
                            for (int id : pg.camera_ids) {
                                if (id <= 0) continue;
                                if (configuredCameraSet.insert(id).second) {
                                    configuredCameraIds.push_back(id);
                                }
                            }

                            std::vector<int> onlineCameraIds;
                            std::vector<int> offlineCameraIds;
                            onlineCameraIds.reserve(configuredCameraIds.size());
                            offlineCameraIds.reserve(configuredCameraIds.size());

                            for (int camId : configuredCameraIds) {
                                const bool isOnlineNow = owner_ ? owner_->isCameraStreamOnline(camId) : false;
                                if (isOnlineNow) {
                                    onlineCameraIds.push_back(camId);
                                }
                                else {
                                    offlineCameraIds.push_back(camId);
                                }
                            }

                            if (onlineCameraIds.empty()) {
                                std::this_thread::sleep_for(std::chrono::seconds(1));
                                continue;
                            }

                            auto loadCachedGroupResultForCamera = [&](int camId, json& outCached) -> bool {
                                outCached = json();
                                std::string raw;
                                {
                                    std::lock_guard<std::mutex> lk(job->outputsMu);
                                    auto soIt = job->outputs.find(step.id);
                                    if (soIt == job->outputs.end()) return false;
                                    auto it = soIt->second.last_output_by_camera.find(camId);
                                    if (it == soIt->second.last_output_by_camera.end()) return false;
                                    raw = it->second;
                                }

                                if (raw.empty() || !isLikelyJson_(raw)) return false;
                                json parsed = json::parse(raw, nullptr, false);
                                if (!parsed.is_object()) return false;
                                outCached = std::move(parsed);
                                return true;
                            };

                            std::unordered_map<int, bool> hasCachedGroupOutputByCamera;
                            hasCachedGroupOutputByCamera.reserve(onlineCameraIds.size());

                            bool requireFullInitialInference = false;
                            for (int camId : onlineCameraIds) {
                                json cached;
                                const bool hasCached = loadCachedGroupResultForCamera(camId, cached);
                                hasCachedGroupOutputByCamera[camId] = hasCached;
                                if (!hasCached) {
                                    requireFullInitialInference = true;
                                }
                            }
                            std::vector<ClaimedClip> pendingClaims;
                            pendingClaims.reserve(onlineCameraIds.size());
                            struct PendingImageKey {
                                int cameraId = -1;
                                std::string key;
                            };
                            std::vector<PendingImageKey> pendingImageKeys;
                            pendingImageKeys.reserve(onlineCameraIds.size());
                            std::vector<GroupImageInput> fallbackStillInputs;
                            fallbackStillInputs.reserve(onlineCameraIds.size());
                            bool missingRequiredCameraClip = false;

                            auto tryBuildLiveStillInputForCamera = [&](int camId, bool waitForFreshWarmup, GroupImageInput& out) -> bool {
                                if (!owner_) return false;
                                CameraSession* sess = owner_->getCameraSession(camId);
                                if (!sess) return false;

                                const auto t0 = std::chrono::steady_clock::now();
                                const auto kPollInterval = std::chrono::milliseconds(250);
                                const auto kWarmupMinWait = waitForFreshWarmup ? std::chrono::seconds(3) : std::chrono::seconds(0);
                                const auto kWarmupMaxWait = waitForFreshWarmup ? std::chrono::seconds(14) : std::chrono::seconds(2);

                                GroupImageInput best{};
                                bool haveBest = false;
                                std::string firstValidStillKey;

                                while ((std::chrono::steady_clock::now() - t0) <= kWarmupMaxWait) {
                                    const std::string stillB64 = sess->getLastJobStillJpegBase64();
                                    const std::string stillTs = sess->getLastJobStillTsUtcIso();

                                    std::string healthErr;
                                    if (!stillB64.empty() && isHealthyStillJpegBase64_(stillB64, &healthErr)) {
                                        const std::string stillKey = makeJobStillKey_(stillTs, stillB64);

                                        GroupImageInput candidate{};
                                        candidate.cameraId = camId;
                                        candidate.cameraName = cameraNameById(camId);
                                        candidate.snapshotTsUtcIso = stillTs;
                                        candidate.jpegBase64 = stillB64;
                                        candidate.sourceTag = "still_live";
                                        best = std::move(candidate);
                                        haveBest = true;

                                        if (firstValidStillKey.empty()) {
                                            firstValidStillKey = stillKey;
                                        }

                                        const auto elapsed = std::chrono::steady_clock::now() - t0;
                                        if (!waitForFreshWarmup) {
                                            out = std::move(best);
                                            out.injectedInput = resolvePipelineInputsForCamera_(job, step, camId, stepsById);
                                            return true;
                                        }

                                        const bool waitedEnough = elapsed >= kWarmupMinWait;
                                        const bool advancedStill =
                                            !firstValidStillKey.empty() &&
                                            stillKey != firstValidStillKey;
                                        if (waitedEnough && (advancedStill || elapsed >= kWarmupMaxWait)) {
                                            out = std::move(best);
                                            out.injectedInput = resolvePipelineInputsForCamera_(job, step, camId, stepsById);
                                            return true;
                                        }
                                    }

                                    if ((std::chrono::steady_clock::now() - t0) >= kWarmupMaxWait) {
                                        break;
                                    }
                                    std::this_thread::sleep_for(kPollInterval);
                                }

                                if (haveBest) {
                                    out = std::move(best);
                                    out.injectedInput = resolvePipelineInputsForCamera_(job, step, camId, stepsById);
                                    return true;
                                }
                                return false;
                            };

                            // 1) Gather one pending 10s clip per ONLINE camera (without consuming yet).
                            for (int camId : onlineCameraIds) {
                                // First snapshot per camera in grouped image inference is always from live still.
                                // This keeps the first group baseline as current as possible.
                                bool needsInitialStill = true;
                                auto itCached = hasCachedGroupOutputByCamera.find(camId);
                                if (itCached != hasCachedGroupOutputByCamera.end()) {
                                    needsInitialStill = !itCached->second;
                                }
                                if (needsInitialStill) {
                                    GroupImageInput liveStill;
                                    if (!tryBuildLiveStillInputForCamera(camId, /*waitForFreshWarmup*/ true, liveStill)) {
                                        missingRequiredCameraClip = true;
                                        break;
                                    }
                                    fallbackStillInputs.push_back(std::move(liveStill));
                                    continue;
                                }

                                auto imageOpt = getNewestJobsImageForCamera(jobId, step.id, std::to_string(camId));
                                if (imageOpt) {
                                    fs::path imagePath = fs::path(*imageOpt);
                                    const std::string imageKey = makeMonotonicImageKey_(imagePath);
                                    if (isNewerClipForJobStepCamera_(jobId, step.id, camId, imageKey)) {
                                        GroupImageInput diskSnapshot;
                                        std::string imageErr;
                                        if (encodeImageFileAsJpegDataUrl_(imagePath, diskSnapshot.jpegBase64, &imageErr) &&
                                            !diskSnapshot.jpegBase64.empty())
                                        {
                                            diskSnapshot.cameraId = camId;
                                            diskSnapshot.cameraName = cameraNameById(camId);
                                            diskSnapshot.sourceTag = "snapshot_disk";
                                            diskSnapshot.injectedInput =
                                                resolvePipelineInputsForCamera_(job, step, camId, stepsById);
                                            fallbackStillInputs.push_back(std::move(diskSnapshot));
                                            pendingImageKeys.push_back(PendingImageKey{ camId, imageKey });
                                            continue;
                                        }
                                        Logger::instance().logDebug(
                                            "job",
                                            "Group image inference: failed reading snapshot cameraId=" +
                                            std::to_string(camId) + " path=" + imagePath.string() +
                                            " err=" + imageErr
                                        );
                                    }
                                }

                                auto clipOpt = getNextReadyJobsClipForCamera_(jobId, step.id, camId);
                                if (!clipOpt) {
                                    continue;
                                }
                                ClaimedClip cc;
                                cc.cameraId = camId;
                                cc.originalPath = *clipOpt;
                                cc.clipKey = makeMonotonicClipKey_(fs::path(cc.originalPath));
                                if (!isNewerClipForJobStepCamera_(jobId, step.id, camId, cc.clipKey)) {
                                    continue;
                                }
                                pendingClaims.push_back(std::move(cc));
                            }

                            if (missingRequiredCameraClip) {
                                std::this_thread::sleep_for(std::chrono::seconds(1));
                                continue;
                            }

                            // 2) Claim all clips atomically-like (best effort). If one fails, rollback previous claims.
                            bool claimFailed = false;
                            for (auto& cc : pendingClaims) {
                                std::error_code renEc;
                                fs::path pth = fs::path(cc.originalPath);
                                fs::path processing = pth;
                                processing += ".processing";
                                fs::rename(pth, processing, renEc);
                                if (renEc) {
                                    claimFailed = true;
                                    break;
                                }
                                cc.processingPath = processing.string();
                                claimedClipsGuard.claimed.push_back(cc);
                            }

                            if (claimFailed || claimedClipsGuard.claimed.size() != pendingClaims.size()) {
                                std::this_thread::sleep_for(std::chrono::seconds(1));
                                continue;
                            }

                            // 3) Extract one frame from each claimed clip.
                            bool extractionFailed = false;
                            for (const auto& cc : claimedClipsGuard.claimed) {
                                GroupImageInput gi;
                                gi.cameraId = cc.cameraId;
                                gi.cameraName = cameraNameById(cc.cameraId);
                                parseClipEndTsUtcIsoFromPath_(fs::path(cc.processingPath), gi.snapshotTsUtcIso);
                                gi.sourceTag = "clip_last_frame";

                                std::string extractErr;
                                ClipBoundaryFrames_ boundaryFrames;
                                if (!extractClipBoundaryFramesFromMp4_(fs::path(cc.processingPath), boundaryFrames, &extractErr) ||
                                    !encodeMatAsJpegDataUrl_(boundaryFrames.lastFrame, gi.jpegBase64, &extractErr) ||
                                    gi.jpegBase64.empty())
                                {
                                    Logger::instance().logDebug(
                                        "job",
                                        "Group image inference: failed extracting frame for camera " +
                                        std::to_string(cc.cameraId) + " clip=" + cc.processingPath + " err=" + extractErr
                                    );
                                    extractionFailed = true;
                                    break;
                                }

                                gi.injectedInput = resolvePipelineInputsForCamera_(job, step, cc.cameraId, stepsById);
                                jpegByCam[cc.cameraId] = gi.jpegBase64;
                                clipBoundaryFramesByCamera[cc.cameraId] = std::move(boundaryFrames);
                                inputs.push_back(std::move(gi));
                            }

                            if (!extractionFailed) {
                                for (auto& gi : fallbackStillInputs) {
                                    jpegByCam[gi.cameraId] = gi.jpegBase64;
                                    inputs.push_back(std::move(gi));
                                }
                            }

                            if (extractionFailed) {
                                std::this_thread::sleep_for(std::chrono::seconds(1));
                                continue;
                            }
                            std::unordered_map<int, std::unordered_map<std::string, std::string>> alertRegionLabelByIdByCamera;
                            std::unordered_map<int, std::vector<std::string>> motionTriggeredRegionIdsByCamera;
                            std::unordered_map<int, std::vector<std::string>> overlayRegionIdsByCamera;
                            if (!inputs.empty()) {
                                std::unordered_map<int, std::string> clipPathByCamera;
                                for (const auto& cc : claimedClipsGuard.claimed) {
                                    if (cc.cameraId <= 0 || cc.processingPath.empty()) continue;
                                    clipPathByCamera[cc.cameraId] = cc.processingPath;
                                }

                                std::vector<GroupImageInput> filteredInputs;
                                filteredInputs.reserve(inputs.size());
                                for (auto& gi : inputs) {
                                    // Groups run as full-frame only: ROI/polygon is ignored by design.
                                    alertRegionLabelByIdByCamera[gi.cameraId] = {
                                        {"full-frame", "Full frame"}
                                    };

                                    const bool enforceGroupMotionGate = pg.g.only_capture_on_motion;
                                    bool regionMotionDetected = true;
                                    std::vector<std::string> motionTriggeredRegionIds;
                                    if (enforceGroupMotionGate) {
                                        std::vector<JobAnalysisRegion> motionRegions;
                                        motionRegions.push_back(buildSyntheticFullFrameMotionRegion_());

                                        regionMotionDetected = false;
                                        std::string motionErr;
                                        bool motionDetected = false;
                                        if (gi.sourceTag == "clip_last_frame") {
                                            auto itFrames = clipBoundaryFramesByCamera.find(gi.cameraId);
                                            if (itFrames != clipBoundaryFramesByCamera.end()) {
                                                if (detectMotionInAnyRegionFromBoundaryFrames_(
                                                        itFrames->second,
                                                        motionRegions,
                                                        motionDetected,
                                                        &motionTriggeredRegionIds,
                                                        &motionErr))
                                                {
                                                    regionMotionDetected = motionDetected;
                                                }
                                                else {
                                                    Logger::instance().logDebug(
                                                        "job",
                                                        "Group image inference: full-frame motion check failed cameraId=" +
                                                        std::to_string(gi.cameraId) + " err=" + motionErr +
                                                        " region_count=" + std::to_string(motionRegions.size())
                                                    );
                                                }
                                            }
                                            else {
                                                auto itClip = clipPathByCamera.find(gi.cameraId);
                                                if (itClip != clipPathByCamera.end()) {
                                                    if (detectMotionInAnyRegionFromClip_(
                                                            fs::path(itClip->second),
                                                            motionRegions,
                                                            motionDetected,
                                                            &motionTriggeredRegionIds,
                                                            &motionErr))
                                                    {
                                                        regionMotionDetected = motionDetected;
                                                    }
                                                    else {
                                                        Logger::instance().logDebug(
                                                            "job",
                                                            "Group image inference: full-frame motion check failed cameraId=" +
                                                            std::to_string(gi.cameraId) + " err=" + motionErr +
                                                            " region_count=" + std::to_string(motionRegions.size())
                                                        );
                                                    }
                                                }
                                                else {
                                                    Logger::instance().logDebug(
                                                        "job",
                                                        "Group image inference: missing clip for full-frame motion check cameraId=" +
                                                        std::to_string(gi.cameraId) + " region_count=" +
                                                        std::to_string(motionRegions.size())
                                                    );
                                                }
                                            }
                                        }
                                        else {
                                            cv::Mat stillFrame;
                                            if (!decodeJpegDataUrlToMat_(gi.jpegBase64, stillFrame, &motionErr) || stillFrame.empty()) {
                                                Logger::instance().logDebug(
                                                    "job",
                                                    "Group image inference: still-motion decode failed cameraId=" +
                                                    std::to_string(gi.cameraId) + " source=" + gi.sourceTag +
                                                    " err=" + motionErr
                                                );
                                            }
                                            else {
                                                const std::string motionSlot =
                                                    "group|" + std::to_string(jobId) +
                                                    "|" + std::to_string(step.id) +
                                                    "|" + pg.g.id +
                                                    "|" + std::to_string(gi.cameraId);
                                                if (detectMotionInAnyRegionFromStillHistory_(
                                                        motionSlot,
                                                        stillFrame,
                                                        motionRegions,
                                                        motionDetected,
                                                        &motionTriggeredRegionIds,
                                                        &motionErr))
                                                {
                                                    regionMotionDetected = motionDetected;
                                                }
                                                else {
                                                    Logger::instance().logDebug(
                                                        "job",
                                                        "Group image inference: full-frame still-motion check failed cameraId=" +
                                                        std::to_string(gi.cameraId) + " err=" + motionErr +
                                                        " source=" + gi.sourceTag +
                                                        " region_count=" + std::to_string(motionRegions.size())
                                                    );
                                                }
                                            }
                                        }
                                    }

                                    if (!regionMotionDetected) {
                                        Logger::instance().logDebug(
                                            "job",
                                            "Group image inference: skipped camera due no region motion cameraId=" +
                                            std::to_string(gi.cameraId)
                                        );
                                        continue;
                                    }

                                    // Internal full-frame gate id must not surface as alert region id.
                                    motionTriggeredRegionIds.clear();

                                    if (!motionTriggeredRegionIds.empty()) {
                                        motionTriggeredRegionIdsByCamera[gi.cameraId] =
                                            std::move(motionTriggeredRegionIds);
                                    }

                                    gi.regionId = "full-frame";
                                    gi.regionLabel = "Full frame";
                                    gi.fullFrame = true;
                                    jpegByCam[gi.cameraId] = gi.jpegBase64;
                                    filteredInputs.push_back(std::move(gi));
                                }

                                inputs.swap(filteredInputs);
                            }
                            if (requireFullInitialInference && inputs.size() != onlineCameraIds.size()) {
                                std::this_thread::sleep_for(std::chrono::seconds(1));
                                continue;
                            }

                            const bool llmExecuted = !inputs.empty();

                            // 1 request for the group (only changed cameras)
                            int pt = 0, ot = 0, tt = 0;
                            VideoHit hit;
                            const std::vector<FaceReferenceImage> groupFaceReferences =
                                resolveFaceReferenceImagesForJob_(owner_, pg.g.face_targets);
                            const std::vector<NegativeReferenceImage> groupNegativeReferences =
                                resolveNegativeReferenceImagesForJob_(
                                    owner_,
                                    pg.g.negative_reference_images
                                );
                            const bool groupFaceIdOnlyMode = isFaceIdOnlyMode_(
                                pg.g.prompt_template,
                                pg.g.alert_condition_text,
                                pg.g.face_targets
                            );
                            const std::vector<std::string> configuredGroupFaceTargetNames =
                                collectFaceTargetDisplayNames_(pg.g.face_targets);
                            const std::string groupPromptForInference = buildInferencePrompt_(
                                pg.g.prompt_template,
                                pg.g.alert_condition_text,
                                pg.g.negative_condition_text,
                                /*injectedInput*/ "",
                                pg.g.face_targets,
                                pg.g.negative_reference_images
                            );
                            if (llmExecuted) {
                                if (useOpenAI) {
                                    if (modelApiKey.empty()) {
                                        Logger::instance().logDebug(
                                            "job",
                                            "Group inference skipped: missing OpenAI api_key for group " + pg.g.id
                                        );
                                        std::this_thread::sleep_for(std::chrono::seconds(1));
                                        continue;
                                    }
                                    hit = owner_->callOpenAIVisionImageGroupJOB_(
                                        inputs,
                                        /*groupPrompt*/ groupPromptForInference,
                                        groupFaceReferences,
                                        groupNegativeReferences,
                                        /*alertConditionText*/ pg.g.alert_condition_text,
                                        /*startConditionText*/ startConditionText,
                                        /*openAiModelName*/ openAiModelName,
                                        /*openAiApiKey*/ modelApiKey,
                                        pt, ot, tt
                                    );
                                }
                                else {
                                    hit = owner_->callGeminiVisionImageGroupJOB_(
                                        inputs,
                                        /*groupPrompt*/ groupPromptForInference,
                                        groupFaceReferences,
                                        groupNegativeReferences,
                                        /*alertConditionText*/ pg.g.alert_condition_text,
                                        /*startConditionText*/ startConditionText,
                                        /*modelTier*/ modelTier,
                                        /*geminiApiKey*/ modelApiKey,
                                        pt, ot, tt
                                    );
                                }

                                enqueueJobTokenUsageAsync(
                                    owner_,
                                    jobId,
                                    step.id,
                                    -1,
                                    pt,
                                    ot,
                                    tt,
                                    normalizeInferenceModel_(pg.g.inference_model),
                                    pg.g.agent_key
                                );

                                // Group inference was executed for these clips: consume them now.
                                claimedClipsGuard.consume = true;
                                for (const auto& cc : claimedClipsGuard.claimed) {
                                    markClipConsumedForJobStepCamera_(jobId, step.id, cc.cameraId, cc.clipKey);
                                }
                                for (const auto& ik : pendingImageKeys) {
                                    if (ik.cameraId <= 0 || ik.key.empty()) continue;
                                    markClipConsumedForJobStepCamera_(jobId, step.id, ik.cameraId, ik.key);
                                }
                            }

                            const JobAgentDef virtAgent = agentFromGroup_(pg.g);

                            json outJ;
                            if (llmExecuted) {
                                // Split model results per camera
                                if (hit.answer.empty() || !isLikelyJson_(hit.answer)) {
                                    std::this_thread::sleep_for(std::chrono::seconds(1));
                                    continue;
                                }

                                outJ = json::parse(hit.answer);
                                if (!outJ.contains("results") || !outJ["results"].is_array()) {
                                    std::this_thread::sleep_for(std::chrono::seconds(1));
                                    continue;
                                }
                            }
                            else {
                                outJ["results"] = json::array();
                            }

                            try {

                                // camera_id -> target_id (step-local), so backend can fetch relevant images by target id
                                auto targetIdForCamera = [&](int camId) -> int {
                                    for (const auto& t : step.targets) {
                                        if (t.camera_id == camId) return t.id;
                                    }
                                    return -1;
                                };

                                std::vector<int> expectedCameraIds = onlineCameraIds;
                                std::unordered_set<int> expectedCameraSet(
                                    expectedCameraIds.begin(),
                                    expectedCameraIds.end()
                                );
                                std::unordered_set<int> offlineCameraSet(
                                    offlineCameraIds.begin(),
                                    offlineCameraIds.end()
                                );

                                std::unordered_set<int> respondedCameraSet;
                                std::unordered_set<int> llmRespondedCameraSet;
                                std::unordered_set<int> alertCameraSet;
                                json normResults = json::array();
                                std::vector<std::string> groupAnswerParts;

                                for (auto& r : outJ["results"]) {
                                    if (!r.is_object()) continue;

                                    const int camId = r.value("camera_id", -1);
                                    if (camId < 0) continue;
                                    if (!expectedCameraSet.count(camId)) continue;

                                    // Keep provenance
                                    r["agent_key"] = virtAgent.agent_key;

                                    r["group_id"] = pg.g.id;
                                    r["group_name"] = pg.g.name;
                                    r["result_source"] = "llm";

                                    // IMPORTANT: allow maybeFireAlerts_() to save an alert image
                                    // by embedding the snapshot base64 into the per-camera JSON output.
                                    // Only attach when alert_condition is true (so you store only important images).
                                    const bool faceIdMatch = r.value("faceid_match", false);
                                    std::vector<std::string> matchedFaceNames = parseFaceIdTargetNamesFromJsonNode_(r);
                                    if (faceIdMatch && matchedFaceNames.empty()) {
                                        matchedFaceNames = configuredGroupFaceTargetNames;
                                    }
                                    if (!matchedFaceNames.empty()) {
                                        r["faceid_target_names"] = matchedFaceNames;
                                    }
                                    bool alert = r.value("alert_condition", false);
                                    if (groupFaceIdOnlyMode) {
                                        alert = faceIdMatch;
                                        r["alert_condition"] = alert;
                                        r["answer"] = buildFaceIdOnlyShortAnswer_(faceIdMatch, matchedFaceNames);
                                    }
                                    else if (faceIdMatch) {
                                        alert = true;
                                        r["alert_condition"] = true;
                                    }

                                    std::unordered_map<std::string, std::string> allowedRegionLabels;
                                    {
                                        auto itAllowed = alertRegionLabelByIdByCamera.find(camId);
                                        if (itAllowed != alertRegionLabelByIdByCamera.end()) {
                                            allowedRegionLabels = itAllowed->second;
                                        }
                                    }
                                    if (allowedRegionLabels.empty()) {
                                        allowedRegionLabels["full-frame"] = "Full frame";
                                    }

                                    const std::vector<std::string> rawAlertRegionIds =
                                        parseAlertRegionIdsFromJsonNode_(r);
                                    std::vector<std::string> rejectedAlertRegionIds;
                                    std::vector<std::string> sanitizedAlertRegionIds =
                                        sanitizeAlertRegionIds_(
                                            rawAlertRegionIds,
                                            allowedRegionLabels,
                                            &rejectedAlertRegionIds
                                        );
                                    if (alert &&
                                        sanitizedAlertRegionIds.empty() &&
                                        rawAlertRegionIds.empty() &&
                                        allowedRegionLabels.size() == 1 &&
                                        allowedRegionLabels.find("full-frame") != allowedRegionLabels.end())
                                    {
                                        sanitizedAlertRegionIds.push_back("full-frame");
                                    }
                                    r["alert_region_ids"] = sanitizedAlertRegionIds;
                                    r["alert_region_names"] =
                                        mapRegionIdsToNames_(sanitizedAlertRegionIds, allowedRegionLabels);
                                    r["motion_trigger_region_ids"] = json::array();
                                    r["motion_trigger_region_names"] = json::array();

                                    auto itMotionIds = motionTriggeredRegionIdsByCamera.find(camId);
                                    if (itMotionIds != motionTriggeredRegionIdsByCamera.end() &&
                                        !itMotionIds->second.empty())
                                    {
                                        const std::vector<std::string> sanitizedMotionRegionIds =
                                            sanitizeAlertRegionIds_(itMotionIds->second, allowedRegionLabels, nullptr);
                                        if (!sanitizedMotionRegionIds.empty()) {
                                            r["motion_trigger_region_ids"] = sanitizedMotionRegionIds;
                                            r["motion_trigger_region_names"] =
                                                mapRegionIdsToNames_(sanitizedMotionRegionIds, allowedRegionLabels);
                                        }
                                    }

                                    auto itOverlayIds = overlayRegionIdsByCamera.find(camId);
                                    if (itOverlayIds != overlayRegionIdsByCamera.end() &&
                                        !itOverlayIds->second.empty())
                                    {
                                        const std::vector<std::string> sanitizedOverlayIds =
                                            sanitizeAlertRegionIds_(itOverlayIds->second, allowedRegionLabels, nullptr);
                                        if (!sanitizedOverlayIds.empty()) {
                                            r["overlay_region_ids"] = sanitizedOverlayIds;
                                        }
                                    }

                                    if (!rejectedAlertRegionIds.empty()) {
                                        Logger::instance().logDebug(
                                            "job",
                                            "Group inference: dropped invalid alert_region_ids cameraId=" +
                                            std::to_string(camId) + " dropped_count=" +
                                            std::to_string(rejectedAlertRegionIds.size())
                                        );
                                    }
                                    if (alert) {
                                        auto it = jpegByCam.find(camId);
                                        if (it != jpegByCam.end() && !it->second.empty()) {
                                            r["image_jpeg_b64"] = it->second; // can be data URL or raw base64; your writer should handle both
                                        }
                                    }
                                    normResults.push_back(r);
                                    respondedCameraSet.insert(camId);
                                    llmRespondedCameraSet.insert(camId);
                                    if (alert) {
                                        alertCameraSet.insert(camId);
                                        const std::string camAnswer = r.value("answer", "");
                                        if (!camAnswer.empty()) {
                                            groupAnswerParts.push_back(
                                                "camera_id=" + std::to_string(camId) + ": " + camAnswer
                                            );
                                        }
                                    }

                                    const std::string one = r.dump();

                                    std::string fallbackImageDataUrl;
                                    auto liveImageIt = jpegByCam.find(camId);
                                    if (liveImageIt != jpegByCam.end()) {
                                        fallbackImageDataUrl = liveImageIt->second;
                                    }
                                    persistDailyReportExecutionArtifacts_(
                                        owner_,
                                        job->payload,
                                        step,
                                        camId,
                                        virtAgent,
                                        one,
                                        fallbackImageDataUrl,
                                        true
                                    );

                                    {
                                        std::lock_guard<std::mutex> lk(job->outputsMu);
                                        StepOutput& so = job->outputs[step.id];
                                        so.last_output_by_camera[camId] = one;
                                        so.history_by_camera[camId].push_back(one);
                                        so.aggregated_output = one; // keep last
                                    }

                                    // Trigger downstream custom step if signaled
                                    try {
                                        if (r.contains("start_condition_step_id") && r["start_condition_step_id"].is_number_integer()) {
                                            int sidToStart = r["start_condition_step_id"].get<int>();
                                            std::lock_guard<std::mutex> lk2(job->triggeredMu);
                                            job->triggeredStartStepIds.insert(sidToStart);
                                        }
                                    }
                                    catch (...) {}
                                }

                                // Merge unchanged cameras from cache.
                                for (int camId : expectedCameraIds) {
                                    if (respondedCameraSet.count(camId)) continue;

                                    json cached;
                                    if (!loadCachedGroupResultForCamera(camId, cached)) continue;
                                    if (!cached.is_object()) continue;

                                    cached["camera_id"] = camId;
                                    cached["agent_key"] = virtAgent.agent_key;
                                    cached["group_id"] = pg.g.id;
                                    cached["group_name"] = pg.g.name;
                                    cached["result_source"] = "cache";
                                    if (!cached.contains("alert_region_ids") || !cached["alert_region_ids"].is_array()) {
                                        cached["alert_region_ids"] = json::array();
                                    }
                                    if (!cached.contains("alert_region_names") || !cached["alert_region_names"].is_array()) {
                                        cached["alert_region_names"] = json::array();
                                    }
                                    if (!cached.contains("motion_trigger_region_ids") || !cached["motion_trigger_region_ids"].is_array()) {
                                        cached["motion_trigger_region_ids"] = json::array();
                                    }
                                    if (!cached.contains("motion_trigger_region_names") || !cached["motion_trigger_region_names"].is_array()) {
                                        cached["motion_trigger_region_names"] = json::array();
                                    }

                                    const bool cachedAlert = cached.value("alert_condition", false);
                                    if (cachedAlert) {
                                        alertCameraSet.insert(camId);
                                        const std::string camAnswer = cached.value("answer", "");
                                        if (!camAnswer.empty()) {
                                            groupAnswerParts.push_back(
                                                "camera_id=" + std::to_string(camId) + ": " + camAnswer
                                            );
                                        }
                                    }

                                    normResults.push_back(std::move(cached));
                                    respondedCameraSet.insert(camId);
                                }

                                std::vector<int> respondedCameraIds;
                                std::vector<int> alertCameraIds;
                                std::vector<int> alertTargetIds;
                                std::vector<int> llmExecutedCameraIds;
                                std::vector<int> cachedCameraIds;
                                respondedCameraIds.reserve(expectedCameraIds.size());
                                alertCameraIds.reserve(expectedCameraIds.size());
                                alertTargetIds.reserve(expectedCameraIds.size());
                                llmExecutedCameraIds.reserve(expectedCameraIds.size());
                                cachedCameraIds.reserve(expectedCameraIds.size());

                                for (int camId : expectedCameraIds) {
                                    if (respondedCameraSet.count(camId)) {
                                        respondedCameraIds.push_back(camId);
                                    }
                                    if (alertCameraSet.count(camId)) {
                                        alertCameraIds.push_back(camId);
                                        const int tid = targetIdForCamera(camId);
                                        if (tid >= 0) alertTargetIds.push_back(tid);
                                    }
                                    if (llmRespondedCameraSet.count(camId)) {
                                        llmExecutedCameraIds.push_back(camId);
                                    }
                                    else if (respondedCameraSet.count(camId)) {
                                        cachedCameraIds.push_back(camId);
                                    }
                                }

                                json regionAuditByCamera = json::array();
                                if (normResults.is_array()) {
                                    for (const auto& item : normResults) {
                                        if (!item.is_object()) continue;
                                        json one = json::object();
                                        if (item.contains("camera_id")) one["camera_id"] = item["camera_id"];
                                        if (item.contains("alert_condition")) one["alert_condition"] = item["alert_condition"];
                                        if (item.contains("alert_region_ids")) one["alert_region_ids"] = item["alert_region_ids"];
                                        if (item.contains("alert_region_names")) one["alert_region_names"] = item["alert_region_names"];
                                        if (item.contains("motion_trigger_region_ids")) one["motion_trigger_region_ids"] = item["motion_trigger_region_ids"];
                                        if (item.contains("motion_trigger_region_names")) one["motion_trigger_region_names"] = item["motion_trigger_region_names"];
                                        if (item.contains("overlay_region_ids")) one["overlay_region_ids"] = item["overlay_region_ids"];
                                        if (!one.empty()) {
                                            regionAuditByCamera.push_back(std::move(one));
                                        }
                                    }
                                }

                                const bool allResponded = !expectedCameraIds.empty() &&
                                    respondedCameraIds.size() == expectedCameraIds.size();
                                const bool allTrue = allResponded &&
                                    alertCameraIds.size() == expectedCameraIds.size();
                                const bool groupAlertReady =
                                    allTrue && !expectedCameraIds.empty() && !llmExecutedCameraIds.empty();
                                bool groupValidatorExecuted = false;
                                bool groupValidatorAlertCondition = false;
                                int groupValidatorPromptTokens = 0;
                                int groupValidatorOutputTokens = 0;
                                int groupValidatorTotalTokens = 0;

                                // First pass requires a complete baseline (all ONLINE cameras analyzed by LLM).
                                if (requireFullInitialInference && !allResponded) {
                                    std::this_thread::sleep_for(std::chrono::seconds(1));
                                    continue;
                                }

                                // Fire ONE alert for the group when all ONLINE cameras in the group are true.
                                // Also require at least one fresh LLM response in this cycle to avoid stale alert replay.
                                if (groupAlertReady) {
                                    const bool validatedGroupAlert = true;
                                    if (validatedGroupAlert) {
                                        const int primaryCameraId = expectedCameraIds.front();

                                        std::string groupAnswer;
                                        for (size_t i = 0; i < groupAnswerParts.size(); ++i) {
                                            if (i > 0) groupAnswer += "\n";
                                            groupAnswer += groupAnswerParts[i];
                                        }

                                        json groupAlert;
                                        groupAlert["alert_condition"] = true;
                                        groupAlert["input_type"] = "image";
                                        groupAlert["group_id"] = pg.g.id;
                                        groupAlert["group_name"] = pg.g.name;
                                        groupAlert["group_camera_ids"] = configuredCameraIds;
                                        groupAlert["required_camera_ids"] = expectedCameraIds;
                                        groupAlert["offline_camera_ids"] = offlineCameraIds;
                                        groupAlert["responded_camera_ids"] = respondedCameraIds;
                                        groupAlert["alert_camera_ids"] = alertCameraIds;
                                        groupAlert["alert_condition_first_pass"] = allTrue;
                                        groupAlert["validator_executed"] = groupValidatorExecuted;
                                        groupAlert["validator_model"] = "";
                                        groupAlert["validator_alert_condition"] = groupValidatorAlertCondition;
                                        groupAlert["validator_prompt_tokens"] = groupValidatorPromptTokens;
                                        groupAlert["validator_output_tokens"] = groupValidatorOutputTokens;
                                        groupAlert["validator_total_tokens"] = groupValidatorTotalTokens;
                                        groupAlert["llm_executed_camera_ids"] = llmExecutedCameraIds;
                                        groupAlert["cached_camera_ids"] = cachedCameraIds;
                                        groupAlert["result_source"] =
                                            cachedCameraIds.empty() ? "llm" : "mixed";
                                        groupAlert["answer"] = groupAnswer;
                                        if (regionAuditByCamera.is_array() && !regionAuditByCamera.empty()) {
                                            groupAlert["group_region_results"] = regionAuditByCamera;
                                        }

                                        json groupImages = json::array();
                                        for (int camId : configuredCameraIds) {
                                            const std::string camName = cameraNameById(camId);

                                            if (offlineCameraSet.count(camId)) {
                                                json gi;
                                                gi["camera_id"] = camId;
                                                gi["is_offline_placeholder"] = true;
                                                if (!camName.empty()) {
                                                    gi["camera_name"] = camName;
                                                }
                                                groupImages.push_back(std::move(gi));
                                                continue;
                                            }

                                            auto imgIt = jpegByCam.find(camId);
                                            if (imgIt == jpegByCam.end() || imgIt->second.empty()) continue;

                                            json gi;
                                            gi["camera_id"] = camId;
                                            gi["image_jpeg_b64"] = imgIt->second;
                                            if (!camName.empty()) {
                                                gi["camera_name"] = camName;
                                            }

                                            groupImages.push_back(std::move(gi));
                                        }

                                        std::string firstImageForAlert;
                                        if (!groupImages.empty()) {
                                            groupAlert["group_images"] = groupImages;
                                            for (const auto& gi : groupImages) {
                                                if (!gi.is_object()) continue;
                                                if (!gi.contains("image_jpeg_b64") || !gi["image_jpeg_b64"].is_string()) continue;
                                                const std::string candidate = gi["image_jpeg_b64"].get<std::string>();
                                                if (!candidate.empty()) {
                                                    firstImageForAlert = candidate;
                                                    break;
                                                }
                                            }
                                        }

                                        if (!firstImageForAlert.empty()) {
                                            groupAlert["image_jpeg_b64"] = firstImageForAlert;
                                        }
                                        else {
                                            auto imgIt = jpegByCam.find(primaryCameraId);
                                            if (imgIt != jpegByCam.end() && !imgIt->second.empty()) {
                                                groupAlert["image_jpeg_b64"] = imgIt->second;
                                            }
                                        }

                                        if (normResults.is_array()) {
                                            for (const auto& item : normResults) {
                                                if (!item.is_object()) continue;

                                                const int alertCamId = item.value("camera_id", -1);
                                                if (alertCamId <= 0) continue;
                                                if (!item.value("alert_condition", false)) continue;

                                                json localAlert = item;
                                                if ((!localAlert.contains("image_jpeg_b64") ||
                                                     !localAlert["image_jpeg_b64"].is_string() ||
                                                     trimCopyRuntime_(localAlert["image_jpeg_b64"].get<std::string>()).empty()))
                                                {
                                                    auto imgIt = jpegByCam.find(alertCamId);
                                                    if (imgIt != jpegByCam.end() && !imgIt->second.empty()) {
                                                        localAlert["image_jpeg_b64"] = imgIt->second;
                                                    }
                                                }

                                                if ((!localAlert.contains("camera_name") ||
                                                     !localAlert["camera_name"].is_string() ||
                                                     trimCopyRuntime_(localAlert["camera_name"].get<std::string>()).empty()))
                                                {
                                                    const std::string localCameraName = cameraNameById(alertCamId);
                                                    if (!localCameraName.empty()) {
                                                        localAlert["camera_name"] = localCameraName;
                                                    }
                                                }

                                                maybeFireAlerts_(
                                                    job->payload,
                                                    step,
                                                    alertCamId,
                                                    virtAgent,
                                                    localAlert.dump(),
                                                    true
                                                );
                                            }
                                        }

                                        groupAlert["daily_report_skip_local_alert_artifacts"] = true;
                                        maybeFireAlerts_(job->payload, step, primaryCameraId, virtAgent, groupAlert.dump());
                                    }
                                }

                                // Store group-level aggregated output (includes alert target ids)
                                json summary;
                                summary["group_id"] = pg.g.id;
                                summary["group_name"] = pg.g.name;
                                summary["agent_key"] = virtAgent.agent_key;
                                summary["results"] = normResults;
                                summary["expected_camera_ids"] = expectedCameraIds;
                                summary["configured_camera_ids"] = configuredCameraIds;
                                summary["offline_camera_ids"] = offlineCameraIds;
                                summary["responded_camera_ids"] = respondedCameraIds;
                                summary["alert_camera_ids"] = alertCameraIds;
                                summary["alert_target_ids"] = alertTargetIds;
                                summary["all_cameras_responded"] = allResponded;
                                summary["group_alert_condition_met"] = allTrue;
                                summary["group_alert_condition_validated"] = groupAlertReady;
                                summary["alert_condition"] = groupAlertReady;
                                summary["validator_executed"] = groupValidatorExecuted;
                                summary["validator_model"] = "";
                                summary["validator_alert_condition"] = groupValidatorAlertCondition;
                                summary["validator_prompt_tokens"] = groupValidatorPromptTokens;
                                summary["validator_output_tokens"] = groupValidatorOutputTokens;
                                summary["validator_total_tokens"] = groupValidatorTotalTokens;
                                summary["llm_executed_camera_ids"] = llmExecutedCameraIds;
                                summary["cached_camera_ids"] = cachedCameraIds;
                                summary["result_source"] =
                                    cachedCameraIds.empty()
                                    ? (llmExecutedCameraIds.empty() ? "cache" : "llm")
                                    : (llmExecutedCameraIds.empty() ? "cache" : "mixed");
                                summary["initial_full_inference_required"] = requireFullInitialInference;
                                if (regionAuditByCamera.is_array() && !regionAuditByCamera.empty()) {
                                    summary["group_region_results"] = regionAuditByCamera;
                                }

                                {
                                    std::lock_guard<std::mutex> lk(job->outputsMu);
                                    StepOutput& so = job->outputs[step.id];
                                    so.aggregated_output = summary.dump();
                                }
                            }
                            catch (...) {
                                // ignore parse errors
                            }

                            if (isImageGroup) {
                                // Image-group cadence is synchronized by new media availability.
                                // Once one cycle finishes, respect runEvery until the next cycle.
                                lastRunAt = nowTick;
                            }
                            std::this_thread::sleep_for(std::chrono::seconds(1));
                            continue;
                        }

                        // -------------------------------
                        // VIDEO GROUP (TODO)
                        // -------------------------------
                        // For now, do nothing (keeps design: grouped cameras must not use legacy agents).
                        // Implement later: 1 request w/ multiple mp4 inline_data, similar to image group.
                            std::this_thread::sleep_for(std::chrono::seconds(1));
                        }
                    }
                    catch (const std::exception& ex) {
                        logJobException_(
                            "job",
                            "job_step",
                            "JobRuntime::runJob_::groupWorker",
                            "step_group_worker",
                            {
                                { "job_id", job->payload.job.id },
                                { "step_id", step.id },
                                { "group_id", pg.g.id },
                                { "input_type", pg.g.input_type },
                                { "camera_ids", pg.camera_ids }
                            },
                            ex
                        );
                    }
                    catch (...) {
                        logJobUnknownException_(
                            "job",
                            "job_step",
                            "JobRuntime::runJob_::groupWorker",
                            "step_group_worker",
                            {
                                { "job_id", job->payload.job.id },
                                { "step_id", step.id },
                                { "group_id", pg.g.id },
                                { "input_type", pg.g.input_type },
                                { "camera_ids", pg.camera_ids }
                            }
                        );
                    }
                });
            }



            for (const auto& tgt : legacyTargets) {
                run.workers.emplace_back([this,
                                          job,
                                          &run,
                                          &step,
                                          &stepsById,
                                          &snapshotRunTiming,
                                          &captureWindowOpen,
                                          &captureDeadlineReached,
                                          &currentCaptureBudgetDeadline,
                                          &buildCameraCoverageJson,
                                          &observeLatestCapturedForCamera,
                                          &observeCaptureFrontierForCamera,
                                          &observeMaterializedFrontierForCamera,
                                          &observeSuccessfulCoverageSpanForCamera,
                                          &isCameraCoverageComplete,
                                          &isCameraAnalysisComplete,
                                          &completionPhaseToString,
                                          tgt]() {
                    const int cameraId = tgt.camera_id;
                    const JobAgentDef* agent = nullptr;
                    try {
                        agent = selectAgentForCamera_(step, cameraId);
                        if (!agent) return;
                        // Model tier for this camera (default: pro)
                        std::string modelTier = "pro";
                        {
                            auto itP = job->payload.camera_start_payload_by_id.find(cameraId);
                            if (itP != job->payload.camera_start_payload_by_id.end()) {
                                try { modelTier = itP->second.value("model_tier", modelTier); } catch (...) {}
                            }
                        }

                        const std::string normalizedInferenceModel =
                            normalizeInferenceModel_(agent->inference_model);
                        const bool isPortalCounterAgent = isPortalCounterBackend_(*agent);
                        const std::string providerName =
                            isPortalCounterAgent
                                ? "native"
                                : (isCoreInferenceModel_(normalizedInferenceModel) ? "zai" : "openai");
                        const std::string modelName =
                            isPortalCounterAgent
                                ? "opencv_portal_counter"
                                : openAIModelNameForInferenceModel_(normalizedInferenceModel);
                        const std::string cameraSessionId = [&]() -> std::string {
                            auto itP = job->payload.camera_start_payload_by_id.find(cameraId);
                            if (itP == job->payload.camera_start_payload_by_id.end() ||
                                !itP->second.is_object()) {
                                return std::string();
                            }
                            try {
                                return itP->second.value("camera_session_id", std::string());
                            }
                            catch (...) {
                                return std::string();
                            }
                        }();
                        const std::string agentRunKey =
                            !agent->agent_run_id.empty()
                                ? agent->agent_run_id
                                : ("job:" + std::to_string(job->payload.job.id) +
                                   ":step:" + std::to_string(step.id) +
                                   ":cam:" + std::to_string(cameraId) +
                                   ":agent:" +
                                   std::string(agent->agent_key.empty()
                                                   ? std::to_string(agent->id > 0 ? agent->id : 0)
                                                   : agent->agent_key));
                        auto postAgentRunEvent = [&](const std::string& eventType,
                                                     const std::string& eventMessage,
                                                     json extra)
                        {
                            if (!owner_) return;
                            json details = extra.is_object() ? std::move(extra) : json::object();
                            details["job_id"] = job->payload.job.id;
                            details["job_name"] = job->payload.job.name;
                            details["step_id"] = step.id;
                            details["step_order"] = step.step_order;
                            details["step_name"] = step.name;
                            details["camera_id"] = cameraId;
                            if (!tgt.camera_name.empty()) {
                                details["camera_name"] = tgt.camera_name;
                            }
                            details["agent_id"] = agent->id;
                            details["step_agent_id"] = agent->id;
                            details["agent_key"] = agent->agent_key;
                            details["inference_model"] = normalizedInferenceModel;
                            details["provider"] = providerName;
                            details["model"] = modelName;
                            details["input_type"] = agent->input_type;
                            details["priority_level"] = agent->priority_level;
                            details["timeout_seconds"] = step.timeout_seconds;
                            details["analysis_driven"] = run.analysisDriven;
                            details["analysis_completion_mode"] = run.analysisCompletionMode;
                            details["analysis_target_end_utc"] = run.analysisTargetEndUtcIso;
                            details["analysis_target_source"] = run.analysisTargetSource;
                            details["capture_deadline_utc"] = run.captureDeadlineUtcIso;
                            details["hard_stop_deadline_utc"] = run.hardStopDeadlineUtcIso;
                            details["step_phase"] = completionPhaseToString(run.completionPhase.load());
                            if (!job->payload.job_run_id.empty()) {
                                details["job_run_id"] = job->payload.job_run_id;
                            }
                            if (!step.step_run_id.empty()) {
                                details["step_run_id"] = step.step_run_id;
                            }
                            if (!agent->agent_run_id.empty()) {
                                details["agent_run_id"] = agent->agent_run_id;
                            }
                            if (!cameraSessionId.empty()) {
                                details["camera_session_id"] = cameraSessionId;
                            }
                            details["event_id"] = agentRunKey + ":" + eventType;
                            owner_->postAgentEvent(
                                eventType,
                                std::optional<int>(cameraId),
                                job->payload.job.user_id,
                                eventMessage,
                                details
                            );
                        };

                        // Build startConditionText for this (step, camera_name) from downstream custom start_conditions
                        auto buildStartConditionText = [&]() -> std::string {
                            std::string scText;
                            for (const auto& hook : job->customStartHooks) {
                                if (hook.from_step_id != step.id) continue;
                                if (!hook.pattern.empty() && hook.pattern != tgt.camera_name) continue;
                                if (hook.extract.empty()) continue;
                                if (!scText.empty()) scText += "\n";
                                scText += "If this condition is satisfied: " + hook.extract + " => set start_condition_step_id to " + std::to_string(hook.downstream_step_id);
                            }
                            return scText;
                        };

                        const int jobId = job->payload.job.id;
                        const int runEverySeconds = normalizedRunEverySecondsForJobAgent_(*agent);
                        auto lastRunAt = std::chrono::steady_clock::time_point::min();
                        std::string normalizedAgentInputType = agent->input_type;
                        std::transform(
                            normalizedAgentInputType.begin(),
                            normalizedAgentInputType.end(),
                            normalizedAgentInputType.begin(),
                            [](unsigned char c) { return static_cast<char>(std::tolower(c)); }
                        );
                        const bool isImageAgentInput = (normalizedAgentInputType == "image");
                        const bool useRunEverySchedulerGate = true;
                        int successfulInferenceCount = 0;
                        std::string lastCompletedOutput;
                        bool observedTemporalReportDelivered = false;
                        const json initialCameraCoverageDetails = buildCameraCoverageJson(run, cameraId);
                        const bool coverageRequiredForCamera =
                            initialCameraCoverageDetails.value("coverage_required", false);
                        auto currentCoverageCutoffUtcIso = [&]() -> std::string {
                            if (!coverageRequiredForCamera) {
                                return std::string();
                            }
                            return snapshotRunTiming(run).requiredCompletionEndUtcIso;
                        };
                        postAgentRunEvent(
                            "job_agent_started",
                            "Job agent started.",
                            json{
                                {"run_every_seconds", runEverySeconds},
                                {"status_reason", "started"}
                            }
                        );
                        auto inferenceOutputHasTemporalReportDelivered = [&](const std::string& rawOutput) -> bool {
                            if (rawOutput.empty() || !isLikelyJson_(rawOutput)) {
                                return false;
                            }
                            try {
                                const json parsed = json::parse(rawOutput);
                                return parsed.is_object() &&
                                    parsed.contains("temporal_report_delivered") &&
                                    parsed["temporal_report_delivered"].is_boolean() &&
                                    parsed["temporal_report_delivered"].get<bool>();
                            }
                            catch (...) {
                                return false;
                            }
                        };
                        auto persistCompletedOutput = [&](const std::string& completedOutput, bool countSuccessful) {
                            if (completedOutput.empty()) {
                                return;
                            }
                            if (countSuccessful) {
                                successfulInferenceCount += 1;
                            }
                            lastCompletedOutput = completedOutput;

                            {
                                std::lock_guard<std::mutex> lk(job->outputsMu);
                                StepOutput& so = job->outputs[step.id];
                                so.last_output_by_camera[cameraId] = completedOutput;
                                so.history_by_camera[cameraId].push_back(completedOutput);
                                so.aggregated_output = completedOutput;
                            }

                            maybeFireAlerts_(job->payload, step, cameraId, *agent, completedOutput);
                            persistDailyReportExecutionArtifacts_(
                                owner_,
                                job->payload,
                                step,
                                cameraId,
                                *agent,
                                completedOutput,
                                std::string(),
                                true
                            );

                            try {
                                if (isLikelyJson_(completedOutput)) {
                                    json j = json::parse(completedOutput);
                                    const std::string cp = j.value("clip_path", "");
                                    if (!cp.empty() &&
                                        cp.size() >= std::string(".processing").size() &&
                                        cp.rfind(".processing") == cp.size() - std::string(".processing").size())
                                    {
                                        std::error_code ec;
                                        fs::remove(fs::path(cp), ec);
                                    }

                                    if (j.contains("temp_clip_cleanup_paths") && j["temp_clip_cleanup_paths"].is_array()) {
                                        for (const auto& item : j["temp_clip_cleanup_paths"]) {
                                            if (!item.is_string()) continue;
                                            const std::string tmpPath = item.get<std::string>();
                                            if (tmpPath.empty()) continue;
                                            std::error_code tmpEc;
                                            fs::remove(fs::path(tmpPath), tmpEc);
                                        }
                                    }
                                }
                            }
                            catch (...) {
                                // ignore
                            }

                            try {
                                if (isLikelyJson_(completedOutput)) {
                                    json j = json::parse(completedOutput);
                                    if (j.contains("start_condition_step_id") && j["start_condition_step_id"].is_number_integer()) {
                                        int sidToStart = j["start_condition_step_id"].get<int>();
                                        std::lock_guard<std::mutex> lk2(job->triggeredMu);
                                        job->triggeredStartStepIds.insert(sidToStart);
                                    }
                                }
                            }
                            catch (...) {}

                            if (inferenceOutputHasTemporalReportDelivered(completedOutput)) {
                                observedTemporalReportDelivered = true;
                            }
                        };
                        auto computeRequestTimeoutSeconds = [&](const std::chrono::steady_clock::time_point& budgetDeadline,
                                                                int maxTimeoutSeconds) -> int {
                            const int safeMaxTimeoutSeconds = (std::max)(1, maxTimeoutSeconds);
                            const auto nowForBudget = std::chrono::steady_clock::now();
                            if (budgetDeadline <= nowForBudget) {
                                return 1;
                            }
                            const auto remainingMs =
                                std::chrono::duration_cast<std::chrono::milliseconds>(budgetDeadline - nowForBudget).count();
                            const int remainingSeconds =
                                (std::max)(1, static_cast<int>((remainingMs + 999) / 1000));
                            return (std::clamp)(remainingSeconds, 1, safeMaxTimeoutSeconds);
                        };
                        const bool deadlineReachedWithoutCancel = [&]() -> bool {
                            if (isPortalCounterAgent) {
                                while (!job->cancel &&
                                       !run.cancel &&
                                       captureWindowOpen(run))
                                {
                                    std::this_thread::sleep_for(std::chrono::milliseconds(250));
                                }
                                const bool reached =
                                    !job->cancel &&
                                    !run.cancel &&
                                    captureDeadlineReached(run);
                                if (reached && !run.timeoutRequested.load()) {
                                    for (int waitAttempt = 0;
                                         waitAttempt < 10 &&
                                         !job->cancel &&
                                         !run.cancel &&
                                         !run.timeoutRequested.load();
                                         ++waitAttempt)
                                    {
                                        std::this_thread::sleep_for(std::chrono::milliseconds(100));
                                    }
                                }
                                if (reached &&
                                    run.timeoutRequested.load() &&
                                    !job->cancel &&
                                    !run.cancel)
                                {
                                    const auto requiredDrainTargetUtc = run.requiredCompletionEndUtc;
                                    if (owner_ &&
                                        requiredDrainTargetUtc.time_since_epoch().count() != 0)
                                    {
                                        if (CameraSession* session = owner_->getCameraSession(cameraId)) {
                                            const auto materializeResult =
                                                session->materializeOpenClipThroughUtc(
                                                    requiredDrainTargetUtc,
                                                    10);
                                            if (!materializeResult.lastFrameUtcIso.empty()) {
                                                observeCaptureFrontierForCamera(
                                                    run,
                                                    cameraId,
                                                    materializeResult.lastFrameUtcIso,
                                                    materializeResult.reason);
                                            }
                                            if (materializeResult.materialized &&
                                                !materializeResult.finalizedEndUtcIso.empty())
                                            {
                                                observeMaterializedFrontierForCamera(
                                                    run,
                                                    cameraId,
                                                    materializeResult.finalizedEndUtcIso,
                                                    "materialized");
                                            }
                                        }
                                    }

                                    const VideoWindowAssemblyResult assembled =
                                        assemblePortalCounterStepWindow_(
                                            jobId,
                                            step.id,
                                            cameraId,
                                            run.startedAtSystemUtc,
                                            run.requiredCompletionEndUtc);
                                    if (assembled.status != VideoWindowAssemblyStatus::Assembled) {
                                        throw std::runtime_error(
                                            "portal counter step video assembly failed: " +
                                            assembled.error);
                                    }

                                    const JobAnalysisRegion* portalRegion =
                                        findPortalCounterRegion_(*agent);
                                    if (!portalRegion) {
                                        throw std::runtime_error(
                                            "portal counter region not found for the selected agent");
                                    }

                                    const fs::path portalOutputDir =
                                        getJobsTempDirForJobStepCamera(
                                            jobId,
                                            step.id,
                                            std::to_string(cameraId)) /
                                        ("portal_counter_" + nowMs_());
                                    std::error_code portalDirEc;
                                    fs::create_directories(portalOutputDir, portalDirEc);

                                    PortalCounterResult portalResult = runPortalCounterOnVideo(
                                        assembled.clipPath,
                                        *portalRegion,
                                        agent->portal_counter_config,
                                        portalOutputDir.string(),
                                        assembled.windowStartUtc,
                                        assembled.windowEndUtc);
                                    if (!portalResult.ok) {
                                        throw std::runtime_error(
                                            "portal counter analysis failed: " +
                                            portalResult.error);
                                    }

                                    if (portalResult.groupImages.is_array()) {
                                        for (auto& imageItem : portalResult.groupImages) {
                                            if (!imageItem.is_object()) continue;
                                            imageItem["camera_id"] = cameraId;
                                            if (!tgt.camera_name.empty()) {
                                                imageItem["camera_name"] = tgt.camera_name;
                                            }
                                        }
                                    }

                                    std::string representativeImageB64;
                                    if (portalResult.groupImages.is_array()) {
                                        for (const auto& imageItem : portalResult.groupImages) {
                                            if (!imageItem.is_object()) continue;
                                            if (!imageItem.contains("image_jpeg_b64") ||
                                                !imageItem["image_jpeg_b64"].is_string())
                                            {
                                                continue;
                                            }
                                            representativeImageB64 =
                                                imageItem["image_jpeg_b64"].get<std::string>();
                                            if (!representativeImageB64.empty()) break;
                                        }
                                    }

                                    AgentCore::JobAlertVideoUploadResult uploadedVideo;
                                    if (owner_ && !portalResult.annotatedVideoPath.empty()) {
                                        uploadedVideo = owner_->uploadJobAlertVideo(
                                            cameraId,
                                            jobId,
                                            step.id,
                                            portalResult.annotatedVideoPath);
                                    }

                                    json nativeOutput = {
                                        { "answer",
                                          portalResult.totalCount == 1
                                              ? std::string("1 pessoa passou pelo portal.")
                                              : std::to_string(portalResult.totalCount) +
                                                    " pessoas passaram pelo portal." },
                                        { "input_type", "video" },
                                        { "execution_backend", "opencv_portal_counter" },
                                        { "provider", "native" },
                                        { "model", "opencv_portal_counter" },
                                        { "result_source", "opencv_portal_counter" },
                                        { "alert_condition",
                                          portalResult.totalCount >=
                                              agent->portal_counter_config.min_count_to_alert },
                                        { "final_alert_condition",
                                          portalResult.totalCount >=
                                              agent->portal_counter_config.min_count_to_alert },
                                        { "group_images", portalResult.groupImages },
                                        { "group_image_count",
                                          portalResult.groupImages.is_array()
                                              ? portalResult.groupImages.size()
                                              : 0 },
                                        { "count_result", portalResult.countResult },
                                        { "processed_window_start_utc", assembled.windowStartUtc },
                                        { "processed_window_end_utc", assembled.windowEndUtc },
                                        { "processed_window_seconds", assembled.windowSeconds },
                                        { "capture_incomplete",
                                          assembled.windowStartUtc != run.startedAtSystemUtcIso ||
                                              assembled.windowEndUtc != run.requiredCompletionEndUtcIso }
                                    };
                                    if (!representativeImageB64.empty()) {
                                        nativeOutput["image_jpeg_b64"] = representativeImageB64;
                                    }
                                    std::vector<std::string> cleanupPaths = assembled.cleanupPaths;
                                    if (!portalResult.annotatedVideoPath.empty()) {
                                        cleanupPaths.push_back(portalResult.annotatedVideoPath);
                                    }
                                    if (!cleanupPaths.empty()) {
                                        nativeOutput["temp_clip_cleanup_paths"] = cleanupPaths;
                                    }
                                    if (uploadedVideo.ok && !uploadedVideo.videoKey.empty()) {
                                        nativeOutput["video_key"] = uploadedVideo.videoKey;
                                        if (!uploadedVideo.videoUrl.empty()) {
                                            nativeOutput["video_url"] = uploadedVideo.videoUrl;
                                        }
                                        nativeOutput["media_type"] = "video";
                                    }
                                    else if (!portalResult.annotatedVideoPath.empty()) {
                                        nativeOutput["clip_path"] = portalResult.annotatedVideoPath;
                                    }

                                    if (!assembled.windowStartUtc.empty() &&
                                        !assembled.windowEndUtc.empty())
                                    {
                                        observeSuccessfulCoverageSpanForCamera(
                                            run,
                                            cameraId,
                                            assembled.windowStartUtc,
                                            assembled.windowEndUtc);
                                    }
                                    persistCompletedOutput(nativeOutput.dump(), true);
                                }
                                return reached;
                            }

                            bool runDuePending = !isImageAgentInput;
                            while (!job->cancel &&
                                   !run.cancel &&
                                   captureWindowOpen(run)) {
                                const auto nowTick = std::chrono::steady_clock::now();
                                if (useRunEverySchedulerGate && !runDuePending) {
                                    if (lastRunAt == std::chrono::steady_clock::time_point::min()) {
                                        runDuePending = true;
                                    }
                                    else {
                                        const auto elapsed =
                                            std::chrono::duration_cast<std::chrono::seconds>(nowTick - lastRunAt).count();
                                        if (elapsed < runEverySeconds) {
                                            std::this_thread::sleep_for(std::chrono::milliseconds(200));
                                            continue;
                                        }
                                        runDuePending = true;
                                    }
                                }

                                bool readyVideoInputForPendingRun = false;
                                if (!isImageAgentInput && runDuePending) {
                                    readyVideoInputForPendingRun =
                                        peekReadyJobVideoInputForStepCamera_(
                                            jobId,
                                            step.id,
                                            cameraId,
                                            *agent,
                                            currentCoverageCutoffUtcIso()
                                        ).has_value();
                                    if (!readyVideoInputForPendingRun) {
                                        std::this_thread::sleep_for(std::chrono::milliseconds(250));
                                        continue;
                                    }
                                }

                                const std::string startConditionText = buildStartConditionText();
                                JobInstance::InferenceMediaInfo mediaInfo;
                                std::string out = runAgentInferenceOnCamera_(
                                    jobId,
                                    step.id,
                                    cameraId,
                                    *agent,
                                    resolvePipelineInputsForCamera_(job, step, cameraId, stepsById),
                                    /*alertConditionText*/ agent->alert_condition_text,
                                    /*startConditionText*/ startConditionText,
                                    /*modelTier*/ modelTier,
                                    /*jobRunId*/ job->payload.job_run_id,
                                    /*stepRunId*/ step.step_run_id,
                                    /*agentRunId*/ agent->agent_run_id,
                                    computeRequestTimeoutSeconds(
                                        currentCaptureBudgetDeadline(run),
                                        kNormalInferenceRequestTimeoutCapSeconds_
                                    ),
                                    job->cancel,
                                    currentCoverageCutoffUtcIso(),
                                    &mediaInfo
                                );
                                if (!mediaInfo.latestCapturedEndUtc.empty()) {
                                    observeLatestCapturedForCamera(run, cameraId, mediaInfo.latestCapturedEndUtc);
                                }

                                if (out.empty()) {
                                    if (isImageAgentInput) {
                                        std::this_thread::sleep_for(std::chrono::milliseconds(250));
                                    }
                                    else {
                                        std::this_thread::sleep_for(std::chrono::seconds(1));
                                    }
                                    continue;
                                }

                                // Record successful cycles after a real inference window was handled.
                                lastRunAt = nowTick;
                                runDuePending = false;
                                persistCompletedOutput(out, true);
                                if (!mediaInfo.consumptionKey.empty()) {
                                    markClipConsumedForJobStepCamera_(
                                        jobId,
                                        step.id,
                                        cameraId,
                                        mediaInfo.consumptionKey
                                    );
                                }
                                if (!mediaInfo.processedSegmentStartUtc.empty() &&
                                    !mediaInfo.processedSegmentEndUtc.empty())
                                {
                                    observeSuccessfulCoverageSpanForCamera(
                                        run,
                                        cameraId,
                                        mediaInfo.processedSegmentStartUtc,
                                        mediaInfo.processedSegmentEndUtc
                                    );
                                }

                                std::this_thread::sleep_for(std::chrono::seconds(1));
                            }

                            const bool reached =
                                !job->cancel &&
                                !run.cancel &&
                                captureDeadlineReached(run);
                            if (reached && !run.timeoutRequested.load()) {
                                for (int waitAttempt = 0;
                                     waitAttempt < 10 &&
                                     !job->cancel &&
                                     !run.cancel &&
                                     !run.timeoutRequested.load();
                                     ++waitAttempt)
                                {
                                    std::this_thread::sleep_for(std::chrono::milliseconds(100));
                                }
                            }
                            if (reached &&
                                run.timeoutRequested.load() &&
                                !job->cancel &&
                                !run.cancel &&
                                !isImageAgentInput)
                            {
                                const bool useAnalysisDrivenDrain = run.analysisDriven;
                                const auto requiredDrainTargetUtc =
                                    useAnalysisDrivenDrain
                                        ? run.analysisTargetEndUtc
                                        : run.requiredCompletionEndUtc;
                                const auto timeoutDrainDeadline =
                                    useAnalysisDrivenDrain
                                        ? run.hardStopDeadline
                                        : (std::min)(
                                              run.hardStopDeadline,
                                              std::chrono::steady_clock::now() +
                                                  std::chrono::seconds(kTimeoutDrainGraceSeconds_));
                                auto noReadyClipWaitDeadline =
                                    (std::min)(
                                        timeoutDrainDeadline,
                                        std::chrono::steady_clock::now() +
                                            std::chrono::seconds(kTimeoutDrainIdleWaitSeconds_)
                                    );
                                Logger::instance().logDebug(
                                    "job",
                                    "runAgentInferenceOnCamera_: timeout drain started job_id=" +
                                    std::to_string(jobId) +
                                    " step_id=" + std::to_string(step.id) +
                                    " camera_id=" + std::to_string(cameraId) +
                                    " grace_seconds=" +
                                    std::to_string((std::max)(
                                        0LL,
                                        std::chrono::duration_cast<std::chrono::seconds>(
                                            timeoutDrainDeadline - std::chrono::steady_clock::now()).count()))
                                );
                                while (!job->cancel &&
                                       !run.cancel &&
                                       std::chrono::steady_clock::now() < timeoutDrainDeadline)
                                {
                                    if (useAnalysisDrivenDrain
                                            ? isCameraAnalysisComplete(run, cameraId)
                                            : isCameraCoverageComplete(run, cameraId))
                                    {
                                        break;
                                    }
                                    const auto pendingReady =
                                        peekReadyJobVideoInputForStepCamera_(
                                            jobId,
                                            step.id,
                                            cameraId,
                                            *agent,
                                            currentCoverageCutoffUtcIso()
                                        );
                                    if (!pendingReady.has_value()) {
                                        bool shouldRetryAfterMaterialization = false;
                                        if (owner_ &&
                                            requiredDrainTargetUtc.time_since_epoch().count() != 0)
                                        {
                                            if (CameraSession* session = owner_->getCameraSession(cameraId)) {
                                                const auto materializeResult =
                                                    session->materializeOpenClipThroughUtc(
                                                        requiredDrainTargetUtc,
                                                        10);
                                                if (!materializeResult.lastFrameUtcIso.empty()) {
                                                    observeCaptureFrontierForCamera(
                                                        run,
                                                        cameraId,
                                                        materializeResult.lastFrameUtcIso,
                                                        materializeResult.reason);
                                                }
                                                if (materializeResult.materialized &&
                                                    !materializeResult.finalizedEndUtcIso.empty())
                                                {
                                                    observeMaterializedFrontierForCamera(
                                                        run,
                                                        cameraId,
                                                        materializeResult.finalizedEndUtcIso,
                                                        "materialized");
                                                    noReadyClipWaitDeadline =
                                                        (std::min)(
                                                            timeoutDrainDeadline,
                                                            std::chrono::steady_clock::now() +
                                                                std::chrono::seconds(kTimeoutDrainIdleWaitSeconds_)
                                                        );
                                                    Logger::instance().logDebug(
                                                        "job",
                                                        "runAgentInferenceOnCamera_: materialized tail clip during timeout drain"
                                                        " job_id=" + std::to_string(jobId) +
                                                        " step_id=" + std::to_string(step.id) +
                                                        " camera_id=" + std::to_string(cameraId) +
                                                        " finalized_end_utc=" + materializeResult.finalizedEndUtcIso +
                                                        " path=" + materializeResult.finalizedPath
                                                    );
                                                    shouldRetryAfterMaterialization = true;
                                                }
                                                else if (materializeResult.waitingForTarget ||
                                                         (!materializeResult.lastFrameUtcIso.empty() &&
                                                          !materializeResult.reason.empty()))
                                                {
                                                    noReadyClipWaitDeadline =
                                                        (std::min)(
                                                            timeoutDrainDeadline,
                                                            std::chrono::steady_clock::now() +
                                                                std::chrono::seconds(kTimeoutDrainIdleWaitSeconds_)
                                                        );
                                                }
                                            }
                                        }
                                        if (shouldRetryAfterMaterialization) {
                                            continue;
                                        }
                                        if (std::chrono::steady_clock::now() >= noReadyClipWaitDeadline) {
                                            break;
                                        }
                                        std::this_thread::sleep_for(std::chrono::milliseconds(250));
                                        continue;
                                    }

                                    const std::string drainStartConditionText = buildStartConditionText();
                                    JobInstance::InferenceMediaInfo drainMediaInfo;
                                    std::string drainOut = runAgentInferenceOnCamera_(
                                        jobId,
                                        step.id,
                                        cameraId,
                                        *agent,
                                        resolvePipelineInputsForCamera_(job, step, cameraId, stepsById),
                                        /*alertConditionText*/ agent->alert_condition_text,
                                        /*startConditionText*/ drainStartConditionText,
                                        /*modelTier*/ modelTier,
                                        /*jobRunId*/ job->payload.job_run_id,
                                        /*stepRunId*/ step.step_run_id,
                                        /*agentRunId*/ agent->agent_run_id,
                                        computeRequestTimeoutSeconds(
                                            timeoutDrainDeadline,
                                            kTimeoutDrainInferenceRequestTimeoutCapSeconds_
                                        ),
                                        job->cancel,
                                        currentCoverageCutoffUtcIso(),
                                        &drainMediaInfo
                                    );
                                    if (!drainMediaInfo.latestCapturedEndUtc.empty()) {
                                        observeLatestCapturedForCamera(run, cameraId, drainMediaInfo.latestCapturedEndUtc);
                                    }
                                    if (drainOut.empty()) {
                                        std::this_thread::sleep_for(std::chrono::milliseconds(200));
                                        continue;
                                    }

                                    noReadyClipWaitDeadline =
                                        (std::min)(
                                            timeoutDrainDeadline,
                                            std::chrono::steady_clock::now() +
                                            std::chrono::seconds(kTimeoutDrainIdleWaitSeconds_)
                                        );
                                    persistCompletedOutput(drainOut, true);
                                    if (!drainMediaInfo.consumptionKey.empty()) {
                                        markClipConsumedForJobStepCamera_(
                                            jobId,
                                            step.id,
                                            cameraId,
                                            drainMediaInfo.consumptionKey
                                        );
                                    }
                                    if (!drainMediaInfo.processedSegmentStartUtc.empty() &&
                                        !drainMediaInfo.processedSegmentEndUtc.empty())
                                    {
                                        observeSuccessfulCoverageSpanForCamera(
                                            run,
                                            cameraId,
                                            drainMediaInfo.processedSegmentStartUtc,
                                            drainMediaInfo.processedSegmentEndUtc
                                        );
                                    }
                                }
                                const json drainedCoverageDetails = buildCameraCoverageJson(run, cameraId);
                                Logger::instance().logDebug(
                                    "job",
                                    "runAgentInferenceOnCamera_: timeout drain finished job_id=" +
                                    std::to_string(jobId) +
                                    " step_id=" + std::to_string(step.id) +
                                    " camera_id=" + std::to_string(cameraId) +
                                    " coverage_status=" +
                                    drainedCoverageDetails.value("coverage_status", std::string("not_applicable")) +
                                    " analysis_status=" +
                                    drainedCoverageDetails.value("analysis_status", std::string("not_applicable")) +
                                    " covered_until_utc=" +
                                    drainedCoverageDetails.value("covered_until_utc", std::string()) +
                                    " analysis_frontier_utc=" +
                                    drainedCoverageDetails.value("analysis_frontier_utc", std::string()) +
                                    " temporal_report_delivered=" +
                                    std::string(observedTemporalReportDelivered ? "true" : "false")
                                );
                            }
                            const json finalCameraCoverageDetails = buildCameraCoverageJson(run, cameraId);
                            const std::string finalCoverageNowUtc =
                                finalCameraCoverageDetails.value("analysis_frontier_utc", std::string()).empty()
                                    ? finalCameraCoverageDetails.value("covered_until_utc", std::string())
                                    : finalCameraCoverageDetails.value("analysis_frontier_utc", std::string());
                            if (reached &&
                                !observedTemporalReportDelivered &&
                                !finalCoverageNowUtc.empty())
                            {
                                const std::string timeoutTemporalOutput =
                                    maybeEmitFinalTemporalReportOnTimeout_(
                                        jobId,
                                        step.id,
                                        cameraId,
                                        *agent,
                                        agent->alert_condition_text,
                                        job->payload.job_run_id,
                                        step.step_run_id,
                                        agent->agent_run_id,
                                        finalCoverageNowUtc,
                                        &finalCameraCoverageDetails
                                    );
                                if (!timeoutTemporalOutput.empty()) {
                                    lastCompletedOutput = timeoutTemporalOutput;
                                    {
                                        std::lock_guard<std::mutex> lk(job->outputsMu);
                                        StepOutput& so = job->outputs[step.id];
                                        so.last_output_by_camera[cameraId] = timeoutTemporalOutput;
                                        so.history_by_camera[cameraId].push_back(timeoutTemporalOutput);
                                        so.aggregated_output = timeoutTemporalOutput;
                                    }
                                    if (inferenceOutputHasTemporalReportDelivered(timeoutTemporalOutput)) {
                                        observedTemporalReportDelivered = true;
                                    }
                                }
                            }
                            return reached;
                        }();

                        const json completionCoverageDetails = buildCameraCoverageJson(run, cameraId);
                        const bool completionAnalysisDriven =
                            completionCoverageDetails.value("analysis_driven", false);
                        const bool completionAnalysisComplete =
                            completionCoverageDetails.value("analysis_complete", true);
                        const std::string completionAnalysisStatus =
                            completionCoverageDetails.value(
                                "analysis_status",
                                std::string("legacy_deadline"));
                        const bool completionCoverageIncomplete =
                            run.timeoutRequested.load() &&
                            completionCoverageDetails.value("coverage_required", false) &&
                            !completionCoverageDetails.value("coverage_complete", true);
                        json completionDetails = {
                            {"status_reason",
                             job->cancel ? "job_cancelled"
                                         : (run.timeoutRequested.load()
                                                ? (completionAnalysisDriven
                                                       ? (completionAnalysisComplete
                                                              ? "analysis_target_reached"
                                                              : completionAnalysisStatus)
                                                       : (completionCoverageIncomplete
                                                              ? "coverage_incomplete"
                                                              : "deadline_reached"))
                                                : (run.cancel ? "step_cancelled" : "deadline_reached"))},
                            {"successful_iterations", successfulInferenceCount}
                        };
                        if (!lastCompletedOutput.empty()) {
                            if (isLikelyJson_(lastCompletedOutput)) {
                                try {
                                    json parsedOutput = json::parse(lastCompletedOutput);
                                    if (parsedOutput.is_object()) {
                                        parsedOutput.erase("image_jpeg_b64");
                                        parsedOutput.erase("frame_jpeg_base64");
                                        parsedOutput.erase("group_images");
                                        auto stripInlineImageFields = [](json& node) {
                                            if (!node.is_array()) return;
                                            for (auto& item : node) {
                                                if (!item.is_object()) continue;
                                                item.erase("image_jpeg_b64");
                                                item.erase("frame_jpeg_base64");
                                            }
                                        };
                                        if (parsedOutput.contains("region_results")) {
                                            stripInlineImageFields(parsedOutput["region_results"]);
                                        }
                                        if (parsedOutput.contains("group_region_results")) {
                                            stripInlineImageFields(parsedOutput["group_region_results"]);
                                        }
                                        for (auto it = parsedOutput.begin(); it != parsedOutput.end(); ++it) {
                                            if (!completionDetails.contains(it.key())) {
                                                completionDetails[it.key()] = it.value();
                                            }
                                        }
                                    }
                                    else {
                                        completionDetails["output_data"] = lastCompletedOutput;
                                    }
                                }
                                catch (...) {
                                    completionDetails["output_data"] = lastCompletedOutput;
                                }
                            }
                            else {
                                completionDetails["output_data"] = lastCompletedOutput;
                            }
                        }
                        for (auto it = completionCoverageDetails.begin();
                             it != completionCoverageDetails.end();
                             ++it)
                        {
                            completionDetails[it.key()] = it.value();
                        }
                        postAgentRunEvent(
                            "job_agent_completed",
                            "Job agent completed.",
                            std::move(completionDetails)
                        );
                    }
                    catch (const std::exception& ex) {
                        try {
                            const std::string failureAgentRunId =
                                (agent && !agent->agent_run_id.empty()) ? agent->agent_run_id : std::string();
                            const std::string failureAgentKey =
                                agent ? agent->agent_key : std::string();
                            const int failureAgentId =
                                (agent && agent->id > 0) ? agent->id : 0;
                            json failureDetails = {
                                {"status_reason", "exception"},
                                {"error_message", ex.what()}
                            };
                            if (!job->payload.job_run_id.empty()) {
                                failureDetails["job_run_id"] = job->payload.job_run_id;
                            }
                            if (!step.step_run_id.empty()) {
                                failureDetails["step_run_id"] = step.step_run_id;
                            }
                            if (!failureAgentRunId.empty()) {
                                failureDetails["agent_run_id"] = failureAgentRunId;
                            }
                            auto itP = job->payload.camera_start_payload_by_id.find(cameraId);
                            if (itP != job->payload.camera_start_payload_by_id.end() &&
                                itP->second.is_object()) {
                                const std::string failureCameraSessionId =
                                    itP->second.value("camera_session_id", std::string());
                                if (!failureCameraSessionId.empty()) {
                                    failureDetails["camera_session_id"] = failureCameraSessionId;
                                }
                            }
                            failureDetails["event_id"] =
                                (!failureAgentRunId.empty()
                                     ? failureAgentRunId
                                     : ("job:" + std::to_string(job->payload.job.id) +
                                        ":step:" + std::to_string(step.id) +
                                        ":cam:" + std::to_string(cameraId) +
                                        ":agent:" +
                                        std::string(failureAgentKey.empty()
                                                        ? std::to_string(failureAgentId)
                                                        : failureAgentKey))) +
                                ":job_agent_failed";
                            owner_->postAgentEvent(
                                "job_agent_failed",
                                std::optional<int>(cameraId),
                                job->payload.job.user_id,
                                "Job agent failed.",
                                failureDetails
                            );
                        }
                        catch (...) {
                        }
                        logJobException_(
                            tgt.camera_id > 0 ? std::to_string(tgt.camera_id) : "job",
                            "job_step",
                            "JobRuntime::runJob_::targetWorker",
                            "step_target_worker",
                            {
                                { "job_id", job->payload.job.id },
                                { "step_id", step.id },
                                { "camera_id", tgt.camera_id },
                                { "camera_name", tgt.camera_name }
                            },
                            ex
                        );
                    }
                    catch (...) {
                        try {
                            const std::string failureAgentRunId =
                                (agent && !agent->agent_run_id.empty()) ? agent->agent_run_id : std::string();
                            const std::string failureAgentKey =
                                agent ? agent->agent_key : std::string();
                            const int failureAgentId =
                                (agent && agent->id > 0) ? agent->id : 0;
                            json failureDetails = {
                                {"status_reason", "unknown_exception"},
                                {"error_message", "unknown"}
                            };
                            if (!job->payload.job_run_id.empty()) {
                                failureDetails["job_run_id"] = job->payload.job_run_id;
                            }
                            if (!step.step_run_id.empty()) {
                                failureDetails["step_run_id"] = step.step_run_id;
                            }
                            if (!failureAgentRunId.empty()) {
                                failureDetails["agent_run_id"] = failureAgentRunId;
                            }
                            auto itP = job->payload.camera_start_payload_by_id.find(cameraId);
                            if (itP != job->payload.camera_start_payload_by_id.end() &&
                                itP->second.is_object()) {
                                const std::string failureCameraSessionId =
                                    itP->second.value("camera_session_id", std::string());
                                if (!failureCameraSessionId.empty()) {
                                    failureDetails["camera_session_id"] = failureCameraSessionId;
                                }
                            }
                            failureDetails["event_id"] =
                                (!failureAgentRunId.empty()
                                     ? failureAgentRunId
                                     : ("job:" + std::to_string(job->payload.job.id) +
                                        ":step:" + std::to_string(step.id) +
                                        ":cam:" + std::to_string(cameraId) +
                                        ":agent:" +
                                        std::string(failureAgentKey.empty()
                                                        ? std::to_string(failureAgentId)
                                                        : failureAgentKey))) +
                                ":job_agent_failed";
                            owner_->postAgentEvent(
                                "job_agent_failed",
                                std::optional<int>(cameraId),
                                job->payload.job.user_id,
                                "Job agent failed.",
                                failureDetails
                            );
                        }
                        catch (...) {
                        }
                        logJobUnknownException_(
                            tgt.camera_id > 0 ? std::to_string(tgt.camera_id) : "job",
                            "job_step",
                            "JobRuntime::runJob_::targetWorker",
                            "step_target_worker",
                            {
                                { "job_id", job->payload.job.id },
                                { "step_id", step.id },
                                { "camera_id", tgt.camera_id },
                                { "camera_name", tgt.camera_name }
                            }
                        );
                    }
                });
            }
        };

        auto freezeStepCaptureAndCamera = [&](JobInstance::StepRun& run) {
            auto& step = run.def;

            if (owner_) {
                for (const auto& tgt : step.targets) {
                    const int camId = tgt.camera_id;
                    if (stepCaptureNeedsForCamera_(step, camId).any()) {
                        owner_->jobsCaptureRelease(camId, job->payload.job.id, step.id);
                    }
                }
            }

            if (owner_) {
                for (const auto& tgt : step.targets) {
                    const int camId = tgt.camera_id;

                    bool usedByOtherRunningStep = false;
                    for (const auto& [otherSid, otherRun] : job->stepRuns) {
                        if (otherSid == step.id) continue;
                        if (otherRun.state != JobInstance::StepState::Running) continue;
                        for (const auto& otherTgt : otherRun.def.targets) {
                            if (otherTgt.camera_id == camId) {
                                usedByOtherRunningStep = true;
                                break;
                            }
                        }
                        if (usedByOtherRunningStep) break;
                    }

                    if (!usedByOtherRunningStep) {
                        owner_->stopCameraForJob(camId, job->payload.job.id, step.id);
                    }
                }
            }
        };

        auto finalizeStep = [&](JobInstance::StepRun& run, const char* reason) {
            auto& step = run.def;
            const bool timeoutReason = (std::string(reason) == "timeout");
            if (timeoutReason) {
                run.timeoutRequested = true;
                run.completionPhase.store(JobInstance::StepRun::CompletionPhase::DrainingToTarget);
            }
            else {
                run.cancel = true;
                run.completionPhase.store(JobInstance::StepRun::CompletionPhase::Finalizing);
            }

            for (auto& t : run.workers) {
                if (t.joinable()) t.join();
            }
            run.workers.clear();

            freezeStepCaptureAndCamera(run);

            if (run.state == JobInstance::StepState::Running) {
                run.completionPhase.store(JobInstance::StepRun::CompletionPhase::Finalizing);
                json stepCoverage = buildStepCoverageSummary(run);
                json stepAnalysis = buildStepAnalysisSummary(run);
                const bool coverageIncomplete =
                    timeoutReason &&
                    stepCoverage.value("coverage_required", false) &&
                    !stepCoverage.value("coverage_complete", true);
                run.coverageIncomplete = coverageIncomplete;
                const bool analysisDriven =
                    stepAnalysis.value("analysis_driven", false);
                const bool analysisComplete =
                    stepAnalysis.value("analysis_complete", true);
                const std::string analysisStatus =
                    stepAnalysis.value("analysis_status", std::string("legacy_deadline"));
                const std::string finalStatusReason =
                    timeoutReason
                        ? (analysisDriven
                               ? (analysisComplete ? "analysis_target_reached" : analysisStatus)
                               : (coverageIncomplete ? "coverage_incomplete" : std::string(reason)))
                        : std::string(reason);

                json stepCompletedDetails = {
                    {"job_run_id", job->payload.job_run_id},
                    {"step_id", step.id},
                    {"step_order", step.step_order},
                    {"reason", finalStatusReason},
                    {"status_reason", finalStatusReason}
                };
                for (auto it = stepCoverage.begin(); it != stepCoverage.end(); ++it) {
                    stepCompletedDetails[it.key()] = it.value();
                }
                for (auto it = stepAnalysis.begin(); it != stepAnalysis.end(); ++it) {
                    stepCompletedDetails[it.key()] = it.value();
                }

                run.completionPhase.store(JobInstance::StepRun::CompletionPhase::Completed);
                run.state = JobInstance::StepState::Completed;
                postStepEvent_("job_step_completed", J, step, std::move(stepCompletedDetails));
            }
        };

        auto parseHHMMToSeconds = [](const std::string& hhmm) -> std::optional<int> {
            if (hhmm.size() < 4) return std::nullopt;
            int hh = -1;
            int mm = -1;
            char colon = 0;
            std::istringstream iss(hhmm);
            if (!(iss >> hh >> colon >> mm)) return std::nullopt;
            if (colon != ':') return std::nullopt;
            if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return std::nullopt;
            return hh * 3600 + mm * 60;
        };

        auto timeConditionCanStillFireInFuture = [&](const JobStepDef::StartCondition& sc) -> bool {
            const int offsetSec = std::max(0, sc.time_offset_seconds);
            int delaySec = offsetSec;

            if (!sc.time_hhmm.empty()) {
                const auto desired = parseHHMMToSeconds(sc.time_hhmm);
                const auto trig = parseHHMMToSeconds(job->payload.trigger.local_time);
                if (desired.has_value() && trig.has_value()) {
                    int delta = *desired - *trig;
                    if (delta < 0) delta = 0;
                    delaySec = std::max(delta, offsetSec);
                }
            }

            if (delaySec <= 0) return false;
            const auto startAt = job->jobStartedAt + std::chrono::seconds(delaySec);
            return std::chrono::steady_clock::now() < startAt;
        };

        std::function<bool(int, std::unordered_set<int>&)> pendingCanStillStartLater;
        pendingCanStillStartLater = [&](int stepId, std::unordered_set<int>& visiting) -> bool {
            if (visiting.count(stepId)) return false;
            visiting.insert(stepId);

            auto itRun = job->stepRuns.find(stepId);
            if (itRun == job->stepRuns.end()) return false;

            const auto& run = itRun->second;
            if (run.state == JobInstance::StepState::Running) return true;
            if (run.state != JobInstance::StepState::Pending) return false;

            const auto& step = run.def;
            const JobStepDef::StartCondition sc =
                step.start_condition.has_value() ? *step.start_condition : deriveLegacyStartCondition_(step);

            if (sc.mode == "time") {
                return timeConditionCanStillFireInFuture(sc);
            }

            if (!sc.from_step_id.has_value()) {
                // If it had no dependency and still didn't start now, it won't become runnable later.
                return false;
            }

            const int depId = *sc.from_step_id;
            auto depIt = job->stepRuns.find(depId);
            if (depIt == job->stepRuns.end()) {
                return step.on_missing_input != "skip";
            }

            const auto depState = depIt->second.state;
            if (depState == JobInstance::StepState::Running) return true;
            if (depState == JobInstance::StepState::Pending) {
                return pendingCanStillStartLater(depId, visiting);
            }

            return false;
        };

        // Scheduler loop: start pending steps when conditions are satisfied.
        while (!job->cancel) {
            // Start eligible pending steps
            for (auto& [sid, run] : job->stepRuns) {
                if (run.state == JobInstance::StepState::Pending &&
                    conditionSatisfied_(job, run.def, stepsById, job->stepRuns)) {
                    startStep(run);
                }
            }

            // Finalize running steps that hit the capture deadline. For
            // analysis-driven steps, finalizeStep() blocks until drain-to-target
            // completes or the hard stop is reached.
            for (auto& [sid, run] : job->stepRuns) {
                if (run.state == JobInstance::StepState::Running &&
                    captureDeadlineReached(run)) {
                    finalizeStep(run, "timeout");
                }
            }

            bool anyRunning = false;
            bool anyPending = false;
            for (const auto& [sid, run] : job->stepRuns) {
                if (run.state == JobInstance::StepState::Running) anyRunning = true;
                if (run.state == JobInstance::StepState::Pending) anyPending = true;
            }

            // Done?
            if (!anyRunning && !anyPending) break;

            // Stalled: no running step and pending steps with no path to become runnable.
            if (!anyRunning && anyPending) {
                bool hasPendingRunnableNow = false;
                for (const auto& [sid, run] : job->stepRuns) {
                    if (run.state != JobInstance::StepState::Pending) continue;
                    if (conditionSatisfied_(job, run.def, stepsById, job->stepRuns)) {
                        hasPendingRunnableNow = true;
                        break;
                    }
                }

                if (!hasPendingRunnableNow) {
                    bool canStillAdvance = false;
                    for (const auto& [sid, run] : job->stepRuns) {
                        if (run.state != JobInstance::StepState::Pending) continue;
                        std::unordered_set<int> visiting;
                        if (pendingCanStillStartLater(sid, visiting)) {
                            canStillAdvance = true;
                            break;
                        }
                    }

                    if (!canStillAdvance) {
                        json blocked = json::array();
                        for (const auto& [sid, run] : job->stepRuns) {
                            if (run.state != JobInstance::StepState::Pending) continue;
                            const auto& step = run.def;
                            const JobStepDef::StartCondition sc =
                                step.start_condition.has_value() ? *step.start_condition : deriveLegacyStartCondition_(step);

                            json b{
                                {"step_id", step.id},
                                {"step_order", step.step_order},
                                {"step_name", step.name},
                                {"start_mode", sc.mode.empty() ? "sequential" : sc.mode}
                            };
                            if (sc.from_step_id.has_value()) b["from_step_id"] = *sc.from_step_id;
                            if (!sc.time_hhmm.empty()) b["time_hhmm"] = sc.time_hhmm;
                            if (sc.time_offset_seconds > 0) b["time_offset_seconds"] = sc.time_offset_seconds;
                            blocked.push_back(std::move(b));
                        }

                        postJobEvent_("job_staled", J, json{
                            {"job_id", J.id},
                            {"job_name", J.name},
                            {"job_run_id", job->payload.job_run_id},
                            {"reason", "no_runnable_or_future_steps"},
                            {"pending_steps", blocked}
                        });
                        finalizeJobRuntimeState();
                        return;
                    }
                }
            }

            // Avoid busy loop
            std::this_thread::sleep_for(std::chrono::milliseconds(200));
        }

        // Cancel path: finalize any running steps
        if (job->cancel) {
            for (auto& [sid, run] : job->stepRuns) {
                if (run.state == JobInstance::StepState::Running) {
                    finalizeStep(run, "job_cancel");
                }
            }
            postJobEvent_("job_stopped", J, json{
                {"job_id", J.id},
                {"job_run_id", job->payload.job_run_id},
                {"reason", "cancelled"}
            });
            finalizeJobRuntimeState();
            return;
        }

        json jobCompletedDetails = {
            {"job_id", J.id},
            {"job_name", J.name},
            {"job_run_id", job->payload.job_run_id}
        };
        json jobCoverageSummary = buildJobCoverageSummary();
        json jobAnalysisSummary = buildJobAnalysisSummary();
        for (auto it = jobCoverageSummary.begin(); it != jobCoverageSummary.end(); ++it) {
            jobCompletedDetails[it.key()] = it.value();
        }
        for (auto it = jobAnalysisSummary.begin(); it != jobAnalysisSummary.end(); ++it) {
            jobCompletedDetails[it.key()] = it.value();
        }
        postJobEvent_("job_completed", J, std::move(jobCompletedDetails));
        finalizeJobRuntimeState();
    }
    catch (const std::exception& e) {
        logJobException_(
            "job",
            "jobs",
            "JobRuntime::runJob_",
            "run_job",
            {
                { "job_id", J.id },
                { "job_name", J.name }
            },
            e
        );
        postJobEvent_("job_failed", J, json{
            {"job_id", J.id},
            {"job_name", J.name},
            {"job_run_id", job->payload.job_run_id},
            {"error", e.what()}
            });
        finalizeJobRuntimeState();
    }
    catch (...) {
        logJobUnknownException_(
            "job",
            "jobs",
            "JobRuntime::runJob_",
            "run_job",
            {
                { "job_id", J.id },
                { "job_name", J.name }
            }
        );
        postJobEvent_("job_failed", J, json{
            {"job_id", J.id},
            {"job_name", J.name},
            {"job_run_id", job->payload.job_run_id},
            {"error", "unknown"}
            });
        finalizeJobRuntimeState();
    }
}

bool JobRuntime::conditionSatisfied_(std::shared_ptr<JobInstance> job, const JobStepDef& step,
                                    const std::unordered_map<int, JobStepDef>& stepsById,
                                    const std::unordered_map<int, JobInstance::StepRun>& runsById) {
    // Determine start condition object (structured or legacy)
    JobStepDef::StartCondition sc = step.start_condition.has_value() ? *step.start_condition : deriveLegacyStartCondition_(step);

    // First step default: start immediately
    if (!sc.from_step_id.has_value() && (sc.mode.empty() || sc.mode == "sequential")) {
        return true;
    }

    // Time-based start.
    // Supported payload shapes:
    //  A) Absolute local clock time: start_condition.time_hhmm = "HH:MM" (preferred)
    //  B) Relative offset from job start: start_condition.time_offset_sec/time_offset_seconds
    //
    // IMPORTANT: We intentionally avoid doing full timezone conversions here.
    // Instead, when time_hhmm is provided, we compute the delay relative to the job trigger local_time
    // (which is already computed by the backend scheduler in the job timezone).
    if (sc.mode == "time") {
        // Helper: parse "HH:MM" -> seconds since midnight
        auto parseHHMM = [](const std::string& hhmm) -> std::optional<int> {
            if (hhmm.size() < 4) return std::nullopt;
            int hh = -1, mm = -1;
            char colon = 0;
            std::istringstream iss(hhmm);
            if (!(iss >> hh >> colon >> mm)) return std::nullopt;
            if (colon != ':') return std::nullopt;
            if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return std::nullopt;
            return hh * 3600 + mm * 60;
        };

        // NOTE: The backend (Mocha scheduler) may emit BOTH:
        //  - time_hhmm (absolute local clock time)
        //  - time_offset_sec (relative offset)
        // for backwards compatibility.
        // In that case, time_offset_sec typically already represents the delta between
        // trigger.local_time and time_hhmm. We must NOT add them together.
        //
        // To be robust, when time_hhmm is present we take max(delta, time_offset_sec)
        // (never sum). When time_hhmm is absent, we fall back to time_offset_sec only.
        const int offsetSec = std::max(0, sc.time_offset_seconds);

        // Absolute HH:MM
        if (!sc.time_hhmm.empty()) {
            const auto desired = parseHHMM(sc.time_hhmm);
            const auto trig = parseHHMM(job->payload.trigger.local_time);
            if (desired.has_value() && trig.has_value()) {
                // delay from trigger time to desired time; if already passed, start immediately
                int delta = *desired - *trig;
                if (delta < 0) delta = 0;
                const int delaySec = std::max(delta, offsetSec);
                const auto startAt = job->jobStartedAt + std::chrono::seconds(delaySec);
                return std::chrono::steady_clock::now() >= startAt;
            }
            // If we cannot parse, fall back to relative offset.
        }

        // Relative offset from job start
        if (offsetSec <= 0) return true;
        const auto startAt = job->jobStartedAt + std::chrono::seconds(offsetSec);
        return std::chrono::steady_clock::now() >= startAt;
    }

    // Needs a dependency
    if (!sc.from_step_id.has_value()) {
        return false;
    }
    const int depId = *sc.from_step_id;

    auto itRun = runsById.find(depId);
    if (itRun == runsById.end()) {
        return step.on_missing_input == "skip";
    }

    // Sequential: wait until dependency completed or skipped (when configured)
    if (sc.mode.empty() || sc.mode == "sequential") {
        if (itRun->second.state == JobInstance::StepState::Completed) return true;
        if (itRun->second.state == JobInstance::StepState::Skipped && step.on_missing_input == "skip") return true;
        return false;
    }

    // Positive/negative: start as soon as the dependency output indicates sentiment.
    if (sc.mode == "positive" || sc.mode == "negative") {
        std::string out;
        {
            std::lock_guard<std::mutex> lk(job->outputsMu);
            auto itOut = job->outputs.find(depId);
            if (itOut == job->outputs.end()) return false;

            const StepOutput& so = itOut->second;

            // 1) explicit camera_id wins
            if (sc.camera_id.has_value()) {
                auto itCam = so.last_output_by_camera.find(*sc.camera_id);
                if (itCam != so.last_output_by_camera.end()) out = itCam->second;
            }

            // 2) if camera_id not given, allow selecting by target_key (usually camera_name)
            if (out.empty() && !sc.camera_id.has_value() && !sc.target_key.empty() && stepsById.count(depId)) {
                const auto& depStep = stepsById.at(depId);
                for (const auto& t : depStep.targets) {
                    if (t.camera_name == sc.target_key) {
                        auto itCam = so.last_output_by_camera.find(t.camera_id);
                        if (itCam != so.last_output_by_camera.end()) {
                            out = itCam->second;
                            break;
                        }
                    }
                }
            }
            if (out.empty()) {
                out = so.aggregated_output;
            }
        }

        if (out.empty()) return false;
        auto pos = extractSentimentPositive_(out, sc.answer_key.empty() ? "Sentimento_Resposta" : sc.answer_key);
        if (!pos.has_value()) return false;
        if (sc.mode == "positive") return *pos == true;
        return *pos == false;
    }

    // Custom: step can start as soon as an upstream inference signaled its id
    if (sc.mode == "custom") {
        std::lock_guard<std::mutex> lk(job->triggeredMu);
        return job->triggeredStartStepIds.count(step.id) > 0;
    }

    return false;
}

// Pick per-camera agent or default agent
const JobAgentDef* JobRuntime::selectAgentForCamera_(const JobStepDef& step, int cameraId) {
    const JobAgentDef* fallbackDefault = nullptr;

    for (const auto& a : step.agents) {
        if (a.camera_id.has_value() && *a.camera_id == cameraId) {
            return &a;
        }
        if (!a.camera_id.has_value() && !fallbackDefault) {
            fallbackDefault = &a;
        }
    }
    return fallbackDefault ? fallbackDefault : (step.agents.empty() ? nullptr : &step.agents[0]);
}




static StepCaptureNeeds stepCaptureNeedsForCamera_(const JobStepDef& step, int cameraId)
{
    StepCaptureNeeds needs;

    auto markCaptureDemand = [&](
        const std::string& inputTypeRaw,
        const std::string& inferenceModelRaw,
        int modelFpsRaw,
        int runEverySecondsRaw)
    {
        std::string inputType = inputTypeRaw;
        std::transform(inputType.begin(), inputType.end(), inputType.begin(), [](unsigned char c) {
            return static_cast<char>(std::tolower(c));
        });
        if (inputType == "image") {
            needs.image = true;
        }
        else {
            // Default to video for invalid/empty values to preserve legacy safety.
            needs.video = true;
            const int normalizedFps =
                normalizeModelInputFps_(modelFpsRaw, inferenceModelRaw, "video");
            const std::string normalizedInferenceModel =
                normalizeInferenceModel_(inferenceModelRaw);
            const int normalizedRunEverySeconds = isCoreInferenceModel_(normalizedInferenceModel)
                ? 60
                : normalizeRunEverySeconds_(runEverySecondsRaw);
            if (normalizedRunEverySeconds > 10) {
                needs.requestedSixtySecondVideoFps = (std::max)(
                    needs.requestedSixtySecondVideoFps,
                    normalizedFps
                );
            }
            else {
                needs.requestedTenSecondVideoFps = (std::max)(
                    needs.requestedTenSecondVideoFps,
                    normalizedFps
                );
            }
        }
    };

    if (!step.inference_groups.empty()) {
        auto targetIdToCam = [&](int targetId) -> std::optional<int> {
            for (const auto& t : step.targets) {
                if (t.id == targetId) return t.camera_id;
            }
            return std::nullopt;
        };

        for (const auto& g : step.inference_groups) {
            for (int tid : g.target_ids) {
                auto camOpt = targetIdToCam(tid);
                if (camOpt.has_value() && camOpt.value() == cameraId) {
                    markCaptureDemand(g.input_type, g.inference_model, g.model_fps, g.run_every_seconds);
                    break;
                }
            }
        }
        return needs;
    }

    bool hasSpecificAgent = false;
    const JobAgentDef* fallbackDefault = nullptr;

    for (const auto& a : step.agents) {
        if (a.camera_id.has_value() && *a.camera_id == cameraId) {
            hasSpecificAgent = true;
            if (isPortalCounterBackend_(a)) {
                needs.video = true;
                needs.requestedTenSecondVideoFps = (std::max)(
                    needs.requestedTenSecondVideoFps,
                    portalCounterCaptureFps_());
            }
            else {
                markCaptureDemand(a.input_type, a.inference_model, a.model_fps, a.run_every_seconds);
            }
        }
        if (!a.camera_id.has_value() && !fallbackDefault) {
            fallbackDefault = &a;
        }
    }

    if (!hasSpecificAgent && fallbackDefault) {
        if (isPortalCounterBackend_(*fallbackDefault)) {
            needs.video = true;
            needs.requestedTenSecondVideoFps = (std::max)(
                needs.requestedTenSecondVideoFps,
                portalCounterCaptureFps_());
        }
        else {
            markCaptureDemand(
                fallbackDefault->input_type,
                fallbackDefault->inference_model,
                fallbackDefault->model_fps,
                fallbackDefault->run_every_seconds
            );
        }
    }

    return needs;
}

static bool stepNeedsVideoCaptureForCamera_(const JobStepDef& step, int cameraId)
{
    return stepCaptureNeedsForCamera_(step, cameraId).video;
}

static bool stepOnlyCaptureOnMotionForCamera_(const JobStepDef& step, int cameraId)
{
    if (!step.inference_groups.empty()) {
        auto targetIdToCam = [&](int targetId) -> std::optional<int> {
            for (const auto& t : step.targets) {
                if (t.id == targetId) return t.camera_id;
            }
            return std::nullopt;
        };

        bool foundGroupForCamera = false;
        for (const auto& g : step.inference_groups) {
            for (int tid : g.target_ids) {
                auto camOpt = targetIdToCam(tid);
                if (camOpt.has_value() && camOpt.value() == cameraId) {
                    foundGroupForCamera = true;
                    if (!g.only_capture_on_motion) {
                        // "Always capture" wins when there is any conflicting config.
                        return false;
                    }
                }
            }
        }
        if (foundGroupForCamera) {
            return true;
        }
    }

    const JobAgentDef* fallbackDefault = nullptr;
    bool foundSpecificAgentForCamera = false;
    for (const auto& a : step.agents) {
        if (a.camera_id.has_value() && *a.camera_id == cameraId) {
            foundSpecificAgentForCamera = true;
            if (!a.only_capture_on_motion) {
                // "Always capture" wins when there is any conflicting config.
                return false;
            }
        }
        if (!a.camera_id.has_value() && !fallbackDefault) {
            fallbackDefault = &a;
        }
    }

    if (foundSpecificAgentForCamera) return true;

    if (fallbackDefault) return fallbackDefault->only_capture_on_motion;
    return true;
}







std::string JobRuntime::resolvePipelineInputsForCamera_(std::shared_ptr<JobInstance> job,
                                                       const JobStepDef& step,
                                                       int targetCameraId,
                                                       const std::unordered_map<int, JobStepDef>& stepsById) {
    // If the step defines one or more pipeline routes, gather the best-effort latest outputs.
    // IMPORTANT: this function must be non-blocking. If an upstream output is missing, we simply skip/leave empty.

    // Helper: resolve a camera_id from a key (camera_name or numeric string)
    auto resolveCameraId = [&](int fromStepId, const std::string& key) -> std::optional<int> {
        if (key.empty()) return std::nullopt;
        // numeric -> camera_id
        bool allDigits = !key.empty() && std::all_of(key.begin(), key.end(), ::isdigit);
        if (allDigits) {
            try { return std::stoi(key); } catch (...) { /*ignore*/ }
        }
        // try upstream step targets
        auto itStep = stepsById.find(fromStepId);
        if (itStep != stepsById.end()) {
            for (const auto& t : itStep->second.targets) {
                if (t.camera_name == key) return t.camera_id;
            }
        }
        // try camera_start_payloads by name
        for (const auto& [cid, payload] : job->payload.camera_start_payload_by_id) {
            try {
                const std::string nm = payload.value("name", "");
                if (!nm.empty() && nm == key) return cid;
            } catch (...) {}
        }
        return std::nullopt;
    };

    // Helper: try to extract a compact "answer" text from our stored per-camera output.
    // We store compact JSON strings like {"agent_key":...,"camera_id":...,"answer":...}.
    // For pipeline injection we prefer to inject ONLY the "answer" (plus provenance),
    // because the full JSON is noisy and wastes tokens.
    auto extractAnswerOnly = [&](const std::string& raw) -> std::string {
        if (raw.empty()) return "";
        try {
            if (isLikelyJson_(raw)) {
                json j = json::parse(raw);
                if (j.contains("answer") && j["answer"].is_string()) {
                    return j["answer"].get<std::string>();
                }
            }
        } catch (...) {
            // ignore
        }
        return raw; // fallback: already plain text
    };

    auto extractAgentKey = [&](const std::string& raw) -> std::string {
        try {
            if (isLikelyJson_(raw)) {
                json j = json::parse(raw);
                if (j.contains("agent_key") && j["agent_key"].is_string()) {
                    return j["agent_key"].get<std::string>();
                }
            }
        } catch (...) {}
        return "";
    };

    auto cameraNameById = [&](int camId, int fromStepId) -> std::string {
        // Prefer upstream step target names
        auto itStep = stepsById.find(fromStepId);
        if (itStep != stepsById.end()) {
            for (const auto& t : itStep->second.targets) {
                if (t.camera_id == camId && !t.camera_name.empty()) return t.camera_name;
            }
        }
        // Fall back to payload name
        auto itP = job->payload.camera_start_payload_by_id.find(camId);
        if (itP != job->payload.camera_start_payload_by_id.end()) {
            try {
                const std::string nm = itP->second.value("name", "");
                if (!nm.empty()) return nm;
            } catch (...) {}
        }
        return "";
    };

    std::vector<JobInstance::PipelineHook> hooks;
    {
        // job->pipelineHooks is immutable after start, so no mutex required
        for (const auto& h : job->pipelineHooks) {
            if (h.to_step_id != step.id) continue;
            if (h.target_camera_id != targetCameraId) continue;
            hooks.push_back(h);
        }
    }

    if (!hooks.empty()) {
        std::ostringstream out;
        int appended = 0;
        for (const auto& h : hooks) {
            if (h.from_step_id <= 0) continue;

            int fromCamId = h.from_camera_id;
            if (fromCamId < 0) {
                auto cid = resolveCameraId(h.from_step_id, h.from_camera_key);
                if (cid.has_value()) fromCamId = *cid;
            }
            if (fromCamId < 0) continue;

            StepOutput depOut;
            {
                std::lock_guard<std::mutex> lk(job->outputsMu);
                auto it = job->outputs.find(h.from_step_id);
                if (it == job->outputs.end()) continue;
                depOut = it->second;
            }

            std::string rawTxt;
            auto itC = depOut.last_output_by_camera.find(fromCamId);
            if (itC != depOut.last_output_by_camera.end()) rawTxt = itC->second;
            if (rawTxt.empty()) rawTxt = depOut.aggregated_output;
            if (rawTxt.empty()) continue;

            const std::string answerTxt = extractAnswerOnly(rawTxt);
            const std::string agentKey = extractAgentKey(rawTxt);
            const std::string camName = cameraNameById(fromCamId, h.from_step_id);
            const std::string stepName = (stepsById.count(h.from_step_id) ? stepsById.at(h.from_step_id).name : "");

            if (appended == 0) {
                out << "PIPELINE_INPUTS (context from previous steps):\n";
            }

            out << "- Source: step " << h.from_step_id;
            if (!stepName.empty()) out << " (\"" << stepName << "\")";
            out << ", camera " << fromCamId;
            if (!camName.empty()) out << " (\"" << camName << "\")";
            if (!h.from_camera_key.empty()) out << " [input_inject_key=\"" << h.from_camera_key << "\"]";
            if (!agentKey.empty()) out << ", agent_key=\"" << agentKey << "\"";
            out << "\n";
            out << "  Answer:\n" << answerTxt << "\n\n";
            appended++;
        }
        return out.str();
    }

    // Fallback: legacy single pipeline fields (step.pipeline / input_from_step_id)
    return resolvePipelineInput_(job, step, stepsById);
}

std::string JobRuntime::resolvePipelineInput_(std::shared_ptr<JobInstance> job,
                                            const JobStepDef& step,
                                            const std::unordered_map<int, JobStepDef>& stepsById) {
    std::optional<int> depOpt;
    std::string key;

    if (step.pipeline.has_value()) {
        depOpt = step.pipeline->from_step_id;
        key = step.pipeline->inject_key;
    } else {
        depOpt = step.input_from_step_id;
        key = step.input_inject_key;
    }

    if (!depOpt.has_value()) return "";
    const int depId = *depOpt;
    if (!job->outputs.count(depId)) {
        if (step.on_missing_input == "skip") return "__MISSING_INPUT__";
        return "";
    }

    StepOutput depOut;
    {
        std::lock_guard<std::mutex> lk(job->outputsMu);
        depOut = job->outputs[depId];
    }

    auto extractAnswerOnly = [&](const std::string& raw) -> std::string {
        if (raw.empty()) return "";
        try {
            if (isLikelyJson_(raw)) {
                json j = json::parse(raw);
                if (j.contains("answer") && j["answer"].is_string()) {
                    return j["answer"].get<std::string>();
                }
            }
        } catch (...) {}
        return raw;
    };

    auto extractAgentKey = [&](const std::string& raw) -> std::string {
        try {
            if (isLikelyJson_(raw)) {
                json j = json::parse(raw);
                if (j.contains("agent_key") && j["agent_key"].is_string()) {
                    return j["agent_key"].get<std::string>();
                }
            }
        } catch (...) {}
        return "";
    };

    auto cameraNameById = [&](int camId) -> std::string {
        auto itP = job->payload.camera_start_payload_by_id.find(camId);
        if (itP != job->payload.camera_start_payload_by_id.end()) {
            try {
                const std::string nm = itP->second.value("name", "");
                if (!nm.empty()) return nm;
            } catch (...) {}
        }
        // If key matched a target name, prefer that.
        if (stepsById.count(depId)) {
            for (const auto& t : stepsById.at(depId).targets) {
                if (t.camera_id == camId && !t.camera_name.empty()) return t.camera_name;
            }
        }
        return "";
    };

    auto formatWithProvenance = [&](int camId, const std::string& rawTxt) -> std::string {
        const std::string answerTxt = extractAnswerOnly(rawTxt);
        const std::string agentKey = extractAgentKey(rawTxt);
        const std::string camName = cameraNameById(camId);
        const std::string stepName = (stepsById.count(depId) ? stepsById.at(depId).name : "");
        std::ostringstream oss;
        oss << "PIPELINE_INPUT (context from previous step):\n";
        oss << "- Source: step " << depId;
        if (!stepName.empty()) oss << " (\"" << stepName << "\")";
        if (camId >= 0) {
            oss << ", camera " << camId;
            if (!camName.empty()) oss << " (\"" << camName << "\")";
        } else {
            oss << ", camera (unknown)";
        }
        if (!key.empty()) oss << " [input_inject_key=\"" << key << "\"]";
        if (!agentKey.empty()) oss << ", agent_key=\"" << agentKey << "\"";
        oss << "\n";
        oss << "  Answer:\n" << answerTxt << "\n";
        return oss.str();
    };

    // 1) if key is numeric -> camera_id
    try {
        if (!key.empty() && std::all_of(key.begin(), key.end(), ::isdigit)) {
            int camId = std::stoi(key);
            auto it = depOut.last_output_by_camera.find(camId);
            if (it != depOut.last_output_by_camera.end()) return formatWithProvenance(camId, it->second);
        }
    }
    catch (...) {}

    // 2) if key matches a camera_name from dep step targets -> map to camera_id
    if (!key.empty() && stepsById.count(depId)) {
        const auto& depStep = stepsById.at(depId);
        for (const auto& t : depStep.targets) {
            if (t.camera_name == key) {
                auto it = depOut.last_output_by_camera.find(t.camera_id);
                if (it != depOut.last_output_by_camera.end()) return formatWithProvenance(t.camera_id, it->second);
            }
        }
    }

    // 3) if dep aggregated exists, use it (provenance: unknown camera)
    if (!depOut.aggregated_output.empty()) return formatWithProvenance(/*camId*/ -1, depOut.aggregated_output);

    // 4) else any last output
    for (auto& [cid, txt] : depOut.last_output_by_camera) {
        if (!txt.empty()) return formatWithProvenance(cid, txt);
    }

    return "__MISSING_INPUT__";
}

bool JobRuntime::isLikelyJson_(const std::string& s) {
    for (char c : s) { if (!isspace((unsigned char)c)) return c == '{' || c == '['; }
    return false;
}

// --- Reporting via AgentCore (use your existing /api/agent/events plumbing) ---
void JobRuntime::postJobEvent_(const std::string& eventType, const JobDefSnapshot& job, const json& details) {
    if (!owner_) return;
    json enriched = details;
    std::shared_ptr<JobInstance> inst;
    {
        std::lock_guard<std::mutex> lk(mu_);
        auto it = running_.find(job.id);
        if (it != running_.end()) {
            inst = it->second;
        }
    }
    if (inst) {
        const JobStartPayload& payload = inst->payload;
        if (!payload.shared_segment_id.empty()) {
            enriched["shared_segment_id"] = payload.shared_segment_id;
        }
        if (!payload.shared_execution_domain.empty()) {
            enriched["shared_execution_domain"] = payload.shared_execution_domain;
        }
        if (!payload.shared_owner_public_id.empty()) {
            enriched["shared_owner_public_id"] = payload.shared_owner_public_id;
        }
        if (!payload.shared_operator_public_id.empty()) {
            enriched["shared_operator_public_id"] = payload.shared_operator_public_id;
        }
        if (payload.shared_operator_job_id > 0) {
            enriched["shared_operator_job_id"] = payload.shared_operator_job_id;
        }
        enriched["shared_allow_event_media"] = payload.shared_allow_event_media;
        enriched["shared_cross_camera_federation_required"] =
            payload.shared_cross_camera_federation_required;
    }
    owner_->postAgentEvent(eventType, /*cameraId*/ std::nullopt, job.user_id, /*message*/"", enriched);
}

void JobRuntime::postStepEvent_(const std::string& eventType, const JobDefSnapshot& job, const JobStepDef& step, const json& extra) {
    json d = extra;
    d["job_id"] = job.id;
    d["job_name"] = job.name;
    d["step_id"] = step.id;
    d["step_order"] = step.step_order;
    d["step_name"] = step.name;
    if (!step.step_run_id.empty()) {
        d["step_run_id"] = step.step_run_id;
    }
    postJobEvent_(eventType, job, d);
}

std::string JobRuntime::maybeEmitFinalTemporalReportOnTimeout_(
    int jobId,
    int stepId,
    int cameraId,
    const JobAgentDef& agent,
    const std::string& alertConditionText,
    const std::string& jobRunId,
    const std::string& stepRunId,
    const std::string& agentRunId,
    const std::string& evaluationNowIsoUtc,
    const json* coverageDetails)
{
    if (!owner_) return "";

    const std::string temporalPromptCore = trimCopyRuntime_(agent.prompt_template);
    const std::string temporalPromptHash =
        temporal::computePromptRevisionHash(
            temporalPromptCore,
            alertConditionText,
            agent.negative_condition_text,
            agent.input_type,
            "pt-BR",
            true);
    const std::string temporalSlotKey =
        "job:" + std::to_string(jobId) +
        "|step:" + std::to_string(stepId) +
        "|cam:" + std::to_string(cameraId) +
        "|agent:" + std::to_string(agent.id > 0 ? agent.id : 0);

    TemporalRuntimeSlot temporalSlot;
    bool haveTemporalSlot = false;
    {
        std::lock_guard<std::mutex> lock(temporalMu_);
        auto it = temporalBySlot_.find(temporalSlotKey);
        if (it != temporalBySlot_.end()) {
            temporalSlot = it->second;
            haveTemporalSlot = true;
        }
    }
    if (!haveTemporalSlot || !temporal::planUsable(temporalSlot.planEnvelope) || !temporalSlot.state.is_object()) {
        return "";
    }
    if (!temporalSlot.visualState.is_object()) {
        temporalSlot.visualState = json::object();
    }

    const bool slotPlanMatchesCurrentPrompt =
        (!temporalSlot.promptHash.empty() && temporalSlot.promptHash == temporalPromptHash) ||
        temporal::planMatchesPromptRevision(
            temporalSlot.planEnvelope,
            temporalPromptCore,
            alertConditionText,
            agent.negative_condition_text,
            agent.input_type,
            "pt-BR",
            true
        );
    if (!slotPlanMatchesCurrentPrompt) {
        return "";
    }

    const std::string nowIsoUtc = temporal::decisionAnchorUtc(
        evaluationNowIsoUtc.empty() ? temporal::nowIso() : evaluationNowIsoUtc
    );
    const temporal::EvalResult eval = temporal::evaluate(
        temporalSlot.state,
        temporalSlot.planEnvelope,
        nowIsoUtc
    );

    temporalSlot.touchedAt = std::chrono::steady_clock::now();
    temporalSlot.promptHash = temporalPromptHash;
    {
        std::lock_guard<std::mutex> lock(temporalMu_);
        temporalBySlot_[temporalSlotKey] = temporalSlot;
    }

    if (!eval.report) {
        return "";
    }

    const TemporalEvidenceTrail temporalEvidenceTrail =
        loadTemporalEvidenceTrail_(temporalSlotKey);
    const std::vector<std::string> lastRoundEvidenceKeys =
        temporal::extractLastRoundEvidenceKeys(temporalSlot.state);
    const std::string reportCameraName =
        (coverageDetails && coverageDetails->is_object())
            ? coverageDetails->value("camera_name", std::string())
            : std::string();
    const json temporalGroupImages = buildTemporalAlertGroupImages_(
        temporalEvidenceTrail,
        eval.operatorResults,
        lastRoundEvidenceKeys,
        cameraId,
        reportCameraName);
    const std::string temporalFallbackImageB64 =
        extractFirstTemporalGroupImageB64_(temporalGroupImages);

    const json identityCards =
        owner_->collectOperationalIdentityCards(temporalSlot.state, temporalSlot.visualState);
    std::string primaryIdentityCardId;
    if (identityCards.is_array() &&
        !identityCards.empty() &&
        identityCards[0].is_object() &&
        identityCards[0].contains("card_id") &&
        identityCards[0]["card_id"].is_string())
    {
        primaryIdentityCardId =
            trimCopyRuntime_(identityCards[0]["card_id"].get<std::string>());
    }

    json reportDetails = {
        { "job_id", jobId },
        { "step_id", stepId },
        { "camera_id", cameraId },
        { "agent_id", agent.id },
        { "operator_results", eval.operatorResults },
        { "temporal_operator_results", eval.operatorResults },
        { "answer", eval.summary },
        { "decision_source", "temporal_engine" },
        { "llm_alert_condition", false },
        { "final_alert_condition", eval.alert },
        { "temporal_decision_summary", eval.summary },
        { "status_reason",
          (coverageDetails && coverageDetails->is_object())
              ? coverageDetails->value(
                    "analysis_status",
                    coverageDetails->value("coverage_status", std::string("deadline_reached")))
              : std::string("deadline_reached") },
        { "trigger_source",
          (coverageDetails && coverageDetails->is_object() &&
           !coverageDetails->value("analysis_frontier_utc", std::string()).empty())
              ? "step_timeout_flush_analysis_frontier"
              : "step_timeout_flush" }
    };
    if (!jobRunId.empty()) {
        reportDetails["job_run_id"] = jobRunId;
    }
    if (!stepRunId.empty()) {
        reportDetails["step_run_id"] = stepRunId;
    }
    if (!agentRunId.empty()) {
        reportDetails["agent_run_id"] = agentRunId;
    }
    if (!primaryIdentityCardId.empty()) {
        reportDetails["primary_identity_card_id"] = primaryIdentityCardId;
    }
    if (identityCards.is_array() && !identityCards.empty()) {
        reportDetails["identity_cards"] = identityCards;
    }
    if (temporalGroupImages.is_array() && !temporalGroupImages.empty()) {
        reportDetails["group_images"] = temporalGroupImages;
        reportDetails["group_image_count"] = temporalGroupImages.size();
    }
    if (!temporalFallbackImageB64.empty()) {
        reportDetails["image_jpeg_b64"] = temporalFallbackImageB64;
    }
    if (coverageDetails && coverageDetails->is_object()) {
        for (auto it = coverageDetails->begin(); it != coverageDetails->end(); ++it) {
            reportDetails[it.key()] = it.value();
        }
    }
    const std::string temporalScopeKey = buildJobTemporalReportScopeKey_(
        jobId,
        stepId,
        cameraId,
        agent.id,
        jobRunId,
        stepRunId,
        agentRunId);
    if (eval.reportDeliveryMarkers.is_array() && !eval.reportDeliveryMarkers.empty()) {
        const std::string externalEventId =
            temporal::buildTemporalReportExternalEventId(
                temporalScopeKey,
                eval.reportDeliveryMarkers);
        reportDetails["external_event_id"] = externalEventId;
        reportDetails["event_id"] = externalEventId;
    }

    const AgentCore::AgentEventPostResult reportPostResult =
        owner_->postAgentEventWithResult(
            "temporal_report",
            std::optional<int>(cameraId),
            "",
            "",
            reportDetails
        );
    const bool temporalReportDelivered = reportPostResult.ok;
    if (temporalReportDelivered) {
        temporal::acknowledgeDeliveredReportMarkers(
            temporalSlot.state,
            eval.reportDeliveryMarkers,
            nowIsoUtc);
        temporalSlot.touchedAt = std::chrono::steady_clock::now();
        temporalSlot.promptHash = temporalPromptHash;
        {
            std::lock_guard<std::mutex> lock(temporalMu_);
            temporalBySlot_[temporalSlotKey] = temporalSlot;
        }
    } else {
        Logger::instance().logError(
            cameraId > 0 ? std::to_string(cameraId) : "job",
            "failed to post temporal report during timeout flush",
            makeJobErrorContext_(
                "job_step",
                "JobRuntime::maybeEmitFinalTemporalReportOnTimeout_",
                "post_temporal_report",
                {
                    { "job_id", jobId },
                    { "step_id", stepId },
                    { "camera_id", cameraId },
                    { "agent_id", agent.id },
                    { "http_code", reportPostResult.httpCode },
                    { "response", reportPostResult.response }
                }
            )
        );
    }

    json out = {
        { "answer", eval.summary },
        { "decision_source", "temporal_engine" },
        { "temporal_operator_results", eval.operatorResults },
        { "temporal_report_due", true },
        { "temporal_report_delivered", temporalReportDelivered },
        { "temporal_decision_summary", eval.summary },
        { "alert_condition", eval.alert },
        { "llm_alert_condition", false },
        { "final_alert_condition", eval.alert }
    };
    if (!primaryIdentityCardId.empty()) {
        out["primary_identity_card_id"] = primaryIdentityCardId;
    }
    if (identityCards.is_array() && !identityCards.empty()) {
        out["identity_cards"] = identityCards;
    }
    if (temporalGroupImages.is_array() && !temporalGroupImages.empty()) {
        out["group_images"] = temporalGroupImages;
        out["group_image_count"] = temporalGroupImages.size();
    }
    if (!temporalFallbackImageB64.empty()) {
        out["image_jpeg_b64"] = temporalFallbackImageB64;
    }
    if (coverageDetails && coverageDetails->is_object()) {
        for (auto it = coverageDetails->begin(); it != coverageDetails->end(); ++it) {
            out[it.key()] = it.value();
        }
    }
    return out.dump();
}


std::string JobRuntime::runAgentInferenceOnCamera_(
    int jobId,
    int stepId,
    int cameraId,
    const JobAgentDef& agent,
    const std::string& injectedInput,
    const std::string& alertConditionText,
    const std::string& startConditionText,
    const std::string& modelTier,
    const std::string& jobRunId,
    const std::string& stepRunId,
    const std::string& agentRunId,
    int timeoutSeconds,
    std::atomic<bool>& cancel,
    const std::string& coverageCutoffUtcIso,
    JobInstance::InferenceMediaInfo* outMediaInfo
) {
    if (cancel) return "";
    if (outMediaInfo) {
        *outMediaInfo = JobInstance::InferenceMediaInfo{};
    }

    // Normalize input_type (defensive)
    std::string it = agent.input_type;
    for (auto& ch : it) ch = (char)std::tolower((unsigned char)ch);
    const bool isImage = (it == "image");
    const std::string inferenceModel = normalizeInferenceModel_(agent.inference_model);
    const bool useCore = isCoreInferenceModel_(inferenceModel);
    const bool useOpenAICompatible = isOpenAIInferenceModel_(inferenceModel) || useCore;
    const std::string openAiModelName = openAIModelNameForInferenceModel_(inferenceModel);
    const std::string modelApiKey = agent.api_key;
    int modelInputFps = normalizeModelInputFps_(agent.model_fps, inferenceModel, it);
    const int runningResolution = normalizeCoreRunningResolution_(agent.running_resolution);
    const std::vector<FaceReferenceImage> faceReferences =
        resolveFaceReferenceImagesForJob_(owner_, agent.face_targets);
    const std::vector<NegativeReferenceImage> negativeReferences =
        resolveNegativeReferenceImagesForJob_(owner_, agent.negative_reference_images);
    const bool faceIdOnlyMode = isFaceIdOnlyMode_(
        agent.prompt_template,
        alertConditionText,
        agent.face_targets
    );
    const std::vector<std::string> configuredFaceTargetNames =
        collectFaceTargetDisplayNames_(agent.face_targets);
    const std::string temporalLanguage = "pt-BR";
    const std::string temporalPromptCore = trimCopyRuntime_(agent.prompt_template);
    const std::string temporalPromptHash =
        temporal::computePromptRevisionHash(
            temporalPromptCore,
            alertConditionText,
            agent.negative_condition_text,
            agent.input_type,
            temporalLanguage,
            true);
    const std::string temporalSlotKey =
        "job:" + std::to_string(jobId) +
        "|step:" + std::to_string(stepId) +
        "|cam:" + std::to_string(cameraId) +
        "|agent:" + std::to_string(agent.id > 0 ? agent.id : 0);
    auto loadTemporalSlot = [&]() -> TemporalRuntimeSlot {
        TemporalRuntimeSlot slot;
        slot.state = temporal::defaultState();
        const bool payloadPlanMatchesCurrentPrompt =
            temporal::decisionCacheable(agent.temporal_plan_envelope) &&
            temporal::planMatchesPromptRevision(
                agent.temporal_plan_envelope,
                temporalPromptCore,
                alertConditionText,
                agent.negative_condition_text,
                agent.input_type,
                temporalLanguage,
                true
            );
        std::lock_guard<std::mutex> lock(temporalMu_);
        auto it = temporalBySlot_.find(temporalSlotKey);
        if (it != temporalBySlot_.end()) {
            slot = it->second;
        }
        const bool slotPlanMatchesCurrentPrompt =
            temporal::decisionCacheable(slot.planEnvelope) &&
            ((!slot.promptHash.empty() && slot.promptHash == temporalPromptHash) ||
             temporal::planMatchesPromptRevision(
                 slot.planEnvelope,
                 temporalPromptCore,
                 alertConditionText,
                 agent.negative_condition_text,
                 agent.input_type,
                 temporalLanguage,
                 true
             ));
        if (!slotPlanMatchesCurrentPrompt) {
            slot.planEnvelope = payloadPlanMatchesCurrentPrompt
                ? agent.temporal_plan_envelope
                : nlohmann::json::object();
            slot.state = temporal::defaultState();
            slot.visualState = json::object();
            temporalEvidenceBySlot_.erase(temporalSlotKey);
        }
        if (!slot.state.is_object() || slot.state.empty()) {
            slot.state = temporal::defaultState();
        }
        if (!slot.visualState.is_object()) {
            slot.visualState = json::object();
        }
        slot.promptHash = temporalPromptHash;
        return slot;
    };
    auto saveTemporalSlot = [&](const TemporalRuntimeSlot& slot) {
        std::lock_guard<std::mutex> lock(temporalMu_);
        TemporalRuntimeSlot persisted = slot;
        persisted.promptHash = temporalPromptHash;
        temporalBySlot_[temporalSlotKey] = std::move(persisted);
    };
    const std::string temporalReportScopeKey = buildJobTemporalReportScopeKey_(
        jobId,
        stepId,
        cameraId,
        agent.id,
        jobRunId,
        stepRunId,
        agentRunId);
    auto attachTemporalReportDeliveryIds = [&](json& reportDetails,
                                               const json& reportDeliveryMarkers) {
        if (!reportDeliveryMarkers.is_array() || reportDeliveryMarkers.empty()) {
            return;
        }
        const std::string externalEventId =
            temporal::buildTemporalReportExternalEventId(
                temporalReportScopeKey,
                reportDeliveryMarkers);
        reportDetails["external_event_id"] = externalEventId;
        if (!reportDetails.contains("event_id") ||
            !reportDetails["event_id"].is_string() ||
            trimCopyRuntime_(reportDetails["event_id"].get<std::string>()).empty())
        {
            reportDetails["event_id"] = externalEventId;
        }
    };
    auto acknowledgeTemporalReportDelivery = [&](TemporalRuntimeSlot& slot,
                                                 const json& reportDeliveryMarkers,
                                                 const std::string& deliveredAtUtc = std::string()) {
        temporal::acknowledgeDeliveredReportMarkers(slot.state, reportDeliveryMarkers, deliveredAtUtc);
        slot.touchedAt = std::chrono::steady_clock::now();
        slot.promptHash = temporalPromptHash;
        saveTemporalSlot(slot);
    };
    TemporalRuntimeSlot preparedTemporalSlot = loadTemporalSlot();
    bool temporalPlanPrepared = temporal::planUsable(preparedTemporalSlot.planEnvelope);
    if (owner_) {
        const bool temporalReady = owner_->ensureTemporalPlanForRuntime(
            "job_step_agent",
            agent.id > 0 ? agent.id : stepId,
            temporalPromptCore,
            alertConditionText,
            agent.negative_condition_text,
            isImage ? "image" : "video",
            temporalLanguage,
            inferenceModel,
            modelApiKey,
            preparedTemporalSlot.planEnvelope,
            agent.id > 0,
            std::to_string(cameraId)
        );
        if (temporal::decisionCacheable(preparedTemporalSlot.planEnvelope)) {
            preparedTemporalSlot.promptHash = temporalPromptHash;
            saveTemporalSlot(preparedTemporalSlot);
        }
        if (temporalReady && temporal::planUsable(preparedTemporalSlot.planEnvelope)) {
            temporalPlanPrepared = true;
            Logger::instance().logDebug(
                "job",
                "runAgentInferenceOnCamera_: temporal plan prepared pre-media job_id=" +
                std::to_string(jobId) + " step_id=" + std::to_string(stepId) +
                " camera_id=" + std::to_string(cameraId) +
                " input_type=" + std::string(isImage ? "image" : "video")
            );
        }
    }
    const std::string crossCameraStepKey =
        "job:" + std::to_string(jobId) + "|step:" + std::to_string(stepId);
    auto collectCrossCameraOperators = [&](const json& envelope) -> json {
        json configs = json::array();
        const json plan = temporal::effectivePlan(envelope);
        if (!plan.is_object() || !plan.contains("operators") || !plan["operators"].is_array()) {
            return configs;
        }
        for (const auto& op : plan["operators"]) {
            if (!op.is_object()) continue;
            if (temporal::lower(temporal::trim(temporal::strField(op, "type"))) != "cross_camera_track_after_trigger") {
                continue;
            }
            const json params = op.value("params", json::object());
            if (temporal::lower(temporal::trim(temporal::strField(params, "scope", "job_step"))) != "job_step") {
                continue;
            }
            json cfg = {
                { "operator_id", temporal::strField(op, "operator_id") },
                { "trigger_mode", temporal::strField(params, "trigger_mode", "alert_condition_true") },
                { "trigger_event", temporal::strField(params, "trigger_event") },
                { "watch_ttl_seconds", temporal::intField(params, "watch_ttl_seconds", 900) },
                { "alert_on_match", params.contains("alert_on_match") ? params["alert_on_match"] : json(true) },
                { "share_entity_types", params.contains("share_entity_types") && params["share_entity_types"].is_array()
                    ? params["share_entity_types"] : json::array() }
            };
            configs.push_back(std::move(cfg));
        }
        return configs;
    };
    const json crossCameraOperatorConfigs =
        temporalPlanPrepared && temporal::planUsable(preparedTemporalSlot.planEnvelope)
            ? collectCrossCameraOperators(preparedTemporalSlot.planEnvelope)
            : json::array();
    const bool crossCameraPublishEnabled =
        crossCameraOperatorConfigs.is_array() && !crossCameraOperatorConfigs.empty();

    auto cleanupExpiredCrossCameraHunts = [&](json& hunts, const std::string& nowIsoUtc) {
        if (!hunts.is_array()) {
            hunts = json::array();
            return;
        }
        json filtered = json::array();
        for (const auto& hunt : hunts) {
            if (!hunt.is_object()) continue;
            const int ttlSeconds = std::max(1, temporal::intField(hunt, "watch_ttl_seconds", 900));
            const std::string createdAt = temporal::strField(hunt, "created_at_utc");
            if (createdAt.empty()) continue;
            if (temporal::ageSeconds(createdAt, nowIsoUtc) > ttlSeconds) continue;
            if (!hunt.contains("entities") || !hunt["entities"].is_array() || hunt["entities"].empty()) continue;
            filtered.push_back(hunt);
        }
        hunts = std::move(filtered);
        if (hunts.size() > 64) {
            hunts.erase(hunts.begin(), hunts.begin() + (hunts.size() - 64));
        }
    };

    auto collectRoundEntityIdsForEvent = [&](const VideoHit& roundHit, const std::string& rawEvent) -> json {
        json ids = json::array();
        const std::string expected = temporal::lower(temporal::trim(temporal::normalizeEventName(rawEvent)));
        if (expected.empty()) return ids;
        std::unordered_set<std::string> seenIds;
        auto appendId = [&](const std::string& rawId) {
            const std::string entityId = temporal::trim(rawId);
            if (entityId.empty() || !seenIds.insert(entityId).second) return;
            ids.push_back(entityId);
        };
        auto matchesEvent = [&](const json& node) -> bool {
            if (node.is_string()) {
                return temporal::lower(temporal::trim(temporal::normalizeEventName(node.get<std::string>()))) == expected;
            }
            if (!node.is_object()) return false;
            const std::string ev = temporal::strField(node, "event",
                temporal::strField(node, "type", temporal::strField(node, "event_type")));
            return temporal::lower(temporal::trim(temporal::normalizeEventName(ev))) == expected;
        };
        if (roundHit.identityPatch.is_array()) {
            for (const auto& patch : roundHit.identityPatch) {
                if (!patch.is_object() || !patch.contains("events") || !patch["events"].is_array()) continue;
                const std::string patchEntityId = temporal::trim(temporal::strField(patch, "entity_id"));
                for (const auto& ev : patch["events"]) {
                    if (ev.is_object() &&
                        expected != "present" &&
                        !temporal::nodeCountsAsNewEvent(ev))
                    {
                        continue;
                    }
                    if (!matchesEvent(ev)) continue;
                    if (ev.is_object()) {
                        appendId(temporal::strField(ev, "entity_id", temporal::strField(ev, "id", patchEntityId)));
                    }
                    else {
                        appendId(patchEntityId);
                    }
                }
            }
        }
        if (roundHit.observations.is_array()) {
            for (const auto& obs : roundHit.observations) {
                if (obs.is_object() &&
                    expected != "present" &&
                    !temporal::nodeCountsAsNewEvent(obs))
                {
                    continue;
                }
                if (!matchesEvent(obs)) continue;
                if (obs.is_object()) {
                    appendId(temporal::strField(obs, "entity_id", temporal::strField(obs, "id")));
                }
            }
        }
        return ids;
    };

    auto roundContainsEvent = [&](const VideoHit& roundHit, const std::string& rawEvent) -> bool {
        const std::string expected = temporal::lower(temporal::trim(temporal::normalizeEventName(rawEvent)));
        if (expected.empty()) return false;
        auto matchesEvent = [&](const json& node) -> bool {
            if (node.is_string()) {
                return temporal::lower(temporal::trim(temporal::normalizeEventName(node.get<std::string>()))) == expected;
            }
            if (!node.is_object()) return false;
            const std::string ev = temporal::strField(node, "event",
                temporal::strField(node, "type", temporal::strField(node, "event_type")));
            return temporal::lower(temporal::trim(temporal::normalizeEventName(ev))) == expected;
        };
        if (roundHit.identityPatch.is_array()) {
            for (const auto& patch : roundHit.identityPatch) {
                if (!patch.is_object() || !patch.contains("events") || !patch["events"].is_array()) continue;
                for (const auto& ev : patch["events"]) {
                    if (ev.is_object() &&
                        expected != "present" &&
                        !temporal::nodeCountsAsNewEvent(ev))
                    {
                        continue;
                    }
                    if (matchesEvent(ev)) return true;
                }
            }
        }
        if (roundHit.observations.is_array()) {
            for (const auto& obs : roundHit.observations) {
                if (obs.is_object() &&
                    expected != "present" &&
                    !temporal::nodeCountsAsNewEvent(obs))
                {
                    continue;
                }
                if (matchesEvent(obs)) return true;
            }
        }
        return false;
    };

    auto buildIdentityMemoryIndex = [&](const json& state) -> std::unordered_map<std::string, json> {
        std::unordered_map<std::string, json> memoryById;
        if (!state.contains("identity_memory") || !state["identity_memory"].is_array()) {
            return memoryById;
        }
        for (const auto& item : state["identity_memory"]) {
            if (!item.is_object()) continue;
            const std::string entityId = temporal::trim(temporal::strField(item, "entity_id"));
            if (!entityId.empty()) memoryById[entityId] = item;
        }
        return memoryById;
    };

    auto canonicalizeSharedEntityType = [&](const std::string& candidateRaw,
                                            const json& shareEntityTypes) -> std::string {
        const std::string candidate = temporal::lower(temporal::trim(candidateRaw));
        if (candidate.empty()) return std::string();
        if (!shareEntityTypes.is_array() || shareEntityTypes.empty()) {
            return candidate;
        }
        for (const auto& allowed : shareEntityTypes) {
            if (!allowed.is_string()) continue;
            const std::string allowedType = temporal::lower(temporal::trim(allowed.get<std::string>()));
            if (allowedType.empty()) continue;
            if (candidate == allowedType) return allowedType;
            if (candidate.rfind(allowedType + "_", 0) == 0) return allowedType;
            if (candidate.rfind(allowedType + "#", 0) == 0) return allowedType;
        }
        return std::string();
    };

    auto canonicalizeSharedEntityForDoc = [&](const std::string& entityIdRaw,
                                              const json& doc,
                                              const json& shareEntityTypes) -> std::string {
        if (doc.is_object()) {
            const std::string entityKey =
                temporal::trim(temporal::strField(doc, "entity_key"));
            const std::string keyMatch =
                canonicalizeSharedEntityType(entityKey, shareEntityTypes);
            if (!keyMatch.empty()) return keyMatch;

            const std::string entityType =
                temporal::trim(temporal::strField(doc, "entity_type"));
            const std::string typeMatch =
                canonicalizeSharedEntityType(entityType, shareEntityTypes);
            if (!typeMatch.empty()) return typeMatch;
        }

        const std::string entityId = temporal::trim(entityIdRaw);
        if (!entityId.empty()) {
            const std::string idMatch =
                canonicalizeSharedEntityType(entityId, shareEntityTypes);
            if (!idMatch.empty()) return idMatch;
        }

        return std::string();
    };

    auto inferCrossCameraEntityType = [&](const std::string& entityId,
                                          const json* patchNode,
                                          const json& state,
                                          const std::unordered_map<std::string, json>& memoryById) -> std::string {
        if (patchNode && patchNode->is_object()) {
            const std::string entityType = temporal::trim(temporal::strField(*patchNode, "entity_type"));
            if (!entityType.empty()) return entityType;
            const std::string entityKey = temporal::trim(temporal::strField(*patchNode, "entity_key"));
            if (!entityKey.empty()) return entityKey;
        }
        if (!entityId.empty()) {
            auto memIt = memoryById.find(entityId);
            if (memIt != memoryById.end()) {
                const std::string entityType = temporal::trim(temporal::strField(memIt->second, "entity_type"));
                if (!entityType.empty()) return entityType;
                const std::string entityKey = temporal::trim(temporal::strField(memIt->second, "entity_key"));
                if (!entityKey.empty()) return entityKey;
            }
            if (state.contains("entities") && state["entities"].is_object() &&
                state["entities"].contains(entityId) && state["entities"][entityId].is_object())
            {
                const std::string entityType = temporal::trim(temporal::strField(state["entities"][entityId], "entity_type"));
                if (!entityType.empty()) return entityType;
                const auto prefixPos = entityId.find_last_of("_#");
                if (prefixPos != std::string::npos && prefixPos + 1 < entityId.size()) {
                    bool numericSuffix = true;
                    for (std::size_t i = prefixPos + 1; i < entityId.size(); ++i) {
                        if (!std::isdigit(static_cast<unsigned char>(entityId[i]))) {
                            numericSuffix = false;
                            break;
                        }
                    }
                    if (numericSuffix) return entityId.substr(0, prefixPos);
                }
                return entityId;
            }
        }
        return std::string();
    };

    auto buildCrossCameraStateBackedDoc = [&](const std::string& rawEntityId,
                                              const json& state,
                                              const json& shareEntityTypes) -> json {
        const std::string entityId = temporal::trim(rawEntityId);
        if (entityId.empty()) return json::object();

        const std::unordered_map<std::string, json> memoryById = buildIdentityMemoryIndex(state);
        json doc = {
            { "entity_id", entityId }
        };

        auto memIt = memoryById.find(entityId);
        if (memIt != memoryById.end()) {
            const json& mem = memIt->second;
            if (mem.contains("description") && mem["description"].is_string()) {
                doc["description"] = mem["description"];
            }
            else if (mem.contains("appearance_summary") && mem["appearance_summary"].is_string()) {
                doc["description"] = mem["appearance_summary"];
            }
            if (mem.contains("identity_signature_summary") && mem["identity_signature_summary"].is_string()) {
                doc["identity_signature_summary"] = mem["identity_signature_summary"];
            }
            if (mem.contains("key_traits") && mem["key_traits"].is_array() && !mem["key_traits"].empty()) {
                doc["key_traits"] = mem["key_traits"];
            }
            else if (mem.contains("updated_traits")) {
                const json traits = temporal::parseTraitsValue(mem["updated_traits"]);
                if (traits.is_array() && !traits.empty()) doc["key_traits"] = traits;
            }
            if (mem.contains("stable_attributes") && mem["stable_attributes"].is_array() && !mem["stable_attributes"].empty()) {
                doc["stable_attributes"] = mem["stable_attributes"];
            }
            if (mem.contains("identity_signature_traits") && mem["identity_signature_traits"].is_array() && !mem["identity_signature_traits"].empty()) {
                doc["identity_signature_traits"] = mem["identity_signature_traits"];
            }
            if (mem.contains("latest_context_traits") && mem["latest_context_traits"].is_array() && !mem["latest_context_traits"].empty()) {
                doc["updated_traits"] = mem["latest_context_traits"];
            }
            if (mem.contains("identity_context_traits") && mem["identity_context_traits"].is_array() && !mem["identity_context_traits"].empty()) {
                doc["identity_context_traits"] = mem["identity_context_traits"];
            }
            if (mem.contains("entity_key") && mem["entity_key"].is_string()) {
                doc["entity_key"] = mem["entity_key"];
            }
            if (mem.contains("entity_type") && mem["entity_type"].is_string()) {
                doc["entity_type"] = mem["entity_type"];
            }
            if (mem.contains("last_seen_ts_utc") && mem["last_seen_ts_utc"].is_string()) {
                doc["last_seen_ts_utc"] = mem["last_seen_ts_utc"];
            }
            if (mem.contains("last_seen_zone") && mem["last_seen_zone"].is_string()) {
                doc["last_seen_zone"] = mem["last_seen_zone"];
            }
            if (mem.contains("reference_image_urls") && mem["reference_image_urls"].is_array()) {
                doc["reference_image_urls"] = mem["reference_image_urls"];
            }
            if (mem.contains("resolved_identity") && mem["resolved_identity"].is_object()) {
                doc["resolved_identity"] = mem["resolved_identity"];
            }
            if (mem.contains("known_name") && mem["known_name"].is_string()) {
                doc["known_name"] = mem["known_name"];
            }
        }

        if (state.contains("entities") && state["entities"].is_object() &&
            state["entities"].contains(entityId) && state["entities"][entityId].is_object())
        {
            const json& entityState = state["entities"][entityId];
            if ((!doc.contains("description") || !doc["description"].is_string()) &&
                entityState.contains("description") && entityState["description"].is_string())
            {
                doc["description"] = entityState["description"];
            }
            if ((!doc.contains("description") || !doc["description"].is_string()) &&
                entityState.contains("appearance_summary") && entityState["appearance_summary"].is_string())
            {
                doc["description"] = entityState["appearance_summary"];
            }
            if ((!doc.contains("identity_signature_summary") || !doc["identity_signature_summary"].is_string()) &&
                entityState.contains("identity_signature_summary") && entityState["identity_signature_summary"].is_string())
            {
                doc["identity_signature_summary"] = entityState["identity_signature_summary"];
            }
            if ((!doc.contains("key_traits") || !doc["key_traits"].is_array() || doc["key_traits"].empty()) &&
                entityState.contains("key_traits") && entityState["key_traits"].is_array() && !entityState["key_traits"].empty())
            {
                doc["key_traits"] = entityState["key_traits"];
            }
            if ((!doc.contains("stable_attributes") || !doc["stable_attributes"].is_array() || doc["stable_attributes"].empty()) &&
                entityState.contains("stable_attributes") && entityState["stable_attributes"].is_array() && !entityState["stable_attributes"].empty())
            {
                doc["stable_attributes"] = entityState["stable_attributes"];
            }
            if ((!doc.contains("identity_signature_traits") || !doc["identity_signature_traits"].is_array() || doc["identity_signature_traits"].empty()) &&
                entityState.contains("identity_signature_traits") && entityState["identity_signature_traits"].is_array() && !entityState["identity_signature_traits"].empty())
            {
                doc["identity_signature_traits"] = entityState["identity_signature_traits"];
            }
            if ((!doc.contains("updated_traits") || !doc["updated_traits"].is_array() || doc["updated_traits"].empty()) &&
                entityState.contains("latest_context_traits") && entityState["latest_context_traits"].is_array() && !entityState["latest_context_traits"].empty())
            {
                doc["updated_traits"] = entityState["latest_context_traits"];
            }
            if ((!doc.contains("identity_context_traits") || !doc["identity_context_traits"].is_array() || doc["identity_context_traits"].empty()) &&
                entityState.contains("identity_context_traits") && entityState["identity_context_traits"].is_array() && !entityState["identity_context_traits"].empty())
            {
                doc["identity_context_traits"] = entityState["identity_context_traits"];
            }
            if (entityState.contains("last_seen_ts") && entityState["last_seen_ts"].is_string()) {
                doc["last_seen_ts_utc"] = entityState["last_seen_ts"];
            }
            if (entityState.contains("current_zone") && entityState["current_zone"].is_string()) {
                doc["last_seen_zone"] = entityState["current_zone"];
            }
            if ((!doc.contains("entity_type") || !doc["entity_type"].is_string()) &&
                entityState.contains("entity_type") && entityState["entity_type"].is_string())
            {
                doc["entity_type"] = entityState["entity_type"];
            }
            if (entityState.contains("resolved_identity") && entityState["resolved_identity"].is_object()) {
                doc["resolved_identity"] = entityState["resolved_identity"];
            }
            if (entityState.contains("known_name") && entityState["known_name"].is_string()) {
                doc["known_name"] = entityState["known_name"];
            }
        }

        const std::string inferredEntityType =
            inferCrossCameraEntityType(entityId, nullptr, state, memoryById);
        if (!doc.contains("entity_type") && !inferredEntityType.empty()) {
            doc["entity_type"] = inferredEntityType;
        }
        if (!doc.contains("entity_key") && !inferredEntityType.empty()) {
            doc["entity_key"] = inferredEntityType;
        }
        if (doc.contains("key_traits") && !doc["key_traits"].is_array()) {
            doc["key_traits"] = temporal::parseTraitsValue(doc["key_traits"]);
        }
        if (!doc.contains("key_traits") || !doc["key_traits"].is_array()) {
            doc["key_traits"] = json::array();
        }

        const std::string canonicalFilterType =
            canonicalizeSharedEntityForDoc(entityId, doc, shareEntityTypes);
        if (canonicalFilterType.empty()) return json::object();
        const std::string currentEntityKey =
            temporal::trim(temporal::strField(doc, "entity_key"));
        if (currentEntityKey.empty() ||
            canonicalizeSharedEntityType(currentEntityKey, shareEntityTypes).empty())
        {
            doc["entity_key"] = canonicalFilterType;
        }
        if ((!doc.contains("entity_type") || !doc["entity_type"].is_string() ||
             temporal::trim(doc["entity_type"].get<std::string>()).empty()) &&
            !canonicalFilterType.empty())
        {
            doc["entity_type"] = canonicalFilterType;
        }

        return doc;
    };

    auto collectTriggeredEntityIdsFromStateHistory = [&](const json& state,
                                                         const json& envelope,
                                                         const json& operatorResults,
                                                         const json& cfg) -> json {
        json ids = json::array();
        std::unordered_set<std::string> relevantEvents;
        auto appendEvent = [&](const std::string& rawEvent) {
            const std::string eventName = temporal::lower(
                temporal::trim(temporal::normalizeEventName(rawEvent)));
            if (!eventName.empty()) relevantEvents.insert(eventName);
        };

        const std::string triggerEvent = temporal::strField(cfg, "trigger_event");
        if (!triggerEvent.empty()) appendEvent(triggerEvent);

        if (operatorResults.is_array()) {
            for (const auto& result : operatorResults) {
                if (!result.is_object()) continue;
                const std::string value = temporal::lower(temporal::trim(temporal::strField(result, "value")));
                if (value != "true") continue;
                const std::string typ = temporal::lower(temporal::trim(temporal::strField(result, "type")));
                if (typ == "cross_camera_track_after_trigger") continue;
                appendEvent(temporal::strField(result, "event"));
            }
        }

        if (relevantEvents.empty()) return ids;

        std::unordered_map<std::string, std::string> latestByEntity;
        auto recordEntityTs = [&](const std::string& rawEntityId, const std::string& rawTs) {
            const std::string entityId = temporal::trim(rawEntityId);
            const std::string ts = temporal::trim(rawTs);
            if (entityId.empty() || ts.empty()) return;
            auto it = latestByEntity.find(entityId);
            if (it == latestByEntity.end() || ts > it->second) {
                latestByEntity[entityId] = ts;
            }
        };

        if (state.contains("events") && state["events"].is_array()) {
            for (const auto& ev : state["events"]) {
                if (!ev.is_object()) continue;
                const std::string eventName = temporal::lower(
                    temporal::trim(temporal::normalizeEventName(temporal::strField(ev, "event"))));
                if (relevantEvents.find(eventName) == relevantEvents.end()) continue;
                recordEntityTs(temporal::strField(ev, "entity_id"), temporal::strField(ev, "ts_utc"));
            }
        }

        if (latestByEntity.empty() && envelope.is_object()) {
            std::unordered_set<std::string> candidateVarNames;
            const json plan = temporal::effectivePlan(envelope);
            if (plan.is_object() && plan.contains("runtime_variables") && plan["runtime_variables"].is_array()) {
                for (const auto& rv : plan["runtime_variables"]) {
                    if (!rv.is_object()) continue;
                    const std::string scope = temporal::lower(temporal::trim(temporal::strField(rv, "scope")));
                    const std::string computeKind = temporal::lower(temporal::trim(temporal::strField(rv, "compute_kind")));
                    if (scope != "entity" || computeKind != "last_event_timestamp") continue;
                    const json computeParams = rv.value("compute_params", json::object());
                    const std::string eventName = temporal::lower(
                        temporal::trim(temporal::normalizeEventName(temporal::strField(computeParams, "event"))));
                    if (relevantEvents.find(eventName) == relevantEvents.end()) continue;
                    const std::string name = temporal::trim(temporal::strField(rv, "name"));
                    if (!name.empty()) candidateVarNames.insert(name);
                }
            }

            if (!candidateVarNames.empty() &&
                state.contains("entities") && state["entities"].is_object())
            {
                for (auto it = state["entities"].begin(); it != state["entities"].end(); ++it) {
                    if (!it.value().is_object()) continue;
                    if (!it.value().contains("vars") || !it.value()["vars"].is_object()) continue;
                    const json& vars = it.value()["vars"];
                    for (const auto& varName : candidateVarNames) {
                        if (!vars.contains(varName) || !vars[varName].is_string()) continue;
                        recordEntityTs(it.key(), vars[varName].get<std::string>());
                    }
                }
            }
        }

        if (latestByEntity.empty()) return ids;

        std::string bestTs;
        for (const auto& kv : latestByEntity) {
            if (bestTs.empty() || kv.second > bestTs) bestTs = kv.second;
        }
        if (bestTs.empty()) return ids;

        for (const auto& kv : latestByEntity) {
            if (kv.second == bestTs) ids.push_back(kv.first);
        }
        return ids;
    };

    auto collectRoundEntityDocs = [&](const VideoHit& roundHit, const json& state, const json& shareEntityTypes) -> json {
        const std::unordered_map<std::string, json> memoryById = buildIdentityMemoryIndex(state);

        auto inferEntityType = [&](const std::string& entityId, const json* patchNode) -> std::string {
            return inferCrossCameraEntityType(entityId, patchNode, state, memoryById);
        };

        json docs = json::array();
        std::unordered_set<std::string> seenKeys;
        auto appendDoc = [&](const std::string& entityId, const json* patchNode) {
            json doc = json::object();
            if (!entityId.empty()) doc["entity_id"] = entityId;

            if (patchNode && patchNode->is_object()) {
                const std::string description = temporal::trim(
                    temporal::strField(*patchNode, "description",
                        temporal::strField(*patchNode, "short_description",
                            temporal::strField(*patchNode, "appearance_summary",
                                temporal::strField(*patchNode, "entity_description",
                                    temporal::strField(*patchNode, "person_description"))))));
                if (!description.empty()) doc["description"] = description;
                const std::string identitySignatureSummary =
                    temporal::trim(temporal::strField(*patchNode, "identity_signature_summary"));
                if (!identitySignatureSummary.empty()) doc["identity_signature_summary"] = identitySignatureSummary;
                const std::string entityKey = temporal::trim(temporal::strField(*patchNode, "entity_key"));
                if (!entityKey.empty()) doc["entity_key"] = entityKey;
                const std::string entityType = temporal::trim(temporal::strField(*patchNode, "entity_type"));
                if (!entityType.empty()) doc["entity_type"] = entityType;
                const json traits = temporal::extractTraitsFromNode(*patchNode);
                if (traits.is_array() && !traits.empty()) doc["key_traits"] = traits;
                if (patchNode->contains("stable_attributes")) {
                    const json stableAttributes = temporal::parseTraitsValue((*patchNode)["stable_attributes"]);
                    if (stableAttributes.is_array() && !stableAttributes.empty()) {
                        doc["stable_attributes"] = stableAttributes;
                    }
                }
                if (patchNode->contains("identity_signature_traits")) {
                    const json identitySignatureTraits =
                        temporal::parseTraitsValue((*patchNode)["identity_signature_traits"]);
                    if (identitySignatureTraits.is_array() && !identitySignatureTraits.empty()) {
                        doc["identity_signature_traits"] = identitySignatureTraits;
                    }
                }
                if (patchNode->contains("updated_traits")) {
                    const json updatedTraits = temporal::parseTraitsValue((*patchNode)["updated_traits"]);
                    if (updatedTraits.is_array() && !updatedTraits.empty()) {
                        doc["updated_traits"] = updatedTraits;
                    }
                }
                if (patchNode->contains("identity_context_traits")) {
                    const json identityContextTraits =
                        temporal::parseTraitsValue((*patchNode)["identity_context_traits"]);
                    if (identityContextTraits.is_array() && !identityContextTraits.empty()) {
                        doc["identity_context_traits"] = identityContextTraits;
                    }
                }
                if (patchNode->contains("reference_image_urls") && (*patchNode)["reference_image_urls"].is_array()) {
                    doc["reference_image_urls"] = (*patchNode)["reference_image_urls"];
                }
                if (patchNode->contains("identity_feature_candidates")) {
                    const json identityFeatureCandidates =
                        temporal::extractIdentityFeatureCandidatesFromNode(*patchNode);
                    if (identityFeatureCandidates.is_array() && !identityFeatureCandidates.empty()) {
                        doc["identity_feature_candidates"] = identityFeatureCandidates;
                    }
                }
            }

            if (!entityId.empty()) {
                auto memIt = memoryById.find(entityId);
                if (memIt != memoryById.end()) {
                    const json& mem = memIt->second;
                    if (!doc.contains("description") && mem.contains("description") && mem["description"].is_string()) {
                        doc["description"] = mem["description"];
                    }
                    if (!doc.contains("description") && mem.contains("appearance_summary") && mem["appearance_summary"].is_string()) {
                        doc["description"] = mem["appearance_summary"];
                    }
                    if (!doc.contains("identity_signature_summary") && mem.contains("identity_signature_summary") && mem["identity_signature_summary"].is_string()) {
                        doc["identity_signature_summary"] = mem["identity_signature_summary"];
                    }
                    if ((!doc.contains("key_traits") || !doc["key_traits"].is_array() || doc["key_traits"].empty()) &&
                        mem.contains("key_traits") && mem["key_traits"].is_array() && !mem["key_traits"].empty())
                    {
                        doc["key_traits"] = mem["key_traits"];
                    }
                    if ((!doc.contains("stable_attributes") || !doc["stable_attributes"].is_array() || doc["stable_attributes"].empty()) &&
                        mem.contains("stable_attributes") && mem["stable_attributes"].is_array() && !mem["stable_attributes"].empty())
                    {
                        doc["stable_attributes"] = mem["stable_attributes"];
                    }
                    if ((!doc.contains("identity_signature_traits") || !doc["identity_signature_traits"].is_array() || doc["identity_signature_traits"].empty()) &&
                        mem.contains("identity_signature_traits") && mem["identity_signature_traits"].is_array() && !mem["identity_signature_traits"].empty())
                    {
                        doc["identity_signature_traits"] = mem["identity_signature_traits"];
                    }
                    if ((!doc.contains("updated_traits") || !doc["updated_traits"].is_array() || doc["updated_traits"].empty()) &&
                        mem.contains("latest_context_traits") && mem["latest_context_traits"].is_array() && !mem["latest_context_traits"].empty())
                    {
                        doc["updated_traits"] = mem["latest_context_traits"];
                    }
                    if ((!doc.contains("identity_context_traits") || !doc["identity_context_traits"].is_array() || doc["identity_context_traits"].empty()) &&
                        mem.contains("identity_context_traits") && mem["identity_context_traits"].is_array() && !mem["identity_context_traits"].empty())
                    {
                        doc["identity_context_traits"] = mem["identity_context_traits"];
                    }
                    if (!doc.contains("entity_key") && mem.contains("entity_key") && mem["entity_key"].is_string()) {
                        doc["entity_key"] = mem["entity_key"];
                    }
                    if (!doc.contains("entity_type") && mem.contains("entity_type") && mem["entity_type"].is_string()) {
                        doc["entity_type"] = mem["entity_type"];
                    }
                    if (mem.contains("last_seen_ts_utc") && mem["last_seen_ts_utc"].is_string()) {
                        doc["last_seen_ts_utc"] = mem["last_seen_ts_utc"];
                    }
                    if (mem.contains("last_seen_zone") && mem["last_seen_zone"].is_string()) {
                        doc["last_seen_zone"] = mem["last_seen_zone"];
                    }
                    if (mem.contains("reference_image_urls") && mem["reference_image_urls"].is_array()) {
                        doc["reference_image_urls"] = mem["reference_image_urls"];
                    }
                    if (mem.contains("resolved_identity") && mem["resolved_identity"].is_object()) {
                        doc["resolved_identity"] = mem["resolved_identity"];
                    }
                    if (mem.contains("known_name") && mem["known_name"].is_string()) {
                        doc["known_name"] = mem["known_name"];
                    }
                }
                if (state.contains("entities") && state["entities"].is_object() &&
                    state["entities"].contains(entityId) && state["entities"][entityId].is_object())
                {
                    const json& entityState = state["entities"][entityId];
                    if (!doc.contains("description") && entityState.contains("description") && entityState["description"].is_string()) {
                        doc["description"] = entityState["description"];
                    }
                    if (!doc.contains("description") && entityState.contains("appearance_summary") && entityState["appearance_summary"].is_string()) {
                        doc["description"] = entityState["appearance_summary"];
                    }
                    if (!doc.contains("identity_signature_summary") && entityState.contains("identity_signature_summary") && entityState["identity_signature_summary"].is_string()) {
                        doc["identity_signature_summary"] = entityState["identity_signature_summary"];
                    }
                    if ((!doc.contains("key_traits") || !doc["key_traits"].is_array() || doc["key_traits"].empty()) &&
                        entityState.contains("key_traits") && entityState["key_traits"].is_array() && !entityState["key_traits"].empty())
                    {
                        doc["key_traits"] = entityState["key_traits"];
                    }
                    if ((!doc.contains("stable_attributes") || !doc["stable_attributes"].is_array() || doc["stable_attributes"].empty()) &&
                        entityState.contains("stable_attributes") && entityState["stable_attributes"].is_array() && !entityState["stable_attributes"].empty())
                    {
                        doc["stable_attributes"] = entityState["stable_attributes"];
                    }
                    if ((!doc.contains("identity_signature_traits") || !doc["identity_signature_traits"].is_array() || doc["identity_signature_traits"].empty()) &&
                        entityState.contains("identity_signature_traits") && entityState["identity_signature_traits"].is_array() && !entityState["identity_signature_traits"].empty())
                    {
                        doc["identity_signature_traits"] = entityState["identity_signature_traits"];
                    }
                    if ((!doc.contains("updated_traits") || !doc["updated_traits"].is_array() || doc["updated_traits"].empty()) &&
                        entityState.contains("latest_context_traits") && entityState["latest_context_traits"].is_array() && !entityState["latest_context_traits"].empty())
                    {
                        doc["updated_traits"] = entityState["latest_context_traits"];
                    }
                    if ((!doc.contains("identity_context_traits") || !doc["identity_context_traits"].is_array() || doc["identity_context_traits"].empty()) &&
                        entityState.contains("identity_context_traits") && entityState["identity_context_traits"].is_array() && !entityState["identity_context_traits"].empty())
                    {
                        doc["identity_context_traits"] = entityState["identity_context_traits"];
                    }
                    if (entityState.contains("last_seen_ts") && entityState["last_seen_ts"].is_string()) {
                        doc["last_seen_ts_utc"] = entityState["last_seen_ts"];
                    }
                    if (entityState.contains("current_zone") && entityState["current_zone"].is_string()) {
                        doc["last_seen_zone"] = entityState["current_zone"];
                    }
                    if (entityState.contains("resolved_identity") && entityState["resolved_identity"].is_object()) {
                        doc["resolved_identity"] = entityState["resolved_identity"];
                    }
                    if (entityState.contains("known_name") && entityState["known_name"].is_string()) {
                        doc["known_name"] = entityState["known_name"];
                    }
                }
            }

            const std::string inferredEntityType = inferEntityType(entityId, patchNode);
            if (!doc.contains("entity_type") && !inferredEntityType.empty()) {
                doc["entity_type"] = inferredEntityType;
            }
            if (!doc.contains("entity_key") && !inferredEntityType.empty()) {
                doc["entity_key"] = inferredEntityType;
            }

            const std::string canonicalFilterType =
                canonicalizeSharedEntityForDoc(entityId, doc, shareEntityTypes);
            if (canonicalFilterType.empty()) return;
            const std::string currentEntityKey =
                temporal::trim(temporal::strField(doc, "entity_key"));
            if (currentEntityKey.empty() ||
                canonicalizeSharedEntityType(currentEntityKey, shareEntityTypes).empty())
            {
                doc["entity_key"] = canonicalFilterType;
            }
            if ((!doc.contains("entity_type") || !doc["entity_type"].is_string() ||
                 temporal::trim(doc["entity_type"].get<std::string>()).empty()) &&
                !canonicalFilterType.empty())
            {
                doc["entity_type"] = canonicalFilterType;
            }

            const std::string dedupeFallback = temporal::trim(
                temporal::strField(doc, "description",
                    temporal::strField(doc, "entity_key",
                        temporal::strField(doc, "entity_type"))));
            const std::string dedupeKey = !entityId.empty()
                ? entityId
                : dedupeFallback;
            if (dedupeKey.empty() || !seenKeys.insert(dedupeKey).second) return;
            docs.push_back(std::move(doc));
        };

        if (roundHit.identityPatch.is_array()) {
            for (const auto& patch : roundHit.identityPatch) {
                if (!patch.is_object()) continue;
                const std::string entityId = temporal::trim(temporal::strField(patch, "entity_id"));
                appendDoc(entityId, &patch);
            }
        }
        if (roundHit.observations.is_array()) {
            for (const auto& obs : roundHit.observations) {
                if (!obs.is_object()) continue;
                const std::string entityId = temporal::trim(temporal::strField(obs, "entity_id"));
                if (!entityId.empty()) appendDoc(entityId, nullptr);
            }
        }
        return docs;
    };

    auto normalizeCrossCameraTargetEntity = [&](const json& rawDoc) -> json {
        if (!rawDoc.is_object()) return json::object();
        json doc = rawDoc;
        const std::string entityType = temporal::trim(
            temporal::strField(doc, "entity_type", temporal::strField(doc, "entity_key")));
        const std::string entityKey = temporal::trim(
            temporal::strField(doc, "entity_key", temporal::strField(doc, "entity_type")));
        if (!entityType.empty()) doc["entity_type"] = entityType;
        if (!entityKey.empty()) doc["entity_key"] = entityKey;
        if (doc.contains("key_traits") && !doc["key_traits"].is_array()) {
            doc["key_traits"] = temporal::parseTraitsValue(doc["key_traits"]);
        }
        if (doc.contains("stable_attributes") && !doc["stable_attributes"].is_array()) {
            doc["stable_attributes"] = temporal::parseTraitsValue(doc["stable_attributes"]);
        }
        if (doc.contains("updated_traits") && !doc["updated_traits"].is_array()) {
            doc["updated_traits"] = temporal::parseTraitsValue(doc["updated_traits"]);
        }
        if (doc.contains("identity_signature_traits") && !doc["identity_signature_traits"].is_array()) {
            doc["identity_signature_traits"] = temporal::parseTraitsValue(doc["identity_signature_traits"]);
        }
        if (doc.contains("identity_context_traits") && !doc["identity_context_traits"].is_array()) {
            doc["identity_context_traits"] = temporal::parseTraitsValue(doc["identity_context_traits"]);
        }
        const json identityFeatureCandidates =
            temporal::extractIdentityFeatureCandidatesFromNode(doc);
        const bool hasStructuredIdentityCandidates =
            identityFeatureCandidates.is_array() && !identityFeatureCandidates.empty();
        const json structuredIdentitySignatureTraits =
            temporal::deriveIdentitySignatureTraitsFromFeatureCandidates(identityFeatureCandidates);
        const json structuredIdentityContextTraits =
            temporal::deriveIdentityContextTraitsFromFeatureCandidates(identityFeatureCandidates);
        if (hasStructuredIdentityCandidates) {
            doc["identity_feature_candidates"] = identityFeatureCandidates;
        }
        json stableAttributes = json::array();
        if (hasStructuredIdentityCandidates &&
            structuredIdentitySignatureTraits.is_array() &&
            !structuredIdentitySignatureTraits.empty())
        {
            temporal::appendUniqueTraitsToArray(stableAttributes, structuredIdentitySignatureTraits);
        }
        else if (doc.contains("stable_attributes")) {
            temporal::appendUniqueTraitsToArray(stableAttributes, doc["stable_attributes"]);
        }
        if (stableAttributes.empty() && doc.contains("key_traits")) {
            temporal::appendUniqueTraitsToArray(stableAttributes, doc["key_traits"]);
        }
        doc["stable_attributes"] = stableAttributes;

        json mergedKeyTraits = json::array();
        if (hasStructuredIdentityCandidates &&
            structuredIdentitySignatureTraits.is_array() &&
            !structuredIdentitySignatureTraits.empty())
        {
            temporal::appendUniqueTraitsToArray(mergedKeyTraits, structuredIdentitySignatureTraits);
        }
        else if (!stableAttributes.empty()) {
            temporal::appendUniqueTraitsToArray(mergedKeyTraits, stableAttributes);
        }
        if (!(hasStructuredIdentityCandidates &&
              structuredIdentitySignatureTraits.is_array() &&
              !structuredIdentitySignatureTraits.empty()) &&
            doc.contains("key_traits"))
        {
            temporal::appendUniqueTraitsToArray(mergedKeyTraits, doc["key_traits"]);
        }
        doc["key_traits"] = mergedKeyTraits;

        if (!doc.contains("updated_traits") || !doc["updated_traits"].is_array()) {
            doc["updated_traits"] = json::array();
        }
        const std::string identityTypeHint = !entityType.empty() ? entityType : entityKey;
        json identitySignatureTraits = json::array();
        if (hasStructuredIdentityCandidates &&
            structuredIdentitySignatureTraits.is_array() &&
            !structuredIdentitySignatureTraits.empty())
        {
            temporal::appendUniqueTraitsToArray(identitySignatureTraits, structuredIdentitySignatureTraits);
        }
        else if (doc.contains("identity_signature_traits")) {
            temporal::appendUniqueTraitsToArray(identitySignatureTraits, doc["identity_signature_traits"]);
        }
        doc["identity_signature_traits"] = identitySignatureTraits;

        json identityContextTraits = json::array();
        if (hasStructuredIdentityCandidates &&
            structuredIdentityContextTraits.is_array() &&
            !structuredIdentityContextTraits.empty())
        {
            temporal::appendUniqueTraitsToArray(identityContextTraits, structuredIdentityContextTraits);
        }
        else if (doc.contains("identity_context_traits")) {
            temporal::appendUniqueTraitsToArray(identityContextTraits, doc["identity_context_traits"]);
        }
        doc["identity_context_traits"] = identityContextTraits;

        std::string identitySignatureSummary;
        if (!(hasStructuredIdentityCandidates &&
              identitySignatureTraits.is_array() &&
              !identitySignatureTraits.empty()))
        {
            identitySignatureSummary =
                temporal::trim(temporal::strField(doc, "identity_signature_summary"));
        }
        if (identitySignatureSummary.empty()) {
            identitySignatureSummary =
                temporal::buildIdentitySignatureSummary(identityTypeHint, identitySignatureTraits);
        }
        if (!identitySignatureSummary.empty()) {
            doc["identity_signature_summary"] = identitySignatureSummary;
        }
        return doc;
    };

    auto buildCrossCameraHuntTargetEntity = [&](const json& rawDoc) -> json {
        const json normalized = normalizeCrossCameraTargetEntity(rawDoc);
        if (!normalized.is_object() || normalized.empty()) return json::object();

        json projected = json::object();
        auto copyNonEmptyString = [&](const char* fieldName) {
            const std::string value = temporal::trim(temporal::strField(normalized, fieldName));
            if (!value.empty()) projected[fieldName] = value;
        };

        copyNonEmptyString("entity_id");
        copyNonEmptyString("entity_key");
        copyNonEmptyString("entity_type");
        copyNonEmptyString("known_name");

        json identityTraits = json::array();
        if (normalized.contains("identity_signature_traits")) {
            temporal::appendUniqueTraitsToArray(identityTraits, normalized["identity_signature_traits"]);
        }
        if (identityTraits.size() > 8) {
            identityTraits.erase(identityTraits.begin() + 8, identityTraits.end());
        }
        if (!identityTraits.empty()) {
            projected["identity_signature_traits"] = identityTraits;
        }

        std::string identitySignatureSummary =
            temporal::trim(temporal::strField(normalized, "identity_signature_summary"));
        if (identitySignatureSummary.empty() && !identityTraits.empty()) {
            identitySignatureSummary = temporal::buildIdentitySignatureSummary(
                temporal::trim(temporal::strField(
                    normalized, "entity_type", temporal::strField(normalized, "entity_key"))),
                identityTraits);
        }
        if (!identitySignatureSummary.empty()) {
            projected["identity_signature_summary"] = identitySignatureSummary;
        }

        if (normalized.contains("reference_image_urls") && normalized["reference_image_urls"].is_array() &&
            !normalized["reference_image_urls"].empty())
        {
            projected["reference_image_urls"] = normalized["reference_image_urls"];
        }
        if (normalized.contains("resolved_identity") && normalized["resolved_identity"].is_object() &&
            !normalized["resolved_identity"].empty())
        {
            projected["resolved_identity"] = normalized["resolved_identity"];
        }
        const bool hasIdentityEvidence =
            (!identityTraits.empty()) ||
            !identitySignatureSummary.empty() ||
            (projected.contains("reference_image_urls") && projected["reference_image_urls"].is_array() &&
             !projected["reference_image_urls"].empty()) ||
            (projected.contains("resolved_identity") && projected["resolved_identity"].is_object() &&
             !projected["resolved_identity"].empty()) ||
            (projected.contains("known_name") && projected["known_name"].is_string() &&
             !temporal::trim(projected["known_name"].get<std::string>()).empty());
        if (!hasIdentityEvidence) {
            return json::object();
        }
        return projected;
    };

    auto buildCrossCameraSearchPrompt = [&](const json& targetEntity) -> std::string {
        const json normalized = normalizeCrossCameraTargetEntity(targetEntity);
        const std::string entityType = temporal::trim(
            temporal::strField(normalized, "entity_type", temporal::strField(normalized, "entity_key", "object")));
        const std::string knownName = temporal::trim(temporal::strField(normalized, "known_name"));
        std::ostringstream prompt;
        auto appendTraitSentence = [&](const char* fieldName, const char* label, std::size_t maxItems) {
            if (!normalized.contains(fieldName) || !normalized[fieldName].is_array() || normalized[fieldName].empty()) {
                return;
            }
            std::ostringstream clause;
            bool firstTrait = true;
            std::size_t emittedTraits = 0;
            for (const auto& trait : normalized[fieldName]) {
                if (!trait.is_string()) continue;
                const std::string value = temporal::trim(trait.get<std::string>());
                if (value.empty()) continue;
                if (!firstTrait) clause << "; ";
                clause << value;
                firstTrait = false;
                ++emittedTraits;
                if (emittedTraits >= maxItems) break;
            }
            if (emittedTraits == 0) return;
            prompt << " " << label << ": " << clause.str() << ".";
        };
        const bool hasIdentitySignatureTraits =
            normalized.contains("identity_signature_traits") &&
            normalized["identity_signature_traits"].is_array() &&
            !normalized["identity_signature_traits"].empty();
        prompt << "Look for the same " << (entityType.empty() ? "object" : entityType)
               << " from another camera in this job step.";
        prompt << " Treat this shared hunt as a priority task for the receiving camera even if its local task text is unrelated.";
        prompt << " Use only target-centric identity cues such as physical traits, clothing, accessories, carried objects, markings, and vehicle details.";
        prompt << " Ignore room layout, furniture, doors, walls, lighting, activity, pose, and surrounding background.";
        if (!knownName.empty()) {
            prompt << " Known identity hint: " << knownName << ".";
        }
        if (hasIdentitySignatureTraits) {
            appendTraitSentence("identity_signature_traits", "Identity signature traits", 8);
        }
        if (normalized.contains("resolved_identity") && normalized["resolved_identity"].is_object()) {
            prompt << " Resolved identity metadata is available and should be treated as strong supporting evidence when the appearance is compatible.";
        }
        if (normalized.contains("reference_image_urls") && normalized["reference_image_urls"].is_array() &&
            !normalized["reference_image_urls"].empty())
        {
            prompt << " Reference image metadata is available for this target.";
        }
        prompt << " If this batch strongly matches the shared target despite normal cross-camera changes in angle, lighting, scale, or background, emit a positive watchlist match update for this hunt using the watchlist field from the active response schema, even if the local alert_condition would otherwise stay false or the receiving camera has a different local task.";
        return prompt.str();
    };

    auto normalizeCrossCameraHunt = [&](const json& rawHunt) -> json {
        if (!rawHunt.is_object()) return json::object();
        json hunt = rawHunt;
        json targetEntity = json::object();
        if (hunt.contains("target_entity") && hunt["target_entity"].is_object()) {
            targetEntity = buildCrossCameraHuntTargetEntity(hunt["target_entity"]);
        }
        else if (hunt.contains("entities") && hunt["entities"].is_array()) {
            for (const auto& entityDoc : hunt["entities"]) {
                if (!entityDoc.is_object()) continue;
                targetEntity = buildCrossCameraHuntTargetEntity(entityDoc);
                if (!targetEntity.empty()) break;
            }
        }
        if (!targetEntity.empty()) {
            hunt["target_entity"] = targetEntity;
            hunt["entities"] = json::array({ targetEntity });
            if (!hunt.contains("source_entity_id") || !hunt["source_entity_id"].is_string() ||
                temporal::trim(hunt["source_entity_id"].get<std::string>()).empty())
            {
                const std::string sourceEntityId = temporal::trim(temporal::strField(targetEntity, "entity_id"));
                if (!sourceEntityId.empty()) hunt["source_entity_id"] = sourceEntityId;
            }
            if (!hunt.contains("source_entity_key") || !hunt["source_entity_key"].is_string() ||
                temporal::trim(hunt["source_entity_key"].get<std::string>()).empty())
            {
                const std::string sourceEntityKey = temporal::trim(temporal::strField(targetEntity, "entity_key"));
                if (!sourceEntityKey.empty()) hunt["source_entity_key"] = sourceEntityKey;
            }
            if (!hunt.contains("source_entity_type") || !hunt["source_entity_type"].is_string() ||
                temporal::trim(hunt["source_entity_type"].get<std::string>()).empty())
            {
                const std::string sourceEntityType = temporal::trim(temporal::strField(targetEntity, "entity_type"));
                if (!sourceEntityType.empty()) hunt["source_entity_type"] = sourceEntityType;
            }
            hunt["search_prompt"] = buildCrossCameraSearchPrompt(targetEntity);
        }
        return hunt;
    };

    auto selectCrossCameraPublishTarget = [&](const VideoHit& roundHit,
                                              const json& state,
                                              const json& shareEntityTypes,
                                              const json& operatorResults,
                                              const json& cfg) -> json {
        json selection = {
            { "candidate_count", 0 },
            { "selection_reason", "no_candidates" }
        };
        const json docs = collectRoundEntityDocs(roundHit, state, shareEntityTypes);
        selection["candidate_count"] = docs.is_array() ? static_cast<int>(docs.size()) : 0;

        std::unordered_map<std::string, json> docsById;
        for (const auto& doc : docs) {
            if (!doc.is_object()) continue;
            const std::string entityId = temporal::trim(temporal::strField(doc, "entity_id"));
            if (!entityId.empty()) docsById[entityId] = doc;
        }

        auto finalizeSelection = [&](const json& doc, const std::string& reason) -> json {
            selection["selection_reason"] = reason;
            selection["target_entity"] = normalizeCrossCameraTargetEntity(doc);
            return selection;
        };

        auto selectByEntityIds = [&](const json& ids, const std::string& reason) -> bool {
            if (!ids.is_array() || ids.empty()) return false;
            json matches = json::array();
            std::unordered_set<std::string> seen;
            for (const auto& idNode : ids) {
                if (!idNode.is_string()) continue;
                const std::string entityId = temporal::trim(idNode.get<std::string>());
                if (entityId.empty() || !seen.insert(entityId).second) continue;
                auto it = docsById.find(entityId);
                if (it != docsById.end()) {
                    matches.push_back(it->second);
                    continue;
                }
                const json stateBackedDoc = buildCrossCameraStateBackedDoc(entityId, state, shareEntityTypes);
                if (stateBackedDoc.is_object() && !stateBackedDoc.empty()) {
                    docsById[entityId] = stateBackedDoc;
                    matches.push_back(stateBackedDoc);
                }
            }
            if (matches.size() == 1) {
                selection = finalizeSelection(matches[0], reason);
                return true;
            }
            selection["selection_reason"] = matches.empty()
                ? "no_visible_target_for_" + reason
                : "ambiguous_" + reason;
            if (!matches.empty()) {
                selection["matched_candidate_count"] = static_cast<int>(matches.size());
            }
            return !matches.empty();
        };

        const json triggeredEntityIds =
            temporal::collectTriggeredEntityIdsForCrossCameraPublish(operatorResults);
        if (selectByEntityIds(triggeredEntityIds, "triggered_operator_entity")) {
            return selection;
        }
        if (selection.contains("selection_reason") && selection["selection_reason"].is_string()) {
            const std::string reason = selection["selection_reason"].get<std::string>();
            if (reason.rfind("ambiguous_", 0) == 0) return selection;
        }

        const json stateTriggeredEntityIds =
            collectTriggeredEntityIdsFromStateHistory(state, preparedTemporalSlot.planEnvelope, operatorResults, cfg);
        if (selectByEntityIds(stateTriggeredEntityIds, "triggered_state_event_entity")) {
            return selection;
        }
        if (selection.contains("selection_reason") && selection["selection_reason"].is_string()) {
            const std::string reason = selection["selection_reason"].get<std::string>();
            if (reason.rfind("ambiguous_", 0) == 0) return selection;
        }

        const std::string triggerMode =
            temporal::lower(temporal::trim(temporal::strField(cfg, "trigger_mode", "alert_condition_true")));
        if (triggerMode == "event_observed") {
            const json observedEntityIds =
                collectRoundEntityIdsForEvent(roundHit, temporal::strField(cfg, "trigger_event"));
            if (selectByEntityIds(observedEntityIds, "observed_trigger_event_entity")) {
                return selection;
            }
            if (selection.contains("selection_reason") && selection["selection_reason"].is_string()) {
                const std::string reason = selection["selection_reason"].get<std::string>();
                if (reason.rfind("ambiguous_", 0) == 0) return selection;
            }
        }

        if (docs.size() == 1 && docs[0].is_object()) {
            return finalizeSelection(docs[0], "single_visible_candidate");
        }

        selection["selection_reason"] = docs.empty()
            ? "no_candidates"
            : "ambiguous_visible_candidates";
        return selection;
    };

    auto loadActiveCrossCameraWatchlist = [&](const std::string& nowIsoUtc) -> json {
        std::lock_guard<std::mutex> lock(crossCameraHuntsMu_);
        auto it = crossCameraHuntsByStep_.find(crossCameraStepKey);
        if (it == crossCameraHuntsByStep_.end()) return json::array();
        cleanupExpiredCrossCameraHunts(it->second, nowIsoUtc);
        json active = json::array();
        for (const auto& hunt : it->second) {
            if (!hunt.is_object()) continue;
            if (temporal::intField(hunt, "source_camera_id", -1) == cameraId) continue;
            const json normalizedHunt = normalizeCrossCameraHunt(hunt);
            if (!normalizedHunt.is_object() || normalizedHunt.empty()) continue;
            active.push_back(normalizedHunt);
        }
        return active;
    };

    auto maybePublishCrossCameraHunts = [&](TemporalRuntimeSlot& slot,
                                            const VideoHit& roundHit,
                                            const json& operatorResults,
                                            bool publishAlertSignal,
                                            const std::string& nowIsoUtc) -> json {
        json published = json::array();
        if (!crossCameraPublishEnabled) return published;
        if (!slot.state.is_object()) slot.state = temporal::defaultState();
        if (!slot.state.contains("meta") || !slot.state["meta"].is_object()) {
            slot.state["meta"] = json::object();
        }
        if (!slot.state["meta"].contains("cross_camera_publish") || !slot.state["meta"]["cross_camera_publish"].is_object()) {
            slot.state["meta"]["cross_camera_publish"] = json::object();
        }

        for (const auto& cfg : crossCameraOperatorConfigs) {
            if (!cfg.is_object()) continue;
            const std::string triggerMode =
                temporal::lower(temporal::trim(temporal::strField(cfg, "trigger_mode", "alert_condition_true")));
            bool triggered = false;
            if (triggerMode == "event_observed") {
                triggered = roundContainsEvent(roundHit, temporal::strField(cfg, "trigger_event"));
            }
            else {
                triggered = publishAlertSignal;
            }
            if (!triggered) continue;

            const int ttlSeconds = std::max(60, temporal::intField(cfg, "watch_ttl_seconds", 900));
            const std::string operatorId = temporal::trim(temporal::strField(cfg, "operator_id", "cross_camera_track_after_trigger"));
            const int publishCooldownSeconds = std::min(60, std::max(15, ttlSeconds / 4));
            std::string lastPublishTs;
            const json& publishState = slot.state["meta"]["cross_camera_publish"];
            if (publishState.is_object() &&
                publishState.contains(operatorId) &&
                publishState[operatorId].is_string())
            {
                lastPublishTs = temporal::trim(publishState[operatorId].get<std::string>());
            }
            if (!lastPublishTs.empty() &&
                temporal::ageSeconds(lastPublishTs, nowIsoUtc) >= 0 &&
                temporal::ageSeconds(lastPublishTs, nowIsoUtc) < publishCooldownSeconds)
            {
                continue;
            }

            const json publishSelection = selectCrossCameraPublishTarget(
                roundHit,
                slot.state,
                cfg.value("share_entity_types", json::array()),
                operatorResults,
                cfg
            );
            if (!publishSelection.is_object() ||
                !publishSelection.contains("target_entity") ||
                !publishSelection["target_entity"].is_object() ||
                publishSelection["target_entity"].empty())
            {
                Logger::instance().logDebug(
                    "job",
                    "runAgentInferenceOnCamera_: skipped cross-camera hunt publish job_id=" +
                    std::to_string(jobId) + " step_id=" + std::to_string(stepId) +
                    " camera_id=" + std::to_string(cameraId) +
                    " operator_id=" + operatorId +
                    " reason=" + temporal::strField(publishSelection, "selection_reason", "no_target")
                );
                continue;
            }

            const json normalizedTargetEntity = normalizeCrossCameraTargetEntity(publishSelection["target_entity"]);
            const json targetEntity = buildCrossCameraHuntTargetEntity(normalizedTargetEntity);
            if (!targetEntity.is_object() || targetEntity.empty()) {
                Logger::instance().logDebug(
                    "job",
                    "runAgentInferenceOnCamera_: skipped cross-camera hunt publish job_id=" +
                    std::to_string(jobId) + " step_id=" + std::to_string(stepId) +
                    " camera_id=" + std::to_string(cameraId) +
                    " operator_id=" + operatorId +
                    " reason=identity_only_projection_empty"
                );
                continue;
            }
            const std::string searchPrompt = buildCrossCameraSearchPrompt(targetEntity);
            const std::string targetEntityId = temporal::trim(temporal::strField(targetEntity, "entity_id"));

            const auto huntTick = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count();
            json hunt = {
                { "hunt_id", "hunt_" + std::to_string(jobId) + "_" + std::to_string(stepId) + "_" +
                    std::to_string(cameraId) + "_" + std::to_string(huntTick) },
                { "source_camera_id", cameraId },
                { "source_agent_id", agent.id },
                { "source_agent_key", agent.agent_key },
                { "created_at_utc", nowIsoUtc },
                { "watch_ttl_seconds", ttlSeconds },
                { "operator_id", operatorId },
                { "trigger_mode", triggerMode },
                { "alert_on_match", cfg.value("alert_on_match", json(true)) },
                { "source_entity_id", targetEntityId },
                { "source_entity_key", temporal::strField(targetEntity, "entity_key") },
                { "source_entity_type", temporal::strField(targetEntity, "entity_type") },
                { "target_entity", targetEntity },
                { "entities", json::array({ targetEntity }) },
                { "search_prompt", searchPrompt }
            };
            if (cfg.contains("trigger_event") && cfg["trigger_event"].is_string()) {
                hunt["trigger_event"] = cfg["trigger_event"];
            }

            {
                std::lock_guard<std::mutex> lock(crossCameraHuntsMu_);
                json& hunts = crossCameraHuntsByStep_[crossCameraStepKey];
                cleanupExpiredCrossCameraHunts(hunts, nowIsoUtc);
                hunts.push_back(hunt);
                if (hunts.size() > 64) {
                    hunts.erase(hunts.begin(), hunts.begin() + (hunts.size() - 64));
                }
            }

            slot.state["meta"]["cross_camera_publish"][operatorId] = nowIsoUtc;
            published.push_back(normalizeCrossCameraHunt(hunt));
            Logger::instance().logDebug(
                "job",
                "runAgentInferenceOnCamera_: prepared cross-camera hunt target job_id=" +
                std::to_string(jobId) + " step_id=" + std::to_string(stepId) +
                " camera_id=" + std::to_string(cameraId) +
                " operator_id=" + operatorId +
                " selection_reason=" +
                temporal::strField(publishSelection, "selection_reason", "selected") +
                " target_entity_id=" + (targetEntityId.empty() ? std::string("<empty>") : targetEntityId)
            );
        }
        return published;
    };

    auto buildCrossCameraMatchResults = [&](const VideoHit& roundHit, const json& activeWatchlist) -> json {
        json accepted = json::array();
        if (!activeWatchlist.is_array() || activeWatchlist.empty()) {
            return accepted;
        }
        std::unordered_map<std::string, json> watchlistByHuntId;
        for (const auto& hunt : activeWatchlist) {
            if (!hunt.is_object()) continue;
            const json normalizedHunt = normalizeCrossCameraHunt(hunt);
            const std::string huntId = temporal::trim(temporal::strField(normalizedHunt, "hunt_id"));
            if (!huntId.empty()) watchlistByHuntId[huntId] = normalizedHunt;
        }
        if (!roundHit.crossCameraWatchlistMatches.is_array()) return accepted;
        std::unordered_set<std::string> seen;
        for (const auto& item : roundHit.crossCameraWatchlistMatches) {
            if (!item.is_object()) continue;
            const std::string huntId = temporal::trim(temporal::strField(item, "hunt_id"));
            if (huntId.empty()) continue;
            auto huntIt = watchlistByHuntId.find(huntId);
            if (huntIt == watchlistByHuntId.end()) continue;
            const std::string matchedEntityId = temporal::trim(temporal::strField(item, "matched_entity_id"));
            const std::string dedupeKey = huntId + "|" + matchedEntityId;
            if (!seen.insert(dedupeKey).second) continue;
            json match = item;
            match["source_camera_id"] = temporal::intField(huntIt->second, "source_camera_id", -1);
            match["operator_id"] = temporal::strField(huntIt->second, "operator_id");
            match["alert_on_match"] = huntIt->second.value("alert_on_match", json(true));
            match["matched_camera_id"] = cameraId;
            const int sourceAgentId = temporal::intField(huntIt->second, "source_agent_id", -1);
            if (sourceAgentId >= 0) {
                match["source_agent_id"] = sourceAgentId;
            }
            const std::string sourceAgentKey =
                temporal::trim(temporal::strField(huntIt->second, "source_agent_key"));
            if (!sourceAgentKey.empty()) {
                match["source_agent_key"] = sourceAgentKey;
            }
            if (!matchedEntityId.empty()) {
                match["matched_local_entity_id"] = matchedEntityId;
            }
            const std::string sourceEntityId =
                temporal::trim(temporal::strField(huntIt->second, "source_entity_id"));
            if (!sourceEntityId.empty()) {
                match["source_entity_id"] = sourceEntityId;
            }
            const std::string sourceEntityKey =
                temporal::trim(temporal::strField(huntIt->second, "source_entity_key"));
            if (!sourceEntityKey.empty()) {
                match["source_entity_key"] = sourceEntityKey;
            }
            const std::string sourceEntityType =
                temporal::trim(temporal::strField(huntIt->second, "source_entity_type"));
            if (!sourceEntityType.empty()) {
                match["source_entity_type"] = sourceEntityType;
            }
            if (huntIt->second.contains("target_entity") && huntIt->second["target_entity"].is_object()) {
                match["target_entity"] = huntIt->second["target_entity"];
            }
            if (huntIt->second.contains("search_prompt") && huntIt->second["search_prompt"].is_string()) {
                match["search_prompt"] = huntIt->second["search_prompt"];
            }
            if (huntIt->second.contains("entities") && huntIt->second["entities"].is_array()) {
                match["watch_entities"] = huntIt->second["entities"];
            }
            accepted.push_back(std::move(match));
        }
        return accepted;
    };

    auto buildCrossCameraRuntimeInput = [&](const std::string& nowIsoUtc,
                                            const std::string& segmentStartUtc,
                                            const std::string& segmentEndUtc) -> json {
        json runtime = {
            { "identity_memory", json::array() },
            { "state_slice", json::object() },
            { "expected_output_schema", {
                { "identity_patch", json::array() },
                { "observations", json::array() },
                { "unknown_reasons", json::array() },
                { "watchlist_updates", json::array() }
            } },
            { "time_context", {
                { "now_utc", nowIsoUtc }
            } }
        };
        if (!segmentStartUtc.empty()) {
            runtime["time_context"]["segment_start_utc"] = segmentStartUtc;
        }
        if (!segmentEndUtc.empty()) {
            runtime["time_context"]["segment_end_utc"] = segmentEndUtc;
        }
        return runtime;
    };

    // -------------------------------
    // IMAGE MODE (clip-backed: 1 frame from each NEW 10s clip)
    // -------------------------------
    if (isImage) {
        if (useCore) {
            Logger::instance().logDebug(
                "job",
                "runAgentInferenceOnCamera_: core model requires video input, skipping image inference"
            );
            return "";
        }
        if (!owner_) return "";

        const std::vector<JobAnalysisRegion> activeRegions =
            collectEnabledAnalysisRegionsForAgent_(agent);
        const JobFrameWindowNorm frameWindow =
            resolveFrameWindowFromRegions_(activeRegions);
        const bool hasFrameWindow = isFrameWindowActive_(frameWindow);

        std::string clipPath;
        bool clipBackedSource = false;
        ClipBoundaryFrames_ clipBoundaryFrames;
        std::string selectedImageKey;

        std::string jpegB64;
        std::string tsUtcIso;

        auto imageOpt = getNewestJobsImageForCamera(jobId, stepId, std::to_string(cameraId));
        if (imageOpt) {
            fs::path imagePath = fs::path(*imageOpt);
            const std::string imageKey = makeMonotonicImageKey_(imagePath);
            if (isNewerClipForJobStepCamera_(jobId, stepId, cameraId, imageKey)) {
                std::string imageErr;
                if (encodeImageFileAsJpegDataUrl_(imagePath, jpegB64, &imageErr) && !jpegB64.empty()) {
                    selectedImageKey = imageKey;
                    if (outMediaInfo) {
                        outMediaInfo->hadInput = true;
                        outMediaInfo->consumptionKey = imageKey;
                    }
                }
                else {
                    Logger::instance().logDebug(
                        "job",
                        "runAgentInferenceOnCamera_: image mode failed reading snapshot cameraId=" +
                        std::to_string(cameraId) + " path=" + imagePath.string() + " err=" + imageErr
                    );
                }
            }
        }

        if (jpegB64.empty()) {
            // Clip-backed fallback for backward compatibility.
            auto clipOpt = getNextReadyJobsClipForCamera_(jobId, stepId, cameraId);
            if (!clipOpt) return "";
            clipPath = *clipOpt;
            const std::string clipKey = makeMonotonicClipKey_(fs::path(clipPath));
            if (!isNewerClipForJobStepCamera_(jobId, stepId, cameraId, clipKey)) {
                return "";
            }
            clipBackedSource = true;
            if (outMediaInfo) {
                outMediaInfo->hadInput = true;
                outMediaInfo->consumptionKey = clipKey;
            }

            std::string extractErr;
            if (!extractClipBoundaryFramesFromMp4_(fs::path(clipPath), clipBoundaryFrames, &extractErr) ||
                !encodeMatAsJpegDataUrl_(clipBoundaryFrames.lastFrame, jpegB64, &extractErr) ||
                jpegB64.empty())
            {
                Logger::instance().logDebug(
                    "job",
                    "runAgentInferenceOnCamera_: image mode failed extracting frame cameraId=" +
                    std::to_string(cameraId) + " clip=" + clipPath + " err=" + extractErr
                );
                return "";
            }
            parseClipEndTsUtcIsoFromPath_(fs::path(clipPath), tsUtcIso);
            if (outMediaInfo) {
                outMediaInfo->latestCapturedEndUtc = tsUtcIso;
                outMediaInfo->processedSegmentEndUtc = tsUtcIso;
            }
        }

        if (hasFrameWindow) {
            std::string cropErr;
            if (clipBackedSource) {
                cv::Mat croppedFirstFrame;
                cv::Mat croppedLastFrame;
                if (!cropMatByFrameWindow_(clipBoundaryFrames.firstFrame, frameWindow, croppedFirstFrame, &cropErr) ||
                    !cropMatByFrameWindow_(clipBoundaryFrames.lastFrame, frameWindow, croppedLastFrame, &cropErr) ||
                    !encodeMatAsJpegDataUrl_(croppedLastFrame, jpegB64, &cropErr) ||
                    jpegB64.empty())
                {
                    Logger::instance().logDebug(
                        "job",
                        "runAgentInferenceOnCamera_: frame-window crop failed for image inference cameraId=" +
                        std::to_string(cameraId) + " err=" + cropErr
                    );
                    return "";
                }
                clipBoundaryFrames.firstFrame = std::move(croppedFirstFrame);
                clipBoundaryFrames.lastFrame = std::move(croppedLastFrame);
            }
            else {
                std::string croppedJpegB64;
                if (!cropJpegDataUrlByFrameWindow_(jpegB64, frameWindow, croppedJpegB64, &cropErr) ||
                    croppedJpegB64.empty())
                {
                    Logger::instance().logDebug(
                        "job",
                        "runAgentInferenceOnCamera_: frame-window crop failed for image inference cameraId=" +
                        std::to_string(cameraId) + " err=" + cropErr
                    );
                    return "";
                }
                jpegB64 = croppedJpegB64;
            }
        }

        json regionResults = json::array();
        int sumPromptTokens = 0;
        int sumOutputTokens = 0;
        int sumTotalTokens = 0;
        int sumValidatorPromptTokens = 0;
        int sumValidatorOutputTokens = 0;
        int sumValidatorTotalTokens = 0;
        bool validatorExecutedAny = false;
        bool validatorAlertAny = false;
        bool firstPassAlertAny = false;
        bool finalAlertAny = false;
        bool faceIdMatchAny = false;
        int startConditionStepId = -1;
        std::vector<std::string> mergedFaceNames;
        std::string representativeAnswer;
        std::string representativeImageB64;
        std::string representativeRegionId;

        const std::vector<JobAnalysisRegion> runtimeActiveRegions =
            remapRegionsToFrameWindow_(activeRegions, frameWindow);
        const std::vector<JobAnalysisRegion> polygonRegions =
            collectPolygonOnlyRegions_(runtimeActiveRegions);
        const std::vector<JobAnalysisRegion>& allowedAlertRegions =
            polygonRegions.empty() ? runtimeActiveRegions : polygonRegions;
        const std::unordered_map<std::string, std::string> allowedAlertRegionLabelById =
            buildRegionLabelByIdMap_(allowedAlertRegions);
        std::vector<std::string> motionTriggeredRegionIds;
        const bool enforceMotionGate = agent.only_capture_on_motion;
        const bool enforceMotionWithoutPolygon =
            enforceMotionGate && polygonRegions.empty();
        std::vector<JobAnalysisRegion> motionRegions;
        if (enforceMotionGate) {
            motionRegions = polygonRegions;
            if (enforceMotionWithoutPolygon) {
                motionRegions.push_back(buildSyntheticFullFrameMotionRegion_());
            }
        }

        if (!motionRegions.empty()) {
            std::string motionErr;
            bool motionDetected = false;
            if (clipBackedSource) {
                if (!detectMotionInAnyRegionFromBoundaryFrames_(
                        clipBoundaryFrames,
                        motionRegions,
                        motionDetected,
                        &motionTriggeredRegionIds,
                        &motionErr))
                {
                    Logger::instance().logDebug(
                        "job",
                        "runAgentInferenceOnCamera_: ROI/full-frame motion check failed, skipping image inference cameraId=" +
                        std::to_string(cameraId) + " err=" + motionErr +
                        " region_count=" + std::to_string(motionRegions.size())
                    );
                    return "";
                }
            }
            else {
                cv::Mat stillFrame;
                if (!decodeJpegDataUrlToMat_(jpegB64, stillFrame, &motionErr) || stillFrame.empty()) {
                    Logger::instance().logDebug(
                        "job",
                        "runAgentInferenceOnCamera_: ROI still-motion decode failed, skipping image inference cameraId=" +
                        std::to_string(cameraId) + " err=" + motionErr
                    );
                    return "";
                }

                const std::string motionSlot =
                    "single|" + std::to_string(jobId) +
                    "|" + std::to_string(stepId) +
                    "|" + std::to_string(cameraId) +
                    "|" + agent.agent_key;

                if (!detectMotionInAnyRegionFromStillHistory_(
                        motionSlot,
                        stillFrame,
                        motionRegions,
                        motionDetected,
                        &motionTriggeredRegionIds,
                        &motionErr))
                {
                    Logger::instance().logDebug(
                        "job",
                        "runAgentInferenceOnCamera_: ROI/full-frame still-motion check failed, skipping image inference cameraId=" +
                        std::to_string(cameraId) + " err=" + motionErr +
                        " region_count=" + std::to_string(motionRegions.size())
                    );
                    return "";
                }
            }

            if (!motionDetected) {
                Logger::instance().logDebug(
                    "job",
                    "runAgentInferenceOnCamera_: skipped image inference due no ROI/full-frame motion cameraId=" +
                    std::to_string(cameraId) + " region_count=" + std::to_string(motionRegions.size())
                );
                return "";
            }

            // Full-frame motion gate is internal and should not leak as alert_region_id.
            if (enforceMotionWithoutPolygon) {
                motionTriggeredRegionIds.clear();
            }
        }

        std::string annotatedJpegB64 = jpegB64;
        std::vector<std::string> drawnRegionIds;
        if (!polygonRegions.empty()) {
            std::string overlayErr;
            if (!annotateJpegDataUrlWithRegions_(
                    jpegB64,
                    polygonRegions,
                    annotatedJpegB64,
                    &drawnRegionIds,
                    &overlayErr) ||
                annotatedJpegB64.empty())
            {
                Logger::instance().logDebug(
                    "job",
                    "runAgentInferenceOnCamera_: ROI overlay failed, fallback full-frame cameraId=" +
                    std::to_string(cameraId) + " err=" + overlayErr
                );
                annotatedJpegB64 = jpegB64;
                drawnRegionIds.clear();
            }
        }

        const std::string nowIsoForInference = temporal::nowIso();
        const std::string inferencePromptBase = buildInferencePrompt_(
            agent.prompt_template,
            alertConditionText,
            agent.negative_condition_text,
            injectedInput,
            agent.face_targets,
            agent.negative_reference_images
        );
        std::string inferencePrompt = inferencePromptBase;
        bool temporalPlanActive = false;
        bool temporalReport = false;
        nlohmann::json temporalOperatorResults = nlohmann::json::array();
        TemporalRuntimeSlot temporalSlot = preparedTemporalSlot;
        const json activeCrossCameraWatchlist = loadActiveCrossCameraWatchlist(nowIsoForInference);
        const json promptCrossCameraWatchlist =
            temporal::sanitizePromptIdentityPayload(activeCrossCameraWatchlist);
        if (temporalPlanPrepared && temporal::planUsable(temporalSlot.planEnvelope)) {
            attachTemporalZoneCatalog_(temporalSlot.planEnvelope, activeRegions);
            nlohmann::json temporalInput = temporal::buildInferenceInput(
                temporalSlot.planEnvelope,
                temporalSlot.state,
                cameraId,
                nowIsoForInference
            );
            if (promptCrossCameraWatchlist.is_array() && !promptCrossCameraWatchlist.empty()) {
                temporalInput["cross_camera_watchlist"] = promptCrossCameraWatchlist;
                if (!temporalInput.contains("expected_output_schema") || !temporalInput["expected_output_schema"].is_object()) {
                    temporalInput["expected_output_schema"] = json::object();
                }
                temporalInput["expected_output_schema"]["watchlist_updates"] = json::array();
            }
            Logger::instance().logDebug(
                "job",
                "runAgentInferenceOnCamera_: temporal input injected (image) job_id=" +
                std::to_string(jobId) + " step_id=" + std::to_string(stepId) +
                " camera_id=" + std::to_string(cameraId) +
                " now_utc=" +
                temporalInput.value("time_context", nlohmann::json::object()).value("now_utc", "") +
                " payload=" + temporalInput.dump()
            );
            inferencePrompt += temporal::runtimePromptAppendix(temporalInput);
            temporalPlanActive = true;
        }
        else if (promptCrossCameraWatchlist.is_array() && !promptCrossCameraWatchlist.empty()) {
            nlohmann::json temporalInput = buildCrossCameraRuntimeInput(nowIsoForInference, std::string(), std::string());
            temporalInput["cross_camera_watchlist"] = promptCrossCameraWatchlist;
            Logger::instance().logDebug(
                "job",
                "runAgentInferenceOnCamera_: cross-camera watchlist injected without local temporal plan (image) job_id=" +
                std::to_string(jobId) + " step_id=" + std::to_string(stepId) +
                " camera_id=" + std::to_string(cameraId) +
                " now_utc=" +
                temporalInput.value("time_context", nlohmann::json::object()).value("now_utc", "") +
                " payload=" + temporalInput.dump()
            );
            inferencePrompt += temporal::runtimePromptAppendix(temporalInput);
        }

        int promptTokens = 0;
        int outputTokens = 0;
        int totalTokens = 0;
        VideoHit hit;
        if (useOpenAICompatible) {
            if (modelApiKey.empty()) return "";
            hit = owner_->callOpenAIVisionImageJOB_(
                cameraId,
                annotatedJpegB64,
                inferencePrompt,
                faceReferences,
                negativeReferences,
                /*alertConditionText*/ alertConditionText,
                /*startConditionText*/ startConditionText,
                /*openAiModelName*/ openAiModelName,
                /*openAiApiKey*/ modelApiKey,
                tsUtcIso,
                promptTokens,
                outputTokens,
                totalTokens,
                timeoutSeconds
            );
        }
        else {
            hit = owner_->callGeminiVisionImageJOB_(
                cameraId,
                annotatedJpegB64,
                inferencePrompt,
                /*uploadedImageBase64*/ "",
                faceReferences,
                negativeReferences,
                /*alertConditionText*/ alertConditionText,
                /*startConditionText*/ startConditionText,
                modelTier,
                /*geminiApiKey*/ modelApiKey,
                tsUtcIso,
                promptTokens,
                outputTokens,
                totalTokens,
                timeoutSeconds
            );
        }

        if (faceIdOnlyMode && hasUsableFaceTargets_(agent.face_targets)) {
            if (hit.faceIdMatch && hit.faceIdTargetNames.empty()) {
                hit.faceIdTargetNames = configuredFaceTargetNames;
            }
            hit.alertCondition = hit.faceIdMatch;
            hit.answer = buildFaceIdOnlyShortAnswer_(hit.faceIdMatch, hit.faceIdTargetNames);
        }
        if (!hasUsableInferenceResult_(hit, promptTokens, outputTokens, totalTokens)) {
            Logger::instance().logDebug(
                "job",
                "runAgentInferenceOnCamera_: image inference produced no usable provider result cameraId=" +
                std::to_string(cameraId)
            );
            return "";
        }

        const bool firstPassAlertCondition = hit.alertCondition;
        const bool llmAlertCondition = hit.alertCondition;
        std::string decisionSource = "llm";
        std::string temporalDecisionSummary;
        json temporalReportDeliveryMarkers = json::array();
        AlertValidationMeta_ validatorMeta;

        const LocalAlertNormalization_ normalizedLocalAlert =
            normalizeConflictingLocalAlert_(hit.alertCondition, alertConditionText, hit);
        if (normalizedLocalAlert.alertCondition != hit.alertCondition) {
            Logger::instance().logDebug(
                "job",
                "runAgentInferenceOnCamera_: downgraded contradictory local alert (image) cameraId=" +
                std::to_string(cameraId) + " reason=" + normalizedLocalAlert.reason
            );
            hit.alertCondition = normalizedLocalAlert.alertCondition;
        }
        const bool localAlertSignal = hit.alertCondition;
        const std::string localDecisionSource = decisionSource;
        std::vector<std::string> roundEvidenceKeys;
        TemporalEvidenceTrail temporalEvidenceTrailSnapshot;
        json publishedCrossCameraHunts = json::array();
        if (temporalPlanActive) {
            temporal::applyRound(
                temporalSlot.state,
                temporalSlot.planEnvelope,
                hit.identityPatch,
                hit.observations,
                hit.temporalEvidenceCandidates,
                nowIsoForInference,
                hit.answer,
                hit.unknownReasons,
                std::string(),
                std::string(),
                hit.faceIdentityMatches
            );
            const json candidateDecisions =
                temporal::extractLastRoundCandidateDecisions(temporalSlot.state);
            if (candidateDecisions.is_array() && !candidateDecisions.empty()) {
                Logger::instance().logDebug(
                    "job",
                    "runAgentInferenceOnCamera_: temporal candidate decisions (image) cameraId=" +
                    std::to_string(cameraId) + " decisions=" + candidateDecisions.dump()
                );
            }
            const temporal::EvalResult eval = temporal::evaluate(
                temporalSlot.state,
                temporalSlot.planEnvelope,
                nowIsoForInference
            );
            const bool fallbackToLocalAlert =
                temporal::shouldFallbackToLocalAlert(eval, localAlertSignal);
            temporalOperatorResults = eval.operatorResults;
            temporalReport = eval.report;
            temporalReportDeliveryMarkers = eval.reportDeliveryMarkers;
            hit.alertCondition = eval.alert;
            decisionSource = "temporal_engine";
            temporalDecisionSummary = eval.summary;
            roundEvidenceKeys = temporal::extractLastRoundEvidenceKeys(temporalSlot.state);
            if (hit.alertCondition &&
                temporal::shouldSuppressStalePresenceCarryAlert(
                    temporalOperatorResults,
                    localAlertSignal,
                    hit.answer,
                    hit.unknownReasons,
                    hit.identityPatch,
                    hit.observations))
            {
                hit.alertCondition = false;
                decisionSource = localDecisionSource;
                temporalDecisionSummary = "Suppressed stale presence carry because the current batch has no visible target evidence.";
            }
            else if (hit.alertCondition &&
                temporal::shouldSuppressThreatCarryAlert(
                    temporalSlot.planEnvelope,
                    localAlertSignal,
                    hit.answer,
                    hit.unknownReasons,
                    hit.identityPatch,
                    hit.observations))
            {
                hit.alertCondition = false;
                decisionSource = localDecisionSource;
                temporalDecisionSummary = "Suppressed stale threat carry because the current batch has no visible threat evidence.";
            }
            publishedCrossCameraHunts = maybePublishCrossCameraHunts(
                temporalSlot,
                hit,
                temporalOperatorResults,
                localAlertSignal || hit.alertCondition,
                nowIsoForInference
            );
            if (publishedCrossCameraHunts.is_array() && !publishedCrossCameraHunts.empty()) {
                Logger::instance().logDebug(
                    "job",
                    "runAgentInferenceOnCamera_: published cross-camera hunt(s) (image) job_id=" +
                    std::to_string(jobId) + " step_id=" + std::to_string(stepId) +
                    " camera_id=" + std::to_string(cameraId) +
                    " count=" + std::to_string(publishedCrossCameraHunts.size())
                );
            }
            if (crossCameraPublishEnabled && localAlertSignal && !hit.alertCondition) {
                hit.alertCondition = true;
                decisionSource = localDecisionSource;
                if (temporalDecisionSummary.empty()) {
                    temporalDecisionSummary = publishedCrossCameraHunts.empty()
                        ? "Local trigger detected in this camera."
                        : "Local trigger detected and cross-camera hunt published.";
                }
            }
            if (fallbackToLocalAlert && !hit.alertCondition) {
                hit.alertCondition = true;
                decisionSource = localDecisionSource;
                const std::string fallbackSummary =
                    temporal::describeLocalAlertFallback(eval);
                if (temporalDecisionSummary.empty()) {
                    temporalDecisionSummary = fallbackSummary;
                } else {
                    temporalDecisionSummary += "; " + fallbackSummary;
                }
            }
            temporalSlot.touchedAt = std::chrono::steady_clock::now();
            temporalSlot.promptHash = temporalPromptHash;
            saveTemporalSlot(temporalSlot);
            TemporalEvidenceTrail trail = loadTemporalEvidenceTrail_(temporalSlotKey);
            mergeTemporalEvidenceTrail_(
                trail,
                hit.temporalEvidenceCandidates,
                roundEvidenceKeys);
            saveTemporalEvidenceTrail_(temporalSlotKey, trail);
            temporalEvidenceTrailSnapshot = std::move(trail);
        }

        const bool identityCardsMaterialized =
            owner_ &&
            owner_->materializeOperationalIdentityCards(
                hit,
                temporalSlot.state,
                temporalSlot.visualState,
                "job",
                "runAgentInferenceOnCamera_(image)"
            );
        if (identityCardsMaterialized) {
            temporalSlot.touchedAt = std::chrono::steady_clock::now();
            temporalSlot.promptHash = temporalPromptHash;
            saveTemporalSlot(temporalSlot);
        }

        const json crossCameraMatchResults =
            buildCrossCameraMatchResults(hit, activeCrossCameraWatchlist);
        if (hit.crossCameraWatchlistMatches.is_array() && !hit.crossCameraWatchlistMatches.empty()) {
            Logger::instance().logDebug(
                "job",
                "runAgentInferenceOnCamera_: evaluated cross-camera watchlist matches (image) job_id=" +
                std::to_string(jobId) + " step_id=" + std::to_string(stepId) +
                " camera_id=" + std::to_string(cameraId) +
                " raw_match_count=" +
                std::to_string(static_cast<unsigned long long>(hit.crossCameraWatchlistMatches.size())) +
                " accepted_match_count=" +
                std::to_string(static_cast<unsigned long long>(crossCameraMatchResults.size()))
            );
        }
        bool crossCameraAlert = false;
        for (const auto& match : crossCameraMatchResults) {
            if (!match.is_object()) continue;
            if (!match.contains("alert_on_match") || !match["alert_on_match"].is_boolean() || match["alert_on_match"].get<bool>()) {
                crossCameraAlert = true;
                break;
            }
        }
        if (crossCameraAlert) {
            hit.alertCondition = true;
            decisionSource = "temporal_engine_cross_camera";
            temporalOperatorResults.push_back(json{
                { "operator_id", "cross_camera_watchlist_match" },
                { "type", "cross_camera_track_after_trigger" },
                { "value", "true" },
                { "matches", crossCameraMatchResults }
            });
            temporalDecisionSummary = "Cross-camera hunt matched this camera.";
            Logger::instance().logDebug(
                "job",
                "runAgentInferenceOnCamera_: cross-camera watchlist match (image) job_id=" +
                std::to_string(jobId) + " step_id=" + std::to_string(stepId) +
                " camera_id=" + std::to_string(cameraId) +
                " match_count=" + std::to_string(crossCameraMatchResults.size())
            );
        }
        const bool includeTemporalDiagnostics =
            temporalPlanActive || (temporalOperatorResults.is_array() && !temporalOperatorResults.empty());
        const json temporalGroupImages =
            buildTemporalAlertGroupImages_(
                temporalEvidenceTrailSnapshot,
                temporalOperatorResults,
                roundEvidenceKeys,
                cameraId,
                hit.cameraName);
        const std::string temporalFallbackImageB64 =
            extractFirstTemporalGroupImageB64_(temporalGroupImages);

        std::vector<std::string> rejectedAlertRegionIds;
        std::vector<std::string> alertRegionIds = sanitizeAlertRegionIds_(
            hit.alertRegionIds,
            allowedAlertRegionLabelById,
            &rejectedAlertRegionIds
        );
        if (hit.alertCondition &&
            alertRegionIds.empty() &&
            hit.alertRegionIds.empty() &&
            allowedAlertRegionLabelById.size() == 1 &&
            allowedAlertRegionLabelById.find("full-frame") != allowedAlertRegionLabelById.end())
        {
            alertRegionIds.push_back("full-frame");
        }
        const std::vector<std::string> alertRegionNames =
            mapRegionIdsToNames_(alertRegionIds, allowedAlertRegionLabelById);
        const std::vector<std::string> motionRegionIds =
            sanitizeAlertRegionIds_(motionTriggeredRegionIds, allowedAlertRegionLabelById, nullptr);
        const std::vector<std::string> motionRegionNames =
            mapRegionIdsToNames_(motionRegionIds, allowedAlertRegionLabelById);
        const std::vector<std::string> overlayRegionIds =
            sanitizeAlertRegionIds_(drawnRegionIds, allowedAlertRegionLabelById, nullptr);

        if (!rejectedAlertRegionIds.empty()) {
            Logger::instance().logDebug(
                "job",
                "runAgentInferenceOnCamera_: dropped invalid alert_region_ids cameraId=" +
                std::to_string(cameraId) + " dropped_count=" +
                std::to_string(rejectedAlertRegionIds.size())
            );
        }

        enqueueJobTokenUsageAsync(
            owner_,
            jobId,
            stepId,
            cameraId,
            promptTokens,
            outputTokens,
            totalTokens,
            inferenceModel,
            agent.agent_key
        );

        const std::string effectiveAnswer =
            resolveAlertAnswerText_(hit.answer, temporalDecisionSummary, decisionSource);
        json regionOut;
        regionOut["region_id"] = "full-frame";
        regionOut["region_label"] = polygonRegions.empty()
            ? "Full frame"
            : ("ROI overlays: " + std::to_string(polygonRegions.size()));
        regionOut["full_frame"] = true;
        if (!overlayRegionIds.empty()) {
            regionOut["overlay_region_ids"] = overlayRegionIds;
        }
        regionOut["answer"] = effectiveAnswer;
        regionOut["alert_condition"] = hit.alertCondition;
        regionOut["alert_region_ids"] = alertRegionIds;
        regionOut["alert_region_names"] = alertRegionNames;
        regionOut["motion_trigger_region_ids"] = motionRegionIds;
        regionOut["motion_trigger_region_names"] = motionRegionNames;
        regionOut["alert_condition_first_pass"] = firstPassAlertCondition;
        regionOut["validator_executed"] = validatorMeta.executed;
        regionOut["validator_alert_condition"] = validatorMeta.alertCondition;
        regionOut["validator_prompt_tokens"] = validatorMeta.promptTokens;
        regionOut["validator_output_tokens"] = validatorMeta.outputTokens;
        regionOut["validator_total_tokens"] = validatorMeta.totalTokens;
        regionOut["faceid_match"] = hit.faceIdMatch;
        regionOut["decision_source"] = decisionSource;
        regionOut["llm_alert_condition"] = llmAlertCondition;
        regionOut["final_alert_condition"] = hit.alertCondition;
        if (!hit.faceIdTargetNames.empty()) {
            regionOut["faceid_target_names"] = hit.faceIdTargetNames;
        }
        regionOut["start_condition_step_id"] =
            (hit.startConditionStepId >= 0) ? json(hit.startConditionStepId) : json(false);
        regionOut["prompt_tokens"] = promptTokens;
        regionOut["output_tokens"] = outputTokens;
        regionOut["total_tokens"] = totalTokens;
        if (includeTemporalDiagnostics) {
            regionOut["temporal_operator_results"] = temporalOperatorResults;
            if (!temporalDecisionSummary.empty()) {
                regionOut["temporal_decision_summary"] = temporalDecisionSummary;
            }
        }
        if (firstPassAlertCondition || hit.faceIdMatch) {
            regionOut["image_jpeg_b64"] = annotatedJpegB64;
        }
        regionResults.push_back(std::move(regionOut));

        sumPromptTokens = promptTokens;
        sumOutputTokens = outputTokens;
        sumTotalTokens = totalTokens;
        sumValidatorPromptTokens = validatorMeta.promptTokens;
        sumValidatorOutputTokens = validatorMeta.outputTokens;
        sumValidatorTotalTokens = validatorMeta.totalTokens;
        validatorExecutedAny = validatorMeta.executed;
        validatorAlertAny = validatorMeta.alertCondition;
        firstPassAlertAny = firstPassAlertCondition;
        finalAlertAny = hit.alertCondition;
        faceIdMatchAny = hit.faceIdMatch;
        startConditionStepId = hit.startConditionStepId;
        representativeAnswer = effectiveAnswer;
        representativeImageB64 =
            (hit.alertCondition || hit.faceIdMatch) ? annotatedJpegB64 : std::string();
        representativeRegionId = "full-frame";
        for (const auto& name : hit.faceIdTargetNames) {
            if (std::find(mergedFaceNames.begin(), mergedFaceNames.end(), name) == mergedFaceNames.end()) {
                mergedFaceNames.push_back(name);
            }
        }

        // Return compact JSON for storage (region-aware with backward-compatible top-level fields)
        json out;
        out["agent_key"] = agent.agent_key;
        out["inference_model"] = inferenceModel;
        out["model_fps"] = modelInputFps;
        out["camera_id"] = cameraId;
        out["input_type"] = "image";
        out["result_source"] = "llm";
        out["decision_source"] = decisionSource;
        out["answer"] = representativeAnswer;
        out["alert_condition"] = finalAlertAny;
        out["llm_alert_condition"] = llmAlertCondition;
        out["final_alert_condition"] = finalAlertAny;
        out["alert_condition_first_pass"] = firstPassAlertAny;
        out["validator_executed"] = validatorExecutedAny;
        out["validator_model"] = "";
        out["validator_alert_condition"] = validatorAlertAny;
        out["validator_prompt_tokens"] = sumValidatorPromptTokens;
        out["validator_output_tokens"] = sumValidatorOutputTokens;
        out["validator_total_tokens"] = sumValidatorTotalTokens;
        out["faceid_match"] = faceIdMatchAny;
        if (!mergedFaceNames.empty()) {
            out["faceid_target_names"] = mergedFaceNames;
        }
        if (!hit.primaryIdentityCardId.empty()) {
            out["primary_identity_card_id"] = hit.primaryIdentityCardId;
        }
        if (hit.identityCards.is_array() && !hit.identityCards.empty()) {
            out["identity_cards"] = hit.identityCards;
        }
        out["start_condition_step_id"] =
            (startConditionStepId >= 0) ? json(startConditionStepId) : json(false);
        out["prompt_tokens"] = sumPromptTokens;
        out["output_tokens"] = sumOutputTokens;
        out["total_tokens"] = sumTotalTokens;
        out["clip_path"] = clipPath;
        if (!tsUtcIso.empty()) {
            out["segment_end_utc"] = tsUtcIso;
        }
        out["region_results"] = regionResults;
        out["alert_region_ids"] = alertRegionIds;
        out["alert_region_names"] = alertRegionNames;
        out["motion_trigger_region_ids"] = motionRegionIds;
        out["motion_trigger_region_names"] = motionRegionNames;
        bool temporalReportDelivered = false;
        if (includeTemporalDiagnostics) {
            out["temporal_operator_results"] = temporalOperatorResults;
            out["temporal_report_due"] = temporalReport;
            out["temporal_report_delivered"] = false;
            if (!temporalDecisionSummary.empty()) {
                out["temporal_decision_summary"] = temporalDecisionSummary;
            }
        }
        if (temporalGroupImages.is_array() && !temporalGroupImages.empty()) {
            out["group_images"] = temporalGroupImages;
            out["group_image_count"] = temporalGroupImages.size();
        }
        if (!overlayRegionIds.empty()) {
            out["overlay_region_ids"] = overlayRegionIds;
        }
        if (!representativeRegionId.empty()) {
            out["region_id"] = representativeRegionId;
        }
        if (!representativeImageB64.empty()) {
            out["image_jpeg_b64"] = representativeImageB64;
            out["image_ts_utc"] = tsUtcIso;
        } else if (!temporalFallbackImageB64.empty()) {
            out["image_jpeg_b64"] = temporalFallbackImageB64;
        }
        if (temporalPlanActive && temporalReport && owner_) {
            const json reportIdentityCards =
                owner_->collectOperationalIdentityCards(temporalSlot.state, temporalSlot.visualState);
            std::string reportPrimaryIdentityCardId = hit.primaryIdentityCardId;
            if (reportPrimaryIdentityCardId.empty() &&
                reportIdentityCards.is_array() &&
                !reportIdentityCards.empty() &&
                reportIdentityCards[0].is_object() &&
                reportIdentityCards[0].contains("card_id") &&
                reportIdentityCards[0]["card_id"].is_string())
            {
                reportPrimaryIdentityCardId =
                    trimCopyRuntime_(reportIdentityCards[0]["card_id"].get<std::string>());
            }
            json reportDetails = {
                { "job_id", jobId },
                { "step_id", stepId },
                { "camera_id", cameraId },
                { "agent_id", agent.id },
                { "operator_results", temporalOperatorResults },
                { "temporal_operator_results", temporalOperatorResults },
                { "answer", representativeAnswer },
                { "decision_source", decisionSource },
                { "llm_alert_condition", llmAlertCondition },
                { "final_alert_condition", finalAlertAny },
                { "temporal_decision_summary", temporalDecisionSummary }
            };
            if (!jobRunId.empty()) {
                reportDetails["job_run_id"] = jobRunId;
            }
            if (!stepRunId.empty()) {
                reportDetails["step_run_id"] = stepRunId;
            }
            if (!agentRunId.empty()) {
                reportDetails["agent_run_id"] = agentRunId;
            }
            if (!reportPrimaryIdentityCardId.empty()) {
                reportDetails["primary_identity_card_id"] = reportPrimaryIdentityCardId;
            }
            if (reportIdentityCards.is_array() && !reportIdentityCards.empty()) {
                reportDetails["identity_cards"] = reportIdentityCards;
            }
            else if (hit.identityCards.is_array() && !hit.identityCards.empty()) {
                reportDetails["identity_cards"] = hit.identityCards;
            }
            if (temporalGroupImages.is_array() && !temporalGroupImages.empty()) {
                reportDetails["group_images"] = temporalGroupImages;
                reportDetails["group_image_count"] = temporalGroupImages.size();
            }
            if (publishedCrossCameraHunts.is_array() && !publishedCrossCameraHunts.empty()) {
                reportDetails["published_cross_camera_hunts"] = publishedCrossCameraHunts;
            }
            if (!temporalFallbackImageB64.empty()) {
                reportDetails["image_jpeg_b64"] = temporalFallbackImageB64;
            } else if (!representativeImageB64.empty()) {
                reportDetails["image_jpeg_b64"] = representativeImageB64;
            }
            attachTemporalReportDeliveryIds(reportDetails, temporalReportDeliveryMarkers);
            const AgentCore::AgentEventPostResult reportPostResult =
                owner_->postAgentEventWithResult(
                    "temporal_report",
                    std::optional<int>(cameraId),
                    "",
                    "",
                    reportDetails
                );
            temporalReportDelivered = reportPostResult.ok;
            if (temporalReportDelivered) {
                acknowledgeTemporalReportDelivery(
                    temporalSlot,
                    temporalReportDeliveryMarkers,
                    nowIsoForInference);
            } else {
                Logger::instance().logError(
                    std::to_string(cameraId),
                    "failed to post temporal report for job image inference",
                    makeJobErrorContext_(
                        "job_step",
                        "JobRuntime::runAgentInferenceOnCamera_",
                        "post_temporal_report_image",
                        {
                            { "job_id", jobId },
                            { "step_id", stepId },
                            { "camera_id", cameraId },
                            { "agent_id", agent.id },
                            { "http_code", reportPostResult.httpCode },
                            { "response", reportPostResult.response }
                        }
                    )
                );
            }
            if (includeTemporalDiagnostics) {
                out["temporal_report_delivered"] = temporalReportDelivered;
            }
        }

        return out.dump();
    }

    // -------------------------------
    // VIDEO MODE
    // -------------------------------
    const int normalizedRunEverySeconds = normalizedRunEverySecondsForJobAgent_(agent);
    std::vector<std::string> tempClipCleanupPaths;
    struct TempPathsCleanupGuard {
        std::vector<std::string>* paths = nullptr;
        bool disarm = false;
        ~TempPathsCleanupGuard() {
            if (disarm || !paths) return;
            for (const auto& rawPath : *paths) {
                if (rawPath.empty()) continue;
                std::error_code ec;
                fs::remove(fs::path(rawPath), ec);
            }
        }
    } tempClipCleanupGuard{ &tempClipCleanupPaths };
    std::string assembledWindowStartPretty;
    std::string assembledWindowEndPretty;
    std::string assembledWindowStartUtc;
    std::string assembledWindowEndUtc;
    int expectedWindowSecondsForOpenAI = normalizedRunEverySeconds;
    std::string consumptionKey;

    std::string clipPath;
    if (normalizedRunEverySeconds == 60) {
        auto storedSixtySecondClipPath =
            getNextReadyCurrentDayStoredSixtySecondClipPathForJobStepCamera_(
                jobId,
                stepId,
                cameraId,
                coverageCutoffUtcIso
            );
        if (!storedSixtySecondClipPath.has_value()) {
            Logger::instance().logDebug(
                "job",
                "runAgentInferenceOnCamera_: waiting for a finalized current-day 60s clip before job inference cameraId=" +
                std::to_string(cameraId)
            );
            return "";
        }

        clipPath = *storedSixtySecondClipPath;
        const std::string clipKey = makeMonotonicClipKey_(fs::path(clipPath));
        if (!isNewerClipForJobStepCamera_(jobId, stepId, cameraId, clipKey)) {
            return "";
        }

        int parsedCameraId = -1;
        if (!parseJobClipFilename(
                fs::path(clipPath).filename().string(),
                parsedCameraId,
                assembledWindowStartPretty,
                assembledWindowEndPretty) ||
            parsedCameraId != cameraId)
        {
            Logger::instance().logDebug(
                "job",
                "runAgentInferenceOnCamera_: failed to parse finalized current-day 60s clip metadata cameraId=" +
                std::to_string(cameraId) + " clip=" + clipPath
            );
            return "";
        }
        (void)parseClipRangeUtcIsoFromPath_(
            fs::path(clipPath),
            assembledWindowStartUtc,
            assembledWindowEndUtc
        );

        expectedWindowSecondsForOpenAI = normalizedRunEverySeconds;
        consumptionKey = clipKey;
        Logger::instance().logDebug(
            "job",
            "runAgentInferenceOnCamera_: using finalized current-day 60s clip run_every=" +
            std::to_string(normalizedRunEverySeconds) + "s clip=" + clipPath
        );
    }

    if (clipPath.empty() && normalizedRunEverySeconds == 60) {
        Logger::instance().logDebug(
            "job",
            "runAgentInferenceOnCamera_: respecting run_every=60s and skipping this cycle because no finalized 60s clip is ready"
        );
        return "";
    }

    if (clipPath.empty()) {
        const VideoWindowAssemblyResult adaptiveWindow =
            assembleAdaptivePendingJobsWindow_(
                jobId,
                stepId,
                cameraId,
                coverageCutoffUtcIso
            );
        if (adaptiveWindow.status == VideoWindowAssemblyStatus::NoNewWindow) {
            return "";
        }
        if (adaptiveWindow.status != VideoWindowAssemblyStatus::Assembled || adaptiveWindow.clipPath.empty()) {
            Logger::instance().logDebug(
                "job",
                "runAgentInferenceOnCamera_: adaptive pending-window assembly failed cameraId=" +
                std::to_string(cameraId) + " err=" + adaptiveWindow.error
            );
            return "";
        }

        clipPath = adaptiveWindow.clipPath;
        tempClipCleanupPaths = adaptiveWindow.cleanupPaths;
        consumptionKey = adaptiveWindow.consumedClipKey;
        assembledWindowStartPretty = adaptiveWindow.windowStartPretty;
        assembledWindowEndPretty = adaptiveWindow.windowEndPretty;
        assembledWindowStartUtc = adaptiveWindow.windowStartUtc;
        assembledWindowEndUtc = adaptiveWindow.windowEndUtc;
        expectedWindowSecondsForOpenAI =
            adaptiveWindow.windowSeconds > 0 ? adaptiveWindow.windowSeconds : 10;
    }

    if (outMediaInfo && !clipPath.empty()) {
        outMediaInfo->hadInput = true;
        outMediaInfo->coverageRelevant = true;
        outMediaInfo->consumptionKey = consumptionKey;
        outMediaInfo->latestCapturedEndUtc = assembledWindowEndUtc;
    }

    {
        fs::path trimmedClipPath;
        std::string trimErr;
        std::string effectiveStartUtc = assembledWindowStartUtc;
        std::string effectiveEndUtc = assembledWindowEndUtc;
        if (!trimClipToCoverageCutoff_(
                jobId,
                stepId,
                cameraId,
                fs::path(clipPath),
                assembledWindowStartUtc,
                assembledWindowEndUtc,
                coverageCutoffUtcIso,
                trimmedClipPath,
                effectiveStartUtc,
                effectiveEndUtc,
                &trimErr))
        {
            Logger::instance().logDebug(
                "job",
                "runAgentInferenceOnCamera_: coverage trim skipped clip for video inference cameraId=" +
                std::to_string(cameraId) + " err=" + trimErr
            );
            return "";
        }
        if (!trimmedClipPath.empty()) {
            clipPath = trimmedClipPath.string();
            tempClipCleanupPaths.push_back(clipPath);
        }
        assembledWindowStartUtc = effectiveStartUtc;
        assembledWindowEndUtc = effectiveEndUtc;
        if (outMediaInfo) {
            outMediaInfo->processedSegmentStartUtc = assembledWindowStartUtc;
            outMediaInfo->processedSegmentEndUtc = assembledWindowEndUtc;
        }
    }

    const std::vector<JobAnalysisRegion> activeRegions =
        collectEnabledAnalysisRegionsForAgent_(agent);
    const JobFrameWindowNorm frameWindow =
        resolveFrameWindowFromRegions_(activeRegions);
    const bool hasFrameWindow = isFrameWindowActive_(frameWindow);
    const std::vector<JobAnalysisRegion> runtimeActiveRegions =
        remapRegionsToFrameWindow_(activeRegions, frameWindow);
    const std::vector<JobAnalysisRegion> polygonRegions =
        collectPolygonOnlyRegions_(runtimeActiveRegions);
    const std::vector<JobAnalysisRegion>& allowedAlertRegions =
        polygonRegions.empty() ? runtimeActiveRegions : polygonRegions;
    const std::unordered_map<std::string, std::string> allowedAlertRegionLabelById =
        buildRegionLabelByIdMap_(allowedAlertRegions);
    std::vector<std::string> motionTriggeredRegionIds;
    const bool enforceMotionGate = agent.only_capture_on_motion;
    const bool enforceMotionWithoutPolygon =
        enforceMotionGate && polygonRegions.empty();
    std::vector<JobAnalysisRegion> motionRegions;
    if (enforceMotionGate) {
        motionRegions = polygonRegions;
        if (enforceMotionWithoutPolygon) {
            motionRegions.push_back(buildSyntheticFullFrameMotionRegion_());
        }
    }

    std::string clipPathForInference = clipPath;
    std::string croppedClipPath;
    std::string sampledClipPath;
    std::string overlayClipPath;
    struct TempPathGuard {
        std::string* pathPtr = nullptr;
        ~TempPathGuard() {
            if (pathPtr && !pathPtr->empty()) {
                std::error_code ec;
                fs::remove(fs::path(*pathPtr), ec);
            }
        }
    } croppedClipGuard{ &croppedClipPath };
    TempPathGuard sampledClipGuard{ &sampledClipPath };
    TempPathGuard overlayClipGuard{ &overlayClipPath };
    std::vector<std::string> drawnOverlayRegionIds;

    if (hasFrameWindow) {
        fs::path croppedPath;
        std::string cropErr;
        if (!cropVideoClipByFrameWindow_(
                fs::path(clipPath),
                frameWindow,
                croppedPath,
                &cropErr) ||
            croppedPath.empty())
        {
            Logger::instance().logDebug(
                "job",
                "runAgentInferenceOnCamera_: frame-window crop failed (video), skipping inference cameraId=" +
                std::to_string(cameraId) + " err=" + cropErr
            );
            return "";
        }
        croppedClipPath = croppedPath.string();
        clipPathForInference = croppedClipPath;
    }

    if (!motionRegions.empty()) {
        std::string motionErr;
        bool motionDetected = false;
        if (!detectMotionInAnyRegionFromClip_(
                fs::path(clipPathForInference),
                motionRegions,
                motionDetected,
                &motionTriggeredRegionIds,
                &motionErr))
        {
            Logger::instance().logDebug(
                "job",
                "runAgentInferenceOnCamera_: ROI/full-frame motion check failed (video), skipping inference cameraId=" +
                std::to_string(cameraId) + " err=" + motionErr +
                " roi_count=" + std::to_string(motionRegions.size())
            );
            return "";
        }
        if (!motionDetected) {
            Logger::instance().logDebug(
                "job",
                "runAgentInferenceOnCamera_: skipped video inference due no ROI/full-frame motion cameraId=" +
                std::to_string(cameraId) + " roi_count=" + std::to_string(motionRegions.size())
            );
            return "";
        }

        if (enforceMotionWithoutPolygon) {
            motionTriggeredRegionIds.clear();
        }
    }

    if (!useOpenAICompatible) {
        try {
            fs::path srcPath = fs::path(clipPathForInference);
            fs::path dstPath = srcPath;
            dstPath += ".model_" + std::to_string(modelInputFps) + "fps.mp4";

            std::string sampleErr;
            if (sampleMp4ToTargetFps_(srcPath, dstPath, modelInputFps, &sampleErr)) {
                clipPathForInference = dstPath.string();
                sampledClipPath = clipPathForInference;
            }
            else {
                Logger::instance().logDebug(
                    "job",
                    "runAgentInferenceOnCamera_: failed to sample clip to " +
                    std::to_string(modelInputFps) + "fps, using original clip. err=" + sampleErr
                );
            }
        }
        catch (...) {
            // keep original clipPathForInference
        }
    }

    if (!polygonRegions.empty()) {
        try {
            fs::path annotatedPath;
            std::string overlayErr;
            if (annotateVideoClipWithRegions_(
                    fs::path(clipPathForInference),
                    polygonRegions,
                    annotatedPath,
                    &drawnOverlayRegionIds,
                    &overlayErr) &&
                !annotatedPath.empty())
            {
                clipPathForInference = annotatedPath.string();
                overlayClipPath = clipPathForInference;
            }
            else {
                Logger::instance().logDebug(
                    "job",
                    "runAgentInferenceOnCamera_: video ROI overlay failed, fallback original clip cameraId=" +
                    std::to_string(cameraId) + " err=" + overlayErr
                );
            }
        }
        catch (const std::exception& ex) {
            Logger::instance().logDebug(
                "job",
                std::string("runAgentInferenceOnCamera_: video ROI overlay exception: ") + ex.what()
            );
        }
        catch (...) {
            Logger::instance().logDebug(
                "job",
                "runAgentInferenceOnCamera_: video ROI overlay unknown exception"
            );
        }
    }

    // 3) Read mp4 bytes
    std::vector<std::uint8_t> bytes;
    {
        std::ifstream ifs(clipPathForInference, std::ios::binary);
        if (!ifs) return "";
        ifs.seekg(0, std::ios::end);
        std::streampos n = ifs.tellg();
        ifs.seekg(0, std::ios::beg);
        if (n <= 0) return "";
        bytes.resize(static_cast<size_t>(n));
        if (!ifs.read(reinterpret_cast<char*>(bytes.data()), n)) {
            bytes.clear();
            return "";
        }
    }

    // 4) Call Gemini JOB endpoint (video)
    EncodedVideoSegment seg;
    seg.bytes = std::move(bytes);
    seg.sourceFilePath = clipPathForInference;
    seg.cameraId = cameraId;

    std::filesystem::path p(clipPath);
    std::string clipStartUtc;
    std::string clipEndUtc;
    if (parseClipRangeUtcIsoFromPath_(p, clipStartUtc, clipEndUtc)) {
        seg.startTs = clipStartUtc;
        seg.endTs = clipEndUtc;
    }
    else {
        seg.startTs = assembledWindowStartUtc;
        seg.endTs = assembledWindowEndUtc;
    }
    if (outMediaInfo) {
        if (outMediaInfo->processedSegmentStartUtc.empty()) {
            outMediaInfo->processedSegmentStartUtc = seg.startTs;
        }
        if (outMediaInfo->processedSegmentEndUtc.empty()) {
            outMediaInfo->processedSegmentEndUtc = seg.endTs;
        }
    }


    json regionResults = json::array();
    int sumPromptTokens = 0;
    int sumOutputTokens = 0;
    int sumTotalTokens = 0;
    int sumValidatorPromptTokens = 0;
    int sumValidatorOutputTokens = 0;
    int sumValidatorTotalTokens = 0;
    bool validatorExecutedAny = false;
    bool validatorAlertAny = false;
    bool firstPassAlertAny = false;
    bool finalAlertAny = false;
    bool faceIdMatchAny = false;
    int startConditionStepId = -1;
    std::vector<std::string> mergedFaceNames;
    std::string representativeAnswer;
    std::string representativeRegionId;
    const std::string nowIsoForInference = temporal::nowIso();
    const std::string temporalDecisionNowIso =
        temporal::decisionAnchorUtc(nowIsoForInference, seg.endTs);
    const std::string inferencePromptBase = buildInferencePrompt_(
        agent.prompt_template,
        alertConditionText,
        agent.negative_condition_text,
        injectedInput,
        agent.face_targets,
        agent.negative_reference_images
    );
    std::string inferencePrompt = inferencePromptBase;
    bool temporalPlanActive = false;
    bool temporalReport = false;
    nlohmann::json temporalOperatorResults = nlohmann::json::array();
    TemporalRuntimeSlot temporalSlot = preparedTemporalSlot;
    const json activeCrossCameraWatchlist = loadActiveCrossCameraWatchlist(nowIsoForInference);
    const json promptCrossCameraWatchlist =
        temporal::sanitizePromptIdentityPayload(activeCrossCameraWatchlist);
    if (temporalPlanPrepared && temporal::planUsable(temporalSlot.planEnvelope)) {
        attachTemporalZoneCatalog_(temporalSlot.planEnvelope, activeRegions);
        nlohmann::json temporalInput = temporal::buildInferenceInput(
            temporalSlot.planEnvelope,
            temporalSlot.state,
            cameraId,
            temporalDecisionNowIso,
            seg.startTs,
            seg.endTs
        );
        if (promptCrossCameraWatchlist.is_array() && !promptCrossCameraWatchlist.empty()) {
            temporalInput["cross_camera_watchlist"] = promptCrossCameraWatchlist;
            if (!temporalInput.contains("expected_output_schema") || !temporalInput["expected_output_schema"].is_object()) {
                temporalInput["expected_output_schema"] = json::object();
            }
            temporalInput["expected_output_schema"]["watchlist_updates"] = json::array();
        }
        Logger::instance().logDebug(
            "job",
            "runAgentInferenceOnCamera_: temporal input injected (video) job_id=" +
            std::to_string(jobId) + " step_id=" + std::to_string(stepId) +
            " camera_id=" + std::to_string(cameraId) +
            " segment_start=" + seg.startTs + " segment_end=" + seg.endTs +
            " now_utc=" +
            temporalInput.value("time_context", nlohmann::json::object()).value("now_utc", "") +
            " payload=" + temporalInput.dump()
        );
        inferencePrompt += temporal::runtimePromptAppendix(temporalInput);
        temporalPlanActive = true;
    }
    else if (promptCrossCameraWatchlist.is_array() && !promptCrossCameraWatchlist.empty()) {
        nlohmann::json temporalInput = buildCrossCameraRuntimeInput(nowIsoForInference, seg.startTs, seg.endTs);
        temporalInput["cross_camera_watchlist"] = promptCrossCameraWatchlist;
        Logger::instance().logDebug(
            "job",
            "runAgentInferenceOnCamera_: cross-camera watchlist injected without local temporal plan (video) job_id=" +
            std::to_string(jobId) + " step_id=" + std::to_string(stepId) +
            " camera_id=" + std::to_string(cameraId) +
            " segment_start=" + seg.startTs + " segment_end=" + seg.endTs +
            " now_utc=" +
            temporalInput.value("time_context", nlohmann::json::object()).value("now_utc", "") +
            " payload=" + temporalInput.dump()
        );
        inferencePrompt += temporal::runtimePromptAppendix(temporalInput);
    }

    int promptTokens = 0;
    int outputTokens = 0;
    int totalTokens = 0;
    VideoHit hit;
    if (useOpenAICompatible) {
        if (modelApiKey.empty()) return "";
        hit = owner_->callOpenAIVisionVideoSegmentJOB_(
            seg,
            inferencePrompt,
            faceReferences,
            negativeReferences,
            /*alertConditionText*/ alertConditionText,
            /*startConditionText*/ startConditionText,
            /*openAiModelName*/ openAiModelName,
            /*openAiApiKey*/ modelApiKey,
            /*modelInputFps*/ modelInputFps,
            /*expectedWindowSeconds*/ expectedWindowSecondsForOpenAI,
            /*runningResolution*/ runningResolution,
            normalizeVideoPackagingMode_(agent.video_packaging_mode),
            promptTokens,
            outputTokens,
            totalTokens,
            timeoutSeconds
        );
    }
    else {
        hit = owner_->callGeminiVisionVideoSegmentJOB_(
            seg,
            inferencePrompt,
            /*uploadedImageBase64*/ "",
            faceReferences,
            negativeReferences,
            /*alertConditionText*/ alertConditionText,
            /*startConditionText*/ startConditionText,
            modelTier,
            /*geminiApiKey*/ modelApiKey,
            promptTokens,
            outputTokens,
            totalTokens,
            timeoutSeconds
        );
    }

    if (faceIdOnlyMode && hasUsableFaceTargets_(agent.face_targets)) {
        if (hit.faceIdMatch && hit.faceIdTargetNames.empty()) {
            hit.faceIdTargetNames = configuredFaceTargetNames;
        }
        hit.alertCondition = hit.faceIdMatch;
        hit.answer = buildFaceIdOnlyShortAnswer_(hit.faceIdMatch, hit.faceIdTargetNames);
    }
    if (!hasUsableInferenceResult_(hit, promptTokens, outputTokens, totalTokens)) {
        Logger::instance().logDebug(
            "job",
            "runAgentInferenceOnCamera_: video inference produced no usable provider result cameraId=" +
            std::to_string(cameraId)
        );
        return "";
    }

    const bool firstPassAlertCondition = hit.alertCondition;
    const bool llmAlertCondition = hit.alertCondition;
    std::string decisionSource = "llm";
    std::string temporalDecisionSummary;
    json temporalReportDeliveryMarkers = json::array();
    AlertValidationMeta_ validatorMeta;

    const LocalAlertNormalization_ normalizedLocalAlert =
        normalizeConflictingLocalAlert_(hit.alertCondition, alertConditionText, hit);
    if (normalizedLocalAlert.alertCondition != hit.alertCondition) {
        Logger::instance().logDebug(
            "job",
            "runAgentInferenceOnCamera_: downgraded contradictory local alert (video) cameraId=" +
            std::to_string(cameraId) + " reason=" + normalizedLocalAlert.reason
        );
        hit.alertCondition = normalizedLocalAlert.alertCondition;
    }
    const bool localAlertSignal = hit.alertCondition;
    const std::string localDecisionSource = decisionSource;
    std::vector<std::string> roundEvidenceKeys;
    TemporalEvidenceTrail temporalEvidenceTrailSnapshot;
    json publishedCrossCameraHunts = json::array();
    if (temporalPlanActive) {
        temporal::applyRound(
            temporalSlot.state,
            temporalSlot.planEnvelope,
            hit.identityPatch,
            hit.observations,
            hit.temporalEvidenceCandidates,
            temporalDecisionNowIso,
            hit.answer,
            hit.unknownReasons,
            seg.startTs,
            seg.endTs,
            hit.faceIdentityMatches
        );
        const json candidateDecisions =
            temporal::extractLastRoundCandidateDecisions(temporalSlot.state);
        if (candidateDecisions.is_array() && !candidateDecisions.empty()) {
            Logger::instance().logDebug(
                "job",
                "runAgentInferenceOnCamera_: temporal candidate decisions (video) cameraId=" +
                std::to_string(cameraId) + " decisions=" + candidateDecisions.dump()
            );
        }
        const temporal::EvalResult eval = temporal::evaluate(
            temporalSlot.state,
            temporalSlot.planEnvelope,
            temporalDecisionNowIso
        );
        const bool fallbackToLocalAlert =
            temporal::shouldFallbackToLocalAlert(eval, localAlertSignal);
        temporalOperatorResults = eval.operatorResults;
        temporalReport = eval.report;
        temporalReportDeliveryMarkers = eval.reportDeliveryMarkers;
        hit.alertCondition = eval.alert;
        decisionSource = "temporal_engine";
        temporalDecisionSummary = eval.summary;
        roundEvidenceKeys = temporal::extractLastRoundEvidenceKeys(temporalSlot.state);
        if (hit.alertCondition &&
            temporal::shouldSuppressStalePresenceCarryAlert(
                temporalOperatorResults,
                localAlertSignal,
                hit.answer,
                hit.unknownReasons,
                hit.identityPatch,
                hit.observations))
        {
            hit.alertCondition = false;
            decisionSource = localDecisionSource;
            temporalDecisionSummary = "Suppressed stale presence carry because the current batch has no visible target evidence.";
        }
        else if (hit.alertCondition &&
            temporal::shouldSuppressThreatCarryAlert(
                temporalSlot.planEnvelope,
                localAlertSignal,
                hit.answer,
                hit.unknownReasons,
                hit.identityPatch,
                hit.observations))
        {
            hit.alertCondition = false;
            decisionSource = localDecisionSource;
            temporalDecisionSummary = "Suppressed stale threat carry because the current batch has no visible threat evidence.";
        }
        publishedCrossCameraHunts = maybePublishCrossCameraHunts(
            temporalSlot,
            hit,
            temporalOperatorResults,
            localAlertSignal || hit.alertCondition,
            nowIsoForInference
        );
        if (publishedCrossCameraHunts.is_array() && !publishedCrossCameraHunts.empty()) {
            Logger::instance().logDebug(
                "job",
                "runAgentInferenceOnCamera_: published cross-camera hunt(s) (video) job_id=" +
                std::to_string(jobId) + " step_id=" + std::to_string(stepId) +
                " camera_id=" + std::to_string(cameraId) +
                " count=" + std::to_string(publishedCrossCameraHunts.size())
            );
        }
        if (crossCameraPublishEnabled && localAlertSignal && !hit.alertCondition) {
            hit.alertCondition = true;
            decisionSource = localDecisionSource;
            if (temporalDecisionSummary.empty()) {
                temporalDecisionSummary = publishedCrossCameraHunts.empty()
                    ? "Local trigger detected in this camera."
                    : "Local trigger detected and cross-camera hunt published.";
            }
        }
        if (fallbackToLocalAlert && !hit.alertCondition) {
            hit.alertCondition = true;
            decisionSource = localDecisionSource;
            const std::string fallbackSummary =
                temporal::describeLocalAlertFallback(eval);
            if (temporalDecisionSummary.empty()) {
                temporalDecisionSummary = fallbackSummary;
            } else {
                temporalDecisionSummary += "; " + fallbackSummary;
            }
        }
        temporalSlot.touchedAt = std::chrono::steady_clock::now();
        temporalSlot.promptHash = temporalPromptHash;
        saveTemporalSlot(temporalSlot);
        TemporalEvidenceTrail trail = loadTemporalEvidenceTrail_(temporalSlotKey);
        mergeTemporalEvidenceTrail_(
            trail,
            hit.temporalEvidenceCandidates,
            roundEvidenceKeys);
        saveTemporalEvidenceTrail_(temporalSlotKey, trail);
        temporalEvidenceTrailSnapshot = std::move(trail);
    }

    const bool identityCardsMaterialized =
        owner_ &&
        owner_->materializeOperationalIdentityCards(
            hit,
            temporalSlot.state,
            temporalSlot.visualState,
            "job",
            "runAgentInferenceOnCamera_(video)"
        );
    if (identityCardsMaterialized) {
        temporalSlot.touchedAt = std::chrono::steady_clock::now();
        temporalSlot.promptHash = temporalPromptHash;
        saveTemporalSlot(temporalSlot);
    }

    const json crossCameraMatchResults =
        buildCrossCameraMatchResults(hit, activeCrossCameraWatchlist);
    if (hit.crossCameraWatchlistMatches.is_array() && !hit.crossCameraWatchlistMatches.empty()) {
        Logger::instance().logDebug(
            "job",
            "runAgentInferenceOnCamera_: evaluated cross-camera watchlist matches (video) job_id=" +
            std::to_string(jobId) + " step_id=" + std::to_string(stepId) +
            " camera_id=" + std::to_string(cameraId) +
            " raw_match_count=" +
            std::to_string(static_cast<unsigned long long>(hit.crossCameraWatchlistMatches.size())) +
            " accepted_match_count=" +
            std::to_string(static_cast<unsigned long long>(crossCameraMatchResults.size()))
        );
    }
    bool crossCameraAlert = false;
    for (const auto& match : crossCameraMatchResults) {
        if (!match.is_object()) continue;
        if (!match.contains("alert_on_match") || !match["alert_on_match"].is_boolean() || match["alert_on_match"].get<bool>()) {
            crossCameraAlert = true;
            break;
        }
    }
    if (crossCameraAlert) {
        hit.alertCondition = true;
        decisionSource = "temporal_engine_cross_camera";
        temporalOperatorResults.push_back(json{
            { "operator_id", "cross_camera_watchlist_match" },
            { "type", "cross_camera_track_after_trigger" },
            { "value", "true" },
            { "matches", crossCameraMatchResults }
        });
        temporalDecisionSummary = "Cross-camera hunt matched this camera.";
        Logger::instance().logDebug(
            "job",
            "runAgentInferenceOnCamera_: cross-camera watchlist match (video) job_id=" +
            std::to_string(jobId) + " step_id=" + std::to_string(stepId) +
            " camera_id=" + std::to_string(cameraId) +
            " match_count=" + std::to_string(crossCameraMatchResults.size())
        );
    }
    const bool includeTemporalDiagnostics =
        temporalPlanActive || (temporalOperatorResults.is_array() && !temporalOperatorResults.empty());
    const json temporalGroupImages =
        buildTemporalAlertGroupImages_(
            temporalEvidenceTrailSnapshot,
            temporalOperatorResults,
            roundEvidenceKeys,
            cameraId,
            hit.cameraName);
    const std::string temporalFallbackImageB64 =
        extractFirstTemporalGroupImageB64_(temporalGroupImages);

    std::vector<std::string> rejectedAlertRegionIds;
    std::vector<std::string> alertRegionIds = sanitizeAlertRegionIds_(
        hit.alertRegionIds,
        allowedAlertRegionLabelById,
        &rejectedAlertRegionIds
    );
    if (hit.alertCondition &&
        alertRegionIds.empty() &&
        hit.alertRegionIds.empty() &&
        allowedAlertRegionLabelById.size() == 1 &&
        allowedAlertRegionLabelById.find("full-frame") != allowedAlertRegionLabelById.end())
    {
        alertRegionIds.push_back("full-frame");
    }
    const std::vector<std::string> alertRegionNames =
        mapRegionIdsToNames_(alertRegionIds, allowedAlertRegionLabelById);
    const std::vector<std::string> motionRegionIds =
        sanitizeAlertRegionIds_(motionTriggeredRegionIds, allowedAlertRegionLabelById, nullptr);
    const std::vector<std::string> motionRegionNames =
        mapRegionIdsToNames_(motionRegionIds, allowedAlertRegionLabelById);
    const std::vector<std::string> overlayRegionIds =
        sanitizeAlertRegionIds_(drawnOverlayRegionIds, allowedAlertRegionLabelById, nullptr);

    if (!rejectedAlertRegionIds.empty()) {
        Logger::instance().logDebug(
            "job",
            "runAgentInferenceOnCamera_: dropped invalid alert_region_ids (video) cameraId=" +
            std::to_string(cameraId) + " dropped_count=" +
            std::to_string(rejectedAlertRegionIds.size())
        );
    }

    enqueueJobTokenUsageAsync(
        owner_,
        jobId,
        stepId,
        cameraId,
        promptTokens,
        outputTokens,
        totalTokens,
        inferenceModel,
        agent.agent_key
    );

    const std::string effectiveAnswer =
        resolveAlertAnswerText_(hit.answer, temporalDecisionSummary, decisionSource);
    json regionOut;
    regionOut["region_id"] = "full-frame";
    regionOut["region_label"] = polygonRegions.empty()
        ? "Full frame"
        : ("ROI overlays: " + std::to_string(polygonRegions.size()));
    regionOut["full_frame"] = true;
    regionOut["answer"] = effectiveAnswer;
    regionOut["alert_condition"] = hit.alertCondition;
    regionOut["alert_region_ids"] = alertRegionIds;
    regionOut["alert_region_names"] = alertRegionNames;
    regionOut["motion_trigger_region_ids"] = motionRegionIds;
    regionOut["motion_trigger_region_names"] = motionRegionNames;
    if (!overlayRegionIds.empty()) {
        regionOut["overlay_region_ids"] = overlayRegionIds;
    }
    regionOut["alert_condition_first_pass"] = firstPassAlertCondition;
    regionOut["validator_executed"] = validatorMeta.executed;
    regionOut["validator_alert_condition"] = validatorMeta.alertCondition;
    regionOut["validator_prompt_tokens"] = validatorMeta.promptTokens;
    regionOut["validator_output_tokens"] = validatorMeta.outputTokens;
    regionOut["validator_total_tokens"] = validatorMeta.totalTokens;
    regionOut["faceid_match"] = hit.faceIdMatch;
    regionOut["decision_source"] = decisionSource;
    regionOut["llm_alert_condition"] = llmAlertCondition;
    regionOut["final_alert_condition"] = hit.alertCondition;
    if (!hit.faceIdTargetNames.empty()) {
        regionOut["faceid_target_names"] = hit.faceIdTargetNames;
    }
    regionOut["start_condition_step_id"] =
        (hit.startConditionStepId >= 0) ? json(hit.startConditionStepId) : json(false);
    regionOut["prompt_tokens"] = promptTokens;
    regionOut["output_tokens"] = outputTokens;
    regionOut["total_tokens"] = totalTokens;
    if (includeTemporalDiagnostics) {
        regionOut["temporal_operator_results"] = temporalOperatorResults;
        if (!temporalDecisionSummary.empty()) {
            regionOut["temporal_decision_summary"] = temporalDecisionSummary;
        }
    }
    regionResults.push_back(std::move(regionOut));

    sumPromptTokens = promptTokens;
    sumOutputTokens = outputTokens;
    sumTotalTokens = totalTokens;
    sumValidatorPromptTokens = validatorMeta.promptTokens;
    sumValidatorOutputTokens = validatorMeta.outputTokens;
    sumValidatorTotalTokens = validatorMeta.totalTokens;
    validatorExecutedAny = validatorMeta.executed;
    validatorAlertAny = validatorMeta.alertCondition;
    firstPassAlertAny = firstPassAlertCondition;
    finalAlertAny = hit.alertCondition;
    faceIdMatchAny = hit.faceIdMatch;
    startConditionStepId = hit.startConditionStepId;
    representativeAnswer = effectiveAnswer;
    representativeRegionId = "full-frame";
    for (const auto& name : hit.faceIdTargetNames) {
        if (std::find(mergedFaceNames.begin(), mergedFaceNames.end(), name) == mergedFaceNames.end()) {
            mergedFaceNames.push_back(name);
        }
    }

    // 5) Return compact JSON for storage
    json out;
    out["agent_key"] = agent.agent_key;
    out["inference_model"] = inferenceModel;
    out["model_fps"] = modelInputFps;
    out["camera_id"] = cameraId;
    out["input_type"] = "video";
    out["video_packaging_mode"] = normalizeVideoPackagingMode_(agent.video_packaging_mode);
    out["result_source"] = "llm";
    out["decision_source"] = decisionSource;
    out["answer"] = representativeAnswer;
    out["alert_condition"] = finalAlertAny;
    out["llm_alert_condition"] = llmAlertCondition;
    out["final_alert_condition"] = finalAlertAny;
    out["alert_condition_first_pass"] = firstPassAlertAny;
    out["validator_executed"] = validatorExecutedAny;
    out["validator_model"] = "";
    out["validator_alert_condition"] = validatorAlertAny;
    out["validator_prompt_tokens"] = sumValidatorPromptTokens;
    out["validator_output_tokens"] = sumValidatorOutputTokens;
    out["validator_total_tokens"] = sumValidatorTotalTokens;
    out["faceid_match"] = faceIdMatchAny;
    if (!mergedFaceNames.empty()) {
        out["faceid_target_names"] = mergedFaceNames;
    }
    if (!hit.primaryIdentityCardId.empty()) {
        out["primary_identity_card_id"] = hit.primaryIdentityCardId;
    }
    if (hit.identityCards.is_array() && !hit.identityCards.empty()) {
        out["identity_cards"] = hit.identityCards;
    }
    out["start_condition_step_id"] =
        (startConditionStepId >= 0) ? json(startConditionStepId) : json(false);
    out["prompt_tokens"] = sumPromptTokens;
    out["output_tokens"] = sumOutputTokens;
    out["total_tokens"] = sumTotalTokens;
    out["clip_path"] = clipPath;
    out["segment_start_utc"] = seg.startTs;
    out["segment_end_utc"] = seg.endTs;
    out["region_results"] = regionResults;
    out["alert_region_ids"] = alertRegionIds;
    out["alert_region_names"] = alertRegionNames;
    out["motion_trigger_region_ids"] = motionRegionIds;
    out["motion_trigger_region_names"] = motionRegionNames;
    if (includeTemporalDiagnostics) {
        out["temporal_operator_results"] = temporalOperatorResults;
        out["temporal_report_due"] = temporalReport;
        if (!temporalDecisionSummary.empty()) {
            out["temporal_decision_summary"] = temporalDecisionSummary;
        }
    }
    if (temporalGroupImages.is_array() && !temporalGroupImages.empty()) {
        out["group_images"] = temporalGroupImages;
        out["group_image_count"] = temporalGroupImages.size();
    }
    if (!temporalFallbackImageB64.empty()) {
        out["image_jpeg_b64"] = temporalFallbackImageB64;
    }
    if (!overlayRegionIds.empty()) {
        out["overlay_region_ids"] = overlayRegionIds;
    }
    if (!representativeRegionId.empty()) {
        out["region_id"] = representativeRegionId;
    }
    if (!tempClipCleanupPaths.empty()) {
        out["temp_clip_cleanup_paths"] = tempClipCleanupPaths;
    }
    if (!assembledWindowStartPretty.empty()) {
        out["window_start"] = assembledWindowStartPretty;
    }
    if (!assembledWindowEndPretty.empty()) {
        out["window_end"] = assembledWindowEndPretty;
    }

    bool temporalReportDelivered = false;
    if (temporalPlanActive && temporalReport && owner_) {
        const json reportIdentityCards =
            owner_->collectOperationalIdentityCards(temporalSlot.state, temporalSlot.visualState);
        std::string reportPrimaryIdentityCardId = hit.primaryIdentityCardId;
        if (reportPrimaryIdentityCardId.empty() &&
            reportIdentityCards.is_array() &&
            !reportIdentityCards.empty() &&
            reportIdentityCards[0].is_object() &&
            reportIdentityCards[0].contains("card_id") &&
            reportIdentityCards[0]["card_id"].is_string())
        {
            reportPrimaryIdentityCardId =
                trimCopyRuntime_(reportIdentityCards[0]["card_id"].get<std::string>());
        }
        json reportDetails = {
            { "job_id", jobId },
            { "step_id", stepId },
            { "camera_id", cameraId },
            { "agent_id", agent.id },
            { "operator_results", temporalOperatorResults },
            { "temporal_operator_results", temporalOperatorResults },
            { "answer", representativeAnswer },
            { "decision_source", decisionSource },
            { "llm_alert_condition", llmAlertCondition },
            { "final_alert_condition", finalAlertAny },
            { "temporal_decision_summary", temporalDecisionSummary }
        };
        if (!jobRunId.empty()) {
            reportDetails["job_run_id"] = jobRunId;
        }
        if (!stepRunId.empty()) {
            reportDetails["step_run_id"] = stepRunId;
        }
        if (!agentRunId.empty()) {
            reportDetails["agent_run_id"] = agentRunId;
        }
        if (!reportPrimaryIdentityCardId.empty()) {
            reportDetails["primary_identity_card_id"] = reportPrimaryIdentityCardId;
        }
        if (reportIdentityCards.is_array() && !reportIdentityCards.empty()) {
            reportDetails["identity_cards"] = reportIdentityCards;
        }
        else if (hit.identityCards.is_array() && !hit.identityCards.empty()) {
            reportDetails["identity_cards"] = hit.identityCards;
        }
        if (temporalGroupImages.is_array() && !temporalGroupImages.empty()) {
            reportDetails["group_images"] = temporalGroupImages;
            reportDetails["group_image_count"] = temporalGroupImages.size();
        }
        if (publishedCrossCameraHunts.is_array() && !publishedCrossCameraHunts.empty()) {
            reportDetails["published_cross_camera_hunts"] = publishedCrossCameraHunts;
        }
        if (!temporalFallbackImageB64.empty()) {
            reportDetails["image_jpeg_b64"] = temporalFallbackImageB64;
        }
        attachTemporalReportDeliveryIds(reportDetails, temporalReportDeliveryMarkers);
        const AgentCore::AgentEventPostResult reportPostResult =
            owner_->postAgentEventWithResult(
                "temporal_report",
                std::optional<int>(cameraId),
                "",
                "",
                reportDetails
            );
        temporalReportDelivered = reportPostResult.ok;
        if (temporalReportDelivered) {
            acknowledgeTemporalReportDelivery(
                temporalSlot,
                temporalReportDeliveryMarkers,
                temporalDecisionNowIso);
        } else {
            Logger::instance().logError(
                std::to_string(cameraId),
                "failed to post temporal report for job video inference",
                makeJobErrorContext_(
                    "job_step",
                    "JobRuntime::runAgentInferenceOnCamera_",
                    "post_temporal_report_video",
                    {
                        { "job_id", jobId },
                        { "step_id", stepId },
                        { "camera_id", cameraId },
                        { "agent_id", agent.id },
                        { "http_code", reportPostResult.httpCode },
                        { "response", reportPostResult.response }
                    }
                )
            );
        }
    }

    if (includeTemporalDiagnostics) {
        out["temporal_report_delivered"] = temporalReportDelivered;
    }

    tempClipCleanupGuard.disarm = true;
    return out.dump();
}
























static fs::path jobImagesRoot_() {
    // Igual ao jobClipsRoot_() (padronizado)
    return AppBrand::jobAlertImagesRoot();
}



static fs::path makeJobBackendImagePath_(int cameraId)
{
    fs::path dir = jobImagesRoot_() / ("cam_" + std::to_string(cameraId));

    std::error_code ec;
    fs::create_directories(dir, ec);
    if (ec) {
        Logger::instance().logDebug("job",
            "makeJobBackendImagePath_: create_directories failed: " + ec.message() +
            " dir=" + dir.string());
    }

    return dir / ("alert_" + nowMs_() + ".jpg");
}



static std::filesystem::path jobClipsRoot_() {
    // If you want configurable later, read from env or config.
    return AppBrand::jobAlertClipsRoot();
}

static std::filesystem::path makeJobBackendClipPath_(int cameraId) {
    std::filesystem::path dir = jobClipsRoot_() / ("cam_" + std::to_string(cameraId));

    std::error_code ec;
    std::filesystem::create_directories(dir, ec);

    return dir / ("alert_" + nowMs_() + ".mp4");
}





static std::string getExecutableDir_()
{
    char buffer[MAX_PATH];
    DWORD len = GetModuleFileNameA(NULL, buffer, MAX_PATH);
    if (len == 0) {
        return "";
    }

    // Convert full EXE path ??? parent folder
    fs::path exePath(buffer);
    return exePath.parent_path().string();
}





static std::wstring utf8ToWide(const std::string& str)
{
    if (str.empty()) return L"";

    int size_needed = MultiByteToWideChar(CP_UTF8, 0, str.c_str(), (int)str.size(), nullptr, 0);
    std::wstring result(size_needed, 0);
    MultiByteToWideChar(CP_UTF8, 0, str.c_str(), (int)str.size(), &result[0], size_needed);
    return result;
}


static int runProcessAndWaitWin_(const std::wstring& cmdLine)
{
    STARTUPINFOW si{};
    si.cb = sizeof(si);

    PROCESS_INFORMATION pi{};

    // CreateProcessW requires a writable buffer
    std::wstring mutableCmd = cmdLine;

    BOOL ok = CreateProcessW(
        nullptr,                 // app name (null = parse from cmdline)
        mutableCmd.data(),       // command line (writable)
        nullptr,                 // process security
        nullptr,                 // thread security
        FALSE,                   // inherit handles
        CREATE_NO_WINDOW,        // flags (no console window)
        nullptr,                 // environment
        nullptr,                 // current directory
        &si,
        &pi
    );

    if (!ok) {
        return -1; // could also return GetLastError() if you want
    }

    WaitForSingleObject(pi.hProcess, INFINITE);

    DWORD exitCode = 0;
    GetExitCodeProcess(pi.hProcess, &exitCode);

    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);

    return (int)exitCode;
}

static bool extractBoundaryFrameToMatFromMp4_(
    const fs::path& srcMp4Path,
    bool useLastMoment,
    cv::Mat& outFrame,
    std::string* outErr)
{
    outFrame.release();

    std::error_code ec;
    if (!fs::exists(srcMp4Path, ec) || ec) {
        if (outErr) *outErr = "src does not exist: " + srcMp4Path.string();
        return false;
    }

    fs::path ffmpegPath = fs::path(getExecutableDir_()) / "ffmpeg.exe";
    if (!fs::exists(ffmpegPath, ec) || ec) {
        if (outErr) *outErr = "ffmpeg missing: " + ffmpegPath.string();
        return false;
    }

    fs::path jpgPath = srcMp4Path;
    jpgPath +=
        (useLastMoment ? ".lastframe_" : ".firstframe_") +
        nowMs_() + "_" +
        std::to_string(static_cast<unsigned long>(GetCurrentThreadId())) +
        ".jpg";

    std::wstring ffmpegW = utf8ToWide(ffmpegPath.string());
    std::wstring inW = utf8ToWide(srcMp4Path.string());
    std::wstring outW = utf8ToWide(jpgPath.string());

    std::wstring cmdLine =
        L"\"" + ffmpegW + L"\""
        L" -y -hide_banner -loglevel error ";
    if (useLastMoment) {
        cmdLine += L" -sseof -0.20 ";
    }
    cmdLine +=
        L" -i \"" + inW + L"\""
        L" -frames:v 1 -q:v 3 "
        L" \"" + outW + L"\"";

    int rc = runProcessAndWaitWin_(cmdLine);
    if (rc != 0 && useLastMoment) {
        cmdLine =
            L"\"" + ffmpegW + L"\""
            L" -y -hide_banner -loglevel error"
            L" -i \"" + inW + L"\""
            L" -frames:v 1 -q:v 3 "
            L" \"" + outW + L"\"";
        rc = runProcessAndWaitWin_(cmdLine);
    }

    if (rc != 0 || !fs::exists(jpgPath, ec) || ec) {
        if (outErr) {
            *outErr =
                "ffmpeg boundary frame extract failed rc=" + std::to_string(rc) +
                " src=" + srcMp4Path.string();
        }
        return false;
    }

    outFrame = cv::imread(jpgPath.string(), cv::IMREAD_COLOR);
    std::error_code rmEc;
    fs::remove(jpgPath, rmEc);
    if (outFrame.empty()) {
        if (outErr) *outErr = "cv::imread failed for extracted frame";
        return false;
    }

    return true;
}

static bool transcodeToWebMp4_(
    const std::filesystem::path& srcMp4Path,
    const std::filesystem::path& dstMp4Path,
    std::string* outErr = nullptr
) {
    namespace fs = std::filesystem;

    std::error_code ec;
    if (!fs::exists(srcMp4Path, ec) || ec) {
        if (outErr) *outErr = "src does not exist: " + srcMp4Path.string();
        return false;
    }

    // Ensure destination folder exists
    fs::create_directories(dstMp4Path.parent_path(), ec);
    if (ec) {
        if (outErr) *outErr = "create_directories failed: " + ec.message();
        return false;
    }

    // ffmpeg.exe located next to the Perceptrum executable (same pattern you use already)
    fs::path ffmpegPath = fs::path(getExecutableDir_()) / "ffmpeg.exe";
    if (!fs::exists(ffmpegPath, ec) || ec) {
        // Fallback: copy as-is (may be unplayable if H265)
        std::error_code copyEc;
        fs::copy_file(srcMp4Path, dstMp4Path, fs::copy_options::overwrite_existing, copyEc);
        if (copyEc) {
            if (outErr) *outErr = "ffmpeg missing and copy failed: " + copyEc.message();
            return false;
        }
        return true;
    }

    std::wstring ffmpegW = utf8ToWide(ffmpegPath.string());
    std::wstring inW = utf8ToWide(srcMp4Path.string());
    std::wstring outW = utf8ToWide(dstMp4Path.string());

    // Browser-friendly: H.264 + yuv420p + faststart
    // -an drops audio; remove -an if you want to keep it.
    std::wstring cmdLine =
        L"\"" + ffmpegW + L"\""
        L" -y -hide_banner -loglevel error"
        L" -i \"" + inW + L"\""
        L" -c:v libx264 -pix_fmt yuv420p -movflags +faststart"
        L" -an "
        L" \"" + outW + L"\"";

    // ? Use whatever runner you already use for ffmpeg commands
    // If you have something like runCommand(cmdLine) returning exit code, use it here.
    int rc = runProcessAndWaitWin_(cmdLine); // <-- replace with your actual function name

    if (rc != 0) {
        if (outErr) *outErr = "ffmpeg transcode failed rc=" + std::to_string(rc);

        // Fallback to copy, so UI at least has something (even if not playable)
        std::error_code copyEc;
        fs::copy_file(srcMp4Path, dstMp4Path, fs::copy_options::overwrite_existing, copyEc);
        return !copyEc;
    }

    // sanity check output exists
    if (!fs::exists(dstMp4Path, ec) || ec) {
        if (outErr) *outErr = "output missing after ffmpeg: " + dstMp4Path.string();
        return false;
    }

    return true;
}

static bool sampleMp4ToTargetFps_(
    const std::filesystem::path& srcMp4Path,
    const std::filesystem::path& dstMp4Path,
    int targetFps,
    std::string* outErr = nullptr
) {
    namespace fs = std::filesystem;
    targetFps = clampModelInputFps_(targetFps);

    std::error_code ec;
    if (!fs::exists(srcMp4Path, ec) || ec) {
        if (outErr) *outErr = "src does not exist: " + srcMp4Path.string();
        return false;
    }

    fs::create_directories(dstMp4Path.parent_path(), ec);
    if (ec) {
        if (outErr) *outErr = "create_directories failed: " + ec.message();
        return false;
    }

    fs::path ffmpegPath = fs::path(getExecutableDir_()) / "ffmpeg.exe";
    if (!fs::exists(ffmpegPath, ec) || ec) {
        if (outErr) *outErr = "ffmpeg missing: " + ffmpegPath.string();
        return false;
    }

    std::wstring ffmpegW = utf8ToWide(ffmpegPath.string());
    std::wstring inW = utf8ToWide(srcMp4Path.string());
    std::wstring outW = utf8ToWide(dstMp4Path.string());

    std::wstring cmdLine =
        L"\"" + ffmpegW + L"\""
        L" -y -hide_banner -loglevel error"
        L" -i \"" + inW + L"\""
        L" -vf fps=" + std::to_wstring(targetFps) +
        L" -c:v libx264 -pix_fmt yuv420p -movflags +faststart"
        L" -an "
        L" \"" + outW + L"\"";

    const int rc = runProcessAndWaitWin_(cmdLine);
    if (rc != 0) {
        if (outErr) *outErr = "ffmpeg fps sample failed rc=" + std::to_string(rc);
        return false;
    }

    if (!fs::exists(dstMp4Path, ec) || ec) {
        if (outErr) *outErr = "sampled output missing: " + dstMp4Path.string();
        return false;
    }

    return true;
}

struct VideoClipSpan_ {
    fs::path path;
    std::chrono::system_clock::time_point startTp;
    std::chrono::system_clock::time_point endTp;
    int nominalSeconds = 0;
    double contentDurationSeconds = 0.0;
};

struct VideoClipSlice_ {
    fs::path srcPath;
    double offsetSeconds = 0.0;
    double durationSeconds = 0.0;
};

static bool parseLocalClipTimePoint_(
    const std::string& yyyymmdd,
    const std::string& hhmmss,
    std::chrono::system_clock::time_point& outTp)
{
    if (yyyymmdd.size() != 8 || hhmmss.size() != 6) return false;
    auto isDigits = [](const std::string& s) {
        return std::all_of(s.begin(), s.end(), [](unsigned char c) { return std::isdigit(c) != 0; });
    };
    if (!isDigits(yyyymmdd) || !isDigits(hhmmss)) return false;

    std::tm tmLocal{};
    tmLocal.tm_year = std::stoi(yyyymmdd.substr(0, 4)) - 1900;
    tmLocal.tm_mon = std::stoi(yyyymmdd.substr(4, 2)) - 1;
    tmLocal.tm_mday = std::stoi(yyyymmdd.substr(6, 2));
    tmLocal.tm_hour = std::stoi(hhmmss.substr(0, 2));
    tmLocal.tm_min = std::stoi(hhmmss.substr(2, 2));
    tmLocal.tm_sec = std::stoi(hhmmss.substr(4, 2));
    tmLocal.tm_isdst = -1;

    std::time_t tt = std::mktime(&tmLocal);
    if (tt < 0) return false;
    outTp = std::chrono::system_clock::from_time_t(tt);
    return true;
}

static bool parseCompactLocalClipTimePoint_(
    const std::string& compactTs,
    std::chrono::system_clock::time_point& outTp)
{
    if (compactTs.size() != 15 || compactTs[8] != '_') return false;
    return parseLocalClipTimePoint_(
        compactTs.substr(0, 8),
        compactTs.substr(9, 6),
        outTp
    );
}

static int deriveActualWindowSecondsFromCompactClipRange_(
    const std::string& startCompact,
    const std::string& endCompact,
    int fallbackSeconds)
{
    std::chrono::system_clock::time_point startTp;
    std::chrono::system_clock::time_point endTp;
    if (!parseCompactLocalClipTimePoint_(startCompact, startTp) ||
        !parseCompactLocalClipTimePoint_(endCompact, endTp) ||
        endTp <= startTp)
    {
        return fallbackSeconds > 0 ? fallbackSeconds : 0;
    }

    const auto diffSeconds =
        std::chrono::duration_cast<std::chrono::seconds>(endTp - startTp).count();
    return diffSeconds > 0
        ? static_cast<int>(diffSeconds)
        : (fallbackSeconds > 0 ? fallbackSeconds : 0);
}

static std::string formatPrettyLocalTimePoint_(
    const std::chrono::system_clock::time_point& tp)
{
    const std::time_t tt = std::chrono::system_clock::to_time_t(tp);
    std::tm tmLocal{};
#ifdef _WIN32
    localtime_s(&tmLocal, &tt);
#else
    localtime_r(&tt, &tmLocal);
#endif
    char buf[32];
    std::snprintf(
        buf,
        sizeof(buf),
        "%02d/%02d/%04d %02d:%02d:%02d",
        tmLocal.tm_mday,
        tmLocal.tm_mon + 1,
        tmLocal.tm_year + 1900,
        tmLocal.tm_hour,
        tmLocal.tm_min,
        tmLocal.tm_sec
    );
    return std::string(buf);
}

static bool parseClipSpanFromPath_(
    const fs::path& clipPath,
    int expectedCameraId,
    VideoClipSpan_& outSpan)
{
    std::string fileName = clipPath.filename().string();
    const std::string processingSuffix = ".processing";
    if (fileName.size() > processingSuffix.size() &&
        fileName.rfind(processingSuffix) == fileName.size() - processingSuffix.size())
    {
        fileName = fileName.substr(0, fileName.size() - processingSuffix.size());
    }

    fs::path normalizedName(fileName);
    if (normalizedName.extension() != ".mp4") return false;
    std::string stem = normalizedName.stem().string();

    std::vector<std::string> tokens;
    {
        std::stringstream ss(stem);
        std::string tok;
        while (std::getline(ss, tok, '_')) tokens.push_back(tok);
    }
    if (tokens.size() < 6) return false;

    int cameraId = -1;
    try {
        cameraId = std::stoi(tokens[0]);
    }
    catch (...) {
        return false;
    }
    if (cameraId != expectedCameraId) return false;

    const std::string& startDate = tokens[1];
    const std::string& startTime = tokens[2];
    const std::string& endDate = tokens[3];
    const std::string& endTime = tokens[4];

    auto parseDurationToken = [](std::string value) -> int {
        if (!value.empty() && (value.back() == 's' || value.back() == 'S')) {
            value.pop_back();
        }
        if (value.empty()) return 0;
        if (!std::all_of(value.begin(), value.end(), [](unsigned char c) { return std::isdigit(c) != 0; })) {
            return 0;
        }
        try {
            return std::stoi(value);
        }
        catch (...) {
            return 0;
        }
    };
    const int nominalSeconds = parseDurationToken(tokens.back());

    std::chrono::system_clock::time_point startTp;
    std::chrono::system_clock::time_point endTp;
    if (!parseLocalClipTimePoint_(startDate, startTime, startTp)) return false;
    if (!parseLocalClipTimePoint_(endDate, endTime, endTp)) return false;

    if (endTp <= startTp) {
        endTp = startTp + std::chrono::seconds(nominalSeconds > 0 ? nominalSeconds : 10);
    }

    const double tsDurationSeconds =
        std::chrono::duration_cast<std::chrono::milliseconds>(endTp - startTp).count() / 1000.0;
    double contentDurationSeconds = tsDurationSeconds;
    if (contentDurationSeconds <= 0.0) {
        contentDurationSeconds = nominalSeconds > 0
            ? static_cast<double>(nominalSeconds)
            : 1.0;
    }

    outSpan.path = clipPath;
    outSpan.startTp = startTp;
    outSpan.endTp = endTp;
    outSpan.nominalSeconds = nominalSeconds > 0
        ? nominalSeconds
        : static_cast<int>(std::chrono::duration_cast<std::chrono::seconds>(endTp - startTp).count());
    outSpan.contentDurationSeconds = contentDurationSeconds;
    return true;
}

static void appendClipCandidatesFromDirectory_(
    const fs::path& dir,
    int expectedCameraId,
    std::unordered_set<std::string>& seenPaths,
    std::vector<VideoClipSpan_>& out)
{
    std::error_code ec;
    if (!fs::exists(dir, ec) || ec) return;
    if (!fs::is_directory(dir, ec) || ec) return;

    for (const auto& entry : fs::directory_iterator(dir, ec)) {
        if (ec) break;
        if (!entry.is_regular_file()) continue;

        VideoClipSpan_ span;
        if (!parseClipSpanFromPath_(entry.path(), expectedCameraId, span)) continue;

        std::string key;
        std::error_code canonicalEc;
        key = fs::weakly_canonical(span.path, canonicalEc).string();
        if (canonicalEc) key = span.path.lexically_normal().string();
        if (!seenPaths.insert(key).second) continue;

        out.push_back(std::move(span));
    }
}

static std::vector<fs::path> buildRecentCameraDayDirs_(
    const fs::path& baseCameraDir,
    int daysBack)
{
    std::vector<fs::path> out;
    out.reserve(std::max(1, daysBack));

    for (int i = 0; i < std::max(1, daysBack); ++i) {
        std::time_t tt = std::time(nullptr) - static_cast<std::time_t>(i * 24 * 60 * 60);
        std::tm tmLocal{};
#ifdef _WIN32
        localtime_s(&tmLocal, &tt);
#else
        localtime_r(&tt, &tmLocal);
#endif

        char y[5], m[3], d[3];
        std::snprintf(y, sizeof(y), "%04d", tmLocal.tm_year + 1900);
        std::snprintf(m, sizeof(m), "%02d", tmLocal.tm_mon + 1);
        std::snprintf(d, sizeof(d), "%02d", tmLocal.tm_mday);
        out.push_back(baseCameraDir / y / m / d);
    }
    return out;
}

static std::vector<VideoClipSpan_> collectVideoWindowCandidates_(
    int jobId,
    int stepId,
    int cameraId)
{
    std::vector<VideoClipSpan_> out;
    std::unordered_set<std::string> seenPaths;
    const std::string camId = std::to_string(cameraId);

    appendClipCandidatesFromDirectory_(
        getJobsTempDirForJobStepCamera(jobId, stepId, camId),
        cameraId,
        seenPaths,
        out
    );
    appendClipCandidatesFromDirectory_(
        getJobsTempDirForJobCamera(jobId, camId),
        cameraId,
        seenPaths,
        out
    );

    for (const fs::path& dayDir : buildRecentCameraDayDirs_(fs::path("frames") / ("cam_" + camId), 2)) {
        appendClipCandidatesFromDirectory_(dayDir, cameraId, seenPaths, out);
    }

    std::sort(out.begin(), out.end(), [](const VideoClipSpan_& a, const VideoClipSpan_& b) {
        if (a.endTp != b.endTp) return a.endTp < b.endTp;
        if (a.startTp != b.startTp) return a.startTp < b.startTp;
        return a.path.string() < b.path.string();
    });

    return out;
}

static bool buildWindowSlices_(
    const std::vector<VideoClipSpan_>& candidates,
    const std::chrono::system_clock::time_point& windowStart,
    const std::chrono::system_clock::time_point& windowEnd,
    std::vector<VideoClipSlice_>& outSlices,
    std::string* outErr = nullptr)
{
    outSlices.clear();
    if (windowEnd <= windowStart) {
        if (outErr) *outErr = "invalid window";
        return false;
    }

    std::vector<const VideoClipSpan_*> active;
    active.reserve(candidates.size());
    for (const auto& c : candidates) {
        if (c.endTp <= windowStart) continue;
        if (c.startTp >= windowEnd) continue;
        active.push_back(&c);
    }
    if (active.empty()) {
        if (outErr) *outErr = "no clips overlap requested window";
        return false;
    }

    const auto tol = std::chrono::seconds(1);
    auto remainingEnd = windowEnd;
    std::vector<VideoClipSlice_> revSlices;
    int guard = 0;

    while (remainingEnd > windowStart + std::chrono::milliseconds(250) && guard++ < 64) {
        const VideoClipSpan_* best = nullptr;
        for (const auto* c : active) {
            if (c->startTp >= remainingEnd) continue;
            if (c->endTp + tol < remainingEnd) continue;
            if (c->endTp <= windowStart) continue;
            if (!best ||
                c->startTp < best->startTp ||
                (c->startTp == best->startTp && c->endTp > best->endTp))
            {
                best = c;
            }
        }

        if (!best) {
            if (outErr) *outErr = "cannot cover requested window with available clips";
            return false;
        }

        const auto segStartTp = std::max(windowStart, best->startTp);
        const auto segEndTp = std::min(remainingEnd, best->endTp);
        if (segEndTp <= segStartTp) {
            if (outErr) *outErr = "invalid segment range during assembly";
            return false;
        }

        VideoClipSlice_ slice;
        slice.srcPath = best->path;
        slice.offsetSeconds =
            std::chrono::duration_cast<std::chrono::milliseconds>(segStartTp - best->startTp).count() / 1000.0;
        slice.durationSeconds =
            std::chrono::duration_cast<std::chrono::milliseconds>(segEndTp - segStartTp).count() / 1000.0;
        if (slice.durationSeconds <= 0.0) {
            if (outErr) *outErr = "non-positive segment duration";
            return false;
        }

        revSlices.push_back(std::move(slice));
        remainingEnd = segStartTp;
    }

    if (remainingEnd > windowStart + std::chrono::seconds(1)) {
        if (outErr) *outErr = "assembled range does not fully cover requested window";
        return false;
    }

    outSlices.assign(revSlices.rbegin(), revSlices.rend());
    return !outSlices.empty();
}

static bool buildBestEffortWindowSlices_(
    const std::vector<VideoClipSpan_>& candidates,
    const std::chrono::system_clock::time_point& requestedWindowStart,
    const std::chrono::system_clock::time_point& requestedWindowEnd,
    std::vector<VideoClipSlice_>& outSlices,
    std::chrono::system_clock::time_point& outActualStart,
    std::chrono::system_clock::time_point& outActualEnd,
    std::string* outErr = nullptr)
{
    outSlices.clear();
    outActualStart = requestedWindowStart;
    outActualEnd = requestedWindowEnd;

    if (requestedWindowEnd <= requestedWindowStart) {
        if (outErr) *outErr = "invalid window";
        return false;
    }

    std::vector<const VideoClipSpan_*> active;
    active.reserve(candidates.size());
    for (const auto& c : candidates) {
        if (c.endTp <= requestedWindowStart) continue;
        if (c.startTp >= requestedWindowEnd) continue;
        active.push_back(&c);
    }
    if (active.empty()) {
        if (outErr) *outErr = "no clips overlap requested window";
        return false;
    }

    const auto tol = std::chrono::seconds(1);
    bool foundEnd = false;
    for (const auto* c : active) {
        const auto candidateEnd = std::min(requestedWindowEnd, c->endTp);
        if (candidateEnd <= requestedWindowStart) continue;
        if (!foundEnd || candidateEnd > outActualEnd) {
            outActualEnd = candidateEnd;
            foundEnd = true;
        }
    }
    if (!foundEnd || outActualEnd <= requestedWindowStart + std::chrono::milliseconds(250)) {
        if (outErr) *outErr = "no usable clip end inside requested window";
        return false;
    }

    auto remainingEnd = outActualEnd;
    std::vector<VideoClipSlice_> revSlices;
    int guard = 0;

    while (remainingEnd > requestedWindowStart + std::chrono::milliseconds(250) && guard++ < 64) {
        const VideoClipSpan_* best = nullptr;
        for (const auto* c : active) {
            if (c->startTp >= remainingEnd) continue;
            if (c->endTp + tol < remainingEnd) continue;
            if (c->endTp <= requestedWindowStart) continue;
            if (!best ||
                c->startTp < best->startTp ||
                (c->startTp == best->startTp && c->endTp > best->endTp))
            {
                best = c;
            }
        }

        if (!best) {
            break;
        }

        const auto segStartTp = std::max(requestedWindowStart, best->startTp);
        const auto segEndTp = std::min(remainingEnd, best->endTp);
        if (segEndTp <= segStartTp) {
            if (outErr) *outErr = "invalid segment range during best-effort assembly";
            return false;
        }

        VideoClipSlice_ slice;
        slice.srcPath = best->path;
        slice.offsetSeconds =
            std::chrono::duration_cast<std::chrono::milliseconds>(segStartTp - best->startTp).count() / 1000.0;
        slice.durationSeconds =
            std::chrono::duration_cast<std::chrono::milliseconds>(segEndTp - segStartTp).count() / 1000.0;
        if (slice.durationSeconds <= 0.0) {
            if (outErr) *outErr = "non-positive segment duration";
            return false;
        }

        revSlices.push_back(std::move(slice));
        remainingEnd = segStartTp;
    }

    if (revSlices.empty()) {
        if (outErr) *outErr = "no continuous clips could be assembled";
        return false;
    }

    outActualStart = remainingEnd;
    if (outActualEnd <= outActualStart + std::chrono::milliseconds(250)) {
        if (outErr) *outErr = "assembled best-effort range is empty";
        return false;
    }

    outSlices.assign(revSlices.rbegin(), revSlices.rend());
    return !outSlices.empty();
}

static bool buildRecentBackfillSlices_(
    const std::vector<VideoClipSpan_>& candidates,
    int runEverySeconds,
    std::vector<VideoClipSlice_>& outSlices,
    std::string* outErr = nullptr)
{
    outSlices.clear();
    if (runEverySeconds <= 0) {
        if (outErr) *outErr = "invalid runEverySeconds";
        return false;
    }
    if (candidates.empty()) {
        if (outErr) *outErr = "no clip candidates found";
        return false;
    }

    double remainingSeconds = static_cast<double>(runEverySeconds);
    std::vector<VideoClipSlice_> revSlices;
    revSlices.reserve(candidates.size());

    for (auto it = candidates.rbegin(); it != candidates.rend() && remainingSeconds > 0.001; ++it) {
        const auto& clip = *it;

        double clipSeconds = clip.contentDurationSeconds;
        if (clipSeconds <= 0.0) {
            clipSeconds = std::chrono::duration_cast<std::chrono::milliseconds>(clip.endTp - clip.startTp).count() / 1000.0;
        }
        if (clipSeconds <= 0.0) {
            continue;
        }

        const double takeSeconds = (std::min)(remainingSeconds, clipSeconds);
        VideoClipSlice_ slice;
        slice.srcPath = clip.path;
        slice.offsetSeconds = (std::max)(0.0, clipSeconds - takeSeconds);
        slice.durationSeconds = takeSeconds;
        if (slice.durationSeconds <= 0.0) {
            continue;
        }

        revSlices.push_back(std::move(slice));
        remainingSeconds -= takeSeconds;
    }

    if (remainingSeconds > 0.250) {
        if (outErr) {
            std::ostringstream oss;
            oss << "insufficient clip content for requested window, missing "
                << std::fixed << std::setprecision(3) << remainingSeconds << "s";
            *outErr = oss.str();
        }
        return false;
    }

    outSlices.assign(revSlices.rbegin(), revSlices.rend());
    return !outSlices.empty();
}

static std::string ffmpegSecondsString_(double seconds)
{
    std::ostringstream oss;
    oss.setf(std::ios::fixed);
    oss.precision(3);
    if (seconds < 0.0) seconds = 0.0;
    oss << seconds;
    return oss.str();
}

static fs::path makeVideoWindowTempPath_(
    int jobId,
    int stepId,
    int cameraId,
    const std::string& prefix,
    const std::string& suffix = ".mp4")
{
    static std::atomic<unsigned long long> counter{ 0 };
    const auto idx = counter.fetch_add(1, std::memory_order_relaxed);
    fs::path base = getJobsTempDirForJobStepCamera(jobId, stepId, std::to_string(cameraId));
    std::error_code ec;
    fs::create_directories(base, ec);
    std::ostringstream name;
    name << prefix << "_" << nowMs_() << "_" << idx << suffix;
    return base / name.str();
}

static bool cutMp4SegmentWithFfmpeg_(
    const fs::path& srcPath,
    const fs::path& dstPath,
    double offsetSeconds,
    double durationSeconds,
    std::string* outErr = nullptr)
{
    std::error_code ec;
    if (!fs::exists(srcPath, ec) || ec) {
        if (outErr) *outErr = "segment source missing: " + srcPath.string();
        return false;
    }

    fs::path ffmpegPath = fs::path(getExecutableDir_()) / "ffmpeg.exe";
    if (!fs::exists(ffmpegPath, ec) || ec) {
        if (outErr) *outErr = "ffmpeg missing: " + ffmpegPath.string();
        return false;
    }

    fs::create_directories(dstPath.parent_path(), ec);
    if (ec) {
        if (outErr) *outErr = "create_directories failed: " + ec.message();
        return false;
    }

    std::wstring ffmpegW = utf8ToWide(ffmpegPath.string());
    std::wstring srcW = utf8ToWide(srcPath.string());
    std::wstring dstW = utf8ToWide(dstPath.string());
    std::wstring offsetW = utf8ToWide(ffmpegSecondsString_(offsetSeconds));
    std::wstring durationW = utf8ToWide(ffmpegSecondsString_(durationSeconds));

    std::wstring cmdLine =
        L"\"" + ffmpegW + L"\""
        L" -y -hide_banner -loglevel error"
        L" -ss " + offsetW +
        L" -t " + durationW +
        L" -i \"" + srcW + L"\""
        L" -c:v libx264 -pix_fmt yuv420p -movflags +faststart"
        L" -an "
        L" \"" + dstW + L"\"";

    const int rc = runProcessAndWaitWin_(cmdLine);
    if (rc != 0) {
        if (outErr) *outErr = "ffmpeg clip trim failed rc=" + std::to_string(rc);
        return false;
    }

    if (!fs::exists(dstPath, ec) || ec) {
        if (outErr) *outErr = "trimmed segment missing: " + dstPath.string();
        return false;
    }
    return true;
}

static bool concatMp4SegmentsWithFfmpeg_(
    const std::vector<fs::path>& segments,
    const fs::path& outPath,
    std::string* outErr = nullptr)
{
    if (segments.empty()) {
        if (outErr) *outErr = "no segments to concat";
        return false;
    }

    std::error_code ec;
    fs::path ffmpegPath = fs::path(getExecutableDir_()) / "ffmpeg.exe";
    if (!fs::exists(ffmpegPath, ec) || ec) {
        if (outErr) *outErr = "ffmpeg missing: " + ffmpegPath.string();
        return false;
    }

    fs::create_directories(outPath.parent_path(), ec);
    if (ec) {
        if (outErr) *outErr = "create_directories failed: " + ec.message();
        return false;
    }

    fs::path listPath = makeVideoWindowTempPath_(
        -1,
        -1,
        0,
        "window_concat_list",
        ".txt"
    );
    listPath = outPath.parent_path() / listPath.filename();

    {
        std::ofstream ofs(listPath, std::ios::trunc);
        if (!ofs.is_open()) {
            if (outErr) *outErr = "failed opening concat list file";
            return false;
        }
        for (const auto& seg : segments) {
            std::string normalized = fs::absolute(seg).string();
            std::replace(normalized.begin(), normalized.end(), '\\', '/');
            ofs << "file '" << normalized << "'\n";
        }
    }

    std::wstring ffmpegW = utf8ToWide(ffmpegPath.string());
    std::wstring listW = utf8ToWide(listPath.string());
    std::wstring outW = utf8ToWide(outPath.string());

    std::wstring cmdLine =
        L"\"" + ffmpegW + L"\""
        L" -y -hide_banner -loglevel error"
        L" -safe 0 -f concat -i \"" + listW + L"\""
        L" -c:v libx264 -pix_fmt yuv420p -movflags +faststart"
        L" -an "
        L" \"" + outW + L"\"";

    const int rc = runProcessAndWaitWin_(cmdLine);
    std::error_code rmEc;
    fs::remove(listPath, rmEc);

    if (rc != 0) {
        if (outErr) *outErr = "ffmpeg concat failed rc=" + std::to_string(rc);
        return false;
    }

    if (!fs::exists(outPath, ec) || ec) {
        if (outErr) *outErr = "concat output missing: " + outPath.string();
        return false;
    }
    return true;
}

struct PendingJobClip_ {
    fs::path path;
    std::string clipKey;
    std::string startCompact;
    std::string endCompact;
    std::string startPretty;
    std::string endPretty;
    std::string startUtcIso;
    std::string endUtcIso;
    fs::file_time_type lastWrite{};
};

static std::vector<PendingJobClip_> collectPendingJobsClipsForCamera_(
    int jobId,
    int stepId,
    int cameraId,
    const std::string& coverageCutoffUtcIso = std::string())
{
    std::vector<PendingJobClip_> pending;
    try {
        const fs::path dir =
            getJobsTempDirForJobStepCamera(jobId, stepId, std::to_string(cameraId));

        std::error_code ec;
        if (!fs::exists(dir, ec) || !fs::is_directory(dir, ec)) {
            return pending;
        }

        const std::string lastConsumedKey =
            getLastConsumedClipKeyForJobStepCamera_(jobId, stepId, cameraId);
        const bool hasCursor = !lastConsumedKey.empty();

        for (const auto& entry : fs::directory_iterator(dir, ec)) {
            if (ec) break;
            if (!entry.is_regular_file(ec)) {
                if (ec) break;
                continue;
            }
            if (entry.path().extension() != ".mp4") continue;

            PendingJobClip_ clip;
            clip.path = entry.path();
            clip.clipKey = makeMonotonicClipKey_(entry.path());
            if (clip.clipKey.empty()) continue;
            if (hasCursor && clip.clipKey <= lastConsumedKey) {
                continue;
            }

            {
                std::string base = entry.path().stem().string();
                std::vector<std::string> tokens;
                std::stringstream ss(base);
                std::string token;
                while (std::getline(ss, token, '_')) {
                    tokens.push_back(token);
                }
                if (tokens.size() >= 5) {
                    clip.startCompact = tokens[1] + "_" + tokens[2];
                    clip.endCompact = tokens[3] + "_" + tokens[4];
                }
            }

            int parsedCameraId = -1;
            if (!parseJobClipFilename(
                    entry.path().filename().string(),
                    parsedCameraId,
                    clip.startPretty,
                    clip.endPretty) ||
                parsedCameraId != cameraId)
            {
                continue;
            }
            (void)parseClipRangeUtcIsoFromPath_(entry.path(), clip.startUtcIso, clip.endUtcIso);
            if (!clipStartsBeforeCoverageCutoff_(entry.path(), coverageCutoffUtcIso)) {
                continue;
            }

            clip.lastWrite = entry.last_write_time(ec);
            if (ec) break;
            pending.push_back(std::move(clip));
        }

        if (ec) {
            pending.clear();
            return pending;
        }

        std::sort(pending.begin(), pending.end(), [](const PendingJobClip_& a, const PendingJobClip_& b) {
            if (a.clipKey != b.clipKey) return a.clipKey < b.clipKey;
            if (a.lastWrite != b.lastWrite) return a.lastWrite < b.lastWrite;
            return a.path.string() < b.path.string();
        });
    }
    catch (...) {
        pending.clear();
    }
    return pending;
}

static int chooseAdaptivePendingJobClipCount_(const std::vector<PendingJobClip_>& pending)
{
    if (pending.empty()) return 0;

    long long oldestAgeSeconds = 0;
    const auto nowFileClock = fs::file_time_type::clock::now();
    if (pending.front().lastWrite <= nowFileClock) {
        oldestAgeSeconds = std::chrono::duration_cast<std::chrono::seconds>(
            nowFileClock - pending.front().lastWrite
        ).count();
    }

    if (pending.size() >= 3 || oldestAgeSeconds >= 25) return 3;
    if (pending.size() >= 2 || oldestAgeSeconds >= 15) return 2;
    return 1;
}

static VideoWindowAssemblyResult claimSinglePendingJobsClip_(
    int jobId,
    int stepId,
    int cameraId,
    const PendingJobClip_& clip)
{
    VideoWindowAssemblyResult result;
    result.status = VideoWindowAssemblyStatus::Failed;

    try {
        result.status = VideoWindowAssemblyStatus::Assembled;
        result.clipPath = clip.path.string();
        result.consumedClipKey = clip.clipKey;
        result.windowStartPretty = clip.startPretty;
        result.windowEndPretty = clip.endPretty;
        result.windowStartUtc = clip.startUtcIso;
        result.windowEndUtc = clip.endUtcIso;
        result.windowSeconds = deriveActualWindowSecondsFromCompactClipRange_(
            clip.startCompact,
            clip.endCompact,
            10
        );
        return result;
    }
    catch (...) {
        result.error = "exception while claiming pending clip";
        return result;
    }
}

static VideoWindowAssemblyResult assembleAdaptivePendingJobsWindow_(
    int jobId,
    int stepId,
    int cameraId,
    const std::string& coverageCutoffUtcIso)
{
    VideoWindowAssemblyResult result;
    result.status = VideoWindowAssemblyStatus::Failed;

    const std::vector<PendingJobClip_> pending =
        collectPendingJobsClipsForCamera_(jobId, stepId, cameraId, coverageCutoffUtcIso);
    if (pending.empty()) {
        result.status = VideoWindowAssemblyStatus::NoNewWindow;
        result.error = "no clip available yet";
        return result;
    }

    const int clipCount = (std::min)(
        chooseAdaptivePendingJobClipCount_(pending),
        static_cast<int>(pending.size())
    );
    if (clipCount <= 1) {
        return claimSinglePendingJobsClip_(jobId, stepId, cameraId, pending.front());
    }

    std::vector<fs::path> segmentPaths;
    segmentPaths.reserve(static_cast<size_t>(clipCount));
    for (int i = 0; i < clipCount; ++i) {
        segmentPaths.push_back(pending[static_cast<size_t>(i)].path);
    }

    const PendingJobClip_& first = pending.front();
    const PendingJobClip_& last = pending[static_cast<size_t>(clipCount - 1)];
    const int windowSeconds = deriveActualWindowSecondsFromCompactClipRange_(
        first.startCompact,
        last.endCompact,
        clipCount * 10
    );
    if (first.startCompact.size() != 15 || last.endCompact.size() != 15) {
        return claimSinglePendingJobsClip_(jobId, stepId, cameraId, pending.front());
    }

    fs::path assembledPath =
        getJobsTempDirForJobStepCamera(jobId, stepId, std::to_string(cameraId)) /
        (std::to_string(cameraId) + "_" +
         first.startCompact.substr(0, 8) + "_" + first.startCompact.substr(9, 6) + "_" +
         last.endCompact.substr(0, 8) + "_" + last.endCompact.substr(9, 6) + "_" +
         std::to_string(windowSeconds) + "s.adaptive.mp4");
    std::string concatErr;
    if (!concatMp4SegmentsWithFfmpeg_(segmentPaths, assembledPath, &concatErr)) {
        Logger::instance().logDebug(
            "job",
            "assembleAdaptivePendingJobsWindow_: concat failed, falling back to single clip. err=" + concatErr
        );
        return claimSinglePendingJobsClip_(jobId, stepId, cameraId, pending.front());
    }

    result.status = VideoWindowAssemblyStatus::Assembled;
    result.clipPath = assembledPath.string();
    result.cleanupPaths.push_back(assembledPath.string());
    result.consumedClipKey = last.clipKey;
    result.windowStartPretty = first.startPretty;
    result.windowEndPretty = last.endPretty;
    result.windowStartUtc = first.startUtcIso;
    result.windowEndUtc = last.endUtcIso;
    result.windowSeconds = windowSeconds;
    return result;
}

static std::mutex gProcessedVideoWindowMu_;
static std::unordered_map<std::string, long long> gLastProcessedVideoWindowEndBySlot_;

static bool isNewVideoWindowEndForSlot_(
    int jobId,
    int stepId,
    int cameraId,
    int runEverySeconds,
    const std::chrono::system_clock::time_point& windowEnd)
{
    const std::string slot =
        std::to_string(jobId) + "|" +
        std::to_string(stepId) + "|" +
        std::to_string(cameraId) + "|video|" +
        std::to_string(runEverySeconds);

    const long long endSec = std::chrono::duration_cast<std::chrono::seconds>(
        windowEnd.time_since_epoch()
    ).count();

    std::lock_guard<std::mutex> lk(gProcessedVideoWindowMu_);
    if (gLastProcessedVideoWindowEndBySlot_.size() > 50000) {
        gLastProcessedVideoWindowEndBySlot_.clear();
    }
    auto it = gLastProcessedVideoWindowEndBySlot_.find(slot);
    if (it != gLastProcessedVideoWindowEndBySlot_.end() && endSec <= it->second) {
        return false;
    }
    return true;
}

static void markVideoWindowEndProcessedForSlot_(
    int jobId,
    int stepId,
    int cameraId,
    int runEverySeconds,
    const std::chrono::system_clock::time_point& windowEnd)
{
    static std::mutex mu;
    static std::unordered_map<std::string, long long> lastEndBySlot;

    const std::string slot =
        std::to_string(jobId) + "|" +
        std::to_string(stepId) + "|" +
        std::to_string(cameraId) + "|video|" +
        std::to_string(runEverySeconds);

    const long long endSec = std::chrono::duration_cast<std::chrono::seconds>(
        windowEnd.time_since_epoch()
    ).count();

    std::lock_guard<std::mutex> lk(gProcessedVideoWindowMu_);
    if (gLastProcessedVideoWindowEndBySlot_.size() > 50000) {
        gLastProcessedVideoWindowEndBySlot_.clear();
    }
    auto it = gLastProcessedVideoWindowEndBySlot_.find(slot);
    if (it == gLastProcessedVideoWindowEndBySlot_.end() || endSec > it->second) {
        gLastProcessedVideoWindowEndBySlot_[slot] = endSec;
    }
}

void JobRuntime::clearJobEphemeralState_(int jobId) {
    if (jobId < 0) return;

    const std::string scopedPrefix = "job:" + std::to_string(jobId) + "|";

    size_t clearedTemporalSlots = 0;
    size_t clearedTemporalEvidenceTrails = 0;
    {
        std::lock_guard<std::mutex> lock(temporalMu_);
        for (auto it = temporalBySlot_.begin(); it != temporalBySlot_.end();) {
            if (it->first.rfind(scopedPrefix, 0) == 0) {
                it = temporalBySlot_.erase(it);
                ++clearedTemporalSlots;
            }
            else {
                ++it;
            }
        }
        for (auto it = temporalEvidenceBySlot_.begin(); it != temporalEvidenceBySlot_.end();) {
            if (it->first.rfind(scopedPrefix, 0) == 0) {
                it = temporalEvidenceBySlot_.erase(it);
                ++clearedTemporalEvidenceTrails;
            }
            else {
                ++it;
            }
        }
    }

    size_t clearedCrossCameraSteps = 0;
    {
        std::lock_guard<std::mutex> lock(crossCameraHuntsMu_);
        for (auto it = crossCameraHuntsByStep_.begin(); it != crossCameraHuntsByStep_.end();) {
            if (it->first.rfind(scopedPrefix, 0) == 0) {
                it = crossCameraHuntsByStep_.erase(it);
                ++clearedCrossCameraSteps;
            }
            else {
                ++it;
            }
        }
    }

    if (clearedTemporalSlots > 0 ||
        clearedTemporalEvidenceTrails > 0 ||
        clearedCrossCameraSteps > 0)
    {
        Logger::instance().logDebug(
            "job",
            "clearJobEphemeralState_: job_id=" + std::to_string(jobId) +
            " temporal_slots=" + std::to_string(clearedTemporalSlots) +
            " temporal_evidence_trails=" + std::to_string(clearedTemporalEvidenceTrails) +
            " cross_camera_steps=" + std::to_string(clearedCrossCameraSteps)
        );
    }
}

static VideoWindowAssemblyResult assembleLegacyVideoWindowForRunEvery_(
    int jobId,
    int stepId,
    int cameraId,
    int runEverySeconds)
{
    VideoWindowAssemblyResult result;
    result.status = VideoWindowAssemblyStatus::Failed;

    const std::vector<VideoClipSpan_> candidates =
        collectVideoWindowCandidates_(jobId, stepId, cameraId);
    if (candidates.empty()) {
        result.error = "no clip candidates found";
        return result;
    }

    const auto windowEnd = candidates.back().endTp;
    const auto windowStart = windowEnd - std::chrono::seconds(runEverySeconds);
    if (!isNewVideoWindowEndForSlot_(jobId, stepId, cameraId, runEverySeconds, windowEnd)) {
        result.status = VideoWindowAssemblyStatus::NoNewWindow;
        result.error = "window_end already processed";
        return result;
    }

    std::vector<VideoClipSlice_> slices;
    std::string strictWindowErr;
    if (!buildWindowSlices_(candidates, windowStart, windowEnd, slices, &strictWindowErr)) {
        std::string backfillErr;
        if (!buildRecentBackfillSlices_(candidates, runEverySeconds, slices, &backfillErr)) {
            result.error = strictWindowErr;
            if (!backfillErr.empty()) {
                result.error += "; recency backfill failed: " + backfillErr;
            }
            return result;
        }

        Logger::instance().logDebug(
            "job",
            "assembleLegacyVideoWindowForRunEvery_: strict coverage failed, using recency backfill. strict_reason=" +
            strictWindowErr
        );
    }

    std::vector<fs::path> segmentPaths;
    std::vector<std::string> cleanupPaths;
    segmentPaths.reserve(slices.size());
    cleanupPaths.reserve(slices.size() + 1);

    for (size_t i = 0; i < slices.size(); ++i) {
        const auto& slice = slices[i];
        fs::path segmentPath = makeVideoWindowTempPath_(
            jobId,
            stepId,
            cameraId,
            "window_segment_" + std::to_string(i)
        );
        std::string segErr;
        if (!cutMp4SegmentWithFfmpeg_(slice.srcPath, segmentPath, slice.offsetSeconds, slice.durationSeconds, &segErr)) {
            result.error = "segment cut failed: " + segErr;
            for (const auto& p : cleanupPaths) {
                std::error_code rmEc;
                fs::remove(fs::path(p), rmEc);
            }
            return result;
        }
        segmentPaths.push_back(segmentPath);
        cleanupPaths.push_back(segmentPath.string());
    }

    fs::path assembledPath = makeVideoWindowTempPath_(
        jobId,
        stepId,
        cameraId,
        "window_assembled_" + std::to_string(runEverySeconds) + "s"
    );
    std::string concatErr;
    if (!concatMp4SegmentsWithFfmpeg_(segmentPaths, assembledPath, &concatErr)) {
        result.error = "window concat failed: " + concatErr;
        for (const auto& p : cleanupPaths) {
            std::error_code rmEc;
            fs::remove(fs::path(p), rmEc);
        }
        return result;
    }

    for (const auto& p : cleanupPaths) {
        std::error_code rmEc;
        fs::remove(fs::path(p), rmEc);
    }
    cleanupPaths.clear();
    cleanupPaths.push_back(assembledPath.string());

    markVideoWindowEndProcessedForSlot_(jobId, stepId, cameraId, runEverySeconds, windowEnd);

    result.status = VideoWindowAssemblyStatus::Assembled;
    result.clipPath = assembledPath.string();
    result.cleanupPaths = std::move(cleanupPaths);
    result.windowStartPretty = formatPrettyLocalTimePoint_(windowStart);
    result.windowEndPretty = formatPrettyLocalTimePoint_(windowEnd);
    result.windowSeconds = runEverySeconds;
    result.error.clear();
    return result;
}

static VideoWindowAssemblyResult assemblePortalCounterStepWindow_(
    int jobId,
    int stepId,
    int cameraId,
    const std::chrono::system_clock::time_point& windowStart,
    const std::chrono::system_clock::time_point& windowEnd)
{
    VideoWindowAssemblyResult result;
    result.status = VideoWindowAssemblyStatus::Failed;

    if (windowEnd <= windowStart) {
        result.error = "invalid portal counter window";
        return result;
    }

    const std::vector<VideoClipSpan_> candidates =
        collectVideoWindowCandidates_(jobId, stepId, cameraId);
    if (candidates.empty()) {
        result.error = "no clip candidates found";
        return result;
    }

    std::vector<VideoClipSlice_> slices;
    std::string sliceErr;
    auto actualWindowStart = windowStart;
    auto actualWindowEnd = windowEnd;
    bool usedBestEffortWindow = false;
    if (!buildWindowSlices_(candidates, windowStart, windowEnd, slices, &sliceErr)) {
        std::vector<VideoClipSlice_> bestEffortSlices;
        std::string bestEffortErr;
        if (!buildBestEffortWindowSlices_(
                candidates,
                windowStart,
                windowEnd,
                bestEffortSlices,
                actualWindowStart,
                actualWindowEnd,
                &bestEffortErr))
        {
            result.error = bestEffortErr.empty()
                ? (sliceErr.empty()
                    ? "failed to build portal counter window slices"
                    : sliceErr)
                : bestEffortErr;
            return result;
        }
        slices = std::move(bestEffortSlices);
        usedBestEffortWindow = true;
    }

    if (usedBestEffortWindow) {
        Logger::instance().logDebug(
            "job",
            "assemblePortalCounterStepWindow_: strict coverage failed, using best-effort window"
            " job_id=" + std::to_string(jobId) +
            " step_id=" + std::to_string(stepId) +
            " camera_id=" + std::to_string(cameraId) +
            " requested_start_utc=" + formatCoverageIsoUtc_(windowStart) +
            " requested_end_utc=" + formatCoverageIsoUtc_(windowEnd) +
            " actual_start_utc=" + formatCoverageIsoUtc_(actualWindowStart) +
            " actual_end_utc=" + formatCoverageIsoUtc_(actualWindowEnd) +
            " candidate_count=" + std::to_string(candidates.size()) +
            " slice_count=" + std::to_string(slices.size()) +
            " strict_reason=" + sliceErr
        );
    }

    std::vector<fs::path> segmentPaths;
    std::vector<std::string> cleanupPaths;
    segmentPaths.reserve(slices.size());
    cleanupPaths.reserve(slices.size() + 1);

    for (size_t i = 0; i < slices.size(); ++i) {
        const auto& slice = slices[i];
        fs::path segmentPath = makeVideoWindowTempPath_(
            jobId,
            stepId,
            cameraId,
            "portal_counter_segment_" + std::to_string(i));
        std::string segErr;
        if (!cutMp4SegmentWithFfmpeg_(
                slice.srcPath,
                segmentPath,
                slice.offsetSeconds,
                slice.durationSeconds,
                &segErr))
        {
            result.error = "segment cut failed: " + segErr;
            for (const auto& path : cleanupPaths) {
                std::error_code rmEc;
                fs::remove(fs::path(path), rmEc);
            }
            return result;
        }
        segmentPaths.push_back(segmentPath);
        cleanupPaths.push_back(segmentPath.string());
    }

    fs::path assembledPath = makeVideoWindowTempPath_(
        jobId,
        stepId,
        cameraId,
        "portal_counter_window");
    std::string concatErr;
    if (!concatMp4SegmentsWithFfmpeg_(segmentPaths, assembledPath, &concatErr)) {
        result.error = "window concat failed: " + concatErr;
        for (const auto& path : cleanupPaths) {
            std::error_code rmEc;
            fs::remove(fs::path(path), rmEc);
        }
        return result;
    }

    for (const auto& path : cleanupPaths) {
        std::error_code rmEc;
        fs::remove(fs::path(path), rmEc);
    }
    cleanupPaths.clear();
    cleanupPaths.push_back(assembledPath.string());

    result.status = VideoWindowAssemblyStatus::Assembled;
    result.clipPath = assembledPath.string();
    result.cleanupPaths = std::move(cleanupPaths);
    result.windowStartPretty = formatPrettyLocalTimePoint_(actualWindowStart);
    result.windowEndPretty = formatPrettyLocalTimePoint_(actualWindowEnd);
    result.windowStartUtc = formatCoverageIsoUtc_(actualWindowStart);
    result.windowEndUtc = formatCoverageIsoUtc_(actualWindowEnd);
    result.windowSeconds = static_cast<int>(
        std::chrono::duration_cast<std::chrono::seconds>(actualWindowEnd - actualWindowStart).count());
    result.error.clear();
    return result;
}





















void JobRuntime::maybeFireAlerts_(
    const JobStartPayload& payload,
    const JobStepDef& step,
    int cameraId,
    const JobAgentDef& agent,
    const std::string& inferenceOutput,
    bool suppressDelivery
)
{
    if (inferenceOutput.empty() || !isLikelyJson_(inferenceOutput)) return;

    json parsedOutput = json::object();
    bool shouldAlert = false;
    std::string clipPath;
    std::string answer;
    std::string imageJpegB64;
    std::string inputType;
    std::string executionBackend;
    std::string explicitProvider;
    std::string explicitModel;
    std::string existingVideoKey;
    std::string existingVideoUrl;
    std::string groupId;
    std::string groupName;
    std::string resultSource;
    json countResult = json::object();
    json groupImages = json::array();
    json llmExecutedCameraIds = json::array();
    json cachedCameraIds = json::array();
    json regionResults = json::array();
    json groupRegionResults = json::array();
    json alertRegionIds = json::array();
    json alertRegionNames = json::array();
    json motionTriggerRegionIds = json::array();
    json motionTriggerRegionNames = json::array();
    json overlayRegionIds = json::array();
    json identityCards = json::array();
    std::string primaryIdentityCardId;
    std::string decisionSource;
    bool llmAlertCondition = false;
    bool finalAlertCondition = false;
    bool hasLlmAlertCondition = false;
    bool hasFinalAlertCondition = false;
    std::string temporalDecisionSummary;
    json temporalOperatorResults = json::array();

    try {
        parsedOutput = json::parse(inferenceOutput);
        const json& j = parsedOutput;
        shouldAlert = j.value("alert_condition", false);
        clipPath = j.value("clip_path", "");
        answer = j.value("answer", "");
        imageJpegB64 = j.value("image_jpeg_b64", "");
        inputType = j.value("input_type", "");
        executionBackend = j.value("execution_backend", "");
        explicitProvider = j.value("provider", "");
        explicitModel = j.value("model", "");
        existingVideoKey = j.value("video_key", "");
        existingVideoUrl = j.value("video_url", "");
        groupId = j.value("group_id", "");
        groupName = j.value("group_name", "");
        resultSource = j.value("result_source", "");
        if (j.contains("count_result") && j["count_result"].is_object()) {
            countResult = j["count_result"];
        }
        if (j.contains("decision_source") && j["decision_source"].is_string()) {
            decisionSource = j["decision_source"].get<std::string>();
        }
        if (j.contains("llm_alert_condition") && j["llm_alert_condition"].is_boolean()) {
            llmAlertCondition = j["llm_alert_condition"].get<bool>();
            hasLlmAlertCondition = true;
        }
        if (j.contains("final_alert_condition") && j["final_alert_condition"].is_boolean()) {
            finalAlertCondition = j["final_alert_condition"].get<bool>();
            hasFinalAlertCondition = true;
        }
        if (j.contains("temporal_decision_summary") && j["temporal_decision_summary"].is_string()) {
            temporalDecisionSummary = j["temporal_decision_summary"].get<std::string>();
        }
        if (j.contains("temporal_operator_results") && j["temporal_operator_results"].is_array()) {
            temporalOperatorResults = j["temporal_operator_results"];
        }
        if (j.contains("group_images") && j["group_images"].is_array()) {
            groupImages = j["group_images"];
        }
        if (j.contains("llm_executed_camera_ids") && j["llm_executed_camera_ids"].is_array()) {
            llmExecutedCameraIds = j["llm_executed_camera_ids"];
        }
        if (j.contains("cached_camera_ids") && j["cached_camera_ids"].is_array()) {
            cachedCameraIds = j["cached_camera_ids"];
        }
        if (j.contains("region_results") && j["region_results"].is_array()) {
            regionResults = j["region_results"];
            if (regionResults.is_array()) {
                for (auto& rr : regionResults) {
                    if (!rr.is_object()) continue;
                    rr.erase("image_jpeg_b64");
                    rr.erase("frame_jpeg_base64");
                }
            }
        }
        if (j.contains("group_region_results") && j["group_region_results"].is_array()) {
            groupRegionResults = j["group_region_results"];
        }
        if (j.contains("alert_region_ids") && j["alert_region_ids"].is_array()) {
            alertRegionIds = j["alert_region_ids"];
        }
        if (j.contains("alert_region_names") && j["alert_region_names"].is_array()) {
            alertRegionNames = j["alert_region_names"];
        }
        if (j.contains("motion_trigger_region_ids") && j["motion_trigger_region_ids"].is_array()) {
            motionTriggerRegionIds = j["motion_trigger_region_ids"];
        }
        if (j.contains("motion_trigger_region_names") && j["motion_trigger_region_names"].is_array()) {
            motionTriggerRegionNames = j["motion_trigger_region_names"];
        }
        if (j.contains("overlay_region_ids") && j["overlay_region_ids"].is_array()) {
            overlayRegionIds = j["overlay_region_ids"];
        }
        if (j.contains("identity_cards") && j["identity_cards"].is_array()) {
            identityCards = j["identity_cards"];
        }
        if (j.contains("primary_identity_card_id") && j["primary_identity_card_id"].is_string()) {
            primaryIdentityCardId = j["primary_identity_card_id"].get<std::string>();
        }
        answer = resolveAlertAnswerText_(answer, temporalDecisionSummary, decisionSource);
    }
    catch (...) {
        Logger::instance().logError(
            cameraId > 0 ? std::to_string(cameraId) : "job",
            "failed to parse inference output while evaluating alerts",
            makeJobErrorContext_(
                "job_step",
                "JobRuntime::maybeFireAlerts_",
                "parse_inference_output",
                {
                    { "job_id", payload.job.id },
                    { "step_id", step.id },
                    { "camera_id", cameraId },
                    { "agent_id", agent.id },
                    { "agent_key", agent.agent_key }
                }
            )
        );
        return;
    }

    if (!shouldAlert) return;


    if (imageJpegB64.empty()) {
        // Se n?o tem clip, ? praticamente ?image mode?
        const bool looksLikeImage = clipPath.empty() || inputType == "image";

        if (looksLikeImage && owner_) {
            if (CameraSession* sess = owner_->getCameraSession(cameraId)) {
                imageJpegB64 = sess->getLastJobStillJpegBase64();
            }
        }
    }

    // Burst limiter: per job+step+targetCam+agent
    std::string limiterKey =
        "job:" + std::to_string(payload.job.id) +
        "|step:" + std::to_string(step.id) +
        "|cam:" + std::to_string(cameraId) +
        "|agent:" + agent.agent_key;
    if (!groupId.empty()) {
        limiterKey += "|group:" + groupId;
    }

    std::string imageDataUrl = ensureDataUrlBase64_(imageJpegB64, "image/jpeg");
    json normalizedGroupImages = json::array();
    if (groupImages.is_array()) {
        for (const auto& item : groupImages) {
            if (!item.is_object()) continue;

            const bool isOfflinePlaceholder =
                (item.contains("is_offline_placeholder") && item["is_offline_placeholder"].is_boolean() && item["is_offline_placeholder"].get<bool>()) ||
                (item.contains("isOfflinePlaceholder") && item["isOfflinePlaceholder"].is_boolean() && item["isOfflinePlaceholder"].get<bool>());

            if (isOfflinePlaceholder) {
                json out = {
                    {"is_offline_placeholder", true}
                };

                if (item.contains("camera_id")) {
                    out["camera_id"] = item["camera_id"];
                }
                if (item.contains("camera_name") && item["camera_name"].is_string()) {
                    out["camera_name"] = item["camera_name"];
                }
                if (item.contains("snapshot_ts_utc_iso") && item["snapshot_ts_utc_iso"].is_string()) {
                    out["snapshot_ts_utc_iso"] = item["snapshot_ts_utc_iso"];
                }

                normalizedGroupImages.push_back(std::move(out));
                continue;
            }

            std::string groupImageB64;
            if (item.contains("image_jpeg_b64") && item["image_jpeg_b64"].is_string()) {
                groupImageB64 = item["image_jpeg_b64"].get<std::string>();
            }
            else if (item.contains("frame_jpeg_base64") && item["frame_jpeg_base64"].is_string()) {
                groupImageB64 = item["frame_jpeg_base64"].get<std::string>();
            }

            const std::string groupImageDataUrl = ensureDataUrlBase64_(groupImageB64, "image/jpeg");
            if (groupImageDataUrl.empty()) continue;

            json out = {
                {"image_jpeg_b64", groupImageDataUrl}
            };

            if (item.contains("camera_id")) {
                out["camera_id"] = item["camera_id"];
            }
            if (item.contains("camera_name") && item["camera_name"].is_string()) {
                out["camera_name"] = item["camera_name"];
            }
            if (item.contains("snapshot_ts_utc_iso") && item["snapshot_ts_utc_iso"].is_string()) {
                out["snapshot_ts_utc_iso"] = item["snapshot_ts_utc_iso"];
            }

            normalizedGroupImages.push_back(std::move(out));
        }
    }
    if (imageDataUrl.empty() && normalizedGroupImages.is_array() && !normalizedGroupImages.empty()) {
        try {
            for (const auto& item : normalizedGroupImages) {
                if (!item.is_object()) continue;
                const std::string candidate = item.value("image_jpeg_b64", "");
                if (!candidate.empty()) {
                    imageDataUrl = candidate;
                    break;
                }
            }
        }
        catch (...) {}
    }


    // Resolve camera name (best-effort) ONCE for this cameraId
    std::string cameraName;
    // 1) Prefer the start payload map (job_start has camera name there)
    {
        auto it = payload.camera_start_payload_by_id.find(cameraId);
        if (it != payload.camera_start_payload_by_id.end()) {
            try {
                cameraName = it->second.value("name", "");
            }
            catch (...) {
                cameraName.clear();
            }
        }
    }

    // 2) Fallback: step.targets has camera_name too (it?s already in JobTypes.h)
    if (cameraName.empty()) {
        for (const auto& t : step.targets) {
            if (t.camera_id == cameraId) {
                cameraName = t.camera_name;
                break;
            }
        }
    }

    const std::string cameraSessionId = [&]() -> std::string {
        auto it = payload.camera_start_payload_by_id.find(cameraId);
        if (it == payload.camera_start_payload_by_id.end() || !it->second.is_object()) {
            return std::string();
        }
        try {
            return it->second.value("camera_session_id", std::string());
        }
        catch (...) {
            return std::string();
        }
    }();
    const std::string normalizedAlertInferenceModel =
        normalizeInferenceModel_(agent.inference_model);
    const bool nativePortalAlert =
        isPortalCounterBackend_(agent) ||
        trimCopyRuntime_(executionBackend) == "opencv_portal_counter";
    const std::string alertProvider =
        !trimCopyRuntime_(explicitProvider).empty()
            ? trimCopyRuntime_(explicitProvider)
            : (nativePortalAlert
                   ? "native"
                   : (isCoreInferenceModel_(normalizedAlertInferenceModel)
                          ? "zai"
                          : "openai"));
    const std::string alertModel =
        !trimCopyRuntime_(explicitModel).empty()
            ? trimCopyRuntime_(explicitModel)
            : (nativePortalAlert
                   ? "opencv_portal_counter"
                   : openAIModelNameForInferenceModel_(normalizedAlertInferenceModel));
    const bool skipLocalAlertArtifacts =
        parsedOutput.contains("daily_report_skip_local_alert_artifacts") &&
        parsedOutput["daily_report_skip_local_alert_artifacts"].is_boolean() &&
        parsedOutput["daily_report_skip_local_alert_artifacts"].get<bool>();

    if (!skipLocalAlertArtifacts && dailyReportJobsEnabled_()) {
        const DailyReportDatePartsJob_ dateParts = localDatePartsForJobDailyReport_();
        const std::string logKey = cameraId > 0 ? std::to_string(cameraId) : std::string("job");
        const fs::path stepDir = buildDailyReportStepDirJob_(payload, step, cameraId, dateParts);
        const fs::path alertDir =
            stepDir /
            "alerts" /
            ("alert_" + dateParts.localTimestampToken + "__agent_" + dailyReportAgentToken_(agent));

        std::error_code alertDirEc;
        fs::create_directories(alertDir, alertDirEc);
        if (alertDirEc) {
            Logger::instance().logDebug(
                logKey,
                "daily_reports: failed to create alert directory: " + alertDirEc.message() +
                " dir=" + alertDir.string()
            );
        }

        json alertMetadata = parsedOutput;
        stripInlineMediaForDailyReportJson_(alertMetadata);
        alertMetadata.erase("daily_report_skip_local_alert_artifacts");
        alertMetadata["daily_report_type"] = "job_alert";
        alertMetadata["camera_id"] = cameraId;
        alertMetadata["camera_name"] = cameraName;
        alertMetadata["job_id"] = payload.job.id;
        alertMetadata["job_name"] = payload.job.name;
        if (!payload.job_run_id.empty()) {
            alertMetadata["job_run_id"] = payload.job_run_id;
        }
        alertMetadata["step_id"] = step.id;
        alertMetadata["step_name"] = step.name;
        alertMetadata["step_order"] = step.step_order;
        if (!step.step_run_id.empty()) {
            alertMetadata["step_run_id"] = step.step_run_id;
        }
        alertMetadata["agent_id"] = agent.id;
        alertMetadata["agent_key"] = agent.agent_key;
        if (!agent.agent_run_id.empty()) {
            alertMetadata["agent_run_id"] = agent.agent_run_id;
        }
        if (!cameraSessionId.empty()) {
            alertMetadata["camera_session_id"] = cameraSessionId;
        }
        alertMetadata["provider"] = alertProvider;
        alertMetadata["model"] = alertModel;
        alertMetadata["inference_model"] = normalizedAlertInferenceModel;
        alertMetadata["answer"] = answer;
        alertMetadata["daily_report_generated_local"] = dateParts.localSampleLineTimestamp;

        bool alertMediaSaved = false;
        if (!clipPath.empty()) {
            const fs::path alertVideoPath = alertDir / "alert.mp4";
            std::string videoErr;
            if (transcodeToWebMp4_(fs::path(clipPath), alertVideoPath, &videoErr)) {
                alertMediaSaved = true;
                alertMetadata["alert_media_type"] = "video";
                alertMetadata["alert_media_file"] = alertVideoPath.filename().string();
            }
            else if (!videoErr.empty()) {
                alertMetadata["alert_media_error"] = videoErr;
            }
        }

        if (!alertMediaSaved && !imageDataUrl.empty()) {
            const fs::path alertImagePath = alertDir / "alert.jpg";
            if (writeDailyReportImageFromDataUrl_(
                    logKey,
                    alertImagePath,
                    imageDataUrl,
                    "daily_reports: write alert image"))
            {
                alertMediaSaved = true;
                alertMetadata["alert_media_type"] = "image";
                alertMetadata["alert_media_file"] = alertImagePath.filename().string();
            }
        }

        (void)writeDailyReportTextAtomic_(
            logKey,
            alertDir / "metadata.json",
            alertMetadata.dump(2),
            "daily_reports: write alert metadata"
        );
    }

    if (suppressDelivery) {
        return;
    }

    // allow 1, then pause 60s for external delivery
    if (!allowTelegramAlert_(limiterKey, /*burstMax*/ 1, std::chrono::seconds(60))) {
        return;
    }

    std::filesystem::path preparedClipPath;
    bool preparedClipOwned = false;
    bool preparedClipAvailable = false;
    std::string preparedClipError;
    AgentCore::JobAlertVideoUploadResult uploadedVideo;

    if (!existingVideoKey.empty()) {
        uploadedVideo.ok = true;
        uploadedVideo.videoKey = existingVideoKey;
        uploadedVideo.videoUrl = existingVideoUrl;
    }
    else if (!clipPath.empty()) {
        std::error_code ec;
        const std::filesystem::path src(clipPath);

        if (std::filesystem::exists(src, ec) && !ec) {
            preparedClipPath = makeTelegramUploadCopyPath_(cameraId);

            std::string err;
            (void)transcodeToWebMp4_(src, preparedClipPath, &err);

            std::error_code preparedEc;
            preparedClipAvailable = std::filesystem::exists(preparedClipPath, preparedEc) && !preparedEc;
            if (preparedClipAvailable) {
                preparedClipOwned = true;
            }
            else {
                preparedClipPath.clear();
                preparedClipError = err.empty() ? "failed to prepare compatible alert clip" : err;
                Logger::instance().logDebug("job", "Failed to prepare alert clip: " + preparedClipError);
            }

            if (owner_) {
                const std::string uploadSourcePath =
                    preparedClipAvailable ? preparedClipPath.string() : src.string();
                uploadedVideo = owner_->uploadJobAlertVideo(cameraId, payload.job.id, step.id, uploadSourcePath);
                if (!uploadedVideo.ok) {
                    const std::string uploadState = uploadedVideo.skippedByBudget ? "skipped_by_budget" : "failed";
                    Logger::instance().logDebug(
                        "job",
                        "Job alert video upload " + uploadState +
                        " cam=" + std::to_string(cameraId) +
                        " job=" + std::to_string(payload.job.id) +
                        " step=" + std::to_string(step.id) +
                        " err=" + uploadedVideo.error
                    );
                }
            }
        }
        else {
            preparedClipError = "clip path does not exist: " + clipPath;
        }
    }

    auto buildAlertDetails = [&](bool includeInlineImages) {
        json details = {
            {"camera_id", cameraId},
            {"agent_id", agent.id},
            {"agent_key", agent.agent_key},
            {"inference_model", normalizedAlertInferenceModel},
            {"provider", alertProvider},
            {"model", alertModel},
            {"priority_level", agent.priority_level},
            {"prompt_template", agent.prompt_template},
            {"alert_condition_text", agent.alert_condition_text},
            {"negative_condition_text", agent.negative_condition_text},
            {"alert_condition_true", true},

            // no specific rule context here
            {"channel", "none"},
            {"rule_id", nullptr},
            {"message_template", ""},

            {"clip_path", clipPath},
            {"answer", answer},

            {"group_id", groupId.empty() ? json(nullptr) : json(groupId)},
            {"group_name", groupName.empty() ? json(nullptr) : json(groupName)},
            {"result_source", resultSource.empty() ? json(nullptr) : json(resultSource)},

        };
        if (!executionBackend.empty()) {
            details["execution_backend"] = executionBackend;
        }
        if (!decisionSource.empty()) {
            details["decision_source"] = decisionSource;
        }
        if (hasLlmAlertCondition) {
            details["llm_alert_condition"] = llmAlertCondition;
        }
        if (hasFinalAlertCondition) {
            details["final_alert_condition"] = finalAlertCondition;
        }
        if (!temporalDecisionSummary.empty()) {
            details["temporal_decision_summary"] = temporalDecisionSummary;
        }
        if (temporalOperatorResults.is_array() && !temporalOperatorResults.empty()) {
            details["temporal_operator_results"] = temporalOperatorResults;
        }
        if (countResult.is_object() && !countResult.empty()) {
            details["count_result"] = countResult;
        }

        if (uploadedVideo.ok) {
            details["video_key"] = uploadedVideo.videoKey;
            details["video_url"] = uploadedVideo.videoUrl;
            details["media_type"] = "video";
        }
        else if (!clipPath.empty()) {
            details["video_pending_upload"] = true;
            if (uploadedVideo.skippedByBudget) {
                details["video_upload_status"] = "skipped_budget";
            }
            else if (!preparedClipError.empty() && uploadedVideo.error.empty()) {
                details["video_upload_status"] = "prepare_failed";
            }
            else {
                details["video_upload_status"] = "failed";
            }
            if (uploadedVideo.fileSizeBytes > 0) {
                details["video_size_bytes"] = static_cast<unsigned long long>(uploadedVideo.fileSizeBytes);
            }
            if (uploadedVideo.httpCode > 0) {
                details["video_upload_http_code"] = uploadedVideo.httpCode;
            }
            const std::string uploadError =
                !uploadedVideo.error.empty() ? uploadedVideo.error : preparedClipError;
            if (!uploadError.empty()) {
                details["video_upload_error"] = uploadError;
            }
        }

        if (includeInlineImages && !imageDataUrl.empty()) {
            details["frame_jpeg_base64"] = imageDataUrl;
        }
        if (includeInlineImages && normalizedGroupImages.is_array() && !normalizedGroupImages.empty()) {
            details["group_images"] = normalizedGroupImages;
        }
        if (llmExecutedCameraIds.is_array() && !llmExecutedCameraIds.empty()) {
            details["llm_executed_camera_ids"] = llmExecutedCameraIds;
        }
        if (cachedCameraIds.is_array() && !cachedCameraIds.empty()) {
            details["cached_camera_ids"] = cachedCameraIds;
        }
        if (regionResults.is_array() && !regionResults.empty()) {
            details["region_results"] = regionResults;
        }
        if (groupRegionResults.is_array() && !groupRegionResults.empty()) {
            details["group_region_results"] = groupRegionResults;
        }
        if (alertRegionIds.is_array() && !alertRegionIds.empty()) {
            details["alert_region_ids"] = alertRegionIds;
        }
        if (alertRegionNames.is_array() && !alertRegionNames.empty()) {
            details["alert_region_names"] = alertRegionNames;
        }
        if (motionTriggerRegionIds.is_array() && !motionTriggerRegionIds.empty()) {
            details["motion_trigger_region_ids"] = motionTriggerRegionIds;
        }
        if (motionTriggerRegionNames.is_array() && !motionTriggerRegionNames.empty()) {
            details["motion_trigger_region_names"] = motionTriggerRegionNames;
        }
        if (overlayRegionIds.is_array() && !overlayRegionIds.empty()) {
            details["overlay_region_ids"] = overlayRegionIds;
        }
        if (!primaryIdentityCardId.empty()) {
            details["primary_identity_card_id"] = primaryIdentityCardId;
        }
        if (identityCards.is_array() && !identityCards.empty()) {
            details["identity_cards"] = identityCards;
        }

        if (!cameraName.empty())
            details["camera_name"] = cameraName;

        return details;
    };

    auto postAlertEvent = [&](json details) {
        details["job_id"] = payload.job.id;
        details["job_name"] = payload.job.name;
        if (!payload.job_run_id.empty()) {
            details["job_run_id"] = payload.job_run_id;
        }
        details["step_id"] = step.id;
        details["step_order"] = step.step_order;
        details["step_name"] = step.name;
        if (!step.step_run_id.empty()) {
            details["step_run_id"] = step.step_run_id;
        }
        if (!agent.agent_run_id.empty()) {
            details["agent_run_id"] = agent.agent_run_id;
        }
        if (!cameraSessionId.empty()) {
            details["camera_session_id"] = cameraSessionId;
        }
        if (!owner_) {
            return AgentCore::AgentEventPostResult{};
        }
        return owner_->postAgentEventWithResult(
            "job_alert_triggered",
            std::nullopt,
            payload.job.user_id,
            answer,
            details);
    };

    {
        json alertDetails = buildAlertDetails(true);
        AgentCore::AgentEventPostResult alertPostResult = postAlertEvent(alertDetails);

        if (!alertPostResult.ok) {
            const bool canDegradeInlineImages =
                alertDetails.contains("frame_jpeg_base64") ||
                alertDetails.contains("group_images");

            if (canDegradeInlineImages) {
                json degradedDetails = buildAlertDetails(false);
                degradedDetails["delivery_degraded"] = true;
                degradedDetails["delivery_degraded_reason"] = "event_post_retry_without_inline_images";
                degradedDetails["delivery_initial_http_code"] = alertPostResult.httpCode;

                const AgentCore::AgentEventPostResult degradedPostResult = postAlertEvent(degradedDetails);
                if (degradedPostResult.ok) {
                    alertPostResult = degradedPostResult;
                }
            }
        }

        if (!alertPostResult.ok) {
            Logger::instance().logError(
                cameraId > 0 ? std::to_string(cameraId) : "job",
                "failed to post job alert event",
                makeJobErrorContext_(
                    "job_step",
                    "JobRuntime::maybeFireAlerts_",
                    "post_alert_event",
                    {
                        { "job_id", payload.job.id },
                        { "step_id", step.id },
                        { "camera_id", cameraId },
                        { "agent_id", agent.id },
                        { "agent_key", agent.agent_key },
                        { "http_code", alertPostResult.httpCode },
                        { "response", alertPostResult.response }
                    }
                )
            );
        }
    }


    // Build telegram settings:
    // 1) Prefer rule overrides (from payload alerts[])
    // 2) Fallback to camera_start_payload_by_id[cameraId] telegram_* fields
    auto buildTelegramSettings = [&](const JobAlertRule& r) -> TelegramSettings {
        TelegramSettings ts;
        ts.enabled = true;
        ts.bot_token = r.telegram_bot_token;
        ts.chat_id = r.telegram_chat_id;

        

        if (ts.bot_token.empty() || ts.chat_id.empty()) {
            auto it = payload.camera_start_payload_by_id.find(cameraId);
            if (it != payload.camera_start_payload_by_id.end()) {
                try {
                    const json& cam = it->second;
                    const bool enabled = cam.value("telegram_enabled", false);
                    const std::string bot = cam.value("telegram_bot_token", "");
                    const std::string chat = cam.value("telegram_chat_id", "");
                    if (enabled && !bot.empty() && !chat.empty()) {
                        ts.enabled = true;
                        ts.bot_token = bot;
                        ts.chat_id = chat;
                    }
                }
                catch (...) {}
            }
        }

        if (ts.bot_token.empty() || ts.chat_id.empty()) ts.enabled = false;
        return ts;
        };


    for (const auto& r : step.alerts) {
        // For now, we only support constant "true" here:
        // it means "fire when model alert_condition == true".
        if (r.condition_expr != "true") continue;

        if (r.channel == "telegram") {
            TelegramSettings ts = buildTelegramSettings(r);

            if (!ts.enabled) continue;

            // Build message/caption now (safe to capture by value)
            std::string msg = r.message_template;
            if (!answer.empty()) msg += "\n\n" + answer;

            // If we have a clip, copy it to an upload-safe temp path.
            // This avoids any race with later deletion of the original .processing file.
            std::filesystem::path uploadCopy;
            bool hasCopy = false;

            if (preparedClipAvailable) {
                std::error_code ec;
                if (std::filesystem::exists(preparedClipPath, ec) && !ec) {
                    uploadCopy = makeTelegramUploadCopyPath_(cameraId);
                    std::filesystem::copy_file(preparedClipPath, uploadCopy,
                        std::filesystem::copy_options::overwrite_existing, ec);
                    hasCopy = (!ec && std::filesystem::exists(uploadCopy, ec) && !ec);
                }
            }

            // Async send (detached) ? does not block job thread
            std::thread([ts, msg, hasCopy, uploadCopy, payload, step, cameraId, agent]() mutable {
                try {
                    std::string err;

                    const bool textSent = TelegramNotifier::SendTelegramMessage(ts, msg, &err);
                    if (!textSent && !err.empty()) {
                        Logger::instance().logDebug("job", "Telegram text send failed: " + err);
                    }

                    // 2) send compatible mp4 as Telegram video
                    if (hasCopy) {
                        const bool videoSent = TelegramNotifier::SendVideo(ts, uploadCopy.string(), msg, &err);
                        if (!videoSent && !err.empty()) {
                            Logger::instance().logDebug("job", "Telegram video send failed: " + err);
                        }

                        // cleanup upload copy
                        std::error_code delEc;
                        std::filesystem::remove(uploadCopy, delEc);
                    }
                }
                catch (const std::exception& ex) {
                    logJobException_(
                        cameraId > 0 ? std::to_string(cameraId) : "job",
                        "job_step",
                        "JobRuntime::maybeFireAlerts_::telegramWorker",
                        "send_telegram_alert",
                        {
                            { "job_id", payload.job.id },
                            { "step_id", step.id },
                            { "camera_id", cameraId },
                            { "agent_id", agent.id },
                            { "agent_key", agent.agent_key },
                            { "has_clip_copy", hasCopy }
                        },
                        ex
                    );
                }
                catch (...) {
                    logJobUnknownException_(
                        cameraId > 0 ? std::to_string(cameraId) : "job",
                        "job_step",
                        "JobRuntime::maybeFireAlerts_::telegramWorker",
                        "send_telegram_alert",
                        {
                            { "job_id", payload.job.id },
                            { "step_id", step.id },
                            { "camera_id", cameraId },
                            { "agent_id", agent.id },
                            { "agent_key", agent.agent_key },
                            { "has_clip_copy", hasCopy }
                        }
                    );
                }
            }).detach();
        }
    }

    if (preparedClipOwned) {
        std::error_code delEc;
        std::filesystem::remove(preparedClipPath, delEc);
    }
}

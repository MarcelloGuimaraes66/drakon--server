// JobRuntime.cpp
#include "JobRuntime.h"
#include "JobPayloadParser.h"

#include "../core/AgentCore.h"      // adjust include paths to your tree
#include "../core/TemporalEngine.h"
#include "../camera/CameraSession.h"
#include "../comm/TelegramNotifier.h"
#include "../generated/Branding.h"


#include <algorithm>
#include <stdexcept>

#include <fstream>
#include <cctype>
#include <ctime>
#include <cstdio>
#include <sstream>
#include <iomanip>

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
#include <wincrypt.h>
#pragma comment(lib, "Crypt32.lib")
#endif


#include "../logging/Logging.h"

namespace fs = std::filesystem;

static bool extractLastFrameJpegDataUrlFromMp4_(
    const fs::path& srcMp4Path,
    std::string& outJpegDataUrl,
    std::string* outErr);

namespace {
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

    std::vector<uchar> jpgBytes;
    if (!cv::imencode(".jpg", img, jpgBytes) || jpgBytes.empty()) {
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

    outDataUrl = "data:image/jpeg;base64," + b64;
    return true;
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
    if (s == "legacy" || s == "pro" || s == "ultra" || s == "core") return s;
    return "legacy";
}

static bool isOpenAIInferenceModel_(const std::string& inferenceModel) {
    const std::string m = normalizeInferenceModel_(inferenceModel);
    return m == "pro" || m == "ultra";
}

static bool isCoreInferenceModel_(const std::string& inferenceModel) {
    return normalizeInferenceModel_(inferenceModel) == "core";
}

static std::string openAIModelNameForInferenceModel_(const std::string& inferenceModel) {
    const std::string m = normalizeInferenceModel_(inferenceModel);
    if (m == "core") return "GLM-4.6V-Flash";
    if (m == "ultra") return "gpt-5.1";
    return "gpt-5-mini"; // "pro"
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
    if (fps > 10) return 10;
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
    return (seconds <= 10) ? 10 : 60;
}

static std::string trimCopyRuntime_(std::string s) {
    auto isSpace = [](unsigned char ch) { return std::isspace(ch); };
    while (!s.empty() && isSpace((unsigned char)s.front())) s.erase(s.begin());
    while (!s.empty() && isSpace((unsigned char)s.back())) s.pop_back();
    return s;
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
    return "mosaic_3x3";
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

static std::vector<cv::Point> regionPolygonToPixels_(
    const JobAnalysisRegion& region,
    const cv::Size& size)
{
    std::vector<cv::Point> polygon;
    if (size.width <= 0 || size.height <= 0) return polygon;
    polygon.reserve(region.polygon_norm.size());
    for (const auto& p : region.polygon_norm) {
        const double xNorm = std::min(1.0, std::max(0.0, p.x));
        const double yNorm = std::min(1.0, std::max(0.0, p.y));
        int x = (int)std::llround(xNorm * (double)(size.width - 1));
        int y = (int)std::llround(yNorm * (double)(size.height - 1));
        x = std::min(std::max(0, x), size.width - 1);
        y = std::min(std::max(0, y), size.height - 1);
        polygon.emplace_back(x, y);
    }
    return polygon;
}

static cv::Rect computeRegionCropRect_(
    const JobAnalysisRegion& region,
    const cv::Size& imageSize)
{
    if (imageSize.width <= 1 || imageSize.height <= 1) {
        return cv::Rect();
    }
    if (region.full_frame || region.polygon_norm.size() < 3) {
        return cv::Rect(0, 0, imageSize.width, imageSize.height);
    }

    const auto polygon = regionPolygonToPixels_(region, imageSize);
    if (polygon.size() < 3) {
        return cv::Rect(0, 0, imageSize.width, imageSize.height);
    }

    cv::Rect rect = cv::boundingRect(polygon);
    if (rect.width <= 0 || rect.height <= 0) {
        return cv::Rect(0, 0, imageSize.width, imageSize.height);
    }

    const double pct = std::min(0.4, std::max(0.0, region.context_padding_pct));
    const int padX = (int)std::llround((double)rect.width * pct);
    const int padY = (int)std::llround((double)rect.height * pct);

    int x1 = std::max(0, rect.x - padX);
    int y1 = std::max(0, rect.y - padY);
    int x2 = std::min(imageSize.width, rect.x + rect.width + padX);
    int y2 = std::min(imageSize.height, rect.y + rect.height + padY);

    if (x2 <= x1 || y2 <= y1) {
        return cv::Rect(0, 0, imageSize.width, imageSize.height);
    }

    return cv::Rect(x1, y1, x2 - x1, y2 - y1);
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

static bool detectMotionInRegionFromClip_(
    const fs::path& clipPath,
    const JobAnalysisRegion& region,
    bool& outMotion,
    std::string* outErr = nullptr)
{
    outMotion = true;
    if (region.full_frame || region.polygon_norm.size() < 3) {
        return true;
    }

    try {
        cv::VideoCapture cap(clipPath.string());
        if (!cap.isOpened()) {
            if (outErr) *outErr = "cv::VideoCapture failed to open clip";
            return false;
        }

        cv::Mat firstFrame;
        if (!cap.read(firstFrame) || firstFrame.empty()) {
            if (outErr) *outErr = "failed to read first frame";
            return false;
        }
        cv::Mat lastFrame = firstFrame.clone();
        cv::Mat frame;
        while (cap.read(frame)) {
            if (!frame.empty()) {
                lastFrame = frame.clone();
            }
        }
        if (lastFrame.empty()) {
            if (outErr) *outErr = "failed to read last frame";
            return false;
        }
        if (lastFrame.size() != firstFrame.size()) {
            cv::resize(lastFrame, lastFrame, firstFrame.size(), 0, 0, cv::INTER_AREA);
        }

        cv::Mat firstGray, lastGray;
        cv::cvtColor(firstFrame, firstGray, cv::COLOR_BGR2GRAY);
        cv::cvtColor(lastFrame, lastGray, cv::COLOR_BGR2GRAY);
        cv::GaussianBlur(firstGray, firstGray, cv::Size(5, 5), 0);
        cv::GaussianBlur(lastGray, lastGray, cv::Size(5, 5), 0);

        cv::Mat diff, motionMask;
        cv::absdiff(firstGray, lastGray, diff);
        cv::threshold(diff, motionMask, 18, 255, cv::THRESH_BINARY);
        cv::erode(motionMask, motionMask, cv::Mat(), cv::Point(-1, -1), 1);
        cv::dilate(motionMask, motionMask, cv::Mat(), cv::Point(-1, -1), 1);

        cv::Mat roiMask(motionMask.size(), CV_8U, cv::Scalar(0));
        const auto polygon = regionPolygonToPixels_(region, motionMask.size());
        if (polygon.size() < 3) {
            outMotion = true;
            return true;
        }
        std::vector<std::vector<cv::Point>> polygons{ polygon };
        cv::fillPoly(roiMask, polygons, cv::Scalar(255));

        cv::Mat roiMotion;
        cv::bitwise_and(motionMask, roiMask, roiMotion);
        const int changed = cv::countNonZero(roiMotion);
        const int area = std::max(1, cv::countNonZero(roiMask));
        const int minChanged = std::max(20, (int)std::llround((double)area * 0.01));
        outMotion = changed >= minChanged;
        return true;
    }
    catch (const std::exception& e) {
        if (outErr) *outErr = e.what();
        return false;
    }
    catch (...) {
        if (outErr) *outErr = "unknown exception";
        return false;
    }
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

    outMotion = false;
    for (const auto& region : polygonRegions) {
        bool regionMotion = true;
        std::string regionErr;
        if (!detectMotionInRegionFromClip_(clipPath, region, regionMotion, &regionErr)) {
            if (outErr) {
                *outErr = "region_id=" + region.region_id + " err=" + regionErr;
            }
            return false;
        }
        if (regionMotion) {
            outMotion = true;
            if (outTriggeredRegionIds) {
                outTriggeredRegionIds->push_back(region.region_id);
            }
        }
    }
    return true;
}

static cv::Scalar regionOverlayColorByIndex_(std::size_t index)
{
    static const cv::Scalar kPalette[] = {
        cv::Scalar(255, 99, 71),    // tomato
        cv::Scalar(60, 179, 113),   // mediumseagreen
        cv::Scalar(30, 144, 255),   // dodgerblue
        cv::Scalar(238, 130, 238),  // violet
        cv::Scalar(255, 215, 0),    // gold
        cv::Scalar(255, 140, 0),    // darkorange
        cv::Scalar(0, 206, 209),    // darkturquoise
        cv::Scalar(220, 20, 60)     // crimson
    };
    return kPalette[index % (sizeof(kPalette) / sizeof(kPalette[0]))];
}

static int drawAnalysisRegionOverlaysOnFrame_(
    cv::Mat& frame,
    const std::vector<JobAnalysisRegion>& regions,
    std::vector<std::string>* outDrawnRegionIds = nullptr)
{
    if (outDrawnRegionIds) outDrawnRegionIds->clear();
    if (frame.empty()) return 0;

    const std::vector<JobAnalysisRegion> polygonRegions = collectPolygonOnlyRegions_(regions);
    if (polygonRegions.empty()) return 0;

    cv::Mat overlay = frame.clone();
    int drawnCount = 0;
    for (std::size_t i = 0; i < polygonRegions.size(); ++i) {
        const auto& region = polygonRegions[i];
        const auto polygon = regionPolygonToPixels_(region, frame.size());
        if (polygon.size() < 3) continue;
        const cv::Scalar color = regionOverlayColorByIndex_(i);
        std::vector<std::vector<cv::Point>> polygons{ polygon };
        cv::fillPoly(overlay, polygons, color, cv::LINE_AA);
        drawnCount++;
        if (outDrawnRegionIds && !region.region_id.empty()) {
            outDrawnRegionIds->push_back(region.region_id);
        }
    }

    if (drawnCount <= 0) return 0;

    cv::addWeighted(overlay, 0.20, frame, 0.80, 0.0, frame);

    for (std::size_t i = 0; i < polygonRegions.size(); ++i) {
        const auto& region = polygonRegions[i];
        const auto polygon = regionPolygonToPixels_(region, frame.size());
        if (polygon.size() < 3) continue;

        const cv::Scalar color = regionOverlayColorByIndex_(i);
        std::vector<std::vector<cv::Point>> polygons{ polygon };
        cv::polylines(frame, polygons, true, color, 2, cv::LINE_AA);

        std::string label = trimCopyRuntime_(region.label);
        if (label.empty()) label = trimCopyRuntime_(region.region_id);
        if (label.empty()) label = "ROI";

        int baseline = 0;
        const double fontScale = 0.50;
        const int thickness = 1;
        const int pad = 4;
        const cv::Size textSize = cv::getTextSize(
            label,
            cv::FONT_HERSHEY_SIMPLEX,
            fontScale,
            thickness,
            &baseline
        );

        cv::Point anchor = polygon.front();
        int boxW = textSize.width + pad * 2;
        int boxH = textSize.height + baseline + pad * 2;
        int x = std::max(0, std::min(anchor.x, frame.cols - boxW));
        int yTop = anchor.y - boxH - 3;
        if (yTop < 0) {
            yTop = std::min(std::max(0, anchor.y + 3), frame.rows - boxH);
        }
        if (yTop < 0) yTop = 0;
        if (x < 0) x = 0;
        if (x + boxW > frame.cols) boxW = frame.cols - x;
        if (yTop + boxH > frame.rows) boxH = frame.rows - yTop;
        if (boxW <= 0 || boxH <= 0) continue;

        cv::Rect box(x, yTop, boxW, boxH);
        cv::rectangle(frame, box, color, cv::FILLED);
        const cv::Point textOrg(
            x + pad,
            yTop + boxH - baseline - pad
        );
        cv::putText(
            frame,
            label,
            textOrg,
            cv::FONT_HERSHEY_SIMPLEX,
            fontScale,
            cv::Scalar(15, 15, 15),
            thickness,
            cv::LINE_AA
        );
    }

    return drawnCount;
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
    outClipPath.clear();
    if (outDrawnRegionIds) outDrawnRegionIds->clear();

    const std::vector<JobAnalysisRegion> polygonRegions = collectPolygonOnlyRegions_(regions);
    if (polygonRegions.empty()) {
        outClipPath = srcClipPath;
        return true;
    }

    cv::VideoCapture cap(srcClipPath.string());
    if (!cap.isOpened()) {
        if (outErr) *outErr = "cv::VideoCapture failed to open source clip";
        return false;
    }

    cv::Mat frame;
    if (!cap.read(frame) || frame.empty()) {
        if (outErr) *outErr = "failed reading first frame";
        return false;
    }

    const cv::Size frameSize = frame.size();
    if (frameSize.width <= 0 || frameSize.height <= 0) {
        if (outErr) *outErr = "invalid frame size";
        return false;
    }

    double fps = cap.get(cv::CAP_PROP_FPS);
    if (!std::isfinite(fps) || fps <= 0.0) {
        fps = 10.0;
    }

    fs::path dstClipPath = srcClipPath;
    dstClipPath += ".roi_overlay.mp4";

    cv::VideoWriter writer;
    const std::vector<int> fourccCandidates = {
        cv::VideoWriter::fourcc('a', 'v', 'c', '1'),
        cv::VideoWriter::fourcc('m', 'p', '4', 'v')
    };
    for (const int fourcc : fourccCandidates) {
        if (writer.open(dstClipPath.string(), fourcc, fps, frameSize, true)) {
            break;
        }
    }
    if (!writer.isOpened()) {
        if (outErr) *outErr = "cv::VideoWriter failed to open output clip";
        return false;
    }

    bool wroteAny = false;
    auto writeFrameWithOverlay = [&](cv::Mat& srcFrame) {
        if (srcFrame.empty()) return;
        cv::Mat drawFrame = srcFrame.clone();
        drawAnalysisRegionOverlaysOnFrame_(drawFrame, polygonRegions, nullptr);
        writer.write(drawFrame);
        wroteAny = true;
    };

    writeFrameWithOverlay(frame);
    while (cap.read(frame)) {
        writeFrameWithOverlay(frame);
    }

    writer.release();
    cap.release();

    if (!wroteAny) {
        std::error_code ec;
        fs::remove(dstClipPath, ec);
        if (outErr) *outErr = "no frames written to annotated clip";
        return false;
    }

    if (outDrawnRegionIds) {
        outDrawnRegionIds->reserve(polygonRegions.size());
        for (const auto& region : polygonRegions) {
            if (!region.region_id.empty()) {
                outDrawnRegionIds->push_back(region.region_id);
            }
        }
    }

    outClipPath = std::move(dstClipPath);
    return true;
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

static std::string buildInferencePrompt_(
    const std::string& promptCore,
    const std::string& negativeConditionText,
    const std::string& injectedInput,
    const std::vector<JobFaceTarget>& faceTargets,
    const std::vector<JobNegativeReferenceImage>& negativeReferenceImages
) {
    std::string finalPrompt = trimCopyRuntime_(promptCore);
    const std::string negative = trimCopyRuntime_(negativeConditionText);
    const std::string hiddenFacePrompt = buildHiddenFaceIdPrompt_(faceTargets);
    const std::string hiddenNegativeRefPrompt = buildHiddenNegativeReferencePrompt_(
        negativeReferenceImages
    );

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

static std::optional<std::string> getNextReadyCurrentDayStoredSixtySecondClipPathForJobStepCamera_(
    int jobId,
    int stepId,
    int cameraId)
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
    const JobAgentDef& agent)
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
            cameraId
        );
    }

    auto clipOpt = getNextReadyJobsClipForCamera_(jobId, stepId, cameraId);
    if (!clipOpt.has_value()) {
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
    std::string windowStartPretty;
    std::string windowEndPretty;
    int windowSeconds = 0;
    std::string error;
};

static VideoWindowAssemblyResult assembleAdaptivePendingJobsWindow_(
    int jobId,
    int stepId,
    int cameraId);

static VideoWindowAssemblyResult assembleLegacyVideoWindowForRunEvery_(
    int jobId,
    int stepId,
    int cameraId,
    int runEverySeconds);

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
                            {"reason", "invalid_dependency_or_cycle"},
                            {"from_step_id", dep}
                        });
                    }
                }
            }
        }

        job->jobStartedAt = std::chrono::steady_clock::now();
        constexpr int kMinStepTimeoutSeconds = 120;

        auto startStep = [&](JobInstance::StepRun& run) {
            auto& step = run.def;
            const int effectiveTimeoutSeconds = std::max(kMinStepTimeoutSeconds, step.timeout_seconds);

            run.state = JobInstance::StepState::Running;
            run.startedAt = std::chrono::steady_clock::now();
            run.deadline = run.startedAt + std::chrono::seconds(effectiveTimeoutSeconds);
            run.cancel = false;
            run.injectedInput.clear(); // pipeline input is resolved per target camera (non-blocking)

            // Ensure target cameras are started using the enriched start_camera_payloads map
            if (owner_) {
                for (const auto& tgt : step.targets) {
                    auto itP = job->payload.camera_start_payload_by_id.find(tgt.camera_id);
                    if (itP != job->payload.camera_start_payload_by_id.end()) {
                        owner_->ensureCameraStartedForJob(tgt.camera_id, itP->second);
                    }
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
                {"timeout_seconds", effectiveTimeoutSeconds},
                {"targets", (int)step.targets.size()}
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
                run.workers.emplace_back([this, job, &run, &step, &stepsById, pg]() {
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

                        while (!job->cancel && !run.cancel && std::chrono::steady_clock::now() < run.deadline) {
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
                            inputs.reserve(pg.camera_ids.size());
                            jpegByCam.reserve(pg.camera_ids.size());
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
                                if (!extractLastFrameJpegDataUrlFromMp4_(fs::path(cc.processingPath), gi.jpegBase64, &extractErr) ||
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
                run.workers.emplace_back([this, job, &run, &step, &stepsById, tgt]() {
                    try {
                        const int cameraId = tgt.camera_id;
                        const JobAgentDef* agent = selectAgentForCamera_(step, cameraId);
                        if (!agent) return;
                        // Model tier for this camera (default: pro)
                        std::string modelTier = "pro";
                        {
                            auto itP = job->payload.camera_start_payload_by_id.find(cameraId);
                            if (itP != job->payload.camera_start_payload_by_id.end()) {
                                try { modelTier = itP->second.value("model_tier", modelTier); } catch (...) {}
                            }
                        }

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
                        bool runDuePending = !isImageAgentInput;
                        while (!job->cancel && !run.cancel && std::chrono::steady_clock::now() < run.deadline) {
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
                                peekReadyJobVideoInputForStepCamera_(jobId, step.id, cameraId, *agent).has_value();
                            if (!readyVideoInputForPendingRun) {
                                std::this_thread::sleep_for(std::chrono::milliseconds(250));
                                continue;
                            }
                        }

                        const std::string startConditionText = buildStartConditionText();
                        std::string out = runAgentInferenceOnCamera_(
                            jobId,
                            step.id,
                            cameraId,
                            *agent,
                            resolvePipelineInputsForCamera_(job, step, cameraId, stepsById),
                            /*alertConditionText*/ agent->alert_condition_text,
                            /*startConditionText*/ startConditionText,
                            /*modelTier*/ modelTier,
                            /*timeoutSeconds*/ 15,
                            job->cancel
                        );

                        if (out.empty()) {
                            // No fresh clip/inference in this cycle.
                            // Keep previous output cached; do not overwrite with empty string.
                            if (!isImageAgentInput && runDuePending && readyVideoInputForPendingRun) {
                                lastRunAt = nowTick;
                                runDuePending = false;
                            }
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

                        {
                            std::lock_guard<std::mutex> lk(job->outputsMu);
                            StepOutput& so = job->outputs[step.id];
                            so.last_output_by_camera[cameraId] = out;
                            so.history_by_camera[cameraId].push_back(out);
                            if (!out.empty()) so.aggregated_output = out;
                        }

                        //maybeFireAlerts_(job->payload, step, cameraId, out);

                        maybeFireAlerts_(job->payload, step, cameraId, *agent, out);



                        // Cleanup the JOBS ".processing" clip AFTER alerts had a chance to copy it.
                        try {
                            if (!out.empty() && isLikelyJson_(out)) {
                                json j = json::parse(out);
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


                        // If Gemini signaled a downstream custom step to start, record it.
                        try {
                            if (isLikelyJson_(out)) {
                                json j = json::parse(out);
                                if (j.contains("start_condition_step_id") && j["start_condition_step_id"].is_number_integer()) {
                                    int sidToStart = j["start_condition_step_id"].get<int>();
                                    std::lock_guard<std::mutex> lk2(job->triggeredMu);
                                    job->triggeredStartStepIds.insert(sidToStart);
                                }
                            }
                        } catch (...) {}

                            std::this_thread::sleep_for(std::chrono::seconds(1));
                        }
                    }
                    catch (const std::exception& ex) {
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

        auto finalizeStep = [&](JobInstance::StepRun& run, const char* reason) {
            auto& step = run.def;
            run.cancel = true;
            for (auto& t : run.workers) {
                if (t.joinable()) t.join();
            }
            run.workers.clear();

            /*
            if (owner_) {
                for (const auto& tgt : step.targets) {
                    owner_->jobsCaptureRelease(tgt.camera_id, job->payload.job.id, step.id);
                }
            }
            */

            if (owner_) {
                for (const auto& tgt : step.targets) {
                    const int camId = tgt.camera_id;
                    if (stepCaptureNeedsForCamera_(step, camId).any()) {
                        owner_->jobsCaptureRelease(camId, job->payload.job.id, step.id);
                    }
                }
            }

            // Important: a step can finish (typically by timeout) while its target cameras
            // are still running capture/recording. If no other RUNNING step currently
            // uses a given camera, we should stop it for this job.
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
                        owner_->stopCameraForJob(camId);
                    }
                }
            }


            if (run.state == JobInstance::StepState::Running) {
                run.state = JobInstance::StepState::Completed;
                postStepEvent_("job_step_completed", J, step, json{
                    {"step_id", step.id},
                    {"step_order", step.step_order},
                    {"reason", reason}
                });
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

            // Finalize running steps that hit timeout
            for (auto& [sid, run] : job->stepRuns) {
                if (run.state == JobInstance::StepState::Running &&
                    std::chrono::steady_clock::now() >= run.deadline) {
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
            postJobEvent_("job_stopped", J, json{ {"job_id", J.id}, {"reason", "cancelled"} });
            finalizeJobRuntimeState();
            return;
        }

        postJobEvent_("job_completed", J, json{ {"job_id", J.id}, {"job_name", J.name} });
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
            markCaptureDemand(a.input_type, a.inference_model, a.model_fps, a.run_every_seconds);
        }
        if (!a.camera_id.has_value() && !fallbackDefault) {
            fallbackDefault = &a;
        }
    }

    if (!hasSpecificAgent && fallbackDefault) {
        markCaptureDemand(
            fallbackDefault->input_type,
            fallbackDefault->inference_model,
            fallbackDefault->model_fps,
            fallbackDefault->run_every_seconds
        );
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
    owner_->postAgentEvent(eventType, /*cameraId*/ std::nullopt, job.user_id, /*message*/"", details);
}

void JobRuntime::postStepEvent_(const std::string& eventType, const JobDefSnapshot& job, const JobStepDef& step, const json& extra) {
    json d = extra;
    d["job_id"] = job.id;
    d["job_name"] = job.name;
    d["step_id"] = step.id;
    d["step_order"] = step.step_order;
    d["step_name"] = step.name;
    postJobEvent_(eventType, job, d);
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
    int timeoutSeconds,
    std::atomic<bool>& cancel
) {
    if (cancel) return "";
    (void)timeoutSeconds;

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
        temporal::computePromptRevisionHash(temporalPromptCore, alertConditionText);
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
                alertConditionText
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
                 alertConditionText
             ));
        if (!slotPlanMatchesCurrentPrompt) {
            slot.planEnvelope = payloadPlanMatchesCurrentPrompt
                ? agent.temporal_plan_envelope
                : nlohmann::json::object();
            slot.state = temporal::defaultState();
        }
        if (!slot.state.is_object() || slot.state.empty()) {
            slot.state = temporal::defaultState();
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
            if (mem.contains("appearance_summary") && mem["appearance_summary"].is_string()) {
                doc["appearance_summary"] = mem["appearance_summary"];
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
            if ((!doc.contains("appearance_summary") || !doc["appearance_summary"].is_string()) &&
                entityState.contains("appearance_summary") && entityState["appearance_summary"].is_string())
            {
                doc["appearance_summary"] = entityState["appearance_summary"];
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
                const std::string appearanceSummary =
                    temporal::trim(temporal::strField(*patchNode, "appearance_summary"));
                if (!appearanceSummary.empty()) doc["appearance_summary"] = appearanceSummary;
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
            }

            if (!entityId.empty()) {
                auto memIt = memoryById.find(entityId);
                if (memIt != memoryById.end()) {
                    const json& mem = memIt->second;
                    if (!doc.contains("description") && mem.contains("description") && mem["description"].is_string()) {
                        doc["description"] = mem["description"];
                    }
                    if (!doc.contains("appearance_summary") && mem.contains("appearance_summary") && mem["appearance_summary"].is_string()) {
                        doc["appearance_summary"] = mem["appearance_summary"];
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
                    if (!doc.contains("appearance_summary") && entityState.contains("appearance_summary") && entityState["appearance_summary"].is_string()) {
                        doc["appearance_summary"] = entityState["appearance_summary"];
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
        json stableAttributes = json::array();
        if (doc.contains("stable_attributes")) {
            temporal::appendUniqueTraitsToArray(stableAttributes, doc["stable_attributes"]);
        }
        if (stableAttributes.empty() && doc.contains("key_traits")) {
            temporal::appendUniqueTraitsToArray(stableAttributes, doc["key_traits"]);
        }
        doc["stable_attributes"] = stableAttributes;

        json mergedKeyTraits = json::array();
        if (!stableAttributes.empty()) {
            temporal::appendUniqueTraitsToArray(mergedKeyTraits, stableAttributes);
        }
        if (doc.contains("key_traits")) {
            temporal::appendUniqueTraitsToArray(mergedKeyTraits, doc["key_traits"]);
        }
        doc["key_traits"] = mergedKeyTraits;

        if (!doc.contains("updated_traits") || !doc["updated_traits"].is_array()) {
            doc["updated_traits"] = json::array();
        }
        const std::string identityTypeHint = !entityType.empty() ? entityType : entityKey;
        json identitySignatureTraits = json::array();
        if (doc.contains("identity_signature_traits")) {
            temporal::appendUniqueTraitsToArray(identitySignatureTraits, doc["identity_signature_traits"]);
        }
        if (identitySignatureTraits.empty()) {
            identitySignatureTraits = temporal::curateIdentitySignatureTraits(
                identityTypeHint,
                stableAttributes,
                doc["updated_traits"],
                identitySignatureTraits);
        }
        doc["identity_signature_traits"] = identitySignatureTraits;

        json identityContextTraits = json::array();
        if (doc.contains("identity_context_traits")) {
            temporal::appendUniqueTraitsToArray(identityContextTraits, doc["identity_context_traits"]);
        }
        if (identityContextTraits.empty()) {
            identityContextTraits = temporal::curateIdentityContextTraits(
                identityTypeHint,
                stableAttributes,
                doc["updated_traits"],
                identityContextTraits);
        }
        doc["identity_context_traits"] = identityContextTraits;

        std::string identitySignatureSummary =
            temporal::trim(temporal::strField(doc, "identity_signature_summary"));
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
        if (identityTraits.empty() && normalized.contains("stable_attributes")) {
            temporal::appendUniqueTraitsToArray(identityTraits, normalized["stable_attributes"]);
        }
        if (identityTraits.empty() && normalized.contains("key_traits")) {
            temporal::appendUniqueTraitsToArray(identityTraits, normalized["key_traits"]);
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
        return projected;
    };

    auto buildCrossCameraSearchPrompt = [&](const json& targetEntity) -> std::string {
        const json normalized = normalizeCrossCameraTargetEntity(targetEntity);
        const std::string entityType = temporal::trim(
            temporal::strField(normalized, "entity_type", temporal::strField(normalized, "entity_key", "object")));
        const std::string knownName = temporal::trim(temporal::strField(normalized, "known_name"));
        const std::string identitySignatureSummary =
            temporal::trim(temporal::strField(normalized, "identity_signature_summary"));
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
        const bool hasCuratedSignature =
            !identitySignatureSummary.empty() ||
            (normalized.contains("identity_signature_traits") &&
             normalized["identity_signature_traits"].is_array() &&
             !normalized["identity_signature_traits"].empty());
        prompt << "Look for the same " << (entityType.empty() ? "object" : entityType)
               << " from another camera in this job step.";
        prompt << " Treat this shared hunt as a priority task for the receiving camera even if its local task text is unrelated.";
        prompt << " Use only target-centric identity cues such as physical traits, clothing, accessories, carried objects, markings, and vehicle details.";
        prompt << " Ignore room layout, furniture, doors, walls, lighting, activity, pose, and surrounding background.";
        if (!knownName.empty()) {
            prompt << " Known identity hint: " << knownName << ".";
        }
        if (hasCuratedSignature) {
            if (!identitySignatureSummary.empty()) {
                prompt << " Curated identity signature: " << identitySignatureSummary << ".";
            }
            appendTraitSentence("identity_signature_traits", "Identity signature traits", 8);
        }
        else {
            appendTraitSentence("stable_attributes", "Stable identity traits", 8);
            appendTraitSentence("key_traits", "Identity cues", 8);
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

        std::string clipPath;
        bool clipBackedSource = false;

        struct ProcessingClipGuard {
            std::string path;
            bool disarm = false;
            ~ProcessingClipGuard() {
                if (disarm) return;
                if (path.size() < std::string(".processing").size()) return;
                if (path.rfind(".processing") != path.size() - std::string(".processing").size()) return;
                std::error_code ec;
                fs::remove(fs::path(path), ec);
            }
        } clipGuard;

        std::string jpegB64;
        std::string tsUtcIso;

        auto imageOpt = getNewestJobsImageForCamera(jobId, stepId, std::to_string(cameraId));
        if (imageOpt) {
            fs::path imagePath = fs::path(*imageOpt);
            const std::string imageKey = makeMonotonicImageKey_(imagePath);
            if (isNewerClipForJobStepCamera_(jobId, stepId, cameraId, imageKey)) {
                std::string imageErr;
                if (encodeImageFileAsJpegDataUrl_(imagePath, jpegB64, &imageErr) && !jpegB64.empty()) {
                    markClipConsumedForJobStepCamera_(jobId, stepId, cameraId, imageKey);
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

            // Claim clip exclusively for this worker to prevent reprocessing.
            std::error_code renEc;
            fs::path pth = fs::path(clipPath);
            fs::path processing = pth;
            processing += ".processing";
            fs::rename(pth, processing, renEc);
            if (renEc) return "";
            clipPath = processing.string();
            clipBackedSource = true;
            clipGuard.path = clipPath;
            markClipConsumedForJobStepCamera_(jobId, stepId, cameraId, clipKey);

            std::string extractErr;
            if (!extractLastFrameJpegDataUrlFromMp4_(fs::path(clipPath), jpegB64, &extractErr) || jpegB64.empty()) {
                Logger::instance().logDebug(
                    "job",
                    "runAgentInferenceOnCamera_: image mode failed extracting frame cameraId=" +
                    std::to_string(cameraId) + " clip=" + clipPath + " err=" + extractErr
                );
                return "";
            }
            parseClipEndTsUtcIsoFromPath_(fs::path(clipPath), tsUtcIso);
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

        const std::vector<JobAnalysisRegion> polygonRegions =
            collectPolygonOnlyRegions_(activeRegions);
        const std::vector<JobAnalysisRegion>& allowedAlertRegions =
            polygonRegions.empty() ? activeRegions : polygonRegions;
        const std::unordered_map<std::string, std::string> allowedAlertRegionLabelById =
            buildRegionLabelByIdMap_(allowedAlertRegions);
        std::vector<std::string> motionTriggeredRegionIds;
        const bool enforceMotionGate = agent.only_capture_on_motion;
        const bool enforceMotionWithoutPolygon = enforceMotionGate && polygonRegions.empty();
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
                if (!detectMotionInAnyRegionFromClip_(
                        fs::path(clipPath),
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
        if (temporalPlanPrepared && temporal::planUsable(temporalSlot.planEnvelope)) {
            nlohmann::json temporalInput = temporal::buildInferenceInput(
                temporalSlot.planEnvelope,
                temporalSlot.state,
                cameraId,
                nowIsoForInference
            );
            if (activeCrossCameraWatchlist.is_array() && !activeCrossCameraWatchlist.empty()) {
                temporalInput["cross_camera_watchlist"] = activeCrossCameraWatchlist;
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
        else if (activeCrossCameraWatchlist.is_array() && !activeCrossCameraWatchlist.empty()) {
            nlohmann::json temporalInput = buildCrossCameraRuntimeInput(nowIsoForInference, std::string(), std::string());
            temporalInput["cross_camera_watchlist"] = activeCrossCameraWatchlist;
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
                totalTokens
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
                totalTokens
            );
        }

        if (faceIdOnlyMode && hasUsableFaceTargets_(agent.face_targets)) {
            if (hit.faceIdMatch && hit.faceIdTargetNames.empty()) {
                hit.faceIdTargetNames = configuredFaceTargetNames;
            }
            hit.alertCondition = hit.faceIdMatch;
            hit.answer = buildFaceIdOnlyShortAnswer_(hit.faceIdMatch, hit.faceIdTargetNames);
        }

        const bool firstPassAlertCondition = hit.alertCondition;
        const bool llmAlertCondition = hit.alertCondition;
        std::string decisionSource = "llm";
        std::string temporalDecisionSummary;
        const std::vector<std::string> preValidatedAlertRegionIds =
            sanitizeAlertRegionIds_(hit.alertRegionIds, allowedAlertRegionLabelById, nullptr);
        const bool firstPassPolygonAlertSignal =
            !polygonRegions.empty() && !preValidatedAlertRegionIds.empty();
        AlertValidationMeta_ validatorMeta;
        if (!firstPassAlertCondition && firstPassPolygonAlertSignal && !temporalPlanActive) {
            Logger::instance().logDebug(
                "job",
                "runAgentInferenceOnCamera_: promoting first-pass alert due polygon alert_region_ids cameraId=" +
                std::to_string(cameraId) + " roi_count=" +
                std::to_string(preValidatedAlertRegionIds.size())
            );
            hit.alertCondition = true;
        }

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
            hit.alertCondition = eval.alert;
            decisionSource = "temporal_engine";
            temporalDecisionSummary = eval.summary;
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
            const json publishedCrossCameraHunts = maybePublishCrossCameraHunts(
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

        json regionOut;
        regionOut["region_id"] = "full-frame";
        regionOut["region_label"] = polygonRegions.empty()
            ? "Full frame"
            : ("ROI overlays: " + std::to_string(polygonRegions.size()));
        regionOut["full_frame"] = true;
        if (!overlayRegionIds.empty()) {
            regionOut["overlay_region_ids"] = overlayRegionIds;
        }
        regionOut["answer"] = hit.answer;
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
        representativeAnswer = hit.answer;
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
        out["start_condition_step_id"] =
            (startConditionStepId >= 0) ? json(startConditionStepId) : json(false);
        out["prompt_tokens"] = sumPromptTokens;
        out["output_tokens"] = sumOutputTokens;
        out["total_tokens"] = sumTotalTokens;
        out["clip_path"] = clipPath;
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
        if (!overlayRegionIds.empty()) {
            out["overlay_region_ids"] = overlayRegionIds;
        }
        if (!representativeRegionId.empty()) {
            out["region_id"] = representativeRegionId;
        }
        if (!representativeImageB64.empty()) {
            out["image_jpeg_b64"] = representativeImageB64;
            out["image_ts_utc"] = tsUtcIso;
        }
        if (temporalPlanActive && temporalReport && owner_) {
            owner_->postAgentEvent(
                "temporal_report",
                std::optional<int>(cameraId),
                "",
                "",
                json{
                    { "job_id", jobId },
                    { "step_id", stepId },
                    { "camera_id", cameraId },
                    { "agent_id", agent.id },
                    { "operator_results", temporalOperatorResults },
                    { "answer", representativeAnswer },
                    { "decision_source", decisionSource },
                    { "llm_alert_condition", llmAlertCondition },
                    { "final_alert_condition", finalAlertAny },
                    { "temporal_decision_summary", temporalDecisionSummary }
                }
            );
        }

        clipGuard.disarm = true;
        return out.dump();
    }

    // -------------------------------
    // VIDEO MODE
    // -------------------------------
    const int normalizedRunEverySeconds = normalizedRunEverySecondsForJobAgent_(agent);
    std::vector<std::string> tempClipCleanupPaths;
    std::string assembledWindowStartPretty;
    std::string assembledWindowEndPretty;
    std::string assembledWindowStartUtc;
    std::string assembledWindowEndUtc;
    int expectedWindowSecondsForOpenAI = normalizedRunEverySeconds;

    std::string clipPath;
    if (normalizedRunEverySeconds == 60) {
        auto storedSixtySecondClipPath =
            getNextReadyCurrentDayStoredSixtySecondClipPathForJobStepCamera_(jobId, stepId, cameraId);
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
        markClipConsumedForJobStepCamera_(jobId, stepId, cameraId, clipKey);
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
            assembleAdaptivePendingJobsWindow_(jobId, stepId, cameraId);
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
        assembledWindowStartPretty = adaptiveWindow.windowStartPretty;
        assembledWindowEndPretty = adaptiveWindow.windowEndPretty;
        expectedWindowSecondsForOpenAI =
            adaptiveWindow.windowSeconds > 0 ? adaptiveWindow.windowSeconds : 10;
        (void)parseClipRangeUtcIsoFromPath_(
            fs::path(clipPath),
            assembledWindowStartUtc,
            assembledWindowEndUtc
        );
    }

    const std::vector<JobAnalysisRegion> activeRegions =
        collectEnabledAnalysisRegionsForAgent_(agent);
    const std::vector<JobAnalysisRegion> polygonRegions =
        collectPolygonOnlyRegions_(activeRegions);
    const std::vector<JobAnalysisRegion>& allowedAlertRegions =
        polygonRegions.empty() ? activeRegions : polygonRegions;
    const std::unordered_map<std::string, std::string> allowedAlertRegionLabelById =
        buildRegionLabelByIdMap_(allowedAlertRegions);
    std::vector<std::string> motionTriggeredRegionIds;

    if (agent.only_capture_on_motion && !polygonRegions.empty()) {
        std::string motionErr;
        bool motionDetected = false;
        if (!detectMotionInAnyRegionFromClip_(
                fs::path(clipPath),
                polygonRegions,
                motionDetected,
                &motionTriggeredRegionIds,
                &motionErr))
        {
            Logger::instance().logDebug(
                "job",
                "runAgentInferenceOnCamera_: ROI motion check failed (video), skipping inference cameraId=" +
                std::to_string(cameraId) + " err=" + motionErr +
                " roi_count=" + std::to_string(polygonRegions.size())
            );
            return "";
        }
        if (!motionDetected) {
            Logger::instance().logDebug(
                "job",
                "runAgentInferenceOnCamera_: skipped video inference due no ROI motion cameraId=" +
                std::to_string(cameraId) + " roi_count=" + std::to_string(polygonRegions.size())
            );
            return "";
        }
    }

    std::string clipPathForInference = clipPath;
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
    } sampledClipGuard{ &sampledClipPath };
    TempPathGuard overlayClipGuard{ &overlayClipPath };
    std::vector<std::string> drawnOverlayRegionIds;

    if (!useOpenAICompatible) {
        try {
            fs::path srcPath = fs::path(clipPath);
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
    if (temporalPlanPrepared && temporal::planUsable(temporalSlot.planEnvelope)) {
        nlohmann::json temporalInput = temporal::buildInferenceInput(
            temporalSlot.planEnvelope,
            temporalSlot.state,
            cameraId,
            temporalDecisionNowIso,
            seg.startTs,
            seg.endTs
        );
        if (activeCrossCameraWatchlist.is_array() && !activeCrossCameraWatchlist.empty()) {
            temporalInput["cross_camera_watchlist"] = activeCrossCameraWatchlist;
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
    else if (activeCrossCameraWatchlist.is_array() && !activeCrossCameraWatchlist.empty()) {
        nlohmann::json temporalInput = buildCrossCameraRuntimeInput(nowIsoForInference, seg.startTs, seg.endTs);
        temporalInput["cross_camera_watchlist"] = activeCrossCameraWatchlist;
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
            totalTokens
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
            totalTokens
        );
    }

    if (faceIdOnlyMode && hasUsableFaceTargets_(agent.face_targets)) {
        if (hit.faceIdMatch && hit.faceIdTargetNames.empty()) {
            hit.faceIdTargetNames = configuredFaceTargetNames;
        }
        hit.alertCondition = hit.faceIdMatch;
        hit.answer = buildFaceIdOnlyShortAnswer_(hit.faceIdMatch, hit.faceIdTargetNames);
    }

    const bool firstPassAlertCondition = hit.alertCondition;
    const bool llmAlertCondition = hit.alertCondition;
    std::string decisionSource = "llm";
    std::string temporalDecisionSummary;
    const std::vector<std::string> preValidatedAlertRegionIds =
        sanitizeAlertRegionIds_(hit.alertRegionIds, allowedAlertRegionLabelById, nullptr);
    const bool firstPassPolygonAlertSignal =
        !polygonRegions.empty() && !preValidatedAlertRegionIds.empty();
    AlertValidationMeta_ validatorMeta;
    if (!firstPassAlertCondition && firstPassPolygonAlertSignal && !temporalPlanActive) {
        Logger::instance().logDebug(
            "job",
            "runAgentInferenceOnCamera_: promoting first-pass alert due polygon alert_region_ids (video) cameraId=" +
            std::to_string(cameraId) + " roi_count=" +
            std::to_string(preValidatedAlertRegionIds.size())
        );
        hit.alertCondition = true;
    }

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
        hit.alertCondition = eval.alert;
        decisionSource = "temporal_engine";
        temporalDecisionSummary = eval.summary;
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
        const json publishedCrossCameraHunts = maybePublishCrossCameraHunts(
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

    json regionOut;
    regionOut["region_id"] = "full-frame";
    regionOut["region_label"] = polygonRegions.empty()
        ? "Full frame"
        : ("ROI overlays: " + std::to_string(polygonRegions.size()));
    regionOut["full_frame"] = true;
    regionOut["answer"] = hit.answer;
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
    representativeAnswer = hit.answer;
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
    out["start_condition_step_id"] =
        (startConditionStepId >= 0) ? json(startConditionStepId) : json(false);
    out["prompt_tokens"] = sumPromptTokens;
    out["output_tokens"] = sumOutputTokens;
    out["total_tokens"] = sumTotalTokens;
    out["clip_path"] = clipPath;
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

    if (temporalPlanActive && temporalReport && owner_) {
        owner_->postAgentEvent(
            "temporal_report",
            std::optional<int>(cameraId),
            "",
            "",
            json{
                { "job_id", jobId },
                { "step_id", stepId },
                { "camera_id", cameraId },
                { "agent_id", agent.id },
                { "operator_results", temporalOperatorResults },
                { "answer", representativeAnswer },
                { "decision_source", decisionSource },
                { "llm_alert_condition", llmAlertCondition },
                { "final_alert_condition", finalAlertAny },
                { "temporal_decision_summary", temporalDecisionSummary }
            }
        );
    }

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

static bool extractLastFrameJpegDataUrlFromMp4_(
    const fs::path& srcMp4Path,
    std::string& outJpegDataUrl,
    std::string* outErr = nullptr)
{
    outJpegDataUrl.clear();

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
    jpgPath += ".lastframe_" + nowMs_() + ".jpg";

    std::wstring ffmpegW = utf8ToWide(ffmpegPath.string());
    std::wstring inW = utf8ToWide(srcMp4Path.string());
    std::wstring outW = utf8ToWide(jpgPath.string());

    auto runExtract = [&](bool useLastMoment) -> int {
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
        return runProcessAndWaitWin_(cmdLine);
    };

    int rc = runExtract(true);
    if (rc != 0 || !fs::exists(jpgPath, ec) || ec) {
        ec.clear();
        rc = runExtract(false); // fallback: first decodable frame
    }

    if (rc != 0 || !fs::exists(jpgPath, ec) || ec) {
        if (outErr) *outErr = "ffmpeg frame extract failed rc=" + std::to_string(rc);
        return false;
    }

    std::vector<unsigned char> jpgBytes;
    if (!readBinaryFile_(jpgPath, jpgBytes) || jpgBytes.empty()) {
        std::error_code rmEc;
        fs::remove(jpgPath, rmEc);
        if (outErr) *outErr = "failed reading extracted jpg";
        return false;
    }

    const std::string b64 = base64EncodeBytes_(jpgBytes.data(), jpgBytes.size());
    std::error_code rmEc;
    fs::remove(jpgPath, rmEc);

    if (b64.empty()) {
        if (outErr) *outErr = "failed to base64 encode extracted jpg";
        return false;
    }

    outJpegDataUrl = ensureDataUrlBase64_(b64, "image/jpeg");
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
    if (nominalSeconds > 0) {
        // Clip suffix (_10s/_60s/_300s) is the most stable signal for media content duration.
        contentDurationSeconds = static_cast<double>(nominalSeconds);
    }
    if (contentDurationSeconds <= 0.0) {
        contentDurationSeconds = 1.0;
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
    fs::file_time_type lastWrite{};
};

static std::vector<PendingJobClip_> collectPendingJobsClipsForCamera_(
    int jobId,
    int stepId,
    int cameraId)
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
        fs::path processingPath = clip.path;
        processingPath += ".processing";

        std::error_code ec;
        fs::rename(clip.path, processingPath, ec);
        if (ec) {
            result.error = "failed to claim clip for processing";
            return result;
        }

        markClipConsumedForJobStepCamera_(jobId, stepId, cameraId, clip.clipKey);
        result.status = VideoWindowAssemblyStatus::Assembled;
        result.clipPath = processingPath.string();
        result.windowStartPretty = clip.startPretty;
        result.windowEndPretty = clip.endPretty;
        result.windowSeconds = 10;
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
    int cameraId)
{
    VideoWindowAssemblyResult result;
    result.status = VideoWindowAssemblyStatus::Failed;

    const std::vector<PendingJobClip_> pending =
        collectPendingJobsClipsForCamera_(jobId, stepId, cameraId);
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
    const int windowSeconds = clipCount * 10;
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

    for (const auto& srcPath : segmentPaths) {
        std::error_code rmEc;
        fs::remove(srcPath, rmEc);
    }

    markClipConsumedForJobStepCamera_(jobId, stepId, cameraId, last.clipKey);
    result.status = VideoWindowAssemblyStatus::Assembled;
    result.clipPath = assembledPath.string();
    result.cleanupPaths.push_back(assembledPath.string());
    result.windowStartPretty = first.startPretty;
    result.windowEndPretty = last.endPretty;
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

    if (clearedTemporalSlots > 0 || clearedCrossCameraSteps > 0)
    {
        Logger::instance().logDebug(
            "job",
            "clearJobEphemeralState_: job_id=" + std::to_string(jobId) +
            " temporal_slots=" + std::to_string(clearedTemporalSlots) +
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





















void JobRuntime::maybeFireAlerts_(
    const JobStartPayload& payload,
    const JobStepDef& step,
    int cameraId,
    const JobAgentDef& agent,
    const std::string& inferenceOutput
)
{
    if (inferenceOutput.empty() || !isLikelyJson_(inferenceOutput)) return;

    bool shouldAlert = false;
    std::string clipPath;
    std::string answer;
    std::string imageJpegB64;
    std::string inputType;
    std::string groupId;
    std::string groupName;
    std::string resultSource;
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

    try {
        json j = json::parse(inferenceOutput);
        shouldAlert = j.value("alert_condition", false);
        clipPath = j.value("clip_path", "");
        answer = j.value("answer", "");
        imageJpegB64 = j.value("image_jpeg_b64", "");
        inputType = j.value("input_type", "");
        groupId = j.value("group_id", "");
        groupName = j.value("group_name", "");
        resultSource = j.value("result_source", "");
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

    
    // allow 1, then pause 45s
    if (!allowTelegramAlert_(limiterKey, /*burstMax*/ 1, std::chrono::seconds(60))) {
        // IMPORTANT: we return before copying clip, so no extra temp files,
        // and the caller will still delete the original .processing clip after this.
        return;
    }
    
    std::filesystem::path preparedClipPath;
    bool preparedClipOwned = false;
    bool preparedClipAvailable = false;
    std::string preparedClipError;
    AgentCore::JobAlertVideoUploadResult uploadedVideo;

    if (!clipPath.empty()) {
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

    auto buildAlertDetails = [&](bool includeInlineImages) {
        json details = {
            {"camera_id", cameraId},
            {"agent_id", agent.id},
            {"agent_key", agent.agent_key},
            {"priority_level", agent.priority_level},
            {"prompt_template", agent.prompt_template},
            {"alert_condition_text", agent.alert_condition_text},
            {"negative_condition_text", agent.negative_condition_text},

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

        if (!cameraName.empty())
            details["camera_name"] = cameraName;

        return details;
    };

    auto postAlertEvent = [&](json details) {
        details["job_id"] = payload.job.id;
        details["job_name"] = payload.job.name;
        details["step_id"] = step.id;
        details["step_order"] = step.step_order;
        details["step_name"] = step.name;
        if (!owner_) {
            return AgentCore::AgentEventPostResult{};
        }
        return owner_->postAgentEventWithResult("job_alert_triggered", std::nullopt, payload.job.user_id, "", details);
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

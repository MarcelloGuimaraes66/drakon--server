// JobRuntime.cpp
#include "JobRuntime.h"
#include "JobPayloadParser.h"

#include "../core/AgentCore.h"      // adjust include paths to your tree
#include "../camera/CameraSession.h"
#include "../comm/TelegramNotifier.h"


#include <algorithm>
#include <stdexcept>

#include <fstream>
#include <cctype>

#include <tuple>
#include <utility>
#include <chrono>
#include <thread>
#include <vector>
#include <unordered_set>
#include <string>
#include <system_error>

#include <filesystem>
#include <optional>

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





static fs::path getJobsTempDirForJobStepCamera(int jobId, int stepId, const std::string& cameraId)
{
    fs::path base = fs::temp_directory_path();
    base /= "jobsInferencePerceptrum";
    base /= "Job_" + std::to_string(jobId);
    base /= "step_" + std::to_string(stepId);
    base /= "cam_" + cameraId;
    return base;
}



static fs::path getJobsTempDirForJobCamera(int jobId, const std::string& cameraId)
{
    fs::path base = fs::temp_directory_path();
    base /= "jobsInferencePerceptrum";
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
    fs::path base = fs::temp_directory_path();
    base /= "inferenceLoopPerceptrum";
    base /= "cam_" + cameraId;
    return base;
}

static fs::path getJobsTempDirForCameraId(const std::string& cameraId)
{
    fs::path base = fs::temp_directory_path();
    base /= "jobsInferencePerceptrum";
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

    // cooldown ended (or never started) — if we had cooled down, reset burst counter
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



static std::optional<std::string> getOldestMp4InDir(const fs::path& dir)
{
    try {
        std::error_code ec;

        if (!fs::exists(dir, ec) || !fs::is_directory(dir, ec)) return std::nullopt;

        fs::path bestPath;
        fs::file_time_type bestTime;
        bool found = false;

        for (const auto& entry : fs::directory_iterator(dir, ec)) {
            if (ec) break;
            if (!entry.is_regular_file()) continue;
            if (entry.path().extension() != ".mp4") continue; // ignores .tmp

            auto t = entry.last_write_time(ec);
            if (ec) continue;

            if (!found || t < bestTime) {
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


static std::optional<std::string> getOldestJobsClipForCamera(int jobId, int stepId, const std::string& cameraId)
{
    return getOldestMp4InDir(getJobsTempDirForJobStepCamera(jobId, stepId, cameraId));
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

    // Move folder out of the hot path so new jobs won’t collide with leftovers
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
    fs::path dir = fs::temp_directory_path()
        / "jobsInferencePerceptrum"
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







static bool parseJobClipFilename(
    const std::string& filename, // ex: "3_20260214_123943_20260214_123953_10s.mp4"
    int& outCameraId,
    std::string& outStartPretty, // "14/02/2026 12:39:43"
    std::string& outEndPretty    // "14/02/2026 12:39:53"
) {
    // remove extensão
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





JobRuntime::JobRuntime(AgentCore* owner) : owner_(owner) {}
JobRuntime::~JobRuntime() {
    std::lock_guard<std::mutex> lk(mu_);
    for (auto& [jobId, inst] : running_) {
        inst->cancel = true;
        if (inst->worker.joinable()) inst->worker.join();
    }
    running_.clear();
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

    inst->worker = std::thread([this, inst]() {
        this->runJob_(inst);
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
    catch (...) {}

    if (jobId < 0) return;

    std::shared_ptr<JobInstance> inst;
    {
        std::lock_guard<std::mutex> lk(mu_);
        auto it = running_.find(jobId);
        if (it == running_.end()) return;
        inst = it->second;
        inst->cancel = true;
    }
    if (inst && inst->worker.joinable()) inst->worker.join();

    {
        std::lock_guard<std::mutex> lk(mu_);
        running_.erase(jobId);
    }

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
                if (v == "negativo" || v == "negative" || v == "neg" || v == "nao" || v == "não" || v == "no" || v == "false") return false;
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
    a.input_type = g.input_type;
    a.priority_level = g.priority_level;
    if (a.priority_level.empty()) a.priority_level = "MEDIUM";
    return a;
}


static bool stepNeedsVideoCaptureForCamera_(const JobStepDef& step, int cameraId);


bool JobRuntime::stepNeedsVideoCaptureForCamera_(const JobStepDef& step, int cameraId) const
{
    return ::stepNeedsVideoCaptureForCamera_(step, cameraId);
}


void JobRuntime::runJob_(std::shared_ptr<JobInstance> job) {
    // Enable “copy 10s clips to jobs temp” for all cameras used by this job.
    //JobsCaptureGuard jobsCopyGuard(owner_, job->payload.job.id, job->payload.all_camera_ids);

    //JobsCaptureGuard jobsCopyGuard(owner_, job->payload.all_camera_ids);

    const auto& J = job->payload.job;

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

        auto startStep = [&](JobInstance::StepRun& run) {
            auto& step = run.def;

            run.state = JobInstance::StepState::Running;
            run.startedAt = std::chrono::steady_clock::now();
            run.deadline = run.startedAt + std::chrono::seconds(std::max(0, step.timeout_seconds));
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

                    // Só liga cópia de MP4 pro jobs temp se o agent desse target for VIDEO
                    if (stepNeedsVideoCaptureForCamera_(step, camId)) {
                        owner_->jobsCaptureAcquire(camId, job->payload.job.id, step.id);
                    }
                }
            }

            postStepEvent_("job_step_started", J, step, json{
                {"timeout_seconds", step.timeout_seconds},
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

                    while (!job->cancel && !run.cancel && std::chrono::steady_clock::now() < run.deadline) {

                        const std::string startConditionText = buildStartConditionTextForGroup();

                        // -------------------------------
                        // IMAGE GROUP (single Gemini request)
                        // -------------------------------
                        if (isImageGroup) {
                            if (!owner_) break;

                            std::vector<GroupImageInput> inputs;
                            inputs.reserve(pg.camera_ids.size());

                            for (int camId : pg.camera_ids) {
                                CameraSession* sess = owner_->getCameraSession(camId);
                                if (!sess) continue;

                                GroupImageInput gi;
                                gi.cameraId = camId;
                                gi.cameraName = cameraNameById(camId);
                                gi.snapshotTsUtcIso = ""; // optional: fill if you have a snapshot timestamp
                                gi.jpegBase64 = sess->getLastJobStillJpegBase64();

                                // NEW: pipeline input per camera
                                gi.injectedInput = resolvePipelineInputsForCamera_(job, step, camId, stepsById);

                                if (!gi.jpegBase64.empty()) inputs.push_back(std::move(gi));
                            }

                            // If no valid snapshots, just wait and retry
                            if (inputs.empty()) {
                                std::this_thread::sleep_for(std::chrono::seconds(1));
                                continue;
                            }

                            std::unordered_map<int, std::string> jpegByCam;
                            jpegByCam.reserve(inputs.size());
                            for (const auto& gi : inputs) {
                                if (!gi.jpegBase64.empty()) jpegByCam[gi.cameraId] = gi.jpegBase64;
                            }

                            // 1 request for the group
                            int pt = 0, ot = 0, tt = 0;
                            VideoHit hit = owner_->callGeminiVisionImageGroupJOB_(
                                inputs,
                                /*groupPrompt*/ pg.g.prompt_template,
                                /*alertConditionText*/ pg.g.alert_condition_text,
                                /*startConditionText*/ startConditionText,
                                /*modelTier*/ modelTier,
                                pt, ot, tt
                            );

                            const JobAgentDef virtAgent = agentFromGroup_(pg.g);

                            // Split results per camera
                            if (hit.answer.empty() || !isLikelyJson_(hit.answer)) {
                                std::this_thread::sleep_for(std::chrono::seconds(1));
                                continue;
                            }

                            try {
                                json outJ = json::parse(hit.answer);
                                if (!outJ.contains("results") || !outJ["results"].is_array()) {
                                    std::this_thread::sleep_for(std::chrono::seconds(1));
                                    continue;
                                }

                                // camera_id -> target_id (step-local), so backend can fetch relevant images by target id
                                auto targetIdForCamera = [&](int camId) -> int {
                                    for (const auto& t : step.targets) {
                                        if (t.camera_id == camId) return t.id;
                                    }
                                    return -1;
                                };

                                std::vector<int> alertCameraIds;
                                std::vector<int> alertTargetIds;
                                json normResults = json::array();

                                for (auto& r : outJ["results"]) {
                                    if (!r.is_object()) continue;

                                    const int camId = r.value("camera_id", -1);
                                    if (camId < 0) continue;

                                    // Keep provenance
                                    r["agent_key"] = virtAgent.agent_key;

                                    r["group_id"] = pg.g.id;
                                    r["group_name"] = pg.g.name;

                                    // IMPORTANT: allow maybeFireAlerts_() to save an alert image
                                    // by embedding the snapshot base64 into the per-camera JSON output.
                                    // Only attach when alert_condition is true (so you store only important images).
                                    const bool alert = r.value("alert_condition", false);
                                    if (alert) {
                                        auto it = jpegByCam.find(camId);
                                        if (it != jpegByCam.end() && !it->second.empty()) {
                                            r["image_jpeg_b64"] = it->second; // can be data URL or raw base64; your writer should handle both
                                        }
                                    }
                                    normResults.push_back(r);
                                    if (alert) {
                                        alertCameraIds.push_back(camId);
                                        const int tid = targetIdForCamera(camId);
                                        if (tid >= 0) alertTargetIds.push_back(tid);
                                    }

                                    const std::string one = r.dump();

                                    {
                                        std::lock_guard<std::mutex> lk(job->outputsMu);
                                        StepOutput& so = job->outputs[step.id];
                                        so.last_output_by_camera[camId] = one;
                                        so.history_by_camera[camId].push_back(one);
                                        so.aggregated_output = one; // keep last
                                    }

                                    // Fire alerts per camera (reuse existing logic)
                                    maybeFireAlerts_(job->payload, step, camId, virtAgent, one);

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


                                // Store group-level aggregated output (includes alert target ids)
                                json summary;
                                summary["group_id"] = pg.g.id;
                                summary["group_name"] = pg.g.name;
                                summary["agent_key"] = virtAgent.agent_key;
                                summary["results"] = normResults;
                                summary["alert_camera_ids"] = alertCameraIds;
                                summary["alert_target_ids"] = alertTargetIds;

                                {
                                    std::lock_guard<std::mutex> lk(job->outputsMu);
                                    StepOutput& so = job->outputs[step.id];
                                    so.aggregated_output = summary.dump();
                                }
                            }
                            catch (...) {
                                // ignore parse errors
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
                    });
            }



            for (const auto& tgt : legacyTargets) {
                run.workers.emplace_back([this, job, &run, &step, &stepsById, tgt]() {
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

                    while (!job->cancel && !run.cancel && std::chrono::steady_clock::now() < run.deadline) {
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
                    if (stepNeedsVideoCaptureForCamera_(step, camId)) {
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

        // Scheduler loop: start pending steps when conditions are satisfied.
        while (!job->cancel) {
            bool anyRunning = false;
            bool anyPending = false;

            // Start eligible pending steps
            for (auto& [sid, run] : job->stepRuns) {
                if (run.state == JobInstance::StepState::Pending) {
                    anyPending = true;
                    if (conditionSatisfied_(job, run.def, stepsById, job->stepRuns)) {
                        startStep(run);
                    }
                }
            }

            // Finalize running steps that hit timeout
            for (auto& [sid, run] : job->stepRuns) {
                if (run.state == JobInstance::StepState::Running) {
                    anyRunning = true;
                    if (std::chrono::steady_clock::now() >= run.deadline) {
                        finalizeStep(run, "timeout");
                    }
                }
            }

            // Done?
            bool allDone = true;
            for (const auto& [sid, run] : job->stepRuns) {
                if (run.state == JobInstance::StepState::Pending || run.state == JobInstance::StepState::Running) {
                    allDone = false;
                    break;
                }
            }

            if (allDone) break;

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
            cleanupJobFolderAsync(J.id);
            return;
        }

        postJobEvent_("job_completed", J, json{ {"job_id", J.id}, {"job_name", J.name} });
        cleanupJobFolderAsync(J.id);
    }
    catch (const std::exception& e) {
        postJobEvent_("job_failed", J, json{
            {"job_id", J.id},
            {"job_name", J.name},
            {"error", e.what()}
            });
        cleanupJobFolderAsync(J.id);
    }
    catch (...) {
        postJobEvent_("job_failed", J, json{
            {"job_id", J.id},
            {"job_name", J.name},
            {"error", "unknown"}
            });
        cleanupJobFolderAsync(J.id);
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




static bool stepNeedsVideoCaptureForCamera_(const JobStepDef& step, int cameraId)
{
    auto normIsImage = [](const std::string& s) {
        std::string it = s;
        for (auto& ch : it) ch = (char)std::tolower((unsigned char)ch);
        return it == "image";
        };

    // ------------------------------------------------------------
    // NEW: inference_groups override agents[] for cameras in group
    // If camera is in any group:
    //   - if ANY matching group is video => needs video capture
    //   - else (only image groups) => no video capture
    // ------------------------------------------------------------
    bool isInAnyGroup = false;
    bool needsVideoByGroup = false;

    if (!step.inference_groups.empty()) {
        // Resolve targetId -> cameraId using step.targets
        auto targetIdToCam = [&](int targetId) -> std::optional<int> {
            for (const auto& t : step.targets) {
                if (t.id == targetId) return t.camera_id;
            }
            return std::nullopt;
            };

        for (const auto& g : step.inference_groups) {
            bool cameraInThisGroup = false;

            for (int tid : g.target_ids) {
                auto camOpt = targetIdToCam(tid);
                if (camOpt.has_value() && camOpt.value() == cameraId) {
                    cameraInThisGroup = true;
                    break;
                }
            }

            if (!cameraInThisGroup) continue;

            isInAnyGroup = true;

            // group input_type default is "video"
            if (!normIsImage(g.input_type)) {
                needsVideoByGroup = true;
                break; // video wins
            }
        }

        if (isInAnyGroup) {
            return needsVideoByGroup;
        }
    }

    // ------------------------------------------------------------
    // LEGACY: no group => follow agents[] rules
    // ------------------------------------------------------------
    bool hasSpecificAgent = false;
    bool anySpecificNeedsVideo = false;
    const JobAgentDef* fallbackDefault = nullptr;

    for (const auto& a : step.agents) {
        if (a.camera_id.has_value() && *a.camera_id == cameraId) {
            hasSpecificAgent = true;
            if (!normIsImage(a.input_type)) {
                anySpecificNeedsVideo = true;
            }
        }
        if (!a.camera_id.has_value() && !fallbackDefault) {
            fallbackDefault = &a;
        }
    }

    if (hasSpecificAgent) return anySpecificNeedsVideo;
    if (fallbackDefault) return !normIsImage(fallbackDefault->input_type);

    return false;
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

    // -------------------------------
    // IMAGE MODE (NO MP4 / NO SEGMENT)
    // -------------------------------
    if (isImage) {
        if (!owner_) return "";

        // Build prompt (with optional injected pipeline input)
        std::string finalPrompt = agent.prompt_template;
        if (!injectedInput.empty() && injectedInput != "__MISSING_INPUT__") {
            finalPrompt += "\n\nINPUT_FROM_PREVIOUS_STEP:\n" + injectedInput + "\n";
        }

        // Grab last snapshot from CameraSession
        CameraSession* sess = owner_->getCameraSession(cameraId);
        if (!sess) return "";

        std::string jpegB64 = sess->getLastJobStillJpegBase64();
        if (jpegB64.empty()) return "";

        std::string tsUtcIso = sess->getLastJobStillTsUtcIso();

        int promptTokens = 0, outputTokens = 0, totalTokens = 0;

        VideoHit hit = owner_->callGeminiVisionImageJOB_(
            cameraId,
            jpegB64,
            finalPrompt,
            /*uploadedImageBase64*/ "",
            /*alertConditionText*/ alertConditionText,
            /*startConditionText*/ startConditionText,
            modelTier,
            tsUtcIso,
            promptTokens,
            outputTokens,
            totalTokens
        );

        // Return compact JSON for storage (NO clip_path)
        json out;
        out["agent_key"] = agent.agent_key;
        out["camera_id"] = cameraId;
        out["input_type"] = "image";
        out["answer"] = hit.answer;
        out["alert_condition"] = hit.alertCondition;
        out["start_condition_step_id"] = (hit.startConditionStepId >= 0) ? json(hit.startConditionStepId) : json(false);
        out["prompt_tokens"] = promptTokens;
        out["output_tokens"] = outputTokens;
        out["total_tokens"] = totalTokens;
        if (hit.alertCondition) {
            out["image_jpeg_b64"] = jpegB64;
            out["image_ts_utc"] = tsUtcIso;
        }

        return out.dump();
    }

    // -------------------------------
    // VIDEO MODE (existing MP4 flow)
    // -------------------------------

    // 1) Acquire a recent 10s MP4 clip path.
    auto clipOpt = getOldestJobsClipForCamera(jobId, stepId, std::to_string(cameraId));
    if (!clipOpt) return ""; // no clip available yet

    std::string clipPath = *clipOpt;

    // Rename to ".processing" to avoid re-processing
    try {
        std::error_code ec;
        fs::path pth = fs::path(clipPath);
        fs::path processing = pth;
        processing += ".processing";
        fs::rename(pth, processing, ec);
        if (!ec) {
            clipPath = processing.string();
        }
    }
    catch (...) {
        // ignore
    }

    // 2) Build prompt (with optional injected pipeline input)
    std::string finalPrompt = agent.prompt_template;
    if (!injectedInput.empty() && injectedInput != "__MISSING_INPUT__") {
        finalPrompt += "\n\nINPUT_FROM_PREVIOUS_STEP:\n" + injectedInput + "\n";
    }

    // 3) Read mp4 bytes
    std::vector<std::uint8_t> bytes;
    {
        std::ifstream ifs(clipPath, std::ios::binary);
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
    seg.sourceFilePath = clipPath;
    seg.cameraId = cameraId;

    std::filesystem::path p(clipPath);
    int camIdFromName = -1;
    std::string startPretty, endPretty;

    if (parseJobClipFilename(p.filename().string(), camIdFromName, startPretty, endPretty)) {
        seg.startTs = startPretty;
        seg.endTs = endPretty;
    }
    else {
        seg.startTs.clear();
        seg.endTs.clear();
    }


    int promptTokens = 0, outputTokens = 0, totalTokens = 0;
    VideoHit hit = owner_->callGeminiVisionVideoSegmentJOB_(
        seg,
        finalPrompt,
        /*uploadedImageBase64*/ "",
        /*alertConditionText*/ alertConditionText,
        /*startConditionText*/ startConditionText,
        modelTier,
        promptTokens,
        outputTokens,
        totalTokens
    );

    // 5) Return compact JSON for storage
    json out;
    out["agent_key"] = agent.agent_key;
    out["camera_id"] = cameraId;
    out["input_type"] = "video";
    out["answer"] = hit.answer;
    out["alert_condition"] = hit.alertCondition;
    out["start_condition_step_id"] = (hit.startConditionStepId >= 0) ? json(hit.startConditionStepId) : json(false);
    out["prompt_tokens"] = promptTokens;
    out["output_tokens"] = outputTokens;
    out["total_tokens"] = totalTokens;
    out["clip_path"] = clipPath;

    return out.dump();
}
























static fs::path jobImagesRoot_() {
    // Igual ao jobClipsRoot_() (padronizado)
    return fs::path("C:\\PerceptrumData\\job_alert_images");
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
    return std::filesystem::path("C:\\PerceptrumData\\job_alert_clips");
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

    // Convert full EXE path â parent folder
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

    // ✅ Use whatever runner you already use for ffmpeg commands
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

    try {
        json j = json::parse(inferenceOutput);
        shouldAlert = j.value("alert_condition", false);
        clipPath = j.value("clip_path", "");
        answer = j.value("answer", "");
        imageJpegB64 = j.value("image_jpeg_b64", "");
        inputType = j.value("input_type", "");
        groupId = j.value("group_id", "");
        groupName = j.value("group_name", "");
    }
    catch (...) {
        return;
    }

    if (!shouldAlert) return;


    if (imageJpegB64.empty()) {
        // Se não tem clip, é praticamente “image mode”
        const bool looksLikeImage = clipPath.empty() || inputType == "image";

        if (looksLikeImage && owner_) {
            if (CameraSession* sess = owner_->getCameraSession(cameraId)) {
                imageJpegB64 = sess->getLastJobStillJpegBase64();
            }
        }
    }

    // Burst limiter: per job+step+targetCam+agent
    const std::string limiterKey =
        "job:" + std::to_string(payload.job.id) +
        "|step:" + std::to_string(step.id) +
        "|cam:" + std::to_string(cameraId) +
        "|agent:" + agent.agent_key;

    
    // allow 1, then pause 45s
    if (!allowTelegramAlert_(limiterKey, /*burstMax*/ 1, std::chrono::seconds(60))) {
        // IMPORTANT: we return before copying clip, so no extra temp files,
        // and the caller will still delete the original .processing clip after this.
        return;
    }
    


    std::string videoUrl;  // what frontend will use
    std::string backendClipPathStr;

    if (!clipPath.empty()) {
        std::error_code ec;
        std::filesystem::path src(clipPath);

        if (std::filesystem::exists(src, ec) && !ec) {
            std::filesystem::path dst = makeJobBackendClipPath_(cameraId);

            std::string err;
            bool ok = transcodeToWebMp4_(src, dst, &err);

            if (ok) {
                backendClipPathStr = dst.string();

                // Build URL relative to backend endpoint:
                // /api/job-clips/cam_<id>/<filename>
                const std::string camDir = "cam_" + std::to_string(cameraId);
                const std::string filename = dst.filename().string();
                videoUrl = "/api/job-clips/" + camDir + "/" + filename;
            }
            else {
                Logger::instance().logDebug("job", "Failed to create backend clip: " + err);
            }
        }
    }

    std::string imageUrl;
    std::string backendImagePathStr;

    if (!imageJpegB64.empty()) {
        std::filesystem::path dst = makeJobBackendImagePath_(cameraId); // you implement, like makeJobBackendClipPath_
        if (writeJpegBase64ToFile_(imageJpegB64, dst)) {                // implement decode+write
            backendImagePathStr = dst.string();
            const std::string camDir = "cam_" + std::to_string(cameraId);
            const std::string filename = dst.filename().string();
            imageUrl = "/api/job-images/" + camDir + "/" + filename;    // analogous to /api/job-clips/
        }
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

    // 2) Fallback: step.targets has camera_name too (it’s already in JobTypes.h)
    if (cameraName.empty()) {
        for (const auto& t : step.targets) {
            if (t.camera_id == cameraId) {
                cameraName = t.camera_name;
                break;
            }
        }
    }

    {
        json details = {
            {"camera_id", cameraId},
            {"agent_id", agent.id},
            {"agent_key", agent.agent_key},
            {"priority_level", agent.priority_level},
            {"prompt_template", agent.prompt_template},
            {"alert_condition_text", agent.alert_condition_text},

            // no specific rule context here
            {"channel", "none"},
            {"rule_id", nullptr},
            {"message_template", ""},

            {"clip_path", clipPath},
            {"answer", answer},

            {"group_id", groupId.empty() ? json(nullptr) : json(groupId)},
            {"group_name", groupName.empty() ? json(nullptr) : json(groupName)},


        };

        if (!videoUrl.empty()) {
            details["video_url"] = videoUrl;
            details["backend_clip_path"] = backendClipPathStr; // optional debug
        }

        if (!imageUrl.empty()) {
            details["image_url"] = imageUrl;
            details["backend_image_path"] = backendImagePathStr; // optional debug, like backend_clip_path
        }

        if (!cameraName.empty())
            details["camera_name"] = cameraName;

        postStepEvent_("job_alert_triggered", payload.job, step, details);
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

            if (!clipPath.empty()) {
                std::error_code ec;
                std::filesystem::path src(clipPath);
                if (std::filesystem::exists(src, ec) && !ec) {
                    uploadCopy = makeTelegramUploadCopyPath_(cameraId);
                    std::filesystem::copy_file(src, uploadCopy,
                        std::filesystem::copy_options::overwrite_existing, ec);
                    hasCopy = (!ec && std::filesystem::exists(uploadCopy, ec) && !ec);
                }
            }

            // Async send (detached) — does not block job thread
            std::thread([ts, msg, hasCopy, uploadCopy]() mutable {
                std::string err;

                // 1) send text message (optional but usually desirable)
                TelegramNotifier::SendTelegramMessage(ts, msg, &err);

                // 2) send document (10s clip)
                if (hasCopy) {
                    TelegramNotifier::SendDocument(ts, uploadCopy.string(), msg, &err);

                    // cleanup upload copy
                    std::error_code delEc;
                    std::filesystem::remove(uploadCopy, delEc);
                }
                }).detach();
        }
    }
}







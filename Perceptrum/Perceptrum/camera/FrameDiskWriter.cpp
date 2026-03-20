#include "FrameDiskWriter.h"
#include <iomanip>
#include <sstream>
#include <vector>
#include <algorithm>
#include <fstream>
#include "../logging/Logging.h"
#include "../generated/Branding.h"
#include <mutex>
#include <cmath>


using Clock = std::chrono::steady_clock;
namespace fs = std::filesystem;

static bool parseClipNameParts(
    const std::string& filename,
    std::string& outCameraId,
    std::string& outStartDate,
    std::string& outStartTime,
    std::string& outEndDate,
    std::string& outEndTime);

static bool parseClipLocalTimestamp_(
    const std::string& yyyymmdd,
    const std::string& hhmmss,
    std::chrono::system_clock::time_point& outTp);

static std::chrono::system_clock::time_point fileTimeToSystemClock_(
    const fs::file_time_type& ft);

#ifdef _WIN32

// Media Foundation / COM
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <wrl/client.h>

#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfreadwrite.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "wmcodecdspuuid.lib")

#include <opencv2/imgproc.hpp>







// Helper: where we drop 10s clips for real-time inference
static std::filesystem::path getInferenceTempDirForCamera(const std::string& cameraId)
{
    // On Windows this is typically: C:\Users\<user>\AppData\Local\Temp
    std::filesystem::path base = AppBrand::inferenceLoopTempRoot();
    base /= "cam_" + cameraId;
    return base;
}

// Helper: copy a finished 10s clip to the inference temp folder
static bool copyTenSecondClipToInferenceTemp(
    const std::string& cameraId,
    const std::string& srcPath
)
{
    try {
        auto dir = getInferenceTempDirForCamera(cameraId);

        std::error_code ec;
        std::filesystem::create_directories(dir, ec);
        if (ec) {
            Logger::instance().logDebug(
                cameraId,
                "FrameDiskWriter: create_directories inference temp failed: " +
                ec.message()
            );
            return false;
        }

        std::filesystem::path dst = dir / std::filesystem::path(srcPath).filename();

        std::filesystem::copy_file(
            srcPath,
            dst,
            std::filesystem::copy_options::overwrite_existing,
            ec
        );
        if (ec) {
            Logger::instance().logDebug(
                cameraId,
                "FrameDiskWriter: copy 10s clip to inference temp failed: " +
                ec.message() + " | src=" + srcPath + " | dst=" + dst.string()
            );
            return false;
        }

        Logger::instance().logDebug(
            cameraId,
            "FrameDiskWriter: copied 10s clip to inference temp: " + dst.string()
        );
        return true;
    }
    catch (const std::exception& ex) {
        Logger::instance().logDebug(
            cameraId,
            std::string("FrameDiskWriter: exception while copying 10s clip to inference temp: ") +
            ex.what()
        );
    }
    return false;
}





static std::filesystem::path getInferenceImagesTempDirForCamera(const std::string& cameraId)
{
    return getInferenceTempDirForCamera(cameraId) / "images";
}

static bool writeImageBytesAtomicToDir(
    const std::string& cameraId,
    const std::filesystem::path& dir,
    const std::string& fileName,
    const std::vector<uchar>& imageBytes,
    const std::string& context
)
{
    try {
        if (imageBytes.empty()) return false;

        std::error_code ec;
        std::filesystem::create_directories(dir, ec);
        if (ec) {
            Logger::instance().logDebug(
                cameraId,
                context + ": create_directories failed: " + ec.message() + " dir=" + dir.string()
            );
            return false;
        }

        std::filesystem::path finalPath = dir / fileName;
        std::filesystem::path tmpPath = finalPath;
        tmpPath += ".tmp";

        {
            std::ofstream ofs(tmpPath, std::ios::binary | std::ios::trunc);
            if (!ofs) {
                Logger::instance().logDebug(
                    cameraId,
                    context + ": failed opening temp image path: " + tmpPath.string()
                );
                return false;
            }
            ofs.write(reinterpret_cast<const char*>(imageBytes.data()), static_cast<std::streamsize>(imageBytes.size()));
            if (!ofs) {
                Logger::instance().logDebug(
                    cameraId,
                    context + ": failed writing temp image path: " + tmpPath.string()
                );
                ofs.close();
                std::filesystem::remove(tmpPath, ec);
                return false;
            }
        }

        std::filesystem::rename(tmpPath, finalPath, ec);
        if (ec) {
            std::filesystem::remove(tmpPath, ec);
            Logger::instance().logDebug(
                cameraId,
                context + ": rename temp image failed: " + ec.message() +
                " tmp=" + tmpPath.string() + " final=" + finalPath.string()
            );
            return false;
        }

        Logger::instance().logDebug(
            cameraId,
            context + ": wrote image snapshot " + finalPath.string()
        );
        return true;
    }
    catch (const std::exception& ex) {
        Logger::instance().logDebug(
            cameraId,
            context + ": exception writing image snapshot: " + ex.what()
        );
    }
    catch (...) {
        Logger::instance().logDebug(
            cameraId,
            context + ": unknown exception writing image snapshot"
        );
    }
    return false;
}

// JOBS

static std::filesystem::path getJobsTempDirForJobStepCamera(int jobId, int stepId, const std::string& cameraId)
{
    std::filesystem::path base = AppBrand::jobsInferenceTempRoot();
    base /= ("Job_" + std::to_string(jobId));
    base /= ("step_" + std::to_string(stepId));
    base /= ("cam_" + cameraId);
    return base;
}

static std::filesystem::path getJobsImagesTempDirForJobStepCamera(int jobId, int stepId, const std::string& cameraId)
{
    return getJobsTempDirForJobStepCamera(jobId, stepId, cameraId) / "images";
}

/*
static std::filesystem::path getJobsTempDirForJobCamera(int jobId, const std::string& cameraId)
{
    std::filesystem::path base = AppBrand::jobsInferenceTempRoot();
    base /= ("Job_" + std::to_string(jobId));
    base /= ("cam_" + cameraId);
    return base;
}
*/

static bool copyTenSecondClipToJobsTemp(
    int jobId,
    int stepId,
    const std::string& cameraId,
    const std::string& srcPath
)
{
    try {
        auto dir = getJobsTempDirForJobStepCamera(jobId, stepId, cameraId);

        std::error_code ec;
        std::filesystem::create_directories(dir, ec);
        if (ec) {
            Logger::instance().logDebug(cameraId, "create_directories jobs temp failed: " + ec.message());
            return false;
        }

        std::filesystem::path dstFinal = dir / std::filesystem::path(srcPath).filename();
        std::filesystem::path dstTmp = dstFinal;
        dstTmp += ".tmp";

        std::filesystem::copy_file(srcPath, dstTmp,
            std::filesystem::copy_options::overwrite_existing, ec);
        if (ec) {
            Logger::instance().logDebug(cameraId, "copy 10s clip to jobs temp failed: " + ec.message());
            return false;
        }

        std::filesystem::rename(dstTmp, dstFinal, ec);
        if (ec) {
            std::filesystem::remove(dstTmp, ec);
            Logger::instance().logDebug(cameraId, "rename jobs temp tmp->final failed: " + ec.message());
            return false;
        }

        Logger::instance().logDebug(cameraId,
            "copied 10s clip to jobs temp: " + dstFinal.string());
        return true;
    }
    catch (const std::exception& ex) {
        Logger::instance().logDebug(cameraId,
            std::string("exception while copying 10s clip to jobs temp: ") + ex.what());
    }
    return false;
}


//void FrameDiskWriter::setJobsCopyJobIdsProvider(std::function<std::vector<int>()> provider) {
    //jobsJobIdsProvider_ = std::move(provider);
//}

void FrameDiskWriter::setJobsCopyTargetsProvider(std::function<std::vector<JobsCopyTarget>()> provider) {
    jobsTargetsProvider_ = std::move(provider);
}

void FrameDiskWriter::setInferenceCopyEnabledProvider(std::function<bool()> provider) {
    inferenceCopyEnabledProvider_ = std::move(provider);
}

void FrameDiskWriter::setInferenceImageCopyEnabledProvider(std::function<bool()> provider) {
    inferenceImageCopyEnabledProvider_ = std::move(provider);
}

void FrameDiskWriter::setForceVideoCaptureProvider(std::function<bool()> provider) {
    forceVideoCaptureProvider_ = std::move(provider);
}

FrameDiskWriter::IoTelemetrySnapshot FrameDiskWriter::getIoTelemetrySnapshot() const
{
    IoTelemetrySnapshot snapshot;
    snapshot.bytesWrittenTotal = telemetryBytesWrittenTotal_.load(std::memory_order_relaxed);
    snapshot.writeLatencyTotalUs = telemetryWriteLatencyTotalUs_.load(std::memory_order_relaxed);
    snapshot.writeOperations = telemetryWriteOperations_.load(std::memory_order_relaxed);
    return snapshot;
}

void FrameDiskWriter::recordWriteTelemetry_(std::uint64_t bytesWritten, std::uint64_t latencyUs)
{
    if (bytesWritten > 0) {
        telemetryBytesWrittenTotal_.fetch_add(bytesWritten, std::memory_order_relaxed);
    }
    if (latencyUs > 0) {
        telemetryWriteLatencyTotalUs_.fetch_add(latencyUs, std::memory_order_relaxed);
    }
    telemetryWriteOperations_.fetch_add(1, std::memory_order_relaxed);
}

bool FrameDiskWriter::shouldEmitImageSnapshotOnlyNow() const
{
    if (!enabled_) return false;

    const auto now = Clock::now();
    if (!canSaveNow_(now)) return false;

    bool shouldCopyInferenceVideo = true;
    if (inferenceCopyEnabledProvider_) {
        try {
            shouldCopyInferenceVideo = inferenceCopyEnabledProvider_();
        }
        catch (...) {
            shouldCopyInferenceVideo = true;
        }
    }

    bool shouldCopyInferenceImage = false;
    if (inferenceImageCopyEnabledProvider_) {
        try {
            shouldCopyInferenceImage = inferenceImageCopyEnabledProvider_();
        }
        catch (...) {
            shouldCopyInferenceImage = false;
        }
    }

    bool forceVideoCapture = false;
    if (forceVideoCaptureProvider_) {
        try {
            forceVideoCapture = forceVideoCaptureProvider_();
        }
        catch (...) {
            forceVideoCapture = false;
        }
    }

    std::vector<JobsCopyTarget> jobsTargets;
    if (jobsTargetsProvider_) {
        try {
            jobsTargets = jobsTargetsProvider_();
        }
        catch (...) {
            jobsTargets.clear();
        }
    }

    bool hasJobsVideoDemand = false;
    bool hasJobsImageDemand = false;
    for (const auto& t : jobsTargets) {
        if (t.jobId <= 0 || t.stepId <= 0) continue;
        hasJobsVideoDemand = hasJobsVideoDemand || t.copyVideo;
        hasJobsImageDemand = hasJobsImageDemand || t.copyImage;
    }

    const bool hasImageDemand = shouldCopyInferenceImage || hasJobsImageDemand;
    const bool hasProfileVideoDemand = capture10Enabled_ || capture60Enabled_;
    const bool hasVideoDemand =
        hasProfileVideoDemand || forceVideoCapture || shouldCopyInferenceVideo || hasJobsVideoDemand;
    const bool runImageOnly = hasImageDemand && !hasVideoDemand;
    if (!runImageOnly) return false;

    if (lastImageSnapshotSaved_.time_since_epoch().count() != 0 &&
        (now - lastImageSnapshotSaved_) < imageSnapshotInterval_) {
        return false;
    }

    return true;
}



/*
static std::filesystem::path getJobsTempDirForCamera(const std::string& cameraId)
{
    std::filesystem::path base = AppBrand::jobsInferenceTempRoot();
    base /= "cam_" + cameraId;
    return base;
}
*/

/*
static void copyTenSecondClipToJobsTemp(
    const std::string& cameraId,
    const std::string& srcPath
)
{
    try {
        auto dir = getJobsTempDirForCamera(cameraId);

        std::error_code ec;
        std::filesystem::create_directories(dir, ec);
        if (ec) {
            Logger::instance().logDebug(cameraId, "create_directories jobs temp failed: " + ec.message());
            return;
        }

        std::filesystem::path dstFinal = dir / std::filesystem::path(srcPath).filename();
        std::filesystem::path dstTmp = dstFinal;
        dstTmp += ".tmp";

        // copy -> tmp
        std::filesystem::copy_file(srcPath, dstTmp,
            std::filesystem::copy_options::overwrite_existing, ec);
        if (ec) {
            Logger::instance().logDebug(cameraId, "copy 10s clip to jobs temp failed: " + ec.message());
            return;
        }

        // rename tmp -> final (atomic-ish)
        std::filesystem::rename(dstTmp, dstFinal, ec);
        if (ec) {
            // cleanup tmp if rename failed
            std::filesystem::remove(dstTmp, ec);
            Logger::instance().logDebug(cameraId, "rename jobs temp tmp->final failed: " + ec.message());
            return;
        }

        Logger::instance().logDebug(cameraId, "copied 10s clip to jobs temp: " + dstFinal.string());
    }
    catch (const std::exception& ex) {
        Logger::instance().logDebug(cameraId,
            std::string("exception while copying 10s clip to jobs temp: ") + ex.what());
    }
}
*/







#ifdef _WIN32

static std::wstring getExecutableDirW()
{
    wchar_t buffer[MAX_PATH];
    DWORD len = GetModuleFileNameW(nullptr, buffer, MAX_PATH);
    if (len == 0) {
        return L"";
    }
    std::filesystem::path exePath(buffer);
    return exePath.parent_path().wstring();
}

#endif




#ifdef _WIN32
#include <fstream>

// Run: ffmpeg -y -safe 0 -f concat -i list.txt -c copy out.mp4
// inputFiles must be in the desired order.
static bool runFfmpegConcat(const std::vector<std::string>& inputFiles,
    const std::string& outputFile,
    const std::string& cameraIdForLog)
{
    if (inputFiles.empty()) return false;

    try {
        // Make output path absolute and ensure directory exists
        fs::path outPath = fs::absolute(outputFile);
        fs::path dir = outPath.parent_path();
        fs::create_directories(dir);

        // Build a small, almost-unique temp list file name
        auto now = std::chrono::system_clock::now();
        auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
            now.time_since_epoch()).count();

        fs::path listPath = dir / ("ffconcat_" + std::to_string(ms) + ".txt");

        // Write concat list
        std::ofstream ofs(listPath);
        if (!ofs.is_open()) {
            Logger::instance().logDebug(
                cameraIdForLog,
                "runFfmpegConcat: failed to open list file " + listPath.string()
            );
            return false;
        }

        // concat demuxer format: one line per file
        // We MUST use absolute, normalized paths so ffmpeg can find them
        for (const auto& f : inputFiles) {
            fs::path absPath = fs::absolute(f);          // avoid name clash with ::abs
            // convert backslashes to forward slashes for ffmpeg
            std::string normalized = absPath.string();   // or absPath.u8string() if you prefer
            for (char& c : normalized) {
                if (c == '\\') c = '/';
            }

            ofs << "file '" << normalized << "'\n";
        }
        ofs.close();


        /*
        // Build command line; ffmpeg must be in PATH
        
        std::wstring listW = listPath.wstring();
        std::wstring outW = outPath.wstring();

        std::wstring cmdLine =
            L"\"ffmpeg\" -y -safe 0 -f concat -i \"" + listW +
            L"\" -c copy \"" + outW + L"\"";
        */


        std::wstring listW = listPath.wstring();
        std::wstring outW = outPath.wstring();

        // Build ffmpeg path: prefer bundled ffmpeg.exe next to Perceptrum.exe
        std::wstring exeDirW = getExecutableDirW();
        std::wstring ffmpegCmdW;

        if (!exeDirW.empty()) {
            // "C:\...\Perceptrum\ffmpeg.exe"
            ffmpegCmdW = L"\"" + exeDirW + L"\\ffmpeg.exe\"";
        }
        else {
            // Fallback: use PATH
            ffmpegCmdW = L"\"ffmpeg\"";
        }

        // Build command line
        /*
        std::wstring cmdLine =
            ffmpegCmdW +
            L" -y -safe 0 -f concat -i \"" + listW +
            L"\" -c copy \"" + outW + L"\"";
        */
        
        std::wstring cmdLine =
            ffmpegCmdW +
            L" -y -safe 0 -f concat -i \"" + listW + L"\""
            L" -map 0:v:0 -c:v copy -an -sn -dn"
            L" \"" + outW + L"\"";



        STARTUPINFOEXW si;
        ZeroMemory(&si, sizeof(si));
        si.StartupInfo.cb = sizeof(si);
        si.StartupInfo.dwFlags = STARTF_USESHOWWINDOW;
        si.StartupInfo.wShowWindow = SW_HIDE;

        PROCESS_INFORMATION pi;
        ZeroMemory(&pi, sizeof(pi));

        std::vector<wchar_t> cmdBuf(cmdLine.begin(), cmdLine.end());
        cmdBuf.push_back(L'\0');

        BOOL ok = CreateProcessW(
            nullptr,            // application name (use command line)
            cmdBuf.data(),      // command line
            nullptr,
            nullptr,
            FALSE,
            CREATE_NO_WINDOW,   // no console window pops up
            nullptr,
            nullptr,
            &si.StartupInfo,
            &pi
        );

        if (!ok) {
            Logger::instance().logDebug(
                cameraIdForLog,
                "runFfmpegConcat: CreateProcessW failed"
            );
            std::error_code ec;
            fs::remove(listPath, ec);
            return false;
        }
        /*
        WaitForSingleObject(pi.hProcess, INFINITE);

        DWORD exitCode = 1;
        GetExitCodeProcess(pi.hProcess, &exitCode);

        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);

        std::error_code ec;
        fs::remove(listPath, ec);

        if (exitCode != 0) {
            Logger::instance().logDebug(
                cameraIdForLog,
                "runFfmpegConcat: ffmpeg exited with code " +
                std::to_string(exitCode)
            );
            return false;
        }

        return true;
        */


        // Wait for ffmpeg to finish (max 5 seconds)
        constexpr DWORD kFfmpegTimeoutMs = 5000;
        DWORD waitRes = WaitForSingleObject(pi.hProcess, kFfmpegTimeoutMs);

        if (waitRes == WAIT_TIMEOUT) {
            Logger::instance().logDebug(
                cameraIdForLog,
                "runFfmpegConcat: ffmpeg TIMEOUT after 5s -> terminating process"
            );

            if (!TerminateProcess(pi.hProcess, 124)) {
                DWORD terr = GetLastError();
                Logger::instance().logDebug(
                    cameraIdForLog,
                    "runFfmpegConcat: TerminateProcess failed, GetLastError=" + std::to_string(terr)
                );
            }

            // Give it a moment to actually exit
            WaitForSingleObject(pi.hProcess, 2000);

            // Cleanup handles
            CloseHandle(pi.hThread);
            CloseHandle(pi.hProcess);

            // Remove concat list file
            std::error_code ec;
            fs::remove(listPath, ec);

            return false;
        }
        else if (waitRes != WAIT_OBJECT_0) {
            DWORD werr = GetLastError();
            Logger::instance().logDebug(
                cameraIdForLog,
                "runFfmpegConcat: WaitForSingleObject failed, GetLastError=" + std::to_string(werr)
            );

            CloseHandle(pi.hThread);
            CloseHandle(pi.hProcess);

            std::error_code ec;
            fs::remove(listPath, ec);

            return false;
        }

        // Process exited normally -> read exit code
        DWORD exitCode = 1;
        GetExitCodeProcess(pi.hProcess, &exitCode);

        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);

        // Remove concat list file
        std::error_code ec;
        fs::remove(listPath, ec);

        if (exitCode != 0) {
            Logger::instance().logDebug(
                cameraIdForLog,
                "runFfmpegConcat: ffmpeg exited with code " + std::to_string(exitCode)
            );
            return false;
        }

        return true;



    }
    catch (...) {
        Logger::instance().logDebug(
            cameraIdForLog,
            "runFfmpegConcat: exception thrown"
        );
        return false;
    }
}
#endif




using Microsoft::WRL::ComPtr;

/*
static void ensureMediaFoundationInitialized()
{
    static std::once_flag g_initFlag;

    std::call_once(g_initFlag, []() {
        // COM for this process (multi-threaded)
        HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) {
            // If COM already initialized in different mode, just continue.
        }

        hr = MFStartup(MF_VERSION, MFSTARTUP_FULL);
        if (FAILED(hr)) {
            // If MF fails, log error
            Logger::instance().logDebug("FrameDiskWriter",
                "MFStartup failed: " + std::to_string(hr));
        }
        });
}
*/



#ifdef _WIN32
static void ensureMediaFoundationInitialized()
{
    // 1) COM is per-thread
    thread_local bool tl_comInited = false;
    if (!tl_comInited) {
        HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        // RPC_E_CHANGED_MODE is "already initialized in a different apartment" (still usable)
        if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) {
            // If COM init fails, MF calls can be unsafe; at least log once.
            try {
                Logger::instance().logDebug("FrameDiskWriter", "CoInitializeEx failed hr=" + std::to_string(hr));
            }
            catch (...) {}
        }
        tl_comInited = true;
    }

    // 2) MFStartup is process-wide (call once)
    static std::once_flag mfFlag;
    std::call_once(mfFlag, []() {
        HRESULT hr = MFStartup(MF_VERSION, MFSTARTUP_FULL);
        if (FAILED(hr)) {
            try {
                Logger::instance().logDebug("FrameDiskWriter", "MFStartup failed hr=" + std::to_string(hr));
            }
            catch (...) {}
        }
        });
}
#endif




// Utility: UTF-8 std::string -> std::wstring
static std::wstring utf8ToWide(const std::string& s)
{
    if (s.empty()) return std::wstring();

    int len = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
    if (len <= 0) return std::wstring();

    std::wstring w;
    w.resize(static_cast<size_t>(len - 1));
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &w[0], len);
    return w;
}

// Nested encoder implementation
struct FrameDiskWriter::SegmentWriter::MfEncoder {
    ComPtr<IMFSinkWriter> sinkWriter;
    DWORD streamIndex{ 0 };
};

#endif // _WIN32

FrameDiskWriter::FrameDiskWriter(
    const std::string& cameraId,
    const std::string& baseDir,
    bool enabled,
    std::chrono::milliseconds minInterval,
    std::chrono::seconds timeOffset,
    double outputFps,
    int retentionDays,
    bool hydrateExistingSegments
)
    : cameraId_(cameraId),
    baseDir_(baseDir),
    enabled_(enabled),
    minInterval_(minInterval),
    timeOffset_(timeOffset),
    fps_(outputFps),
    retentionDays_(retentionDays > 0 ? retentionDays : 0),
    hydrateExistingSegments_(hydrateExistingSegments)
{
    lastSaved_ = Clock::now() - minInterval_;
    lastSaved10_ = lastSaved_;
    lastSaved60_ = lastSaved_;

    if (hydrateExistingSegments_) {
        initializeFromDisk_();
    }
    else {
        Logger::instance().logDebug(
            cameraId_,
            "FrameDiskWriter: starting with a clean in-memory clip queue"
        );
    }

}

void FrameDiskWriter::setEnabled(bool enabled) {
    enabled_ = enabled;
}

void FrameDiskWriter::setMinInterval(std::chrono::milliseconds interval) {
    minInterval_ = interval;
}

void FrameDiskWriter::setOutputFps(double fps) {
    setCaptureProfiles({ VideoCaptureProfile{ 10, normalizeClipFps_(fps) } });
}

void FrameDiskWriter::setCaptureProfiles(const std::vector<VideoCaptureProfile>& profiles) {
    int new10Fps = 0;
    int new60Fps = 0;

    for (const auto& profile : profiles) {
        const int normalizedSeconds = (profile.clipSeconds > 10) ? 60 : 10;
        const int normalizedFps = normalizeClipFps_(profile.fps);
        if (normalizedSeconds == 60) {
            new60Fps = (std::max)(new60Fps, normalizedFps);
        }
        else {
            new10Fps = (std::max)(new10Fps, normalizedFps);
        }
    }

    auto discardOpenClip = [&](SegmentWriter& writer,
                               int& framesInClip,
                               std::deque<std::string>& clipPaths,
                               std::chrono::steady_clock::time_point& lastWriteAt,
                               TimeParts& lastWriteTp,
                               bool& hasLastWriteTp) {
        if (!writer.isOpened()) return;

        const std::string danglingPath = writer.path;
        closeWriter_(writer);
        framesInClip = 0;
        lastWriteAt = Clock::time_point{};
        lastWriteTp = TimeParts{};
        hasLastWriteTp = false;

        if (!danglingPath.empty()) {
            auto it = std::find(clipPaths.begin(), clipPaths.end(), danglingPath);
            if (it != clipPaths.end()) {
                clipPaths.erase(it);
            }

            std::error_code rmEc;
            fs::remove(danglingPath, rmEc);
            if (rmEc) {
                Logger::instance().logDebug(
                    cameraId_,
                    "FrameDiskWriter: failed removing discarded partial clip " +
                    danglingPath + " err=" + rmEc.message()
                );
            }
        }
    };

    if ((capture10Enabled_ && new10Fps != capture10Fps_) || (!capture10Enabled_ && new10Fps > 0) ||
        (capture10Enabled_ && new10Fps == 0))
    {
        discardOpenClip(
            writer10_,
            framesIn10_,
            tenSecondPaths_,
            lastVideoFrameWriteAt10_,
            lastVideoFrameWriteTp10_,
            hasLastVideoFrameWriteTp10_
        );
    }

    if ((capture60Enabled_ && new60Fps != capture60Fps_) || (!capture60Enabled_ && new60Fps > 0) ||
        (capture60Enabled_ && new60Fps == 0))
    {
        discardOpenClip(
            writer60_,
            framesIn60_,
            sixtySecondPaths_,
            lastVideoFrameWriteAt60_,
            lastVideoFrameWriteTp60_,
            hasLastVideoFrameWriteTp60_
        );
    }

    capture10Enabled_ = new10Fps > 0;
    capture60Enabled_ = new60Fps > 0;
    capture10Fps_ = capture10Enabled_ ? new10Fps : 0;
    capture60Fps_ = capture60Enabled_ ? new60Fps : 0;

    if (capture10Enabled_) {
        minInterval10_ = intervalForFps_(capture10Fps_);
        fps_ = static_cast<double>(capture10Fps_);
        minInterval_ = minInterval10_;
    }
    else {
        minInterval10_ = std::chrono::milliseconds(0);
    }

    if (capture60Enabled_) {
        minInterval60_ = intervalForFps_(capture60Fps_);
    }
    else {
        minInterval60_ = std::chrono::milliseconds(0);
    }
}

void FrameDiskWriter::runRetentionCleanupIfDue() {
    if (retentionDays_ <= 0) return;

    constexpr auto kSweepInterval = std::chrono::hours(1);
    auto nowSteady = Clock::now();
    if (lastRetentionSweep_.time_since_epoch().count() != 0 &&
        (nowSteady - lastRetentionSweep_) < kSweepInterval) {
        return;
    }
    lastRetentionSweep_ = nowSteady;

    const auto nowSys = std::chrono::system_clock::now();
    const auto cutoff = nowSys - std::chrono::hours(24LL * static_cast<long long>(retentionDays_));

    const std::vector<fs::path> roots = {
        fs::path(baseDir_) / ("cam_" + cameraId_)
    };

    int scanned = 0;
    int deleted = 0;
    int byNameTs = 0;
    int byFileTime = 0;
    int failed = 0;

    for (const auto& root : roots) {
        std::error_code ec;
        if (!fs::exists(root, ec) || ec) continue;

        fs::recursive_directory_iterator it(root, fs::directory_options::skip_permission_denied, ec);
        fs::recursive_directory_iterator end;
        if (ec) continue;

        for (; it != end; it.increment(ec)) {
            if (ec) {
                ec.clear();
                continue;
            }

            const auto& entry = *it;
            if (!entry.is_regular_file(ec) || ec) {
                ec.clear();
                continue;
            }

            const fs::path path = entry.path();
            std::string ext = path.extension().string();
            std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char ch) {
                return static_cast<char>(std::tolower(ch));
            });
            if (ext != ".mp4") continue;

            ++scanned;

            std::chrono::system_clock::time_point clipEndTs;
            bool hasTs = false;

            std::string camId, startDate, startTime, endDate, endTime;
            if (parseClipNameParts(path.filename().string(), camId, startDate, startTime, endDate, endTime)) {
                if (parseClipLocalTimestamp_(endDate, endTime, clipEndTs)) {
                    hasTs = true;
                    ++byNameTs;
                }
            }

            if (!hasTs) {
                auto ft = entry.last_write_time(ec);
                if (!ec) {
                    clipEndTs = fileTimeToSystemClock_(ft);
                    hasTs = true;
                    ++byFileTime;
                }
                else {
                    ec.clear();
                }
            }

            if (!hasTs) {
                ++failed;
                continue;
            }

            if (clipEndTs < cutoff) {
                fs::remove(path, ec);
                if (ec) {
                    ++failed;
                    ec.clear();
                }
                else {
                    ++deleted;
                }
            }
        }
    }

    Logger::instance().logDebug(
        cameraId_,
        "FrameDiskWriter: retention sweep days=" + std::to_string(retentionDays_) +
        " scanned=" + std::to_string(scanned) +
        " deleted=" + std::to_string(deleted) +
        " byNameTs=" + std::to_string(byNameTs) +
        " byFileTime=" + std::to_string(byFileTime) +
        " failed=" + std::to_string(failed)
    );
}

bool FrameDiskWriter::canSaveNow_(Clock::time_point now) const {
    if (!enabled_) return false;
    const bool due10 =
        capture10Enabled_ &&
        (minInterval10_.count() <= 0 || (now - lastSaved10_) >= minInterval10_);
    const bool due60 =
        capture60Enabled_ &&
        (minInterval60_.count() <= 0 || (now - lastSaved60_) >= minInterval60_);
    if (!capture10Enabled_ && !capture60Enabled_) {
        const auto activeInterval = activeMinInterval_();
        if (activeInterval.count() <= 0) return true;
        return (now - lastSaved_) >= activeInterval;
    }
    return due10 || due60;
}

std::chrono::milliseconds FrameDiskWriter::activeMinInterval_() const {
    std::chrono::milliseconds best = (std::chrono::milliseconds::max)();
    if (capture10Enabled_ && minInterval10_.count() > 0) {
        best = (std::min)(best, minInterval10_);
    }
    if (capture60Enabled_ && minInterval60_.count() > 0) {
        best = (std::min)(best, minInterval60_);
    }
    if (best == (std::chrono::milliseconds::max)()) {
        return minInterval_;
    }
    return best;
}

double FrameDiskWriter::activeClipFps_() const {
    if (capture10Enabled_ && capture10Fps_ > 0) {
        return static_cast<double>(capture10Fps_);
    }
    if (capture60Enabled_ && capture60Fps_ > 0) {
        return static_cast<double>(capture60Fps_);
    }
    return fps_;
}

std::chrono::milliseconds FrameDiskWriter::intervalForFps_(double fps) {
    const int normalizedFps = normalizeClipFps_(fps);
    const int intervalMs = (std::max)(1, static_cast<int>(std::llround(1000.0 / static_cast<double>(normalizedFps))));
    return std::chrono::milliseconds(intervalMs);
}

int FrameDiskWriter::normalizeClipFps_(double fps) {
    int rounded = 1;
    if (std::isfinite(fps)) {
        rounded = static_cast<int>(std::llround(fps));
    }
    if (rounded < 1) rounded = 1;
    if (rounded > 10) rounded = 10;
    return rounded;
}

int FrameDiskWriter::probeClipFps_(const std::string& path) {
    try {
        cv::VideoCapture cap(path);
        if (!cap.isOpened()) return 0;
        const double fps = cap.get(cv::CAP_PROP_FPS);
        return normalizeClipFps_(fps);
    }
    catch (...) {
        return 0;
    }
}

FrameDiskWriter::TimeParts FrameDiskWriter::getTimeParts_() const {
    using namespace std::chrono;
    // local Windows time, no manual offset
    auto nowSys = system_clock::now();
    auto ms = duration_cast<milliseconds>(nowSys.time_since_epoch());
    std::time_t tt = static_cast<std::time_t>(ms.count() / 1000);
    int msPart = static_cast<int>(ms.count() % 1000);

    std::tm tmLocal{};
#ifdef _WIN32
    localtime_s(&tmLocal, &tt);
#else
    localtime_r(&tt, &tmLocal);
#endif
    return { tmLocal, msPart };
}




std::string FrameDiskWriter::ensureBaseDirAndMakePrefix_(const TimeParts& tp) const {
    // baseDir/cam_<id>/YYYY/MM/DD/
    std::ostringstream ossDir;
    ossDir << baseDir_ << "/cam_" << cameraId_ << "/"
        << std::put_time(&tp.tmLocal, "%Y/%m/%d");

    fs::create_directories(ossDir.str());

    std::ostringstream prefix;
    prefix << ossDir.str() << "/"
        << cameraId_ << "_"
        << std::put_time(&tp.tmLocal, "%Y%m%d_%H%M%S");
    return prefix.str(); // WITHOUT extension/suffix
}





static std::string hrToHex(HRESULT hr) {
    std::ostringstream oss;
    oss << "0x" << std::hex << std::uppercase
        << static_cast<unsigned long>(hr);
    return oss.str();
}

// Logging must never crash your thread (logger can throw if file open fails).
static void safeLogDebug(const std::string& cameraId, const std::string& msg) noexcept {
    try {
        Logger::instance().logDebug(cameraId, msg);
    }
    catch (...) {
        // last-ditch fallback: do nothing (or OutputDebugStringA if you want)
        // OutputDebugStringA((msg + "\n").c_str());
    }
}





void FrameDiskWriter::openWriterIfNeeded_(
    SegmentWriter& w,
    const std::string& path,
    const cv::Size& size,
    double fps)
{
    if (w.isOpened()) return;

#ifdef _WIN32
    try {
        ensureMediaFoundationInitialized();

        w.path = path;
        w.width = size.width;
        w.height = size.height;
        w.fps = static_cast<double>(normalizeClipFps_(fps));
        w.frameCount = 0;

        safeLogDebug(cameraId_, "FrameDiskWriter: opening MF writer at " + path);

        auto widePath = utf8ToWide(path);

        auto fail = [&](const char* step, HRESULT hr) {
            safeLogDebug(
                cameraId_,
                std::string("FrameDiskWriter: ") + step + " failed hr=" + hrToHex(hr) + " path=" + path
            );
            };

        ComPtr<IMFSinkWriter> sink;
        HRESULT hr = MFCreateSinkWriterFromURL(
            widePath.c_str(),
            nullptr,
            nullptr,
            &sink
        );
        if (FAILED(hr)) { fail("MFCreateSinkWriterFromURL", hr); return; }

        // Output type: H.264
        ComPtr<IMFMediaType> outType;
        hr = MFCreateMediaType(&outType);
        if (FAILED(hr)) { fail("MFCreateMediaType(outType)", hr); return; }

        hr = outType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
        if (FAILED(hr)) { fail("outType->SetGUID(MF_MT_MAJOR_TYPE)", hr); return; }

        hr = outType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
        if (FAILED(hr)) { fail("outType->SetGUID(MF_MT_SUBTYPE H264)", hr); return; }

        hr = outType->SetUINT32(MF_MT_AVG_BITRATE, 2000000);
        if (FAILED(hr)) { fail("outType->SetUINT32(MF_MT_AVG_BITRATE)", hr); return; }

        hr = outType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
        if (FAILED(hr)) { fail("outType->SetUINT32(MF_MT_INTERLACE_MODE)", hr); return; }

        hr = MFSetAttributeSize(
            outType.Get(), MF_MT_FRAME_SIZE,
            static_cast<UINT32>(w.width),
            static_cast<UINT32>(w.height)
        );
        if (FAILED(hr)) { fail("MFSetAttributeSize(outType frame size)", hr); return; }

        // Frame rate as rational
        UINT32 frNum = static_cast<UINT32>(w.fps * 1000.0 + 0.5);
        UINT32 frDen = 1000;
        if (frNum == 0) { frNum = 1; frDen = 1; }

        hr = MFSetAttributeRatio(outType.Get(), MF_MT_FRAME_RATE, frNum, frDen);
        if (FAILED(hr)) { fail("MFSetAttributeRatio(outType frame rate)", hr); return; }

        hr = MFSetAttributeRatio(outType.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
        if (FAILED(hr)) { fail("MFSetAttributeRatio(outType pixel aspect)", hr); return; }

        DWORD streamIndex = 0;
        hr = sink->AddStream(outType.Get(), &streamIndex);
        if (FAILED(hr)) { fail("sink->AddStream(outType)", hr); return; }

        // Input type: RGB32
        ComPtr<IMFMediaType> inType;
        hr = MFCreateMediaType(&inType);
        if (FAILED(hr)) { fail("MFCreateMediaType(inType)", hr); return; }

        hr = inType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
        if (FAILED(hr)) { fail("inType->SetGUID(MF_MT_MAJOR_TYPE)", hr); return; }

        hr = inType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_RGB32);
        if (FAILED(hr)) { fail("inType->SetGUID(MF_MT_SUBTYPE RGB32)", hr); return; }

        hr = MFSetAttributeSize(
            inType.Get(), MF_MT_FRAME_SIZE,
            static_cast<UINT32>(w.width),
            static_cast<UINT32>(w.height)
        );
        if (FAILED(hr)) { fail("MFSetAttributeSize(inType frame size)", hr); return; }

        hr = MFSetAttributeRatio(inType.Get(), MF_MT_FRAME_RATE, frNum, frDen);
        if (FAILED(hr)) { fail("MFSetAttributeRatio(inType frame rate)", hr); return; }

        hr = MFSetAttributeRatio(inType.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
        if (FAILED(hr)) { fail("MFSetAttributeRatio(inType pixel aspect)", hr); return; }

        hr = sink->SetInputMediaType(streamIndex, inType.Get(), nullptr);
        if (FAILED(hr)) { fail("sink->SetInputMediaType", hr); return; }

        hr = sink->BeginWriting();
        if (FAILED(hr)) { fail("sink->BeginWriting", hr); return; }

        // Store encoder
        try {
            w.encoder = new SegmentWriter::MfEncoder();
        }
        catch (const std::exception& e) {
            safeLogDebug(cameraId_, std::string("FrameDiskWriter: new MfEncoder threw: ") + e.what());
            return;
        }
        catch (...) {
            safeLogDebug(cameraId_, "FrameDiskWriter: new MfEncoder threw unknown exception");
            return;
        }

        w.encoder->sinkWriter = sink;
        w.encoder->streamIndex = streamIndex;
        w.opened = true;

        safeLogDebug(cameraId_, "FrameDiskWriter: MF writer opened at " + path);
    }
    catch (const std::exception& e) {
        safeLogDebug(cameraId_, std::string("FrameDiskWriter: openWriterIfNeeded_ exception: ") + e.what());
        // Make sure we don't leave it half-open
        w.opened = false;
        w.frameCount = 0;
    }
    catch (...) {
        safeLogDebug(cameraId_, "FrameDiskWriter: openWriterIfNeeded_ unknown exception");
        w.opened = false;
        w.frameCount = 0;
    }
#else
    (void)w;
    (void)path;
    (void)size;
    safeLogDebug(cameraId_, "FrameDiskWriter: Media Foundation writer not available on this platform");
#endif
}





void FrameDiskWriter::closeWriter_(SegmentWriter& w) {
    if (!w.isOpened()) return;

#ifdef _WIN32
    try {
        if (w.encoder && w.encoder->sinkWriter) {
            safeLogDebug(cameraId_, "FrameDiskWriter: closing MF writer at " + w.path);

            HRESULT hr = w.encoder->sinkWriter->Finalize();
            if (FAILED(hr)) {
                safeLogDebug(
                    cameraId_,
                    "FrameDiskWriter: sinkWriter->Finalize failed hr=" + hrToHex(hr) + " path=" + w.path
                );
            }

            w.encoder->sinkWriter.Reset();
        }
    }
    catch (const std::exception& e) {
        safeLogDebug(cameraId_, std::string("FrameDiskWriter: closeWriter_ exception: ") + e.what());
    }
    catch (...) {
        safeLogDebug(cameraId_, "FrameDiskWriter: closeWriter_ unknown exception");
    }

    // Always clean up pointer even if Finalize/logging misbehaves
    try {
        delete w.encoder;
    }
    catch (...) {
        // don't allow destructor issues to kill the thread
    }
    w.encoder = nullptr;
#endif

    w.opened = false;
    w.frameCount = 0;
}





/*
void FrameDiskWriter::openWriterIfNeeded_(
    SegmentWriter& w,
    const std::string& path,
    const cv::Size& size)
{
    if (w.isOpened()) return;

#ifdef _WIN32
    ensureMediaFoundationInitialized();

    w.path = path;
    w.width = size.width;
    w.height = size.height;
    w.fps = fps_;
    w.frameCount = 0;

    Logger::instance().logDebug(
        cameraId_,
        "FrameDiskWriter: opening MF writer at " + path
    );

    auto widePath = utf8ToWide(path);

    ComPtr<IMFSinkWriter> sink;
    HRESULT hr = MFCreateSinkWriterFromURL(
        widePath.c_str(),
        nullptr,
        nullptr,
        &sink
    );

    if (FAILED(hr)) {
        Logger::instance().logDebug(
            cameraId_,
            "FrameDiskWriter: MFCreateSinkWriterFromURL failed"
        );
        return;
    }

    // Output type: H.264
    ComPtr<IMFMediaType> outType;
    hr = MFCreateMediaType(&outType);
    if (FAILED(hr)) return;

    hr = outType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    if (FAILED(hr)) return;

    hr = outType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
    if (FAILED(hr)) return;

    // Simple bitrate: ~2 Mbps (tune as you like)
    hr = outType->SetUINT32(MF_MT_AVG_BITRATE, 2000000);
    if (FAILED(hr)) return;

    hr = outType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
    if (FAILED(hr)) return;

    hr = MFSetAttributeSize(outType.Get(), MF_MT_FRAME_SIZE,
        static_cast<UINT32>(w.width),
        static_cast<UINT32>(w.height));
    if (FAILED(hr)) return;

    // Frame rate as rational
    UINT32 frNum = static_cast<UINT32>(w.fps * 1000.0 + 0.5);
    UINT32 frDen = 1000;
    if (frNum == 0) { frNum = 1; frDen = 1; }

    hr = MFSetAttributeRatio(outType.Get(), MF_MT_FRAME_RATE, frNum, frDen);
    if (FAILED(hr)) return;

    hr = MFSetAttributeRatio(outType.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    if (FAILED(hr)) return;

    DWORD streamIndex = 0;
    hr = sink->AddStream(outType.Get(), &streamIndex);
    if (FAILED(hr)) return;

    // Input type: RGB32 (we'll convert BGR->BGRA with OpenCV)
    ComPtr<IMFMediaType> inType;
    hr = MFCreateMediaType(&inType);
    if (FAILED(hr)) return;

    hr = inType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    if (FAILED(hr)) return;

    hr = inType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_RGB32);
    if (FAILED(hr)) return;

    hr = MFSetAttributeSize(inType.Get(), MF_MT_FRAME_SIZE,
        static_cast<UINT32>(w.width),
        static_cast<UINT32>(w.height));
    if (FAILED(hr)) return;

    hr = MFSetAttributeRatio(inType.Get(), MF_MT_FRAME_RATE, frNum, frDen);
    if (FAILED(hr)) return;

    hr = MFSetAttributeRatio(inType.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    if (FAILED(hr)) return;

    hr = sink->SetInputMediaType(streamIndex, inType.Get(), nullptr);
    if (FAILED(hr)) return;

    hr = sink->BeginWriting();
    if (FAILED(hr)) return;

    // Store encoder
    w.encoder = new SegmentWriter::MfEncoder();
    w.encoder->sinkWriter = sink;
    w.encoder->streamIndex = streamIndex;
    w.opened = true;

    Logger::instance().logDebug(
        cameraId_,
        "FrameDiskWriter: MF writer opened at " + path
    );
#else
    (void)w;
    (void)path;
    (void)size;
    Logger::instance().logDebug(
        cameraId_,
        "FrameDiskWriter: Media Foundation writer not available on this platform"
    );
#endif
}

void FrameDiskWriter::closeWriter_(SegmentWriter& w) {
    if (!w.isOpened()) return;

#ifdef _WIN32
    if (w.encoder && w.encoder->sinkWriter) {
        Logger::instance().logDebug(
            cameraId_,
            "FrameDiskWriter: closing MF writer at " + w.path
        );

        w.encoder->sinkWriter->Finalize();
        w.encoder->sinkWriter.Reset();
    }
    delete w.encoder;
    w.encoder = nullptr;
#endif

    w.opened = false;
    w.frameCount = 0;
}
*/

/*
void FrameDiskWriter::writeFrame_(SegmentWriter& w, const cv::Mat& frame) {
    if (!w.isOpened()) return;
    if (frame.empty()) return;

#ifdef _WIN32
    if (!w.encoder || !w.encoder->sinkWriter) return;

    // Convert BGR -> BGRA (RGB32)
    cv::Mat bgra;
    cv::cvtColor(frame, bgra, cv::COLOR_BGR2BGRA);

    cv::flip(bgra, bgra, 0);

    const DWORD bufferSize = static_cast<DWORD>(bgra.total() * bgra.elemSize());

    ComPtr<IMFMediaBuffer> mediaBuffer;
    HRESULT hr = MFCreateMemoryBuffer(bufferSize, &mediaBuffer);
    if (FAILED(hr)) return;

    BYTE* pData = nullptr;
    DWORD maxLen = 0, curLen = 0;

    hr = mediaBuffer->Lock(&pData, &maxLen, &curLen);
    if (FAILED(hr)) return;

    memcpy(pData, bgra.data, bufferSize);

    hr = mediaBuffer->Unlock();
    if (FAILED(hr)) return;

    hr = mediaBuffer->SetCurrentLength(bufferSize);
    if (FAILED(hr)) return;

    ComPtr<IMFSample> sample;
    hr = MFCreateSample(&sample);
    if (FAILED(hr)) return;

    hr = sample->AddBuffer(mediaBuffer.Get());
    if (FAILED(hr)) return;

    const LONGLONG ticksPerSecond = 10000000; // 1s = 10^7 * 100ns
    double fps = (w.fps > 0.0) ? w.fps : 1.0;
    LONGLONG duration = static_cast<LONGLONG>(ticksPerSecond / fps);
    LONGLONG sampleTime = static_cast<LONGLONG>(w.frameCount * duration);

    hr = sample->SetSampleTime(sampleTime);
    if (FAILED(hr)) return;

    hr = sample->SetSampleDuration(duration);
    if (FAILED(hr)) return;

    hr = w.encoder->sinkWriter->WriteSample(w.encoder->streamIndex, sample.Get());
    if (FAILED(hr)) return;

    ++w.frameCount;
#else
    (void)w;
    (void)frame;
#endif
}
*/








void FrameDiskWriter::writeFrame_(SegmentWriter& w, const cv::Mat& frame) {
    if (!w.isOpened()) {
        Logger::instance().logDebug(cameraId_, "writeFrame_: writer not opened, skipping");
        return;
    }
    if (frame.empty()) {
        Logger::instance().logDebug(cameraId_, "writeFrame_: frame is empty, skipping");
        return;
    }

#ifdef _WIN32
    const auto writeStartedAt = Clock::now();
    if (!w.encoder || !w.encoder->sinkWriter) {
        Logger::instance().logDebug(cameraId_, "writeFrame_: encoder or sinkWriter is null");
        return;
    }

    // Convert BGR -> BGRA (RGB32)
    cv::Mat bgra;
    try {
        cv::cvtColor(frame, bgra, cv::COLOR_BGR2BGRA);
        cv::flip(bgra, bgra, 0);
    }
    catch (const cv::Exception& e) {
        Logger::instance().logDebug(cameraId_,
            std::string("writeFrame_: OpenCV exception: ") + e.what());
        return;
    }

    const DWORD bufferSize = static_cast<DWORD>(bgra.total() * bgra.elemSize());

    ComPtr<IMFMediaBuffer> mediaBuffer;
    HRESULT hr = MFCreateMemoryBuffer(bufferSize, &mediaBuffer);
    if (FAILED(hr)) {
        Logger::instance().logDebug(cameraId_,
            "writeFrame_: MFCreateMemoryBuffer FAILED hr=0x" +
            std::to_string(static_cast<unsigned long>(hr)));
        return;
    }

    BYTE* pData = nullptr;
    DWORD maxLen = 0, curLen = 0;
    hr = mediaBuffer->Lock(&pData, &maxLen, &curLen);
    if (FAILED(hr)) {
        Logger::instance().logDebug(cameraId_,
            "writeFrame_: mediaBuffer->Lock FAILED hr=0x" +
            std::to_string(static_cast<unsigned long>(hr)));
        return;
    }

    memcpy(pData, bgra.data, bufferSize);

    hr = mediaBuffer->Unlock();
    if (FAILED(hr)) {
        Logger::instance().logDebug(cameraId_,
            "writeFrame_: mediaBuffer->Unlock FAILED hr=0x" +
            std::to_string(static_cast<unsigned long>(hr)));
        return;
    }

    hr = mediaBuffer->SetCurrentLength(bufferSize);
    if (FAILED(hr)) {
        Logger::instance().logDebug(cameraId_,
            "writeFrame_: SetCurrentLength FAILED hr=0x" +
            std::to_string(static_cast<unsigned long>(hr)));
        return;
    }

    ComPtr<IMFSample> sample;
    hr = MFCreateSample(&sample);
    if (FAILED(hr)) {
        Logger::instance().logDebug(cameraId_,
            "writeFrame_: MFCreateSample FAILED hr=0x" +
            std::to_string(static_cast<unsigned long>(hr)));
        return;
    }

    hr = sample->AddBuffer(mediaBuffer.Get());
    if (FAILED(hr)) {
        Logger::instance().logDebug(cameraId_,
            "writeFrame_: AddBuffer FAILED hr=0x" +
            std::to_string(static_cast<unsigned long>(hr)));
        return;
    }

    const LONGLONG ticksPerSecond = 10000000;
    double fps = (w.fps > 0.0) ? w.fps : 1.0;
    LONGLONG duration = static_cast<LONGLONG>(ticksPerSecond / fps);
    LONGLONG sampleTime = static_cast<LONGLONG>(w.frameCount * duration);

    hr = sample->SetSampleTime(sampleTime);
    if (FAILED(hr)) {
        Logger::instance().logDebug(cameraId_,
            "writeFrame_: SetSampleTime FAILED hr=0x" +
            std::to_string(static_cast<unsigned long>(hr)));
        return;
    }

    hr = sample->SetSampleDuration(duration);
    if (FAILED(hr)) {
        Logger::instance().logDebug(cameraId_,
            "writeFrame_: SetSampleDuration FAILED hr=0x" +
            std::to_string(static_cast<unsigned long>(hr)));
        return;
    }

    hr = w.encoder->sinkWriter->WriteSample(w.encoder->streamIndex, sample.Get());
    if (FAILED(hr)) {
        Logger::instance().logDebug(cameraId_,
            "writeFrame_: WriteSample FAILED hr=0x" +
            std::to_string(static_cast<unsigned long>(hr)) +
            " frameCount=" + std::to_string(w.frameCount));

        // RECUPERAÇÃO: fechar e reabrir o writer no próximo save()
        closeWriter_(w);
        return;
    }

    ++w.frameCount;
    const auto writeLatencyUs = static_cast<std::uint64_t>(
        std::chrono::duration_cast<std::chrono::microseconds>(Clock::now() - writeStartedAt).count()
    );
    recordWriteTelemetry_(0, writeLatencyUs);
#else
    (void)w;
    (void)frame;
#endif
}









// --- short-clip rotation (10s) ---

void FrameDiskWriter::rotate10s_(const cv::Size& size, const TimeParts& tp) {
    if (!capture10Enabled_) return;
    if (!writer10_.isOpened()) {
        std::string prefix = ensureBaseDirAndMakePrefix_(tp);
        std::string path = prefix + "_10s.mp4";
        openWriterIfNeeded_(writer10_, path, size, static_cast<double>(capture10Fps_));
        if (writer10_.isOpened()) {
            tenSecondPaths_.push_back(path);
        }
    }
}

void FrameDiskWriter::rotate60s_(const cv::Size& size, const TimeParts& tp) {
    if (!capture60Enabled_) return;
    if (!writer60_.isOpened()) {
        std::string prefix = ensureBaseDirAndMakePrefix_(tp);
        std::string path = prefix + "_60s.mp4";
        openWriterIfNeeded_(writer60_, path, size, static_cast<double>(capture60Fps_));
        if (writer60_.isOpened()) {
            sixtySecondPaths_.push_back(path);
        }
    }
}








// Parse clip filename into cameraId + start/end timestamps.
// New pattern: "<cameraId>_YYYYMMDD_HHMMSS_YYYYMMDD_HHMMSS_10s.mp4"
// Legacy pattern (fallback): "<cameraId>_YYYYMMDD_HHMMSS_10s.mp4"
static bool parseClipNameParts(
    const std::string& filename,
    std::string& outCameraId,
    std::string& outStartDate,
    std::string& outStartTime,
    std::string& outEndDate,
    std::string& outEndTime)
{
    std::vector<std::string> tokens;
    {
        std::stringstream ss(filename);
        std::string token;
        while (std::getline(ss, token, '_')) {
            tokens.push_back(token);
        }
    }

    // New pattern: cam_YYYYMMDD_HHMMSS_YYYYMMDD_HHMMSS_XXxs.mp4
    if (tokens.size() >= 6) {
        outCameraId = tokens[0];
        outStartDate = tokens[1];
        outStartTime = tokens[2];
        outEndDate = tokens[3];
        outEndTime = tokens[4];
        return true;
    }

    // Legacy pattern: cam_YYYYMMDD_HHMMSS_XXxs.mp4
    if (tokens.size() >= 3) {
        outCameraId = tokens[0];
        outStartDate = tokens[1];
        outStartTime = tokens[2];
        // For legacy, treat end == start so we still build something valid.
        outEndDate = outStartDate;
        outEndTime = outStartTime;
        return true;
    }

    return false;
}

static bool parseClipLocalTimestamp_(
    const std::string& yyyymmdd,
    const std::string& hhmmss,
    std::chrono::system_clock::time_point& outTp)
{
    if (yyyymmdd.size() != 8 || hhmmss.size() != 6) return false;

    try {
        const int year = std::stoi(yyyymmdd.substr(0, 4));
        const int month = std::stoi(yyyymmdd.substr(4, 2));
        const int day = std::stoi(yyyymmdd.substr(6, 2));
        const int hour = std::stoi(hhmmss.substr(0, 2));
        const int minute = std::stoi(hhmmss.substr(2, 2));
        const int second = std::stoi(hhmmss.substr(4, 2));

        std::tm tmLocal{};
        tmLocal.tm_year = year - 1900;
        tmLocal.tm_mon = month - 1;
        tmLocal.tm_mday = day;
        tmLocal.tm_hour = hour;
        tmLocal.tm_min = minute;
        tmLocal.tm_sec = second;
        tmLocal.tm_isdst = -1;

        const std::time_t tt = std::mktime(&tmLocal);
        if (tt == static_cast<std::time_t>(-1)) return false;

        outTp = std::chrono::system_clock::from_time_t(tt);
        return true;
    }
    catch (...) {
        return false;
    }
}

struct ClipRangeInfo_ {
    std::chrono::system_clock::time_point start{};
    std::chrono::system_clock::time_point end{};
    int nominalSeconds = 0;
};

static int parseNominalSecondsFromFilename_(const std::string& filename)
{
    std::vector<std::string> tokens;
    std::stringstream ss(filename);
    std::string token;
    while (std::getline(ss, token, '_')) {
        tokens.push_back(token);
    }
    if (tokens.empty()) return 0;

    std::string tail = tokens.back(); // e.g. "10s.mp4"
    const std::string ext = ".mp4";
    if (tail.size() > ext.size() &&
        tail.rfind(ext) == tail.size() - ext.size())
    {
        tail.resize(tail.size() - ext.size());
    }

    if (!tail.empty() && (tail.back() == 's' || tail.back() == 'S')) {
        tail.pop_back();
    }
    if (tail.empty()) return 0;

    for (char ch : tail) {
        if (ch < '0' || ch > '9') return 0;
    }

    try {
        return std::stoi(tail);
    }
    catch (...) {
        return 0;
    }
}

static bool parseClipRangeFromPath_(
    const std::string& clipPath,
    ClipRangeInfo_& out,
    std::string* outErr = nullptr)
{
    const fs::path p(clipPath);
    const std::string filename = p.filename().string();

    std::string camId, startDate, startTime, endDate, endTime;
    if (!parseClipNameParts(filename, camId, startDate, startTime, endDate, endTime)) {
        if (outErr) *outErr = "cannot parse clip name: " + filename;
        return false;
    }

    std::chrono::system_clock::time_point startTp;
    std::chrono::system_clock::time_point endTp;
    if (!parseClipLocalTimestamp_(startDate, startTime, startTp)) {
        if (outErr) *outErr = "cannot parse start timestamp: " + filename;
        return false;
    }
    if (!parseClipLocalTimestamp_(endDate, endTime, endTp)) {
        if (outErr) *outErr = "cannot parse end timestamp: " + filename;
        return false;
    }

    int nominalSeconds = parseNominalSecondsFromFilename_(filename);
    if (nominalSeconds <= 0) nominalSeconds = 10;
    if (endTp <= startTp) {
        endTp = startTp + std::chrono::seconds(nominalSeconds);
    }

    out.start = startTp;
    out.end = endTp;
    out.nominalSeconds = nominalSeconds;
    return true;
}

static bool isMergeBatchTemporallyContinuous_(
    const std::vector<std::string>& batch,
    int expectedNominalSeconds,
    std::string* outErr = nullptr)
{
    if (batch.empty()) {
        if (outErr) *outErr = "empty batch";
        return false;
    }

    const auto absll = [](long long v) -> long long { return v < 0 ? -v : v; };
    const long long maxGapSeconds = expectedNominalSeconds <= 10 ? 5 : 15;
    const long long maxBacktrackSeconds = 5;
    const long long minDurationSeconds = expectedNominalSeconds <= 10 ? 5 : expectedNominalSeconds / 2;
    const long long maxDurationSeconds = expectedNominalSeconds * 2;

    ClipRangeInfo_ first{};
    ClipRangeInfo_ prev{};
    for (size_t i = 0; i < batch.size(); ++i) {
        ClipRangeInfo_ cur{};
        std::string parseErr;
        if (!parseClipRangeFromPath_(batch[i], cur, &parseErr)) {
            if (outErr) *outErr = parseErr;
            return false;
        }

        const long long durationSeconds =
            std::chrono::duration_cast<std::chrono::seconds>(cur.end - cur.start).count();
        if (durationSeconds < minDurationSeconds || durationSeconds > maxDurationSeconds) {
            if (outErr) {
                *outErr = "clip duration out of range (" + std::to_string(durationSeconds) +
                    "s) for " + fs::path(batch[i]).filename().string();
            }
            return false;
        }

        if (i == 0) {
            first = cur;
            prev = cur;
            continue;
        }

        const long long gapSeconds =
            std::chrono::duration_cast<std::chrono::seconds>(cur.start - prev.end).count();
        if (gapSeconds > maxGapSeconds || gapSeconds < -maxBacktrackSeconds) {
            if (outErr) {
                *outErr = "timeline gap between clips is " + std::to_string(gapSeconds) +
                    "s (" + fs::path(batch[i - 1]).filename().string() + " -> " +
                    fs::path(batch[i]).filename().string() + ")";
            }
            return false;
        }

        prev = cur;
    }

    const long long expectedTotalSeconds = static_cast<long long>(expectedNominalSeconds) * static_cast<long long>(batch.size());
    const long long actualTotalSeconds =
        std::chrono::duration_cast<std::chrono::seconds>(prev.end - first.start).count();
    const long long totalToleranceSeconds = maxGapSeconds * static_cast<long long>(batch.size() + 1);
    if (absll(actualTotalSeconds - expectedTotalSeconds) > totalToleranceSeconds) {
        if (outErr) {
            *outErr = "batch total span mismatch: actual=" + std::to_string(actualTotalSeconds) +
                "s expected~" + std::to_string(expectedTotalSeconds) + "s";
        }
        return false;
    }

    return true;
}

static std::chrono::system_clock::time_point fileTimeToSystemClock_(
    const fs::file_time_type& ft)
{
    const auto nowFile = fs::file_time_type::clock::now();
    const auto nowSys = std::chrono::system_clock::now();
    return std::chrono::time_point_cast<std::chrono::system_clock::duration>(
        ft - nowFile + nowSys
    );
}

static bool hasExplicitStartAndEndTimestampsInName(const std::string& filename)
{
    std::vector<std::string> tokens;
    std::stringstream ss(filename);
    std::string token;
    while (std::getline(ss, token, '_')) {
        tokens.push_back(token);
    }

    // <cam>_YYYYMMDD_HHMMSS_YYYYMMDD_HHMMSS_<suffix>.mp4
    return tokens.size() >= 6;
}

static void quarantineFailedMergeClip(
    const std::string& cameraIdForLog,
    const std::string& clipPath,
    const std::string& reasonTag)
{
    try {
        fs::path src(clipPath);
        if (!fs::exists(src)) return;

        fs::path quarantineDir = src.parent_path() / "_merge_failed";
        std::error_code ec;
        fs::create_directories(quarantineDir, ec);

        fs::path dst = quarantineDir / (reasonTag + "_" + src.filename().string());

        ec.clear();
        fs::rename(src, dst, ec);
        if (ec) {
            ec.clear();
            fs::copy_file(src, dst, fs::copy_options::overwrite_existing, ec);
            if (!ec) {
                std::error_code rmEc;
                fs::remove(src, rmEc);
            }
        }

        if (ec) {
            Logger::instance().logDebug(
                cameraIdForLog,
                "FrameDiskWriter: failed to quarantine clip " + clipPath +
                " reason=" + reasonTag + " error=" + ec.message()
            );
        }
        else {
            Logger::instance().logWarning(
                cameraIdForLog,
                "FrameDiskWriter: quarantined merge-failed clip " + clipPath +
                " -> " + dst.string()
            );
        }
    }
    catch (const std::exception& ex) {
        Logger::instance().logDebug(
            cameraIdForLog,
            std::string("FrameDiskWriter: exception quarantining clip: ") + ex.what()
        );
    }
}
// Helper: build merged output path using first clip's start and last clip's end.
// Output pattern: "<cameraId>_startDate_startTime_endDate_endTime_SUFFIX"
static std::string buildMergedPathFromBatch(
    const std::vector<std::string>& inputFiles,
    const std::string& cameraId,
    const std::string& suffix)
{
    if (inputFiles.empty()) return std::string();

    fs::path firstPath(inputFiles.front());
    fs::path lastPath(inputFiles.back());
    fs::path dir = firstPath.parent_path();

    std::string camFirst, startDate, startTime, unusedEndDate, unusedEndTime;
    if (!parseClipNameParts(firstPath.filename().string(),
        camFirst, startDate, startTime, unusedEndDate, unusedEndTime))
    {
        // Fallback: recreate something simple instead of crashing.
        std::vector<std::string> tokens;
        std::stringstream ss(firstPath.filename().string());
        std::string token;
        while (std::getline(ss, token, '_')) {
            tokens.push_back(token);
        }
        std::string datePart = (tokens.size() >= 2 ? tokens[1] : "00000000");
        std::string timePart = (tokens.size() >= 3 ? tokens[2] : "000000");

        std::ostringstream out;
        out << (cameraId.empty() ? camFirst : cameraId)
            << "_" << datePart << "_" << timePart << suffix;
        return (dir / out.str()).string();
    }

    std::string camLast, lastStartDate, lastStartTime, endDate, endTime;
    if (!parseClipNameParts(lastPath.filename().string(),
        camLast, lastStartDate, lastStartTime, endDate, endTime))
    {
        // If parsing last fails, fall back to first's "end"
        endDate = unusedEndDate;
        endTime = unusedEndTime;
    }

    const std::string& cam = cameraId.empty() ? camFirst : cameraId;

    std::ostringstream outName;
    outName << cam << "_" << startDate << "_" << startTime
        << "_" << endDate << "_" << endTime << suffix;

    fs::path outPath = dir / outName.str();
    return outPath.string();
}









void FrameDiskWriter::finalizeLastClipName_(
    std::deque<std::string>& clipPaths,
    const TimeParts& endTp,
    const std::string& durationSuffix)
{
    if (clipPaths.empty()) return;

    std::string oldPath = clipPaths.back();
    fs::path p(oldPath);
    fs::path dir = p.parent_path();
    std::string filename = p.filename().string();

    // Parse existing name to get cameraId + start timestamp.
    std::string camId, startDate, startTime, dummyEndDate, dummyEndTime;
    if (!parseClipNameParts(filename, camId, startDate, startTime, dummyEndDate, dummyEndTime)) {
        return; // don't break anything if filename is unexpected
    }

    // Format end timestamp from endTp
    std::ostringstream endDateSS;
    endDateSS << std::put_time(&endTp.tmLocal, "%Y%m%d");

    std::ostringstream endTimeSS;
    endTimeSS << std::put_time(&endTp.tmLocal, "%H%M%S");

    std::string endDate = endDateSS.str();
    std::string endTime = endTimeSS.str();

    std::ostringstream newName;
    newName << camId << "_"
        << startDate << "_" << startTime << "_"
        << endDate << "_" << endTime
        << durationSuffix;

    fs::path newPath = dir / newName.str();

    if (newPath == p) {
        // Already in the new format, nothing to do
        return;
    }

    std::error_code ec;
    fs::rename(p, newPath, ec);
    if (ec) {
        Logger::instance().logDebug(
            cameraId_,
            "FrameDiskWriter: failed to rename clip from " +
            oldPath + " to " + newPath.string() + " error=" + ec.message()
        );
        return;
    }

    clipPaths.back() = newPath.string();

    Logger::instance().logDebug(
        cameraId_,
        "FrameDiskWriter: finalized clip name to " + newPath.string()
    );
}







/*
// Helper: build a merged output path that reuses the timestamp from the first clip.
// e.g. ".../12_20251205_183455_10s.mp4" + "_60s.mp4" -> ".../12_20251205_183455_60s.mp4"
static std::string buildMergedPathFromFirstClip(
    const std::string& firstClipPath,
    const std::string& cameraId,
    const std::string& suffix)
{
    fs::path p(firstClipPath);
    fs::path dir = p.parent_path();
    std::string filename = p.filename().string();

    std::string datePart = "00000000";
    std::string timePart = "000000";

    // Expected: "<cameraId>_YYYYMMDD_HHMMSS_10s.mp4"
    std::vector<std::string> tokens;
    {
        std::stringstream ss(filename);
        std::string token;
        while (std::getline(ss, token, '_')) {
            tokens.push_back(token);
        }
    }
    if (tokens.size() >= 3) {
        datePart = tokens[1];
        timePart = tokens[2];
        // tokens[3] is like "10s.mp4"
    }

    std::ostringstream outName;
    outName << cameraId << "_" << datePart << "_" << timePart << suffix;

    fs::path outPath = dir / outName.str();
    return outPath.string();
}
*/

// --- merge logic: 6 x 10s -> 60s ---

bool FrameDiskWriter::mergeTenSecondClipsInto60_(const cv::Size& size) {
    if (tenSecondPaths_.size() < MAX_10S_CLIPS) return false;

    const size_t batchStart = 0;
    std::vector<std::string> batch;
    batch.reserve(MAX_10S_CLIPS);
    for (int offset = 0; offset < MAX_10S_CLIPS; ++offset) {
        batch.push_back(tenSecondPaths_[static_cast<size_t>(offset)]);
    }

    Logger::instance().logDebug(
        cameraId_,
        "FrameDiskWriter: merging oldest 10s clips into 60s clip, count=" +
        std::to_string(batch.size())
    );

    // Merge by finalized clip count and let ffmpeg be the compatibility check.

    // Build 60s output path using timestamp of first 10s clip in this batch
    std::string outPath = buildMergedPathFromBatch(
        batch,
        cameraId_,
        "_60s.mp4"
    );

#ifdef _WIN32
    bool ok = runFfmpegConcat(batch, outPath, cameraId_);
    if (!ok) {
        Logger::instance().logDebug(
            cameraId_,
            "FrameDiskWriter: ffmpeg concat 10s->60s FAILED; dropping one clip from homogeneous batch to unblock pipeline"
        );

        if (batchStart < tenSecondPaths_.size()) {
            const std::string badClip = tenSecondPaths_[batchStart];
            quarantineFailedMergeClip(cameraId_, badClip, "10s_concat_failed");
            tenSecondPaths_.erase(tenSecondPaths_.begin() + static_cast<std::ptrdiff_t>(batchStart));
            return true;
        }
        return false;
    }

    // Success: store 60s path
    sixtySecondPaths_.push_back(outPath);

    // Delete ONLY these 6 clips
    for (const auto& clipPath : batch) {
        std::error_code ec;
        fs::remove(clipPath, ec);
    }

    // Erase the first 6 entries from the deque
    tenSecondPaths_.erase(
        tenSecondPaths_.begin() + static_cast<std::ptrdiff_t>(batchStart),
        tenSecondPaths_.begin() + static_cast<std::ptrdiff_t>(batchStart + MAX_10S_CLIPS)
    );

    Logger::instance().logDebug(
        cameraId_,
        "FrameDiskWriter: finished 10s->60s merge, output=" + outPath
    );

    // If we reached 5 x 60s clips, merge into 300s
    if ((int)sixtySecondPaths_.size() >= MAX_60S_CLIPS) {
        (void)mergeSixtySecondClipsInto300_(size);
    }
    return true;
#else
    (void)size;
    Logger::instance().logDebug(
        cameraId_,
        "FrameDiskWriter: mergeTenSecondClipsInto60_ not implemented on this platform"
    );
    return false;
#endif
}



// --- merge logic: 5 x 60s -> 300s ---
// --- merge logic: 5 x 60s -> 300s ---

bool FrameDiskWriter::mergeSixtySecondClipsInto300_(const cv::Size& size) {
    if (sixtySecondPaths_.size() < MAX_60S_CLIPS) return false;

    const size_t batchStart = 0;
    std::vector<std::string> batch;
    batch.reserve(MAX_60S_CLIPS);
    for (int offset = 0; offset < MAX_60S_CLIPS; ++offset) {
        batch.push_back(sixtySecondPaths_[static_cast<size_t>(offset)]);
    }

    Logger::instance().logDebug(
        cameraId_,
        "FrameDiskWriter: merging oldest 60s clips into 300s clip, count=" +
        std::to_string(batch.size())
    );

    // Merge by finalized clip count and let ffmpeg be the compatibility check.

    // Build 300s output path using timestamp of first 60s clip
    std::string outPath = buildMergedPathFromBatch(
        batch,
        cameraId_,
        "_300s.mp4"
    );

#ifdef _WIN32
    bool ok = runFfmpegConcat(batch, outPath, cameraId_);
    if (!ok) {
        Logger::instance().logDebug(
            cameraId_,
            "FrameDiskWriter: ffmpeg concat 60s->300s FAILED; dropping one clip from homogeneous batch to unblock pipeline"
        );

        if (batchStart < sixtySecondPaths_.size()) {
            const std::string badClip = sixtySecondPaths_[batchStart];
            quarantineFailedMergeClip(cameraId_, badClip, "60s_concat_failed");
            sixtySecondPaths_.erase(sixtySecondPaths_.begin() + static_cast<std::ptrdiff_t>(batchStart));
            return true;
        }
        return false;
    }

    // Delete ONLY these 5 clips now that they are merged
    for (const auto& clipPath : batch) {
        std::error_code ec;
        fs::remove(clipPath, ec);
        if (ec) {
            Logger::instance().logDebug(
                cameraId_,
                "FrameDiskWriter: failed to remove 60s clip " +
                clipPath + " : " + ec.message()
            );
        }
    }

    // Remove them from deque
    sixtySecondPaths_.erase(
        sixtySecondPaths_.begin() + static_cast<std::ptrdiff_t>(batchStart),
        sixtySecondPaths_.begin() + static_cast<std::ptrdiff_t>(batchStart + MAX_60S_CLIPS)
    );

    // NEW: move the merged 300s clip from baseDir_ to baseDir_ + "_300s"
    try {
        fs::path srcPath(outPath);
        fs::path baseRoot(baseDir_);  // e.g. "frames"
        std::error_code relEc;
        fs::path rel = fs::relative(srcPath, baseRoot, relEc);

        if (relEc) {
            Logger::instance().logDebug(
                cameraId_,
                "FrameDiskWriter: relative() failed for 300s clip " +
                srcPath.string() + " : " + relEc.message()
            );
        }
        else {
            // Long-term 300s root, e.g. "frames_300s"
            fs::path longRoot(baseDir_ + "_300s");
            fs::path dstPath = longRoot / rel;  // keep cam/YYYY/MM/DD layout

            std::error_code dirEc;
            fs::create_directories(dstPath.parent_path(), dirEc);
            if (dirEc) {
                Logger::instance().logDebug(
                    cameraId_,
                    "FrameDiskWriter: create_directories failed for 300s dst " +
                    dstPath.parent_path().string() + " : " + dirEc.message()
                );
            }
            else {
                std::error_code mvEc;
                fs::rename(srcPath, dstPath, mvEc);
                if (mvEc) {
                    Logger::instance().logDebug(
                        cameraId_,
                        "FrameDiskWriter: rename failed for 300s clip, trying copy: " +
                        mvEc.message()
                    );

                    std::error_code cpEc;
                    fs::copy_file(
                        srcPath, dstPath,
                        fs::copy_options::overwrite_existing,
                        cpEc
                    );
                    if (cpEc) {
                        Logger::instance().logDebug(
                            cameraId_,
                            "FrameDiskWriter: copy_file failed for 300s clip: " +
                            cpEc.message()
                        );
                    }
                    else {
                        // Copy succeeded; remove original
                        std::error_code rmEc;
                        fs::remove(srcPath, rmEc);
                        if (rmEc) {
                            Logger::instance().logDebug(
                                cameraId_,
                                "FrameDiskWriter: remove original 300s clip failed: " +
                                rmEc.message()
                            );
                        }
                        outPath = dstPath.string();
                    }
                }
                else {
                    // rename succeeded
                    outPath = dstPath.string();
                }
            }
        }
    }
    catch (const std::exception& ex) {
        Logger::instance().logDebug(
            cameraId_,
            std::string("FrameDiskWriter: exception while moving 300s clip: ") +
            ex.what()
        );
    }

    Logger::instance().logDebug(
        cameraId_,
        "FrameDiskWriter: finished 60s->300s merge, output=" + outPath
    );
    return true;
#else
    (void)size;
    Logger::instance().logDebug(
        cameraId_,
        "FrameDiskWriter: mergeSixtySecondClipsInto300_ not implemented on this platform"
    );
    return false;
#endif
}

/*
void FrameDiskWriter::setJobsCopyPredicate(std::function<bool()> pred) {
    shouldCopyJobs_ = std::move(pred);
}
*/

// --- main entry point ---

void FrameDiskWriter::save(const cv::Mat& frame) {
    if (!enabled_ || frame.empty()) {
        Logger::instance().logDebug(cameraId_,
            "save: skipping - enabled=" + std::to_string(enabled_) +
            " frame.empty=" + std::to_string(frame.empty()));
        return;
    }

    auto now = Clock::now();

    bool shouldCopyInferenceVideo = true;
    if (inferenceCopyEnabledProvider_) {
        try {
            shouldCopyInferenceVideo = inferenceCopyEnabledProvider_();
        }
        catch (...) {
            shouldCopyInferenceVideo = true;
        }
    }

    bool shouldCopyInferenceImage = false;
    if (inferenceImageCopyEnabledProvider_) {
        try {
            shouldCopyInferenceImage = inferenceImageCopyEnabledProvider_();
        }
        catch (...) {
            shouldCopyInferenceImage = false;
        }
    }

    bool forceVideoCapture = false;
    if (forceVideoCaptureProvider_) {
        try {
            forceVideoCapture = forceVideoCaptureProvider_();
        }
        catch (...) {
            forceVideoCapture = false;
        }
    }

    std::vector<JobsCopyTarget> jobsTargets;
    if (jobsTargetsProvider_) {
        try {
            jobsTargets = jobsTargetsProvider_();
        }
        catch (...) {
            jobsTargets.clear();
        }
    }

    bool hasJobsVideoDemand = false;
    bool hasJobsImageDemand = false;
    for (const auto& t : jobsTargets) {
        if (t.jobId <= 0 || t.stepId <= 0) continue;
        hasJobsVideoDemand = hasJobsVideoDemand || t.needsVideo;
        hasJobsImageDemand = hasJobsImageDemand || t.copyImage;
    }

    const bool hasImageDemand = shouldCopyInferenceImage || hasJobsImageDemand;
    const bool hasProfileVideoDemand = capture10Enabled_ || capture60Enabled_;
    const bool hasVideoDemand =
        hasProfileVideoDemand || forceVideoCapture || shouldCopyInferenceVideo || hasJobsVideoDemand;

    cv::Size sz(frame.cols, frame.rows);
    auto tp = getTimeParts_();

    auto emitImageSnapshotIfDue = [&]() {
        if (!hasImageDemand) return;
        if (lastImageSnapshotSaved_.time_since_epoch().count() != 0 &&
            (now - lastImageSnapshotSaved_) < imageSnapshotInterval_) {
            return;
        }

        std::vector<uchar> imageBytes;
        if (!cv::imencode(".png", frame, imageBytes) || imageBytes.empty()) {
            Logger::instance().logDebug(cameraId_, "save: image-only mode failed to encode PNG snapshot");
            return;
        }

        std::ostringstream imageName;
        imageName << cameraId_ << "_"
            << std::put_time(&tp.tmLocal, "%Y%m%d_%H%M%S")
            << "_" << std::setw(3) << std::setfill('0') << tp.ms
            << "_img.png";
        const std::string fileName = imageName.str();

        bool wroteAny = false;
        if (shouldCopyInferenceImage) {
            const auto writeStartedAt = Clock::now();
            const bool wrote = writeImageBytesAtomicToDir(
                cameraId_,
                getInferenceImagesTempDirForCamera(cameraId_),
                fileName,
                imageBytes,
                "FrameDiskWriter: direct image inference snapshot"
            );
            if (wrote) {
                const auto latencyUs = static_cast<std::uint64_t>(
                    std::chrono::duration_cast<std::chrono::microseconds>(Clock::now() - writeStartedAt).count()
                );
                recordWriteTelemetry_(static_cast<std::uint64_t>(imageBytes.size()), latencyUs);
            }
            wroteAny = wrote || wroteAny;
        }

        for (const auto& t : jobsTargets) {
            if (t.jobId <= 0 || t.stepId <= 0 || !t.copyImage) continue;
            const auto writeStartedAt = Clock::now();
            const bool wrote = writeImageBytesAtomicToDir(
                cameraId_,
                getJobsImagesTempDirForJobStepCamera(t.jobId, t.stepId, cameraId_),
                fileName,
                imageBytes,
                "FrameDiskWriter: jobs image inference snapshot"
            );
            if (wrote) {
                const auto latencyUs = static_cast<std::uint64_t>(
                    std::chrono::duration_cast<std::chrono::microseconds>(Clock::now() - writeStartedAt).count()
                );
                recordWriteTelemetry_(static_cast<std::uint64_t>(imageBytes.size()), latencyUs);
            }
            wroteAny = wrote || wroteAny;
        }

        if (wroteAny) {
            lastImageSnapshotSaved_ = now;
        }
    };

    auto discardOpenClip = [&](SegmentWriter& writer,
                               int& framesInClip,
                               std::deque<std::string>& clipPaths,
                               std::chrono::steady_clock::time_point& lastWriteAt,
                               TimeParts& lastWriteTp,
                               bool& hasLastWriteTp) {
        if (!writer.isOpened()) return;

        const std::string danglingPath = writer.path;
        closeWriter_(writer);
        framesInClip = 0;
        lastWriteAt = Clock::time_point{};
        lastWriteTp = TimeParts{};
        hasLastWriteTp = false;

        if (!danglingPath.empty()) {
            auto it = std::find(clipPaths.begin(), clipPaths.end(), danglingPath);
            if (it != clipPaths.end()) {
                clipPaths.erase(it);
            }

            std::error_code rmEc;
            fs::remove(danglingPath, rmEc);
            if (rmEc) {
                Logger::instance().logDebug(
                    cameraId_,
                    "FrameDiskWriter: failed to remove discarded partial clip " +
                    danglingPath + " err=" + rmEc.message()
                );
            }
        }
    };

    if (!hasVideoDemand) {
        discardOpenClip(
            writer10_,
            framesIn10_,
            tenSecondPaths_,
            lastVideoFrameWriteAt10_,
            lastVideoFrameWriteTp10_,
            hasLastVideoFrameWriteTp10_
        );
        discardOpenClip(
            writer60_,
            framesIn60_,
            sixtySecondPaths_,
            lastVideoFrameWriteAt60_,
            lastVideoFrameWriteTp60_,
            hasLastVideoFrameWriteTp60_
        );
        emitImageSnapshotIfDue();
        return;
    }

    auto writeProfileIfDue = [&](int clipSeconds,
                                 bool enabled,
                                 int clipFps,
                                 std::chrono::milliseconds interval,
                                 std::chrono::steady_clock::time_point& lastSavedAt,
                                 SegmentWriter& writer,
                                 int& framesInClip,
                                 std::deque<std::string>& clipPaths,
                                 std::chrono::steady_clock::time_point& lastWriteAt,
                                 TimeParts& lastWriteTp,
                                 bool& hasLastWriteTp) {
        if (!enabled || clipFps <= 0) return;
        if (interval.count() > 0 && (now - lastSavedAt) < interval) return;

        lastSavedAt = now;
        lastSaved_ = now;

        if (clipSeconds >= 60) {
            rotate60s_(sz, tp);
        }
        else {
            rotate10s_(sz, tp);
        }

        if (!writer.isOpened()) {
            Logger::instance().logDebug(
                cameraId_,
                "save: failed to open writer for " + std::to_string(clipSeconds) + "s profile"
            );
            return;
        }

        writeFrame_(writer, frame);
        ++framesInClip;
        lastWriteAt = now;
        lastWriteTp = tp;
        hasLastWriteTp = true;

        int framesPerClip = static_cast<int>(static_cast<double>(clipFps) * static_cast<double>(clipSeconds) + 0.5);
        if (framesPerClip < 1) framesPerClip = 1;
        if (framesInClip < framesPerClip) {
            return;
        }

        const TimeParts endTp = hasLastWriteTp ? lastWriteTp : tp;
        closeWriter_(writer);
        framesInClip = 0;
        hasLastWriteTp = false;
        lastWriteAt = Clock::time_point{};

        const std::string durationSuffix =
            (clipSeconds >= 60) ? "_60s.mp4" : "_10s.mp4";
        finalizeLastClipName_(clipPaths, endTp, durationSuffix);
        if (!clipPaths.empty()) {
            std::error_code fileSizeEc;
            const auto clipSize = fs::file_size(clipPaths.back(), fileSizeEc);
            if (!fileSizeEc) {
                recordWriteTelemetry_(static_cast<std::uint64_t>(clipSize), 0);
            }
        }

        if (clipSeconds < 60 && !clipPaths.empty()) {
            const std::string& last10sPath = clipPaths.back();
            std::error_code clipSizeEc;
            const auto last10sClipSize = fs::file_size(last10sPath, clipSizeEc);
            const std::uint64_t last10sBytes = clipSizeEc ? 0 : static_cast<std::uint64_t>(last10sClipSize);
            if (shouldCopyInferenceVideo) {
                const auto copyStartedAt = Clock::now();
                const bool copied = copyTenSecondClipToInferenceTemp(cameraId_, last10sPath);
                if (copied && last10sBytes > 0) {
                    const auto latencyUs = static_cast<std::uint64_t>(
                        std::chrono::duration_cast<std::chrono::microseconds>(Clock::now() - copyStartedAt).count()
                    );
                    recordWriteTelemetry_(last10sBytes, latencyUs);
                }
            }
            for (const auto& t : jobsTargets) {
                if (t.jobId > 0 && t.stepId > 0 && t.copyVideo) {
                    const auto copyStartedAt = Clock::now();
                    const bool copied =
                        copyTenSecondClipToJobsTemp(t.jobId, t.stepId, cameraId_, last10sPath);
                    if (copied && last10sBytes > 0) {
                        const auto latencyUs = static_cast<std::uint64_t>(
                            std::chrono::duration_cast<std::chrono::microseconds>(Clock::now() - copyStartedAt).count()
                        );
                        recordWriteTelemetry_(last10sBytes, latencyUs);
                    }
                }
            }
        }
    };

    writeProfileIfDue(
        10,
        capture10Enabled_,
        capture10Fps_,
        minInterval10_,
        lastSaved10_,
        writer10_,
        framesIn10_,
        tenSecondPaths_,
        lastVideoFrameWriteAt10_,
        lastVideoFrameWriteTp10_,
        hasLastVideoFrameWriteTp10_
    );

    writeProfileIfDue(
        60,
        capture60Enabled_,
        capture60Fps_,
        minInterval60_,
        lastSaved60_,
        writer60_,
        framesIn60_,
        sixtySecondPaths_,
        lastVideoFrameWriteAt60_,
        lastVideoFrameWriteTp60_,
        hasLastVideoFrameWriteTp60_
    );

    // In mixed mode (video + image demand), keep video pipeline and also emit periodic snapshots.
    emitImageSnapshotIfDue();
}

void FrameDiskWriter::flushVideoClipIfIdle(std::chrono::milliseconds idleThreshold)
{
    (void)idleThreshold;
    // Intentionally disabled: partial clip flush would create <10s files (e.g. *_5s.mp4).
    // We now persist video clips only when 10-frame batches are completed in save().
}



bool FrameDiskWriter::isValidMp4_(const std::string& path)
{
    std::error_code ec;
    auto size = fs::file_size(path, ec);
    if (ec) return false;

    // Treat tiny / zero-length files as suspicious
    if (size < 1024) { // 1 KB threshold – tune if you want
        return false;
    }

    fs::path p(path);
    if (!p.has_extension() || p.extension() != ".mp4") {
        return false;
    }

    // Do NOT try to decode it here; ffmpeg concat will be the real test.
    return true;
}




void FrameDiskWriter::initializeFromDisk_()
{
    // We only care about today's folder for this camera: baseDir/cam_<id>/YYYY/MM/DD
    TimeParts tp = getTimeParts_();
    std::string prefix = ensureBaseDirAndMakePrefix_(tp);
    fs::path dir = fs::path(prefix).parent_path(); // drop "<id>_YYYYMMDD_HHMMSS" part

    if (!fs::exists(dir)) return;

    std::vector<std::string> tens;
    std::vector<std::string> sixties;

    for (auto& entry : fs::directory_iterator(dir))
    {
        if (!entry.is_regular_file()) continue;

        const std::string filename = entry.path().filename().string();
        const std::string full = entry.path().string();

        bool isLegacyPartialShort = false;
        for (int s = 1; s <= 9; ++s) {
            const std::string marker = "_" + std::to_string(s) + "s.mp4";
            if (filename.find(marker) != std::string::npos) {
                isLegacyPartialShort = true;
                break;
            }
        }
        if (isLegacyPartialShort) {
            std::error_code rmEc;
            fs::remove(entry.path(), rmEc);
            if (rmEc) {
                Logger::instance().logDebug(
                    cameraId_,
                    "FrameDiskWriter: failed removing legacy partial clip " + full +
                    " err=" + rmEc.message()
                );
            }
            else {
                Logger::instance().logDebug(
                    cameraId_,
                    "FrameDiskWriter: removed legacy partial clip " + full
                );
            }
            continue;
        }

        // Only look at clips created by this writer
        bool is10 = filename.find("_10s.mp4") != std::string::npos;
        bool is60 = filename.find("_60s.mp4") != std::string::npos;

        if (!is10 && !is60) continue;

        if (is10 && !hasExplicitStartAndEndTimestampsInName(filename)) {
            Logger::instance().logDebug(
                cameraId_,
                "FrameDiskWriter: skipping non-finalized 10s clip " + full
            );
            continue;
        }

        if (!isValidMp4_(full)) {
            Logger::instance().logDebug(
                cameraId_,
                "FrameDiskWriter: skipping suspicious clip " + full);
            continue;
        }

        if (is10)      tens.push_back(full);
        else if (is60) sixties.push_back(full);
    }

    // Sort clips by start timestamp so merges always use the oldest first
    auto sortByTimestamp = [&](std::vector<std::string>& vec) {
        std::sort(vec.begin(), vec.end(),
            [&](const std::string& A, const std::string& B) {
                std::string camA, sdA, stA, edA, etA;
                std::string camB, sdB, stB, edB, etB;

                parseClipNameParts(fs::path(A).filename().string(),
                    camA, sdA, stA, edA, etA);
                parseClipNameParts(fs::path(B).filename().string(),
                    camB, sdB, stB, edB, etB);

                // compare by start date+time
                return (sdA + stA) < (sdB + stB);
            });
        };

    sortByTimestamp(tens);
    sortByTimestamp(sixties);

    for (auto& p : tens)    tenSecondPaths_.push_back(p);
    for (auto& p : sixties) sixtySecondPaths_.push_back(p);

    Logger::instance().logDebug(
        cameraId_,
        "FrameDiskWriter: initializeFromDisk_ loaded " +
        std::to_string(tenSecondPaths_.size()) + " existing 10s clips and " +
        std::to_string(sixtySecondPaths_.size()) + " existing 60s clips"
    );
}

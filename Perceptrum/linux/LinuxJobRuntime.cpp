#include "LinuxJobRuntime.h"

#include "LinuxFrameDiskWriter.h"
#include "LinuxRtspCandidateBuilder.h"
#include "LinuxRtspThumbnailProbe.h"

#include "../Perceptrum/orchestrator/HttpUtils.h"
#include "../Perceptrum/platform/platform_common.h"
#include "../Perceptrum/platform/platform_process.h"

#include <algorithm>
#include <chrono>
#include <cctype>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <map>
#include <optional>
#include <set>
#include <sstream>
#include <stdexcept>
#include <thread>
#include <vector>

namespace {

std::string Trim(std::string value)
{
    return perceptrum::platform::TrimAscii(std::move(value));
}

std::string ReadEnv(std::string_view name)
{
    return Trim(perceptrum::platform::ReadEnvVar(std::string(name).c_str()));
}

std::string TrimLower(std::string value)
{
    value = Trim(std::move(value));
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

int ReadPollIntervalMs()
{
    const std::string value = ReadEnv("APP_AGENT_COMMAND_POLL_INTERVAL_MS");
    if (value.empty()) {
        return 1000;
    }
    try {
        const int parsed = std::stoi(value);
        return std::clamp(parsed, 100, 10000);
    } catch (...) {
        return 1000;
    }
}

std::string UrlEncode(std::string_view value)
{
    std::ostringstream out;
    out << std::hex;
    for (const unsigned char ch : value) {
        if ((ch >= 'a' && ch <= 'z') ||
            (ch >= 'A' && ch <= 'Z') ||
            (ch >= '0' && ch <= '9') ||
            ch == '-' || ch == '_' || ch == '.' || ch == '~') {
            out << static_cast<char>(ch);
        } else {
            out << '%' << std::uppercase << static_cast<int>(ch) << std::nouppercase;
        }
    }
    return out.str();
}

std::string JsonString(const nlohmann::json& value, const char* key)
{
    const auto it = value.find(key);
    if (it == value.end() || it->is_null()) {
        return {};
    }
    if (it->is_string()) {
        return Trim(it->get<std::string>());
    }
    if (it->is_number_integer()) {
        return std::to_string(it->get<int>());
    }
    return {};
}

int JsonInt(const nlohmann::json& value, const char* key, int fallback = 0)
{
    const auto it = value.find(key);
    if (it == value.end() || it->is_null()) {
        return fallback;
    }
    if (it->is_number_integer()) {
        return it->get<int>();
    }
    if (it->is_string()) {
        try {
            return std::stoi(Trim(it->get<std::string>()));
        } catch (...) {
        }
    }
    return fallback;
}

nlohmann::json CommandPayload(const nlohmann::json& command)
{
    const auto it = command.find("payload");
    if (it == command.end() || it->is_null()) {
        return nlohmann::json::object();
    }
    if (it->is_object()) {
        return *it;
    }
    if (it->is_string()) {
        nlohmann::json parsed = nlohmann::json::parse(it->get<std::string>(), nullptr, false);
        return parsed.is_object() ? parsed : nlohmann::json::object();
    }
    return nlohmann::json::object();
}

std::string FirstNonEmpty(std::initializer_list<std::string> values)
{
    for (auto value : values) {
        value = Trim(std::move(value));
        if (!value.empty()) {
            return value;
        }
    }
    return {};
}

std::string ResolveWebcamSource(int webcamIndex)
{
    const std::string testSource = ReadEnv("APP_AGENT_WEBCAM_TEST_SOURCE");
    const std::string allowTestSource = ReadEnv("APP_AGENT_RTSP_ALLOW_TEST_SOURCE");
    if (!testSource.empty() &&
        (allowTestSource == "1" || allowTestSource == "true" || allowTestSource == "TRUE") &&
        (testSource.rfind("lavfi:", 0) == 0 || testSource.rfind("file:", 0) == 0)) {
        return testSource;
    }

    const std::string device = ReadEnv("APP_AGENT_WEBCAM_DEVICE");
    if (!device.empty()) {
        return device.rfind("v4l2:", 0) == 0 ? device : "v4l2:" + device;
    }

    if (webcamIndex < 0) {
        webcamIndex = 0;
    }
    return "v4l2:/dev/video" + std::to_string(webcamIndex);
}

std::string ResolveWebcamFrameRate()
{
    const std::string raw = ReadEnv("APP_AGENT_WEBCAM_FRAMERATE");
    if (!raw.empty()) {
        try {
            const int parsed = std::stoi(raw);
            if (parsed > 0 && parsed <= 60) {
                return std::to_string(parsed);
            }
        } catch (...) {
        }
    }
    return "15";
}

std::optional<perceptrum::linux_runtime::LinuxRtspCameraConfig> CameraConfigFromCommand(
    const nlohmann::json& command)
{
    const nlohmann::json payload = CommandPayload(command);
    const nlohmann::json* camera = nullptr;
    if (payload.contains("camera") && payload["camera"].is_object()) {
        camera = &payload["camera"];
    } else {
        camera = &payload;
    }

    nlohmann::json mergedCamera = camera->is_object() ? *camera : nlohmann::json::object();
    if (payload.is_object()) {
        for (auto it = payload.begin(); it != payload.end(); ++it) {
            if (it.key() == "camera" || mergedCamera.contains(it.key())) {
                continue;
            }
            mergedCamera[it.key()] = it.value();
        }
    }
    const std::vector<std::string> rtspCandidates =
        perceptrum::linux_runtime::BuildLinuxRtspCandidatesFromCameraJson(mergedCamera);

    perceptrum::linux_runtime::LinuxRtspCameraConfig config;
    config.rtspCandidates = rtspCandidates;
    config.rtspUrl = rtspCandidates.empty() ? std::string() : rtspCandidates.front();

    config.connectionMethod = FirstNonEmpty({
        JsonString(*camera, "connection_method"),
        JsonString(*camera, "connectionMethod"),
        JsonString(payload, "connection_method"),
        JsonString(payload, "connectionMethod"),
    });
    if (config.connectionMethod.empty()) {
        config.connectionMethod = config.rtspUrl.empty() ? "WEBCAM" : "RTSP";
    }
    config.webcamIndex = JsonInt(*camera, "webcam_index", JsonInt(*camera, "webcamIndex", -1));
    if (config.webcamIndex < 0) {
        config.webcamIndex = JsonInt(payload, "webcam_index", JsonInt(payload, "webcamIndex", -1));
    }

    const std::string normalizedConnectionMethod = TrimLower(config.connectionMethod);
    if (config.rtspUrl.empty() && (normalizedConnectionMethod == "webcam" || config.webcamIndex >= 0)) {
        if (config.webcamIndex < 0) {
            config.webcamIndex = 0;
        }
        config.connectionMethod = "WEBCAM";
        config.rtspUrl = ResolveWebcamSource(config.webcamIndex);
        config.rtspCandidates.clear();
    }
    if (config.rtspUrl.empty()) {
        return std::nullopt;
    }

    config.cameraId = FirstNonEmpty({
        JsonString(command, "camera_id"),
        JsonString(*camera, "camera_id"),
        JsonString(*camera, "cameraId"),
        JsonString(*camera, "id"),
        "linux-job-camera",
    });
    config.cameraName = FirstNonEmpty({
        JsonString(*camera, "camera_name"),
        JsonString(*camera, "cameraName"),
        JsonString(*camera, "name"),
        normalizedConnectionMethod == "webcam" ? "Linux webcam" : "Linux job camera",
    });
    return config;
}

bool StartCameraResultFailed(const nlohmann::json& result, std::string& error)
{
    error = JsonString(result, "error");
    const bool started = result.value("started", false);
    const bool thumbnailGenerated = result.value("thumbnail_generated", false);
    const bool recordingGenerated = result.value("recording_clip_generated", false);
    const bool recordingSessionStarted = result.value("recording_session_started", false);
    const bool thumbnailUploaded = result.value("thumbnail_uploaded", true);
    if (!error.empty()) {
        return true;
    }
    if (!started) {
        error = "camera_start_failed";
        return true;
    }
    if (!thumbnailGenerated) {
        error = "camera_start_failed: no thumbnail frame was captured";
        return true;
    }
    if (!recordingGenerated && !recordingSessionStarted) {
        error = "camera_start_failed: no recording clip or resident session was started";
        return true;
    }
    if (!thumbnailUploaded) {
        error = JsonString(result, "thumbnail_upload_error");
        if (error.empty()) {
            error = "camera_start_failed: thumbnail upload failed";
        }
        return true;
    }
    return false;
}

std::string LinuxCameraStartErrorCode(const std::string& error)
{
    const std::string trimmed = Trim(error);
    if (trimmed.empty()) {
        return "";
    }

    const std::size_t separator = trimmed.find_first_of(": \t\r\n");
    return separator == std::string::npos ? trimmed : trimmed.substr(0, separator);
}

std::string Base64Encode(const std::vector<unsigned char>& bytes)
{
    static constexpr char table[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve(((bytes.size() + 2) / 3) * 4);
    std::size_t index = 0;
    while (index + 3 <= bytes.size()) {
        const unsigned int a = bytes[index++];
        const unsigned int b = bytes[index++];
        const unsigned int c = bytes[index++];
        out.push_back(table[(a >> 2) & 0x3F]);
        out.push_back(table[((a & 0x03) << 4) | ((b >> 4) & 0x0F)]);
        out.push_back(table[((b & 0x0F) << 2) | ((c >> 6) & 0x03)]);
        out.push_back(table[c & 0x3F]);
    }
    const std::size_t remaining = bytes.size() - index;
    if (remaining == 1) {
        const unsigned int a = bytes[index];
        out.push_back(table[(a >> 2) & 0x3F]);
        out.push_back(table[(a & 0x03) << 4]);
        out.push_back('=');
        out.push_back('=');
    } else if (remaining == 2) {
        const unsigned int a = bytes[index++];
        const unsigned int b = bytes[index];
        out.push_back(table[(a >> 2) & 0x3F]);
        out.push_back(table[((a & 0x03) << 4) | ((b >> 4) & 0x0F)]);
        out.push_back(table[(b & 0x0F) << 2]);
        out.push_back('=');
    }
    return out;
}

bool ReadBinaryFile(const std::filesystem::path& path, std::vector<unsigned char>& bytes)
{
    std::ifstream stream(path, std::ios::binary);
    if (!stream.is_open()) {
        return false;
    }
    bytes.assign(
        std::istreambuf_iterator<char>(stream),
        std::istreambuf_iterator<char>());
    return !bytes.empty();
}

std::vector<std::string> BuildProbeInputArgs(const std::string& source)
{
    if (source.rfind("lavfi:", 0) == 0) {
        return { "-f", "lavfi", "-i", source.substr(6) };
    }
    if (source.rfind("file:", 0) == 0) {
        return { "-i", source.substr(5) };
    }
    return {
        "-f",
        "v4l2",
        "-framerate",
        ResolveWebcamFrameRate(),
        "-i",
        source.rfind("v4l2:", 0) == 0 ? source.substr(5) : source,
    };
}

bool ProbeWebcamSource(const std::filesystem::path& outputPath, const std::string& source, std::string& error)
{
    std::vector<std::string> args = {
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
    };
    const std::vector<std::string> inputArgs = BuildProbeInputArgs(source);
    args.insert(args.end(), inputArgs.begin(), inputArgs.end());
    args.insert(args.end(), {
        "-frames:v",
        "1",
        "-q:v",
        "5",
        outputPath.string(),
    });

    perceptrum::platform::ProcessHandle process;
    perceptrum::platform::ProcessLaunchOptions options;
    options.executablePath = "ffmpeg";
    options.arguments = std::move(args);
    if (!perceptrum::platform::LaunchProcess(options, process, error)) {
        return false;
    }

    int exitCode = 1;
    if (!perceptrum::platform::WaitForProcessExit(process, 3000, exitCode)) {
        std::string terminateError;
        (void)perceptrum::platform::TerminateProcess(process, 124, 1000, &terminateError);
        perceptrum::platform::CloseProcess(process);
        error = "webcam_probe_timeout";
        return false;
    }
    perceptrum::platform::CloseProcess(process);

    if (exitCode != 0) {
        error = "webcam_probe_ffmpeg_exit_" + std::to_string(exitCode);
        return false;
    }

    std::error_code ec;
    if (!std::filesystem::exists(outputPath, ec) || std::filesystem::file_size(outputPath, ec) <= 0) {
        error = "webcam_probe_no_frame";
        return false;
    }
    return true;
}

std::string ResolveJobLlmProvider()
{
    std::string provider = TrimLower(ReadEnv("PERCEPTRUM_LINUX_LLM_PROVIDER"));
    if (provider.empty()) {
        provider = TrimLower(ReadEnv("APP_AGENT_LLM_PROVIDER"));
    }
    if (provider == "fake" || provider == "real" || provider == "openai" || provider == "zai") {
        return provider;
    }
    if (!ReadEnv("OPENAI_API_KEY").empty()) {
        return "openai";
    }
    if (!ReadEnv("ZAI_API_KEY").empty()) {
        return "zai";
    }
    return "openai";
}

std::string FirstPayloadString(const nlohmann::json& payload, std::initializer_list<const char*> keys)
{
    if (!payload.is_object()) {
        return {};
    }
    for (const char* key : keys) {
        const std::string value = JsonString(payload, key);
        if (!value.empty()) {
            return value;
        }
    }
    return {};
}

std::string FirstAgentString(const nlohmann::json& payload, std::initializer_list<const char*> keys)
{
    const auto stepsIt = payload.find("steps");
    if (stepsIt == payload.end() || !stepsIt->is_array()) {
        return {};
    }
    for (const auto& stepEnvelope : *stepsIt) {
        if (!stepEnvelope.is_object()) {
            continue;
        }
        const auto agentsIt = stepEnvelope.find("agents");
        if (agentsIt == stepEnvelope.end() || !agentsIt->is_array()) {
            continue;
        }
        for (const auto& agent : *agentsIt) {
            if (!agent.is_object()) {
                continue;
            }
            for (const char* key : keys) {
                const std::string value = JsonString(agent, key);
                if (!value.empty()) {
                    return value;
                }
            }
        }
    }
    return {};
}

std::string ResolveJobModelTier(const nlohmann::json& payload)
{
    std::string model = TrimLower(FirstPayloadString(payload, {
        "inference_model",
        "inferenceModel",
        "model_tier",
        "modelTier",
        "model",
    }));
    if (model.empty() && payload.contains("job") && payload["job"].is_object()) {
        model = TrimLower(FirstPayloadString(payload["job"], {
            "inference_model",
            "inferenceModel",
            "model_tier",
            "modelTier",
            "model",
        }));
    }
    if (model.empty()) {
        model = TrimLower(FirstAgentString(payload, { "inference_model", "inferenceModel", "model" }));
    }
    if (model == "ultra+" || model == "ultra-plus" || model == "ultra_plus") {
        return "ultra_plus";
    }
    if (model == "plus") {
        return "pro";
    }
    if (model == "legacy" ||
        model == "pro" ||
        model == "ultra" ||
        model == "ultra_plus" ||
        model == "light" ||
        model == "core") {
        return model;
    }
    return "ultra";
}

std::string LinuxJobModelNameForTier(const std::string& tier)
{
    if (tier == "core") return "GLM-4.7-Flash";
    if (tier == "ultra") return "gpt-5.1";
    if (tier == "ultra_plus") return "gpt-5.4";
    if (tier == "light") return "gpt-5.4-mini";
    return "gpt-5-mini";
}

std::string ResolveJobModelName(const nlohmann::json& payload, const std::string& tier)
{
    const std::string explicitModel = FirstPayloadString(payload, { "model_name", "modelName" });
    if (!explicitModel.empty() && explicitModel.find('/') == std::string::npos) {
        return explicitModel;
    }
    const std::string agentModel = FirstAgentString(payload, { "model_name", "modelName" });
    if (!agentModel.empty() && agentModel.find('/') == std::string::npos) {
        return agentModel;
    }
    return LinuxJobModelNameForTier(tier);
}

std::string ResolveJobProviderFromModelAndKeys(const nlohmann::json& payload, const std::string& requestedProvider)
{
    if (requestedProvider == "fake" || requestedProvider == "openai" || requestedProvider == "zai") {
        return requestedProvider;
    }

    const std::string payloadProvider = TrimLower(FirstPayloadString(payload, {
        "provider",
        "model_provider",
        "modelProvider",
        "llm_provider",
        "llmProvider",
    }));
    if (payloadProvider == "zai" || payloadProvider == "z.ai" || payloadProvider == "z ai") {
        return "zai";
    }
    if (payloadProvider == "openai" || payloadProvider == "open ai") {
        return "openai";
    }

    const std::string tier = ResolveJobModelTier(payload);
    if (tier == "core") {
        return "zai";
    }
    if (!FirstPayloadString(payload, { "openai_api_key", "openaiApiKey", "model_api_key", "modelApiKey" }).empty()) {
        return "openai";
    }
    if (!FirstPayloadString(payload, { "zai_api_key", "zaiApiKey" }).empty()) {
        return "zai";
    }
    if (!ReadEnv("OPENAI_API_KEY").empty()) {
        return "openai";
    }
    if (!ReadEnv("ZAI_API_KEY").empty()) {
        return "zai";
    }
    return "openai";
}

std::string ResolveProviderApiKey(const nlohmann::json& payload, const std::string& provider)
{
    if (provider == "zai") {
        return FirstNonEmpty({
            FirstPayloadString(payload, { "zai_api_key", "zaiApiKey", "api_key", "apiKey", "model_api_key", "modelApiKey" }),
            FirstAgentString(payload, { "api_key", "apiKey", "model_api_key", "modelApiKey" }),
            ReadEnv("ZAI_API_KEY"),
        });
    }
    return FirstNonEmpty({
        FirstPayloadString(payload, { "openai_api_key", "openaiApiKey", "api_key", "apiKey", "model_api_key", "modelApiKey" }),
        FirstAgentString(payload, { "api_key", "apiKey", "model_api_key", "modelApiKey" }),
        ReadEnv("OPENAI_API_KEY"),
    });
}

std::string ResolveRealProviderError(const nlohmann::json& payload, const std::string& provider)
{
    return ResolveProviderApiKey(payload, provider).empty()
        ? (provider == "zai" ? "missing_zai_api_key" : "missing_openai_api_key")
        : "";
}

std::uintmax_t SafeFileSize(const std::filesystem::path& path)
{
    std::error_code ec;
    if (!std::filesystem::exists(path, ec) || !std::filesystem::is_regular_file(path, ec)) {
        return 0;
    }
    return std::filesystem::file_size(path, ec);
}

bool IsNonEmptyRegularFile(const std::filesystem::path& path)
{
    return SafeFileSize(path) > 0;
}

std::filesystem::path NewerPath(
    const std::filesystem::path& current,
    const std::filesystem::path& candidate)
{
    if (current.empty()) {
        return candidate;
    }
    std::error_code ecCurrent;
    std::error_code ecCandidate;
    const auto currentTime = std::filesystem::last_write_time(current, ecCurrent);
    const auto candidateTime = std::filesystem::last_write_time(candidate, ecCandidate);
    if (ecCurrent) {
        return candidate;
    }
    if (ecCandidate) {
        return current;
    }
    return candidateTime > currentTime ? candidate : current;
}

std::string PathFilenameLower(const std::filesystem::path& path)
{
    std::string filename = path.filename().string();
    std::transform(filename.begin(), filename.end(), filename.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return filename;
}

void AddCameraId(std::set<std::string>& cameraIds, const std::string& value)
{
    const std::string trimmed = Trim(value);
    if (!trimmed.empty() && trimmed != "null") {
        cameraIds.insert(trimmed);
    }
}

std::vector<std::string> CollectJobCameraIds(
    const nlohmann::json& payload,
    const nlohmann::json& cameraResults)
{
    std::set<std::string> ids;
    AddCameraId(ids, JsonString(payload, "camera_id"));
    AddCameraId(ids, JsonString(payload, "cameraId"));
    const auto cameraIdsIt = payload.find("camera_ids");
    if (cameraIdsIt != payload.end()) {
        if (cameraIdsIt->is_array()) {
            for (const auto& item : *cameraIdsIt) {
                if (item.is_number_integer()) {
                    AddCameraId(ids, std::to_string(item.get<int>()));
                } else if (item.is_string()) {
                    AddCameraId(ids, item.get<std::string>());
                }
            }
        } else if (cameraIdsIt->is_string()) {
            AddCameraId(ids, cameraIdsIt->get<std::string>());
        }
    }
    const auto allCameraIdsIt = payload.find("all_camera_ids");
    if (allCameraIdsIt != payload.end() && allCameraIdsIt->is_array()) {
        for (const auto& item : *allCameraIdsIt) {
            if (item.is_number_integer()) {
                AddCameraId(ids, std::to_string(item.get<int>()));
            } else if (item.is_string()) {
                AddCameraId(ids, item.get<std::string>());
            }
        }
    }

    const auto startPayloadsIt = payload.find("start_camera_payloads");
    if (startPayloadsIt != payload.end() && startPayloadsIt->is_object()) {
        for (const auto& item : startPayloadsIt->items()) {
            AddCameraId(ids, item.key());
            if (item.value().is_object()) {
                AddCameraId(ids, JsonString(item.value(), "camera_id"));
                AddCameraId(ids, JsonString(item.value(), "cameraId"));
                if (item.value().contains("camera") && item.value()["camera"].is_object()) {
                    AddCameraId(ids, JsonString(item.value()["camera"], "id"));
                    AddCameraId(ids, JsonString(item.value()["camera"], "camera_id"));
                    AddCameraId(ids, JsonString(item.value()["camera"], "cameraId"));
                }
            }
        }
    }

    const auto stepsIt = payload.find("steps");
    if (stepsIt != payload.end() && stepsIt->is_array()) {
        for (const auto& stepEnvelope : *stepsIt) {
            if (!stepEnvelope.is_object()) {
                continue;
            }
            const auto targetsIt = stepEnvelope.find("targets");
            if (targetsIt != stepEnvelope.end() && targetsIt->is_array()) {
                for (const auto& target : *targetsIt) {
                    AddCameraId(ids, JsonString(target, "camera_id"));
                    AddCameraId(ids, JsonString(target, "cameraId"));
                }
            }
        }
    }

    if (cameraResults.is_array()) {
        for (const auto& result : cameraResults) {
            AddCameraId(ids, JsonString(result, "camera_id"));
            AddCameraId(ids, JsonString(result, "cameraId"));
        }
    }

    return std::vector<std::string>(ids.begin(), ids.end());
}

nlohmann::json FileArtifactJson(const std::filesystem::path& path)
{
    if (path.empty() || !IsNonEmptyRegularFile(path)) {
        return nlohmann::json(nullptr);
    }
    return {
        { "path", path.string() },
        { "bytes", SafeFileSize(path) },
    };
}

nlohmann::json CollectCameraArtifacts(
    const perceptrum::linux_runtime::RuntimePaths& paths,
    const std::vector<std::string>& cameraIds)
{
    const std::filesystem::path thumbnailRoot =
        perceptrum::linux_runtime::LinuxCameraThumbnailRoot(paths);
    const std::filesystem::path recordingsRoot =
        perceptrum::linux_runtime::LinuxCameraRecordingsRoot(paths);
    const std::filesystem::path jobsTempRoot =
        perceptrum::linux_runtime::LinuxJobsInferenceTempRoot(paths);

    nlohmann::json cameras = nlohmann::json::array();
    for (const std::string& cameraId : cameraIds) {
        std::filesystem::path thumbnail = thumbnailRoot / (cameraId + "-latest.jpg");
        if (!IsNonEmptyRegularFile(thumbnail)) {
            thumbnail.clear();
            std::error_code ec;
            if (std::filesystem::exists(thumbnailRoot, ec)) {
                for (const auto& entry : std::filesystem::directory_iterator(thumbnailRoot, ec)) {
                    if (ec || !entry.is_regular_file()) {
                        continue;
                    }
                    const std::string filename = PathFilenameLower(entry.path());
                    const std::string prefix = cameraId + "-";
                    if (filename.rfind(prefix, 0) == 0 &&
                        (filename.find(".jpg") != std::string::npos ||
                         filename.find(".jpeg") != std::string::npos)) {
                        thumbnail = NewerPath(thumbnail, entry.path());
                    }
                }
            }
        }

        std::map<int, std::filesystem::path> clips;
        const std::filesystem::path cameraClipRoot = recordingsRoot / ("cam_" + cameraId);
        std::error_code ec;
        if (std::filesystem::exists(cameraClipRoot, ec)) {
            for (const auto& entry : std::filesystem::recursive_directory_iterator(cameraClipRoot, ec)) {
                if (ec || !entry.is_regular_file() || SafeFileSize(entry.path()) == 0) {
                    continue;
                }
                const std::string filename = PathFilenameLower(entry.path());
                if (filename.size() < 4 || filename.substr(filename.size() - 4) != ".mp4") {
                    continue;
                }
                for (const int profile : { 10, 60, 300 }) {
                    const std::string marker = "_" + std::to_string(profile) + "s.mp4";
                    if (filename.size() >= marker.size() &&
                        filename.compare(filename.size() - marker.size(), marker.size(), marker) == 0) {
                        clips[profile] = NewerPath(clips[profile], entry.path());
                    }
                }
            }
        }

        nlohmann::json clipJson = nlohmann::json::object();
        for (const auto& item : clips) {
            const nlohmann::json fileJson = FileArtifactJson(item.second);
            if (!fileJson.is_null()) {
                clipJson[std::to_string(item.first)] = fileJson;
            }
        }

        cameras.push_back({
            { "camera_id", cameraId },
            { "latest_thumbnail", FileArtifactJson(thumbnail) },
            { "latest_clips", clipJson },
        });
    }

    return {
        { "thumbnail_root", thumbnailRoot.string() },
        { "recordings_root", recordingsRoot.string() },
        { "jobs_inference_temp_root", jobsTempRoot.string() },
        { "cameras", cameras },
    };
}

std::filesystem::path FirstThumbnailArtifactPath(const nlohmann::json& artifacts)
{
    const auto camerasIt = artifacts.find("cameras");
    if (camerasIt == artifacts.end() || !camerasIt->is_array()) {
        return {};
    }
    for (const auto& camera : *camerasIt) {
        if (!camera.is_object()) {
            continue;
        }
        const auto thumbIt = camera.find("latest_thumbnail");
        if (thumbIt == camera.end() || !thumbIt->is_object()) {
            continue;
        }
        const std::string path = JsonString(*thumbIt, "path");
        if (!path.empty() && IsNonEmptyRegularFile(path)) {
            return path;
        }
    }
    return {};
}

nlohmann::json FakeInferenceResult(
    const perceptrum::linux_runtime::RuntimePaths& paths,
    int commandId,
    int jobId,
    const nlohmann::json& payload,
    const nlohmann::json& artifacts)
{
    const std::filesystem::path tempRoot = perceptrum::linux_runtime::LinuxJobsInferenceTempRoot(paths);
    std::error_code ec;
    std::filesystem::create_directories(tempRoot, ec);

    nlohmann::json result = {
        { "provider", "fake" },
        { "network", false },
        { "job_id", jobId },
        { "command_id", commandId },
        { "sentiment_positive", false },
        { "answer", "fake_local_inference_ok" },
        { "model", payload.value("model", std::string("fake-local")) },
        { "input_artifacts", artifacts },
        { "created_at_utc", perceptrum::linux_runtime::UtcTimestampNow() },
    };

    const std::filesystem::path outPath =
        tempRoot / ("job_" + std::to_string(jobId > 0 ? jobId : 0) +
                    "_command_" + std::to_string(commandId > 0 ? commandId : 0) + ".json");
    std::ofstream stream(outPath, std::ios::binary | std::ios::trunc);
    if (stream.is_open()) {
        stream << result.dump(2) << '\n';
        if (stream.good()) {
            result["artifact_path"] = outPath.string();
        }
    }
    return result;
}

std::string BuildJobUserPrompt(const nlohmann::json& payload, const nlohmann::json& artifacts)
{
    const nlohmann::json job = payload.contains("job") && payload["job"].is_object()
        ? payload["job"]
        : nlohmann::json::object();
    const std::string explicitQuestion = FirstPayloadString(payload, {
        "query",
        "original_query",
        "question",
        "prompt",
        "user_prompt",
        "userPrompt",
        "llm_prompt",
        "llmPrompt",
    });
    const std::string agentPrompt = FirstAgentString(payload, {
        "prompt_template",
        "promptTemplate",
        "alert_condition",
        "alertCondition",
    });

    std::ostringstream prompt;
    prompt << "Analyze the most recent real camera artifact for this Linux job.\n";
    if (!JsonString(job, "name").empty()) {
        prompt << "Job: " << JsonString(job, "name") << "\n";
    }
    if (!JsonString(job, "description").empty()) {
        prompt << "Job description: " << JsonString(job, "description") << "\n";
    }
    if (!explicitQuestion.empty()) {
        prompt << "User question: " << explicitQuestion << "\n";
    }
    if (!agentPrompt.empty()) {
        prompt << "Agent instruction: " << agentPrompt << "\n";
    }
    prompt << "Available artifact metadata: " << artifacts.dump() << "\n";
    prompt << "Return JSON with fields: answer, alert_condition, confidence, summary.";
    return prompt.str();
}

std::string ExtractCompletionContent(const std::string& body)
{
    const nlohmann::json parsed = nlohmann::json::parse(body, nullptr, false);
    if (!parsed.is_object()) {
        return {};
    }
    const auto choicesIt = parsed.find("choices");
    if (choicesIt != parsed.end() && choicesIt->is_array() && !choicesIt->empty()) {
        const auto& first = choicesIt->front();
        if (first.is_object() &&
            first.contains("message") &&
            first["message"].is_object()) {
            return JsonString(first["message"], "content");
        }
    }
    const auto outputIt = parsed.find("output");
    if (outputIt != parsed.end() && outputIt->is_array()) {
        for (const auto& item : *outputIt) {
            if (!item.is_object() || !item.contains("content") || !item["content"].is_array()) {
                continue;
            }
            for (const auto& contentItem : item["content"]) {
                if (contentItem.is_object()) {
                    const std::string text = FirstPayloadString(contentItem, { "text", "output_text" });
                    if (!text.empty()) {
                        return text;
                    }
                }
            }
        }
    }
    return FirstPayloadString(parsed, { "content", "output_text", "text" });
}

bool JsonBoolLenient(const nlohmann::json& value, bool fallback = false)
{
    if (value.is_boolean()) {
        return value.get<bool>();
    }
    if (value.is_number_integer()) {
        return value.get<int>() != 0;
    }
    if (value.is_string()) {
        const std::string normalized = TrimLower(value.get<std::string>());
        if (normalized == "true" || normalized == "yes" || normalized == "1" || normalized == "positive") {
            return true;
        }
        if (normalized == "false" || normalized == "no" || normalized == "0" || normalized == "negative") {
            return false;
        }
    }
    return fallback;
}

nlohmann::json ParseModelJsonContent(const std::string& content)
{
    nlohmann::json parsed = nlohmann::json::parse(content, nullptr, false);
    if (parsed.is_object()) {
        return parsed;
    }
    const std::size_t first = content.find('{');
    const std::size_t last = content.rfind('}');
    if (first == std::string::npos || last == std::string::npos || last < first) {
        return nlohmann::json::object();
    }
    parsed = nlohmann::json::parse(content.substr(first, last - first + 1), nullptr, false);
    return parsed.is_object() ? parsed : nlohmann::json::object();
}

nlohmann::json RealInferenceResult(
    const perceptrum::linux_runtime::RuntimePaths& paths,
    int commandId,
    int jobId,
    const nlohmann::json& payload,
    const nlohmann::json& artifacts,
    const std::string& provider)
{
    const std::string tier = ResolveJobModelTier(payload);
    const std::string model = ResolveJobModelName(payload, tier);
    const std::string apiKey = ResolveProviderApiKey(payload, provider);
    if (apiKey.empty()) {
        throw std::runtime_error(provider == "zai" ? "missing_zai_api_key" : "missing_openai_api_key");
    }

    const std::filesystem::path thumbnailPath = FirstThumbnailArtifactPath(artifacts);
    if (thumbnailPath.empty()) {
        throw std::runtime_error("missing_camera_artifact");
    }
    std::vector<unsigned char> imageBytes;
    if (!ReadBinaryFile(thumbnailPath, imageBytes)) {
        throw std::runtime_error("camera_artifact_unreadable");
    }

    const std::string endpoint = provider == "zai"
        ? "https://api.z.ai/api/paas/v4/chat/completions"
        : "https://api.openai.com/v1/chat/completions";
    const std::string dataUrl = "data:image/jpeg;base64," + Base64Encode(imageBytes);
    const std::string systemPrompt =
        "You are a camera monitoring assistant. Use the attached real camera frame. "
        "Return only a compact JSON object.";
    const std::string userPrompt = BuildJobUserPrompt(payload, artifacts);

    nlohmann::json body = {
        { "model", model },
        { "messages", nlohmann::json::array({
            {
                { "role", "system" },
                { "content", systemPrompt },
            },
            {
                { "role", "user" },
                { "content", nlohmann::json::array({
                    {
                        { "type", "text" },
                        { "text", userPrompt },
                    },
                    {
                        { "type", "image_url" },
                        { "image_url", {
                            { "url", dataUrl },
                        } },
                    },
                }) },
            },
        }) },
        { "response_format", {
            { "type", "json_object" },
        } },
    };
    if (model.rfind("gpt-5", 0) == 0) {
        body["max_completion_tokens"] = 700;
    } else {
        body["max_tokens"] = 700;
        body["temperature"] = 0.1;
    }

    const auto startedAt = std::chrono::steady_clock::now();
    const chatv2::HttpResponse response = chatv2::postJson(endpoint, body.dump(), apiKey, {}, 30000);
    const long elapsedMs = static_cast<long>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - startedAt).count());
    if (!response.ok()) {
        throw std::runtime_error(response.error.empty()
            ? "llm_http_" + std::to_string(response.statusCode)
            : "llm_http_error");
    }

    const std::string content = ExtractCompletionContent(response.body);
    if (Trim(content).empty()) {
        throw std::runtime_error("llm_empty_response");
    }
    const nlohmann::json parsedContent = ParseModelJsonContent(content);
    const std::string answer = FirstNonEmpty({
        JsonString(parsedContent, "answer"),
        JsonString(parsedContent, "summary"),
        content,
    });
    const bool alertCondition = parsedContent.contains("alert_condition")
        ? JsonBoolLenient(parsedContent["alert_condition"], false)
        : (parsedContent.contains("sentiment_positive")
            ? JsonBoolLenient(parsedContent["sentiment_positive"], false)
            : false);
    double confidence = 0.0;
    if (parsedContent.contains("confidence") && parsedContent["confidence"].is_number()) {
        confidence = parsedContent["confidence"].get<double>();
    }

    const std::filesystem::path tempRoot = perceptrum::linux_runtime::LinuxJobsInferenceTempRoot(paths);
    std::error_code ec;
    std::filesystem::create_directories(tempRoot, ec);

    nlohmann::json result = {
        { "provider", provider },
        { "network", true },
        { "job_id", jobId },
        { "command_id", commandId },
        { "sentiment_positive", alertCondition },
        { "alert_condition", alertCondition },
        { "llm_alert_condition", alertCondition },
        { "final_alert_condition", alertCondition },
        { "confidence", confidence },
        { "answer", answer },
        { "model", model },
        { "inference_model", tier },
        { "elapsed_ms", elapsedMs },
        { "input_artifacts", artifacts },
        { "model_output", parsedContent.empty() ? nlohmann::json::object() : parsedContent },
        { "created_at_utc", perceptrum::linux_runtime::UtcTimestampNow() },
    };

    const std::filesystem::path outPath =
        tempRoot / ("job_" + std::to_string(jobId > 0 ? jobId : 0) +
                    "_command_" + std::to_string(commandId > 0 ? commandId : 0) + "_real.json");
    std::ofstream stream(outPath, std::ios::binary | std::ios::trunc);
    if (stream.is_open()) {
        stream << result.dump(2) << '\n';
        if (stream.good()) {
            result["artifact_path"] = outPath.string();
        }
    }
    return result;
}

} // namespace

namespace perceptrum::linux_runtime {

LinuxJobRuntime::LinuxJobRuntime(
    RuntimePaths paths,
    perceptrum::runtime::IRuntimeLogger* logger,
    perceptrum::runtime::ITokenStore* tokenStore)
    : paths_(std::move(paths))
    , logger_(logger)
    , tokenStore_(tokenStore)
    , cameraSessions_(paths_, logger_)
{
}

LinuxJobRuntime::~LinuxJobRuntime()
{
    stop();
}

bool LinuxJobRuntime::start()
{
    if (running_.exchange(true)) {
        return true;
    }

    const auto config = ReadAgentConfig(paths_);
    const auto token = tokenStore_ != nullptr ? tokenStore_->readToken() : std::nullopt;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        baseUrl_ = config.has_value() ? Trim(config->baseUrl) : ResolveBaseUrl();
        clientId_ = config.has_value() ? Trim(config->clientId) : ReadClientId(paths_);
        token_ = token.has_value() ? Trim(*token) : std::string();
        llmProvider_ = ResolveJobLlmProvider();
        lastError_.clear();
        if (baseUrl_.empty() || clientId_.empty() || token_.empty()) {
            lastError_ = "job_runtime_waiting_for_pairing";
        }
    }

    worker_ = std::thread(&LinuxJobRuntime::workerLoop, this);
    if (logger_ != nullptr) {
        logger_->info("jobs", "LinuxJobRuntime started");
    }
    return true;
}

void LinuxJobRuntime::stop() noexcept
{
    if (!running_.exchange(false)) {
        cameraSessions_.shutdown();
        return;
    }
    if (worker_.joinable()) {
        worker_.join();
    }
    if (logger_ != nullptr) {
        logger_->info("jobs", "LinuxJobRuntime stopped");
    }
    cameraSessions_.shutdown();
}

void LinuxJobRuntime::applyStatus(perceptrum::runtime::AgentRuntimeStatus& status) const
{
    std::lock_guard<std::mutex> lock(mutex_);
    status.jobRuntimeEnabled = true;
    status.jobsInferenceTempRoot = LinuxJobsInferenceTempRoot(paths_).string();
    status.inferenceTempRoot = LinuxInferenceTempRoot(paths_).string();
    status.jobRuntimeLastCommandType = lastCommandType_;
    status.jobRuntimeLastError = lastError_;
    status.jobRuntimeLlmProvider = llmProvider_;
    status.jobRuntimeCommandsPolled = commandsPolled_;
    status.jobRuntimeCommandsCompleted = commandsCompleted_;
    status.jobRuntimeCommandsFailed = commandsFailed_;
    status.cameraSessionStatusJson = cameraSessions_.statusJson().dump();
}

void LinuxJobRuntime::workerLoop()
{
    const int pollIntervalMs = ReadPollIntervalMs();
    while (running_.load()) {
        pollOnce();
        for (int elapsed = 0; elapsed < pollIntervalMs && running_.load(); elapsed += 50) {
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
        }
    }
}

void LinuxJobRuntime::pollOnce()
{
    std::string baseUrl;
    std::string clientId;
    std::string token;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        baseUrl = baseUrl_;
        clientId = clientId_;
        token = token_;
    }

    if (baseUrl.empty() || clientId.empty() || token.empty()) {
        return;
    }

    while (!baseUrl.empty() && baseUrl.back() == '/') {
        baseUrl.pop_back();
    }
    const std::string url = baseUrl + "/api/agent/commands?client_id=" + UrlEncode(clientId);
    const std::vector<std::string> headers = {
        "X-EXE-Timezone: " + RuntimeTimezone(),
    };
    const chatv2::HttpResponse response = chatv2::getUrl(url, token, headers, 5000);
    if (!response.ok()) {
        std::lock_guard<std::mutex> lock(mutex_);
        lastError_ = response.error.empty()
            ? "commands_poll_http_" + std::to_string(response.statusCode)
            : response.error;
        return;
    }

    const nlohmann::json commands = nlohmann::json::parse(response.body, nullptr, false);
    if (!commands.is_array()) {
        std::lock_guard<std::mutex> lock(mutex_);
        lastError_ = "commands_poll_invalid_json";
        return;
    }

    {
        std::lock_guard<std::mutex> lock(mutex_);
        commandsPolled_ += static_cast<int>(commands.size());
        lastError_.clear();
    }

    for (const auto& command : commands) {
        if (!running_.load()) {
            break;
        }
        if (command.is_object()) {
            executeCommand(command);
        }
    }
}

void LinuxJobRuntime::executeCommand(const nlohmann::json& command)
{
    const int commandId = JsonInt(command, "id");
    const std::string type = TrimLower(JsonString(command, "command_type"));
    try {
        nlohmann::json result;
        if (type == "start_camera") {
            result = executeStartCamera(command);
        } else if (type == "stop_camera") {
            result = executeStopCamera(command);
        } else if (type == "probe_webcams") {
            result = executeProbeWebcams(command);
        } else if (type == "orchestrator_query") {
            result = executeOrchestratorQuery(command);
        } else if (type == "job_start") {
            result = executeJobStart(command);
        } else if (type == "job_stop") {
            result = executeJobStop(command);
        } else {
            throw std::runtime_error("unsupported_command_type");
        }

        std::string terminalError;
        const bool failedStartCamera = type == "start_camera" && StartCameraResultFailed(result, terminalError);
        const std::string terminalStatus = failedStartCamera ? "failed" : "completed";
        if (postCommandResult(commandId, terminalStatus, result, terminalError)) {
            if (failedStartCamera) {
                recordFailed(type, terminalError);
            } else {
                recordCompleted(type);
            }
        }
    } catch (const std::exception& ex) {
        const std::string error = ex.what();
        (void)postCommandResult(commandId, "failed", nlohmann::json::object(), error);
        recordFailed(type, error);
    }
}

nlohmann::json LinuxJobRuntime::executeStartCamera(const nlohmann::json& command)
{
    const auto config = CameraConfigFromCommand(command);
    if (!config.has_value()) {
        throw std::runtime_error("camera_payload_missing_source");
    }
    const int numericCameraId = JsonInt(command, "camera_id", JsonInt(CommandPayload(command), "camera_id", 0));
    LinuxCameraSessionStartResult session = cameraSessions_.startCamera(*config);
    bool thumbnailUploaded = false;
    std::string thumbnailUploadError;
    if (session.thumbnailGenerated && numericCameraId > 0) {
        thumbnailUploaded = postThumbnail(numericCameraId, session.thumbnailPath, thumbnailUploadError);
    }
    if (session.error.empty() &&
        session.thumbnailGenerated &&
        numericCameraId > 0 &&
        !thumbnailUploaded) {
        session.error = thumbnailUploadError.empty()
            ? "thumbnail_upload_failed"
            : "thumbnail_upload_failed: " + thumbnailUploadError;
        (void)cameraSessions_.stopCamera(session.cameraId);
        session.recordingSessionStarted = false;
    }

    nlohmann::json result = {
        { "command", "start_camera" },
        { "camera_id", session.cameraId },
        { "camera_name", session.cameraName },
        { "connection_method", session.connectionMethod },
        { "webcam_index", session.webcamIndex >= 0 ? nlohmann::json(session.webcamIndex) : nlohmann::json(nullptr) },
        { "source", session.source },
        { "started", session.started },
        { "first_frame_captured", session.thumbnailGenerated },
        { "reused", session.reused },
        { "thumbnail_generated", session.thumbnailGenerated },
        { "thumbnail_path", session.thumbnailPath },
        { "thumbnail_uploaded", thumbnailUploaded || !session.thumbnailGenerated || numericCameraId <= 0 },
        { "thumbnail_upload_error", thumbnailUploadError },
        { "recording_session_started", session.recordingSessionStarted },
        { "recording_clip_generated", false },
        { "clip_directory", session.clipDirectory },
        { "recordings_root", session.recordingsRoot },
        { "thumbnail_root", session.thumbnailRoot },
        { "inference_temp_root", session.inferenceTempRoot },
        { "jobs_inference_temp_root", session.jobsInferenceTempRoot },
        { "candidate_count", session.candidateCount },
        { "attempted_rtsp_urls", session.attemptedRtspUrlsMasked },
        { "active_rtsp_url", session.activeRtspUrlMasked },
        { "active_rtsp_url_masked", session.activeRtspUrlMasked },
        { "reconnecting", session.reconnecting },
        { "reconnect_attempts", session.reconnectAttempts },
        { "start_latency_ms", session.startLatencyMs },
        { "error_code", LinuxCameraStartErrorCode(session.error) },
        { "error", session.error },
    };
    return result;
}

nlohmann::json LinuxJobRuntime::executeStopCamera(const nlohmann::json& command)
{
    const nlohmann::json payload = CommandPayload(command);
    const std::string cameraId = FirstNonEmpty({
        JsonString(command, "camera_id"),
        JsonString(payload, "camera_id"),
        JsonString(payload, "cameraId"),
    });
    LinuxCameraSessionStopResult stopped = cameraSessions_.stopCamera(cameraId);
    return {
        { "command", "stop_camera" },
        { "camera_id", cameraId },
        { "stopped", stopped.stopped },
        { "was_running", stopped.wasRunning },
        { "error", stopped.error },
    };
}

nlohmann::json LinuxJobRuntime::executeProbeWebcams(const nlohmann::json& command)
{
    const nlohmann::json payload = CommandPayload(command);
    std::vector<int> indices;
    const auto indicesIt = payload.find("indices");
    if (indicesIt != payload.end() && indicesIt->is_array()) {
        for (const auto& item : *indicesIt) {
            int value = -1;
            if (item.is_number_integer()) {
                value = item.get<int>();
            } else if (item.is_string()) {
                try {
                    value = std::stoi(Trim(item.get<std::string>()));
                } catch (...) {
                }
            }
            if (value >= 0 && value <= 5 &&
                std::find(indices.begin(), indices.end(), value) == indices.end()) {
                indices.push_back(value);
            }
        }
    }
    if (indices.empty()) {
        indices = { 0, 1, 2, 3, 4, 5 };
    }

    const std::filesystem::path probeRoot = paths_.cacheRoot / "agentcore" / "webcam-probes";
    std::error_code ec;
    std::filesystem::create_directories(probeRoot, ec);

    nlohmann::json attempted = nlohmann::json::array();
    nlohmann::json responding = nlohmann::json::array();
    nlohmann::json errors = nlohmann::json::array();
    int preferredIndex = -1;
    for (const int index : indices) {
        attempted.push_back(index);
        const std::string source = ResolveWebcamSource(index);
        const std::filesystem::path outputPath =
            probeRoot / ("webcam_" + std::to_string(index) + "_probe.jpg");
        std::string error;
        if (ProbeWebcamSource(outputPath, source, error)) {
            responding.push_back(index);
            if (preferredIndex < 0) {
                preferredIndex = index;
            }
        } else {
            errors.push_back({
                { "index", index },
                { "source", source.rfind("v4l2:", 0) == 0 ? source.substr(5) : source },
                { "error", error },
            });
        }
    }

    return {
        { "command", "probe_webcams" },
        { "attempted_indices", attempted },
        { "responding_indices", responding },
        { "preferred_index", preferredIndex >= 0 ? nlohmann::json(preferredIndex) : nlohmann::json(nullptr) },
        { "errors", errors },
    };
}

nlohmann::json LinuxJobRuntime::executeOrchestratorQuery(const nlohmann::json& command)
{
    const int commandId = JsonInt(command, "id");
    const nlohmann::json payload = CommandPayload(command);
    const int chatSessionId = JsonInt(payload, "chat_session_id", JsonInt(payload, "chatSessionId"));
    if (chatSessionId <= 0) {
        throw std::runtime_error("missing_chat_session_id");
    }

    const int cameraId = JsonInt(payload, "camera_id", JsonInt(payload, "cameraId"));
    std::vector<std::string> cameraIds = CollectJobCameraIds(payload, nlohmann::json::array());
    if (cameraIds.empty() && cameraId > 0) {
        cameraIds.push_back(std::to_string(cameraId));
    }
    if (cameraIds.empty()) {
        throw std::runtime_error("missing_camera_id");
    }

    const nlohmann::json artifacts = CollectCameraArtifacts(paths_, cameraIds);
    const std::string requestedProvider = TrimLower(ReadEnv("PERCEPTRUM_LINUX_LLM_PROVIDER"));
    const std::string provider = ResolveJobProviderFromModelAndKeys(payload, requestedProvider);
    const nlohmann::json inference = RealInferenceResult(paths_, commandId, 0, payload, artifacts, provider);
    const std::string answer = JsonString(inference, "answer");
    if (answer.empty()) {
        throw std::runtime_error("llm_empty_answer");
    }

    nlohmann::json cameraIdsJson = nlohmann::json::array();
    for (const std::string& id : cameraIds) {
        try {
            cameraIdsJson.push_back(std::stoi(id));
        } catch (...) {
            cameraIdsJson.push_back(id);
        }
    }

    nlohmann::json chatBody = {
        { "chat_session_id", chatSessionId },
        { "command_id", commandId },
        { "answer", answer },
        { "response_type", "final_answer" },
        { "camera_ids", cameraIdsJson },
        { "original_query", JsonString(payload, "query") },
        { "source_type", "linux_orchestrator_query" },
        { "message_metadata", {
            { "source_type", "linux_orchestrator_query" },
            { "provider", JsonString(inference, "provider") },
            { "model", JsonString(inference, "model") },
            { "input_artifacts", artifacts },
        } },
    };
    if (inference.contains("model_prompt_tokens")) {
        chatBody["model_prompt_tokens"] = inference["model_prompt_tokens"];
    }
    if (inference.contains("model_output_tokens")) {
        chatBody["model_output_tokens"] = inference["model_output_tokens"];
    }
    if (inference.contains("model_total_tokens")) {
        chatBody["model_total_tokens"] = inference["model_total_tokens"];
    }

    const bool chatResponsePosted = postChatResponse(chatBody);
    if (!chatResponsePosted) {
        throw std::runtime_error("chat_response_post_failed");
    }

    {
        std::lock_guard<std::mutex> lock(mutex_);
        llmProvider_ = provider;
    }

    return {
        { "command", "orchestrator_query" },
        { "chat_session_id", chatSessionId },
        { "camera_ids", cameraIdsJson },
        { "camera_artifacts", artifacts },
        { "inference", inference },
        { "chat_response_posted", chatResponsePosted },
    };
}

nlohmann::json LinuxJobRuntime::executeJobStart(const nlohmann::json& command)
{
    const int commandId = JsonInt(command, "id");
    const nlohmann::json payload = CommandPayload(command);
    const nlohmann::json job = payload.contains("job") && payload["job"].is_object()
        ? payload["job"]
        : nlohmann::json::object();
    const int jobId = JsonInt(job, "id", JsonInt(payload, "job_id"));
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (jobId > 0) {
            activeJobs_.insert(jobId);
        }
    }

    nlohmann::json cameras = nlohmann::json::array();
    const auto startPayloadsIt = payload.find("start_camera_payloads");
    if (startPayloadsIt != payload.end() && startPayloadsIt->is_object()) {
        for (const auto& item : startPayloadsIt->items()) {
            nlohmann::json syntheticCommand = {
                { "command_type", "start_camera" },
                { "camera_id", item.key() },
                { "payload", item.value() },
            };
            try {
                cameras.push_back(executeStartCamera(syntheticCommand));
            } catch (const std::exception& ex) {
                cameras.push_back({
                    { "camera_id", item.key() },
                    { "started", false },
                    { "error", ex.what() },
                });
            }
        }
    }

    const std::vector<std::string> cameraIds = CollectJobCameraIds(payload, cameras);
    const nlohmann::json artifacts = CollectCameraArtifacts(paths_, cameraIds);
    const std::string requestedProvider = ResolveJobLlmProvider();
    const std::string provider = ResolveJobProviderFromModelAndKeys(payload, requestedProvider);
    if (provider == "openai" || provider == "zai") {
        const std::string realError = ResolveRealProviderError(payload, provider);
        if (!realError.empty()) {
            throw std::runtime_error(realError);
        }
    }

    nlohmann::json inference = provider == "fake"
        ? FakeInferenceResult(paths_, commandId, jobId, payload, artifacts)
        : RealInferenceResult(paths_, commandId, jobId, payload, artifacts, provider);
    inference["provider_requested"] = requestedProvider;

    {
        std::lock_guard<std::mutex> lock(mutex_);
        llmProvider_ = provider;
    }

    const std::string jobRunId = FirstNonEmpty({
        JsonString(command, "job_run_id"),
        JsonString(payload, "job_run_id"),
        JsonString(payload, "jobRunId"),
    });
    nlohmann::json stepEnvelopeForEvent = nlohmann::json::object();
    nlohmann::json step = nlohmann::json::object();
    nlohmann::json agent = nlohmann::json::object();
    nlohmann::json target = nlohmann::json::object();
    if (payload.contains("steps") && payload["steps"].is_array() && !payload["steps"].empty()) {
        const auto& stepEnvelope = payload["steps"].front();
        if (stepEnvelope.is_object()) {
            stepEnvelopeForEvent = stepEnvelope;
            if (stepEnvelope.contains("step") && stepEnvelope["step"].is_object()) {
                step = stepEnvelope["step"];
            }
            if (stepEnvelope.contains("agents") && stepEnvelope["agents"].is_array() && !stepEnvelope["agents"].empty()) {
                agent = stepEnvelope["agents"].front();
            }
            if (stepEnvelope.contains("targets") && stepEnvelope["targets"].is_array() && !stepEnvelope["targets"].empty()) {
                target = stepEnvelope["targets"].front();
            }
        }
    }
    int eventCameraId = JsonInt(target, "camera_id", JsonInt(target, "cameraId"));
    if (eventCameraId <= 0 && !cameraIds.empty()) {
        try {
            eventCameraId = std::stoi(cameraIds.front());
        } catch (...) {
            eventCameraId = 0;
        }
    }
    nlohmann::json eventDetails = inference;
    eventDetails["job_id"] = jobId;
    eventDetails["job_name"] = JsonString(job, "name");
    eventDetails["job_run_id"] = jobRunId;
    eventDetails["step_id"] = JsonInt(step, "id");
    eventDetails["step_run_id"] = FirstNonEmpty({
        JsonString(stepEnvelopeForEvent, "step_run_id"),
        JsonString(stepEnvelopeForEvent, "stepRunId"),
        JsonString(step, "step_run_id"),
        JsonString(step, "stepRunId"),
        JsonString(payload, "step_run_id"),
    });
    eventDetails["step_order"] = JsonInt(step, "step_order", JsonInt(step, "stepOrder"));
    eventDetails["step_name"] = JsonString(step, "name");
    eventDetails["agent_id"] = JsonInt(agent, "id");
    eventDetails["agent_run_id"] = FirstNonEmpty({
        JsonString(agent, "agent_run_id"),
        JsonString(agent, "agentRunId"),
        JsonString(payload, "agent_run_id"),
    });
    eventDetails["agent_key"] = FirstNonEmpty({
        JsonString(agent, "agent_key"),
        JsonString(agent, "agentKey"),
        "linux_job_inference",
    });
    if (eventCameraId > 0) {
        eventDetails["camera_id"] = eventCameraId;
    }
    eventDetails["camera_name"] = JsonString(target, "camera_name");
    eventDetails["input_type"] = FirstNonEmpty({
        JsonString(agent, "input_type"),
        JsonString(agent, "inputType"),
        FirstThumbnailArtifactPath(artifacts).empty() ? "video" : "image",
    });
    eventDetails["source_event_id"] =
        "linux_job_" + (jobRunId.empty() ? std::to_string(commandId) : jobRunId) +
        "_command_" + std::to_string(commandId);
    const bool backendEventPosted = postAgentEvent(
        "job_agent_completed",
        eventCameraId,
        JsonString(inference, "answer"),
        eventDetails);
    inference["backend_event_posted"] = backendEventPosted;

    return {
        { "command", "job_start" },
        { "job_id", jobId },
        { "job_name", JsonString(job, "name") },
        { "job_run_id", jobRunId },
        { "status", "running" },
        { "camera_results", cameras },
        { "camera_artifacts", artifacts },
        { "inference", inference },
        { "jobs_inference_temp_root", LinuxJobsInferenceTempRoot(paths_).string() },
    };
}

nlohmann::json LinuxJobRuntime::executeJobStop(const nlohmann::json& command)
{
    const nlohmann::json payload = CommandPayload(command);
    const nlohmann::json job = payload.contains("job") && payload["job"].is_object()
        ? payload["job"]
        : nlohmann::json::object();
    const int jobId = JsonInt(job, "id", JsonInt(payload, "job_id"));
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (jobId > 0) {
            activeJobs_.erase(jobId);
        }
    }
    return {
        { "command", "job_stop" },
        { "job_id", jobId },
        { "job_name", JsonString(job, "name") },
        { "job_run_id", JsonString(command, "job_run_id") },
        { "status", "stopped" },
    };
}

bool LinuxJobRuntime::postCommandResult(
    int commandId,
    const std::string& status,
    const nlohmann::json& result,
    const std::string& error)
{
    if (commandId <= 0) {
        return false;
    }

    std::string baseUrl;
    std::string clientId;
    std::string token;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        baseUrl = baseUrl_;
        clientId = clientId_;
        token = token_;
    }
    while (!baseUrl.empty() && baseUrl.back() == '/') {
        baseUrl.pop_back();
    }
    const std::string url =
        baseUrl + "/api/agent/commands/" + std::to_string(commandId) +
        "/result?client_id=" + UrlEncode(clientId);
    const nlohmann::json body = {
        { "status", status },
        { "result", result },
        { "error", error.empty() ? nlohmann::json(nullptr) : nlohmann::json(error) },
    };
    const chatv2::HttpResponse response = chatv2::postJson(url, body.dump(), token, {}, 5000);
    if (!response.ok()) {
        std::lock_guard<std::mutex> lock(mutex_);
        lastError_ = response.error.empty()
            ? "command_result_http_" + std::to_string(response.statusCode)
            : response.error;
        return false;
    }
    return true;
}

bool LinuxJobRuntime::postChatResponse(const nlohmann::json& body)
{
    std::string baseUrl;
    std::string clientId;
    std::string token;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        baseUrl = baseUrl_;
        clientId = clientId_;
        token = token_;
    }
    while (!baseUrl.empty() && baseUrl.back() == '/') {
        baseUrl.pop_back();
    }
    if (baseUrl.empty() || clientId.empty() || token.empty()) {
        return false;
    }

    const std::string url =
        baseUrl + "/api/agent/chat-response?client_id=" + UrlEncode(clientId);
    const chatv2::HttpResponse response = chatv2::postJson(url, body.dump(), token, {}, 10000);
    if (!response.ok()) {
        std::lock_guard<std::mutex> lock(mutex_);
        lastError_ = response.error.empty()
            ? "chat_response_http_" + std::to_string(response.statusCode)
            : response.error;
        return false;
    }
    return true;
}

bool LinuxJobRuntime::postAgentEvent(
    const std::string& eventType,
    int cameraId,
    const std::string& message,
    const nlohmann::json& details)
{
    std::string baseUrl;
    std::string clientId;
    std::string token;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        baseUrl = baseUrl_;
        clientId = clientId_;
        token = token_;
    }
    while (!baseUrl.empty() && baseUrl.back() == '/') {
        baseUrl.pop_back();
    }
    if (baseUrl.empty() || clientId.empty() || token.empty()) {
        return false;
    }

    nlohmann::json body = {
        { "event_type", eventType },
        { "camera_id", cameraId > 0 ? nlohmann::json(cameraId) : nlohmann::json(nullptr) },
        { "message", message },
        { "details", details },
    };
    if (details.contains("job_run_id")) {
        body["job_run_id"] = details["job_run_id"];
    }
    if (details.contains("step_run_id")) {
        body["step_run_id"] = details["step_run_id"];
    }
    if (details.contains("agent_run_id")) {
        body["agent_run_id"] = details["agent_run_id"];
    }
    if (details.contains("source_event_id")) {
        body["external_event_id"] = details["source_event_id"];
    }

    const std::string url =
        baseUrl + "/api/agent/events?client_id=" + UrlEncode(clientId);
    const chatv2::HttpResponse response = chatv2::postJson(url, body.dump(), token, {}, 5000);
    if (!response.ok()) {
        std::lock_guard<std::mutex> lock(mutex_);
        lastError_ = response.error.empty()
            ? "agent_event_http_" + std::to_string(response.statusCode)
            : response.error;
        return false;
    }
    return true;
}

bool LinuxJobRuntime::postThumbnail(
    int cameraId,
    const std::filesystem::path& thumbnailPath,
    std::string& error)
{
    error.clear();
    if (cameraId <= 0) {
        error = "invalid_camera_id";
        return false;
    }

    std::string baseUrl;
    std::string clientId;
    std::string token;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        baseUrl = baseUrl_;
        clientId = clientId_;
        token = token_;
    }
    while (!baseUrl.empty() && baseUrl.back() == '/') {
        baseUrl.pop_back();
    }
    if (baseUrl.empty() || clientId.empty() || token.empty()) {
        error = "thumbnail_upload_not_provisioned";
        return false;
    }

    std::vector<unsigned char> bytes;
    if (!ReadBinaryFile(thumbnailPath, bytes)) {
        error = "thumbnail_file_unavailable";
        return false;
    }

    const nlohmann::json body = {
        { "camera_id", cameraId },
        { "jpeg_base64", "data:image/jpeg;base64," + Base64Encode(bytes) },
    };
    const std::string url =
        baseUrl + "/api/agent/thumbnails?client_id=" + UrlEncode(clientId);
    const chatv2::HttpResponse response = chatv2::postJson(url, body.dump(), token, {}, 5000);
    if (!response.ok()) {
        error = response.error.empty()
            ? "thumbnail_upload_http_" + std::to_string(response.statusCode)
            : response.error;
        return false;
    }
    return true;
}

void LinuxJobRuntime::recordCompleted(std::string commandType)
{
    std::lock_guard<std::mutex> lock(mutex_);
    lastCommandType_ = std::move(commandType);
    lastError_.clear();
    ++commandsCompleted_;
}

void LinuxJobRuntime::recordFailed(std::string commandType, std::string error)
{
    std::lock_guard<std::mutex> lock(mutex_);
    lastCommandType_ = std::move(commandType);
    lastError_ = std::move(error);
    ++commandsFailed_;
}

} // namespace perceptrum::linux_runtime

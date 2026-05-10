// JobPayloadParser.cpp
#include "JobPayloadParser.h"
#include <stdexcept>
#include <sstream>
#include <vector>
#include <algorithm>
#include <cctype>
#include <cmath>

static std::optional<int> optInt(const json& j, const char* k) {
    if (!j.contains(k) || j[k].is_null()) return std::nullopt;
    if (j[k].is_number_integer()) return j[k].get<int>();
    return std::nullopt;
}


static std::string safeString(const json& j, const char* k, const std::string& def = "") {
    if (!j.contains(k) || j[k].is_null()) return def;
    if (j[k].is_string()) return j[k].get<std::string>();
    return def;
}

static std::string safeJsonText(const json& j, const char* k, const std::string& def = "") {
    if (!j.contains(k) || j[k].is_null()) return def;
    if (j[k].is_string()) return j[k].get<std::string>();
    if (j[k].is_object() || j[k].is_array() || j[k].is_boolean() || j[k].is_number()) {
        return j[k].dump();
    }
    return def;
}

static std::string trimCopy_(std::string s) {
    auto is_space = [](unsigned char c) { return std::isspace(c); };
    while (!s.empty() && is_space((unsigned char)s.front())) s.erase(s.begin());
    while (!s.empty() && is_space((unsigned char)s.back())) s.pop_back();
    return s;
}

struct ParsedPromptTemplateFields_ {
    std::string prompt_template;
    std::string alert_condition_text;
    std::string negative_condition_text;
};

static ParsedPromptTemplateFields_ parsePromptTemplateFields_(
    const std::string& rawPromptTemplate,
    const std::string& fallbackAlertCondition,
    const std::string& fallbackNegativeCondition
) {
    ParsedPromptTemplateFields_ out;
    out.prompt_template = rawPromptTemplate;
    out.alert_condition_text = trimCopy_(fallbackAlertCondition);
    out.negative_condition_text = trimCopy_(fallbackNegativeCondition);

    if (rawPromptTemplate.empty()) {
        return out;
    }

    std::string lower = rawPromptTemplate;
    std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) {
        return (char)std::tolower(c);
    });

    const std::string alertMarker = "alert_condition:";
    const std::string negativeMarker = "negative_condition:";

    struct MarkerPos {
        int kind = 0; // 0=alert, 1=negative
        size_t pos = std::string::npos;
        size_t markerLen = 0;
    };

    std::vector<MarkerPos> markers;
    const size_t alertPos = lower.rfind(alertMarker);
    if (alertPos != std::string::npos) {
        markers.push_back(MarkerPos{ 0, alertPos, alertMarker.size() });
    }
    const size_t negativePos = lower.rfind(negativeMarker);
    if (negativePos != std::string::npos) {
        markers.push_back(MarkerPos{ 1, negativePos, negativeMarker.size() });
    }

    if (markers.empty()) {
        return out;
    }

    std::sort(markers.begin(), markers.end(), [](const MarkerPos& a, const MarkerPos& b) {
        return a.pos < b.pos;
    });

    out.prompt_template = rawPromptTemplate.substr(0, markers.front().pos);
    while (!out.prompt_template.empty() &&
        std::isspace((unsigned char)out.prompt_template.back())) {
        out.prompt_template.pop_back();
    }

    std::string parsedAlert;
    std::string parsedNegative;
    for (size_t i = 0; i < markers.size(); ++i) {
        const auto& current = markers[i];
        const size_t start = current.pos + current.markerLen;
        const size_t end = (i + 1 < markers.size()) ? markers[i + 1].pos : rawPromptTemplate.size();
        const std::string value = trimCopy_(rawPromptTemplate.substr(start, end - start));
        if (value.empty()) continue;
        if (current.kind == 0) {
            parsedAlert = value;
        }
        else {
            parsedNegative = value;
        }
    }

    if (out.alert_condition_text.empty()) {
        out.alert_condition_text = parsedAlert;
    }
    if (out.negative_condition_text.empty()) {
        out.negative_condition_text = parsedNegative;
    }

    return out;
}

static std::string normalizeInferenceModelName(std::string v) {
    auto is_space = [](unsigned char c) { return std::isspace(c); };
    while (!v.empty() && is_space((unsigned char)v.front())) v.erase(v.begin());
    while (!v.empty() && is_space((unsigned char)v.back())) v.pop_back();
    for (char& c : v) c = (char)std::tolower((unsigned char)c);
    if (v == "ultra+" || v == "ultra-plus" || v == "ultra_plus") return "ultra_plus";
    if (v == "legacy" || v == "pro" || v == "ultra" || v == "ultra_plus" || v == "light" || v == "core") return v;
    return "legacy";
}

static std::string normalizeInputTypeValue(std::string v) {
    auto is_space = [](unsigned char c) { return std::isspace(c); };
    while (!v.empty() && is_space((unsigned char)v.front())) v.erase(v.begin());
    while (!v.empty() && is_space((unsigned char)v.back())) v.pop_back();
    for (char& c : v) c = (char)std::tolower((unsigned char)c);
    return (v == "image") ? "image" : "video";
}

static std::string normalizeVideoPackagingModeValue(std::string v) {
    auto is_space = [](unsigned char c) { return std::isspace(c); };
    while (!v.empty() && is_space((unsigned char)v.front())) v.erase(v.begin());
    while (!v.empty() && is_space((unsigned char)v.back())) v.pop_back();
    for (char& c : v) c = (char)std::tolower((unsigned char)c);
    if (v == "frame_sequence" || v == "frame-sequence" || v == "full_frame" || v == "full-frame" ||
        v == "frames" || v == "high_resolution" || v == "high-resolution" || v == "high resolution") {
        return "frame_sequence";
    }
    if (v == "mosaic_2x2" || v == "mosaic-2x2" || v == "2x2" ||
        v == "standard_resolution" || v == "standard-resolution" || v == "standard resolution") {
        return "mosaic_2x2";
    }
    // Deprecated: 3x3 mosaics compress temporal/detail evidence too aggressively.
    return "frame_sequence";
}

static int normalizeRunningResolutionValue(int raw, int fallback = 640) {
    if (raw == 1024) return 1024;
    if (raw == 640) return 640;
    return (fallback == 1024) ? 1024 : 640;
}

static int defaultModelFpsForInferenceModel(const std::string& modelName, const std::string& inputType) {
    const std::string normalizedInputType = normalizeInputTypeValue(inputType);
    (void)modelName;
    if (normalizedInputType == "video") {
        return 1;
    }
    return 1;
}

static int normalizeModelFpsValue(
    int raw,
    int fallback,
    const std::string& modelName,
    const std::string& inputType)
{
    const std::string normalizedInputType = normalizeInputTypeValue(inputType);
    (void)modelName;
    if (normalizedInputType != "video") {
        return 1;
    }

    int effective = raw > 0 ? raw : fallback;
    if (effective < 1) effective = 1;
    if (effective > 5) effective = 5;
    return effective;
}

static int readModelFpsField(
    const json& j,
    int fallback,
    const std::string& modelName,
    const std::string& inputType)
{
    if (j.contains("model_fps")) {
        if (j["model_fps"].is_number_integer()) {
            return normalizeModelFpsValue(j["model_fps"].get<int>(), fallback, modelName, inputType);
        }
        if (j["model_fps"].is_string()) {
            try {
                return normalizeModelFpsValue(
                    std::stoi(j["model_fps"].get<std::string>()),
                    fallback,
                    modelName,
                    inputType
                );
            } catch (...) {}
        }
    }
    if (j.contains("modelFps")) {
        if (j["modelFps"].is_number_integer()) {
            return normalizeModelFpsValue(j["modelFps"].get<int>(), fallback, modelName, inputType);
        }
        if (j["modelFps"].is_string()) {
            try {
                return normalizeModelFpsValue(
                    std::stoi(j["modelFps"].get<std::string>()),
                    fallback,
                    modelName,
                    inputType
                );
            } catch (...) {}
        }
    }
    return normalizeModelFpsValue(fallback, fallback, modelName, inputType);
}

static int normalizeRunEverySecondsValue(int raw, int fallback) {
    const int normalizedFallback = (fallback <= 10) ? 10 : 60;
    if (raw <= 0) return normalizedFallback;
    return (raw <= 10) ? 10 : 60;
}

static int readRunEverySecondsField(const json& j, int fallback) {
    if (j.contains("run_every")) {
        if (j["run_every"].is_number_integer()) {
            return normalizeRunEverySecondsValue(j["run_every"].get<int>(), fallback);
        }
        if (j["run_every"].is_string()) {
            try {
                return normalizeRunEverySecondsValue(std::stoi(j["run_every"].get<std::string>()), fallback);
            } catch (...) {}
        }
    }
    if (j.contains("runEvery")) {
        if (j["runEvery"].is_number_integer()) {
            return normalizeRunEverySecondsValue(j["runEvery"].get<int>(), fallback);
        }
        if (j["runEvery"].is_string()) {
            try {
                return normalizeRunEverySecondsValue(std::stoi(j["runEvery"].get<std::string>()), fallback);
            } catch (...) {}
        }
    }
    if (j.contains("run_every_seconds")) {
        if (j["run_every_seconds"].is_number_integer()) {
            return normalizeRunEverySecondsValue(j["run_every_seconds"].get<int>(), fallback);
        }
        if (j["run_every_seconds"].is_string()) {
            try {
                return normalizeRunEverySecondsValue(std::stoi(j["run_every_seconds"].get<std::string>()), fallback);
            } catch (...) {}
        }
    }
    return fallback;
}

static int readRunningResolutionField(const json& j, int fallback) {
    if (j.contains("running_resolution")) {
        if (j["running_resolution"].is_number_integer()) {
            return normalizeRunningResolutionValue(j["running_resolution"].get<int>(), fallback);
        }
        if (j["running_resolution"].is_string()) {
            try {
                return normalizeRunningResolutionValue(std::stoi(j["running_resolution"].get<std::string>()), fallback);
            } catch (...) {}
        }
    }
    if (j.contains("runningResolution")) {
        if (j["runningResolution"].is_number_integer()) {
            return normalizeRunningResolutionValue(j["runningResolution"].get<int>(), fallback);
        }
        if (j["runningResolution"].is_string()) {
            try {
                return normalizeRunningResolutionValue(std::stoi(j["runningResolution"].get<std::string>()), fallback);
            } catch (...) {}
        }
    }
    return normalizeRunningResolutionValue(fallback, 640);
}

static bool parseBoolLikeValue(const json& v, bool fallback) {
    if (v.is_boolean()) return v.get<bool>();
    if (v.is_number_integer()) return v.get<int>() != 0;
    if (v.is_string()) {
        std::string s = v.get<std::string>();
        std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return (char)std::tolower(c); });
        if (s == "1" || s == "true" || s == "yes" || s == "on") return true;
        if (s == "0" || s == "false" || s == "no" || s == "off") return false;
    }
    return fallback;
}

static bool readBoolLikeField(const json& j, const std::vector<const char*>& keys, bool fallback) {
    for (const char* k : keys) {
        if (!j.contains(k) || j[k].is_null()) continue;
        return parseBoolLikeValue(j[k], fallback);
    }
    return fallback;
}

static std::vector<JobFaceTarget> parseFaceTargetsFromNode(
    const json& holder,
    const char* key
) {
    std::vector<JobFaceTarget> out;
    if (!holder.contains(key) || !holder[key].is_array()) {
        return out;
    }

    for (const auto& item : holder[key]) {
        if (!item.is_object()) continue;

        JobFaceTarget target;
        target.id = item.value("id", -1);
        target.name = safeString(item, "name", "");
        target.description = safeString(item, "description", "");
        if (target.id <= 0) continue;

        if (item.contains("images") && item["images"].is_array()) {
            for (const auto& imageNode : item["images"]) {
                if (!imageNode.is_object()) continue;
                JobFaceTargetImage image;
                image.id = imageNode.value("id", -1);
                image.image_url = safeString(imageNode, "image_url", "");
                if (image.id <= 0 || image.image_url.empty()) continue;
                target.images.push_back(std::move(image));
            }
        }

        out.push_back(std::move(target));
    }

    return out;
}

static std::vector<JobNegativeReferenceImage> parseNegativeReferenceImagesFromNode(
    const json& holder,
    const char* key
) {
    std::vector<JobNegativeReferenceImage> out;
    if (!holder.contains(key) || !holder[key].is_array()) {
        return out;
    }

    for (const auto& item : holder[key]) {
        if (!item.is_object()) continue;
        JobNegativeReferenceImage image;
        image.id = item.value("id", -1);
        image.image_url = safeString(item, "image_url", "");
        if (image.id <= 0 || image.image_url.empty()) continue;
        out.push_back(std::move(image));
    }

    return out;
}

static double clamp01_(double v) {
    if (!std::isfinite(v)) return 0.0;
    if (v < 0.0) return 0.0;
    if (v > 1.0) return 1.0;
    return v;
}

static int readPositiveIntField_(const json& j, const std::vector<const char*>& keys, int fallback) {
    for (const char* key : keys) {
        if (!j.contains(key) || j[key].is_null()) continue;
        if (j[key].is_number_integer()) {
            const int value = j[key].get<int>();
            if (value > 0) return value;
        }
        if (j[key].is_string()) {
            try {
                const int value = std::stoi(j[key].get<std::string>());
                if (value > 0) return value;
            }
            catch (...) {}
        }
    }
    return fallback;
}

static double readContextPaddingPctField_(const json& j, double fallback) {
    const std::vector<const char*> keys = { "context_padding_pct", "contextPaddingPct" };
    for (const char* key : keys) {
        if (!j.contains(key) || j[key].is_null()) continue;
        double value = fallback;
        if (j[key].is_number()) {
            value = j[key].get<double>();
        }
        else if (j[key].is_string()) {
            try { value = std::stod(j[key].get<std::string>()); } catch (...) { continue; }
        }
        if (!std::isfinite(value)) continue;
        if (value < 0.0) value = 0.0;
        if (value > 0.4) value = 0.4;
        return value;
    }
    return fallback;
}

static std::vector<int> parseIntegerArrayField_(const json& holder, const std::vector<const char*>& keys) {
    std::vector<int> out;
    for (const char* key : keys) {
        if (!holder.contains(key) || !holder[key].is_array()) continue;
        for (const auto& value : holder[key]) {
            if (!value.is_number_integer()) continue;
            const int id = value.get<int>();
            if (id <= 0) continue;
            if (std::find(out.begin(), out.end(), id) != out.end()) continue;
            out.push_back(id);
        }
        break;
    }
    return out;
}

static std::vector<JobPolygonPoint> parsePolygonNormFromNode_(const json& holder) {
    const json* arr = nullptr;
    if (holder.contains("polygon_norm") && holder["polygon_norm"].is_array()) {
        arr = &holder["polygon_norm"];
    }
    else if (holder.contains("polygonNorm") && holder["polygonNorm"].is_array()) {
        arr = &holder["polygonNorm"];
    }
    if (!arr) return {};

    std::vector<JobPolygonPoint> out;
    out.reserve(arr->size());
    for (const auto& pointNode : *arr) {
        if (!pointNode.is_object()) continue;
        if (!pointNode.contains("x") || !pointNode.contains("y")) continue;
        if (!pointNode["x"].is_number() || !pointNode["y"].is_number()) continue;
        JobPolygonPoint p;
        p.x = clamp01_(pointNode["x"].get<double>());
        p.y = clamp01_(pointNode["y"].get<double>());
        out.push_back(p);
    }
    return out;
}

static JobFrameWindowNorm parseFrameWindowNormFromNode_(const json& holder) {
    JobFrameWindowNorm out;
    const json* node = nullptr;
    if (holder.contains("frame_window_norm") && holder["frame_window_norm"].is_object()) {
        node = &holder["frame_window_norm"];
    }
    else if (holder.contains("frameWindowNorm") && holder["frameWindowNorm"].is_object()) {
        node = &holder["frameWindowNorm"];
    }
    if (!node) return out;

    const auto readCoord = [&](const char* key, double fallback) {
        if (!node->contains(key) || !(*node)[key].is_number()) return fallback;
        return clamp01_((*node)[key].get<double>());
    };

    const double width = readCoord("width", 1.0);
    const double height = readCoord("height", 1.0);
    if (width <= 0.0 || height <= 0.0) return out;

    const double maxX = (std::max)(0.0, 1.0 - width);
    const double maxY = (std::max)(0.0, 1.0 - height);
    out.x = (std::min)(maxX, (std::max)(0.0, readCoord("x", 0.0)));
    out.y = (std::min)(maxY, (std::max)(0.0, readCoord("y", 0.0)));
    out.width = width;
    out.height = height;
    out.enabled =
        out.x > 1e-6 ||
        out.y > 1e-6 ||
        out.width < (1.0 - 1e-6) ||
        out.height < (1.0 - 1e-6);
    return out;
}

static std::vector<JobAnalysisRegion> parseAnalysisRegionsFromNode_(
    const json& holder,
    const ParsedPromptTemplateFields_& defaults,
    const std::vector<JobFaceTarget>& fallbackFaceTargets,
    const std::vector<JobNegativeReferenceImage>& fallbackNegativeImages
) {
    std::vector<JobAnalysisRegion> out;
    if (!holder.contains("analysis_regions") || !holder["analysis_regions"].is_array()) {
        return out;
    }

    const std::vector<int> defaultFaceTargetIds = [&]() {
        std::vector<int> ids;
        for (const auto& faceTarget : fallbackFaceTargets) {
            if (faceTarget.id <= 0) continue;
            if (std::find(ids.begin(), ids.end(), faceTarget.id) != ids.end()) continue;
            ids.push_back(faceTarget.id);
        }
        return ids;
    }();

    const std::vector<int> defaultNegativeImageIds = [&]() {
        std::vector<int> ids;
        for (const auto& image : fallbackNegativeImages) {
            if (image.id <= 0) continue;
            if (std::find(ids.begin(), ids.end(), image.id) != ids.end()) continue;
            ids.push_back(image.id);
        }
        return ids;
    }();

    for (const auto& item : holder["analysis_regions"]) {
        if (!item.is_object()) continue;

        JobAnalysisRegion region;
        region.region_id = safeString(item, "region_id", safeString(item, "regionId", ""));
        region.label = safeString(item, "label", "");
        region.enabled = readBoolLikeField(item, { "enabled" }, true);
        region.full_frame = readBoolLikeField(item, { "full_frame", "fullFrame" }, false);
        region.frame_window_norm = parseFrameWindowNormFromNode_(item);
        region.polygon_norm = parsePolygonNormFromNode_(item);
        if (!region.full_frame && (region.polygon_norm.size() < 3 || region.polygon_norm.size() > 20)) {
            continue;
        }
        if (region.full_frame || region.polygon_norm.size() < 3) {
            region.full_frame = true;
            region.polygon_norm.clear();
        }
        region.draw_ref_width = readPositiveIntField_(
            item,
            { "draw_ref_width", "drawRefWidth" },
            1920
        );
        region.draw_ref_height = readPositiveIntField_(
            item,
            { "draw_ref_height", "drawRefHeight" },
            1080
        );
        region.context_padding_pct = readContextPaddingPctField_(
            item,
            0.0
        );
        region.prompt_core = safeString(
            item,
            "prompt_core",
            safeString(item, "prompt_template", defaults.prompt_template)
        );
        region.alert_condition_text = safeString(
            item,
            "alert_condition",
            safeString(item, "alertCondition", defaults.alert_condition_text)
        );
        region.negative_condition_text = safeString(
            item,
            "negative_condition",
            safeString(item, "negativeCondition", defaults.negative_condition_text)
        );
        region.face_target_ids = parseIntegerArrayField_(item, { "face_target_ids", "faceTargetIds" });
        if (region.face_target_ids.empty()) {
            region.face_target_ids = defaultFaceTargetIds;
        }
        region.negative_image_ids = parseIntegerArrayField_(item, { "negative_image_ids", "negativeImageIds" });
        if (region.negative_image_ids.empty()) {
            region.negative_image_ids = defaultNegativeImageIds;
        }

        if (region.region_id.empty()) {
            region.region_id = "region-" + std::to_string(out.size() + 1);
        }
        if (region.label.empty()) {
            region.label = "Region " + std::to_string(out.size() + 1);
        }

        bool duplicated = false;
        for (const auto& existing : out) {
            if (existing.region_id == region.region_id) {
                duplicated = true;
                break;
            }
        }
        if (duplicated) continue;

        out.push_back(std::move(region));
        if (out.size() >= 6) break;
    }

    return out;
}

static std::vector<JobInferenceGroup::AnalysisBinding> parseGroupAnalysisBindingsFromNode_(
    const json& holder
) {
    std::vector<JobInferenceGroup::AnalysisBinding> out;
    const json* arr = nullptr;
    if (holder.contains("analysis_bindings") && holder["analysis_bindings"].is_array()) {
        arr = &holder["analysis_bindings"];
    }
    else if (holder.contains("analysisBindings") && holder["analysisBindings"].is_array()) {
        arr = &holder["analysisBindings"];
    }
    if (!arr) return out;

    for (const auto& item : *arr) {
        if (!item.is_object()) continue;
        JobInferenceGroup::AnalysisBinding binding;
        binding.target_id = item.value("target_id", item.value("targetId", -1));
        if (binding.target_id <= 0) continue;

        const json* idsArr = nullptr;
        if (item.contains("region_ids") && item["region_ids"].is_array()) {
            idsArr = &item["region_ids"];
        }
        else if (item.contains("regionIds") && item["regionIds"].is_array()) {
            idsArr = &item["regionIds"];
        }
        if (!idsArr) continue;

        for (const auto& idNode : *idsArr) {
            if (!idNode.is_string()) continue;
            std::string id = trimCopy_(idNode.get<std::string>());
            if (id.empty()) continue;
            if (std::find(binding.region_ids.begin(), binding.region_ids.end(), id) != binding.region_ids.end()) continue;
            binding.region_ids.push_back(std::move(id));
        }
        if (binding.region_ids.empty()) continue;
        out.push_back(std::move(binding));
    }

    return out;
}


JobStartPayload JobPayloadParser::parseJobStartPayloadOrThrow(const json& cmd) {
    if (!cmd.contains("payload") || !cmd["payload"].is_object()) {
        throw std::runtime_error("job_start cmd missing payload object");
    }
    const json& p = cmd["payload"];

    JobStartPayload out;
    out.version = p.value("version", 1);
    out.job_run_id = safeString(p, "job_run_id");

    if (!p.contains("job") || !p["job"].is_object()) {
        throw std::runtime_error("job_start payload missing job object");
    }
    {
        const json& j = p["job"];
        out.job.id = j.value("id", -1);
        out.job.user_id = safeString(j, "user_id");
        out.job.name = safeString(j, "name");
        //out.job.description = j.value("description", "");
        out.job.description = safeString(j, "description");
        out.job.timezone = safeString(j, "timezone", "UTC");
        out.job.schedule_mode = safeString(j, "schedule_mode");
        //out.job.active_from = j.value("active_from", "");
        out.job.active_from = safeString(j, "active_from");
        //out.job.active_until = j.value("active_until", "");
        out.job.active_until = safeString(j, "active_until");
        //out.job.status = j.value("status", "");
        out.job.status = safeString(j, "status");
        if (out.job.id < 0) throw std::runtime_error("job_start payload job.id invalid");
    }

    if (p.contains("trigger") && p["trigger"].is_object()) {
        out.trigger.raw = p["trigger"];
        out.trigger.trigger_type = safeString(p["trigger"], "trigger_type");
        out.trigger.timezone = safeString(p["trigger"], "timezone", out.job.timezone);
        out.trigger.local_date = safeString(p["trigger"], "local_date");
        out.trigger.local_time = safeString(p["trigger"], "local_time");
        out.trigger.triggered_at_utc = safeString(p["trigger"], "triggered_at_utc");
    }

    out.execution_target_end_utc = safeString(
        p,
        "execution_target_end_utc",
        safeString(p, "executionTargetEndUtc", "")
    );

    if (p.contains("all_camera_ids") && p["all_camera_ids"].is_array()) {
        for (auto& c : p["all_camera_ids"]) {
            if (c.is_number_integer()) out.all_camera_ids.push_back(c.get<int>());
        }
    }

    // start_camera_payloads / camera_start_payloads (or legacy alias)
    {
        const char* keys[] = { "start_camera_payloads", "camera_start_payloads", "camera_payloads" };
        for (const char* k : keys) {
            if (!p.contains(k) || !p[k].is_object()) continue;
            for (auto it = p[k].begin(); it != p[k].end(); ++it) {
                try {
                    int camId = std::stoi(it.key());
                    if (camId > 0 && it.value().is_object()) {
                        out.camera_start_payload_by_id[camId] = it.value();
                    }
                }
                catch (...) {
                    // ignore bad keys
                }
            }
            if (!out.camera_start_payload_by_id.empty()) break;
        }
    }

    if (!p.contains("steps") || !p["steps"].is_array()) {
        throw std::runtime_error("job_start payload missing steps[]");
    }

    for (auto& s : p["steps"]) {
        JobStepDef step;

        // step object
        if (s.contains("step") && s["step"].is_object()) {
            const json& st = s["step"];
            step.id = st.value("id", -1);
            step.step_run_id = safeString(s, "step_run_id", safeString(st, "step_run_id", ""));
            step.step_order = st.value("step_order", 0);
            step.name = safeString(st, "name");
            step.timeout_seconds = st.value("timeout_seconds", 0);
            step.analysis_completion_mode = safeString(
                st,
                "analysis_completion_mode",
                safeString(st, "analysisCompletionMode", "")
            );
            step.analysis_target_end_utc = safeString(
                st,
                "analysis_target_end_utc",
                safeString(st, "analysisTargetEndUtc", "")
            );
            step.analysis_hard_stop_seconds =
                optInt(st, "analysis_hard_stop_seconds").value_or(
                    optInt(st, "analysisHardStopSeconds").value_or(0));
            step.input_from_step_id = optInt(st, "input_from_step_id");
            step.input_inject_key = safeString(st, "input_inject_key", "");
            step.on_missing_input = safeString(st, "on_missing_input", "skip");

            // New structured start_condition
            if (st.contains("start_condition") && st["start_condition"].is_object()) {
                const json& sc = st["start_condition"];
                JobStepDef::StartCondition c;
                c.mode = safeString(sc, "mode", "");
                c.from_step_id = optInt(sc, "from_step_id");

                // Mocha fields (non-breaking aliases)
                // - extract: free-form text (custom) OR json key (positive/negative)
                // - pattern: camera_name selector (target_key)
                // - time_offset_sec: seconds offset from job start
                // - time_hhmm: absolute local time HH:MM (optional)
                // NOTE: sc["extract"] / sc["pattern"] can be null in Mocha payload; never use .value<string>() directly.

                const std::string extract = safeString(sc, "extract", "");
                c.extract_text = extract;

                {
                    std::string ak = safeString(sc, "answer_key", "");
                    // For positive/negative modes, allow `extract` to override the answer key (e.g. "result").
                    if (ak.empty() && (c.mode == "positive" || c.mode == "negative")) ak = extract;
                    if (ak.empty()) ak = "Sentimento_Resposta";
                    c.answer_key = ak;
                }

                c.time_hhmm = safeString(sc, "time_hhmm", "");

                c.camera_id = optInt(sc, "camera_id");

                {
                    std::string tk = safeString(sc, "target_key", "");
                    if (tk.empty()) tk = safeString(sc, "pattern", "");
                    c.target_key = tk;
                }

                c.time_offset_seconds = optInt(sc, "time_offset_seconds").value_or(
                    optInt(sc, "time_offset_sec").value_or(0));

                c.raw = safeString(sc, "raw", "");
                step.start_condition = c;
            }

            // New structured pipeline
            if (st.contains("pipeline") && st["pipeline"].is_object()) {
                const json& pl = st["pipeline"];
                JobStepDef::PipelineRef pr;
                // Mocha pipeline fields use: input_from_step_id / input_inject_key
                pr.from_step_id = optInt(pl, "from_step_id");
                if (!pr.from_step_id.has_value()) pr.from_step_id = optInt(pl, "input_from_step_id");

                pr.inject_key = safeString(pl, "inject_key", "");
                if (pr.inject_key.empty()) pr.inject_key = safeString(pl, "input_inject_key", "");

                // Optional: pipeline.camera_id can be an explicit selector; encode as numeric string
                if (pr.inject_key.empty()) {
                    auto cam = optInt(pl, "camera_id");
                    if (cam.has_value()) pr.inject_key = std::to_string(*cam);
                }
                step.pipeline = pr;

                // Backward-compat mirror if legacy fields are empty
                if (!step.input_from_step_id.has_value() && pr.from_step_id.has_value()) {
                    step.input_from_step_id = pr.from_step_id;
                }
                if (step.input_inject_key.empty() && !pr.inject_key.empty()) {
                    step.input_inject_key = pr.inject_key;
                }
            }

            // New multi-pipeline definitions (preferred)
            // Mocha can emit either:
            //  - step.step.pipelines: [ { input_from_step_id, inputs:[{camera_id,input_inject_key}], target_camera_id, target_camera_name } ]
            //  - step.step.pipelines: [ { input_from_step_id, input_inject_keys:["mibo"], target_camera_id, target_camera_name } ]
            // We parse both forms. Resolution from camera_name -> camera_id is done at runtime.
            if (st.contains("pipelines") && st["pipelines"].is_array()) {
                for (auto& pls : st["pipelines"]) {
                    if (!pls.is_object()) continue;
                    JobStepDef::PipelineSpec ps;

                    ps.input_from_step_id = optInt(pls, "input_from_step_id").value_or(
                        optInt(pls, "from_step_id").value_or(-1));

                    ps.target_camera_id = optInt(pls, "target_camera_id").value_or(
                        optInt(pls, "camera_id").value_or(-1));

                    ps.target_camera_name = safeString(pls, "target_camera_name", "");

                    // inputs[] form
                    if (pls.contains("inputs") && pls["inputs"].is_array()) {
                        for (auto& inp : pls["inputs"]) {
                            if (!inp.is_object()) continue;
                            JobStepDef::PipelineInput pi;
                            pi.camera_id = optInt(inp, "camera_id");
                            pi.input_inject_key = safeString(inp, "input_inject_key", "");
                            if (pi.input_inject_key.empty()) pi.input_inject_key = safeString(inp, "inject_key", "");
                            if (pi.camera_id.has_value() || !pi.input_inject_key.empty()) {
                                ps.inputs.push_back(std::move(pi));
                            }
                        }
                    }
                    // input_inject_keys[] shortcut (list of camera names / keys)
                    if (ps.inputs.empty() && pls.contains("input_inject_keys") && pls["input_inject_keys"].is_array()) {
                        for (auto& k : pls["input_inject_keys"]) {
                            if (!k.is_string()) continue;
                            JobStepDef::PipelineInput pi;
                            pi.input_inject_key = k.get<std::string>();
                            ps.inputs.push_back(std::move(pi));
                        }
                    }
                    // single input_inject_key shortcut
                    if (ps.inputs.empty()) {
                        const std::string k = safeString(pls, "input_inject_key", "");
                        if (!k.empty()) {
                            JobStepDef::PipelineInput pi;
                            pi.input_inject_key = k;
                            ps.inputs.push_back(std::move(pi));
                        }
                    }

                    if (ps.input_from_step_id > 0 && ps.target_camera_id > 0 && !ps.inputs.empty()) {
                        step.pipelines.push_back(std::move(ps));
                    }
                }
            }

            // ------------------------------------------------------------
            // New: inference_groups[] (optional)
            // ------------------------------------------------------------
            // Mocha emits step.step.inference_groups: [
            //   { id, name, agentKey, prompt_template, alert_condition, negative_condition, inputType, targetIds:[...] }
            // ]
            if (st.contains("inference_groups") && st["inference_groups"].is_array()) {
                for (auto& ig : st["inference_groups"]) {
                    if (!ig.is_object()) continue;
                    JobInferenceGroup g;
                    g.id = safeString(ig, "id", "");
                    g.name = safeString(ig, "name", "");

                    // Note: payload uses camelCase agentKey / inputType.
                    g.agent_key = safeString(ig, "agentKey", "");
                    if (g.agent_key.empty()) g.agent_key = safeString(ig, "agent_key", "");

                    g.prompt_template = safeString(ig, "prompt_template", "");
                    g.alert_condition_text = safeString(ig, "alert_condition", "");
                    g.negative_condition_text = safeString(ig, "negative_condition", "");
                    g.input_type = normalizeInputTypeValue(
                        safeString(ig, "inputType", safeString(ig, "input_type", "video"))
                    );
                    g.video_packaging_mode = normalizeVideoPackagingModeValue(
                        safeString(
                            ig,
                            "video_packaging_mode",
                            safeString(ig, "videoPackagingMode", "high_resolution")
                        )
                    );

                    const auto parsedPrompt = parsePromptTemplateFields_(
                        g.prompt_template,
                        g.alert_condition_text,
                        g.negative_condition_text
                    );
                    g.prompt_template = parsedPrompt.prompt_template;
                    g.alert_condition_text = parsedPrompt.alert_condition_text;
                    g.negative_condition_text = parsedPrompt.negative_condition_text;

                    g.inference_model = normalizeInferenceModelName(
                        safeString(ig, "inference_model", safeString(ig, "inferenceModel", "legacy"))
                    );
                    g.api_key = safeString(ig, "api_key", safeString(ig, "apiKey", ""));
                    g.model_fps = readModelFpsField(
                        ig,
                        defaultModelFpsForInferenceModel(g.inference_model, g.input_type),
                        g.inference_model,
                        g.input_type
                    );
                    g.run_every_seconds = readRunEverySecondsField(ig, 10);
                    g.running_resolution = readRunningResolutionField(ig, 640);
                    g.only_capture_on_motion = readBoolLikeField(
                        ig,
                        { "only_capture_on_motion", "onlyCaptureOnMotion", "capture_on_motion_only" },
                        true
                    );
                    if (g.inference_model == "core") {
                        g.input_type = "video";
                        g.run_every_seconds = 60;
                        g.running_resolution = normalizeRunningResolutionValue(g.running_resolution, 640);
                        g.model_fps = 1;
                    } else {
                        g.running_resolution = 0;
                        g.model_fps = normalizeModelFpsValue(
                            g.model_fps,
                            defaultModelFpsForInferenceModel(g.inference_model, g.input_type),
                            g.inference_model,
                            g.input_type
                        );
                    }
                    g.face_targets = parseFaceTargetsFromNode(ig, "face_targets");
                    g.negative_reference_images = parseNegativeReferenceImagesFromNode(
                        ig,
                        "negative_reference_images"
                    );
                    g.analysis_bindings = parseGroupAnalysisBindingsFromNode_(ig);
                    g.analysis_regions = parseAnalysisRegionsFromNode_(
                        ig,
                        parsedPrompt,
                        g.face_targets,
                        g.negative_reference_images
                    );
                    g.temporal_plan_hash = safeString(ig, "temporal_plan_hash", "");
                    g.temporal_plan_version = safeString(ig, "temporal_plan_version", "");
                    g.temporal_compiled_at = safeString(ig, "temporal_compiled_at", "");
                    g.temporal_compile_model = safeString(ig, "temporal_compile_model", "");
                    g.temporal_plan_envelope = json::object();
                    if (ig.contains("temporal_plan_json")) {
                        if (ig["temporal_plan_json"].is_object()) {
                            g.temporal_plan_envelope = ig["temporal_plan_json"];
                        }
                        else if (ig["temporal_plan_json"].is_string()) {
                            try {
                                json parsedTemporal = json::parse(
                                    ig["temporal_plan_json"].get<std::string>(),
                                    nullptr,
                                    false
                                );
                                if (parsedTemporal.is_object()) {
                                    g.temporal_plan_envelope = std::move(parsedTemporal);
                                }
                            }
                            catch (...) {}
                        }
                    }


                    // priority_level (accept camelCase too)
                    g.priority_level = safeString(ig, "priority_level", "");
                    if (g.priority_level.empty()) g.priority_level = safeString(ig, "priorityLevel", "");

                    // normalize + fallback
                    auto normPriority = [](std::string s) -> std::string {
                        // trim
                        auto is_space = [](unsigned char c) { return std::isspace(c); };
                        while (!s.empty() && is_space((unsigned char)s.front())) s.erase(s.begin());
                        while (!s.empty() && is_space((unsigned char)s.back())) s.pop_back();

                        // upper
                        for (char& c : s) c = (char)std::toupper((unsigned char)c);

                        // fix common typo
                        if (s == "MEDUIM") s = "MEDIUM";

                        // allow only known values
                        if (s == "CRITIC" || s == "HIGH" || s == "MEDIUM" || s == "LOW") return s;

                        return ""; // invalid
                        };

                    g.priority_level = normPriority(g.priority_level);
                    if (g.priority_level.empty()) g.priority_level = "MEDIUM";



                    if (ig.contains("targetIds") && ig["targetIds"].is_array()) {
                        for (auto& tid : ig["targetIds"]) {
                            if (tid.is_number_integer()) g.target_ids.push_back(tid.get<int>());
                        }
                    }
                    // Accept snake_case alias too (optional)
                    if (g.target_ids.empty() && ig.contains("target_ids") && ig["target_ids"].is_array()) {
                        for (auto& tid : ig["target_ids"]) {
                            if (tid.is_number_integer()) g.target_ids.push_back(tid.get<int>());
                        }
                    }

                    // Only keep groups that target at least 1 camera.
                    if (!g.target_ids.empty()) {
                        step.inference_groups.push_back(std::move(g));
                    }
                }
            }

        }
        else {
            throw std::runtime_error("steps[] item missing step object");
        }

        


        // targets
        if (s.contains("targets") && s["targets"].is_array()) {
            for (auto& t : s["targets"]) {
                JobTarget tgt;
                tgt.id = t.value("id", -1);
                tgt.camera_id = t.value("camera_id", -1);
                tgt.camera_name = safeString(t, "camera_name");
                if (tgt.camera_id >= 0) step.targets.push_back(std::move(tgt));
            }
        }

        // agents[]
        if (s.contains("agents") && s["agents"].is_array()) {
            for (auto& a : s["agents"]) {
                JobAgentDef ag;
                ag.id = a.value("id", -1);
                ag.agent_run_id = safeString(a, "agent_run_id");
                ag.agent_key = safeString(a, "agent_key");
                ag.prompt_template = safeString(a, "prompt_template");
                ag.priority_level = safeString(a, "priority_level", "");
                ag.params_json = safeJsonText(a, "params", "{}");
                ag.input_schema_json = safeJsonText(a, "input_schema", "{}");
                try {
                    json params = json::parse(ag.params_json, nullptr, false);
                    if (params.is_object()) {
                        const std::string executionBackend = trimCopy_(
                            safeString(params, "execution_backend", "llm"));
                        ag.execution_backend =
                            (executionBackend == "opencv_portal_counter")
                                ? "opencv_portal_counter"
                                : "llm";

                        const json portalCounterNode =
                            params.contains("portal_counter") && params["portal_counter"].is_object()
                                ? params["portal_counter"]
                                : json::object();
                        if (portalCounterNode.is_object()) {
                            auto readIntClamped = [&](const char* key,
                                                      int fallback,
                                                      int minValue,
                                                      int maxValue) -> int {
                                if (!portalCounterNode.contains(key) ||
                                    portalCounterNode[key].is_null()) {
                                    return fallback;
                                }
                                int value = fallback;
                                try {
                                    if (portalCounterNode[key].is_number_integer()) {
                                        value = portalCounterNode[key].get<int>();
                                    }
                                    else if (portalCounterNode[key].is_number_float()) {
                                        value = static_cast<int>(
                                            std::lround(portalCounterNode[key].get<double>()));
                                    }
                                    else if (portalCounterNode[key].is_string()) {
                                        value = std::stoi(portalCounterNode[key].get<std::string>());
                                    }
                                }
                                catch (...) {
                                    value = fallback;
                                }
                                return (std::clamp)(value, minValue, maxValue);
                            };

                            ag.portal_counter_config.region_id =
                                trimCopy_(safeString(portalCounterNode, "region_id", ""));
                            ag.portal_counter_config.min_count_to_alert = readIntClamped(
                                "min_count_to_alert",
                                1,
                                0,
                                9999);
                            ag.portal_counter_config.min_area = readIntClamped(
                                "min_area",
                                1800,
                                1,
                                500000);
                            ag.portal_counter_config.max_area = readIntClamped(
                                "max_area",
                                70000,
                                1,
                                1000000);
                            ag.portal_counter_config.warmup_frames = readIntClamped(
                                "warmup_frames",
                                60,
                                0,
                                10000);
                            ag.portal_counter_config.min_track_frames_for_count = readIntClamped(
                                "min_track_frames_for_count",
                                3,
                                1,
                                300);
                            ag.portal_counter_config.max_missed_frames = readIntClamped(
                                "max_missed_frames",
                                12,
                                1,
                                300);
                            ag.portal_counter_config.min_path_length_px = readIntClamped(
                                "min_path_length_px",
                                85,
                                1,
                                5000);
                            ag.portal_counter_config.max_proof_frames = readIntClamped(
                                "max_proof_frames",
                                6,
                                1,
                                24);
                            ag.portal_counter_config.save_annotated_video =
                                !portalCounterNode.contains("save_annotated_video") ||
                                !portalCounterNode["save_annotated_video"].is_boolean()
                                    ? true
                                    : portalCounterNode["save_annotated_video"].get<bool>();
                        }
                    }
                }
                catch (...) {}
                ag.input_type = normalizeInputTypeValue(
                    safeString(a, "input_type", safeString(a, "inputType", "video"))
                );
                ag.video_packaging_mode = normalizeVideoPackagingModeValue(
                    safeString(
                        a,
                        "video_packaging_mode",
                        safeString(a, "videoPackagingMode", "high_resolution")
                    )
                );
                ag.inference_model = normalizeInferenceModelName(
                    safeString(a, "inference_model", safeString(a, "inferenceModel", "legacy"))
                );
                ag.api_key = safeString(a, "api_key", safeString(a, "apiKey", ""));
                ag.model_fps = readModelFpsField(
                    a,
                    defaultModelFpsForInferenceModel(ag.inference_model, ag.input_type),
                    ag.inference_model,
                    ag.input_type
                );
                ag.run_every_seconds = readRunEverySecondsField(a, 10);
                ag.running_resolution = readRunningResolutionField(a, 640);
                ag.only_capture_on_motion = readBoolLikeField(
                    a,
                    { "only_capture_on_motion", "onlyCaptureOnMotion", "capture_on_motion_only" },
                    true
                );

                // Optional explicit alert_condition field (preferred)
                ag.alert_condition_text = safeString(a, "alert_condition", "");
                // Optional explicit negative_condition field (preferred)
                ag.negative_condition_text = safeString(a, "negative_condition", "");

                if (ag.inference_model == "core") {
                    ag.input_type = "video";
                    ag.run_every_seconds = 60;
                    ag.running_resolution = normalizeRunningResolutionValue(ag.running_resolution, 640);
                    ag.model_fps = 1;
                }
                else {
                    ag.running_resolution = 0;
                    ag.model_fps = normalizeModelFpsValue(
                        ag.model_fps,
                        defaultModelFpsForInferenceModel(ag.inference_model, ag.input_type),
                        ag.inference_model,
                        ag.input_type
                    );
                }
                ag.face_targets = parseFaceTargetsFromNode(a, "face_targets");
                ag.negative_reference_images = parseNegativeReferenceImagesFromNode(
                    a,
                    "negative_reference_images"
                );

                // Back-compat: allow embedding alert_condition / negative_condition inside prompt_template.
                // Normalize into dedicated fields and keep prompt_template as core prompt text only.
                {
                    const auto parsedPrompt = parsePromptTemplateFields_(
                        ag.prompt_template,
                        ag.alert_condition_text,
                        ag.negative_condition_text
                    );
                    ag.prompt_template = parsedPrompt.prompt_template;
                    ag.alert_condition_text = parsedPrompt.alert_condition_text;
                    ag.negative_condition_text = parsedPrompt.negative_condition_text;
                    ag.analysis_regions = parseAnalysisRegionsFromNode_(
                        a,
                        parsedPrompt,
                        ag.face_targets,
                        ag.negative_reference_images
                    );
                }
                ag.temporal_plan_hash = safeString(a, "temporal_plan_hash", "");
                ag.temporal_plan_version = safeString(a, "temporal_plan_version", "");
                ag.temporal_compiled_at = safeString(a, "temporal_compiled_at", "");
                ag.temporal_compile_model = safeString(a, "temporal_compile_model", "");
                ag.temporal_plan_envelope = json::object();
                if (a.contains("temporal_plan_json")) {
                    if (a["temporal_plan_json"].is_object()) {
                        ag.temporal_plan_envelope = a["temporal_plan_json"];
                    }
                    else if (a["temporal_plan_json"].is_string()) {
                        try {
                            json parsedTemporal = json::parse(
                                a["temporal_plan_json"].get<std::string>(),
                                nullptr,
                                false
                            );
                            if (parsedTemporal.is_object()) {
                                ag.temporal_plan_envelope = std::move(parsedTemporal);
                            }
                        }
                        catch (...) {}
                    }
                }

                if (a.contains("camera_id") && !a["camera_id"].is_null() && a["camera_id"].is_number_integer()) {
                    ag.camera_id = a["camera_id"].get<int>();
                }
                step.agents.push_back(std::move(ag));
            }
        }

        // alerts[]
        if (s.contains("alerts") && s["alerts"].is_array()) {
            for (auto& ar : s["alerts"]) {
                JobAlertRule r;
                r.id = ar.value("id", -1);
                r.condition_expr = safeString(ar, "condition_expr", "true");
                r.channel = safeString(ar, "channel");
                r.channel_params = safeJsonText(ar, "channel_params", "{}");
                r.message_template = safeString(ar, "message_template");

                r.telegram_bot_token = safeString(ar, "telegram_bot_token");
                r.telegram_chat_id = safeString(ar, "telegram_chat_id");
                step.alerts.push_back(std::move(r));
            }
        }

        if (step.id < 0) throw std::runtime_error("step.id invalid");
        out.steps.push_back(std::move(step));
    }

    return out;
}

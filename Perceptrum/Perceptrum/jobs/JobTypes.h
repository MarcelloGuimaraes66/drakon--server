#pragma once
#include <string>
#include <vector>
#include <unordered_map>
#include <optional>
#include <chrono>

#include <nlohmann/json.hpp>
using json = nlohmann::json;

struct JobFaceTargetImage {
    int id = -1;
    std::string image_url;
};

struct JobFaceTarget {
    int id = -1;
    std::string name;
    std::string description;
    std::vector<JobFaceTargetImage> images;
};

struct JobNegativeReferenceImage {
    int id = -1;
    std::string image_url;
};

struct JobPolygonPoint {
    double x = 0.0; // normalized [0..1]
    double y = 0.0; // normalized [0..1]
};

struct JobAnalysisRegion {
    std::string region_id;
    std::string label;
    bool enabled = true;
    bool full_frame = true;
    std::vector<JobPolygonPoint> polygon_norm;
    int draw_ref_width = 1920;
    int draw_ref_height = 1080;
    double context_padding_pct = 0.0;

    std::string prompt_core;
    std::string alert_condition_text;
    std::string negative_condition_text;
    std::vector<int> face_target_ids;
    std::vector<int> negative_image_ids;
};

struct JobAgentDef {
    int id = -1;
    std::string agent_key;
    std::string prompt_template;
    std::string params_json;
    std::string input_schema_json;
    std::optional<int> camera_id; // null means default

    std::string priority_level;
    std::string inference_model = "legacy"; // "legacy" | "pro" | "ultra" | "core"
    std::string api_key;
    int model_fps = 1;
    int run_every_seconds = 10;
    int running_resolution = 640; // core only: 640 or 1024
    bool only_capture_on_motion = true;

    std::string alert_condition_text;
    std::string negative_condition_text;

    std::string input_type = "video"; // "video" | "image"
    std::string video_packaging_mode = "mosaic"; // "mosaic" | "frame_sequence"
    std::vector<JobFaceTarget> face_targets;
    std::vector<JobNegativeReferenceImage> negative_reference_images;
    std::vector<JobAnalysisRegion> analysis_regions;
    std::string temporal_plan_hash;
    std::string temporal_plan_version;
    std::string temporal_compiled_at;
    std::string temporal_compile_model;
    json temporal_plan_envelope = json::object();

};

struct JobAlertRule {
    int id = -1;
    std::string condition_expr;
    std::string channel;          // "telegram", etc.
    std::string channel_params;   // json string
    std::string message_template;

    // Scheduler may inject these for telegram
    std::string telegram_bot_token;
    std::string telegram_chat_id;
};

struct JobTarget {
    int id = -1;
    int camera_id = -1;
    std::string camera_name;
};


struct JobInferenceGroup {
    struct AnalysisBinding {
        int target_id = -1;
        std::vector<std::string> region_ids;
    };

    std::string id;                 // "group-..."
    std::string name;               // optional
    std::string agent_key;          // payload field: agentKey
    std::string prompt_template;
    std::string alert_condition_text;
    std::string negative_condition_text;
    std::string input_type = "video"; // "video" | "image" (payload field: inputType)
    std::string video_packaging_mode = "mosaic"; // payload field: videoPackagingMode
    std::vector<int> target_ids;    // ids of JobTarget inside this step (payload field: targetIds)
    std::string priority_level;
    std::string inference_model = "legacy"; // "legacy" | "pro" | "ultra" | "core"
    std::string api_key;
    int model_fps = 1;
    int run_every_seconds = 10;
    int running_resolution = 640; // core only: 640 or 1024
    bool only_capture_on_motion = true;
    std::vector<AnalysisBinding> analysis_bindings;
    std::vector<JobAnalysisRegion> analysis_regions;
    std::vector<JobFaceTarget> face_targets;
    std::vector<JobNegativeReferenceImage> negative_reference_images;
    std::string temporal_plan_hash;
    std::string temporal_plan_version;
    std::string temporal_compiled_at;
    std::string temporal_compile_model;
    json temporal_plan_envelope = json::object();
};


struct JobStepDef {
    int id = -1;
    int step_order = 0;
    std::string name;

    int timeout_seconds = 0;

    std::optional<int> input_from_step_id;
    std::string input_inject_key;
    std::string on_missing_input; // "skip"

    std::vector<JobInferenceGroup> inference_groups;

    // New (non-breaking): structured start condition and pipeline. If absent,
    // legacy fields above are used.
    struct StartCondition {
        // "sequential" | "positive" | "negative" | "time" | "custom"
        std::string mode;
        std::optional<int> from_step_id;
        // default: "Sentimento_Resposta"
        std::string answer_key = "Sentimento_Resposta";
        // optional: choose a specific camera output from the dependency
        std::optional<int> camera_id;
        // optional: legacy helper (camera key/name)
        std::string target_key;

        // For custom start conditions: free-form text extracted from payload.start_condition.extract
        // (passed to Gemini as startConditionText)
        std::string extract_text;

        // For time-based starts: absolute local time "HH:MM" (best-effort, same day as trigger)
        std::string time_hhmm;

        // For time-based starts: relative offset seconds from job start
        int time_offset_seconds = 0;

        // raw string (legacy start:...)
        std::string raw;
    };

    struct PipelineRef {
        std::optional<int> from_step_id;
        std::string inject_key;
    };

    // New: multiple pipelines per step, routing outputs from previous steps into
    // prompts for specific target cameras in this step.
    struct PipelineInput {
        // camera_id is preferred. If absent, input_inject_key may be used to resolve a camera by name.
        std::optional<int> camera_id;
        std::string input_inject_key;
    };

    struct PipelineSpec {
        int input_from_step_id = -1;              // upstream step id
        std::vector<PipelineInput> inputs;        // one or more upstream cameras to inject
        int target_camera_id = -1;                // camera in THIS step that receives the injected input
        std::string target_camera_name;           // optional, for debug
    };


    std::optional<StartCondition> start_condition;
    std::optional<PipelineRef> pipeline;

    // New: multi-pipeline definitions (preferred). If empty, `pipeline` / legacy fields may be used.
    std::vector<PipelineSpec> pipelines;

    std::vector<JobTarget> targets;
    std::vector<JobAgentDef> agents;
    std::vector<JobAlertRule> alerts;
};

struct JobDefSnapshot {
    int id = -1;
    std::string user_id;
    std::string name;
    std::string description;
    std::string timezone;
    std::string schedule_mode;
    std::string active_from;
    std::string active_until;
    std::string status;
};

struct JobTriggerSnapshot {
    std::string trigger_type;     // "schedule"
    std::string timezone;
    std::string local_date;       // YYYY-MM-DD
    std::string local_time;       // HH:MM
    std::string triggered_at_utc; // ISO
    json raw;                     // keep everything for debugging
};

struct JobStartPayload {
    int version = 1;
    JobDefSnapshot job;
    JobTriggerSnapshot trigger;
    std::vector<JobStepDef> steps;
    std::vector<int> all_camera_ids;

    // New (non-breaking): camera_id -> full start_camera payload (json)
    std::unordered_map<int, json> camera_start_payload_by_id;
};

// Runtime outputs
struct StepOutput {
    // per camera latest output (json or text)
    std::unordered_map<int, std::string> last_output_by_camera;
    // aggregated output (optional)
    std::string aggregated_output;
    // raw outputs if you want history
    std::unordered_map<int, std::vector<std::string>> history_by_camera;
};

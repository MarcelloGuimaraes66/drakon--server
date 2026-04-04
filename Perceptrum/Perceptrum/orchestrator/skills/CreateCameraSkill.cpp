#include "CreateCameraSkill.h"

#include <algorithm>
#include <cctype>
#include <regex>
#include <sstream>
#include <utility>
#include <vector>

#include "../../core/AgentCore.h"
#include "../ChatModelConfig.h"
#include "../HttpUtils.h"
#include "../OperationTaskState.h"
#include "../PromptBuilder.h"

namespace chatv2 {

namespace {

std::string trimCopy_(std::string value)
{
    auto isSpace = [](unsigned char ch) { return std::isspace(ch) != 0; };
    while (!value.empty() && isSpace(static_cast<unsigned char>(value.front()))) {
        value.erase(value.begin());
    }
    while (!value.empty() && isSpace(static_cast<unsigned char>(value.back()))) {
        value.pop_back();
    }
    return value;
}

std::string upperAsciiCopy_(std::string value)
{
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::toupper(ch));
    });
    return value;
}

std::string lowerAsciiCopy_(std::string value)
{
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

bool parseBoolLoose_(const nlohmann::json& value, bool& outValue)
{
    if (value.is_boolean()) {
        outValue = value.get<bool>();
        return true;
    }
    if (value.is_number_integer()) {
        outValue = value.get<int>() != 0;
        return true;
    }
    if (!value.is_string()) {
        return false;
    }

    const std::string normalized = lowerAsciiCopy_(trimCopy_(value.get<std::string>()));
    if (normalized == "true" ||
        normalized == "1" ||
        normalized == "yes" ||
        normalized == "y" ||
        normalized == "sim" ||
        normalized == "s") {
        outValue = true;
        return true;
    }
    if (normalized == "false" ||
        normalized == "0" ||
        normalized == "no" ||
        normalized == "n" ||
        normalized == "nao") {
        outValue = false;
        return true;
    }
    return false;
}

nlohmann::json defaultTaskState_()
{
    return defaultOperationTaskState();
}

const std::vector<std::string>& cameraFieldNames_()
{
    static const std::vector<std::string> fields = {
        "name",
        "connection_method",
        "ip_address",
        "rtsp_port",
        "manufacturer",
        "username",
        "password",
        "channel",
        "subtype",
        "description",
        "street",
        "number",
        "city",
        "state",
        "zip_code",
        "country",
        "retention_days",
        "webcam_index",
        "allowpublicaccess",
    };
    return fields;
}

bool isKnownCameraField_(const std::string& field)
{
    const auto& fields = cameraFieldNames_();
    return std::find(fields.begin(), fields.end(), field) != fields.end();
}

std::string normalizeCameraFieldSource_(std::string value)
{
    value = lowerAsciiCopy_(trimCopy_(std::move(value)));
    if (value == "explicit_user" ||
        value == "implied_user" ||
        value == "address_lookup" ||
        value == "system_default") {
        return value;
    }
    return "";
}

nlohmann::json normalizeCameraFieldSources_(const nlohmann::json& fieldSources)
{
    nlohmann::json normalized = nlohmann::json::object();
    if (!fieldSources.is_object()) {
        return normalized;
    }

    for (auto it = fieldSources.begin(); it != fieldSources.end(); ++it) {
        if (!it.value().is_string() || !isKnownCameraField_(it.key())) {
            continue;
        }
        const std::string source = normalizeCameraFieldSource_(it.value().get<std::string>());
        if (!source.empty()) {
            normalized[it.key()] = source;
        }
    }
    return normalized;
}

std::string cameraFieldSource_(
    const nlohmann::json& fieldSources,
    const std::string& field)
{
    if (!fieldSources.is_object() ||
        !fieldSources.contains(field) ||
        !fieldSources[field].is_string()) {
        return "";
    }
    return normalizeCameraFieldSource_(fieldSources[field].get<std::string>());
}

void setCameraFieldSource_(
    nlohmann::json& fieldSources,
    const std::string& field,
    const std::string& source)
{
    const std::string normalizedSource = normalizeCameraFieldSource_(source);
    if (!isKnownCameraField_(field) || normalizedSource.empty()) {
        return;
    }
    if (!fieldSources.is_object()) {
        fieldSources = nlohmann::json::object();
    }
    fieldSources[field] = normalizedSource;
}

void eraseCameraFieldSource_(
    nlohmann::json& fieldSources,
    const std::string& field)
{
    if (fieldSources.is_object()) {
        fieldSources.erase(field);
    }
}

void eraseFieldFromPatchAndSources_(
    nlohmann::json& patch,
    nlohmann::json& fieldSources,
    const std::string& field)
{
    if (patch.is_object()) {
        patch.erase(field);
    }
    eraseCameraFieldSource_(fieldSources, field);
}

nlohmann::json buildFieldSourcesForPatch_(
    const nlohmann::json& patch,
    const std::string& source)
{
    nlohmann::json fieldSources = nlohmann::json::object();
    if (!patch.is_object()) {
        return fieldSources;
    }
    for (auto it = patch.begin(); it != patch.end(); ++it) {
        setCameraFieldSource_(fieldSources, it.key(), source);
    }
    return fieldSources;
}

nlohmann::json buildCameraPatchEnvelope_(
    const nlohmann::json& patch,
    const nlohmann::json& fieldSources)
{
    const nlohmann::json normalizedPatch =
        patch.is_object() ? patch : nlohmann::json::object();
    nlohmann::json normalizedSources = normalizeCameraFieldSources_(fieldSources);
    for (auto it = normalizedSources.begin(); it != normalizedSources.end();) {
        if (!normalizedPatch.contains(it.key())) {
            it = normalizedSources.erase(it);
            continue;
        }
        ++it;
    }

    return nlohmann::json::object({
        { "camera_patch", normalizedPatch },
        { "field_sources", normalizedSources },
    });
}

nlohmann::json extractionCameraPatch_(const nlohmann::json& extraction)
{
    if (!extraction.is_object() ||
        !extraction.contains("camera_patch") ||
        !extraction["camera_patch"].is_object()) {
        return nlohmann::json::object();
    }
    return extraction["camera_patch"];
}

nlohmann::json extractionFieldSources_(const nlohmann::json& extraction)
{
    if (!extraction.is_object()) {
        return nlohmann::json::object();
    }
    return normalizeCameraFieldSources_(extraction.value("field_sources", nlohmann::json::object()));
}

void mergeCameraPatchIntoDraft_(
    nlohmann::json& draft,
    nlohmann::json& fieldSources,
    const nlohmann::json& patch,
    const nlohmann::json& patchSources,
    const std::string& fallbackSource = "")
{
    if (!draft.is_object()) {
        draft = nlohmann::json::object();
    }
    if (!patch.is_object()) {
        return;
    }

    const nlohmann::json normalizedSources = normalizeCameraFieldSources_(patchSources);
    for (auto it = patch.begin(); it != patch.end(); ++it) {
        draft[it.key()] = it.value();
        const std::string source =
            cameraFieldSource_(normalizedSources, it.key()).empty()
                ? fallbackSource
                : cameraFieldSource_(normalizedSources, it.key());
        if (!source.empty()) {
            setCameraFieldSource_(fieldSources, it.key(), source);
        }
    }
}

bool isUserProvidedFieldSource_(const std::string& source)
{
    return source == "explicit_user" || source == "implied_user";
}

nlohmann::json taskStateFromConversation_(const nlohmann::json& conversationContext)
{
    return taskStateFromConversationContext(conversationContext);
}

std::string queryLanguageFromPayload_(const nlohmann::json& payload)
{
    if (!payload.is_object() ||
        !payload.contains("query_language") ||
        !payload["query_language"].is_string()) {
        return "";
    }
    return normalizeAssistantLanguageTag(payload["query_language"].get<std::string>());
}

std::string queryLanguageSourceFromPayload_(const nlohmann::json& payload)
{
    if (!payload.is_object() ||
        !payload.contains("query_language_source") ||
        !payload["query_language_source"].is_string()) {
        return "";
    }
    return lowerAsciiCopy_(trimCopy_(payload["query_language_source"].get<std::string>()));
}

std::string activeTaskLanguage_(const nlohmann::json& conversationContext)
{
    return activeOperationTaskLanguage(conversationContext);
}

std::string effectiveReplyLanguage_(
    const SkillSelection& selection,
    const nlohmann::json& payload,
    const nlohmann::json& conversationContext)
{
    if (!selection.replyLanguage.empty()) {
        return normalizeAssistantLanguageTag(selection.replyLanguage);
    }

    const std::string queryLanguage = queryLanguageFromPayload_(payload);
    const std::string queryLanguageSource = queryLanguageSourceFromPayload_(payload);
    if (!queryLanguage.empty() && queryLanguageSource == "detected") {
        return queryLanguage;
    }

    const std::string taskLanguage = activeTaskLanguage_(conversationContext);
    if (!taskLanguage.empty()) {
        return taskLanguage;
    }

    if (payload.is_object() && payload.contains("app_language") && payload["app_language"].is_string()) {
        return normalizeAssistantLanguageTag(payload["app_language"].get<std::string>());
    }

    return "en";
}

std::string normalizeConnectionMethod_(const nlohmann::json& camera)
{
    std::string method =
        camera.is_object() && camera.contains("connection_method") && camera["connection_method"].is_string()
            ? camera["connection_method"].get<std::string>()
            : std::string();
    method = upperAsciiCopy_(trimCopy_(std::move(method)));

    if (method == "WEBCAM" ||
        method == "RTSP" ||
        method == "HTTP" ||
        method == "ONVIF") {
        return method;
    }

    return "RTSP";
}

bool hasAnyCameraFieldValue_(const nlohmann::json& camera)
{
    if (!camera.is_object()) {
        return false;
    }

    for (auto it = camera.begin(); it != camera.end(); ++it) {
        const auto& value = it.value();
        if (value.is_string() && !trimCopy_(value.get<std::string>()).empty()) {
            return true;
        }
        if (value.is_boolean() || value.is_number_integer()) {
            return true;
        }
    }

    return false;
}

std::string jsonStringField_(const nlohmann::json& object, const char* key)
{
    if (!object.is_object() || !object.contains(key) || !object[key].is_string()) {
        return "";
    }
    return trimCopy_(object[key].get<std::string>());
}

bool tryJsonIntField_(const nlohmann::json& object, const char* key, int& outValue)
{
    if (!object.is_object() || !object.contains(key)) {
        return false;
    }
    try {
        if (object[key].is_number_integer()) {
            outValue = object[key].get<int>();
            return true;
        }
        if (object[key].is_string()) {
            outValue = std::stoi(trimCopy_(object[key].get<std::string>()));
            return true;
        }
    }
    catch (...) {
    }
    return false;
}

nlohmann::json normalizeCameraFields_(
    const nlohmann::json& camera,
    bool includeNulls);

bool hasCameraValue_(const nlohmann::json& camera, const char* key)
{
    if (!camera.is_object() || !camera.contains(key)) {
        return false;
    }
    const auto& value = camera[key];
    if (value.is_string()) {
        return !trimCopy_(value.get<std::string>()).empty();
    }
    if (value.is_boolean()) return true;
    if (value.is_number_integer()) return true;
    return !value.is_null();
}

std::vector<std::string> computeMissingFields_(const nlohmann::json& camera)
{
    std::vector<std::string> missing;
    const std::string connectionMethod = normalizeConnectionMethod_(camera);

    if (!hasCameraValue_(camera, "name")) {
        missing.push_back("name");
    }

    if (connectionMethod == "WEBCAM") {
        if (!hasCameraValue_(camera, "webcam_index")) {
            missing.push_back("webcam_index");
        }
    }
    else {
        if (!hasCameraValue_(camera, "ip_address")) {
            missing.push_back("ip_address");
        }
        if (!hasCameraValue_(camera, "rtsp_port")) {
            missing.push_back("rtsp_port");
        }
        if (!hasCameraValue_(camera, "manufacturer")) {
            missing.push_back("manufacturer");
        }
        if (!hasCameraValue_(camera, "username")) {
            missing.push_back("username");
        }
        if (!hasCameraValue_(camera, "password")) {
            missing.push_back("password");
        }
    }

    for (const auto* field : {
             "street",
             "number",
             "city",
             "state",
         }) {
        if (!hasCameraValue_(camera, field)) {
            missing.push_back(field);
        }
    }

    return missing;
}

nlohmann::json assumedRtspPortPatch_(const nlohmann::json& camera)
{
    if (normalizeConnectionMethod_(camera) != "WEBCAM" &&
        !hasCameraValue_(camera, "rtsp_port")) {
        return nlohmann::json::object({
            { "rtsp_port", "554" },
        });
    }
    return nlohmann::json::object();
}

nlohmann::json applyAssumedRtspPort_(const nlohmann::json& camera)
{
    nlohmann::json normalized = camera.is_object() ? camera : nlohmann::json::object();
    const nlohmann::json patch = assumedRtspPortPatch_(normalized);
    for (auto it = patch.begin(); it != patch.end(); ++it) {
        normalized[it.key()] = it.value();
    }
    return normalized;
}

bool regexCaptureGroup_(
    const std::string& input,
    const std::regex& pattern,
    std::size_t groupIndex,
    std::string& outValue)
{
    std::smatch match;
    if (!std::regex_search(input, match, pattern) || groupIndex >= match.size()) {
        return false;
    }

    outValue = trimCopy_(match[groupIndex].str());
    return !outValue.empty();
}

std::string collapseWhitespace_(std::string value)
{
    std::string collapsed;
    collapsed.reserve(value.size());

    bool lastWasSpace = false;
    for (unsigned char ch : value) {
        const bool isSpace = std::isspace(ch) != 0;
        if (isSpace) {
            if (!collapsed.empty() && !lastWasSpace) {
                collapsed.push_back(' ');
            }
            lastWasSpace = true;
            continue;
        }

        collapsed.push_back(static_cast<char>(ch));
        lastWasSpace = false;
    }

    return trimCopy_(std::move(collapsed));
}

std::string escapeRegex_(const std::string& value)
{
    std::string escaped;
    escaped.reserve(value.size() * 2);

    for (char ch : value) {
        switch (ch) {
        case '\\':
        case '^':
        case '$':
        case '.':
        case '|':
        case '?':
        case '*':
        case '+':
        case '(':
        case ')':
        case '[':
        case ']':
        case '{':
        case '}':
            escaped.push_back('\\');
            break;
        default:
            break;
        }
        escaped.push_back(ch);
    }

    return escaped;
}

bool isDigitsOnly_(const std::string& value)
{
    const std::string trimmed = trimCopy_(value);
    return !trimmed.empty() &&
        std::all_of(trimmed.begin(), trimmed.end(), [](unsigned char ch) {
            return std::isdigit(ch) != 0;
        });
}

bool isIpv4Candidate_(const std::string& value)
{
    static const std::regex kIpv4Pattern(R"(\b((?:\d{1,3}\.){3}\d{1,3})\b)");
    return std::regex_match(trimCopy_(value), kIpv4Pattern);
}

bool isHostCandidate_(const std::string& value)
{
    const std::string trimmed = trimCopy_(value);
    if (trimmed.empty() || trimmed.find(' ') != std::string::npos) {
        return false;
    }
    if (isIpv4Candidate_(trimmed)) {
        return true;
    }
    static const std::regex kHostPattern(R"([A-Za-z0-9._-]+)");
    return std::regex_match(trimmed, kHostPattern);
}

std::vector<std::string> splitSegments_(const std::string& input);
std::vector<std::string> splitTokens_(const std::string& input);

bool isResidualHostCandidate_(const std::string& value)
{
    const std::string trimmed = trimCopy_(value);
    if (trimmed.empty() || trimmed.find(' ') != std::string::npos) {
        return false;
    }

    static const std::regex kStructuredHostPattern(R"([A-Za-z0-9._:-]+)");
    if (!std::regex_match(trimmed, kStructuredHostPattern)) {
        return false;
    }

    if (isIpv4Candidate_(trimmed)) {
        return true;
    }

    const std::string normalized = lowerAsciiCopy_(trimmed);
    if (normalized == "localhost") {
        return true;
    }

    return trimmed.find('.') != std::string::npos ||
        trimmed.find(':') != std::string::npos ||
        std::any_of(trimmed.begin(), trimmed.end(), [](unsigned char ch) {
            return std::isdigit(ch) != 0;
        });
}

bool isStandaloneHostReply_(const std::string& input)
{
    const std::string trimmed = collapseWhitespace_(input);
    if (!isResidualHostCandidate_(trimmed)) {
        return false;
    }

    const auto segments = splitSegments_(trimmed);
    if (segments.size() != 1) {
        return false;
    }

    const auto tokens = splitTokens_(trimmed);
    return tokens.size() == 1;
}

bool isValidPortCandidate_(const std::string& value)
{
    if (!isDigitsOnly_(value)) {
        return false;
    }
    try {
        const int port = std::stoi(trimCopy_(value));
        return port > 0 && port <= 65535;
    }
    catch (...) {
        return false;
    }
}

bool isPostalCodeCandidate_(const std::string& value)
{
    const std::string trimmed = trimCopy_(value);
    if (trimmed.empty() || trimmed.size() > 16) {
        return false;
    }

    int alnumCount = 0;
    for (unsigned char ch : trimmed) {
        if (std::isalnum(ch) != 0) {
            ++alnumCount;
            continue;
        }
        if (ch == '-' || ch == ' ') {
            continue;
        }
        return false;
    }

    return alnumCount >= 4;
}

std::vector<std::string> splitSegments_(const std::string& input)
{
    std::vector<std::string> segments;
    std::string current;

    auto flush = [&]() {
        const std::string trimmed = trimCopy_(current);
        if (!trimmed.empty()) {
            segments.push_back(trimmed);
        }
        current.clear();
    };

    for (char ch : input) {
        if (ch == ',' || ch == ';' || ch == '\n' || ch == '\r') {
            flush();
            continue;
        }
        current.push_back(ch);
    }
    flush();
    return segments;
}

std::vector<std::string> splitTokens_(const std::string& input)
{
    std::vector<std::string> tokens;
    std::istringstream stream(input);
    std::string token;
    while (stream >> token) {
        const std::string trimmed = trimCopy_(token);
        if (!trimmed.empty()) {
            tokens.push_back(trimmed);
        }
    }
    return tokens;
}

const std::vector<std::pair<std::string, std::string>>& manufacturerAliases_()
{
    static const std::vector<std::pair<std::string, std::string>> aliases = {
        { "hikvision", "Hikvision" },
        { "dahua", "Dahua" },
        { "intelbras", "Intelbras" },
        { "axis", "Axis" },
        { "uniview", "Uniview" },
        { "hanwha", "Hanwha" },
        { "bosch", "Bosch" },
        { "avigilon", "Avigilon" },
        { "vivotek", "Vivotek" },
        { "sony", "Sony" },
        { "generic", "Generic" },
    };
    return aliases;
}

std::string normalizeManufacturerValue_(const std::string& value)
{
    const std::string normalized = lowerAsciiCopy_(trimCopy_(value));
    if (normalized.empty()) {
        return "";
    }

    for (const auto& item : manufacturerAliases_()) {
        if (normalized == item.first) {
            return item.second;
        }
    }

    for (const auto& item : manufacturerAliases_()) {
        if (normalized.find(item.first) != std::string::npos) {
            return item.second;
        }
    }

    return trimCopy_(value);
}

std::string findManufacturerInText_(const std::string& input)
{
    const std::string normalized = lowerAsciiCopy_(input);
    for (const auto& item : manufacturerAliases_()) {
        const std::regex pattern("\\b" + item.first + "\\b", std::regex::icase);
        if (std::regex_search(normalized, pattern)) {
            return item.second;
        }
    }
    return "";
}

struct StructuredFieldBoundaryPattern_ {
    const char* field;
    std::regex pattern;
};

bool isAllowedConnectionMethodValue_(const std::string& value)
{
    const std::string normalized = upperAsciiCopy_(trimCopy_(value));
    return normalized == "WEBCAM" ||
        normalized == "RTSP" ||
        normalized == "HTTP" ||
        normalized == "ONVIF";
}

bool isAllowedRetentionValue_(const std::string& value)
{
    if (!isDigitsOnly_(value)) {
        return false;
    }

    try {
        const int retentionDays = std::stoi(trimCopy_(value));
        return retentionDays == 1 ||
            retentionDays == 3 ||
            retentionDays == 7 ||
            retentionDays == 15 ||
            retentionDays == 30 ||
            retentionDays == 90 ||
            retentionDays == 180;
    }
    catch (...) {
        return false;
    }
}

bool isValidStructuredFieldBoundaryValue_(
    const std::string& field,
    const std::string& value)
{
    const std::string trimmed = trimCopy_(value);
    if (trimmed.empty()) {
        return false;
    }

    if (field == "ip_address") {
        return isResidualHostCandidate_(trimmed);
    }
    if (field == "rtsp_port") {
        return isValidPortCandidate_(trimmed);
    }
    if (field == "manufacturer") {
        return !findManufacturerInText_(trimmed).empty();
    }
    if (field == "username" || field == "password") {
        return trimmed.find(' ') == std::string::npos;
    }
    if (field == "zip_code") {
        return isPostalCodeCandidate_(trimmed);
    }
    if (field == "number") {
        return trimmed.find(' ') == std::string::npos;
    }
    if (field == "webcam_index") {
        return isDigitsOnly_(trimmed);
    }
    if (field == "channel" || field == "subtype") {
        return trimmed.size() <= 32 && trimmed.find_first_of("\r\n,;") == std::string::npos;
    }
    if (field == "connection_method") {
        return isAllowedConnectionMethodValue_(trimmed);
    }
    if (field == "retention_days") {
        return isAllowedRetentionValue_(trimmed);
    }

    return false;
}

const std::vector<StructuredFieldBoundaryPattern_>& structuredFieldBoundaryPatterns_()
{
    static const std::vector<StructuredFieldBoundaryPattern_> patterns = {
        { "ip_address", std::regex(R"(\b(ip\s*address|ip|host|ip\s*or\s*host|ip\/host)\b\s*[:=]?\s*([A-Za-z0-9._:-]+))", std::regex::icase) },
        { "rtsp_port", std::regex(R"(\b(rtsp\s*port|porta\s*rtsp|porta|puerto\s*rtsp|puerto|port)\b\s*[:=]?\s*(\d{1,5}))", std::regex::icase) },
        { "manufacturer", std::regex(R"(\b(manufacturer|fabricante|fabricant)\b\s*[:=]?\s*([^\s,;]+))", std::regex::icase) },
        { "username", std::regex(R"(\b(username|user|usuario|utilisateur)\b\s*[:=]?\s*([^\s,;]+))", std::regex::icase) },
        { "password", std::regex(R"(\b(password|senha|contrasena|mot\s+de\s+passe)\b\s*[:=]?\s*([^\s,;]+))", std::regex::icase) },
        { "zip_code", std::regex(R"(\b(zip\s*code|zipcode|postal\s*code|cep|codigo\s*postal|code\s*postal)\b\s*[:=]?\s*([A-Za-z0-9 -]{4,16}))", std::regex::icase) },
        { "number", std::regex(R"(\b(number|numero|num)\b\s*[:=]?\s*([^\s,;]+))", std::regex::icase) },
        { "webcam_index", std::regex(R"(\b(webcam\s*index|indice\s+da\s+webcam|indice\s+de\s+la\s+webcam|indice|index)\b\s*[:=]?\s*(\d+))", std::regex::icase) },
        { "channel", std::regex(R"(\b(channel|canal)\b\s*[:=]?\s*([^\s,;]+))", std::regex::icase) },
        { "subtype", std::regex(R"(\b(subtype|subtipo)\b\s*[:=]?\s*([^\s,;]+))", std::regex::icase) },
        { "connection_method", std::regex(R"(\b(connection\s*method|metodo\s+de\s+conexao|metodo\s+de\s+conexion|methode\s+de\s+connexion|method|metodo|methode)\b\s*[:=]?\s*(WEBCAM|RTSP|HTTP|ONVIF|webcam|rtsp|http|onvif))", std::regex::icase) },
        { "retention_days", std::regex(R"(\b(retention\s*days|retention|retencao|retencion|retenzione)\b\s*[:=]?\s*(\d+))", std::regex::icase) },
    };
    return patterns;
}

const std::vector<std::string>& structuredBoundaryFieldsFor_(const std::string& field)
{
    static const std::vector<std::string> none = {};
    static const std::vector<std::string> compactSlotFields = {
        "ip_address",
        "rtsp_port",
        "manufacturer",
        "username",
        "password",
        "zip_code",
        "number",
        "webcam_index",
        "channel",
        "subtype",
        "connection_method",
        "retention_days",
    };
    static const std::vector<std::string> manufacturerFields = {
        "ip_address",
        "rtsp_port",
        "username",
        "password",
        "zip_code",
        "number",
        "channel",
        "subtype",
        "connection_method",
        "retention_days",
    };
    static const std::vector<std::string> streetFields = {
        "number",
        "zip_code",
    };

    if (field == "name" || field == "description") {
        return compactSlotFields;
    }
    if (field == "manufacturer") {
        return manufacturerFields;
    }
    if (field == "street") {
        return streetFields;
    }
    return none;
}

std::string trimStructuredFieldValue_(
    const std::string& field,
    std::string value)
{
    value = collapseWhitespace_(std::move(value));
    if (value.empty()) {
        return "";
    }

    const auto& boundaryFields = structuredBoundaryFieldsFor_(field);
    if (boundaryFields.empty()) {
        return value;
    }

    std::size_t boundaryPos = std::string::npos;
    for (const auto& item : structuredFieldBoundaryPatterns_()) {
        if (std::find(boundaryFields.begin(), boundaryFields.end(), item.field) == boundaryFields.end()) {
            continue;
        }

        std::smatch match;
        if (!std::regex_search(value, match, item.pattern) || match.size() < 3) {
            continue;
        }

        const std::size_t pos = static_cast<std::size_t>(match.position());
        if (pos == 0) {
            continue;
        }

        const unsigned char before = static_cast<unsigned char>(value[pos - 1]);
        if (std::isspace(before) == 0 &&
            before != ',' &&
            before != ';' &&
            before != ':' &&
            before != '(') {
            continue;
        }

        const std::string nextValue = collapseWhitespace_(match[2].str());
        if (!isValidStructuredFieldBoundaryValue_(item.field, nextValue)) {
            continue;
        }

        if (boundaryPos == std::string::npos || pos < boundaryPos) {
            boundaryPos = pos;
        }
    }

    if (boundaryPos != std::string::npos) {
        value = value.substr(0, boundaryPos);
    }

    return collapseWhitespace_(std::move(value));
}

nlohmann::json refineStructuredCameraPatch_(const nlohmann::json& patch)
{
    if (!patch.is_object()) {
        return nlohmann::json::object();
    }

    nlohmann::json refined = patch;
    const std::vector<const char*> textFields = {
        "name",
        "manufacturer",
        "description",
        "street",
        "city",
        "state",
        "country",
    };

    for (const auto* field : textFields) {
        if (!refined.contains(field) || !refined[field].is_string()) {
            continue;
        }

        const std::string normalized = trimStructuredFieldValue_(field, refined[field].get<std::string>());
        if (normalized.empty()) {
            refined.erase(field);
            continue;
        }
        refined[field] = normalized;
    }

    return refined;
}

std::vector<std::string> activeMissingFields_(const nlohmann::json& conversationContext);

bool hasExplicitHostEvidence_(const std::string& input)
{
    if (std::regex_search(
            input,
            std::regex(R"(rtsp:\/\/(?:([^:@\/\s]+)(?::([^@\/\s]*))?@)?([^:\/\s]+)(?::(\d{1,5}))?)", std::regex::icase))) {
        return true;
    }
    if (std::regex_search(input, std::regex(R"(\b((?:\d{1,3}\.){3}\d{1,3})\b)"))) {
        return true;
    }

    std::string labeledHost;
    if (regexCaptureGroup_(
            input,
            std::regex(R"((ip\s*address|ip|host|ip\s*or\s*host|ip\/host)\s*[:=]?\s*([A-Za-z0-9._:-]+))", std::regex::icase),
            2,
            labeledHost) &&
        isResidualHostCandidate_(labeledHost)) {
        return true;
    }

    return isStandaloneHostReply_(input);
}

bool hasExplicitPortEvidence_(const std::string& input)
{
    if (std::regex_search(
            input,
            std::regex(R"(rtsp:\/\/(?:([^:@\/\s]+)(?::([^@\/\s]*))?@)?([^:\/\s]+)(?::(\d{1,5}))?)", std::regex::icase))) {
        return true;
    }
    return std::regex_search(
        input,
        std::regex(R"((rtsp\s*port|porta\s*rtsp|porta|puerto\s*rtsp|puerto|port)\s*[:=]?\s*\d{1,5})", std::regex::icase));
}

bool hasExplicitUsernameEvidence_(const std::string& input)
{
    return std::regex_search(
        input,
        std::regex(R"((username|user|usuario|utilisateur)\s*[:=]?\s*[^\s,;]+)", std::regex::icase));
}

bool hasExplicitPasswordEvidence_(const std::string& input)
{
    return std::regex_search(
        input,
        std::regex(R"((password|senha|contrasena|mot\s+de\s+passe)\s*[:=]?\s*[^\s,;]+)", std::regex::icase));
}

bool hasExplicitNameEvidence_(const std::string& input)
{
    return std::regex_search(
        input,
        std::regex(
            R"((camera\s*name|name|nome\s+da\s+camera|nome\s+de\s+camera|nome|nombre\s+de\s+la\s+camara|nombre|nom\s+de\s+la\s+camera|nom|named|called|chamada|chamado)\s*[:=]?\s*[^\n,;]+)",
            std::regex::icase));
}

bool hasExplicitWebcamIndexEvidence_(const std::string& input)
{
    return std::regex_search(
        input,
        std::regex(R"((webcam\s*index|indice\s+da\s+webcam|indice\s+de\s+la\s+webcam|indice|index)\s*[:=]?\s*\d+)", std::regex::icase));
}

bool isLikelyStandaloneCameraNameReply_(const std::string& userMessage);

nlohmann::json sanitizeExtractedCameraDraft_(
    const nlohmann::json& draft,
    const std::string& userMessage,
    const nlohmann::json& existingDraft,
    const nlohmann::json& conversationContext)
{
    if (!draft.is_object()) {
        return buildCameraPatchEnvelope_(
            nlohmann::json::object(),
            nlohmann::json::object());
    }

    nlohmann::json sanitizedPatch = extractionCameraPatch_(draft);
    nlohmann::json fieldSources = extractionFieldSources_(draft);
    const std::vector<std::string> activeMissing = activeMissingFields_(conversationContext);
    const auto fieldIsActivelyMissing = [&](const char* key) {
        return std::find(activeMissing.begin(), activeMissing.end(), key) != activeMissing.end();
    };
    const bool hasOngoingCollection =
        !activeMissing.empty() ||
        hasAnyCameraFieldValue_(existingDraft);

    if (!hasExplicitNameEvidence_(userMessage)) {
        const bool allowImplicitNameReply =
            hasOngoingCollection &&
            fieldIsActivelyMissing("name") &&
            isLikelyStandaloneCameraNameReply_(userMessage);
        if (!allowImplicitNameReply) {
            eraseFieldFromPatchAndSources_(sanitizedPatch, fieldSources, "name");
        }
    }

    const bool explicitHostEvidence = hasExplicitHostEvidence_(userMessage);
    if (!explicitHostEvidence ||
        (hasCameraValue_(sanitizedPatch, "ip_address") &&
         !isResidualHostCandidate_(jsonStringField_(sanitizedPatch, "ip_address")))) {
        eraseFieldFromPatchAndSources_(sanitizedPatch, fieldSources, "ip_address");
    }
    if (!hasExplicitPortEvidence_(userMessage) && !hasOngoingCollection) {
        eraseFieldFromPatchAndSources_(sanitizedPatch, fieldSources, "rtsp_port");
    }
    if (findManufacturerInText_(userMessage).empty() && !hasOngoingCollection) {
        eraseFieldFromPatchAndSources_(sanitizedPatch, fieldSources, "manufacturer");
    }
    if (!hasExplicitUsernameEvidence_(userMessage) && !hasOngoingCollection) {
        eraseFieldFromPatchAndSources_(sanitizedPatch, fieldSources, "username");
    }
    if (!hasExplicitPasswordEvidence_(userMessage) && !hasOngoingCollection) {
        eraseFieldFromPatchAndSources_(sanitizedPatch, fieldSources, "password");
    }
    if (!hasExplicitWebcamIndexEvidence_(userMessage)) {
        const bool allowImplicitWebcamIndexReply =
            hasOngoingCollection &&
            fieldIsActivelyMissing("webcam_index") &&
            isDigitsOnly_(trimCopy_(userMessage));
        if (!allowImplicitWebcamIndexReply) {
            eraseFieldFromPatchAndSources_(sanitizedPatch, fieldSources, "webcam_index");
        }
    }

    for (auto it = sanitizedPatch.begin(); it != sanitizedPatch.end(); ++it) {
        if (cameraFieldSource_(fieldSources, it.key()).empty()) {
            setCameraFieldSource_(fieldSources, it.key(), "implied_user");
        }
    }

    return buildCameraPatchEnvelope_(sanitizedPatch, fieldSources);
}

std::vector<std::string> activeMissingFields_(const nlohmann::json& conversationContext)
{
    std::vector<std::string> missing;
    const nlohmann::json taskState = taskStateFromConversation_(conversationContext);
    if (!taskState.contains("active_task") || !taskState["active_task"].is_object()) {
        return missing;
    }

    const auto& activeTask = taskState["active_task"];
    if (!activeTask.contains("missing_fields") || !activeTask["missing_fields"].is_array()) {
        return missing;
    }

    for (const auto& item : activeTask["missing_fields"]) {
        if (!item.is_string()) {
            continue;
        }
        const std::string value = trimCopy_(item.get<std::string>());
        if (!value.empty()) {
            missing.push_back(value);
        }
    }
    return missing;
}

bool isStopwordToken_(const std::string& token)
{
    const std::string normalized = lowerAsciiCopy_(trimCopy_(token));
    if (normalized.empty()) {
        return true;
    }

    static const std::vector<std::string> stopwords = {
        "create", "criar", "crie", "registre", "registrar", "cadastre", "cadastrar",
        "adicione", "adicionar", "camera", "cameras", "camara", "camaras",
        "uma", "um", "nova", "novo", "para", "mim", "com", "and", "e",
        "rtsp", "ip", "host", "port", "porta", "puerto", "manufacturer",
        "fabricante", "fabricant", "username", "user", "usuario", "utilisateur",
        "password", "senha", "contrasena", "mot", "de", "passe",
        "name", "nome", "nombre", "nom", "webcam", "index", "indice"
    };

    return std::find(stopwords.begin(), stopwords.end(), normalized) != stopwords.end();
}

bool isGenericNameToken_(const std::string& token)
{
    const std::string normalized = lowerAsciiCopy_(trimCopy_(token));
    if (normalized.empty()) {
        return true;
    }

    static const std::vector<std::string> genericTokens = {
        "a", "already", "an", "and", "as", "camera", "camara", "cameras", "camaras",
        "com", "como", "da", "das", "data", "dados", "de", "do", "dos", "eu",
        "for", "how", "i", "ja", "know", "me", "my", "os", "para", "preciso",
        "quero", "rtsp", "sei", "sim", "so", "the", "this", "uma", "um", "user",
        "vc", "voce", "vou", "webcam", "what", "yes"
    };

    return std::find(genericTokens.begin(), genericTokens.end(), normalized) != genericTokens.end();
}

bool isLikelyStandaloneCameraNameReply_(const std::string& userMessage)
{
    const std::string trimmed = collapseWhitespace_(userMessage);
    if (trimmed.empty() || trimmed.size() > 64) {
        return false;
    }
    if (isHostCandidate_(trimmed) || isDigitsOnly_(trimmed)) {
        return false;
    }

    const auto segments = splitSegments_(trimmed);
    if (segments.size() != 1) {
        return false;
    }

    const auto tokens = splitTokens_(trimmed);
    if (tokens.empty() || tokens.size() > 4) {
        return false;
    }

    int meaningfulTokens = 0;
    for (const auto& token : tokens) {
        if (isGenericNameToken_(token) || isStopwordToken_(token)) {
            continue;
        }
        ++meaningfulTokens;
    }

    return meaningfulTokens > 0;
}

bool applyCandidateToField_(
    nlohmann::json& draft,
    const std::string& field,
    const std::string& value)
{
    const std::string trimmed = trimCopy_(value);
    if (trimmed.empty()) {
        return false;
    }

    if (field == "name") {
        if (isDigitsOnly_(trimmed) || isHostCandidate_(trimmed)) {
            return false;
        }
        draft["name"] = trimmed;
        return true;
    }

    if (field == "ip_address") {
        if (!isResidualHostCandidate_(trimmed)) {
            return false;
        }
        draft["ip_address"] = trimmed;
        return true;
    }

    if (field == "rtsp_port") {
        if (!isValidPortCandidate_(trimmed)) {
            return false;
        }
        draft["rtsp_port"] = trimmed;
        return true;
    }

    if (field == "manufacturer") {
        const std::string normalizedManufacturer = normalizeManufacturerValue_(trimmed);
        bool matchedAlias = false;
        const std::string loweredTrimmed = lowerAsciiCopy_(trimCopy_(trimmed));
        for (const auto& item : manufacturerAliases_()) {
            if (loweredTrimmed == item.first || loweredTrimmed.find(item.first) != std::string::npos) {
                matchedAlias = true;
                break;
            }
        }
        if (normalizedManufacturer.empty() || !matchedAlias) {
            return false;
        }
        draft["manufacturer"] = normalizedManufacturer;
        return true;
    }

    if (field == "username" || field == "password") {
        if (trimmed.find(' ') != std::string::npos) {
            return false;
        }
        draft[field] = trimmed;
        return true;
    }

    if (field == "number") {
        draft["number"] = trimmed;
        return true;
    }

    if (field == "zip_code") {
        if (!isPostalCodeCandidate_(trimmed)) {
            return false;
        }
        draft["zip_code"] = trimmed;
        return true;
    }

    if (field == "street" || field == "city" || field == "state" || field == "country") {
        draft[field] = trimmed;
        return true;
    }

    if (field == "webcam_index") {
        if (!isDigitsOnly_(trimmed)) {
            return false;
        }
        draft["webcam_index"] = std::stoi(trimmed);
        return true;
    }

    return false;
}

std::vector<std::string> collectResidualCandidates_(
    const std::string& userMessage,
    const nlohmann::json& parsedDraft)
{
    std::string residual = userMessage;

    const std::vector<std::regex> replacePatterns = {
        std::regex(R"(rtsp:\/\/[^\s]+)", std::regex::icase),
        std::regex(R"((?:\d{1,3}\.){3}\d{1,3})", std::regex::icase),
        std::regex(R"((camera\s*name|name|nome\s+da\s+camera|nome\s+de\s+camera|nome|nombre\s+de\s+la\s+camara|nombre|nom\s+de\s+la\s+camera|nom)\s*[:=]?\s*[^\n,;]+)", std::regex::icase),
        std::regex(R"((ip\s*address|ip|host|ip\s*or\s*host|ip\/host)\s*[:=]?\s*[A-Za-z0-9._:-]+)", std::regex::icase),
        std::regex(R"((rtsp\s*port|porta\s*rtsp|porta|puerto\s*rtsp|puerto|port)\s*[:=]?\s*\d{1,5})", std::regex::icase),
        std::regex(R"((manufacturer|fabricante|fabricant)\s*[:=]?\s*[^\n,;]+)", std::regex::icase),
        std::regex(R"((username|user|usuario|utilisateur)\s*[:=]?\s*[^\s,;]+)", std::regex::icase),
        std::regex(R"((password|senha|contrasena|mot\s+de\s+passe)\s*[:=]?\s*[^\s,;]+)", std::regex::icase),
        std::regex(R"((zip\s*code|zipcode|postal\s*code|cep|codigo\s*postal|code\s*postal)\s*[:=]?\s*[A-Za-z0-9 -]+)", std::regex::icase),
        std::regex(R"((street|rua|logradouro|calle|rue)\s*[:=]?\s*[^\n,;]+)", std::regex::icase),
        std::regex(R"((number|numero|num)\s*[:=]?\s*[^\s,;]+)", std::regex::icase),
        std::regex(R"((city|cidade|ciudad|ville)\s*[:=]?\s*[^\n,;]+)", std::regex::icase),
        std::regex(R"((state|estado|provincia|etat)\s*[:=]?\s*[^\n,;]+)", std::regex::icase),
        std::regex(R"((country|pais|pays)\s*[:=]?\s*[^\n,;]+)", std::regex::icase),
        std::regex(R"((webcam\s*index|indice\s+da\s+webcam|indice\s+de\s+la\s+webcam|indice|index)\s*[:=]?\s*\d+)", std::regex::icase),
    };

    for (const auto& pattern : replacePatterns) {
        residual = std::regex_replace(residual, pattern, " ");
    }

    for (const auto& item : manufacturerAliases_()) {
        residual = std::regex_replace(
            residual,
            std::regex("\\b" + item.first + "\\b", std::regex::icase),
            " ");
    }

    for (const auto& key : {
             "name",
             "ip_address",
             "rtsp_port",
             "manufacturer",
             "username",
             "password",
         }) {
        const std::string parsedValue = jsonStringField_(parsedDraft, key);
        if (parsedValue.empty()) {
            continue;
        }
        const std::string escapedValue = escapeRegex_(parsedValue);
        if (!escapedValue.empty()) {
            residual = std::regex_replace(
                residual,
                std::regex(escapedValue, std::regex::icase),
                " ");
        }
    }

    residual = std::regex_replace(residual, std::regex(R"([,;:\n\r\t]+)"), " ");
    residual = collapseWhitespace_(std::move(residual));

    std::vector<std::string> candidates;
    for (const auto& token : splitTokens_(residual)) {
        if (isStopwordToken_(token)) {
            continue;
        }
        candidates.push_back(token);
    }

    return candidates;
}

nlohmann::json deterministicCameraDraft_(
    const std::string& userMessage,
    const nlohmann::json& existingDraft,
    const nlohmann::json& conversationContext)
{
    const std::string trimmed = trimCopy_(userMessage);
    if (trimmed.empty()) {
        return buildCameraPatchEnvelope_(
            nlohmann::json::object(),
            nlohmann::json::object());
    }

    nlohmann::json parsed = nlohmann::json::object();
    const std::string normalized = lowerAsciiCopy_(trimmed);

    if (normalized.find("webcam") != std::string::npos ||
        normalized.find("usb camera") != std::string::npos ||
        normalized.find("camera usb") != std::string::npos) {
        parsed["connection_method"] = "WEBCAM";
    }
    else if (normalized.find("onvif") != std::string::npos) {
        parsed["connection_method"] = "ONVIF";
    }
    else if (normalized.find("http") != std::string::npos) {
        parsed["connection_method"] = "HTTP";
    }
    else if (normalized.find("rtsp") != std::string::npos) {
        parsed["connection_method"] = "RTSP";
    }

    {
        std::string value;
        if (regexCaptureGroup_(
                trimmed,
                std::regex(R"(rtsp:\/\/(?:([^:@\/\s]+)(?::([^@\/\s]*))?@)?([^:\/\s]+)(?::(\d{1,5}))?)", std::regex::icase),
                3,
                value)) {
            parsed["connection_method"] = "RTSP";
            parsed["ip_address"] = value;

            if (regexCaptureGroup_(
                    trimmed,
                    std::regex(R"(rtsp:\/\/(?:([^:@\/\s]+)(?::([^@\/\s]*))?@)?([^:\/\s]+)(?::(\d{1,5}))?)", std::regex::icase),
                    1,
                    value)) {
                parsed["username"] = value;
            }
            if (regexCaptureGroup_(
                    trimmed,
                    std::regex(R"(rtsp:\/\/(?:([^:@\/\s]+)(?::([^@\/\s]*))?@)?([^:\/\s]+)(?::(\d{1,5}))?)", std::regex::icase),
                    2,
                    value)) {
                parsed["password"] = value;
            }
            if (regexCaptureGroup_(
                    trimmed,
                    std::regex(R"(rtsp:\/\/(?:([^:@\/\s]+)(?::([^@\/\s]*))?@)?([^:\/\s]+)(?::(\d{1,5}))?)", std::regex::icase),
                    4,
                    value)) {
                parsed["rtsp_port"] = value;
            }
        }
    }

    auto captureField = [&](const std::vector<std::pair<std::regex, std::size_t>>& patterns) -> std::string {
        std::string captured;
        for (const auto& item : patterns) {
            if (regexCaptureGroup_(trimmed, item.first, item.second, captured)) {
                return captured;
            }
        }
        return "";
    };

    {
        const std::string name = captureField({
            { std::regex(R"((camera\s*name|name)\s*[:=]?\s*([^\n,;]+))", std::regex::icase), 2 },
            { std::regex(R"((nome\s+da\s+camera|nome\s+de\s+camera|nome)\s*[:=]?\s*([^\n,;]+))", std::regex::icase), 2 },
            { std::regex(R"((nombre\s+de\s+la\s+camara|nombre)\s*[:=]?\s*([^\n,;]+))", std::regex::icase), 2 },
            { std::regex(R"((nom\s+de\s+la\s+camera|nom)\s*[:=]?\s*([^\n,;]+))", std::regex::icase), 2 },
        });
        if (!name.empty()) {
            parsed["name"] = collapseWhitespace_(name);
        }
    }

    {
        const std::string host = captureField({
            { std::regex(R"((ip\s*address|ip|host|ip\s*or\s*host|ip\/host)\s*[:=]?\s*([A-Za-z0-9._:-]+))", std::regex::icase), 2 },
        });
        if (!host.empty() && isResidualHostCandidate_(host)) {
            parsed["ip_address"] = host;
        }
    }

    {
        const std::string port = captureField({
            { std::regex(R"((rtsp\s*port|porta\s*rtsp|porta|puerto\s*rtsp|puerto|port)\s*[:=]?\s*(\d{1,5}))", std::regex::icase), 2 },
        });
        if (!port.empty() && isValidPortCandidate_(port)) {
            parsed["rtsp_port"] = port;
        }
    }

    {
        const std::string manufacturer = captureField({
            { std::regex(R"((manufacturer|fabricante|fabricant)\s*[:=]?\s*([^\n,;]+))", std::regex::icase), 2 },
        });
        if (!manufacturer.empty()) {
            parsed["manufacturer"] = normalizeManufacturerValue_(manufacturer);
        }
    }

    {
        const std::string username = captureField({
            { std::regex(R"((username|user|usuario|utilisateur)\s*[:=]?\s*([^\s,;]+))", std::regex::icase), 2 },
        });
        if (!username.empty()) {
            parsed["username"] = username;
        }
    }

    {
        const std::string password = captureField({
            { std::regex(R"((password|senha|contrasena|mot\s+de\s+passe)\s*[:=]?\s*([^\s,;]+))", std::regex::icase), 2 },
        });
        if (!password.empty()) {
            parsed["password"] = password;
        }
    }

    {
        const std::string zipCode = captureField({
            { std::regex(R"((zip\s*code|zipcode|postal\s*code|cep|codigo\s*postal|code\s*postal)\s*[:=]?\s*([A-Za-z0-9 -]{4,16}))", std::regex::icase), 2 },
        });
        if (!zipCode.empty()) {
            parsed["zip_code"] = trimCopy_(zipCode);
        }
    }

    {
        const std::string street = captureField({
            { std::regex(R"((street|rua|logradouro|calle|rue)\s*[:=]?\s*([^\n,;]+))", std::regex::icase), 2 },
        });
        if (!street.empty()) {
            parsed["street"] = collapseWhitespace_(street);
        }
    }

    {
        const std::string number = captureField({
            { std::regex(R"((number|numero|num)\s*[:=]?\s*([^\s,;]+))", std::regex::icase), 2 },
        });
        if (!number.empty()) {
            parsed["number"] = trimCopy_(number);
        }
    }

    {
        const std::string city = captureField({
            { std::regex(R"((city|cidade|ciudad|ville)\s*[:=]?\s*([^\n,;]+))", std::regex::icase), 2 },
        });
        if (!city.empty()) {
            parsed["city"] = collapseWhitespace_(city);
        }
    }

    {
        const std::string state = captureField({
            { std::regex(R"((state|estado|provincia|etat)\s*[:=]?\s*([^\n,;]+))", std::regex::icase), 2 },
        });
        if (!state.empty()) {
            parsed["state"] = collapseWhitespace_(state);
        }
    }

    {
        const std::string country = captureField({
            { std::regex(R"((country|pais|pays)\s*[:=]?\s*([^\n,;]+))", std::regex::icase), 2 },
        });
        if (!country.empty()) {
            parsed["country"] = collapseWhitespace_(country);
        }
    }

    {
        const std::string webcamIndex = captureField({
            { std::regex(R"((webcam\s*index|indice\s+da\s+webcam|indice\s+de\s+la\s+webcam|indice|index)\s*[:=]?\s*(\d+))", std::regex::icase), 2 },
        });
        if (!webcamIndex.empty()) {
            parsed["webcam_index"] = std::stoi(webcamIndex);
        }
    }

    {
        std::string ipv4;
        if (!hasCameraValue_(parsed, "ip_address") &&
            regexCaptureGroup_(
                trimmed,
                std::regex(R"(\b((?:\d{1,3}\.){3}\d{1,3})\b)"),
                1,
                ipv4)) {
            parsed["ip_address"] = ipv4;
        }
    }

    {
        std::string postalCode;
        if (!hasCameraValue_(parsed, "zip_code") &&
            regexCaptureGroup_(
                trimmed,
                std::regex(R"(\b((?:\d{5}(?:-\d{4})?)|(?:\d{8})|(?:[A-Za-z]\d[A-Za-z0-9 -]{2,8}))\b)", std::regex::icase),
                1,
                postalCode) &&
            isPostalCodeCandidate_(postalCode)) {
            parsed["zip_code"] = trimCopy_(postalCode);
        }
    }

    if (!hasCameraValue_(parsed, "manufacturer")) {
        const std::string manufacturer = findManufacturerInText_(trimmed);
        if (!manufacturer.empty()) {
            parsed["manufacturer"] = manufacturer;
        }
    }

    const std::vector<std::string> activeMissing = activeMissingFields_(conversationContext);
    const bool awaitingName =
        std::find(activeMissing.begin(), activeMissing.end(), "name") != activeMissing.end();

    if (!hasCameraValue_(parsed, "name") && awaitingName && isLikelyStandaloneCameraNameReply_(trimmed)) {
        for (const auto& segment : splitSegments_(trimmed)) {
            const std::string lowerSegment = lowerAsciiCopy_(segment);
            if (segment.empty() ||
                isHostCandidate_(segment) ||
                isDigitsOnly_(segment) ||
                lowerSegment.find("rtsp") != std::string::npos ||
                lowerSegment.find("port") != std::string::npos ||
                lowerSegment.find("password") != std::string::npos ||
                lowerSegment.find("senha") != std::string::npos ||
                lowerSegment.find("username") != std::string::npos ||
                lowerSegment.find("usuario") != std::string::npos ||
                !findManufacturerInText_(segment).empty()) {
                continue;
            }

            std::string candidate = segment;
            candidate = std::regex_replace(
                candidate,
                std::regex(R"(\b(create|criar|crie|registre|registrar|cadastre|cadastrar|adicione|adicionar)\b)", std::regex::icase),
                " ");
            candidate = std::regex_replace(
                candidate,
                std::regex(R"(\b(camera|cameras|camara|camaras|com|uma|um|nova|novo|para|mim)\b)", std::regex::icase),
                " ");
            candidate = collapseWhitespace_(std::move(candidate));
            if (!candidate.empty() &&
                !isHostCandidate_(candidate) &&
                !isDigitsOnly_(candidate) &&
                isLikelyStandaloneCameraNameReply_(candidate)) {
                parsed["name"] = candidate;
                break;
            }
        }
    }

    std::vector<std::string> missingFields = activeMissing;
    if (missingFields.empty()) {
        missingFields = computeMissingFields_(existingDraft);
    }
    if (missingFields.empty()) {
        missingFields = {
            "name",
            "ip_address",
            "rtsp_port",
            "manufacturer",
            "username",
            "password",
            "street",
            "number",
            "city",
            "state",
            "zip_code",
            "country",
            "webcam_index",
        };
    }

    const bool allowResidualSlotFilling =
        !activeMissing.empty() ||
        hasAnyCameraFieldValue_(existingDraft);
    if (allowResidualSlotFilling) {
        std::vector<std::string> residualCandidates = collectResidualCandidates_(trimmed, parsed);
        for (const auto& field : missingFields) {
            if (hasCameraValue_(parsed, field.c_str())) {
                continue;
            }

            for (auto it = residualCandidates.begin(); it != residualCandidates.end(); ++it) {
                if (applyCandidateToField_(parsed, field, *it)) {
                    residualCandidates.erase(it);
                    break;
                }
            }
        }

        if (residualCandidates.size() == 1 && missingFields.size() == 1) {
            applyCandidateToField_(parsed, missingFields.front(), residualCandidates.front());
        }
    }

    const nlohmann::json patch =
        normalizeCameraFields_(refineStructuredCameraPatch_(parsed), false);
    nlohmann::json fieldSources = nlohmann::json::object();

    if (hasCameraValue_(patch, "connection_method")) {
        setCameraFieldSource_(fieldSources, "connection_method", "implied_user");
    }
    if (hasCameraValue_(patch, "name")) {
        setCameraFieldSource_(
            fieldSources,
            "name",
            (hasExplicitNameEvidence_(trimmed) ||
             (awaitingName && isLikelyStandaloneCameraNameReply_(trimmed)))
                ? "explicit_user"
                : "implied_user");
    }

    for (const auto& field : cameraFieldNames_()) {
        if (field == "connection_method" || field == "name") {
            continue;
        }
        if (hasCameraValue_(patch, field.c_str())) {
            setCameraFieldSource_(fieldSources, field, "explicit_user");
        }
    }

    return buildCameraPatchEnvelope_(patch, fieldSources);
}

std::string labelForField_(const std::string& fieldName, const std::string& language)
{
    const bool pt = language == "pt";
    const bool es = language == "es";
    const bool fr = language == "fr";

    if (fieldName == "name") {
        if (pt) return "nome da camera";
        if (es) return "nombre de la camara";
        if (fr) return "nom de la camera";
        return "camera name";
    }
    if (fieldName == "ip_address") {
        if (pt) return "IP ou host";
        if (es) return "IP o host";
        if (fr) return "IP ou hote";
        return "IP or host";
    }
    if (fieldName == "rtsp_port") {
        if (pt) return "porta RTSP";
        if (es) return "puerto RTSP";
        if (fr) return "port RTSP";
        return "RTSP port";
    }
    if (fieldName == "manufacturer") {
        if (pt) return "fabricante";
        if (es) return "fabricante";
        if (fr) return "fabricant";
        return "manufacturer";
    }
    if (fieldName == "username") {
        if (pt) return "usuario";
        if (es) return "usuario";
        if (fr) return "nom d'utilisateur";
        return "username";
    }
    if (fieldName == "password") {
        if (pt) return "senha";
        if (es) return "contrasena";
        if (fr) return "mot de passe";
        return "password";
    }
    if (fieldName == "street") {
        if (pt) return "rua";
        if (es) return "calle";
        if (fr) return "rue";
        return "street";
    }
    if (fieldName == "number") {
        if (pt) return "numero do endereco";
        if (es) return "numero de la direccion";
        if (fr) return "numero de l'adresse";
        return "address number";
    }
    if (fieldName == "city") {
        if (pt) return "cidade";
        if (es) return "ciudad";
        if (fr) return "ville";
        return "city";
    }
    if (fieldName == "state") {
        if (pt) return "estado";
        if (es) return "estado";
        if (fr) return "etat";
        return "state";
    }
    if (fieldName == "zip_code") {
        if (pt) return "CEP ou zipcode";
        if (es) return "codigo postal o zipcode";
        if (fr) return "code postal ou zipcode";
        return "ZIP code or zipcode";
    }
    if (fieldName == "country") {
        if (pt) return "pais";
        if (es) return "pais";
        if (fr) return "pays";
        return "country";
    }
    if (fieldName == "webcam_index") {
        if (pt) return "indice da webcam";
        if (es) return "indice de la webcam";
        if (fr) return "indice de la webcam";
        return "webcam index";
    }
    return fieldName;
}

std::string buildAddressFieldPrompt_(const std::vector<std::string>& missingFields, const std::string& language)
{
    const auto hasField = [&](const char* key) {
        return std::find(missingFields.begin(), missingFields.end(), key) != missingFields.end();
    };

    const int addressMissingCount =
        static_cast<int>(hasField("street")) +
        static_cast<int>(hasField("number")) +
        static_cast<int>(hasField("city")) +
        static_cast<int>(hasField("state")) +
        static_cast<int>(hasField("zip_code")) +
        static_cast<int>(hasField("country"));

    if (addressMissingCount <= 0) {
        return "";
    }

    if (addressMissingCount == 1 && hasField("number")) {
        return labelForField_("number", language);
    }
    if (addressMissingCount == 1 && hasField("zip_code")) {
        return labelForField_("zip_code", language);
    }

    if (language == "pt") {
        return "endereco (envie um CEP/zipcode para preencher rua, cidade, estado e pais automaticamente, ou envie o endereco completo)";
    }
    if (language == "es") {
        return "direccion (envia un codigo postal/zipcode para completar calle, ciudad, estado y pais automaticamente, o envia la direccion completa)";
    }
    if (language == "fr") {
        return "adresse (envoyez un code postal/zipcode pour remplir automatiquement la rue, la ville, l'etat et le pays, ou envoyez l'adresse complete)";
    }
    return "address (send a ZIP/postal code to auto-fill street, city, state, and country, or send the full address)";
}

std::string buildCollectedFieldsSummary_(
    const nlohmann::json& camera,
    const nlohmann::json& fieldSources,
    const std::string& language)
{
    if (!fieldSources.is_object() || fieldSources.empty()) {
        return "";
    }

    std::vector<std::string> labels;
    const std::vector<std::string> orderedFields = {
        "name",
        "ip_address",
        "manufacturer",
        "username",
    };

    for (const auto& field : orderedFields) {
        if (!hasCameraValue_(camera, field.c_str())) {
            continue;
        }
        if (!isUserProvidedFieldSource_(cameraFieldSource_(fieldSources, field))) {
            continue;
        }
        labels.push_back(labelForField_(field, language));
    }

    if (labels.empty()) {
        return "";
    }

    std::ostringstream out;
    if (language == "pt") {
        out << "Ja tenho: ";
    }
    else if (language == "es") {
        out << "Ya tengo: ";
    }
    else if (language == "fr") {
        out << "J'ai deja: ";
    }
    else {
        out << "I already have: ";
    }

    for (std::size_t i = 0; i < labels.size(); ++i) {
        if (i > 0) {
            out << ", ";
        }
        out << labels[i];
    }
    out << ".";
    return out.str();
}

std::string buildMissingFieldsAnswer_(
    const nlohmann::json& camera,
    const nlohmann::json& fieldSources,
    const std::vector<std::string>& missingFields,
    const std::string& language)
{
    std::ostringstream out;
    if (language == "pt") {
        out << "Para cadastrar essa camera, ainda preciso de:\n";
    }
    else if (language == "es") {
        out << "Para registrar esa camara, todavia necesito:\n";
    }
    else if (language == "fr") {
        out << "Pour creer cette camera, il me faut encore :\n";
    }
    else {
        out << "To create this camera, I still need:\n";
    }

    const std::string addressPrompt = buildAddressFieldPrompt_(missingFields, language);
    if (!addressPrompt.empty()) {
        out << "- " << addressPrompt << "\n";
    }

    for (const auto& field : missingFields) {
        if (field == "street" ||
            field == "number" ||
            field == "city" ||
            field == "state" ||
            field == "zip_code" ||
            field == "country") {
            continue;
        }
        out << "- " << labelForField_(field, language);
        if (field == "manufacturer") {
            if (language == "pt") {
                out << " (se nao souber, pode enviar Generic)";
            }
            else if (language == "es") {
                out << " (si no lo sabes, puedes enviar Generic)";
            }
            else if (language == "fr") {
                out << " (si vous ne savez pas, vous pouvez envoyer Generic)";
            }
            else {
                out << " (if you do not know it, you can send Generic)";
            }
        }
        if (field == "webcam_index") {
            if (language == "pt") {
                out << " (geralmente 0, 1, 2...)";
            }
            else if (language == "es") {
                out << " (normalmente 0, 1, 2...)";
            }
            else if (language == "fr") {
                out << " (souvent 0, 1, 2...)";
            }
            else {
                out << " (usually 0, 1, 2...)";
            }
        }
        out << "\n";
    }

    const std::string collectedSummary = buildCollectedFieldsSummary_(camera, fieldSources, language);
    if (!collectedSummary.empty()) {
        out << "\n" << collectedSummary << "\n";
    }

    if (language == "pt") {
        out << "\nPode me responder tudo em uma unica mensagem, por exemplo:\n";
        out << "nome Recepcao; ip 192.168.0.50; porta 554; fabricante Hikvision; usuario admin; senha 123456; cep 01310100; numero do endereco 100\n";
    }
    else if (language == "es") {
        out << "\nPuedes responderme todo en un solo mensaje, por ejemplo:\n";
        out << "nombre Recepcion; ip 192.168.0.50; puerto 554; fabricante Hikvision; usuario admin; contrasena 123456; codigo postal 28013; numero de la direccion 10\n";
    }
    else if (language == "fr") {
        out << "\nVous pouvez tout m'envoyer en un seul message, par exemple :\n";
        out << "nom Reception; ip 192.168.0.50; port 554; fabricant Hikvision; utilisateur admin; mot de passe 123456; code postal 75001; numero de l'adresse 10\n";
    }
    else {
        out << "\nYou can send everything in one message, for example:\n";
        out << "name Front Desk; ip 192.168.0.50; port 554; manufacturer Hikvision; username admin; password 123456; zip code 10001; address number 10\n";
    }

    return trimCopy_(out.str());
}

std::string buildConfirmationAnswer_(
    const nlohmann::json& cameraDraft,
    const std::string& language)
{
    const std::string cameraName = jsonStringField_(cameraDraft, "name");
    const std::string method = normalizeConnectionMethod_(cameraDraft);

    std::ostringstream out;
    if (language == "pt") {
        out << "Revise os campos abaixo antes de registrar a camera.";
        if (!cameraName.empty()) {
            out << "\nNome: " << cameraName;
        }
        out << "\nMetodo: " << method;
        out << "\nVoce pode editar qualquer parametro aqui no chat e clicar em Registrar quando estiver tudo certo.";
    }
    else if (language == "es") {
        out << "Revisa los campos de abajo antes de registrar la camara.";
        if (!cameraName.empty()) {
            out << "\nNombre: " << cameraName;
        }
        out << "\nMetodo: " << method;
        out << "\nPuedes editar cualquier parametro aqui en el chat y hacer clic en Registrar cuando todo este correcto.";
    }
    else if (language == "fr") {
        out << "Verifiez les champs ci-dessous avant d'enregistrer la camera.";
        if (!cameraName.empty()) {
            out << "\nNom : " << cameraName;
        }
        out << "\nMethode : " << method;
        out << "\nVous pouvez modifier chaque parametre ici dans le chat puis cliquer sur Enregistrer quand tout est correct.";
    }
    else {
        out << "Review the fields below before registering the camera.";
        if (!cameraName.empty()) {
            out << "\nName: " << cameraName;
        }
        out << "\nMethod: " << method;
        out << "\nYou can edit any parameter here in chat and click Register when everything looks right.";
    }
    return out.str();
}

std::string buildCreationSuccessAnswer_(
    const nlohmann::json& createdCamera,
    const std::string& language)
{
    const std::string cameraName = jsonStringField_(createdCamera, "name");
    const std::string method = normalizeConnectionMethod_(createdCamera);
    const std::string ipAddress = jsonStringField_(createdCamera, "ip_address");

    std::ostringstream out;
    if (language == "pt") {
        out << "Camera \"" << cameraName << "\" criada com sucesso.";
        out << "\nMetodo: " << method;
        if (!ipAddress.empty()) {
            out << "\nIP/host: " << ipAddress;
        }
        out << "\nSe quiser, agora eu posso te ajudar a iniciar essa camera ou criar um agente nela.";
    }
    else if (language == "es") {
        out << "La camara \"" << cameraName << "\" fue creada correctamente.";
        out << "\nMetodo: " << method;
        if (!ipAddress.empty()) {
            out << "\nIP/host: " << ipAddress;
        }
        out << "\nSi quieres, ahora puedo ayudarte a iniciar esta camara o crear un agente en ella.";
    }
    else if (language == "fr") {
        out << "La camera \"" << cameraName << "\" a ete creee avec succes.";
        out << "\nMethode : " << method;
        if (!ipAddress.empty()) {
            out << "\nIP/hote : " << ipAddress;
        }
        out << "\nSi vous voulez, je peux maintenant vous aider a demarrer cette camera ou a creer un agent dessus.";
    }
    else {
        out << "Camera \"" << cameraName << "\" was created successfully.";
        out << "\nMethod: " << method;
        if (!ipAddress.empty()) {
            out << "\nIP/host: " << ipAddress;
        }
        out << "\nIf you want, I can now help you start this camera or create an agent on it.";
    }
    return out.str();
}

std::string buildCreationFailureAnswer_(
    const std::string& language,
    const std::string& detail)
{
    if (language == "pt") {
        return detail.empty()
            ? "Nao consegui criar a camera agora. Tente novamente em instantes."
            : "Nao consegui criar a camera agora. Detalhe: " + detail;
    }
    if (language == "es") {
        return detail.empty()
            ? "No pude crear la camara ahora. Vuelve a intentarlo en unos instantes."
            : "No pude crear la camara ahora. Detalle: " + detail;
    }
    if (language == "fr") {
        return detail.empty()
            ? "Je n'ai pas pu creer la camera maintenant. Reessayez dans un instant."
            : "Je n'ai pas pu creer la camera maintenant. Detail : " + detail;
    }
    return detail.empty()
        ? "I could not create the camera right now. Please try again in a moment."
        : "I could not create the camera right now. Detail: " + detail;
}

std::string clientIdFromPayload_(const nlohmann::json& payload)
{
    if (!payload.is_object() || !payload.contains("client_id") || !payload["client_id"].is_string()) {
        return "";
    }
    return trimCopy_(payload["client_id"].get<std::string>());
}

nlohmann::json lookupAddressDraftViaAgentEndpoint_(
    AgentCore& agent,
    const nlohmann::json& payload,
    const nlohmann::json& cameraDraft)
{
    const std::string zipCode = jsonStringField_(cameraDraft, "zip_code");
    if (zipCode.empty()) {
        return nlohmann::json::object();
    }

    const bool needsLookup =
        !hasCameraValue_(cameraDraft, "street") ||
        !hasCameraValue_(cameraDraft, "city") ||
        !hasCameraValue_(cameraDraft, "state") ||
        !hasCameraValue_(cameraDraft, "country");
    if (!needsLookup) {
        return nlohmann::json::object();
    }

    nlohmann::json requestBody = {
        { "postal_code", zipCode },
    };
    const std::string country = jsonStringField_(cameraDraft, "country");
    if (!country.empty()) {
        requestBody["country"] = country;
    }

    const std::string clientId = clientIdFromPayload_(payload).empty()
        ? agent.getClientId()
        : clientIdFromPayload_(payload);
    const std::string url =
        agent.getBackendBaseUrl() + "/api/agent/address-lookup?client_id=" + clientId;
    const HttpResponse response = postJson(
        url,
        requestBody.dump(),
        agent.getExeToken(),
        {},
        4500);
    if (!response.ok()) {
        return nlohmann::json::object();
    }

    const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
    if (!parsed.is_object() || !parsed.value("found", false)) {
        return nlohmann::json::object();
    }

    nlohmann::json normalized = nlohmann::json::object();
    const std::vector<std::pair<const char*, const char*>> fields = {
        { "postal_code", "zip_code" },
        { "street", "street" },
        { "city", "city" },
        { "state", "state" },
        { "country", "country" },
    };
    for (const auto& field : fields) {
        const std::string value = jsonStringField_(parsed, field.first);
        if (!value.empty()) {
            normalized[field.second] = value;
        }
    }
    return normalized;
}

nlohmann::json confirmationDefaultsPatch_(const nlohmann::json& cameraDraft)
{
    nlohmann::json patch = assumedRtspPortPatch_(cameraDraft);
    if (!hasCameraValue_(cameraDraft, "retention_days")) {
        patch["retention_days"] = 1;
    }
    if (!hasCameraValue_(cameraDraft, "allowpublicaccess")) {
        patch["allowpublicaccess"] = false;
    }
    return patch;
}

std::vector<std::string> fieldsWithSource_(
    const nlohmann::json& fieldSources,
    const std::string& source)
{
    std::vector<std::string> fields;
    const std::string normalizedSource = normalizeCameraFieldSource_(source);
    if (normalizedSource.empty() || !fieldSources.is_object()) {
        return fields;
    }

    for (const auto& field : cameraFieldNames_()) {
        if (cameraFieldSource_(fieldSources, field) == normalizedSource) {
            fields.push_back(field);
        }
    }
    return fields;
}

nlohmann::json defaultsForConfirmationDraft_(const nlohmann::json& cameraDraft)
{
    nlohmann::json normalized = applyAssumedRtspPort_(normalizeCameraFields_(cameraDraft, true));
    if (!normalized.contains("retention_days")) {
        normalized["retention_days"] = 1;
    }
    if (!normalized.contains("allowpublicaccess")) {
        normalized["allowpublicaccess"] = false;
    }
    return normalized;
}

nlohmann::json buildCameraRegistrationWidgetMetadata_(
    const nlohmann::json& cameraDraft,
    const nlohmann::json& fieldSources,
    const std::string& language,
    const std::string& targetClientId)
{
    return nlohmann::json::object({
        { "type", "camera_registration_draft" },
        { "status", "awaiting_confirmation" },
        { "language", normalizeAssistantLanguageTag(language) },
        { "draft", cameraDraft },
        { "field_sources", normalizeCameraFieldSources_(fieldSources) },
        { "defaulted_fields", fieldsWithSource_(fieldSources, "system_default") },
        { "enriched_fields", fieldsWithSource_(fieldSources, "address_lookup") },
        { "target_client_id", targetClientId },
    });
}

nlohmann::json loadConversationContext_(
    AgentCore& agent,
    const nlohmann::json& payload)
{
    nlohmann::json fallback = {
        { "compact_context", nlohmann::json::object() },
        { "task_state", defaultTaskState_() },
        { "recent_turns", nlohmann::json::array() },
    };

    if (!payload.is_object()) {
        return fallback;
    }

    const int chatSessionId = payload.value("chat_session_id", -1);
    if (chatSessionId <= 0) {
        return fallback;
    }

    const int beforeMessageId = payload.value("context_before_message_id", 0);
    std::ostringstream url;
    url
        << agent.getBackendBaseUrl()
        << "/api/agent/chat-context?client_id=" << agent.getClientId()
        << "&chat_session_id=" << chatSessionId;
    if (beforeMessageId > 0) {
        url << "&before_message_id=" << beforeMessageId;
    }

    const HttpResponse response = getUrl(
        url.str(),
        agent.getExeToken(),
        {},
        3500);
    if (!response.ok()) {
        return fallback;
    }

    const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
    if (!parsed.is_object()) {
        return fallback;
    }
    return parsed;
}

void configureActionModelClient_(LocalLlmClient& llm, const nlohmann::json& payload)
{
    const LocalLlmClient::Config config = buildChatModelClientConfigFromPayload(payload, false);
    if (config.enabled) {
        llm.setRequestOverride(config);
    }
}

nlohmann::json extractCameraDraft_(
    const LocalLlmClient& llm,
    const nlohmann::json& payload,
    const nlohmann::json& conversationContext,
    const SkillSelection& selection)
{
    if (!llm.isConfigured()) {
        return nlohmann::json::object();
    }

    const std::string userMessage =
        payload.is_object() ? payload.value("query", std::string()) : std::string();
    const std::string replyLanguage = effectiveReplyLanguage_(selection, payload, conversationContext);

    const std::string systemPrompt =
        "/no_think\n"
        "You extract camera-creation fields for the app.\n"
        "Merge the current user message with recent_turns and compact_context from the same chat session.\n"
        "conversation_task_state may include an active create_camera draft from earlier turns.\n"
        "If conversation_task_state.active_task.type is create_camera, treat its draft and missing_fields as the current state unless the user clearly corrects a value.\n"
        "This is a slot-filling task for camera creation. The latest assistant turn may be asking for missing fields.\n"
        "Short follow-up replies such as numbers, IPs, usernames, passwords, yes/no answers, or manufacturer names can fill the missing slots.\n"
        "Do not treat example values written by the assistant as real user-provided values.\n"
        "If assistant messages contain templates or examples, ignore those values unless the user later repeats or confirms them.\n"
        "Only include values that were explicitly provided by the user or are strongly implied by the conversation.\n"
        "Do not invent credentials, IPs, ports, names, or camera details.\n"
        "Do not reuse ordinary conversational filler words as field values.\n"
        "Return a sparse camera_patch: only include fields that the user actually provided or that are strongly implied.\n"
        "Never emit placeholder values, schema defaults, 0, false, or empty strings for omitted fields.\n"
        "When multiple labeled fields appear in one line without commas or semicolons, split each value semantically at the next field label.\n"
        "Do not let one field absorb later labeled fields.\n"
        "If the user mentions a webcam, USB camera, notebook camera, or integrated camera, include connection_method=\"WEBCAM\".\n"
        "If the user clearly says RTSP, HTTP, or ONVIF, include that connection_method.\n"
        "If the user provides an RTSP URL, parse host/IP, port, username, and password when present.\n"
        "The user may send a CEP, ZIP code, or postal code instead of a full address. Capture zip_code when present.\n"
        "If the user sends a free-form address, map it into street, number, city, state, zip_code, and country when possible.\n"
        "Retain channel, subtype, description, retention_days, allowpublicaccess, and webcam_index when the user provided them.\n"
        "The UI may describe allowpublicaccess as collaborator sharing, shared access, or inviting collaborators. Map those requests to allowpublicaccess only when the user clearly wants to enable that option.\n"
        "retention_days must only be one of: 1, 3, 7, 15, 30, 90, 180. If the user gave another value, omit it.\n"
        "allowpublicaccess must be a boolean when present.\n"
        "field_sources must only use these values: explicit_user, implied_user.\n"
        "Use explicit_user when the user directly states or confirms the value.\n"
        "Use implied_user only when the value is strongly implied from the user's message or immediate create_camera context.\n"
        "field_sources keys must be a subset of camera_patch keys.\n"
        "Return JSON only with this shape:\n"
        "{"
        "\"camera_patch\":{"
        "\"only_the_fields_the_user_actually_provided_or_strongly_implied\":\"value\""
        "},"
        "\"field_sources\":{"
        "\"matching_field_name\":\"explicit_user\""
        "}"
        "}\n"
        "Valid camera_patch keys are: name, connection_method, ip_address, rtsp_port, manufacturer, username, password, channel, subtype, description, street, number, city, state, zip_code, country, retention_days, webcam_index, allowpublicaccess.\n"
        "camera_patch may be empty. Omit any field the user did not provide.\n"
        "Example: user_message=\"cep 22793071 nome camera_quarto_2 ip 192.168.1.65 fabricante hikvision usuario admin senha 12345678\" => "
        "{\"camera_patch\":{\"zip_code\":\"22793071\",\"name\":\"camera_quarto_2\",\"ip_address\":\"192.168.1.65\",\"manufacturer\":\"Hikvision\",\"username\":\"admin\",\"password\":\"12345678\"},"
        "\"field_sources\":{\"zip_code\":\"explicit_user\",\"name\":\"explicit_user\",\"ip_address\":\"explicit_user\",\"manufacturer\":\"explicit_user\",\"username\":\"explicit_user\",\"password\":\"explicit_user\"}}\n";

    nlohmann::json promptPayload = {
        { "reply_language", replyLanguage },
        { "app_language", payload.is_object() ? payload.value("app_language", std::string("en")) : std::string("en") },
        { "compact_context", conversationContext.value("compact_context", nlohmann::json::object()) },
        { "conversation_task_state", conversationContext.value("task_state", defaultTaskState_()) },
        { "recent_turns", conversationContext.value("recent_turns", nlohmann::json::array()) },
        { "user_message", userMessage },
    };

    const auto outcome = llm.completeText(
        "extractCameraDraft",
        systemPrompt,
        promptPayload.dump(2),
        0.0,
        900,
        15000,
        1,
        true);

    if (!outcome.ok || trimCopy_(outcome.content).empty()) {
        return nlohmann::json::object();
    }

    const nlohmann::json parsed = nlohmann::json::parse(outcome.content, nullptr, false);
    if (!parsed.is_object()) {
        return buildCameraPatchEnvelope_(
            nlohmann::json::object(),
            nlohmann::json::object());
    }
    return parsed;
}

nlohmann::json normalizeCameraFields_(
    const nlohmann::json& camera,
    bool defaultConnectionMethod)
{
    nlohmann::json normalized = nlohmann::json::object();
    const std::vector<const char*> stringFields = {
        "name",
        "ip_address",
        "rtsp_port",
        "manufacturer",
        "username",
        "password",
        "channel",
        "subtype",
        "description",
        "street",
        "number",
        "city",
        "state",
        "zip_code",
        "country",
    };
    for (const auto* field : stringFields) {
        const std::string value = jsonStringField_(camera, field);
        if (!value.empty()) {
            normalized[field] = value;
        }
    }

    int retentionDays = 0;
    if (tryJsonIntField_(camera, "retention_days", retentionDays) &&
        (retentionDays == 1 ||
         retentionDays == 3 ||
         retentionDays == 7 ||
         retentionDays == 15 ||
         retentionDays == 30 ||
         retentionDays == 90 ||
         retentionDays == 180)) {
        normalized["retention_days"] = retentionDays;
    }

    int webcamIndex = 0;
    if (tryJsonIntField_(camera, "webcam_index", webcamIndex) && webcamIndex >= 0) {
        normalized["webcam_index"] = webcamIndex;
    }

    bool allowPublicAccess = false;
    if (camera.contains("allowpublicaccess") && parseBoolLoose_(camera["allowpublicaccess"], allowPublicAccess)) {
        normalized["allowpublicaccess"] = allowPublicAccess;
    }

    if (camera.is_object() &&
        camera.contains("connection_method") &&
        hasCameraValue_(camera, "connection_method")) {
        normalized["connection_method"] = normalizeConnectionMethod_(camera);
    }
    else if (defaultConnectionMethod && (!normalized.empty() || hasAnyCameraFieldValue_(camera))) {
        normalized["connection_method"] = "RTSP";
    }

    return normalized;
}

nlohmann::json normalizeCameraExtractionResult_(const nlohmann::json& extracted)
{
    nlohmann::json rawPatch = nlohmann::json::object();
    if (extracted.is_object() &&
        extracted.contains("camera_patch") &&
        extracted["camera_patch"].is_object()) {
        rawPatch = extracted["camera_patch"];
    }
    else if (extracted.is_object() &&
             extracted.contains("camera") &&
             extracted["camera"].is_object()) {
        rawPatch = extracted["camera"];
    }

    const nlohmann::json patch =
        normalizeCameraFields_(refineStructuredCameraPatch_(rawPatch), false);
    nlohmann::json fieldSources =
        extracted.is_object()
            ? normalizeCameraFieldSources_(extracted.value("field_sources", nlohmann::json::object()))
            : nlohmann::json::object();

    for (auto it = fieldSources.begin(); it != fieldSources.end();) {
        if (!patch.contains(it.key())) {
            it = fieldSources.erase(it);
            continue;
        }
        ++it;
    }

    for (auto it = patch.begin(); it != patch.end(); ++it) {
        if (cameraFieldSource_(fieldSources, it.key()).empty()) {
            setCameraFieldSource_(fieldSources, it.key(), "implied_user");
        }
    }

    return buildCameraPatchEnvelope_(patch, fieldSources);
}

nlohmann::json activeCreateCameraDraft_(const nlohmann::json& conversationContext)
{
    const nlohmann::json taskState = taskStateFromConversation_(conversationContext);
    if (!taskState.contains("active_task") || !taskState["active_task"].is_object()) {
        return nlohmann::json::object();
    }

    const auto& activeTask = taskState["active_task"];
    if (jsonStringField_(activeTask, "type") != "create_camera" ||
        !activeTask.contains("draft") ||
        !activeTask["draft"].is_object()) {
        return nlohmann::json::object();
    }

    return normalizeCameraFields_(activeTask["draft"], false);
}

nlohmann::json activeCreateCameraFieldSources_(const nlohmann::json& conversationContext)
{
    const nlohmann::json taskState = taskStateFromConversation_(conversationContext);
    if (!taskState.contains("active_task") || !taskState["active_task"].is_object()) {
        return nlohmann::json::object();
    }

    const auto& activeTask = taskState["active_task"];
    if (jsonStringField_(activeTask, "type") != "create_camera") {
        return nlohmann::json::object();
    }

    nlohmann::json fieldSources =
        activeTask.contains("field_sources")
            ? normalizeCameraFieldSources_(activeTask["field_sources"])
            : nlohmann::json::object();

    if (!fieldSources.empty()) {
        return fieldSources;
    }

    if (!activeTask.contains("draft") || !activeTask["draft"].is_object()) {
        return nlohmann::json::object();
    }

    return buildFieldSourcesForPatch_(
        normalizeCameraFields_(activeTask["draft"], false),
        "implied_user");
}

nlohmann::json mergeCameraDrafts_(
    const nlohmann::json& existingDraft,
    const nlohmann::json& newDraft)
{
    nlohmann::json merged = existingDraft.is_object()
        ? existingDraft
        : nlohmann::json::object();

    if (newDraft.is_object()) {
        for (auto it = newDraft.begin(); it != newDraft.end(); ++it) {
            merged[it.key()] = it.value();
        }
    }

    if (!merged.contains("connection_method") || !hasCameraValue_(merged, "connection_method")) {
        merged["connection_method"] = "RTSP";
    }
    else {
        merged["connection_method"] = normalizeConnectionMethod_(merged);
    }

    return merged;
}

std::vector<std::string> collectedFields_(const nlohmann::json& camera)
{
    std::vector<std::string> collected;
    const std::vector<std::string> orderedFields = {
        "name",
        "connection_method",
        "ip_address",
        "rtsp_port",
        "manufacturer",
        "username",
        "password",
        "channel",
        "subtype",
        "description",
        "street",
        "number",
        "city",
        "state",
        "zip_code",
        "country",
        "retention_days",
        "webcam_index",
        "allowpublicaccess",
    };

    for (const auto& field : orderedFields) {
        if (hasCameraValue_(camera, field.c_str())) {
            collected.push_back(field);
        }
    }

    return collected;
}

nlohmann::json mergeRecentTasks_(
    const nlohmann::json& taskState,
    const nlohmann::json& newestTask)
{
    nlohmann::json recentTasks = nlohmann::json::array();
    if (newestTask.is_object()) {
        recentTasks.push_back(newestTask);
    }

    if (taskState.is_object() &&
        taskState.contains("recent_tasks") &&
        taskState["recent_tasks"].is_array()) {
        for (const auto& item : taskState["recent_tasks"]) {
            if (!item.is_object()) {
                continue;
            }
            if (recentTasks.size() >= 4) {
                break;
            }
            recentTasks.push_back(item);
        }
    }

    return recentTasks;
}

std::string createCameraTaskSummary_(
    const nlohmann::json& cameraDraft,
    const std::vector<std::string>& missingFields,
    bool completed)
{
    const std::string name = jsonStringField_(cameraDraft, "name");
    const std::string method = normalizeConnectionMethod_(cameraDraft);

    if (completed) {
        if (!name.empty()) {
            return "Created camera " + name;
        }
        return "Created camera";
    }

    std::ostringstream out;
    out << "Collecting camera fields";
    if (!name.empty()) {
        out << " for " << name;
    }
    out << " (" << missingFields.size() << " missing, method " << method << ")";
    return out.str();
}

std::string createCameraTaskGoal_(const nlohmann::json& cameraDraft)
{
    const std::string name = jsonStringField_(cameraDraft, "name");
    if (!name.empty()) {
        return "register camera " + name;
    }
    return "register camera";
}

nlohmann::json buildTaskStateForCreateCameraCollection_(
    const nlohmann::json& conversationContext,
    const nlohmann::json& cameraDraft,
    const nlohmann::json& fieldSources,
    const std::vector<std::string>& missingFields,
    const std::string& answerPreview,
    const std::string& language)
{
    return upsertActiveOperationTask(
        conversationContext,
        OperationTaskDescriptor{
            "create_camera",
            "camera",
            "create",
            "collecting_input",
            "awaiting_missing_fields",
            normalizeAssistantLanguageTag(language),
            createCameraTaskGoal_(cameraDraft),
            createCameraTaskSummary_(cameraDraft, missingFields, false),
            trimCopy_(answerPreview),
            missingFields,
            collectedFields_(cameraDraft),
            cameraDraft,
            normalizeCameraFieldSources_(fieldSources),
            nlohmann::json::object(),
        });
}

nlohmann::json buildTaskStateForCreateCameraAwaitingConfirmation_(
    const nlohmann::json& conversationContext,
    const nlohmann::json& cameraDraft,
    const nlohmann::json& fieldSources,
    const std::string& answerPreview,
    const std::string& language)
{
    const std::string name = jsonStringField_(cameraDraft, "name");
    return upsertActiveOperationTask(
        conversationContext,
        OperationTaskDescriptor{
            "create_camera",
            "camera",
            "create",
            "awaiting_confirmation",
            "awaiting_user_confirmation",
            normalizeAssistantLanguageTag(language),
            createCameraTaskGoal_(cameraDraft),
            name.empty() ? "Ready to register camera" : "Ready to register camera " + name,
            trimCopy_(answerPreview),
            {},
            collectedFields_(cameraDraft),
            cameraDraft,
            normalizeCameraFieldSources_(fieldSources),
            nlohmann::json::object({
                { "type", "camera_registration_draft" },
                { "status", "awaiting_confirmation" },
                { "editable", true },
            }),
        });
}

nlohmann::json buildTaskStateForCreateCameraBlocked_(
    const nlohmann::json& conversationContext,
    const nlohmann::json& cameraDraft,
    const nlohmann::json& fieldSources,
    const std::string& answerPreview,
    const std::string& language)
{
    const std::vector<std::string> missingFields = computeMissingFields_(cameraDraft);
    nlohmann::json taskState = buildTaskStateForCreateCameraCollection_(
        conversationContext,
        cameraDraft,
        fieldSources,
        missingFields,
        answerPreview,
        language);
    if (taskState.contains("active_task") && taskState["active_task"].is_object()) {
        taskState["active_task"]["status"] = "blocked";
        taskState["active_task"]["phase"] = "creation_failed";
    }
    return taskState;
}

nlohmann::json buildTaskStateForCreateCameraSuccess_(
    const nlohmann::json& conversationContext,
    const nlohmann::json& createdCamera,
    const nlohmann::json& fieldSources,
    const std::string& language)
{
    const nlohmann::json normalizedCreated = normalizeCameraFields_(createdCamera, true);
    return completeOperationTask(
        conversationContext,
        OperationTaskDescriptor{
            "create_camera",
            "camera",
            "create",
            "completed",
            "created",
            normalizeAssistantLanguageTag(language),
            createCameraTaskGoal_(normalizedCreated),
            createCameraTaskSummary_(normalizedCreated, {}, true),
            "",
            {},
            collectedFields_(normalizedCreated),
            normalizedCreated,
            normalizeCameraFieldSources_(fieldSources),
            nlohmann::json::object(),
        });
}

HttpResponse createCameraViaAgentEndpoint_(
    AgentCore& agent,
    const nlohmann::json& body)
{
    const std::string url =
        agent.getBackendBaseUrl() + "/api/agent/cameras?client_id=" + agent.getClientId();
    return postJson(
        url,
        body.dump(),
        agent.getExeToken(),
        {},
        12000);
}

} // namespace

SkillDefinition CreateCameraSkill::definition() const
{
    return SkillDefinition{
        "create_camera",
        "Creates cameras using the existing backend camera endpoints.",
        true,
    };
}

SkillRunResult CreateCameraSkill::execute(
    AgentCore& agent,
    const nlohmann::json& payload,
    const SkillSelection& selection)
{
    SkillRunResult result;
    result.skillName = "create_camera";
    result.metadata["skip_polish"] = true;

    const nlohmann::json conversationContext = loadConversationContext_(agent, payload);
    const std::string replyLanguage = effectiveReplyLanguage_(selection, payload, conversationContext);
    const std::string userMessage =
        payload.is_object() ? payload.value("query", std::string()) : std::string();
    const nlohmann::json existingDraft = activeCreateCameraDraft_(conversationContext);
    nlohmann::json cameraFieldSources = activeCreateCameraFieldSources_(conversationContext);
    const nlohmann::json routerDraftPatch =
        normalizeCameraFields_(refineStructuredCameraPatch_(selection.draftPatch), false);
    LocalLlmClient llm;
    configureActionModelClient_(llm, payload);
    const nlohmann::json extractedDraft =
        sanitizeExtractedCameraDraft_(
            normalizeCameraExtractionResult_(extractCameraDraft_(llm, payload, conversationContext, selection)),
            userMessage,
            existingDraft,
            conversationContext);
    const nlohmann::json deterministicDraft =
        deterministicCameraDraft_(
            userMessage,
            existingDraft,
            conversationContext);
    nlohmann::json cameraDraft =
        existingDraft.is_object() ? existingDraft : nlohmann::json::object();
    mergeCameraPatchIntoDraft_(
        cameraDraft,
        cameraFieldSources,
        routerDraftPatch,
        buildFieldSourcesForPatch_(routerDraftPatch, "implied_user"),
        "implied_user");
    mergeCameraPatchIntoDraft_(
        cameraDraft,
        cameraFieldSources,
        extractionCameraPatch_(extractedDraft),
        extractionFieldSources_(extractedDraft));
    mergeCameraPatchIntoDraft_(
        cameraDraft,
        cameraFieldSources,
        extractionCameraPatch_(deterministicDraft),
        extractionFieldSources_(deterministicDraft));

    const nlohmann::json addressPatch =
        normalizeCameraFields_(lookupAddressDraftViaAgentEndpoint_(agent, payload, cameraDraft), false);
    mergeCameraPatchIntoDraft_(
        cameraDraft,
        cameraFieldSources,
        addressPatch,
        buildFieldSourcesForPatch_(addressPatch, "address_lookup"),
        "address_lookup");

    const nlohmann::json assumedPortPatch = assumedRtspPortPatch_(cameraDraft);
    mergeCameraPatchIntoDraft_(
        cameraDraft,
        cameraFieldSources,
        assumedPortPatch,
        buildFieldSourcesForPatch_(assumedPortPatch, "system_default"),
        "system_default");

    const std::vector<std::string> missingFields = computeMissingFields_(cameraDraft);
    if (!missingFields.empty()) {
        result.status = SkillExecutionStatus::Completed;
        result.answer = buildMissingFieldsAnswer_(cameraDraft, cameraFieldSources, missingFields, replyLanguage);
        result.metadata["field_sources"] = normalizeCameraFieldSources_(cameraFieldSources);
        result.metadata["task_state"] = buildTaskStateForCreateCameraCollection_(
            conversationContext,
            cameraDraft,
            cameraFieldSources,
            missingFields,
            result.answer,
            replyLanguage);
        return result;
    }

    result.status = SkillExecutionStatus::Completed;
    nlohmann::json confirmationDraft = defaultsForConfirmationDraft_(cameraDraft);
    nlohmann::json confirmationFieldSources = cameraFieldSources;
    const nlohmann::json confirmationDefaults = confirmationDefaultsPatch_(cameraDraft);
    mergeCameraPatchIntoDraft_(
        confirmationDraft,
        confirmationFieldSources,
        confirmationDefaults,
        buildFieldSourcesForPatch_(confirmationDefaults, "system_default"),
        "system_default");
    result.answer = buildConfirmationAnswer_(confirmationDraft, replyLanguage);
    result.metadata["field_sources"] = normalizeCameraFieldSources_(confirmationFieldSources);
    result.metadata["message_metadata"] = buildCameraRegistrationWidgetMetadata_(
        confirmationDraft,
        confirmationFieldSources,
        replyLanguage,
        agent.getClientId());
    result.metadata["task_state"] = buildTaskStateForCreateCameraAwaitingConfirmation_(
        conversationContext,
        confirmationDraft,
        confirmationFieldSources,
        result.answer,
        replyLanguage);
    return result;
}

} // namespace chatv2

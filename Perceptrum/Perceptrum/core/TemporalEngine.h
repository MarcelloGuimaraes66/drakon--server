#pragma once

#include <algorithm>
#include <array>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <ctime>
#include <iomanip>
#include <initializer_list>
#include <sstream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include <nlohmann/json.hpp>

#include "TemporalEvidence.h"

namespace temporal {

using json = nlohmann::json;

inline std::string extractZoneField(const json& node, const std::string& fallback = std::string());
inline std::string extractObservedZoneField(const json& node, const std::string& fallback = std::string());
inline json effectivePlan(const json& envelope);
inline bool validateCompilerDecisionConsistency(const json& envelope, std::string* outReason = nullptr);
inline json parseTraitsValue(const json& value);
inline void appendUniqueStringsToArray(json& target, const json& value);

inline std::string trim(const std::string& s) {
    const auto a = s.find_first_not_of(" \t\r\n");
    if (a == std::string::npos) return std::string();
    const auto b = s.find_last_not_of(" \t\r\n");
    return s.substr(a, b - a + 1);
}

inline std::string lower(std::string s) {
    for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

inline bool containsAnySubstring(
    const std::string& haystack,
    std::initializer_list<const char*> needles)
{
    for (const char* needle : needles) {
        if (needle != nullptr && *needle != '\0' && haystack.find(needle) != std::string::npos) {
            return true;
        }
    }
    return false;
}

inline std::vector<std::string> extractWordTokens(const std::string& raw) {
    std::vector<std::string> tokens;
    std::string current;
    current.reserve(raw.size());
    for (unsigned char ch : raw) {
        if (std::isalnum(ch)) {
            current.push_back(static_cast<char>(std::tolower(ch)));
        } else if (!current.empty()) {
            tokens.push_back(current);
            current.clear();
        }
    }
    if (!current.empty()) {
        tokens.push_back(current);
    }
    return tokens;
}

inline bool tokenListContainsAny(
    const std::vector<std::string>& tokens,
    std::initializer_list<const char*> needles)
{
    for (const std::string& token : tokens) {
        for (const char* needle : needles) {
            if (needle != nullptr && token == needle) {
                return true;
            }
        }
    }
    return false;
}

inline bool entityTypeSuggestsVehicleIdentity(const std::string& rawEntityType) {
    const std::string s = lower(trim(rawEntityType));
    return containsAnySubstring(
        s,
        {
            "vehicle", "car", "sedan", "suv", "truck", "pickup", "van", "bus",
            "taxi", "motorcycle", "motorbike", "bike", "bicycle", "plate",
            "placa", "trailer", "boat"
        });
}

inline bool entityTypeSuggestsPersonIdentity(const std::string& rawEntityType) {
    const std::string s = lower(trim(rawEntityType));
    return containsAnySubstring(
        s,
        {
            "person", "people", "man", "woman", "male", "female", "human",
            "pedestrian", "suspect", "intruder", "worker", "customer",
            "passenger", "driver", "rider", "face", "armed"
        });
}

inline bool traitLooksLikeSceneOrBackgroundContext(const std::string& rawTrait) {
    const std::string s = lower(trim(rawTrait));
    if (s.empty()) return false;
    if (containsAnySubstring(
            s,
            {
                "background", "scene", "room", "office", "bedroom", "kitchen",
                "bathroom", "garage", "hallway", "corridor", "warehouse",
                "store", "shop", "street", "road", "parking", "sidewalk",
                "yard", "garden", "door", "window", "wall", "floor",
                "ceiling", "desk", "table", "chair", "sofa", "bed",
                "cabinet", "wardrobe", "closet", "shelf", "indoor",
                "outdoor", "indoors", "outdoors", "lighting", "shadow",
                "sunlight", "backdrop", "background blur", "camera angle"
            }))
    {
        return true;
    }
    const std::vector<std::string> tokens = extractWordTokens(s);
    return tokenListContainsAny(
        tokens,
        {
            "background", "scene", "room", "office", "bedroom", "kitchen",
            "bathroom", "garage", "hallway", "corridor", "warehouse",
            "store", "shop", "street", "road", "parking", "sidewalk",
            "yard", "garden", "door", "window", "wall", "floor",
            "ceiling", "desk", "table", "chair", "sofa", "bed",
            "cabinet", "wardrobe", "closet", "shelf", "indoor",
            "outdoor", "lighting", "shadow"
        });
}

inline bool traitLooksLikeTransientIdentityContext(const std::string& rawTrait) {
    const std::string s = lower(trim(rawTrait));
    if (s.empty()) return false;
    if (containsAnySubstring(
            s,
            {
                "occluded", "partial", "partially", "blur", "blurry",
                "motion blur", "cropped", "cut off", "far away", "distant",
                "profile view", "side view", "rear view", "back view",
                "front view", "angle", "low light", "dim light", "glare"
            }))
    {
        return true;
    }
    const std::vector<std::string> tokens = extractWordTokens(s);
    return tokenListContainsAny(
        tokens,
        {
            "occluded", "partial", "blurry", "cropped", "distant",
            "profile", "rear", "front", "side", "angle", "glare"
        });
}

inline bool traitLooksLikePersonIdentityCue(const std::string& rawTrait) {
    const std::string s = lower(trim(rawTrait));
    if (s.empty()) return false;
    if (containsAnySubstring(
            s,
            {
                "holding ", "carrying ", "wearing ", "black shirt", "white shirt",
                "t-shirt", "tshirt", "shirt", "camiseta", "camisa", "blouse",
                "jacket", "hoodie", "coat", "pants", "jeans", "shorts",
                "bermuda", "dress", "skirt", "shoe", "sneaker", "boot",
                "hat", "cap", "beanie", "helmet", "glasses", "goggles",
                "beard", "mustache", "hair", "ponytail", "braid", "tattoo",
                "scar", "bracelet", "watch", "necklace", "ring", "earring",
                "backpack", "shoulder bag", "purse", "skin tone", "light skin",
                "dark skin", "weapon", "gun", "pistol", "rifle", "knife",
                "machete", "firearm", "mask"
            }))
    {
        return true;
    }
    const std::vector<std::string> tokens = extractWordTokens(s);
    return tokenListContainsAny(
        tokens,
        {
            "person", "man", "woman", "male", "female", "shirt", "tee",
            "camiseta", "camisa", "blouse", "jacket", "hoodie", "coat",
            "pants", "jeans", "shorts", "bermuda", "dress", "skirt",
            "shoe", "shoes", "sneaker", "sneakers", "boot", "boots",
            "hat", "cap", "beanie", "helmet", "glasses", "goggles",
            "beard", "mustache", "hair", "curly", "straight", "braid",
            "ponytail", "tattoo", "scar", "bracelet", "watch",
            "necklace", "ring", "earring", "skin", "backpack", "bag",
            "purse", "mask", "weapon", "gun", "pistol", "rifle", "knife",
            "machete", "firearm", "build", "tall", "short", "slim",
            "heavyset"
        });
}

inline bool traitLooksLikeVehicleIdentityCue(const std::string& rawTrait) {
    const std::string s = lower(trim(rawTrait));
    if (s.empty()) return false;
    if (containsAnySubstring(
            s,
            {
                "license plate", "plate ", "plate:", "placa", "roof rack",
                "spare tire", "spare wheel", "broken headlight",
                "broken taillight", "tail light", "headlight", "sticker",
                "decal", "scratch", "scrape", "dent", "bumper", "grille",
                "sedan", "suv", "pickup", "truck", "van", "bus",
                "motorcycle", "motorbike", "hatchback", "coupe", "wagon"
            }))
    {
        return true;
    }
    const std::vector<std::string> tokens = extractWordTokens(s);
    return tokenListContainsAny(
        tokens,
        {
            "vehicle", "car", "sedan", "suv", "truck", "pickup", "van",
            "bus", "taxi", "motorcycle", "motorbike", "bike", "bicycle",
            "plate", "placa", "sticker", "decal", "scratch", "scrape",
            "dent", "bumper", "grille", "rack", "tire", "wheel",
            "headlight", "taillight", "ford", "toyota", "honda",
            "chevrolet", "chevy", "volkswagen", "vw", "nissan", "hyundai",
            "kia", "bmw", "mercedes", "audi", "jeep", "ram", "fiat",
            "renault", "peugeot"
        });
}

inline bool traitLooksLikeIdentityCueForEntityType(
    const std::string& rawEntityType,
    const std::string& rawTrait)
{
    const bool vehicleLike = entityTypeSuggestsVehicleIdentity(rawEntityType);
    const bool personLike = entityTypeSuggestsPersonIdentity(rawEntityType);
    if (vehicleLike) return traitLooksLikeVehicleIdentityCue(rawTrait);
    if (personLike) return traitLooksLikePersonIdentityCue(rawTrait);
    return traitLooksLikePersonIdentityCue(rawTrait) ||
           traitLooksLikeVehicleIdentityCue(rawTrait);
}

inline json curateIdentitySignatureTraits(
    const std::string& rawEntityType,
    const json& stableTraits,
    const json& contextTraits,
    const json& existingTraits = json::array())
{
    json curated = json::array();
    appendUniqueStringsToArray(curated, existingTraits);

    auto appendMatchingTraits = [&](const json& source) {
        const json parsed = parseTraitsValue(source);
        if (!parsed.is_array()) return;
        for (const auto& item : parsed) {
            if (!item.is_string()) continue;
            const std::string trait = trim(item.get<std::string>());
            if (trait.empty()) continue;
            const bool sceneLike = traitLooksLikeSceneOrBackgroundContext(trait);
            const bool cueLike = traitLooksLikeIdentityCueForEntityType(rawEntityType, trait);
            if (cueLike && !sceneLike) {
                appendUniqueStringsToArray(curated, trait);
            }
        }
    };

    appendMatchingTraits(stableTraits);
    if (curated.empty()) appendMatchingTraits(contextTraits);
    if (curated.size() > 8) {
        curated.erase(curated.begin() + 8, curated.end());
    }
    return curated;
}

inline json curateIdentityContextTraits(
    const std::string& rawEntityType,
    const json& stableTraits,
    const json& contextTraits,
    const json& existingTraits = json::array())
{
    (void)rawEntityType;
    json curated = json::array();
    appendUniqueStringsToArray(curated, existingTraits);

    auto appendContextTraits = [&](const json& source) {
        const json parsed = parseTraitsValue(source);
        if (!parsed.is_array()) return;
        for (const auto& item : parsed) {
            if (!item.is_string()) continue;
            const std::string trait = trim(item.get<std::string>());
            if (trait.empty()) continue;
            const bool sceneLike = traitLooksLikeSceneOrBackgroundContext(trait);
            const bool transientLike = traitLooksLikeTransientIdentityContext(trait);
            if (sceneLike || transientLike) {
                appendUniqueStringsToArray(curated, trait);
            }
        }
    };

    appendContextTraits(contextTraits);
    if (curated.empty()) appendContextTraits(stableTraits);
    if (curated.size() > 4) {
        curated.erase(curated.begin() + 4, curated.end());
    }
    return curated;
}

inline std::string buildIdentitySignatureSummary(
    const std::string& rawEntityType,
    const json& signatureTraits)
{
    (void)rawEntityType;
    const json traits = parseTraitsValue(signatureTraits);
    if (!traits.is_array() || traits.empty()) return std::string();
    std::ostringstream oss;
    oss << "Identity signature: ";
    bool first = true;
    std::size_t emitted = 0;
    for (const auto& item : traits) {
        if (!item.is_string()) continue;
        const std::string trait = trim(item.get<std::string>());
        if (trait.empty()) continue;
        if (!first) oss << "; ";
        oss << trait;
        first = false;
        ++emitted;
        if (emitted >= 5) break;
    }
    return emitted == 0 ? std::string() : oss.str();
}

inline bool isAllowedOperatorType(const std::string& opType) {
    static const std::unordered_set<std::string> kAllowed = {
        "stopped_for_more_than_without_event",
        "seen_n_times_in_window_by_entity",
        "schedule_at_time",
        "summary_window",
        "entity_present",
        "entity_absent",
        "count_events_in_window",
        "no_event_for_duration",
        "cross_camera_track_after_trigger",
        "custom_expression"
    };
    return kAllowed.find(lower(trim(opType))) != kAllowed.end();
}

inline bool isAllowedComputeKind(const std::string& computeKind) {
    static const std::unordered_set<std::string> kAllowed = {
        "event_counter",
        "last_event_timestamp",
        "duration_since_event",
        "presence_flag",
        "window_buffer"
    };
    return kAllowed.find(lower(trim(computeKind))) != kAllowed.end();
}

inline bool isAllowedRuntimeType(const std::string& runtimeType) {
    static const std::unordered_set<std::string> kAllowed = {
        "int", "float", "bool", "string", "array", "timestamp"
    };
    return kAllowed.find(lower(trim(runtimeType))) != kAllowed.end();
}

inline uint64_t fnv1a64(const std::string& s) {
    uint64_t h = 1469598103934665603ULL;
    for (unsigned char c : s) {
        h ^= static_cast<uint64_t>(c);
        h *= 1099511628211ULL;
    }
    return h;
}

inline std::string u64hex(uint64_t v) {
    std::ostringstream oss;
    oss << std::hex << std::setfill('0') << std::setw(16) << v;
    return oss.str();
}

inline std::string computePromptHash(
    const std::string& promptCore,
    const std::string& alertCondition,
    const std::string& negativeCondition,
    const std::string& inputType,
    const std::string& language,
    const std::string& schemaVersion)
{
    std::ostringstream oss;
    oss << trim(promptCore) << "\n---\n"
        << trim(alertCondition) << "\n---\n"
        << trim(negativeCondition) << "\n---\n"
        << lower(trim(inputType)) << "\n---\n"
        << lower(trim(language)) << "\n---\n"
        << trim(schemaVersion);
    return std::string("fnv1a64_") + u64hex(fnv1a64(oss.str()));
}

inline std::string computePromptRevisionHash(
    const std::string& promptCore,
    const std::string& alertCondition)
{
    std::ostringstream oss;
    oss << trim(promptCore) << "\n---\n" << trim(alertCondition);
    return std::string("fnv1a64_") + u64hex(fnv1a64(oss.str()));
}

inline bool promptCoreAndAlertMatch(
    const std::string& lhsPromptCore,
    const std::string& lhsAlertCondition,
    const std::string& rhsPromptCore,
    const std::string& rhsAlertCondition)
{
    return trim(lhsPromptCore) == trim(rhsPromptCore) &&
           trim(lhsAlertCondition) == trim(rhsAlertCondition);
}

inline bool parseIso(const std::string& raw, std::chrono::system_clock::time_point& out) {
    const std::string s = trim(raw);
    if (s.size() < 19) return false;
    if (s[4] != '-' || s[7] != '-' || (s[10] != 'T' && s[10] != ' ') || s[13] != ':' || s[16] != ':') return false;
    int Y = 0, M = 0, D = 0, h = 0, m = 0, sec = 0;
    try {
        Y = std::stoi(s.substr(0, 4));
        M = std::stoi(s.substr(5, 2));
        D = std::stoi(s.substr(8, 2));
        h = std::stoi(s.substr(11, 2));
        m = std::stoi(s.substr(14, 2));
        sec = std::stoi(s.substr(17, 2));
    } catch (...) { return false; }
    std::tm tmUtc{};
    tmUtc.tm_year = Y - 1900;
    tmUtc.tm_mon = M - 1;
    tmUtc.tm_mday = D;
    tmUtc.tm_hour = h;
    tmUtc.tm_min = m;
    tmUtc.tm_sec = sec;
#if defined(_WIN32)
    std::time_t t = _mkgmtime(&tmUtc);
#else
    std::time_t t = timegm(&tmUtc);
#endif
    if (t == static_cast<std::time_t>(-1)) return false;
    int offset = 0;
    if (s.size() >= 25 && (s[19] == '+' || s[19] == '-') && s[22] == ':') {
        int hh = 0;
        int mm = 0;
        try {
            hh = std::stoi(s.substr(20, 2));
            mm = std::stoi(s.substr(23, 2));
        } catch (...) { return false; }
        const int sign = (s[19] == '-') ? -1 : 1;
        offset = sign * (hh * 3600 + mm * 60);
    }
    out = std::chrono::system_clock::from_time_t(t - offset);
    return true;
}

inline std::string nowIso() {
    const auto tp = std::chrono::system_clock::now();
    const std::time_t tt = std::chrono::system_clock::to_time_t(tp);
    std::tm tmUtc{};
#if defined(_WIN32)
    gmtime_s(&tmUtc, &tt);
#else
    gmtime_r(&tt, &tmUtc);
#endif
    char buf[32];
    if (std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tmUtc) == 0) return "";
    return std::string(buf);
}

inline bool parseCompactSegmentTs(const std::string& raw, std::chrono::system_clock::time_point& out) {
    const std::string s = trim(raw);
    if (s.size() != 15 || s[8] != '_') return false;
    for (std::size_t i = 0; i < s.size(); ++i) {
        if (i == 8) continue;
        if (!std::isdigit(static_cast<unsigned char>(s[i]))) return false;
    }
    std::ostringstream iso;
    iso << s.substr(0, 4) << "-" << s.substr(4, 2) << "-" << s.substr(6, 2)
        << "T" << s.substr(9, 2) << ":" << s.substr(11, 2) << ":" << s.substr(13, 2);
    return parseIso(iso.str(), out);
}

inline bool parseFlexibleTs(const std::string& raw, std::chrono::system_clock::time_point& out) {
    if (parseIso(raw, out)) return true;
    return parseCompactSegmentTs(raw, out);
}

inline std::string formatIsoUtcNoSuffix(const std::chrono::system_clock::time_point& tp) {
    const std::time_t tt = std::chrono::system_clock::to_time_t(tp);
    std::tm tmUtc{};
#if defined(_WIN32)
    gmtime_s(&tmUtc, &tt);
#else
    gmtime_r(&tt, &tmUtc);
#endif
    char buf[32];
    if (std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S", &tmUtc) == 0) return "";
    return std::string(buf);
}

inline std::string normalizeFlexibleTs(const std::string& raw) {
    std::chrono::system_clock::time_point tp;
    if (!parseFlexibleTs(raw, tp)) return "";
    return formatIsoUtcNoSuffix(tp);
}

inline std::string decisionAnchorUtc(
    const std::string& nowIsoUtc,
    const std::string& segmentEndTsRaw = std::string())
{
    const std::string segmentEndTs = normalizeFlexibleTs(segmentEndTsRaw);
    if (!segmentEndTs.empty()) return segmentEndTs;
    const std::string normalizedNow = normalizeFlexibleTs(trim(nowIsoUtc).empty() ? nowIso() : trim(nowIsoUtc));
    if (!normalizedNow.empty()) return normalizedNow;
    return normalizeFlexibleTs(nowIso());
}

inline long long ageSeconds(const std::string& tsIso, const std::string& nowIsoUtc) {
    std::chrono::system_clock::time_point a, b;
    if (!parseIso(tsIso, a) || !parseIso(nowIsoUtc, b)) return 0;
    return std::chrono::duration_cast<std::chrono::seconds>(b - a).count();
}

inline std::string strField(const json& n, const char* key, const std::string& fallback = std::string()) {
    if (!n.is_object() || !n.contains(key) || !n[key].is_string()) return fallback;
    return n[key].get<std::string>();
}

inline int intField(const json& n, const char* key, int fallback = 0) {
    if (!n.is_object() || !n.contains(key)) return fallback;
    const auto& v = n[key];
    if (v.is_number_integer()) return v.get<int>();
    if (v.is_number()) return static_cast<int>(std::llround(v.get<double>()));
    if (v.is_string()) { try { return std::stoi(v.get<std::string>()); } catch (...) {} }
    return fallback;
}

inline double dblField(const json& n, const char* key, double fallback = 0.0) {
    if (!n.is_object() || !n.contains(key)) return fallback;
    const auto& v = n[key];
    if (v.is_number()) return v.get<double>();
    if (v.is_string()) { try { return std::stod(v.get<std::string>()); } catch (...) {} }
    return fallback;
}

inline std::string strFieldAny(
    const json& n,
    std::initializer_list<const char*> keys,
    const std::string& fallback = std::string())
{
    if (!n.is_object()) return fallback;
    for (const char* key : keys) {
        if (key == nullptr || !n.contains(key) || !n[key].is_string()) continue;
        const std::string value = n[key].get<std::string>();
        if (!trim(value).empty()) return value;
    }
    return fallback;
}

inline double dblFieldAny(
    const json& n,
    std::initializer_list<const char*> keys,
    double fallback = 0.0)
{
    if (!n.is_object()) return fallback;
    for (const char* key : keys) {
        if (key == nullptr || !n.contains(key)) continue;
        const auto& v = n[key];
        if (v.is_number()) return v.get<double>();
        if (v.is_string()) {
            try {
                return std::stod(v.get<std::string>());
            }
            catch (...) {
            }
        }
    }
    return fallback;
}

inline bool tryParseBoolValue(const json& value, bool& outValue) {
    if (value.is_boolean()) {
        outValue = value.get<bool>();
        return true;
    }
    if (value.is_number_integer()) {
        outValue = value.get<long long>() != 0;
        return true;
    }
    if (value.is_number()) {
        outValue = value.get<double>() != 0.0;
        return true;
    }
    if (!value.is_string()) return false;

    const std::string raw = lower(trim(value.get<std::string>()));
    if (raw.empty()) return false;
    if (raw == "true" || raw == "1" || raw == "yes" || raw == "y" || raw == "sim") {
        outValue = true;
        return true;
    }
    if (raw == "false" || raw == "0" || raw == "no" || raw == "n" || raw == "nao") {
        outValue = false;
        return true;
    }
    return false;
}

inline bool boolFieldAny(
    const json& n,
    std::initializer_list<const char*> keys,
    bool& outValue)
{
    if (!n.is_object()) return false;
    for (const char* key : keys) {
        if (key == nullptr || !n.contains(key)) continue;
        if (tryParseBoolValue(n[key], outValue)) return true;
    }
    return false;
}

inline bool boolFieldAnyFromObjectOrDetails(
    const json& n,
    std::initializer_list<const char*> keys,
    bool& outValue)
{
    if (boolFieldAny(n, keys, outValue)) return true;
    if (n.is_object() && n.contains("details") && n["details"].is_object()) {
        return boolFieldAny(n["details"], keys, outValue);
    }
    return false;
}

inline std::string normalizeStructuredSemanticToken(const std::string& rawToken) {
    const std::string raw = trim(rawToken);
    if (raw.empty()) return raw;

    std::string key;
    key.reserve(raw.size());
    for (unsigned char ch : raw) {
        if (std::isalnum(ch)) key.push_back(static_cast<char>(std::tolower(ch)));
        else if ((ch == '_' || ch == '-' || ch == ' ') && !key.empty() && key.back() != '_') {
            key.push_back('_');
        }
    }
    while (!key.empty() && key.front() == '_') key.erase(key.begin());
    while (!key.empty() && key.back() == '_') key.pop_back();
    return key;
}

inline std::string structuredObservationKindField(const json& node) {
    std::string kind = trim(strFieldAny(node, { "observation_kind", "observation_type", "kind" }));
    if (!kind.empty()) return kind;
    if (node.is_object() && node.contains("details") && node["details"].is_object()) {
        kind = trim(strFieldAny(node["details"], { "observation_kind", "observation_type", "kind" }));
    }
    return kind;
}

inline bool structuredObservationKindSuggestsContinuation(const std::string& rawKind) {
    const std::string kind = normalizeStructuredSemanticToken(rawKind);
    if (kind.empty()) return false;
    return kind == "continuation" ||
           kind == "continued" ||
           kind == "same_episode_continuation" ||
           kind == "episode_continuation" ||
           kind == "same_action_continuation" ||
           kind == "same_event_continuation" ||
           kind == "ongoing_continuation" ||
           kind == "same_episode" ||
           kind == "same_action" ||
           kind == "same_event" ||
           kind.find("continu") != std::string::npos;
}

inline bool nodeReferencesExistingEpisode(const json& node) {
    if (!node.is_object()) return false;
    const std::string episodeRef =
        trim(strFieldAny(node, { "same_episode_as", "episode_ref", "episode_id" }));
    if (!episodeRef.empty()) return true;
    if (node.contains("details") && node["details"].is_object()) {
        const std::string nestedEpisodeRef =
            trim(strFieldAny(node["details"], { "same_episode_as", "episode_ref", "episode_id" }));
        if (!nestedEpisodeRef.empty()) return true;
    }
    return false;
}

inline bool nodeMarksContinuation(const json& node) {
    if (!node.is_object()) return false;

    bool flag = false;
    if (boolFieldAnyFromObjectOrDetails(
            node,
            { "continuation", "is_continuation", "continued" },
            flag) &&
        flag)
    {
        return true;
    }
    if (nodeReferencesExistingEpisode(node)) return true;
    return structuredObservationKindSuggestsContinuation(structuredObservationKindField(node));
}

inline bool nodeCountsAsNewEvent(const json& node) {
    if (!node.is_object()) return true;

    bool countsAsNewEvent = true;
    if (boolFieldAnyFromObjectOrDetails(
            node,
            { "counts_as_new_event", "count_as_new_event", "is_new_event", "new_event" },
            countsAsNewEvent) &&
        !countsAsNewEvent)
    {
        return false;
    }

    if (nodeMarksContinuation(node)) return false;
    return true;
}

inline std::string structuredDecisionField(const json& node) {
    return trim(strFieldAny(node, { "decision", "identity_decision" }));
}

inline double structuredConfidenceField(const json& node, double fallback = 0.0) {
    return dblFieldAny(node, { "confidence", "identity_confidence", "match_confidence" }, fallback);
}

inline std::string structuredEntityIdField(const json& node) {
    return trim(strFieldAny(node, { "entity_id", "id", "matched_entity_id" }));
}

inline std::string structuredEntityKeyField(const json& node) {
    return trim(strFieldAny(
        node,
        { "entity_key", "entity_ref", "entity", "subject", "target_entity", "matched_entity" }));
}

inline std::string structuredEntityHintField(const json& node) {
    const std::string entityKey = structuredEntityKeyField(node);
    if (!entityKey.empty()) return entityKey;
    return trim(strFieldAny(node, { "entity_type" }));
}

inline std::string structuredEntityTokenField(const json& node) {
    const std::string entityId = structuredEntityIdField(node);
    if (!entityId.empty()) return entityId;
    return structuredEntityHintField(node);
}

inline json extractPlan(const json& envelope) {
    if (!envelope.is_object()) return json::object();
    if (envelope.contains("plan_json") && envelope["plan_json"].is_object()) return envelope["plan_json"];
    if (envelope.contains("schema_version") && envelope["schema_version"].is_string()) {
        const std::string s = envelope["schema_version"].get<std::string>();
        if (s.rfind("temporal-plan/", 0) == 0) return envelope;
    }
    return json::object();
}

inline bool looksLikeEntryTrackingPrompt(const std::string& promptMerged) {
    const std::string s = lower(trim(promptMerged));
    return s.find("entr") != std::string::npos ||
           s.find("enter") != std::string::npos ||
           s.find("entry") != std::string::npos;
}

inline int ordinalWordToNumber(const std::string& s) {
    const std::string v = lower(trim(s));
    if (v.find("first") != std::string::npos || v.find("primeir") != std::string::npos) return 1;
    if (v.find("second") != std::string::npos || v.find("segund") != std::string::npos) return 2;
    if (v.find("third") != std::string::npos || v.find("terceir") != std::string::npos) return 3;
    if (v.find("fourth") != std::string::npos || v.find("quart") != std::string::npos) return 4;
    if (v.find("fifth") != std::string::npos || v.find("quint") != std::string::npos) return 5;
    if (v.find("sixth") != std::string::npos || v.find("sext") != std::string::npos) return 6;
    if (v.find("seventh") != std::string::npos || v.find("setim") != std::string::npos) return 7;
    if (v.find("eighth") != std::string::npos || v.find("oitav") != std::string::npos) return 8;
    if (v.find("ninth") != std::string::npos || v.find("non") != std::string::npos) return 9;
    if (v.find("tenth") != std::string::npos || v.find("decim") != std::string::npos) return 10;
    return 0;
}

inline bool hasOccurrenceContext(const std::string& s, std::size_t at, std::size_t len) {
    if (s.empty()) return false;
    const std::size_t a = (at > 18) ? (at - 18) : 0;
    const std::size_t b = std::min(s.size(), at + len + 24);
    const std::string contextWindow = s.substr(a, b - a);
    return contextWindow.find("vez") != std::string::npos ||
           contextWindow.find("times") != std::string::npos ||
           contextWindow.find("time") != std::string::npos ||
           contextWindow.find("entry") != std::string::npos ||
           contextWindow.find("entrad") != std::string::npos ||
           contextWindow.find("enter") != std::string::npos ||
           contextWindow.find("ocorr") != std::string::npos;
}

inline int extractOccurrenceTargetFromPrompt(const std::string& promptMerged, int fallback = 0) {
    const std::string s = lower(trim(promptMerged));
    if (s.empty()) return fallback;

    int best = 0;
    auto consider = [&](int n) {
        if (n < 2) return;
        if (best == 0) best = n;
    };

    const int ordinal = ordinalWordToNumber(s);
    if (ordinal > 0) consider(ordinal);

    std::size_t i = 0;
    while (i < s.size()) {
        if (!std::isdigit(static_cast<unsigned char>(s[i]))) { ++i; continue; }
        std::size_t j = i;
        while (j < s.size() && std::isdigit(static_cast<unsigned char>(s[j]))) ++j;
        int n = 0;
        try { n = std::stoi(s.substr(i, j - i)); }
        catch (...) { n = 0; }

        bool shouldUse = false;
        if (j < s.size() && (s[j] == 'x')) shouldUse = true; // "2x", "5x"
        if (hasOccurrenceContext(s, i, j - i)) shouldUse = true;
        if (shouldUse) consider(n);
        i = (j > i) ? j : (i + 1);
    }

    return best > 0 ? best : fallback;
}

inline bool looksLikeCrossCameraTrackingPrompt(const std::string& promptMerged) {
    const std::string s = lower(trim(promptMerged));
    if (s.empty()) return false;
    const bool crossCameraScope =
        s.find("all cameras") != std::string::npos ||
        s.find("across cameras") != std::string::npos ||
        s.find("other cameras") != std::string::npos ||
        s.find("check other cameras") != std::string::npos ||
        s.find("check the other cameras") != std::string::npos ||
        s.find("look in other cameras") != std::string::npos ||
        s.find("look in the other cameras") != std::string::npos ||
        s.find("find in other cameras") != std::string::npos ||
        s.find("see if appears in other cameras") != std::string::npos ||
        s.find("see if he appears in other cameras") != std::string::npos ||
        s.find("see if she appears in other cameras") != std::string::npos ||
        s.find("every camera") != std::string::npos ||
        s.find("todas as cameras") != std::string::npos ||
        s.find("todas as câmeras") != std::string::npos ||
        s.find("outras cameras") != std::string::npos ||
        s.find("outras câmeras") != std::string::npos ||
        s.find("em todas as cameras") != std::string::npos ||
        s.find("em todas as câmeras") != std::string::npos;
    // Additional Spanish scope variants are handled in expandedCrossCameraScope below.
    const bool searchIntent =
        s.find("look for") != std::string::npos ||
        s.find("find") != std::string::npos ||
        s.find("check") != std::string::npos ||
        s.find("see if") != std::string::npos ||
        s.find("appear") != std::string::npos ||
        s.find("show up") != std::string::npos ||
        s.find("follow") != std::string::npos ||
        s.find("procure") != std::string::npos ||
        s.find("buscar") != std::string::npos ||
        s.find("busque") != std::string::npos ||
        s.find("search") != std::string::npos ||
        s.find("track") != std::string::npos ||
        s.find("identify") != std::string::npos ||
        s.find("identificar") != std::string::npos ||
        s.find("encontrar") != std::string::npos ||
        s.find("encontre") != std::string::npos ||
        s.find("verifique") != std::string::npos ||
        s.find("verificar") != std::string::npos ||
        s.find("checar") != std::string::npos ||
        s.find("cheque") != std::string::npos ||
        s.find("ver se aparece") != std::string::npos ||
        s.find("aparece") != std::string::npos ||
        s.find("aparecer") != std::string::npos ||
        s.find("encuentra") != std::string::npos ||
        s.find("encuentre") != std::string::npos ||
        s.find("revisar") != std::string::npos ||
        s.find("ver si aparece") != std::string::npos;
    const bool expandedCrossCameraScope =
        s.find("between cameras") != std::string::npos ||
        s.find("multi camera") != std::string::npos ||
        s.find("multicamera") != std::string::npos ||
        s.find("another camera") != std::string::npos ||
        s.find("outra camera") != std::string::npos ||
        s.find("demais cameras") != std::string::npos ||
        s.find("entre cameras") != std::string::npos ||
        s.find("nas outras cameras") != std::string::npos ||
        s.find("nas demais cameras") != std::string::npos ||
        s.find("na outra camera") != std::string::npos ||
        s.find("otra camara") != std::string::npos ||
        s.find("otras camaras") != std::string::npos ||
        s.find("en otras camaras") != std::string::npos ||
        s.find("en las otras camaras") != std::string::npos ||
        s.find("demas camaras") != std::string::npos ||
        s.find("entre camaras") != std::string::npos;
    const bool expandedSearchIntent =
        s.find("procurar") != std::string::npos ||
        s.find("rastre") != std::string::npos ||
        s.find("acompanh") != std::string::npos ||
        s.find("seguir") != std::string::npos ||
        s.find("reident") != std::string::npos ||
        s.find("localizar") != std::string::npos ||
        s.find("monitorar") != std::string::npos ||
        s.find("rastrear") != std::string::npos ||
        s.find("seguirlo") != std::string::npos ||
        s.find("seguirla") != std::string::npos ||
        s.find("rastrea") != std::string::npos ||
        s.find("ubicar") != std::string::npos ||
        s.find("hunt") != std::string::npos;
    return (crossCameraScope || expandedCrossCameraScope) &&
           (searchIntent || expandedSearchIntent);
}

inline bool looksLikeThreatEvidencePrompt(const std::string& promptMerged) {
    const std::string s = lower(trim(promptMerged));
    if (s.empty()) return false;
    for (const std::string& token : extractWordTokens(s)) {
        if (token == "armed" ||
            token == "weapon" ||
            token == "gun" ||
            token == "firearm" ||
            token == "rifle" ||
            token == "pistol" ||
            token == "shotgun" ||
            token == "knife" ||
            token == "arma" ||
            token == "faca" ||
            token == "facao" ||
            token == "machete" ||
            token.rfind("armad", 0) == 0)
        {
            return true;
        }
    }
    return false;
}

inline bool tokenLooksLikeThreatEvidence(const std::string& rawToken) {
    return looksLikeThreatEvidencePrompt(rawToken);
}

inline bool promptHasDurationCue(const std::string& promptMerged) {
    const std::string s = lower(trim(promptMerged));
    if (s.empty()) return false;
    const bool hasDurationContext = containsAnySubstring(s, {
        "for more than", "more than ", "for at least", "longer than",
        "por mais de", "por pelo menos", "durante ", "ao longo de ",
        "stayed", "remain", "remained", "remains", "linger",
        "permaneceu", "ficou", "continuou", "parado", "parada",
        "stopped for", "without event", "sem evento"
    });
    const bool hasDurationUnit = containsAnySubstring(s, {
        " second", " seconds", " minute", " minutes", " hour", " hours",
        " segundo", " segundos", " minuto", " minutos", " hora", " horas",
        "sec", "secs", "min", "mins"
    });
    return (hasDurationContext && hasDurationUnit) ||
           containsAnySubstring(s, {
               "stopped for", "parado por", "permaneceu por", "remained for",
               "sem evento por", "without event for"
           });
}

inline bool promptHasCountOrWindowCue(const std::string& promptMerged) {
    const std::string s = lower(trim(promptMerged));
    if (s.empty()) return false;
    if (extractOccurrenceTargetFromPrompt(s, 0) >= 2) return true;
    return containsAnySubstring(s, {
        " within ", "window", "times", "multiple times", "more than once",
        "repeated", "repeatedly", "again", "several times",
        " vez", " vezes", "repet", "reincid", "ao longo", "multiplas", "multiplos"
    });
}

inline bool promptHasSequenceCue(const std::string& promptMerged) {
    const std::string s = lower(trim(promptMerged));
    if (s.empty()) return false;
    return containsAnySubstring(s, {
        "before ", "after ", "then ", "followed by", "followed",
        "antes ", "depois ", "apos ", "em seguida"
    });
}

inline bool promptHasTransitionCue(const std::string& promptMerged) {
    const std::string s = lower(trim(promptMerged));
    if (s.empty()) return false;
    if (looksLikeEntryTrackingPrompt(s)) return true;
    for (const std::string& token : extractWordTokens(s)) {
        if (token == "enter" || token == "entered" || token == "entry" ||
            token == "entrar" || token == "entrada" || token == "saiu" ||
            token == "saida" || token == "exit" || token == "exited" ||
            token == "leave" || token == "left" || token == "cross" ||
            token == "crossed" || token == "crossing" || token == "cruzar" ||
            token == "cruzou" || token == "pass" || token == "passed" ||
            token == "passing" || token == "passar" || token == "passou" ||
            token == "approach" || token == "approached" || token == "approaching" ||
            token == "aproximar" || token == "aproximou" || token == "aproximando")
        {
            return true;
        }
    }
    return containsAnySubstring(s, {
        "towards the camera", "toward the camera",
        "em direcao", "direcao da camera", "direcao a camera"
    });
}

inline bool promptHasAbsenceDurationCue(const std::string& promptMerged) {
    const std::string s = lower(trim(promptMerged));
    if (s.empty()) return false;
    const bool hasNegativeCue = containsAnySubstring(s, {
        "without", "did not", "didn't", "missing", "absence", "no event",
        "sem ", "nao ", "ausencia", "ausente", "sumiu", "desapareceu"
    });
    return hasNegativeCue && (promptHasDurationCue(s) || containsAnySubstring(s, {
        "without event", "sem evento", "did not appear", "nao apareceu",
        "not visible for", "ausente por"
    }));
}

inline bool runtimePromptRequestsTemporalReasoning(const std::string& promptMerged) {
    const std::string s = lower(trim(promptMerged));
    if (s.empty()) return false;
    return looksLikeCrossCameraTrackingPrompt(s) ||
           promptHasTransitionCue(s) ||
           promptHasDurationCue(s) ||
           promptHasCountOrWindowCue(s) ||
           promptHasSequenceCue(s) ||
           promptHasAbsenceDurationCue(s);
}

inline bool eventNameSuggestsTransition(const std::string& rawEvent) {
    const std::string ev = lower(trim(rawEvent));
    if (ev.empty()) return false;
    if (ev == "entered_zone" || ev == "left_zone") return true;
    return containsAnySubstring(ev, {
        "enter", "entr", "exit", "leave", "left",
        "cross", "cruz", "pass", "approach", "toward", "direc"
    });
}

inline bool operatorUsesGenericPresenceShortcut(const json& op) {
    if (!op.is_object()) return false;
    const std::string typ = lower(trim(strField(op, "type")));
    if (typ == "cross_camera_track_after_trigger") return false;
    if (typ == "entity_present") return true;
    if (typ != "count_events_in_window" &&
        typ != "seen_n_times_in_window_by_entity")
    {
        return false;
    }
    const json params = op.value("params", json::object());
    if (!params.is_object()) return false;
    const std::string eventName = lower(trim(strField(params, "event")));
    return eventName.empty() || eventName == "present";
}

inline bool planHasCrossCameraOperator(const json& plan) {
    if (!plan.is_object() || !plan.contains("operators") || !plan["operators"].is_array()) return false;
    for (const auto& op : plan["operators"]) {
        if (!op.is_object()) continue;
        if (lower(trim(strField(op, "type"))) == "cross_camera_track_after_trigger") {
            return true;
        }
    }
    return false;
}

inline bool planHasDurationOperator(const json& plan) {
    if (!plan.is_object() || !plan.contains("operators") || !plan["operators"].is_array()) return false;
    for (const auto& op : plan["operators"]) {
        if (!op.is_object()) continue;
        const std::string typ = lower(trim(strField(op, "type")));
        if (typ == "stopped_for_more_than_without_event" ||
            typ == "no_event_for_duration")
        {
            return true;
        }
    }
    return false;
}

inline bool planHasTransitionOperator(const json& plan) {
    if (!plan.is_object() || !plan.contains("operators") || !plan["operators"].is_array()) return false;
    for (const auto& op : plan["operators"]) {
        if (!op.is_object()) continue;
        const std::string typ = lower(trim(strField(op, "type")));
        if (typ == "entered_zone" || typ == "left_zone") return true;
        if (typ == "count_events_in_window" ||
            typ == "seen_n_times_in_window_by_entity")
        {
            const json params = op.value("params", json::object());
            if (!params.is_object()) continue;
            if (eventNameSuggestsTransition(strField(params, "event"))) {
                return true;
            }
        }
    }
    return false;
}

inline bool planHasCountWindowOperator(const json& plan) {
    if (!plan.is_object() || !plan.contains("operators") || !plan["operators"].is_array()) return false;
    for (const auto& op : plan["operators"]) {
        if (!op.is_object()) continue;
        const std::string typ = lower(trim(strField(op, "type")));
        const json params = op.value("params", json::object());
        if (!params.is_object()) continue;
        const std::string eventName = lower(trim(strField(params, "event")));
        if (eventName.empty() || eventName == "present") continue;
        const int windowSeconds = intField(params, "window_seconds", 0);
        if (typ == "seen_n_times_in_window_by_entity") {
            if (intField(params, "n", 0) >= 2 && windowSeconds > 0) return true;
        } else if (typ == "count_events_in_window") {
            if (intField(params, "threshold", 0) >= 2 && windowSeconds > 0) return true;
        }
    }
    return false;
}

inline bool planUsesGenericPresenceShortcut(const json& plan) {
    if (!plan.is_object() || !plan.contains("operators") || !plan["operators"].is_array()) return false;
    for (const auto& op : plan["operators"]) {
        if (operatorUsesGenericPresenceShortcut(op)) return true;
    }
    return false;
}

inline bool validateRuntimePlanSemanticFit(
    const json& envelope,
    const std::string& promptCore,
    const std::string& alertCondition,
    const std::string& negativeCondition,
    std::string* outReason = nullptr)
{
    (void)promptCore;
    (void)alertCondition;
    (void)negativeCondition;
    return validateCompilerDecisionConsistency(envelope, outReason);
}

inline std::string normalizeRuntimeComputeKind(const std::string& rawKind) {
    const std::string kind = lower(trim(rawKind));
    if (kind == "first_seen_ts" || kind == "first_seen_timestamp") {
        return "last_event_timestamp";
    }
    if (kind == "last_seen_ts" || kind == "last_seen_timestamp") {
        return "last_event_timestamp";
    }
    if (kind == "event_count" || kind == "count_events") {
        return "event_counter";
    }
    if (kind == "presence" || kind == "present_flag" || kind == "is_present") {
        return "presence_flag";
    }
    return kind;
}

inline bool operatorUsesThreatEvidence(const json& op) {
    if (!op.is_object()) return false;
    const std::string typ = lower(trim(strField(op, "type")));
    if (typ.empty() || typ == "cross_camera_track_after_trigger" ||
        typ == "schedule_at_time" || typ == "summary_window")
    {
        return false;
    }

    const json params = op.value("params", json::object());
    const std::string entity = strField(params, "entity");
    const std::string eventName = strField(params, "event");
    const std::string withoutEvent = strField(params, "without_event");
    const std::string triggerEvent = strField(params, "trigger_event");

    if (tokenLooksLikeThreatEvidence(eventName) ||
        tokenLooksLikeThreatEvidence(withoutEvent) ||
        tokenLooksLikeThreatEvidence(triggerEvent) ||
        tokenLooksLikeThreatEvidence(strField(op, "operator_id")))
    {
        return true;
    }

    const bool threatEntity = tokenLooksLikeThreatEvidence(entity);
    if (!threatEntity) return false;

    return typ == "entity_present" ||
           typ == "entity_absent" ||
           typ == "count_events_in_window" ||
           typ == "seen_n_times_in_window_by_entity" ||
           typ == "entered_zone" ||
           typ == "left_zone" ||
           typ == "stopped_for_more_than_without_event";
}

inline bool planHasUnsafeLocalAlertShortcutForThreatPrompt(const json& plan) {
    if (!plan.is_object() || !plan.contains("operators") || !plan["operators"].is_array()) {
        return false;
    }

    for (const auto& op : plan["operators"]) {
        if (!op.is_object()) continue;
        const std::string typ = lower(trim(strField(op, "type")));
        if (typ.empty() || typ == "cross_camera_track_after_trigger" ||
            typ == "schedule_at_time" || typ == "summary_window")
        {
            continue;
        }
        if (!operatorUsesThreatEvidence(op)) {
            return true;
        }
    }
    return false;
}

inline bool stripUnauthorizedCrossCameraTracking(json& envelope, const std::string& promptMerged) {
    if (looksLikeCrossCameraTrackingPrompt(promptMerged)) return false;
    json plan = extractPlan(envelope);
    if (!plan.is_object() || !plan.contains("operators") || !plan["operators"].is_array()) {
        return false;
    }

    json filtered = json::array();
    bool changed = false;
    for (const auto& op : plan["operators"]) {
        if (!op.is_object()) continue;
        if (lower(trim(strField(op, "type"))) == "cross_camera_track_after_trigger") {
            changed = true;
            continue;
        }
        filtered.push_back(op);
    }
    if (!changed) return false;

    plan["operators"] = std::move(filtered);
    if (!envelope.is_object()) envelope = json::object();
    envelope["plan_json"] = std::move(plan);
    return true;
}

inline json inferCrossCameraShareEntityTypes(const std::string& promptMerged) {
    const std::string s = lower(trim(promptMerged));
    json out = json::array();
    auto addUnique = [&](const std::string& entityType) {
        for (const auto& item : out) {
            if (item.is_string() && lower(trim(item.get<std::string>())) == lower(trim(entityType))) {
                return;
            }
        }
        out.push_back(entityType);
    };

    if (s.find("person") != std::string::npos ||
        s.find("people") != std::string::npos ||
        s.find("homem") != std::string::npos ||
        s.find("homens") != std::string::npos ||
        s.find("mulher") != std::string::npos ||
        s.find("mulheres") != std::string::npos ||
        s.find("alguem") != std::string::npos ||
        s.find("alguém") != std::string::npos)
    {
        addUnique("person");
    }
    if (s.find("moto") != std::string::npos || s.find("motorcycle") != std::string::npos) {
        addUnique("motorcycle");
    }
    if (s.find("carro") != std::string::npos ||
        s.find("veiculo") != std::string::npos ||
        s.find("veículo") != std::string::npos ||
        s.find("vehicle") != std::string::npos)
    {
        addUnique("vehicle");
    }
    return out;
}

inline void ensureEventInCatalog(json& plan, const std::string& eventName) {
    if (!plan.is_object()) return;
    if (!plan.contains("event_catalog") || !plan["event_catalog"].is_array()) return;
    for (const auto& ev : plan["event_catalog"]) {
        if (ev.is_string() && lower(trim(ev.get<std::string>())) == lower(trim(eventName))) return;
    }
    plan["event_catalog"].push_back(eventName);
}

inline std::string eventCatalogNameFromNode(const json& ev) {
    if (ev.is_string()) {
        return trim(ev.get<std::string>());
    }
    if (!ev.is_object()) return std::string();

    const std::string eventKey = trim(strField(ev, "event_key"));
    if (!eventKey.empty()) return eventKey;

    const std::string eventName = trim(strField(ev, "event"));
    if (!eventName.empty()) return eventName;

    const std::string eventType = trim(strField(ev, "event_type"));
    if (!eventType.empty()) return eventType;

    return std::string();
}

inline void normalizeEventCatalog(json& plan) {
    if (!plan.is_object()) return;
    if (!plan.contains("event_catalog") || !plan["event_catalog"].is_array()) return;

    json normalized = json::array();
    std::unordered_set<std::string> seen;
    for (const auto& ev : plan["event_catalog"]) {
        const std::string eventName = eventCatalogNameFromNode(ev);
        if (eventName.empty()) continue;
        const std::string key = lower(eventName);
        if (seen.insert(key).second) normalized.push_back(eventName);
    }
    plan["event_catalog"] = std::move(normalized);
}

inline void normalizeOperators(json& plan) {
    if (!plan.is_object()) return;
    if (!plan.contains("operators") || !plan["operators"].is_array()) return;

    const int defaultWindowSeconds = std::max(
        1,
        intField(plan.value("retention_policy", json::object()), "state_ttl_seconds", 43200));

    for (auto& op : plan["operators"]) {
        if (!op.is_object()) continue;

        if ((!op.contains("type") || !op["type"].is_string()) &&
            op.contains("operator_type") && op["operator_type"].is_string())
        {
            op["type"] = trim(op["operator_type"].get<std::string>());
        }

        if ((!op.contains("operator_id") || !op["operator_id"].is_string()) &&
            op.contains("operator_key") && op["operator_key"].is_string())
        {
            op["operator_id"] = trim(op["operator_key"].get<std::string>());
        }

        const std::string typ = lower(trim(strField(op, "type")));
        if (typ == "entered_zone" || typ == "left_zone") {
            json params = op.value("params", json::object());
            if (!params.is_object()) params = json::object();

            params["event"] = typ;
            params["n"] = std::max(1, intField(params, "n", intField(params, "threshold", 1)));
            params["window_seconds"] =
                std::max(1, intField(params, "window_seconds", defaultWindowSeconds));
            params["trigger_mode"] = "event_observed";

            op["type"] = "seen_n_times_in_window_by_entity";
            op["params"] = params;
        }
    }
}

inline json effectivePlan(const json& envelope) {
    json plan = extractPlan(envelope);
    if (!plan.is_object()) return plan;

    normalizeEventCatalog(plan);
    normalizeOperators(plan);

    const json fp = plan.value("prompt_fingerprint", json::object());
    const std::string mergedPrompt =
        strField(fp, "prompt_core") + " " +
        strField(fp, "alert_condition") + " " +
        strField(fp, "negative_condition");
    const bool entryTracking = looksLikeEntryTrackingPrompt(mergedPrompt);
    if (entryTracking) {
        const int occurrenceTarget = extractOccurrenceTargetFromPrompt(mergedPrompt, 0);
        ensureEventInCatalog(plan, "entered_zone");
        ensureEventInCatalog(plan, "left_zone");

        if (plan.contains("operators") && plan["operators"].is_array()) {
            for (auto& op : plan["operators"]) {
                if (!op.is_object()) continue;
                const std::string typ = lower(trim(strField(op, "type")));
                json params = op.value("params", json::object());
                if (!params.is_object()) params = json::object();
                const std::string entity = trim(strField(params, "entity", "person"));
                const std::string eventName = lower(trim(strField(params, "event")));
                if (typ == "count_events_in_window" &&
                    (eventName.empty() || eventName == "present" || eventName == "picked_phone"))
                {
                    const int thresholdN = intField(params, "threshold", 1);
                    const int targetN = (occurrenceTarget > 0) ? occurrenceTarget : thresholdN;
                    const int normalizedN = std::max(1, targetN);
                    json normalizedParams = {
                        { "entity", entity.empty() ? "person" : entity },
                        { "event", "entered_zone" },
                        { "n", normalizedN },
                        { "window_seconds", 43200 }
                    };
                    const std::string zone = extractZoneField(params);
                    if (!zone.empty()) normalizedParams["zone"] = zone;
                    if (normalizedN <= 1) normalizedParams["trigger_mode"] = "event_observed";
                    op["type"] = "seen_n_times_in_window_by_entity";
                    op["params"] = std::move(normalizedParams);
                } else if (typ == "seen_n_times_in_window_by_entity" &&
                           (eventName.empty() || eventName == "present" || eventName == "picked_phone"))
                {
                    params["event"] = "entered_zone";
                    const int nValue = intField(params, "n", 0);
                    params["n"] = (occurrenceTarget > 0) ? occurrenceTarget : std::max(1, nValue);
                    if (!params.contains("window_seconds")) params["window_seconds"] = 43200;
                    if (intField(params, "n", 1) <= 1) {
                        params["trigger_mode"] = "event_observed";
                    }
                    op["params"] = params;
                } else if (typ == "entity_present") {
                    const int normalizedN = std::max(1, occurrenceTarget > 0 ? occurrenceTarget : 1);
                    json normalizedParams = {
                        { "entity", entity.empty() ? "person" : entity },
                        { "event", "entered_zone" },
                        { "n", normalizedN },
                        { "window_seconds", 43200 }
                    };
                    const std::string zone = extractZoneField(params);
                    if (!zone.empty()) normalizedParams["zone"] = zone;
                    if (normalizedN <= 1) normalizedParams["trigger_mode"] = "event_observed";
                    op["type"] = "seen_n_times_in_window_by_entity";
                    op["params"] = std::move(normalizedParams);
                }
            }
        }
    }

    if (plan.contains("runtime_variables") && plan["runtime_variables"].is_array()) {
        for (auto& rv : plan["runtime_variables"]) {
            if (!rv.is_object()) continue;
            const std::string kind = normalizeRuntimeComputeKind(strField(rv, "compute_kind"));
            if (!kind.empty()) {
                rv["compute_kind"] = kind;
            }
            json params = rv.value("compute_params", json::object());
            if (!params.is_object()) params = json::object();
            const std::string eventName = lower(trim(strField(params, "event")));

            if (kind == "event_counter") {
                if (entryTracking && (eventName.empty() || eventName == "present" || eventName == "picked_phone")) {
                    params["event"] = "entered_zone";
                }
                const int windowSeconds = intField(params, "window_seconds", 0);
                if (windowSeconds <= 0) {
                    params["window_seconds"] = 0;
                }
                const std::string rvName = lower(trim(strField(rv, "name")));
                if (windowSeconds <= 0 && (rvName.empty() || rvName == "event_count_1h")) {
                    rv["name"] = "event_count_lifetime";
                }
                rv["compute_params"] = params;
            } else if (kind == "last_event_timestamp") {
                if (entryTracking && (eventName.empty() || eventName == "present" || eventName == "picked_phone")) {
                    params["event"] = "entered_zone";
                }
                rv["compute_params"] = params;
            }
        }
    }

    return plan;
}

inline bool planMatchesPromptRevision(
    const json& envelope,
    const std::string& promptCore,
    const std::string& alertCondition)
{
    json fp = json::object();
    if (envelope.is_object() &&
        envelope.contains("prompt_fingerprint") &&
        envelope["prompt_fingerprint"].is_object())
    {
        fp = envelope["prompt_fingerprint"];
    } else {
        const json plan = effectivePlan(envelope);
        if (!plan.is_object()) return false;
        fp = plan.value("prompt_fingerprint", json::object());
    }
    return promptCoreAndAlertMatch(
        strField(fp, "prompt_core"),
        strField(fp, "alert_condition"),
        promptCore,
        alertCondition
    );
}

inline json makePromptFingerprint(
    const std::string& promptCore,
    const std::string& alertCondition,
    const std::string& negativeCondition,
    const std::string& inputType,
    const std::string& language)
{
    return json{
        { "prompt_core", promptCore },
        { "alert_condition", alertCondition },
        { "negative_condition", negativeCondition },
        { "input_type", inputType },
        { "language", language }
    };
}

inline std::string compileStatusValue(
    const json& envelope,
    const std::string& fallback = "ok")
{
    if (!envelope.is_object()) return lower(trim(fallback));
    if (envelope.contains("compile_status") && envelope["compile_status"].is_string()) {
        return lower(trim(envelope["compile_status"].get<std::string>()));
    }
    return lower(trim(fallback));
}

inline json canonicalizePlanEnvelope(const json& envelope) {
    json out = envelope;
    if (!out.is_object()) out = json::object();
    out["compile_status"] = out.value("compile_status", std::string("ok"));
    const json plan = effectivePlan(out);
    if (plan.is_object()) {
        out["plan_json"] = plan;
    }
    return out;
}

inline bool looksLikeRuntimeTimestampValue(const std::string& raw) {
    const std::string s = trim(raw);
    if (s.size() < 10) return false;
    const auto isDigitAt = [&](std::size_t idx) -> bool {
        return idx < s.size() && std::isdigit(static_cast<unsigned char>(s[idx])) != 0;
    };
    const bool isoDatePrefix =
        isDigitAt(0) && isDigitAt(1) && isDigitAt(2) && isDigitAt(3) &&
        s.size() > 9 && s[4] == '-' &&
        isDigitAt(5) && isDigitAt(6) &&
        s[7] == '-' &&
        isDigitAt(8) && isDigitAt(9);
    if (!isoDatePrefix) return false;
    if (s.size() == 10) return true;
    if (s.size() > 10 && (s[10] == 'T' || s[10] == ' ')) return true;
    return false;
}

inline bool isTraitsMetadataKey(const std::string& rawKey) {
    const std::string key = lower(trim(rawKey));
    if (key.empty()) return false;
    if (key == "ts" || key == "ts_utc" || key == "timestamp" || key == "time") return true;
    if (key == "last_seen_ts" || key == "last_seen_ts_utc") return true;
    if (key == "first_seen_ts" || key == "first_seen_ts_utc") return true;
    if (key.find("timestamp") != std::string::npos) return true;
    if (key.rfind("last_event_ts", 0) == 0) return true;
    if (key.rfind("first_event_ts", 0) == 0) return true;
    if (key.size() >= 3 && key.substr(key.size() - 3) == "_ts") return true;
    if (key.size() >= 7 && key.substr(key.size() - 7) == "_ts_utc") return true;
    return false;
}

inline json parseTraitsValue(const json& value) {
    json out = json::array();
    std::unordered_set<std::string> seen;
    auto appendTrait = [&](const std::string& raw) {
        const std::string s = trim(raw);
        if (s.empty() || looksLikeRuntimeTimestampValue(s)) return;
        if (!seen.insert(s).second) return;
        out.push_back(s);
    };

    std::function<void(const json&, const std::string&)> collect =
        [&](const json& node, const std::string& parentKey) {
            if (node.is_array()) {
                for (const auto& item : node) {
                    collect(item, parentKey);
                }
                return;
            }

            if (node.is_string()) {
                if (!isTraitsMetadataKey(parentKey)) {
                    appendTrait(node.get<std::string>());
                }
                return;
            }

            if (!node.is_object()) return;

            for (const char* preferredKey : { "key_traits", "traits" }) {
                if (node.contains(preferredKey)) {
                    json preferred = parseTraitsValue(node[preferredKey]);
                    if (preferred.is_array() && !preferred.empty()) {
                        for (const auto& item : preferred) {
                            if (item.is_string()) appendTrait(item.get<std::string>());
                        }
                        return;
                    }
                }
            }

            for (auto it = node.begin(); it != node.end(); ++it) {
                collect(it.value(), it.key());
            }
        };

    collect(value, std::string());
    return out;
}

inline void appendUniqueStringsToArray(json& target, const json& value) {
    if (!target.is_array()) target = json::array();
    std::unordered_set<std::string> seen;
    for (const auto& item : target) {
        if (!item.is_string()) continue;
        const std::string existing = trim(item.get<std::string>());
        if (!existing.empty()) seen.insert(existing);
    }
    std::function<void(const json&)> collect = [&](const json& node) {
        if (node.is_array()) {
            for (const auto& item : node) collect(item);
            return;
        }
        if (!node.is_string()) return;
        const std::string s = trim(node.get<std::string>());
        if (s.empty() || !seen.insert(s).second) return;
        target.push_back(s);
    };
    collect(value);
}

inline void appendUniqueTraitsToArray(json& target, const json& value) {
    appendUniqueStringsToArray(target, parseTraitsValue(value));
}

inline std::string normalizeIdentityFeatureEnumToken(const std::string& raw) {
    const std::string s = lower(trim(raw));
    if (s.empty()) return std::string();
    std::string out;
    out.reserve(s.size());
    bool pendingSeparator = false;
    for (unsigned char ch : s) {
        if (std::isalnum(ch)) {
            if (pendingSeparator && !out.empty()) out.push_back('_');
            out.push_back(static_cast<char>(ch));
            pendingSeparator = false;
        } else {
            pendingSeparator = !out.empty();
        }
    }
    while (!out.empty() && out.back() == '_') out.pop_back();
    return out;
}

inline json parseIdentityFeatureCandidatesValue(const json& value) {
    json out = json::array();
    std::unordered_set<std::string> seen;
    std::function<void(const json&)> collect = [&](const json& node) {
        if (node.is_array()) {
            for (const auto& item : node) collect(item);
            return;
        }
        if (!node.is_object()) return;

        const std::string text = trim(
            strField(
                node,
                "text",
                strField(
                    node,
                    "trait",
                    strField(
                        node,
                        "value",
                        strField(node, "description")))));
        if (text.empty()) return;

        const std::string category = normalizeIdentityFeatureEnumToken(
            strField(node, "category", strField(node, "bucket", strField(node, "type"))));
        const std::string relation = normalizeIdentityFeatureEnumToken(
            strField(node, "relation_to_target", strField(node, "relation", strField(node, "target_relation"))));

        const std::string dedupeKey = lower(text) + "|" + category + "|" + relation;
        if (!seen.insert(dedupeKey).second) return;

        json normalized = json::object();
        normalized["text"] = text;
        if (!category.empty()) normalized["category"] = category;
        if (!relation.empty()) normalized["relation_to_target"] = relation;
        if (node.contains("confidence") && node["confidence"].is_number()) {
            normalized["confidence"] = node["confidence"];
        }
        out.push_back(std::move(normalized));
    };

    collect(value);
    return out;
}

inline json extractIdentityFeatureCandidatesFromNode(const json& node) {
    if (!node.is_object() || !node.contains("identity_feature_candidates")) {
        return json::array();
    }
    return parseIdentityFeatureCandidatesValue(node["identity_feature_candidates"]);
}

inline bool identityFeatureCategoryEligibleForSignature(const std::string& rawCategory) {
    static const std::unordered_set<std::string> kAllowed = {
        "physical_trait",
        "clothing",
        "accessory",
        "body_marking",
        "carried_object",
        "vehicle_detail",
        "plate_fragment"
    };
    return kAllowed.find(normalizeIdentityFeatureEnumToken(rawCategory)) != kAllowed.end();
}

inline bool identityFeatureRelationEligibleForSignature(const std::string& rawRelation) {
    static const std::unordered_set<std::string> kAllowed = {
        "intrinsic_body",
        "worn_on_target",
        "attached_to_target",
        "carried_by_target",
        "vehicle_body",
        "attached_to_vehicle",
        "plate_on_target"
    };
    return kAllowed.find(normalizeIdentityFeatureEnumToken(rawRelation)) != kAllowed.end();
}

inline bool identityFeatureCategoryEligibleForContext(const std::string& rawCategory) {
    static const std::unordered_set<std::string> kAllowed = {
        "pose_or_activity",
        "visibility_condition",
        "continuity_context"
    };
    return kAllowed.find(normalizeIdentityFeatureEnumToken(rawCategory)) != kAllowed.end();
}

inline bool identityFeatureRelationEligibleForContext(const std::string& rawRelation) {
    static const std::unordered_set<std::string> kAllowed = {
        "pose_or_activity",
        "visibility_condition",
        "continuity_context"
    };
    return kAllowed.find(normalizeIdentityFeatureEnumToken(rawRelation)) != kAllowed.end();
}

inline json deriveIdentitySignatureTraitsFromFeatureCandidates(
    const json& value,
    std::size_t maxItems = 16)
{
    const json candidates = parseIdentityFeatureCandidatesValue(value);
    json out = json::array();
    for (const auto& item : candidates) {
        if (!item.is_object()) continue;
        const std::string text = trim(strField(item, "text"));
        const std::string category = normalizeIdentityFeatureEnumToken(strField(item, "category"));
        const std::string relation = normalizeIdentityFeatureEnumToken(strField(item, "relation_to_target"));
        if (text.empty()) continue;
        if (!identityFeatureCategoryEligibleForSignature(category) ||
            !identityFeatureRelationEligibleForSignature(relation))
        {
            continue;
        }
        appendUniqueStringsToArray(out, text);
        if (out.size() >= maxItems) break;
    }
    return out;
}

inline json deriveIdentityContextTraitsFromFeatureCandidates(
    const json& value,
    std::size_t maxItems = 4)
{
    const json candidates = parseIdentityFeatureCandidatesValue(value);
    json out = json::array();
    for (const auto& item : candidates) {
        if (!item.is_object()) continue;
        const std::string text = trim(strField(item, "text"));
        const std::string category = normalizeIdentityFeatureEnumToken(strField(item, "category"));
        const std::string relation = normalizeIdentityFeatureEnumToken(strField(item, "relation_to_target"));
        if (text.empty()) continue;
        if (!identityFeatureCategoryEligibleForContext(category) ||
            !identityFeatureRelationEligibleForContext(relation))
        {
            continue;
        }
        appendUniqueStringsToArray(out, text);
        if (out.size() >= maxItems) break;
    }
    return out;
}

inline json extractStableTraitsFromNode(const json& node) {
    if (!node.is_object()) return json::array();
    const json structuredCandidates = extractIdentityFeatureCandidatesFromNode(node);
    const json structuredIdentityTraits =
        deriveIdentitySignatureTraitsFromFeatureCandidates(structuredCandidates);
    if (structuredIdentityTraits.is_array() && !structuredIdentityTraits.empty()) {
        return structuredIdentityTraits;
    }
    json out = json::array();
    if (node.contains("identity_signature_traits")) {
        appendUniqueTraitsToArray(out, node["identity_signature_traits"]);
    }
    if (node.contains("stable_attributes")) {
        appendUniqueTraitsToArray(out, node["stable_attributes"]);
    }
    if (node.contains("key_traits")) {
        appendUniqueTraitsToArray(out, node["key_traits"]);
    }
    if (node.contains("traits")) {
        appendUniqueTraitsToArray(out, node["traits"]);
    }
    return out;
}

inline json extractContextTraitsFromNode(const json& node) {
    if (!node.is_object()) return json::array();
    const json structuredCandidates = extractIdentityFeatureCandidatesFromNode(node);
    const json structuredContextTraits =
        deriveIdentityContextTraitsFromFeatureCandidates(structuredCandidates);
    if (structuredContextTraits.is_array() && !structuredContextTraits.empty()) {
        return structuredContextTraits;
    }
    if (node.contains("identity_context_traits")) {
        return parseTraitsValue(node["identity_context_traits"]);
    }
    if (node.contains("updated_traits")) {
        return parseTraitsValue(node["updated_traits"]);
    }
    return json::array();
}

inline std::string extractSceneBriefFromNode(const json& node) {
    if (!node.is_object() || !node.contains("scene_brief") || !node["scene_brief"].is_string()) {
        return std::string();
    }
    return trim(node["scene_brief"].get<std::string>());
}

inline json extractTraitsFromNode(const json& node) {
    if (!node.is_object()) return json::array();
    const json stableTraits = extractStableTraitsFromNode(node);
    if (stableTraits.is_array() && !stableTraits.empty()) return stableTraits;
    const json contextTraits = extractContextTraitsFromNode(node);
    if (contextTraits.is_array() && !contextTraits.empty()) return contextTraits;
    return json::array();
}

inline bool validatePlanEnvelope(const json& envelope, std::string* outReason = nullptr) {
    auto fail = [&](const std::string& reason) -> bool {
        if (outReason) *outReason = reason;
        return false;
    };

    if (!envelope.is_object()) return fail("envelope_not_object");

    if (envelope.contains("compile_status") && envelope["compile_status"].is_string()) {
        const std::string compileStatus = lower(trim(envelope["compile_status"].get<std::string>()));
        if (compileStatus == "not_temporal") {
            return fail("compile_status_not_temporal");
        }
        if (compileStatus == "unsupported" || compileStatus == "needs_clarification") {
            return fail("compile_status_not_usable");
        }
    }

    const json plan = effectivePlan(envelope);
    if (!plan.is_object()) return fail("plan_not_object");
    if (!plan.contains("entities") || !plan["entities"].is_array()) return fail("entities_missing");
    if (!plan.contains("event_catalog") || !plan["event_catalog"].is_array()) return fail("event_catalog_missing");
    if (!plan.contains("operators") || !plan["operators"].is_array()) return fail("operators_missing");
    if (!plan.contains("runtime_variables") || !plan["runtime_variables"].is_array()) return fail("runtime_variables_missing");

    std::unordered_set<std::string> entityKeys;
    for (const auto& ent : plan["entities"]) {
        if (!ent.is_object() || !ent.contains("entity_key") || !ent["entity_key"].is_string()) {
            return fail("entity_key_invalid");
        }
        const std::string key = trim(ent["entity_key"].get<std::string>());
        if (key.empty()) return fail("entity_key_empty");
        entityKeys.insert(key);
    }

    std::unordered_set<std::string> events;
    for (const auto& ev : plan["event_catalog"]) {
        if (!ev.is_string()) return fail("event_catalog_item_invalid");
        const std::string eventName = trim(ev.get<std::string>());
        if (eventName.empty()) return fail("event_catalog_item_empty");
        events.insert(eventName);
    }

    for (const auto& op : plan["operators"]) {
        if (!op.is_object()) return fail("operator_invalid");
        const std::string opType = trim(strField(op, "type"));
        if (opType.empty() || !isAllowedOperatorType(opType)) return fail("operator_type_invalid");
        const json params = op.value("params", json::object());
        if (!params.is_object()) return fail("operator_params_invalid");

        const std::string entity = trim(strField(params, "entity"));
        if (!entity.empty() && entityKeys.find(entity) == entityKeys.end()) {
            return fail("operator_entity_missing");
        }

        const std::string event = trim(strField(params, "event"));
        if (!event.empty() && events.find(event) == events.end()) {
            return fail("operator_event_missing");
        }

        const std::string withoutEvent = trim(strField(params, "without_event"));
        if (!withoutEvent.empty() && events.find(withoutEvent) == events.end()) {
            return fail("operator_without_event_missing");
        }
    }

    for (const auto& rv : plan["runtime_variables"]) {
        if (!rv.is_object()) return fail("runtime_var_invalid");
        const std::string name = trim(strField(rv, "name"));
        const std::string scope = lower(trim(strField(rv, "scope")));
        const std::string typ = lower(trim(strField(rv, "type")));
        if (name.empty()) return fail("runtime_var_name_empty");
        if (scope != "entity" && scope != "global") return fail("runtime_var_scope_invalid");
        if (!isAllowedRuntimeType(typ)) return fail("runtime_var_type_invalid");
        if (!rv.contains("init")) return fail("runtime_var_init_missing");
        if (rv.contains("compute_kind") && rv["compute_kind"].is_string()) {
            if (!isAllowedComputeKind(rv["compute_kind"].get<std::string>())) {
                return fail("runtime_var_compute_kind_invalid");
            }
        }
    }

    return true;
}

inline bool planUsable(const json& envelope) {
    return validatePlanEnvelope(envelope, nullptr);
}

inline bool decisionCacheable(const json& envelope) {
    return planUsable(envelope) || compileStatusValue(envelope, std::string()) == "not_temporal";
}

inline bool extractIntentAssessment(
    const json& envelope,
    bool* outRequiresTemporalEngine,
    std::unordered_set<std::string>* outSelectedOperatorTypes,
    std::string* outReason = nullptr)
{
    auto fail = [&](const std::string& reason) -> bool {
        if (outReason) *outReason = reason;
        return false;
    };

    if (!envelope.is_object()) return fail("envelope_not_object");
    if (!envelope.contains("intent_assessment") || !envelope["intent_assessment"].is_object()) {
        return fail("intent_assessment_missing");
    }

    const json& assessment = envelope["intent_assessment"];
    if (!assessment.contains("requires_temporal_engine") ||
        !assessment["requires_temporal_engine"].is_boolean())
    {
        return fail("intent_requires_temporal_engine_missing");
    }
    if (!assessment.contains("selected_operator_types") ||
        !assessment["selected_operator_types"].is_array())
    {
        return fail("intent_selected_operator_types_missing");
    }

    if (outRequiresTemporalEngine) {
        *outRequiresTemporalEngine = assessment["requires_temporal_engine"].get<bool>();
    }
    if (!outSelectedOperatorTypes) return true;

    outSelectedOperatorTypes->clear();
    for (const auto& item : assessment["selected_operator_types"]) {
        if (!item.is_string()) return fail("intent_selected_operator_type_invalid");
        const std::string typ = lower(trim(item.get<std::string>()));
        if (typ.empty() || !isAllowedOperatorType(typ)) {
            return fail("intent_selected_operator_type_unknown");
        }
        outSelectedOperatorTypes->insert(typ);
    }
    return true;
}

inline bool validateCompilerDecisionConsistency(const json& envelope, std::string* outReason) {
    auto fail = [&](const std::string& reason) -> bool {
        if (outReason) *outReason = reason;
        return false;
    };

    if (!envelope.is_object()) return fail("envelope_not_object");

    const std::string compileStatus = compileStatusValue(envelope, std::string());
    if (compileStatus.empty()) return fail("compile_status_missing");
    if (compileStatus != "ok" &&
        compileStatus != "not_temporal" &&
        compileStatus != "unsupported" &&
        compileStatus != "needs_clarification")
    {
        return fail("compile_status_invalid");
    }

    if (!envelope.contains("prompt_fingerprint") || !envelope["prompt_fingerprint"].is_object()) {
        return fail("prompt_fingerprint_missing");
    }

    bool requiresTemporalEngine = false;
    std::unordered_set<std::string> selectedOperatorTypes;
    std::string intentReason;
    if (!extractIntentAssessment(
            envelope,
            &requiresTemporalEngine,
            &selectedOperatorTypes,
            &intentReason))
    {
        return fail(intentReason);
    }

    const json rawPlan = extractPlan(envelope);

    if (compileStatus == "not_temporal") {
        if (requiresTemporalEngine) {
            return fail("not_temporal_requires_temporal_engine_true");
        }
        if (!selectedOperatorTypes.empty()) {
            return fail("not_temporal_selected_operator_types_not_empty");
        }
        if (rawPlan.is_object() && !rawPlan.empty()) {
            return fail("not_temporal_plan_must_be_empty");
        }
        return true;
    }

    if (compileStatus == "unsupported" || compileStatus == "needs_clarification") {
        if (rawPlan.is_object() && !rawPlan.empty()) {
            return fail("non_ok_plan_must_be_empty");
        }
        return true;
    }

    if (!requiresTemporalEngine) {
        return fail("ok_requires_temporal_engine_false");
    }

    std::string planReason;
    if (!validatePlanEnvelope(envelope, &planReason)) {
        return fail("plan_invalid:" + planReason);
    }

    const json plan = effectivePlan(envelope);
    if (!plan.is_object()) return fail("plan_not_object");

    std::unordered_set<std::string> planOperatorTypes;
    if (plan.contains("operators") && plan["operators"].is_array()) {
        for (const auto& op : plan["operators"]) {
            if (!op.is_object()) return fail("operator_invalid");
            const std::string typ = lower(trim(strField(op, "type")));
            if (typ.empty() || !isAllowedOperatorType(typ)) {
                return fail("operator_type_invalid");
            }
            planOperatorTypes.insert(typ);
        }
    }

    if (planOperatorTypes.empty()) {
        return fail("ok_plan_has_no_operators");
    }
    if (selectedOperatorTypes != planOperatorTypes) {
        return fail("intent_selected_operator_types_mismatch");
    }
    return true;
}

inline std::string compileModelForFamily(const std::string& modelFamily) {
    return lower(trim(modelFamily)) == "core" ? "GLM-4.6V-Flash" : "gpt-5.1";
}

inline json compileInput(
    const std::string& sourcePrompt,
    const std::string& promptCore,
    const std::string& alertCondition,
    const std::string& negativeCondition,
    const std::string& inputType,
    const std::string& language,
    const std::string& sourceType,
    int sourceId,
    const std::string& timezone)
{
    const json operatorSelectionHints = {
        { "decision_rule", "The LLM is the only authority that decides whether the request should use temporal operators or return not_temporal for legacy inference." },
        { "do_not_force_temporal", "If the request is only a local single-batch detection or description and no allowed temporal operator adds real value, return compile_status=not_temporal instead of approximating with generic presence." },
        { "operator_semantics", {
            { "cross_camera_track_after_trigger", {
                { "semantic_intent", "Continue searching or tracking the same target across other cameras after a trigger on the source camera." },
                { "positive_cues", json::array({
                    "look for in other cameras", "find in all cameras", "check the other cameras",
                    "see if appears in other cameras", "track across cameras", "continue tracking after alert",
                    "procurar nas outras cameras", "buscar em todas as cameras", "rastrear em outras cameras",
                    "ver se aparece nas outras cameras", "buscar en otras camaras", "rastrear entre camaras"
                })},
                { "negative_cues", json::array({
                    "local alert only", "only this camera", "detect in this scene", "alert when seen on this camera"
                })}
            }},
            { "stopped_for_more_than_without_event", {
                { "semantic_intent", "The same entity remains stopped or waiting for a minimum duration without another event happening." },
                { "positive_cues", json::array({
                    "stopped for", "idle for", "parked for", "without leaving", "without occupant exit",
                    "parado por", "sem sair", "sem desembarque", "detenido por", "sin salir"
                })}
            }},
            { "no_event_for_duration", {
                { "semantic_intent", "A specific event fails to happen for a duration." },
                { "positive_cues", json::array({
                    "no event for", "did not happen for", "missing for", "without event for",
                    "sem evento por", "nao aconteceu por", "ausente por", "sin evento por"
                })}
            }},
            { "seen_n_times_in_window_by_entity", {
                { "semantic_intent", "The same identified entity repeats an event N times inside a time window." },
                { "positive_cues", json::array({
                    "same person n times", "same vehicle repeatedly", "same entity within window",
                    "mesma pessoa", "mesmo veiculo", "repetidamente", "misma persona", "mismo vehiculo"
                })}
            }},
            { "count_events_in_window", {
                { "semantic_intent", "Count event occurrences inside a time window, optionally without identity continuity." },
                { "positive_cues", json::array({
                    "how many times in", "count within", "more than n events in",
                    "quantas vezes em", "contar em janela", "cuantas veces en"
                })}
            }},
            { "entity_present", {
                { "semantic_intent", "Persistent presence semantics that truly require temporal state, not a simple one-shot detection." },
                { "negative_cues", json::array({
                    "look for a person with a gun", "detect a vehicle", "current frame detection only"
                })}
            }},
            { "entity_absent", {
                { "semantic_intent", "Temporal absence of an entity for a required duration." },
                { "positive_cues", json::array({
                    "absent for", "missing for", "nao apareceu por", "ausente por", "ausente durante"
                })}
            }},
            { "schedule_at_time", {
                { "semantic_intent", "Run or alert at a scheduled local time." }
            }},
            { "summary_window", {
                { "semantic_intent", "Summarize activity over a daily, hourly, or custom reporting window." }
            }}
        }}
    };

    return json{
        { "schema_version", "temporal-compile-input/1.0" },
        { "source_prompt", sourcePrompt },
        { "prompt_fields", {
            { "prompt_core", promptCore },
            { "alert_condition", alertCondition },
            { "negative_condition", negativeCondition },
            { "input_type", inputType },
            { "language", language }
        }},
        { "execution_context", {
            { "source_type", sourceType },
            { "source_id", sourceId },
            { "timezone", timezone }
        }},
        { "allowed_operator_types", json::array({
            "stopped_for_more_than_without_event","seen_n_times_in_window_by_entity",
            "schedule_at_time","summary_window","entity_present","entity_absent",
            "count_events_in_window","no_event_for_duration",
            "cross_camera_track_after_trigger",
            "custom_expression"
        })},
        { "operator_selection_hints", operatorSelectionHints },
        { "defaults", {
            { "entity_scope", "per_camera" },
            { "state_ttl_seconds", 43200 },
            { "entity_retention_seconds", 43200 },
            { "forget_entity_missing_for_seconds", 300 }
        }}
    };
}

inline std::string compilerSystemPrompt() {
    return R"(SYSTEM GUIDELINES FOR OPERATOR/EVENT/VARIABLE EXTRACTION
You are TemporalPlanCompiler v1.

1) Operator selection rules
- First decide whether the request should use the Temporal Engine at all.
- If no allowed temporal operator is a faithful semantic fit, set compile_status="not_temporal", set intent_assessment.requires_temporal_engine=false, keep selected_operator_types empty, and do not return a plan_json object.
- Use only operator types in allowed_operator_types.
- For each chosen operator, fill required params exactly.
- operators MUST use the field name "type" exactly, never "operator_type".
- Use "operator_id" for operator identifier; do not use "operator_key" in plan_json.
- If user intent needs unsupported operator, set compile_status="unsupported".
- Treat INPUT_JSON.operator_selection_hints as semantic guidance and multilingual cues. They are hints, not deterministic rules.

2) Operator dictionary (semantic + params + example)
- stopped_for_more_than_without_event
  required_params: entity, seconds, without_event, zone(optional)
  example: vehicle stopped >300s without occupant_exit at front_gate
- seen_n_times_in_window_by_entity
  required_params: entity, event, n, window_seconds, zone(optional)
  example: same person picked_phone 3 times in 3600s
- schedule_at_time
  required_params: time_local, timezone
  example: trigger report at 17:00 America/Sao_Paulo
- summary_window
  required_params: window(daily|hourly|custom), start_local(optional), end_local(optional), timezone
  example: summarize 08:00-17:00 daily
- entity_present
  required_params: entity, zone(optional), min_duration_seconds(optional)
- entity_absent
  required_params: entity, zone(optional), duration_seconds
- count_events_in_window
  required_params: event, window_seconds, threshold, entity(optional), zone(optional)
- no_event_for_duration
  required_params: event, duration_seconds, entity(optional), zone(optional)
- cross_camera_track_after_trigger
  required_params: scope(job_step), trigger_mode(alert_condition_true|event_observed), watch_ttl_seconds, alert_on_match
  optional_params: trigger_event, share_entity_types
  example: after a robbery alert on one camera, share suspect traits to every camera in the same job step and alert on matches
  use_only_when: the user explicitly asks to search, track, follow or analyze across other cameras / all cameras after a trigger
- Prompts about armed people, weapons, guns, firearms, knives or similar threats must use an explicit threat event or threat-specific entity.
- Never reduce threat/weapon prompts to generic presence, entry, exit or stopped operators on plain person entities.
- cross_camera_track_after_trigger is opt-in only. If the prompt is only about local detection/alert in the current camera, DO NOT include it.
- Prefer compile_status="not_temporal" over weakly approximating a local single-batch detection with entity_present or other generic operators.

3) Event catalog rules
- Events must be atomic and observable from vision input.
- Event names in snake_case.
- event_catalog MUST be an array of plain snake_case strings only.
- Never return objects inside event_catalog.
- If event metadata is useful, put it in entities, operators or plan_explain_json, not in event_catalog.
- Do not create vague events (example: strange_behavior) unless explicitly requested.
- Use entered_zone and left_zone only as events/runtime-variable inputs, never as operator.type.
- For entry/exit alerts, prefer seen_n_times_in_window_by_entity over event entered_zone/left_zone.

4) Runtime variables rules
- Create only variables needed by operators/output_policy.
- Each variable must have: name, scope(entity|global), type(int|float|bool|string|array|timestamp), init, compute_kind, compute_params.
- Allowed compute_kind: event_counter, last_event_timestamp, duration_since_event, presence_flag, window_buffer.
- compute_kind must use those canonical names exactly. Names like first_seen_ts and last_seen_ts are variable names, not compute_kind values.
- Prefer canonical vars: first_seen_ts, last_seen_ts, current_zone, stopped_since_ts, event_count_<window>, last_event_ts.
- Do not create unused variables.

5) Identity rules
- Any entity type can use identity tracking (person, vehicle, object, animal, custom).
- If track_identity=true, entity is validated using identity_policy thresholds.

6) Validation invariants
- Every operator.entity must exist in entities.entity_key.
- Every operator.event/without_event must exist in event_catalog.
- Every runtime variable must be referenced by at least one operator or output policy.

Mandatory rules:
- Entities of interest can be any type (person, vehicle, object, animal, group, scene_condition, custom).
- Define one global identity_policy and apply it to every entity with track_identity=true.
- Define event_catalog, operators and runtime_variables based on user request.
- Use ONLY allowed_operator_types.
- Use cross_camera_track_after_trigger ONLY when INPUT_JSON explicitly asks to continue the search or tracking across other cameras / all cameras after a trigger.
- Use compile_status="not_temporal" when the request should remain in the legacy inference path with no temporal operator.
- If required operator is missing, return compile_status="unsupported" and fill missing_operator_types.
- If critical ambiguity exists, return compile_status="needs_clarification" and fill blockers.
- No markdown. Return pure JSON only.
)";
}

inline std::string compilerUserPrompt(const json& in) {
    return std::string(R"(INPUT_JSON:
)") + in.dump(2) + R"(

OUTPUT_JSON_EXATO:
{
  "compile_status": "ok|not_temporal|needs_clarification|unsupported",
  "compile_confidence": 0.0,
  "intent_assessment": {
    "requires_temporal_engine": true,
    "selected_operator_types": ["seen_n_times_in_window_by_entity"],
    "reason": "..."
  },
  "missing_operator_types": [],
  "blockers": [],
  "plan_json": {
    "schema_version": "temporal-plan/1.0",
    "plan_id": "tp_xxx",
    "prompt_fingerprint": {
      "prompt_core": "...",
      "alert_condition": "...",
      "negative_condition": "...",
      "input_type": "...",
      "language": "..."
    },
    "identity_policy": {
      "entity_scope": "per_camera",
      "match_threshold": 0.80,
      "new_entity_threshold": 0.62,
      "unknown_threshold": 0.45,
      "max_identity_age_seconds": 43200,
      "discovery_mode": "guided",
      "max_inferred_support_entities": 3
    },
    "entities": [],
    "event_catalog": ["entered_zone", "left_zone"],
    "operators": [
      {
        "operator_id": "op_example",
        "type": "seen_n_times_in_window_by_entity",
        "params": { "entity": "person", "event": "entered_zone", "n": 3, "window_seconds": 3600 }
      }
    ],
    "runtime_variables": [
      {
        "name": "example_counter",
        "scope": "entity",
        "type": "int",
        "init": 0,
        "compute_kind": "event_counter",
        "compute_params": { "event": "example_event", "window_seconds": 3600 }
      }
    ],
    "retention_policy": {
      "state_ttl_seconds": 43200,
      "forget_entity_missing_for_seconds": 300
    },
    "output_policy": {
      "mode": "alert|report|alert_and_report",
      "alert_cooldown_seconds": 60
    }
  },
  "plan_explain_json": {
    "why_entities": [],
    "why_identity_policy": {},
    "why_events": [],
    "why_operators": [],
    "why_runtime_variables": [],
    "assumptions": [],
    "risk_notes": []
  }
}

When compile_status="not_temporal", keep intent_assessment.requires_temporal_engine=false, selected_operator_types=[], and set plan_json to null.
)";
}

inline json fallbackPlanEnvelope(
    const std::string& promptCore,
    const std::string& alertCondition,
    const std::string& negativeCondition,
    const std::string& inputType,
    const std::string& language,
    const std::string& timezone,
    const std::string& planHash)
{
    const std::string merged = lower(promptCore + " " + alertCondition + " " + negativeCondition);
    const bool vehicle = merged.find("carro") != std::string::npos || merged.find("vehicle") != std::string::npos;
    const bool phone = merged.find("telefone") != std::string::npos || merged.find("phone") != std::string::npos;
    const bool entry = looksLikeEntryTrackingPrompt(merged);
    const bool crossCameraTrack = looksLikeCrossCameraTrackingPrompt(merged);
    const bool threatEvidence = looksLikeThreatEvidencePrompt(merged);
    const int occurrenceTarget = extractOccurrenceTargetFromPrompt(merged, 0);
    const std::string trackedEntity = vehicle ? "vehicle" : "person";
    std::string runtimeCounterEvent = "present";
    json operators = json::array();
    if (!threatEvidence) {
        json op = json{
            { "operator_id", "op_count" },
            { "type", "count_events_in_window" },
            { "params", { { "event", "present" }, { "window_seconds", 300 }, { "threshold", 1 }, { "entity", trackedEntity } } }
        };
        if (vehicle && (merged.find("5") != std::string::npos || merged.find("cinco") != std::string::npos)) {
            runtimeCounterEvent = "stopped";
            op = json{
                { "operator_id", "op_stop" },
                { "type", "stopped_for_more_than_without_event" },
                { "params", { { "entity", "vehicle" }, { "seconds", 300 }, { "without_event", "occupant_exit" } } }
            };
        } else if (phone) {
            runtimeCounterEvent = "picked_phone";
            const int phoneN = occurrenceTarget >= 2 ? occurrenceTarget : 3;
            op = json{
                { "operator_id", "op_phone" },
                { "type", "seen_n_times_in_window_by_entity" },
                { "params", { { "entity", "person" }, { "event", "picked_phone" }, { "n", phoneN }, { "window_seconds", 3600 } } }
            };
        } else if (entry) {
            runtimeCounterEvent = "entered_zone";
            if (occurrenceTarget >= 2) {
                op = json{
                    { "operator_id", "op_entry_n" },
                    { "type", "seen_n_times_in_window_by_entity" },
                    { "params", { { "entity", trackedEntity }, { "event", "entered_zone" }, { "n", occurrenceTarget }, { "window_seconds", 43200 } } }
                };
            } else {
                op = json{
                    { "operator_id", "op_entry_event" },
                    { "type", "seen_n_times_in_window_by_entity" },
                    { "params", {
                        { "entity", trackedEntity },
                        { "event", "entered_zone" },
                        { "n", 1 },
                        { "window_seconds", 43200 },
                        { "trigger_mode", "event_observed" }
                    } }
                };
            }
        }
        operators.push_back(std::move(op));
    }
    if (crossCameraTrack) {
        json crossParams = {
            { "scope", "job_step" },
            { "trigger_mode", "alert_condition_true" },
            { "watch_ttl_seconds", 900 },
            { "alert_on_match", true }
        };
        const json shareEntityTypes = inferCrossCameraShareEntityTypes(merged);
        if (shareEntityTypes.is_array() && !shareEntityTypes.empty()) {
            crossParams["share_entity_types"] = shareEntityTypes;
        }
        operators.push_back({
            { "operator_id", "op_cross_camera_track" },
            { "type", "cross_camera_track_after_trigger" },
            { "params", std::move(crossParams) }
        });
    }

    json plan = {
        { "schema_version", "temporal-plan/1.0" },
        { "plan_id", std::string("tp_") + u64hex(fnv1a64(planHash)) },
        { "plan_hash", planHash },
        { "prompt_fingerprint", {
            { "prompt_core", promptCore }, { "alert_condition", alertCondition }, { "negative_condition", negativeCondition },
            { "input_type", inputType }, { "language", language }
        }},
        { "identity_policy", {
            { "entity_scope", "per_camera" }, { "match_threshold", 0.80 }, { "new_entity_threshold", 0.62 },
            { "unknown_threshold", 0.45 }, { "max_identity_age_seconds", 43200 }, { "discovery_mode", "guided" },
            { "max_inferred_support_entities", 3 }
        }},
        { "entities", json::array({ { { "entity_key", trackedEntity }, { "entity_type", trackedEntity }, { "track_identity", true } } }) },
        { "event_catalog", json::array({ "present", "stopped", "occupant_exit", "picked_phone", "entered_zone", "left_zone" }) },
        { "operators", std::move(operators) },
        { "runtime_variables", json::array({
            { { "name", "event_count_lifetime" }, { "scope", "entity" }, { "type", "int" }, { "init", 0 }, { "compute_kind", "event_counter" }, { "compute_params", { { "event", runtimeCounterEvent }, { "window_seconds", 0 } } } },
            { { "name", "last_event_ts" }, { "scope", "entity" }, { "type", "timestamp" }, { "init", nullptr }, { "compute_kind", "last_event_timestamp" }, { "compute_params", { { "event", runtimeCounterEvent } } } }
        })},
        { "retention_policy", {
            { "state_ttl_seconds", 43200 },
            { "entity_retention_seconds", 43200 },
            { "forget_entity_missing_for_seconds", 300 }
        } },
        { "output_policy", { { "mode", "alert_and_report" }, { "alert_cooldown_seconds", 60 } } }
    };
    return json{
        { "compile_status", "ok" },
        { "compile_confidence", 0.35 },
        { "missing_operator_types", json::array() },
        { "blockers", json::array() },
        { "plan_json", plan },
        { "plan_explain_json", {
            { "why_entities", json::array({ "Fallback deterministic template." }) },
            { "why_operators", threatEvidence
                ? json::array({ "Threat/weapon prompt detected; fallback kept only safe non-alerting operators." })
                : json::array({ "Operator selected from prompt keywords." }) }
        }}
    };
}

inline json defaultState() {
    return json{
        { "schema_version", "temporal-state/1.0" },
        { "events", json::array() },
        { "entities", json::object() },
        { "identity_memory", json::array() },
        { "global_vars", json::object() },
        { "meta", {
            { "last_alert_ts_utc", "" },
            { "last_report_ts_utc", "" },
            { "last_round_evidence_keys", json::array() },
            { "last_round_candidate_decisions", json::array() },
            { "operator_state", json::object() }
        } }
    };
}

inline void ensureState(json& st) {
    if (!st.is_object()) { st = defaultState(); return; }
    if (!st.contains("events") || !st["events"].is_array()) st["events"] = json::array();
    if (!st.contains("entities") || !st["entities"].is_object()) st["entities"] = json::object();
    if (!st.contains("identity_memory") || !st["identity_memory"].is_array()) st["identity_memory"] = json::array();
    if (!st.contains("global_vars") || !st["global_vars"].is_object()) st["global_vars"] = json::object();
    if (!st.contains("meta") || !st["meta"].is_object()) st["meta"] = json::object();
    if (!st["meta"].contains("last_alert_ts_utc") || !st["meta"]["last_alert_ts_utc"].is_string()) st["meta"]["last_alert_ts_utc"] = "";
    if (!st["meta"].contains("last_report_ts_utc") || !st["meta"]["last_report_ts_utc"].is_string()) st["meta"]["last_report_ts_utc"] = "";
    if (!st["meta"].contains("last_round_evidence_keys") || !st["meta"]["last_round_evidence_keys"].is_array()) {
        st["meta"]["last_round_evidence_keys"] = json::array();
    }
    if (!st["meta"].contains("last_round_candidate_decisions") ||
        !st["meta"]["last_round_candidate_decisions"].is_array())
    {
        st["meta"]["last_round_candidate_decisions"] = json::array();
    }
    if (!st["meta"].contains("operator_state") || !st["meta"]["operator_state"].is_object()) st["meta"]["operator_state"] = json::object();
}

inline std::string normalizeEventName(const std::string& rawEvent);

inline void recordLastRoundEvidenceKey(json& st, const std::string& rawKey) {
    ensureState(st);
    const std::string key = trim(rawKey);
    if (key.empty()) return;
    for (const auto& item : st["meta"]["last_round_evidence_keys"]) {
        if (!item.is_string()) continue;
        if (trim(item.get<std::string>()) == key) return;
    }
    st["meta"]["last_round_evidence_keys"].push_back(key);
}

inline std::vector<std::string> extractLastRoundEvidenceKeys(const json& st) {
    std::vector<std::string> out;
    if (!st.is_object() ||
        !st.contains("meta") ||
        !st["meta"].is_object() ||
        !st["meta"].contains("last_round_evidence_keys") ||
        !st["meta"]["last_round_evidence_keys"].is_array())
    {
        return out;
    }

    out.reserve(st["meta"]["last_round_evidence_keys"].size());
    for (const auto& item : st["meta"]["last_round_evidence_keys"]) {
        if (!item.is_string()) continue;
        const std::string key = trim(item.get<std::string>());
        if (!key.empty()) out.push_back(key);
    }
    return out;
}

inline void recordLastRoundCandidateDecision(json& st,
                                            const TemporalEvidenceCandidate& candidate,
                                            const std::string& status,
                                            const std::string& resolvedEntityId = std::string(),
                                            const std::string& resolvedTsUtc = std::string())
{
    ensureState(st);
    json entry = {
        { "status", trim(status) },
        { "event", trim(candidate.eventName) },
        { "candidate_entity_id", trim(candidate.entityId) },
        { "resolved_entity_id", trim(resolvedEntityId) },
        { "timestamp_utc", trim(resolvedTsUtc).empty() ? trim(candidate.timestampUtcIso) : trim(resolvedTsUtc) },
        { "evidence_key", trim(candidate.evidenceKey) }
    };
    if (!trim(candidate.zone).empty()) entry["zone"] = trim(candidate.zone);
    if (candidate.frameIndex >= 0) entry["frame_index"] = candidate.frameIndex;
    if (!trim(candidate.timestampName).empty()) entry["timestamp_name"] = trim(candidate.timestampName);
    if (!trim(candidate.frameTimestampInSegment).empty()) {
        entry["frame_timestamp_in_segment"] = trim(candidate.frameTimestampInSegment);
    }
    st["meta"]["last_round_candidate_decisions"].push_back(std::move(entry));
}

inline json extractLastRoundCandidateDecisions(const json& st) {
    if (!st.is_object() ||
        !st.contains("meta") ||
        !st["meta"].is_object() ||
        !st["meta"].contains("last_round_candidate_decisions") ||
        !st["meta"]["last_round_candidate_decisions"].is_array())
    {
        return json::array();
    }
    return st["meta"]["last_round_candidate_decisions"];
}

inline json extractTemporalEvidenceRef(const json& node) {
    json out = json::object();
    if (!node.is_object()) return out;

    auto copyStringField = [&](const char* key) {
        if (node.contains(key) && node[key].is_string()) {
            const std::string value = trim(node[key].get<std::string>());
            if (!value.empty()) out[key] = value;
        }
    };

    copyStringField("temporal_evidence_key");
    copyStringField("frame_timestamp_in_segment");
    copyStringField("timestamp_name");

    if (node.contains("frame_index")) {
        if (node["frame_index"].is_number_integer()) {
            out["frame_index"] = node["frame_index"].get<int>();
        } else if (node["frame_index"].is_string()) {
            const std::string raw = trim(node["frame_index"].get<std::string>());
            if (!raw.empty()) {
                try {
                    out["frame_index"] = std::stoi(raw);
                } catch (...) {
                }
            }
        }
    }

    return out;
}

inline void applyTemporalEvidenceRefToEntityState(
    json& entityState,
    const json& evidenceRef,
    const std::string& tsUtc)
{
    if (!entityState.is_object() || !evidenceRef.is_object()) return;

    if (evidenceRef.contains("temporal_evidence_key") && evidenceRef["temporal_evidence_key"].is_string()) {
        const std::string key = trim(evidenceRef["temporal_evidence_key"].get<std::string>());
        if (!key.empty()) entityState["last_evidence_key"] = key;
    }
    if (evidenceRef.contains("frame_index") && evidenceRef["frame_index"].is_number_integer()) {
        entityState["last_frame_index"] = evidenceRef["frame_index"].get<int>();
    }
    if (evidenceRef.contains("frame_timestamp_in_segment") &&
        evidenceRef["frame_timestamp_in_segment"].is_string())
    {
        const std::string value = trim(evidenceRef["frame_timestamp_in_segment"].get<std::string>());
        if (!value.empty()) entityState["last_frame_timestamp_in_segment"] = value;
    }
    if (evidenceRef.contains("timestamp_name") && evidenceRef["timestamp_name"].is_string()) {
        const std::string value = trim(evidenceRef["timestamp_name"].get<std::string>());
        if (!value.empty()) entityState["last_timestamp_name"] = value;
    }
    if (!trim(tsUtc).empty()) {
        entityState["last_evidence_ts_utc"] = trim(tsUtc);
    }
}

inline void appendEvent(json& st,
                        const std::string& eventName,
                        const std::string& entityId,
                        const std::string& tsUtc,
                        const std::string& zone,
                        const json& evidenceRef = json()) {
    ensureState(st);
    const std::string normalizedEvent = normalizeEventName(eventName);
    if (trim(normalizedEvent).empty()) return;
    json ev = {
        { "event", trim(normalizedEvent) },
        { "entity_id", trim(entityId) },
        { "ts_utc", trim(tsUtc).empty() ? nowIso() : trim(tsUtc) }
    };
    if (!trim(zone).empty()) ev["zone"] = trim(zone);

    if (evidenceRef.is_object()) {
        if (evidenceRef.contains("temporal_evidence_key") &&
            evidenceRef["temporal_evidence_key"].is_string())
        {
            const std::string value = trim(evidenceRef["temporal_evidence_key"].get<std::string>());
            if (!value.empty()) {
                ev["temporal_evidence_key"] = value;
                recordLastRoundEvidenceKey(st, value);
            }
        }
        if (evidenceRef.contains("frame_index") && evidenceRef["frame_index"].is_number_integer()) {
            ev["frame_index"] = evidenceRef["frame_index"].get<int>();
        }
        if (evidenceRef.contains("frame_timestamp_in_segment") &&
            evidenceRef["frame_timestamp_in_segment"].is_string())
        {
            const std::string value = trim(evidenceRef["frame_timestamp_in_segment"].get<std::string>());
            if (!value.empty()) ev["frame_timestamp_in_segment"] = value;
        }
        if (evidenceRef.contains("timestamp_name") && evidenceRef["timestamp_name"].is_string()) {
            const std::string value = trim(evidenceRef["timestamp_name"].get<std::string>());
            if (!value.empty()) ev["timestamp_name"] = value;
        }
    }

    st["events"].push_back(std::move(ev));
    if (st["events"].size() > 16000) st["events"].erase(st["events"].begin(), st["events"].begin() + 2000);
}

inline void touchEntity(
    json& st,
    const std::string& entityId,
    const std::string& tsUtc,
    const std::string& zone,
    const json& traits,
    int continuityGapSeconds = 300)
{
    ensureState(st);
    const std::string id = trim(entityId);
    if (id.empty()) return;
    if (!st["entities"].contains(id) || !st["entities"][id].is_object()) st["entities"][id] = json::object();
    json& e = st["entities"][id];
    const std::string normalizedTs = trim(tsUtc).empty() ? nowIso() : trim(tsUtc);
    const std::string previousLastSeen = strField(e, "last_seen_ts");
    const std::string previousPresentSince = strField(e, "present_since_ts");
    const int gapThreshold = continuityGapSeconds > 0 ? continuityGapSeconds : 300;
    bool startNewPresenceSession = previousPresentSince.empty();
    if (!previousLastSeen.empty() && normalizedTs > previousLastSeen) {
        const long long gapSeconds = ageSeconds(previousLastSeen, normalizedTs);
        if (gapSeconds < 0 || gapSeconds > gapThreshold) startNewPresenceSession = true;
    }

    if (!e.contains("vars") || !e["vars"].is_object()) e["vars"] = json::object();
    if (!e.contains("first_seen_ts") || !e["first_seen_ts"].is_string()) e["first_seen_ts"] = normalizedTs;
    if (startNewPresenceSession) {
        e["present_since_ts"] = normalizedTs;
    } else if (!previousPresentSince.empty()) {
        e["present_since_ts"] = previousPresentSince;
    } else if (!previousLastSeen.empty()) {
        e["present_since_ts"] = previousLastSeen;
    } else {
        e["present_since_ts"] = normalizedTs;
    }
    if (previousLastSeen.empty() || normalizedTs > previousLastSeen) {
        e["last_seen_ts"] = normalizedTs;
        if (!trim(zone).empty()) e["current_zone"] = trim(zone);
        if (traits.is_array() && !traits.empty()) {
            json mergedTraits = json::array();
            if (e.contains("key_traits")) appendUniqueTraitsToArray(mergedTraits, e["key_traits"]);
            appendUniqueTraitsToArray(mergedTraits, traits);
            if (!mergedTraits.empty()) e["key_traits"] = mergedTraits;
        }
    } else {
        e["last_seen_ts"] = previousLastSeen;
    }
    e["present_now"] = true;
    e.erase("absent_since_ts");
}

inline void markEntityAbsent(
    json& st,
    const std::string& entityId,
    const std::string& tsUtc,
    const std::string& zone = std::string())
{
    ensureState(st);
    const std::string id = trim(entityId);
    if (id.empty() ||
        !st["entities"].contains(id) ||
        !st["entities"][id].is_object())
    {
        return;
    }

    json& e = st["entities"][id];
    const std::string normalizedTs = trim(tsUtc).empty() ? nowIso() : trim(tsUtc);
    const bool hadExplicitPresentFlag =
        e.contains("present_now") && e["present_now"].is_boolean();
    const bool wasPresent = hadExplicitPresentFlag
        ? e["present_now"].get<bool>()
        : !trim(strField(e, "last_seen_ts")).empty();
    const std::string previousAbsentSince = strField(e, "absent_since_ts");
    const std::string previousLastAbsent = strField(e, "last_absent_ts");

    e["present_now"] = false;
    if (wasPresent || previousAbsentSince.empty()) {
        e["absent_since_ts"] = normalizedTs;
    } else {
        e["absent_since_ts"] = previousAbsentSince;
    }
    if (previousLastAbsent.empty() || normalizedTs > previousLastAbsent) {
        e["last_absent_ts"] = normalizedTs;
    } else {
        e["last_absent_ts"] = previousLastAbsent;
    }
    if (!trim(zone).empty()) e["last_absent_zone"] = trim(zone);
}

inline std::string sanitizeToken(const std::string& value, const std::string& fallback = "entity") {
    std::string out;
    out.reserve(value.size());
    for (unsigned char ch : value) {
        if (std::isalnum(ch)) out.push_back(static_cast<char>(std::tolower(ch)));
        else if (ch == '_' || ch == '-' || ch == '#') out.push_back('_');
    }
    while (!out.empty() && out.front() == '_') out.erase(out.begin());
    while (!out.empty() && out.back() == '_') out.pop_back();
    return out.empty() ? fallback : out;
}

inline std::string normalizeEventName(const std::string& rawEvent) {
    const std::string raw = trim(rawEvent);
    if (raw.empty()) return raw;

    std::string key;
    key.reserve(raw.size());
    for (unsigned char ch : raw) {
        if (std::isalnum(ch)) key.push_back(static_cast<char>(std::tolower(ch)));
        else if (ch == '_' || ch == '-' || ch == ' ') key.push_back('_');
    }
    while (!key.empty() && key.front() == '_') key.erase(key.begin());
    while (!key.empty() && key.back() == '_') key.pop_back();

    if (key == "entered_zone" || key == "enter" || key == "entered" || key == "entry" ||
        key == "entrou" || key == "entrada")
    {
        return "entered_zone";
    }
    if (key == "left_zone" || key == "leave" || key == "left" || key == "exit" ||
        key == "exited" || key == "saiu" || key == "saida")
    {
        return "left_zone";
    }
    if (key == "occupant_exit" || key == "occupante_exit" || key == "occupant_left") return "occupant_exit";
    if (key == "present" || key == "presence" || key == "presente") return "present";
    if (key == "stopped" || key == "stop" || key == "parado") return "stopped";
    if (key == "picked_phone" || key == "pick_phone" || key == "phone_pick") return "picked_phone";

    return raw;
}

inline bool isPresentEventName(const std::string& rawEvent) {
    return lower(trim(normalizeEventName(rawEvent))) == "present";
}

inline bool normalizedTokenEndsWith(const std::string& value, const std::string& suffix) {
    return value.size() >= suffix.size() &&
           value.compare(value.size() - suffix.size(), suffix.size(), suffix) == 0;
}

inline bool isAbsenceEventName(const std::string& rawEvent) {
    const std::string eventName = lower(trim(normalizeEventName(rawEvent)));
    if (eventName.empty()) return false;
    return eventName == "left_zone" ||
           eventName == "occupant_exit" ||
           eventName == "entity_absent" ||
           eventName == "absent" ||
           eventName == "lost" ||
           eventName == "not_visible" ||
           eventName == "not_currently_visible" ||
           eventName == "not_visible_this_segment" ||
           eventName == "not_visible_this_batch" ||
           eventName == "not_visible_in_segment" ||
           eventName == "not_visible_in_current_segment" ||
           eventName == "not_visible_in_current_batch" ||
           eventName == "no_longer_visible" ||
           eventName.rfind("no_", 0) == 0 ||
           normalizedTokenEndsWith(eventName, "_lost") ||
           normalizedTokenEndsWith(eventName, "_left") ||
           normalizedTokenEndsWith(eventName, "_exit") ||
           normalizedTokenEndsWith(eventName, "_absent");
}

enum class TemporalEvidenceClass {
    positive_event_evidence,
    presence_evidence,
    meta_state_reference,
    negative_observation,
    scene_only_description
};

inline std::string normalizeEvidenceToken(const std::string& rawToken) {
    const std::string raw = trim(rawToken);
    if (raw.empty()) return raw;

    std::string key;
    key.reserve(raw.size());
    for (unsigned char ch : raw) {
        if (std::isalnum(ch)) key.push_back(static_cast<char>(std::tolower(ch)));
        else if (ch == '_' || ch == '-' || ch == ' ') key.push_back('_');
    }
    while (!key.empty() && key.front() == '_') key.erase(key.begin());
    while (!key.empty() && key.back() == '_') key.pop_back();
    return key;
}

inline bool observationStatusSuggestsNegative(const std::string& rawStatus) {
    const std::string status = normalizeEvidenceToken(rawStatus);
    if (status.empty()) return false;
    return isAbsenceEventName(status) ||
           status == "not_observed" ||
           status == "not_detected" ||
           status == "not_seen" ||
           status == "not_visible" ||
           status == "not_visible_this_segment" ||
           status == "not_visible_this_batch" ||
           status == "no_event" ||
           status == "negative" ||
           status == "negative_observation" ||
           status == "absent" ||
           status == "prior_only" ||
           status == "previous_only" ||
           status == "carry_only" ||
           status == "summary_only" ||
           status == "state_only";
}

inline bool observationTypeSuggestsMetaStateReference(const std::string& rawType) {
    const std::string type = normalizeEvidenceToken(rawType);
    if (type.empty()) return false;
    return type == "event_summary" ||
           type == "cumulative_state_check" ||
           type == "state_reference" ||
           type == "state_summary" ||
           type == "state_check" ||
           type == "prior_state" ||
           type == "carry_state" ||
           type == "history_reference" ||
           type == "history_summary" ||
           type == "temporal_state";
}

inline bool observationTypeSuggestsPresenceEvidence(const std::string& rawType) {
    const std::string type = normalizeEvidenceToken(rawType);
    if (type.empty()) return false;
    return type == "entity_presence" ||
           type == "presence" ||
           type == "present" ||
           type == "is_present" ||
           type == "present_flag" ||
           type == "entity_visible" ||
           type == "target_visible" ||
           type == "visible_entity" ||
           type == "person_present";
}

inline bool observationTypeSuggestsSceneOnlyDescription(const std::string& rawType) {
    const std::string type = normalizeEvidenceToken(rawType);
    if (type.empty()) return false;
    return type == "scene_summary" ||
           type == "scene_context" ||
           type == "scene_description" ||
           type == "scene_observation" ||
           type == "interaction" ||
           type == "movement" ||
           type == "activity_summary";
}

inline bool nodeCarriesAggregateTemporalState(const json& node) {
    if (!node.is_object()) return false;
    for (auto it = node.begin(); it != node.end(); ++it) {
        const std::string key = normalizeEvidenceToken(it.key());
        if (key.empty()) continue;
        if (key.rfind("event_count_", 0) == 0 ||
            key.rfind("last_event_ts_", 0) == 0 ||
            key == "current_count" ||
            key == "previous_count" ||
            key == "delta_count" ||
            key == "crossed_threshold" ||
            key == "event_observed" ||
            key == "state_slice" ||
            key == "prior_state" ||
            key == "carry_state" ||
            key == "state_reference" ||
            key == "aggregated_state" ||
            key == "aggregate_state")
        {
            return true;
        }
        if (key.size() > 6 &&
            (key.find("_prior") != std::string::npos ||
             key.find("_total") != std::string::npos ||
             key.find("_in_segment") != std::string::npos))
        {
            return true;
        }
    }
    return false;
}

inline bool nodeHasDirectTemporalAnchor(const json& node) {
    if (!node.is_object()) return false;
    auto hasNonEmptyString = [&](const char* key) -> bool {
        return node.contains(key) &&
               node[key].is_string() &&
               !trim(node[key].get<std::string>()).empty();
    };
    if (hasNonEmptyString("ts_utc") ||
        hasNonEmptyString("timestamp") ||
        hasNonEmptyString("time") ||
        hasNonEmptyString("timestamp_name") ||
        hasNonEmptyString("frame_timestamp_in_segment"))
    {
        return true;
    }
    if (node.contains("frame_index")) {
        if (node["frame_index"].is_number_integer()) return true;
        if (node["frame_index"].is_string() &&
            !trim(node["frame_index"].get<std::string>()).empty())
        {
            return true;
        }
    }
    return false;
}

inline bool isEngineStructuralEventName(const std::string& rawEvent) {
    const std::string eventName = lower(trim(normalizeEventName(rawEvent)));
    if (eventName.empty()) return false;
    return eventName == "present" ||
           eventName == "entered_zone" ||
           eventName == "left_zone" ||
           eventName == "stopped" ||
           eventName == "occupant_exit" ||
           eventName == "picked_phone";
}

inline bool textSuggestsNoVisiblePerson(const std::string& rawText) {
    const std::string lowered = lower(trim(rawText));
    if (lowered.empty()) return false;
    return lowered.find("nenhuma pessoa") != std::string::npos ||
           lowered.find("nenhum homem") != std::string::npos ||
           lowered.find("sem pessoa") != std::string::npos ||
           lowered.find("nao ha pessoa") != std::string::npos ||
           lowered.find("no person") != std::string::npos ||
           lowered.find("nobody") != std::string::npos ||
           lowered.find("no one visible") != std::string::npos;
}

inline bool textSuggestsNoVisibleTarget(const std::string& rawText) {
    const std::string lowered = lower(trim(rawText));
    if (lowered.empty()) return false;
    return textSuggestsNoVisiblePerson(rawText) ||
           lowered.find("no_vehicle") != std::string::npos ||
           lowered.find("no vehicle") != std::string::npos ||
           lowered.find("no vehicles") != std::string::npos ||
           lowered.find("no_vehicle_visible") != std::string::npos ||
           lowered.find("no_vehicles_visible") != std::string::npos ||
           lowered.find("no vehicle visible") != std::string::npos ||
           lowered.find("no vehicles visible") != std::string::npos ||
           lowered.find("no entities visible") != std::string::npos ||
           lowered.find("no_entity") != std::string::npos ||
           lowered.find("no entity") != std::string::npos ||
           lowered.find("no target") != std::string::npos ||
           lowered.find("vehicle_none") != std::string::npos ||
           lowered.find("empty_road") != std::string::npos ||
           lowered.find("zone_empty") != std::string::npos ||
           lowered.find("empty_zone") != std::string::npos ||
           lowered.find("zone empty") != std::string::npos ||
           lowered.find("area remains empty") != std::string::npos ||
           lowered.find("area is empty") != std::string::npos ||
           lowered.find("empty road") != std::string::npos ||
           lowered.find("road remains empty") != std::string::npos ||
           lowered.find("road stayed empty") != std::string::npos ||
           lowered.find("road is empty") != std::string::npos ||
           lowered.find("not_visible") != std::string::npos ||
           lowered.find("not visible") != std::string::npos ||
           lowered.find("not currently visible") != std::string::npos ||
           lowered.find("no longer visible") != std::string::npos ||
           lowered.find("no car") != std::string::npos ||
           lowered.find("no cars") != std::string::npos ||
           lowered.find("no motorcycle") != std::string::npos ||
           lowered.find("no motorcycles") != std::string::npos ||
           lowered.find("nenhum veiculo visivel") != std::string::npos ||
           lowered.find("nenhum veiculo na area") != std::string::npos ||
           lowered.find("nenhum veiculo no poligono") != std::string::npos ||
           lowered.find("sem carros") != std::string::npos ||
           lowered.find("sem motos") != std::string::npos ||
           lowered.find("sem veiculo") != std::string::npos ||
           lowered.find("sem veiculos") != std::string::npos ||
           lowered.find("nenhum veiculo") != std::string::npos ||
           lowered.find("nenhum carro") != std::string::npos ||
           lowered.find("nenhuma moto") != std::string::npos ||
           lowered.find("nao esta visivel") != std::string::npos ||
           lowered.find("nao estao visiveis") != std::string::npos ||
           lowered.find("nao aparece") != std::string::npos ||
           lowered.find("nao aparecem") != std::string::npos ||
           lowered.find("nao ha veiculo") != std::string::npos ||
           lowered.find("nao ha carros") != std::string::npos ||
           lowered.find("pista vazia") != std::string::npos ||
           lowered.find("via permanece vazia") != std::string::npos;
}

inline bool textSuggestsInactionableVisibility(const std::string& rawText) {
    const std::string lowered = lower(trim(rawText));
    if (lowered.empty()) return false;
    return lowered.find("camera est") != std::string::npos && lowered.find("sem imagem") != std::string::npos ||
           lowered.find("camara est") != std::string::npos && lowered.find("sem imagem") != std::string::npos ||
           lowered.find("sem imagem") != std::string::npos ||
           lowered.find("sem visibilidade") != std::string::npos ||
           lowered.find("sem cena") != std::string::npos ||
           lowered.find("imagem escura") != std::string::npos ||
           lowered.find("quadros escuros") != std::string::npos ||
           lowered.find("frames escuros") != std::string::npos ||
           lowered.find("totalmente escura") != std::string::npos ||
           lowered.find("completamente escura") != std::string::npos ||
           lowered.find("obstru") != std::string::npos ||
           lowered.find("desfocad") != std::string::npos ||
           lowered.find("too dark") != std::string::npos ||
           lowered.find("completely dark") != std::string::npos ||
           lowered.find("dark frame") != std::string::npos ||
           lowered.find("dark scene") != std::string::npos ||
           lowered.find("occluded") != std::string::npos ||
           lowered.find("obstruct") != std::string::npos ||
           lowered.find("blank") != std::string::npos ||
           lowered.find("black frame") != std::string::npos ||
           lowered.find("no visible scene") != std::string::npos ||
           lowered.find("no useful image") != std::string::npos ||
           lowered.find("visibility issue") != std::string::npos;
}

inline bool textSuggestsExplicitNegativeObservation(const std::string& rawText) {
    const std::string lowered = lower(trim(rawText));
    if (lowered.empty()) return false;
    return lowered.find("negative observation") != std::string::npos ||
           lowered.find("observacao negativa") != std::string::npos ||
           lowered.find("false positive") != std::string::npos ||
           lowered.find("falso positivo") != std::string::npos;
}

inline bool textContradictsObservedEvent(const std::string& rawText, const std::string& rawEvent) {
    const std::string lowered = lower(trim(rawText));
    const std::string eventName = lower(trim(normalizeEventName(rawEvent)));
    if (lowered.empty() || eventName.empty()) return false;

    if (eventName == "picked_up_cup") {
        return lowered.find("nao um copo") != std::string::npos ||
               lowered.find("not a cup") != std::string::npos ||
               lowered.find("sem copo") != std::string::npos ||
               lowered.find("no cup") != std::string::npos ||
               lowered.find("without cup") != std::string::npos;
    }

    return false;
}

inline bool nodeSuggestsNoVisiblePerson(const json& node, int depth = 0) {
    if (depth > 3) return false;
    if (node.is_string()) return textSuggestsNoVisiblePerson(node.get<std::string>());
    if (node.is_array()) {
        for (const auto& item : node) {
            if (nodeSuggestsNoVisiblePerson(item, depth + 1)) return true;
        }
        return false;
    }
    if (!node.is_object()) return false;
    for (auto it = node.begin(); it != node.end(); ++it) {
        if (nodeSuggestsNoVisiblePerson(it.value(), depth + 1)) return true;
    }
    return false;
}

inline bool nodeSuggestsNoVisibleTarget(const json& node, int depth = 0) {
    if (depth > 3) return false;
    if (node.is_string()) return textSuggestsNoVisibleTarget(node.get<std::string>());
    if (node.is_array()) {
        for (const auto& item : node) {
            if (nodeSuggestsNoVisibleTarget(item, depth + 1)) return true;
        }
        return false;
    }
    if (!node.is_object()) return false;
    for (auto it = node.begin(); it != node.end(); ++it) {
        if (nodeSuggestsNoVisibleTarget(it.value(), depth + 1)) return true;
    }
    return false;
}

inline bool tokenSuggestsSyntheticAbsence(const std::string& rawToken) {
    const std::string lowered = lower(trim(rawToken));
    if (lowered.empty()) return false;
    return lowered.rfind("no_", 0) == 0 ||
           lowered.find("_none") != std::string::npos ||
           lowered.find("none_") != std::string::npos ||
           lowered.find("_absent") != std::string::npos ||
           lowered.find("absent_") != std::string::npos ||
           lowered.find("_empty") != std::string::npos ||
           lowered.find("empty_") != std::string::npos ||
           lowered.find("not_visible") != std::string::npos ||
           lowered.find("not_present") != std::string::npos ||
           lowered.find("zone_empty") != std::string::npos ||
           lowered.find("no_vehicle") != std::string::npos ||
           lowered.find("no_person") != std::string::npos ||
           lowered.find("no_entity") != std::string::npos ||
           lowered.find("no_target") != std::string::npos ||
           lowered.find("empty_road") != std::string::npos ||
           lowered.find("empty_scene") != std::string::npos ||
           lowered.find("empty_zone") != std::string::npos ||
           lowered.find("not_observed") != std::string::npos ||
           lowered.find("not_detected") != std::string::npos ||
           lowered.find("not_seen") != std::string::npos ||
           lowered.find("prior_only") != std::string::npos ||
           lowered.find("carry_only") != std::string::npos ||
           lowered == "empty" ||
           lowered == "none" ||
           lowered == "no_activity";
}

inline bool decisionSuggestsSyntheticAbsence(const std::string& rawDecision) {
    const std::string decision = lower(trim(rawDecision));
    if (decision.empty()) return false;
    return decision == "no_entity_visible" ||
           decision == "no_entities_visible" ||
           decision == "no_entity_present" ||
           decision == "no_entity_present_in_zone" ||
           decision == "no_entity_in_zone" ||
           decision == "no_target_visible" ||
           decision == "no_target_present" ||
           decision == "not_visible" ||
           decision == "not_currently_visible" ||
           decision == "not_visible_this_batch" ||
           decision == "not_visible_this_segment" ||
           decision == "not_visible_in_segment" ||
           decision == "not_visible_in_current_segment" ||
           decision == "not_visible_in_current_batch" ||
           decision == "no_longer_visible" ||
           decision == "none_visible" ||
           decision == "empty_scene" ||
           decision == "empty_zone" ||
           decision == "absent";
}

inline bool nodeRepresentsSyntheticAbsence(const json& node) {
    if (!node.is_object()) return false;

    const std::string decision = structuredDecisionField(node);
    if (decisionSuggestsSyntheticAbsence(decision)) return true;

    const std::string entityId = structuredEntityIdField(node);
    if (tokenSuggestsSyntheticAbsence(entityId)) return true;

    const std::string status = trim(strField(node, "status", strField(node, "state")));
    if (tokenSuggestsSyntheticAbsence(status)) return true;

    const std::string eventName =
        trim(strField(node, "event", strField(node, "type", strField(node, "event_type"))));
    if (tokenSuggestsSyntheticAbsence(eventName)) return true;

    if (!nodeSuggestsNoVisibleTarget(node)) return false;

    const std::string entityToken = structuredEntityTokenField(node);
    if (entityToken.empty() ||
        tokenSuggestsSyntheticAbsence(entityToken) ||
        decisionSuggestsSyntheticAbsence(decision))
    {
        return true;
    }

    return (node.contains("status") && !trim(strField(node, "status")).empty()) ||
           (node.contains("state") && !trim(strField(node, "state")).empty()) ||
           (node.contains("key_traits") && !node["key_traits"].empty()) ||
           (node.contains("updated_traits") && !node["updated_traits"].empty());
}

inline bool shouldCommitObservationEvent(const json& observation, const std::string& rawEvent) {
    if (nodeRepresentsSyntheticAbsence(observation)) return false;
    if (observation.is_object()) {
        const std::string typeToken = normalizeEvidenceToken(strField(observation, "type"));
        const std::string statusToken =
            normalizeEvidenceToken(strField(observation, "status", strField(observation, "state")));
        if (observationTypeSuggestsMetaStateReference(typeToken) ||
            nodeCarriesAggregateTemporalState(observation) ||
            observationStatusSuggestsNegative(statusToken))
        {
            return false;
        }
    }
    const std::string eventName = lower(trim(normalizeEventName(rawEvent)));
    if (eventName.empty()) return true;
    if (!isPresentEventName(eventName) && !nodeCountsAsNewEvent(observation)) {
        return false;
    }
    if (isPresentEventName(eventName)) {
        return !nodeSuggestsNoVisiblePerson(observation) &&
               !nodeSuggestsNoVisibleTarget(observation);
    }

    if (observation.is_object() &&
        (observation.contains("confidence") ||
         observation.contains("identity_confidence") ||
         observation.contains("match_confidence")))
    {
        const double confidence = structuredConfidenceField(observation, 0.0);
        if (confidence <= 0.0) return false;
    }

    const std::array<std::string, 5> texts = {
        strField(observation, "note"),
        strField(observation, "description"),
        strField(observation, "reason"),
        strField(observation, "entity_description"),
        strField(observation, "person_description")
    };
    for (const auto& text : texts) {
        if (textSuggestsExplicitNegativeObservation(text) ||
            textContradictsObservedEvent(text, eventName))
        {
            return false;
        }
    }

    return true;
}

inline bool nodeSuggestsInactionableVisibility(const json& node, int depth = 0) {
    if (depth > 3) return false;
    if (node.is_string()) return textSuggestsInactionableVisibility(node.get<std::string>());
    if (node.is_array()) {
        for (const auto& item : node) {
            if (nodeSuggestsInactionableVisibility(item, depth + 1)) return true;
        }
        return false;
    }
    if (!node.is_object()) return false;
    for (auto it = node.begin(); it != node.end(); ++it) {
        if (nodeSuggestsInactionableVisibility(it.value(), depth + 1)) return true;
    }
    return false;
}

inline bool eventLooksLikeSceneLevelNegative(const std::string& rawEvent) {
    const std::string lowered = lower(trim(normalizeEventName(rawEvent)));
    if (lowered.empty()) return false;
    return lowered.rfind("no_", 0) == 0 ||
           lowered.find("empty") != std::string::npos ||
           lowered.find("not_visible") != std::string::npos ||
           lowered.find("notvisible") != std::string::npos ||
           lowered.find("visibility") != std::string::npos ||
           lowered.find("scene") != std::string::npos ||
           lowered.find("dark") != std::string::npos ||
           lowered.find("blank") != std::string::npos ||
           lowered.find("obstruct") != std::string::npos ||
           lowered.find("occlud") != std::string::npos;
}

inline bool currentBatchHasEntityEvidence(const json& identityPatch, const json& observations) {
    auto patchShowsEntity = [](const json& node) -> bool {
        if (!node.is_object()) return false;
        if (nodeRepresentsSyntheticAbsence(node) ||
            nodeSuggestsNoVisiblePerson(node) ||
            nodeSuggestsNoVisibleTarget(node) ||
            nodeSuggestsInactionableVisibility(node))
        {
            return false;
        }
        const std::string eventName =
            trim(strField(node, "event", strField(node, "type", strField(node, "event_type"))));
        if (isAbsenceEventName(eventName)) return false;
        const std::string decision = lower(structuredDecisionField(node));
        if (decision == "unknown" || decision == "not_visible_this_batch" || decision == "no_match") {
            return false;
        }
        return !structuredEntityTokenField(node).empty();
    };
    if (identityPatch.is_array()) {
        for (const auto& item : identityPatch) {
            if (patchShowsEntity(item)) return true;
        }
    }
    if (observations.is_array()) {
        for (const auto& item : observations) {
            if (!item.is_object()) continue;
            if (nodeRepresentsSyntheticAbsence(item) ||
                nodeSuggestsNoVisiblePerson(item) ||
                nodeSuggestsNoVisibleTarget(item) ||
                nodeSuggestsInactionableVisibility(item))
            {
                continue;
            }
            const std::string entityToken = structuredEntityTokenField(item);
            const std::string eventName =
                trim(strField(item, "event", strField(item, "type", strField(item, "event_type"))));
            if (isAbsenceEventName(eventName)) continue;
            if (!entityToken.empty() || isPresentEventName(eventName) || tokenLooksLikeThreatEvidence(eventName)) {
                return true;
            }
        }
    }
    return false;
}

inline bool shouldSuppressThreatCarryAlert(const json& envelope,
                                           bool localAlertCondition,
                                           const std::string& answer,
                                           const json& unknownReasons,
                                           const json& identityPatch,
                                           const json& observations) {
    if (localAlertCondition) return false;
    const json plan = effectivePlan(envelope);
    const json fp = plan.value("prompt_fingerprint", json::object());
    const std::string mergedPrompt =
        strField(fp, "prompt_core") + " " +
        strField(fp, "alert_condition") + " " +
        strField(fp, "negative_condition");
    if (!looksLikeThreatEvidencePrompt(mergedPrompt)) return false;
    const bool negativeCurrentBatch =
        textSuggestsNoVisiblePerson(answer) ||
        textSuggestsInactionableVisibility(answer) ||
        nodeSuggestsNoVisiblePerson(unknownReasons) ||
        nodeSuggestsInactionableVisibility(unknownReasons) ||
        nodeSuggestsNoVisiblePerson(observations) ||
        nodeSuggestsInactionableVisibility(observations);
    if (!negativeCurrentBatch) return false;
    return !currentBatchHasEntityEvidence(identityPatch, observations);
}

inline bool operatorResultRepresentsStalePresenceCarry(const json& result) {
    if (!result.is_object()) return false;
    if (lower(trim(strField(result, "value"))) != "true") return false;

    const std::string typ = lower(trim(strField(result, "type")));
    if (typ == "entity_present") return true;
    if (typ == "count_events_in_window" ||
        typ == "seen_n_times_in_window_by_entity")
    {
        const std::string eventName = lower(trim(normalizeEventName(strField(result, "event"))));
        return eventName.empty() || eventName == "present";
    }
    return false;
}

inline bool shouldSuppressStalePresenceCarryAlert(const json& operatorResults,
                                                  bool localAlertCondition,
                                                  const std::string& answer,
                                                  const json& unknownReasons,
                                                  const json& identityPatch,
                                                  const json& observations) {
    if (localAlertCondition) return false;

    const bool negativeCurrentBatch =
        textSuggestsNoVisiblePerson(answer) ||
        textSuggestsNoVisibleTarget(answer) ||
        textSuggestsInactionableVisibility(answer) ||
        nodeSuggestsNoVisiblePerson(unknownReasons) ||
        nodeSuggestsNoVisibleTarget(unknownReasons) ||
        nodeSuggestsInactionableVisibility(unknownReasons) ||
        nodeSuggestsNoVisiblePerson(observations) ||
        nodeSuggestsNoVisibleTarget(observations) ||
        nodeSuggestsInactionableVisibility(observations);
    if (!negativeCurrentBatch) return false;
    if (currentBatchHasEntityEvidence(identityPatch, observations)) return false;
    if (!operatorResults.is_array()) return false;

    bool foundPositiveOperator = false;
    for (const auto& result : operatorResults) {
        if (!result.is_object()) continue;
        if (lower(trim(strField(result, "value"))) != "true") continue;
        foundPositiveOperator = true;
        if (!operatorResultRepresentsStalePresenceCarry(result)) {
            return false;
        }
    }

    return foundPositiveOperator;
}

inline const json* findIdentityMemoryByEntityId(const json& st, const std::string& entityId) {
    if (!st.is_object() || !st.contains("identity_memory") || !st["identity_memory"].is_array()) return nullptr;
    const std::string targetId = trim(entityId);
    if (targetId.empty()) return nullptr;
    for (const auto& row : st["identity_memory"]) {
        if (!row.is_object()) continue;
        if (trim(strField(row, "entity_id")) == targetId) return &row;
    }
    return nullptr;
}

inline std::string identityMemoryLastSeenTs(const json& row) {
    if (!row.is_object()) return std::string();
    std::string ts = trim(strField(row, "last_seen_ts_utc", strField(row, "last_seen_ts")));
    if (!ts.empty()) return ts;
    if (row.contains("resolved_identity") &&
        row["resolved_identity"].is_object())
    {
        ts = trim(strField(row["resolved_identity"], "confirmed_at_utc"));
        if (!ts.empty()) return ts;
    }
    return trim(strField(row, "confirmed_at_utc"));
}

inline std::string entityStateLastSeenTs(
    const json& entityState,
    const json* identityMemoryRow = nullptr)
{
    if (entityState.is_object()) {
        std::string ts = trim(strField(
            entityState,
            "last_seen_ts",
            strField(entityState, "last_evidence_ts_utc", strField(entityState, "first_seen_ts"))));
        if (!ts.empty()) return ts;
    }
    if (identityMemoryRow && identityMemoryRow->is_object()) {
        return identityMemoryLastSeenTs(*identityMemoryRow);
    }
    return std::string();
}

inline bool entityStateHasExplicitPresentFlag(const json& entityState, bool& outPresentNow) {
    if (!entityState.is_object() ||
        !entityState.contains("present_now") ||
        !entityState["present_now"].is_boolean())
    {
        return false;
    }
    outPresentNow = entityState["present_now"].get<bool>();
    return true;
}

inline bool entityStateRepresentsSyntheticAbsence(const std::string& rawEntityId,
                                                  const json* entityState = nullptr,
                                                  const json* identityMemoryRow = nullptr) {
    if (tokenSuggestsSyntheticAbsence(rawEntityId)) return true;
    if (entityState && entityState->is_object() && nodeRepresentsSyntheticAbsence(*entityState)) return true;
    if (identityMemoryRow && identityMemoryRow->is_object() && nodeRepresentsSyntheticAbsence(*identityMemoryRow)) {
        return true;
    }
    return false;
}

inline bool entityMatchesFilter(const std::string& rawEntityId,
                                const std::string& rawFilter,
                                const json* entityState = nullptr,
                                const json* identityMemoryRow = nullptr) {
    if (entityStateRepresentsSyntheticAbsence(rawEntityId, entityState, identityMemoryRow)) return false;
    const std::string filter = lower(trim(rawFilter));
    auto tokenMatches = [&](const std::string& rawToken) -> bool {
        const std::string token = lower(trim(rawToken));
        if (token.empty()) return false;
        if (filter.empty()) return true;
        return token == filter || token.rfind(filter + "_", 0) == 0;
    };

    if (tokenMatches(rawEntityId)) return true;
    if (entityState && entityState->is_object()) {
        if (tokenMatches(strField(*entityState, "entity_key"))) return true;
        if (tokenMatches(strField(*entityState, "entity_type"))) return true;
    }
    if (identityMemoryRow && identityMemoryRow->is_object()) {
        if (tokenMatches(strField(*identityMemoryRow, "entity_key"))) return true;
        if (tokenMatches(strField(*identityMemoryRow, "entity_type"))) return true;
    }
    return filter.empty();
}

inline std::string eventEntityToken(const json& item) {
    if (!item.is_object()) return std::string();
    return structuredEntityTokenField(item);
}

inline bool eventRepresentsSyntheticAbsence(const json& st, const json& item) {
    if (!item.is_object()) return false;
    const std::string entityId = trim(strField(item, "entity_id"));
    const json* entityState = nullptr;
    if (!entityId.empty() &&
        st.is_object() &&
        st.contains("entities") &&
        st["entities"].is_object() &&
        st["entities"].contains(entityId) &&
        st["entities"][entityId].is_object())
    {
        entityState = &st["entities"][entityId];
    }
    const json* identityMemoryRow = findIdentityMemoryByEntityId(st, entityId);
    if (entityStateRepresentsSyntheticAbsence(entityId, entityState, identityMemoryRow)) return true;
    return nodeRepresentsSyntheticAbsence(item);
}

inline bool eventMatchesFilter(const json& st, const json& item, const std::string& rawFilter) {
    if (!item.is_object()) return false;
    if (eventRepresentsSyntheticAbsence(st, item)) return false;
    const std::string entityId = trim(strField(item, "entity_id"));
    const json* entityState = nullptr;
    if (!entityId.empty() &&
        st.is_object() &&
        st.contains("entities") &&
        st["entities"].is_object() &&
        st["entities"].contains(entityId) &&
        st["entities"][entityId].is_object())
    {
        entityState = &st["entities"][entityId];
    }
    const json* identityMemoryRow = findIdentityMemoryByEntityId(st, entityId);
    if (entityMatchesFilter(entityId, rawFilter, entityState, identityMemoryRow)) return true;
    if (entityMatchesFilter(strField(item, "entity_key"), rawFilter)) return true;
    if (entityMatchesFilter(strField(item, "entity_type"), rawFilter)) return true;
    return false;
}

inline bool stateAlreadyHasEvidenceKey(const json& st, const std::string& rawKey) {
    const std::string key = trim(rawKey);
    if (key.empty() ||
        !st.is_object() ||
        !st.contains("events") ||
        !st["events"].is_array())
    {
        return false;
    }
    for (const auto& item : st["events"]) {
        if (!item.is_object()) continue;
        if (trim(strField(item, "temporal_evidence_key")) == key) return true;
    }
    return false;
}

inline std::string extractZoneField(const json& node, const std::string& fallback) {
    if (!node.is_object()) return trim(fallback);
    return trim(strField(
        node,
        "zone",
        strField(
            node,
            "zone_id",
            strField(
                node,
                "zone_key",
                strField(
                    node,
                    "region",
                    strField(
                        node,
                        "region_id",
                        strField(node, "region_key", fallback)))))));
}

inline std::string extractObservedZoneField(const json& node, const std::string& fallback) {
    if (!node.is_object()) return trim(fallback);
    return trim(strField(node, "last_seen_zone", extractZoneField(node, fallback)));
}

inline bool zoneMatchesFilter(const std::string& rawZone, const std::string& rawExpectedZone) {
    const std::string expectedZone = lower(trim(rawExpectedZone));
    if (expectedZone.empty()) return true;
    return lower(trim(rawZone)) == expectedZone;
}

inline long long countPresentEntitiesInState(
    const json& st,
    const std::string& nowIsoUtc,
    int windowSeconds,
    const std::string& entityFilter = std::string(),
    const std::string& zoneFilter = std::string())
{
    if (!st.is_object() || !st.contains("entities") || !st["entities"].is_object()) return 0;

    long long count = 0;
    for (auto it = st["entities"].begin(); it != st["entities"].end(); ++it) {
        if (!it.value().is_object()) continue;
        const json* identityMemoryRow = findIdentityMemoryByEntityId(st, it.key());
        if (!entityMatchesFilter(it.key(), entityFilter, &it.value(), identityMemoryRow)) continue;
        bool explicitPresentNow = false;
        if (entityStateHasExplicitPresentFlag(it.value(), explicitPresentNow) && !explicitPresentNow) continue;
        const std::string lastSeen = strField(it.value(), "last_seen_ts");
        if (lastSeen.empty()) continue;
        if (!zoneMatchesFilter(strField(it.value(), "current_zone"), zoneFilter)) continue;
        if (windowSeconds > 0 && ageSeconds(lastSeen, nowIsoUtc) > windowSeconds) continue;
        ++count;
    }
    return count;
}

inline long long countDistinctEventEntities(
    const json& st,
    const std::string& rawEventName,
    const std::string& nowIsoUtc,
    int windowSeconds,
    const std::string& entityFilter = std::string(),
    const std::string& zoneFilter = std::string())
{
    if (!st.is_object() || !st.contains("events") || !st["events"].is_array()) return 0;

    const std::string eventName = lower(trim(normalizeEventName(rawEventName)));
    std::unordered_set<std::string> seen;
    for (const auto& item : st["events"]) {
        if (!item.is_object()) continue;
        if (eventRepresentsSyntheticAbsence(st, item)) continue;
        if (!eventName.empty() && lower(trim(strField(item, "event"))) != eventName) continue;
        if (!eventMatchesFilter(st, item, entityFilter)) continue;
        if (!zoneMatchesFilter(extractZoneField(item), zoneFilter)) continue;
        if (windowSeconds > 0 && ageSeconds(strField(item, "ts_utc"), nowIsoUtc) > windowSeconds) continue;
        const std::string entityToken = eventEntityToken(item);
        if (entityToken.empty()) continue;
        seen.insert(lower(entityToken));
    }
    return static_cast<long long>(seen.size());
}

inline std::string latestPresentTimestampInState(
    const json& st,
    const std::string& entityFilter = std::string(),
    const std::string& zoneFilter = std::string())
{
    if (!st.is_object() || !st.contains("entities") || !st["entities"].is_object()) return std::string();

    std::string latest;
    for (auto it = st["entities"].begin(); it != st["entities"].end(); ++it) {
        if (!it.value().is_object()) continue;
        const json* identityMemoryRow = findIdentityMemoryByEntityId(st, it.key());
        if (!entityMatchesFilter(it.key(), entityFilter, &it.value(), identityMemoryRow)) continue;
        const std::string lastSeen = strField(it.value(), "last_seen_ts");
        if (lastSeen.empty()) continue;
        if (!zoneMatchesFilter(strField(it.value(), "current_zone"), zoneFilter)) continue;
        if (latest.empty() || lastSeen > latest) latest = lastSeen;
    }
    return latest;
}

inline std::string inferEntityPrefix(const json& patch, const json& plan) {
    std::string prefix = structuredEntityHintField(patch);
    if (prefix.empty()) {
        const std::string entityId = structuredEntityIdField(patch);
        if (!entityId.empty()) {
            const auto p = entityId.find_last_of("_#");
            if (p != std::string::npos && p + 1 < entityId.size()) {
                bool numericSuffix = true;
                for (std::size_t i = p + 1; i < entityId.size(); ++i) {
                    if (!std::isdigit(static_cast<unsigned char>(entityId[i]))) {
                        numericSuffix = false;
                        break;
                    }
                }
                prefix = numericSuffix ? entityId.substr(0, p) : entityId;
            }
            else {
                prefix = entityId;
            }
        }
    }
    if (prefix.empty() && plan.contains("entities") && plan["entities"].is_array()) {
        for (const auto& ent : plan["entities"]) {
            if (ent.is_object() && ent.contains("entity_key") && ent["entity_key"].is_string()) {
                prefix = trim(ent["entity_key"].get<std::string>());
                if (!prefix.empty()) break;
            }
        }
    }
    return sanitizeToken(prefix, "entity");
}

inline std::string allocateEntityId(const json& st, const std::string& prefixRaw) {
    const std::string prefix = sanitizeToken(prefixRaw, "entity");
    int maxId = 0;
    if (st.is_object() && st.contains("entities") && st["entities"].is_object()) {
        const std::string leader = prefix + "_";
        for (auto it = st["entities"].begin(); it != st["entities"].end(); ++it) {
            const std::string key = it.key();
            if (key.rfind(leader, 0) != 0) continue;
            const std::string tail = key.substr(leader.size());
            if (tail.empty()) continue;
            bool numeric = true;
            for (char c : tail) {
                if (!std::isdigit(static_cast<unsigned char>(c))) {
                    numeric = false;
                    break;
                }
            }
            if (!numeric) continue;
            try {
                maxId = std::max(maxId, std::stoi(tail));
            }
            catch (...) {}
        }
    }
    return prefix + "_" + std::to_string(maxId + 1);
}

inline void upsertIdentityMemory(
    json& st,
    const std::string& entityId,
    const json& patch,
    const std::string& seenTsUtc,
    const std::string& zone)
{
    if (!st.is_object()) return;
    if (!st.contains("identity_memory") || !st["identity_memory"].is_array()) {
        st["identity_memory"] = json::array();
    }

    const std::string id = trim(entityId);
    if (id.empty()) return;

    std::size_t idx = static_cast<std::size_t>(-1);
    for (std::size_t i = 0; i < st["identity_memory"].size(); ++i) {
        const auto& row = st["identity_memory"][i];
        if (!row.is_object()) continue;
        if (trim(strField(row, "entity_id")) == id) {
            idx = i;
            break;
        }
    }

    json mem = json::object();
    if (idx != static_cast<std::size_t>(-1) && st["identity_memory"][idx].is_object()) {
        mem = st["identity_memory"][idx];
    }

    mem["entity_id"] = id;
    json* entityState = nullptr;
    if (st.contains("entities") && st["entities"].is_object() &&
        st["entities"].contains(id) && st["entities"][id].is_object())
    {
        entityState = &st["entities"][id];
    }

    const std::string description = trim(
        strField(
            patch,
            "description",
            strField(
                patch,
                "short_description",
                strField(
                    patch,
                    "appearance_summary",
                    strField(
                        patch,
                        "entity_description",
                        strField(patch, "person_description", strField(patch, "object_description"))
                    )
                )
            )
        )
    );
    std::string entityTypeHint = trim(
        strField(patch, "entity_type", strField(patch, "entity_key")));
    if (entityTypeHint.empty() &&
        entityState &&
        entityState->is_object())
    {
        entityTypeHint = trim(
            strField(*entityState, "entity_type", strField(*entityState, "entity_key")));
    }
    if (entityTypeHint.empty()) {
        entityTypeHint = trim(strField(mem, "entity_type", strField(mem, "entity_key")));
    }
    if (!description.empty()) mem["description"] = description;
    else if ((!mem.contains("description") || !mem["description"].is_string() ||
              trim(mem["description"].get<std::string>()).empty()) &&
             mem.contains("appearance_summary") &&
             mem["appearance_summary"].is_string())
    {
        const std::string legacyAppearanceSummary = trim(mem["appearance_summary"].get<std::string>());
        if (!legacyAppearanceSummary.empty()) {
            mem["description"] = legacyAppearanceSummary;
        }
    }
    if ((!mem.contains("description") || !mem["description"].is_string() ||
         trim(mem["description"].get<std::string>()).empty()) &&
        entityState &&
        entityState->contains("appearance_summary") &&
        (*entityState)["appearance_summary"].is_string())
    {
        const std::string legacyAppearanceSummary = trim((*entityState)["appearance_summary"].get<std::string>());
        if (!legacyAppearanceSummary.empty()) {
            mem["description"] = legacyAppearanceSummary;
        }
    }
    if (mem.contains("appearance_summary")) mem.erase("appearance_summary");
    if (entityState) {
        if (!description.empty()) {
            (*entityState)["description"] = description;
        }
        else if ((!entityState->contains("description") ||
                  !(*entityState)["description"].is_string() ||
                  trim((*entityState)["description"].get<std::string>()).empty()) &&
                 mem.contains("description") &&
                 mem["description"].is_string())
        {
            (*entityState)["description"] = mem["description"];
        }
        if (entityState->contains("appearance_summary")) entityState->erase("appearance_summary");
    }
    mem["last_seen_ts_utc"] = seenTsUtc;
    if (!trim(zone).empty()) mem["last_seen_zone"] = trim(zone);

    const json structuredIdentityFeatureCandidates =
        extractIdentityFeatureCandidatesFromNode(patch);
    const json derivedIdentitySignatureTraits =
        deriveIdentitySignatureTraitsFromFeatureCandidates(structuredIdentityFeatureCandidates);
    const json derivedIdentityContextTraits =
        deriveIdentityContextTraitsFromFeatureCandidates(structuredIdentityFeatureCandidates);
    const json stableTraits = extractStableTraitsFromNode(patch);
    const json contextTraits = extractContextTraitsFromNode(patch);
    const json explicitIdentitySignatureTraitsRaw =
        patch.contains("identity_signature_traits")
            ? parseTraitsValue(patch["identity_signature_traits"])
            : json::array();
    const json explicitIdentityContextTraitsRaw =
        patch.contains("identity_context_traits")
            ? parseTraitsValue(patch["identity_context_traits"])
            : json::array();
    const json explicitIdentitySignatureTraits =
        (derivedIdentitySignatureTraits.is_array() && !derivedIdentitySignatureTraits.empty())
            ? derivedIdentitySignatureTraits
            : explicitIdentitySignatureTraitsRaw;
    const json explicitIdentityContextTraits =
        (derivedIdentityContextTraits.is_array() && !derivedIdentityContextTraits.empty())
            ? derivedIdentityContextTraits
            : explicitIdentityContextTraitsRaw;
    const std::string sceneBrief = extractSceneBriefFromNode(patch);
    const bool hasStructuredIdentitySignature =
        derivedIdentitySignatureTraits.is_array() && !derivedIdentitySignatureTraits.empty();
    auto signatureSourceIsStructured = [&](const json& node) -> bool {
        if (!node.is_object()) return false;
        return normalizeIdentityFeatureEnumToken(strField(node, "identity_signature_source")) ==
               "structured_candidates";
    };
    const bool trustExistingMemoryIdentity = signatureSourceIsStructured(mem);
    const bool trustExistingEntityIdentity =
        entityState != nullptr && signatureSourceIsStructured(*entityState);
    auto updateIdentitySignatureSource = [&](json& node) {
        if (!node.is_object()) return;
        if (hasStructuredIdentitySignature) {
            node["identity_signature_source"] = "structured_candidates";
        }
        else if (explicitIdentitySignatureTraitsRaw.is_array() && !explicitIdentitySignatureTraitsRaw.empty()) {
            node["identity_signature_source"] = "explicit_traits";
        }
    };

    json mergedStableAttributes = json::array();
    if ((!hasStructuredIdentitySignature || trustExistingMemoryIdentity) &&
        mem.contains("stable_attributes"))
    {
        appendUniqueStringsToArray(mergedStableAttributes, mem["stable_attributes"]);
    }
    if (entityState &&
        (!hasStructuredIdentitySignature || trustExistingEntityIdentity) &&
        entityState->contains("stable_attributes"))
    {
        appendUniqueStringsToArray(mergedStableAttributes, (*entityState)["stable_attributes"]);
    }
    appendUniqueTraitsToArray(mergedStableAttributes, stableTraits);
    if (mergedStableAttributes.size() > 16) {
        mergedStableAttributes.erase(mergedStableAttributes.begin() + 16, mergedStableAttributes.end());
    }
    if (!mergedStableAttributes.empty()) {
        mem["stable_attributes"] = mergedStableAttributes;
        if (entityState) (*entityState)["stable_attributes"] = mergedStableAttributes;
    }

    json mergedKeyTraits = json::array();
    if ((!hasStructuredIdentitySignature || trustExistingMemoryIdentity) &&
        mem.contains("key_traits"))
    {
        appendUniqueTraitsToArray(mergedKeyTraits, mem["key_traits"]);
    }
    if (entityState &&
        (!hasStructuredIdentitySignature || trustExistingEntityIdentity) &&
        entityState->contains("key_traits"))
    {
        appendUniqueTraitsToArray(mergedKeyTraits, (*entityState)["key_traits"]);
    }
    appendUniqueTraitsToArray(mergedKeyTraits, stableTraits);
    if (mergedKeyTraits.size() > 16) {
        mergedKeyTraits.erase(mergedKeyTraits.begin() + 16, mergedKeyTraits.end());
    }
    if (!mergedKeyTraits.empty()) {
        mem["key_traits"] = mergedKeyTraits;
        if (entityState) (*entityState)["key_traits"] = mergedKeyTraits;
    }

    if (contextTraits.is_array() && !contextTraits.empty()) {
        mem["latest_context_traits"] = contextTraits;
        if (entityState) (*entityState)["latest_context_traits"] = contextTraits;
    }
    if (!sceneBrief.empty()) {
        mem["scene_brief"] = sceneBrief;
        if (entityState) (*entityState)["scene_brief"] = sceneBrief;
    }

    json mergedIdentitySignatureTraits = json::array();
    if ((!hasStructuredIdentitySignature || trustExistingMemoryIdentity) &&
        mem.contains("identity_signature_traits"))
    {
        appendUniqueStringsToArray(mergedIdentitySignatureTraits, mem["identity_signature_traits"]);
    }
    if (entityState &&
        (!hasStructuredIdentitySignature || trustExistingEntityIdentity) &&
        entityState->contains("identity_signature_traits"))
    {
        appendUniqueStringsToArray(mergedIdentitySignatureTraits, (*entityState)["identity_signature_traits"]);
    }
    if (explicitIdentitySignatureTraits.is_array() && !explicitIdentitySignatureTraits.empty()) {
        appendUniqueStringsToArray(mergedIdentitySignatureTraits, explicitIdentitySignatureTraits);
    }
    if (mergedIdentitySignatureTraits.size() > 16) {
        mergedIdentitySignatureTraits.erase(
            mergedIdentitySignatureTraits.begin() + 16,
            mergedIdentitySignatureTraits.end());
    }
    if (!mergedIdentitySignatureTraits.empty()) {
        mem["identity_signature_traits"] = mergedIdentitySignatureTraits;
        updateIdentitySignatureSource(mem);
        if (entityState) {
            (*entityState)["identity_signature_traits"] = mergedIdentitySignatureTraits;
            updateIdentitySignatureSource(*entityState);
        }
        const std::string curatedSummary =
            buildIdentitySignatureSummary(entityTypeHint, mergedIdentitySignatureTraits);
        if (!curatedSummary.empty()) {
            mem["identity_signature_summary"] = curatedSummary;
            if (entityState) (*entityState)["identity_signature_summary"] = curatedSummary;
        }
    }

    json mergedIdentityContextTraits = json::array();
    if (explicitIdentityContextTraits.is_array() && !explicitIdentityContextTraits.empty()) {
        appendUniqueStringsToArray(mergedIdentityContextTraits, explicitIdentityContextTraits);
    } else {
        if (mem.contains("identity_context_traits")) {
            appendUniqueStringsToArray(mergedIdentityContextTraits, mem["identity_context_traits"]);
        }
        if (entityState && entityState->contains("identity_context_traits")) {
            appendUniqueStringsToArray(mergedIdentityContextTraits, (*entityState)["identity_context_traits"]);
        }
    }
    if (mergedIdentityContextTraits.size() > 4) {
        mergedIdentityContextTraits.erase(
            mergedIdentityContextTraits.begin() + 4,
            mergedIdentityContextTraits.end());
    }
    if (!mergedIdentityContextTraits.empty()) {
        mem["identity_context_traits"] = mergedIdentityContextTraits;
        if (entityState) (*entityState)["identity_context_traits"] = mergedIdentityContextTraits;
    }

    json mergedReferenceImageUrls = json::array();
    if (mem.contains("reference_image_urls")) {
        appendUniqueStringsToArray(mergedReferenceImageUrls, mem["reference_image_urls"]);
    }
    if (entityState && entityState->contains("reference_image_urls")) {
        appendUniqueStringsToArray(mergedReferenceImageUrls, (*entityState)["reference_image_urls"]);
    }
    if (patch.contains("reference_image_urls")) {
        appendUniqueStringsToArray(mergedReferenceImageUrls, patch["reference_image_urls"]);
    }
    if (!mergedReferenceImageUrls.empty()) {
        mem["reference_image_urls"] = mergedReferenceImageUrls;
        if (entityState) (*entityState)["reference_image_urls"] = mergedReferenceImageUrls;
    }
    const std::string entityKey = structuredEntityKeyField(patch);
    if (!entityKey.empty()) mem["entity_key"] = entityKey;
    const std::string entityType = trim(strField(patch, "entity_type"));
    if (!entityType.empty()) mem["entity_type"] = entityType;
    if ((!mem.contains("key_traits") || !mem["key_traits"].is_array() || mem["key_traits"].empty()) &&
        entityState &&
        entityState->contains("key_traits") &&
        (*entityState)["key_traits"].is_array() &&
        !(*entityState)["key_traits"].empty())
    {
        mem["key_traits"] = (*entityState)["key_traits"];
    }
    if ((!mem.contains("description") || !mem["description"].is_string() || trim(mem["description"].get<std::string>()).empty()) &&
        entityState &&
        entityState->contains("description") &&
        (*entityState)["description"].is_string())
    {
        mem["description"] = (*entityState)["description"];
    }
    if ((!mem.contains("description") || !mem["description"].is_string() ||
         trim(mem["description"].get<std::string>()).empty()) &&
        entityState &&
        entityState->contains("appearance_summary") &&
        (*entityState)["appearance_summary"].is_string())
    {
        const std::string legacyAppearanceSummary = trim((*entityState)["appearance_summary"].get<std::string>());
        if (!legacyAppearanceSummary.empty()) {
            mem["description"] = legacyAppearanceSummary;
        }
    }
    if (mem.contains("appearance_summary")) mem.erase("appearance_summary");
    if (entityState && entityState->contains("appearance_summary")) entityState->erase("appearance_summary");

    if (idx == static_cast<std::size_t>(-1)) st["identity_memory"].push_back(std::move(mem));
    else st["identity_memory"][idx] = std::move(mem);

    if (st["identity_memory"].size() > 256) {
        st["identity_memory"].erase(st["identity_memory"].begin(),
                                    st["identity_memory"].begin() + (st["identity_memory"].size() - 256));
    }
}

inline void upsertResolvedIdentity(
    json& st,
    const std::string& entityId,
    const json& resolvedIdentity,
    const std::string& confirmedAtUtc)
{
    if (!st.is_object()) return;
    const std::string id = trim(entityId);
    if (id.empty() || !resolvedIdentity.is_object()) return;

    json resolved = resolvedIdentity;
    if (!resolved.contains("source") || !resolved["source"].is_string()) {
        resolved["source"] = "face_target_match";
    }
    if (!resolved.contains("confirmed_at_utc") || !resolved["confirmed_at_utc"].is_string() ||
        trim(resolved["confirmed_at_utc"].get<std::string>()).empty())
    {
        resolved["confirmed_at_utc"] = trim(confirmedAtUtc).empty() ? nowIso() : trim(confirmedAtUtc);
    }

    if (!st.contains("entities") || !st["entities"].is_object()) {
        st["entities"] = json::object();
    }
    if (!st["entities"].contains(id) || !st["entities"][id].is_object()) {
        st["entities"][id] = json::object();
    }
    json& entityState = st["entities"][id];
    entityState["resolved_identity"] = resolved;
    if (resolved.contains("target_name") && resolved["target_name"].is_string()) {
        const std::string targetName = trim(resolved["target_name"].get<std::string>());
        if (!targetName.empty()) entityState["known_name"] = targetName;
    }

    if (!st.contains("identity_memory") || !st["identity_memory"].is_array()) {
        st["identity_memory"] = json::array();
    }
    for (auto& row : st["identity_memory"]) {
        if (!row.is_object()) continue;
        if (trim(strField(row, "entity_id")) != id) continue;
        row["resolved_identity"] = resolved;
        if (resolved.contains("target_name") && resolved["target_name"].is_string()) {
            const std::string targetName = trim(resolved["target_name"].get<std::string>());
            if (!targetName.empty()) row["known_name"] = targetName;
        }
        return;
    }

    json row = {
        { "entity_id", id },
        { "resolved_identity", resolved }
    };
    if (resolved.contains("target_name") && resolved["target_name"].is_string()) {
        const std::string targetName = trim(resolved["target_name"].get<std::string>());
        if (!targetName.empty()) row["known_name"] = targetName;
    }
    st["identity_memory"].push_back(std::move(row));
}

inline void applyRound(json& st,
                       const json& envelope,
                       const json& identityPatch,
                       const json& observations,
                       const std::vector<TemporalEvidenceCandidate>& canonicalEvidenceCandidates,
                       const std::string& nowIsoUtc,
                       const std::string& answer = std::string(),
                       const json& unknownReasons = json::array(),
                       const std::string& segmentStartTsRaw = std::string(),
                       const std::string& segmentEndTsRaw = std::string(),
                       const json& resolvedIdentityMatches = json::array()) {
    ensureState(st);
    st["meta"]["last_round_evidence_keys"] = json::array();
    st["meta"]["last_round_candidate_decisions"] = json::array();
    st["meta"]["last_round_identity_memory_fallbacks"] = json::array();
    std::string nowTs = decisionAnchorUtc(nowIsoUtc, segmentEndTsRaw);
    if (nowTs.empty()) nowTs = decisionAnchorUtc(nowIso());
    const std::string segmentStartTs = normalizeFlexibleTs(segmentStartTsRaw);
    const std::string segmentEndTs = normalizeFlexibleTs(segmentEndTsRaw);
    const std::string defaultRoundEventTs = !segmentEndTs.empty() ? segmentEndTs : nowTs;
    const json plan = effectivePlan(envelope);
    const json identityPolicy = plan.value("identity_policy", json::object());
    const double matchThreshold = dblField(identityPolicy, "match_threshold", 0.80);
    const double newThreshold = dblField(identityPolicy, "new_entity_threshold", 0.62);
    std::string defaultEntityKey = "entity";
    if (plan.contains("entities") && plan["entities"].is_array()) {
        for (const auto& ent : plan["entities"]) {
            if (!ent.is_object()) continue;
            const std::string k = trim(strField(ent, "entity_key"));
            if (!k.empty()) {
                defaultEntityKey = k;
                break;
            }
        }
    }
    const int forgetEntityMissingForSeconds =
        intField(plan.value("retention_policy", json::object()), "forget_entity_missing_for_seconds", 300);

    std::unordered_set<std::string> allowedPlanEvents;
    if (plan.contains("event_catalog") && plan["event_catalog"].is_array()) {
        for (const auto& ev : plan["event_catalog"]) {
            if (!ev.is_string()) continue;
            const std::string eventName = lower(trim(normalizeEventName(ev.get<std::string>())));
            if (!eventName.empty()) allowedPlanEvents.insert(eventName);
        }
    }

    auto isAllowedStateEvent = [&](const std::string& rawEvent) -> bool {
        const std::string eventName = lower(trim(normalizeEventName(rawEvent)));
        if (eventName.empty()) return false;
        return isEngineStructuralEventName(eventName) ||
               allowedPlanEvents.find(eventName) != allowedPlanEvents.end();
    };

    auto extractStructuredEvidenceEventName = [&](const json& node) -> std::string {
        if (!node.is_object()) return std::string();
        std::string eventName =
            trim(strField(node, "event", strField(node, "event_type")));
        if (eventName.empty() && node.contains("event/type") && node["event/type"].is_string()) {
            eventName = trim(node["event/type"].get<std::string>());
        }
        eventName = trim(normalizeEventName(eventName));
        if (!eventName.empty()) return eventName;

        const std::string typeToken = normalizeEvidenceToken(strField(node, "type"));
        if (observationTypeSuggestsPresenceEvidence(typeToken)) return "present";

        const std::string normalizedTypeEvent = trim(normalizeEventName(typeToken));
        if (isAllowedStateEvent(normalizedTypeEvent)) return normalizedTypeEvent;
        return std::string();
    };

    auto classifyStructuredEvidence = [&](const json& node,
                                          const std::string& eventName) -> TemporalEvidenceClass {
        if (!node.is_object()) return TemporalEvidenceClass::scene_only_description;

        const std::string typeToken = normalizeEvidenceToken(strField(node, "type"));
        const std::string statusToken =
            normalizeEvidenceToken(strField(node, "status", strField(node, "state")));
        const std::string normalizedEvent = lower(trim(normalizeEventName(eventName)));

        if (observationTypeSuggestsMetaStateReference(typeToken) ||
            nodeCarriesAggregateTemporalState(node))
        {
            return TemporalEvidenceClass::meta_state_reference;
        }
        if (isAbsenceEventName(normalizedEvent) ||
            nodeRepresentsSyntheticAbsence(node) ||
            observationStatusSuggestsNegative(statusToken) ||
            nodeSuggestsNoVisiblePerson(node) ||
            nodeSuggestsNoVisibleTarget(node) ||
            nodeSuggestsInactionableVisibility(node))
        {
            return TemporalEvidenceClass::negative_observation;
        }
        if (observationTypeSuggestsSceneOnlyDescription(typeToken)) {
            return TemporalEvidenceClass::scene_only_description;
        }
        if (observationTypeSuggestsPresenceEvidence(typeToken) ||
            isPresentEventName(normalizedEvent))
        {
            return TemporalEvidenceClass::presence_evidence;
        }
        if (!normalizedEvent.empty() && isAllowedStateEvent(normalizedEvent)) {
            return TemporalEvidenceClass::positive_event_evidence;
        }
        return TemporalEvidenceClass::scene_only_description;
    };

    std::unordered_map<std::string, std::string> roundEntityByHint;
    auto entityExists = [&](const std::string& entityId) -> bool {
        const std::string id = trim(entityId);
        return !id.empty() &&
               st.contains("entities") &&
               st["entities"].is_object() &&
               st["entities"].contains(id) &&
               st["entities"][id].is_object();
    };
    auto selectExistingEntityIdFromHint = [&](const std::string& hint) -> std::string {
        if (hint.empty()) return std::string();
        auto itRound = roundEntityByHint.find(hint);
        if (itRound != roundEntityByHint.end() && entityExists(itRound->second)) return itRound->second;

        std::string selected;
        std::string selectedLastSeen;
        if (st.contains("entities") && st["entities"].is_object()) {
            if (st["entities"].contains(hint) && st["entities"][hint].is_object()) {
                selected = hint;
            }
            if (selected.empty()) {
                const std::string leader = hint + "_";
                for (auto it = st["entities"].begin(); it != st["entities"].end(); ++it) {
                    if (!it.value().is_object()) continue;
                    if (it.key().rfind(leader, 0) != 0) continue;
                    const std::string lastSeen = strField(it.value(), "last_seen_ts");
                    if (selected.empty() || (!lastSeen.empty() && lastSeen > selectedLastSeen)) {
                        selected = it.key();
                        selectedLastSeen = lastSeen;
                    }
                }
            }
            if (selected.empty()) {
                for (auto it = st["entities"].begin(); it != st["entities"].end(); ++it) {
                    if (!it.value().is_object()) continue;
                    const json* identityMemoryRow = findIdentityMemoryByEntityId(st, it.key());
                    if (!entityMatchesFilter(it.key(), hint, &it.value(), identityMemoryRow)) continue;
                    const std::string lastSeen = strField(it.value(), "last_seen_ts");
                    if (selected.empty() || (!lastSeen.empty() && lastSeen > selectedLastSeen)) {
                        selected = it.key();
                        selectedLastSeen = lastSeen;
                    }
                }
            }
        }
        const auto pos = hint.find_last_of('_');
        bool numericSuffix = pos != std::string::npos && pos + 1 < hint.size();
        for (std::size_t i = pos + 1; numericSuffix && i < hint.size(); ++i) {
            if (!std::isdigit(static_cast<unsigned char>(hint[i]))) numericSuffix = false;
        }
        if (selected.empty() && numericSuffix && entityExists(hint)) {
            selected = hint;
        }
        if (!selected.empty()) roundEntityByHint[hint] = selected;
        return selected;
    };
    auto resolveEntityIdFromHint = [&](const std::string& hintRaw) -> std::string {
        const std::string hint = sanitizeToken(hintRaw.empty() ? defaultEntityKey : hintRaw, "entity");
        std::string selected = selectExistingEntityIdFromHint(hint);
        if (selected.empty()) selected = allocateEntityId(st, hint);
        roundEntityByHint[hint] = selected;
        return selected;
    };
    auto resolveExistingEntityIdFromHint = [&](const std::string& hintRaw) -> std::string {
        const std::string rawHint = trim(hintRaw);
        if (rawHint.empty()) return std::string();
        return selectExistingEntityIdFromHint(sanitizeToken(rawHint, "entity"));
    };

    std::unordered_map<std::string, std::string> roundLastPresentTs;
    std::unordered_map<std::string, std::string> roundLastLeftTs;
    std::unordered_set<std::string> roundHasEntered;
    std::unordered_set<std::string> roundAppendedEventKeys;
    std::unordered_set<std::string> roundTouchedEntityIds;
    std::unordered_set<std::string> roundPositiveEntityIds;
    std::unordered_set<std::string> roundIdentityMemoryFallbackEntityIds;

    auto recordIdentityMemoryFallback = [&](const std::string& entityId,
                                            const std::string& entityHint,
                                            const std::string& source) {
        const std::string normalizedEntityId = trim(entityId);
        if (normalizedEntityId.empty()) return;
        if (!roundIdentityMemoryFallbackEntityIds.insert(normalizedEntityId).second) return;

        json entry = {
            { "entity_id", normalizedEntityId },
            { "source", trim(source) }
        };
        const std::string normalizedHint = trim(entityHint);
        if (!normalizedHint.empty()) entry["entity_hint"] = normalizedHint;
        st["meta"]["last_round_identity_memory_fallbacks"].push_back(std::move(entry));
    };

    auto normalizeAcceptedEventTs = [&](const std::string& rawTs, const std::string& fallbackTs) -> std::string {
        const std::string candidate = normalizeFlexibleTs(trim(rawTs).empty() ? fallbackTs : rawTs);
        if (candidate.empty()) return "";
        const long long ageToNow = ageSeconds(candidate, nowTs);
        if (ageToNow < 0) return "";
        if (!segmentStartTs.empty() && candidate < segmentStartTs) return "";
        if (!segmentEndTs.empty() && candidate > segmentEndTs) return "";
        return candidate;
    };

    std::unordered_set<std::string> observationEventHints;
    auto makeObservationHintKey = [&](const std::string& entityTokenRaw, const std::string& eventRaw) -> std::string {
        const std::string entityToken = lower(trim(entityTokenRaw));
        const std::string eventName = lower(trim(normalizeEventName(eventRaw)));
        if (entityToken.empty() || eventName.empty()) return "";
        return entityToken + "|" + eventName;
    };
    if (observations.is_array()) {
        for (const auto& o : observations) {
            std::string entityToken;
            std::string eventName;
            std::string tsRaw;
            if (o.is_object()) {
                entityToken = trim(strField(o, "entity_id", strField(o, "entity_key", strField(o, "entity_type", defaultEntityKey))));
                eventName = extractStructuredEvidenceEventName(o);
                const TemporalEvidenceClass evidenceClass = classifyStructuredEvidence(o, eventName);
                if (evidenceClass != TemporalEvidenceClass::positive_event_evidence &&
                    evidenceClass != TemporalEvidenceClass::presence_evidence)
                {
                    continue;
                }
                if (!shouldCommitObservationEvent(o, eventName)) continue;
                tsRaw = strField(o, "ts_utc", strField(o, "timestamp", strField(o, "time")));
                if (!isPresentEventName(eventName) && !nodeHasDirectTemporalAnchor(o)) continue;
            } else {
                continue;
            }
            if (normalizeAcceptedEventTs(tsRaw, defaultRoundEventTs).empty()) continue;
            const std::string key = makeObservationHintKey(entityToken, eventName);
            if (!key.empty()) observationEventHints.insert(key);
        }
    }

    auto markRoundEvent = [&](const std::string& entityIdRaw, const std::string& eventRaw, const std::string& tsRaw) {
        const std::string entityId = trim(entityIdRaw);
        if (entityId.empty()) return;
        const std::string eventName = lower(trim(normalizeEventName(eventRaw)));
        if (eventName.empty()) return;
        const std::string ts = trim(tsRaw).empty() ? nowTs : trim(tsRaw);
        if (eventName == "entered_zone") {
            roundHasEntered.insert(entityId);
            return;
        }
        if (eventName == "present") {
            auto& slot = roundLastPresentTs[entityId];
            if (slot.empty() || ts > slot) slot = ts;
            return;
        }
        if (eventName == "left_zone") {
            auto& slot = roundLastLeftTs[entityId];
            if (slot.empty() || ts > slot) slot = ts;
            return;
        }
    };

    auto appendValidatedRoundEvent = [&](const std::string& entityIdRaw,
                                         const std::string& entityHintRaw,
                                         const std::string& eventRaw,
                                         const std::string& tsRaw,
                                         const std::string& zoneRaw,
                                         const json& evidenceRef,
                                         bool preferObservationsForUntimedEvent) -> bool {
        const std::string entityId = trim(entityIdRaw);
        if (entityId.empty()) return false;
        const std::string eventName = trim(normalizeEventName(eventRaw));
        if (eventName.empty()) return false;
        if (!isAllowedStateEvent(eventName)) return false;

        const bool isPresenceEvent = isPresentEventName(eventName);
        const bool hasDirectAnchor =
            !trim(tsRaw).empty() ||
            (evidenceRef.is_object() && nodeHasDirectTemporalAnchor(evidenceRef));
        if (!isPresenceEvent && !hasDirectAnchor) return false;

        if (preferObservationsForUntimedEvent && trim(tsRaw).empty()) {
            const std::string idKey = makeObservationHintKey(entityId, eventName);
            const std::string hintKey = makeObservationHintKey(entityHintRaw, eventName);
            if ((!idKey.empty() && observationEventHints.find(idKey) != observationEventHints.end()) ||
                (!hintKey.empty() && observationEventHints.find(hintKey) != observationEventHints.end())) {
                return false;
            }
        }

        const std::string zone = trim(zoneRaw);
        const std::string acceptedTs = normalizeAcceptedEventTs(tsRaw, defaultRoundEventTs);
        if (acceptedTs.empty()) return false;

        const std::string dedupeKey =
            lower(entityId) + "|" +
            lower(eventName) + "|" +
            lower(zone) + "|" +
            acceptedTs;
        if (!roundAppendedEventKeys.insert(dedupeKey).second) return false;

        appendEvent(st, eventName, entityId, acceptedTs, zone, evidenceRef);
        markRoundEvent(entityId, eventName, acceptedTs);
        return true;
    };

    auto applyEntityStateMetadata = [&](const std::string& entityIdRaw,
                                        const std::string& entityHintRaw,
                                        const std::string& entityTypeRaw,
                                        const json& evidenceRef,
                                        const std::string& evidenceTs) {
        const std::string entityId = trim(entityIdRaw);
        if (entityId.empty() ||
            !st.contains("entities") ||
            !st["entities"].is_object() ||
            !st["entities"].contains(entityId) ||
            !st["entities"][entityId].is_object())
        {
            return;
        }

        json& entityState = st["entities"][entityId];
        const std::string entityHint = trim(entityHintRaw);
        if (!entityHint.empty()) entityState["entity_key"] = entityHint;
        const std::string entityType = trim(entityTypeRaw);
        if (!entityType.empty()) entityState["entity_type"] = entityType;
        applyTemporalEvidenceRefToEntityState(entityState, evidenceRef, evidenceTs);
        if (evidenceRef.is_object() &&
            evidenceRef.contains("temporal_evidence_key") &&
            evidenceRef["temporal_evidence_key"].is_string())
        {
            const std::string evidenceKey = trim(evidenceRef["temporal_evidence_key"].get<std::string>());
            if (!evidenceKey.empty()) recordLastRoundEvidenceKey(st, evidenceKey);
        }
    };

    auto patchSupportsIdentityMemoryFallback = [&](const json& patch) -> bool {
        if (!patch.is_object()) return false;
        if (nodeRepresentsSyntheticAbsence(patch) ||
            nodeSuggestsNoVisiblePerson(patch) ||
            nodeSuggestsNoVisibleTarget(patch) ||
            nodeSuggestsInactionableVisibility(patch))
        {
            return false;
        }
        const std::string eventName = extractStructuredEvidenceEventName(patch);
        if (isAbsenceEventName(eventName)) return false;

        const std::string entityToken = structuredEntityTokenField(patch);
        const json traits = extractTraitsFromNode(patch);
        const std::string description = trim(strField(
            patch,
            "description",
            strField(patch, "entity_description", strField(patch, "person_description"))));
        return !entityToken.empty() ||
               (traits.is_array() && !traits.empty()) ||
               !description.empty();
    };

    auto tryUpsertIdentityMemoryFromWeakPatch = [&](const json& patch,
                                                    const std::string& patchEntityId,
                                                    const std::string& patchEntityHint,
                                                    const std::string& patchEntityType,
                                                    const std::string& patchZone,
                                                    const std::string& patchTs) -> bool {
        if (!patchSupportsIdentityMemoryFallback(patch)) return false;

        std::string resolvedEntityId = trim(patchEntityId);
        if (!resolvedEntityId.empty() && !entityExists(resolvedEntityId)) {
            resolvedEntityId.clear();
        }

        auto resolvedEntityAllowed = [&](const std::string& candidateEntityId) -> bool {
            const std::string normalized = trim(candidateEntityId);
            if (normalized.empty()) return false;
            return roundPositiveEntityIds.empty() ||
                   roundPositiveEntityIds.find(normalized) != roundPositiveEntityIds.end();
        };

        if (resolvedEntityId.empty() && !patchEntityHint.empty()) {
            if (entityExists(patchEntityHint)) {
                resolvedEntityId = patchEntityHint;
            }
            else if (!roundPositiveEntityIds.empty()) {
                const std::string candidate = resolveExistingEntityIdFromHint(patchEntityHint);
                if (resolvedEntityAllowed(candidate)) resolvedEntityId = candidate;
            }
        }
        if (resolvedEntityId.empty() && !patchEntityId.empty() && !roundPositiveEntityIds.empty()) {
            const std::string candidate = resolveExistingEntityIdFromHint(patchEntityId);
            if (resolvedEntityAllowed(candidate)) resolvedEntityId = candidate;
        }
        if (resolvedEntityId.empty() && roundPositiveEntityIds.size() == 1) {
            resolvedEntityId = *roundPositiveEntityIds.begin();
        }
        if (resolvedEntityId.empty()) return false;

        json pseudoPatch = patch;
        pseudoPatch["entity_id"] = resolvedEntityId;
        if (!patchEntityHint.empty() &&
            (!pseudoPatch.contains("entity_key") ||
             !pseudoPatch["entity_key"].is_string() ||
             trim(pseudoPatch["entity_key"].get<std::string>()).empty()))
        {
            pseudoPatch["entity_key"] = patchEntityHint;
        }
        if (!patchEntityType.empty() &&
            (!pseudoPatch.contains("entity_type") ||
             !pseudoPatch["entity_type"].is_string() ||
             trim(pseudoPatch["entity_type"].get<std::string>()).empty()))
        {
            pseudoPatch["entity_type"] = patchEntityType;
        }

        const std::string seenTs = normalizeAcceptedEventTs(patchTs, defaultRoundEventTs);
        upsertIdentityMemory(
            st,
            resolvedEntityId,
            pseudoPatch,
            seenTs.empty() ? nowTs : seenTs,
            patchZone);
        recordIdentityMemoryFallback(
            resolvedEntityId,
            patchEntityHint.empty() ? patchEntityId : patchEntityHint,
            "weak_identity_patch");
        return true;
    };

    auto resolveExistingEntityIdForAbsence = [&](const std::string& entityIdRaw,
                                                 const std::string& entityHintRaw) -> std::string {
        const std::string explicitEntityId = trim(entityIdRaw);
        if (!explicitEntityId.empty() && entityExists(explicitEntityId)) return explicitEntityId;
        const std::string explicitEntityHint = trim(entityHintRaw);
        if (!explicitEntityHint.empty()) {
            const std::string resolvedByHint = resolveExistingEntityIdFromHint(explicitEntityHint);
            if (!resolvedByHint.empty()) return resolvedByHint;
        }
        if (!explicitEntityId.empty()) {
            const std::string resolvedByIdHint = resolveExistingEntityIdFromHint(explicitEntityId);
            if (!resolvedByIdHint.empty()) return resolvedByIdHint;
        }
        return std::string();
    };

    auto commitExplicitEntityAbsence = [&](const std::string& entityIdRaw,
                                           const std::string& entityHintRaw,
                                           const std::string& entityTypeRaw,
                                           const std::string& eventRaw,
                                           const std::string& tsRaw,
                                           const std::string& zoneRaw,
                                           const json& evidenceRef) -> std::string {
        const std::string entityId = resolveExistingEntityIdForAbsence(entityIdRaw, entityHintRaw);
        if (entityId.empty()) return std::string();

        const std::string acceptedTs = normalizeAcceptedEventTs(tsRaw, defaultRoundEventTs);
        if (acceptedTs.empty()) return std::string();

        const std::string normalizedEvent = trim(normalizeEventName(eventRaw));
        const std::string zone = trim(zoneRaw);
        const std::string dedupeHint = trim(entityHintRaw).empty() ? entityId : trim(entityHintRaw);
        if (!normalizedEvent.empty() && isAllowedStateEvent(normalizedEvent)) {
            appendValidatedRoundEvent(
                entityId,
                dedupeHint,
                normalizedEvent,
                acceptedTs,
                zone,
                evidenceRef,
                false);
        }

        applyEntityStateMetadata(entityId, entityHintRaw, entityTypeRaw, evidenceRef, acceptedTs);
        markEntityAbsent(st, entityId, acceptedTs, zone);
        roundTouchedEntityIds.insert(entityId);
        return entityId;
    };

    const bool preferCanonicalCandidateEvents = !canonicalEvidenceCandidates.empty();
    std::unordered_set<std::string> roundAcceptedCandidateEvidenceKeys;
    for (const auto& candidate : canonicalEvidenceCandidates) {
        const std::string eventName = trim(normalizeEventName(candidate.eventName));
        const bool absenceEvent = isAbsenceEventName(eventName);
        if (eventName.empty() || isPresentEventName(eventName)) continue;

        if (!isAllowedStateEvent(eventName)) {
            recordLastRoundCandidateDecision(st, candidate, "rejected_not_in_catalog");
            continue;
        }

        const std::string entityToken = trim(candidate.entityId);
        if (entityToken.empty()) {
            recordLastRoundCandidateDecision(st, candidate, "rejected_missing_entity");
            continue;
        }

        const std::string resolvedEntityId =
            entityExists(entityToken)
                ? entityToken
                : (absenceEvent ? resolveExistingEntityIdFromHint(entityToken)
                                : resolveEntityIdFromHint(entityToken));
        if (trim(resolvedEntityId).empty()) {
            recordLastRoundCandidateDecision(st, candidate, "rejected_missing_entity");
            continue;
        }

        const std::string evidenceKey = trim(candidate.evidenceKey);
        if (!evidenceKey.empty()) {
            if (roundAcceptedCandidateEvidenceKeys.find(evidenceKey) != roundAcceptedCandidateEvidenceKeys.end() ||
                stateAlreadyHasEvidenceKey(st, evidenceKey))
            {
                recordLastRoundCandidateDecision(
                    st,
                    candidate,
                    "rejected_duplicate_evidence_key",
                    resolvedEntityId);
                continue;
            }
        }

        const std::string acceptedTs =
            normalizeAcceptedEventTs(candidate.timestampUtcIso, defaultRoundEventTs);
        if (acceptedTs.empty()) {
            recordLastRoundCandidateDecision(
                st,
                candidate,
                "rejected_missing_timestamp",
                resolvedEntityId);
            continue;
        }

        json evidenceRef = json::object();
        if (!evidenceKey.empty()) evidenceRef["temporal_evidence_key"] = evidenceKey;
        if (candidate.frameIndex >= 0) evidenceRef["frame_index"] = candidate.frameIndex;
        if (!trim(candidate.frameTimestampInSegment).empty()) {
            evidenceRef["frame_timestamp_in_segment"] = trim(candidate.frameTimestampInSegment);
        }
        if (!trim(candidate.timestampName).empty()) {
            evidenceRef["timestamp_name"] = trim(candidate.timestampName);
        }

        const bool appended = appendValidatedRoundEvent(
            resolvedEntityId,
            entityToken,
            eventName,
            acceptedTs,
            trim(candidate.zone),
            evidenceRef,
            false);
        if (!appended) {
            recordLastRoundCandidateDecision(
                st,
                candidate,
                "rejected_duplicate_evidence_key",
                resolvedEntityId,
                acceptedTs);
            continue;
        }

        if (!evidenceKey.empty()) roundAcceptedCandidateEvidenceKeys.insert(evidenceKey);
        if (absenceEvent) {
            applyEntityStateMetadata(resolvedEntityId, entityToken, std::string(), evidenceRef, acceptedTs);
            markEntityAbsent(st, resolvedEntityId, acceptedTs, trim(candidate.zone));
            roundTouchedEntityIds.insert(resolvedEntityId);
        } else {
            touchEntity(st, resolvedEntityId, acceptedTs, trim(candidate.zone), json::array(), forgetEntityMissingForSeconds);
            applyEntityStateMetadata(resolvedEntityId, entityToken, std::string(), evidenceRef, acceptedTs);
            roundTouchedEntityIds.insert(resolvedEntityId);
            roundPositiveEntityIds.insert(resolvedEntityId);
        }
        recordLastRoundCandidateDecision(
            st,
            candidate,
            absenceEvent ? "accepted_absence_event" : "accepted_event",
            resolvedEntityId,
            acceptedTs);
    }

    auto addFallbackObservation = [&](const std::string& descriptionRaw,
                                      const std::string& entityHintRaw,
                                      const std::string& zoneRaw,
                                      const std::string& tsRaw) {
        const std::string description = trim(descriptionRaw);
        if (textSuggestsNoVisiblePerson(description) ||
            textSuggestsNoVisibleTarget(description)) {
            return;
        }

        std::string entityId = resolveEntityIdFromHint(entityHintRaw);
        if (entityId.empty()) return;
        const std::string zone = trim(zoneRaw);
        const std::string eventName = "present";
        const std::string acceptedTs = normalizeAcceptedEventTs(tsRaw, defaultRoundEventTs);
        if (acceptedTs.empty()) return;

        if (!appendValidatedRoundEvent(
                entityId,
                entityHintRaw,
                eventName,
                acceptedTs,
                zone,
                json::object(),
                false))
        {
            return;
        }
        touchEntity(st, entityId, acceptedTs, zone, json::array(), forgetEntityMissingForSeconds);
        roundTouchedEntityIds.insert(entityId);
        roundPositiveEntityIds.insert(entityId);
        json pseudoPatch = json::object();
        pseudoPatch["entity_id"] = entityId;
        if (!description.empty()) pseudoPatch["description"] = description;
        upsertIdentityMemory(st, entityId, pseudoPatch, acceptedTs, zone);
    };

    if (identityPatch.is_array()) {
        for (const auto& p : identityPatch) {
            if (p.is_string()) {
                if (textSuggestsNoVisibleTarget(p.get<std::string>())) continue;
                addFallbackObservation(p.get<std::string>(), defaultEntityKey, "", nowTs);
                continue;
            }
            if (!p.is_object()) continue;
            const double confidence = structuredConfidenceField(p, -1.0);
            const std::string decisionRaw = lower(structuredDecisionField(p));
            const std::string patchEntityId = structuredEntityIdField(p);
            const std::string patchEntityHintRaw = structuredEntityHintField(p);
            const std::string patchEntityHint =
                patchEntityHintRaw.empty() ? inferEntityPrefix(p, plan) : patchEntityHintRaw;
            const std::string patchEntityType = trim(strField(p, "entity_type"));
            const std::string patchZone = extractObservedZoneField(p);
            const std::string patchTs =
                strField(p, "ts_utc", strField(p, "timestamp", strField(p, "time")));
            const json patchEvidenceRef = extractTemporalEvidenceRef(p);
            if (nodeRepresentsSyntheticAbsence(p) ||
                isAbsenceEventName(extractStructuredEvidenceEventName(p)) ||
                observationStatusSuggestsNegative(strField(p, "status", strField(p, "state"))))
            {
                commitExplicitEntityAbsence(
                    patchEntityId,
                    patchEntityHint,
                    patchEntityType,
                    extractStructuredEvidenceEventName(p),
                    patchTs,
                    patchZone,
                    patchEvidenceRef);
                continue;
            }
            std::string decision;
            if (decisionRaw == "match_existing" ||
                decisionRaw == "match" ||
                decisionRaw == "matched" ||
                decisionRaw == "existing" ||
                decisionRaw == "identified")
            {
                decision = "match_existing";
            }
            else if (decisionRaw == "new_entity" ||
                     decisionRaw == "new" ||
                     decisionRaw == "create_new")
            {
                decision = "new_entity";
            }
            else if (decisionRaw == "unknown" ||
                     decisionRaw == "unmatched" ||
                     decisionRaw == "no_match")
            {
                decision = "unknown";
            }
            else {
                decision = (confidence >= matchThreshold)
                    ? "match_existing"
                    : ((confidence >= newThreshold) ? "new_entity" : "unknown");
            }
            if (decision == "unknown") {
                tryUpsertIdentityMemoryFromWeakPatch(
                    p,
                    patchEntityId,
                    patchEntityHint,
                    patchEntityType,
                    patchZone,
                    patchTs);
                continue;
            }

            std::string entityId = trim(strField(p, "entity_id", strField(p, "id")));
            const std::string entityHint = patchEntityHint;
            if (decision == "new_entity") {
                const std::string prefix = entityHint.empty() ? inferEntityPrefix(p, plan) : entityHint;
                entityId = allocateEntityId(st, prefix);
            }
            else {
                if (entityId.empty()) {
                    const std::string hintForResolve = entityHint.empty() ? inferEntityPrefix(p, plan) : entityHint;
                    entityId = resolveEntityIdFromHint(hintForResolve);
                }
                else if (!entityExists(entityId)) {
                    const std::string hintForResolve = entityHint.empty() ? entityId : entityHint;
                    const std::string resolved = resolveEntityIdFromHint(hintForResolve);
                    if (entityExists(resolved)) entityId = resolved;
                }
            }
            if (entityId.empty()) continue;

            const json traits = extractTraitsFromNode(p);
            const std::string zone = patchZone;
            touchEntity(st, entityId, nowTs, zone, traits, forgetEntityMissingForSeconds);
            applyEntityStateMetadata(entityId, entityHint, patchEntityType, patchEvidenceRef, nowTs);
            roundTouchedEntityIds.insert(entityId);
            roundPositiveEntityIds.insert(entityId);
            upsertIdentityMemory(st, entityId, p, nowTs, zone);

            if (p.contains("events") && p["events"].is_array()) {
                for (const auto& ev : p["events"]) {
                    const std::string dedupeHint =
                        entityHint.empty() ? inferEntityPrefix(p, plan) : entityHint;
                    if (ev.is_string()) {
                        const std::string rawEventName = ev.get<std::string>();
                        if (isAbsenceEventName(rawEventName)) {
                            appendValidatedRoundEvent(
                                entityId,
                                dedupeHint,
                                rawEventName,
                                std::string(),
                                zone,
                                json::object(),
                                true
                            );
                            continue;
                        }
                        appendValidatedRoundEvent(
                            entityId,
                            dedupeHint,
                            rawEventName,
                            std::string(),
                            zone,
                            json::object(),
                            true
                        );
                        continue;
                    }
                    if (!ev.is_object()) continue;
                    const std::string eventName = extractStructuredEvidenceEventName(ev);
                    const TemporalEvidenceClass evidenceClass = classifyStructuredEvidence(ev, eventName);
                    if (isAbsenceEventName(eventName)) {
                        appendValidatedRoundEvent(
                            entityId,
                            dedupeHint,
                            eventName,
                            strField(ev, "ts_utc", strField(ev, "timestamp", strField(ev, "time"))),
                            extractZoneField(ev, zone),
                            extractTemporalEvidenceRef(ev),
                            trim(strField(ev, "ts_utc", strField(ev, "timestamp", strField(ev, "time")))).empty()
                        );
                        continue;
                    }
                    if (evidenceClass != TemporalEvidenceClass::positive_event_evidence &&
                        evidenceClass != TemporalEvidenceClass::presence_evidence)
                    {
                        continue;
                    }
                    if (preferCanonicalCandidateEvents &&
                        evidenceClass == TemporalEvidenceClass::positive_event_evidence)
                    {
                        continue;
                    }
                    if (!shouldCommitObservationEvent(ev, eventName)) continue;
                    std::string eventTs = strField(ev, "ts_utc", strField(ev, "timestamp", strField(ev, "time")));
                    if (eventTs.empty() && ev.contains("ts") && ev["ts"].is_string()) {
                        eventTs = ev["ts"].get<std::string>();
                    }
                    appendValidatedRoundEvent(
                        entityId,
                        dedupeHint,
                        eventName,
                        eventTs,
                        extractZoneField(ev, zone),
                        extractTemporalEvidenceRef(ev),
                        trim(eventTs).empty()
                    );
                }
            }
        }
    }

    if (observations.is_array()) {
        for (const auto& o : observations) {
            if (o.is_string()) {
                if (textSuggestsNoVisibleTarget(o.get<std::string>())) continue;
                addFallbackObservation(o.get<std::string>(), defaultEntityKey, "", nowTs);
                continue;
            }
            if (!o.is_object()) continue;
            std::string entityId = trim(strField(o, "entity_id"));
            const std::string entityHint = trim(strField(o, "entity_key", strField(o, "entity_type")));
            const std::string zone = extractZoneField(o);
            const std::string ts = strField(o, "ts_utc", strField(o, "timestamp", strField(o, "time")));
            const std::string eventName = extractStructuredEvidenceEventName(o);
            const json observationEvidenceRef = extractTemporalEvidenceRef(o);
            const TemporalEvidenceClass evidenceClass = classifyStructuredEvidence(o, eventName);
            const std::string observationEntityType = trim(strField(o, "entity_type"));
            const std::string observationEntityHint =
                entityHint.empty() ? inferEntityPrefix(o, plan) : entityHint;
            if (evidenceClass == TemporalEvidenceClass::meta_state_reference ||
                evidenceClass == TemporalEvidenceClass::scene_only_description)
            {
                continue;
            }
            if (evidenceClass == TemporalEvidenceClass::negative_observation) {
                commitExplicitEntityAbsence(
                    entityId,
                    observationEntityHint,
                    observationEntityType,
                    eventName,
                    ts,
                    zone,
                    observationEvidenceRef);
                continue;
            }
            if (preferCanonicalCandidateEvents &&
                evidenceClass == TemporalEvidenceClass::positive_event_evidence)
            {
                continue;
            }
            const std::string acceptedTs = normalizeAcceptedEventTs(ts, defaultRoundEventTs);
            if (acceptedTs.empty()) continue;
            if (entityId.empty()) {
                entityId = resolveEntityIdFromHint(observationEntityHint.empty() ? defaultEntityKey : observationEntityHint);
            }
            const json observationTraits = extractTraitsFromNode(o);
            const bool commitObservationEvent = shouldCommitObservationEvent(o, eventName);
            if (!commitObservationEvent || eventName.empty() || entityId.empty()) {
                continue;
            }
            const std::string entityHintToken = observationEntityHint.empty() ? entityId : observationEntityHint;
            if (!appendValidatedRoundEvent(
                    entityId,
                    entityHintToken,
                    eventName,
                    ts,
                    zone,
                    observationEvidenceRef,
                    false))
            {
                continue;
            }
            touchEntity(st, entityId, acceptedTs, zone, observationTraits, forgetEntityMissingForSeconds);
            applyEntityStateMetadata(entityId, observationEntityHint, observationEntityType, observationEvidenceRef, acceptedTs);
            roundTouchedEntityIds.insert(entityId);
            roundPositiveEntityIds.insert(entityId);
            json pseudoPatch = json::object();
            pseudoPatch["entity_id"] = entityId;
            if (!observationEntityHint.empty()) pseudoPatch["entity_key"] = observationEntityHint;
            if (!observationEntityType.empty()) pseudoPatch["entity_type"] = observationEntityType;
            const std::string description =
                trim(strField(o, "description", strField(o, "note", strField(o, "entity_description", strField(o, "person_description")))));
            if (!description.empty()) pseudoPatch["description"] = description;
            if (observationTraits.is_array() && !observationTraits.empty()) pseudoPatch["updated_traits"] = observationTraits;
            upsertIdentityMemory(st, entityId, pseudoPatch, acceptedTs, zone);
        }
    }

    const bool explicitNoVisibleTargetThisBatch =
        textSuggestsNoVisiblePerson(answer) ||
        textSuggestsNoVisibleTarget(answer) ||
        nodeSuggestsNoVisiblePerson(unknownReasons) ||
        nodeSuggestsNoVisibleTarget(unknownReasons) ||
        nodeSuggestsNoVisiblePerson(observations) ||
        nodeSuggestsNoVisibleTarget(observations);
    if (explicitNoVisibleTargetThisBatch &&
        roundPositiveEntityIds.empty() &&
        !currentBatchHasEntityEvidence(identityPatch, observations) &&
        st.contains("entities") &&
        st["entities"].is_object())
    {
        for (auto it = st["entities"].begin(); it != st["entities"].end(); ++it) {
            if (!it.value().is_object()) continue;
            markEntityAbsent(st, it.key(), defaultRoundEventTs);
            roundTouchedEntityIds.insert(it.key());
        }
    }

    auto findLatestEventTs = [&](const std::string& eventName, const std::string& entityId) -> std::string {
        const std::string targetEvent = lower(trim(normalizeEventName(eventName)));
        const std::string targetEntity = trim(entityId);
        std::string latest;
        for (const auto& ev : st["events"]) {
            if (!ev.is_object()) continue;
            if (!targetEntity.empty() && trim(strField(ev, "entity_id")) != targetEntity) continue;
            if (!targetEvent.empty() && lower(trim(strField(ev, "event"))) != targetEvent) continue;
            const std::string ts = trim(strField(ev, "ts_utc"));
            if (ts.empty()) continue;
            if (latest.empty() || ts > latest) latest = ts;
        }
        return latest;
    };

    for (const auto& kv : roundLastPresentTs) {
        const std::string entityId = kv.first;
        if (entityId.empty()) continue;
        if (roundHasEntered.find(entityId) != roundHasEntered.end()) continue;
        const std::string lastPresentTs = kv.second.empty() ? nowTs : kv.second;

        bool inferEntered = false;
        auto itLeftThisRound = roundLastLeftTs.find(entityId);
        if (itLeftThisRound != roundLastLeftTs.end()) {
            if (!itLeftThisRound->second.empty() && lastPresentTs > itLeftThisRound->second) {
                inferEntered = true;
            }
        }
        else {
            const std::string lastLeftOverall = findLatestEventTs("left_zone", entityId);
            const std::string lastEnteredOverall = findLatestEventTs("entered_zone", entityId);
            if (!lastLeftOverall.empty() && (lastEnteredOverall.empty() || lastLeftOverall > lastEnteredOverall)) {
                inferEntered = true;
            }
        }

        if (inferEntered) {
            std::string zone;
            if (st.contains("entities") && st["entities"].is_object() &&
                st["entities"].contains(entityId) && st["entities"][entityId].is_object())
            {
                zone = trim(strField(st["entities"][entityId], "current_zone"));
            }
            appendValidatedRoundEvent(
                entityId,
                entityId,
                "entered_zone",
                lastPresentTs,
                zone,
                json::object(),
                false);
        }
    }

    if (resolvedIdentityMatches.is_array() &&
        resolvedIdentityMatches.size() == 1 &&
        roundPositiveEntityIds.size() == 1 &&
        resolvedIdentityMatches[0].is_object())
    {
        upsertResolvedIdentity(
            st,
            *roundPositiveEntityIds.begin(),
            resolvedIdentityMatches[0],
            nowTs
        );
    }

    const json retentionPolicy = plan.value("retention_policy", json::object());
    const json identityPolicyRuntime = plan.value("identity_policy", json::object());
    const int minimumHistoricalRetentionSeconds = 43200;
    const int stateTtlSeconds = intField(retentionPolicy, "state_ttl_seconds", 43200);
    const int identityMemoryRetentionSeconds = std::max(
        minimumHistoricalRetentionSeconds,
        intField(identityPolicyRuntime, "max_identity_age_seconds", minimumHistoricalRetentionSeconds));
    const int entityRetentionSeconds = std::max(
        std::max(
            minimumHistoricalRetentionSeconds,
            intField(retentionPolicy, "entity_retention_seconds", identityMemoryRetentionSeconds)),
        identityMemoryRetentionSeconds);
    json keptEvents = json::array();
    for (const auto& ev : st["events"]) {
        if (!ev.is_object()) continue;
        const long long eventAge = ageSeconds(strField(ev, "ts_utc"), nowTs);
        if (eventAge >= 0 && eventAge <= stateTtlSeconds) keptEvents.push_back(ev);
    }
    st["events"] = std::move(keptEvents);

    if (st.contains("identity_memory") && st["identity_memory"].is_array()) {
        json keptIdentity = json::array();
        for (const auto& m : st["identity_memory"]) {
            if (!m.is_object()) continue;
            const std::string lastSeenTs = identityMemoryLastSeenTs(m);
            if (lastSeenTs.empty()) {
                keptIdentity.push_back(m);
                continue;
            }
            const long long memoryAge = ageSeconds(lastSeenTs, nowTs);
            if (memoryAge < 0 || memoryAge <= identityMemoryRetentionSeconds) {
                keptIdentity.push_back(m);
            }
        }
        st["identity_memory"] = std::move(keptIdentity);
    }

    if (st.contains("entities") && st["entities"].is_object()) {
        json keptEntities = json::object();
        for (auto it = st["entities"].begin(); it != st["entities"].end(); ++it) {
            if (!it.value().is_object()) continue;
            const json* identityMemoryRow = findIdentityMemoryByEntityId(st, it.key());
            const std::string lastSeenTs = entityStateLastSeenTs(it.value(), identityMemoryRow);
            if (lastSeenTs.empty()) {
                if (roundTouchedEntityIds.find(it.key()) != roundTouchedEntityIds.end()) {
                    keptEntities[it.key()] = it.value();
                }
                continue;
            }
            const long long entityAge = ageSeconds(lastSeenTs, nowTs);
            if (entityAge < 0 || entityAge <= entityRetentionSeconds) {
                keptEntities[it.key()] = it.value();
            }
        }
        st["entities"] = std::move(keptEntities);
    }

    auto countEventsFiltered = [&](const std::string& eventName,
                                   int windowSeconds,
                                   const std::string& entityIdExact,
                                   const std::string& zoneFilter = std::string()) -> long long {
        if (isPresentEventName(eventName)) {
            if (windowSeconds > 0) {
                return countPresentEntitiesInState(st, nowTs, windowSeconds, entityIdExact, zoneFilter);
            }
            return countDistinctEventEntities(st, eventName, nowTs, 0, entityIdExact, zoneFilter);
        }
        long long count = 0;
        const std::string ev = lower(trim(eventName));
        for (const auto& item : st["events"]) {
            if (!item.is_object()) continue;
            if (!ev.empty() && lower(trim(strField(item, "event"))) != ev) continue;
            if (!entityIdExact.empty() && trim(strField(item, "entity_id")) != entityIdExact) continue;
            if (!zoneMatchesFilter(extractZoneField(item), zoneFilter)) continue;
            if (windowSeconds > 0 && ageSeconds(strField(item, "ts_utc"), nowTs) > windowSeconds) continue;
            ++count;
        }
        return count;
    };

    auto latestEventTs = [&](const std::string& eventName,
                             const std::string& entityIdExact,
                             const std::string& zoneFilter = std::string()) -> std::string {
        if (isPresentEventName(eventName)) {
            return latestPresentTimestampInState(st, entityIdExact, zoneFilter);
        }
        const std::string ev = lower(trim(eventName));
        std::string latest;
        for (const auto& item : st["events"]) {
            if (!item.is_object()) continue;
            if (!ev.empty() && lower(trim(strField(item, "event"))) != ev) continue;
            if (!entityIdExact.empty() && trim(strField(item, "entity_id")) != entityIdExact) continue;
            if (!zoneMatchesFilter(extractZoneField(item), zoneFilter)) continue;
            const std::string ts = strField(item, "ts_utc");
            if (ts.empty()) continue;
            if (latest.empty() || ts > latest) latest = ts;
        }
        return latest;
    };

    auto buildWindowBuffer = [&](const std::string& eventName,
                                 int windowSeconds,
                                 const std::string& entityIdExact,
                                 int maxItems,
                                 const std::string& zoneFilter = std::string()) -> json {
        json arr = json::array();
        const std::string ev = lower(trim(eventName));
        for (auto it = st["events"].rbegin(); it != st["events"].rend(); ++it) {
            if (!it->is_object()) continue;
            if (!ev.empty() && lower(trim(strField(*it, "event"))) != ev) continue;
            if (!entityIdExact.empty() && trim(strField(*it, "entity_id")) != entityIdExact) continue;
            if (!zoneMatchesFilter(extractZoneField(*it), zoneFilter)) continue;
            if (windowSeconds > 0 && ageSeconds(strField(*it, "ts_utc"), nowTs) > windowSeconds) continue;
            arr.push_back(*it);
            if (maxItems > 0 && static_cast<int>(arr.size()) >= maxItems) break;
        }
        std::reverse(arr.begin(), arr.end());
        return arr;
    };

    if (plan.contains("runtime_variables") && plan["runtime_variables"].is_array()) {
        if (!st.contains("global_vars") || !st["global_vars"].is_object()) st["global_vars"] = json::object();
        if (!st.contains("entities") || !st["entities"].is_object()) st["entities"] = json::object();

        for (const auto& rv : plan["runtime_variables"]) {
            if (!rv.is_object()) continue;
            const std::string name = trim(strField(rv, "name"));
            const std::string scope = lower(trim(strField(rv, "scope")));
            const std::string kind = lower(trim(strField(rv, "compute_kind")));
            const json params = rv.value("compute_params", json::object());
            const json init = rv.contains("init") ? rv["init"] : json(nullptr);
            if (name.empty() || (scope != "entity" && scope != "global")) continue;

            auto computeValue = [&](const std::string& entityId) -> json {
                const std::string eventName = strField(params, "event");
                const int windowSeconds = intField(params, "window_seconds", intField(params, "duration_seconds", 0));
                const std::string zone = extractZoneField(params);
                if (kind == "event_counter") {
                    return json(countEventsFiltered(eventName, windowSeconds, scope == "entity" ? entityId : "", zone));
                }
                if (kind == "last_event_timestamp") {
                    const std::string ts = latestEventTs(eventName, scope == "entity" ? entityId : "", zone);
                    return ts.empty() ? init : json(ts);
                }
                if (kind == "duration_since_event") {
                    const std::string ts = latestEventTs(eventName, scope == "entity" ? entityId : "", zone);
                    return ts.empty() ? init : json(ageSeconds(ts, nowTs));
                }
                if (kind == "presence_flag") {
                    int win = intField(params, "window_seconds", 300);
                    if (win <= 0) win = 300;
                    if (scope == "entity") {
                        if (!st["entities"].contains(entityId) || !st["entities"][entityId].is_object()) return json(false);
                        const std::string lastSeen = strField(st["entities"][entityId], "last_seen_ts");
                        return json(
                            !lastSeen.empty() &&
                            ageSeconds(lastSeen, nowTs) <= win &&
                            zoneMatchesFilter(strField(st["entities"][entityId], "current_zone"), zone));
                    }
                    bool presentAny = false;
                    for (auto it = st["entities"].begin(); it != st["entities"].end(); ++it) {
                        if (!it.value().is_object()) continue;
                        const std::string lastSeen = strField(it.value(), "last_seen_ts");
                        if (!lastSeen.empty() &&
                            ageSeconds(lastSeen, nowTs) <= win &&
                            zoneMatchesFilter(strField(it.value(), "current_zone"), zone)) {
                            presentAny = true;
                            break;
                        }
                    }
                    return json(presentAny);
                }
                if (kind == "window_buffer") {
                    const int maxItems = intField(params, "max_items", 20);
                    return buildWindowBuffer(eventName, windowSeconds, scope == "entity" ? entityId : "", maxItems, zone);
                }
                return init;
            };

            if (scope == "global") {
                if (!st["global_vars"].contains(name)) st["global_vars"][name] = init;
                st["global_vars"][name] = computeValue(std::string());
            }
            else {
                for (auto it = st["entities"].begin(); it != st["entities"].end(); ++it) {
                    if (!it.value().is_object()) continue;
                    if (!it.value().contains("vars") || !it.value()["vars"].is_object()) it.value()["vars"] = json::object();
                    if (!it.value()["vars"].contains(name)) it.value()["vars"][name] = init;
                    it.value()["vars"][name] = computeValue(it.key());
                }
            }
        }
    }
}

inline json buildStateSlice(const json& st, const json& envelope) {
    const json plan = effectivePlan(envelope);
    std::vector<std::string> names;
    if (plan.contains("runtime_variables") && plan["runtime_variables"].is_array()) {
        for (const auto& v : plan["runtime_variables"]) {
            if (v.is_object() && v.contains("name") && v["name"].is_string()) names.push_back(v["name"].get<std::string>());
        }
    }
    json out = json::object();
    if (!st.is_object() || !st.contains("entities") || !st["entities"].is_object()) return out;
    struct StateSliceEntityRow {
        std::string entityId;
        const json* entityState = nullptr;
        std::string lastSeenTs;
    };
    std::vector<StateSliceEntityRow> orderedEntities;
    orderedEntities.reserve(st["entities"].size());
    for (auto it = st["entities"].begin(); it != st["entities"].end(); ++it) {
        if (!it.value().is_object()) continue;
        orderedEntities.push_back(StateSliceEntityRow{
            it.key(),
            &it.value(),
            entityStateLastSeenTs(it.value(), findIdentityMemoryByEntityId(st, it.key()))
        });
    }
    std::sort(
        orderedEntities.begin(),
        orderedEntities.end(),
        [](const StateSliceEntityRow& lhs, const StateSliceEntityRow& rhs) {
            if (lhs.lastSeenTs != rhs.lastSeenTs) return lhs.lastSeenTs > rhs.lastSeenTs;
            return lhs.entityId < rhs.entityId;
        });
    int count = 0;
    for (const auto& row : orderedEntities) {
        if (!row.entityState || !row.entityState->is_object()) continue;
        if (count >= 12) break;
        json vars = json::object();
        if (row.entityState->contains("vars") && (*row.entityState)["vars"].is_object()) {
            for (const auto& n : names) {
                if ((*row.entityState)["vars"].contains(n)) {
                    vars[n] = (*row.entityState)["vars"][n];
                    continue;
                }
                if (n == "event_count_lifetime" && (*row.entityState)["vars"].contains("event_count_1h")) {
                    vars[n] = (*row.entityState)["vars"]["event_count_1h"];
                }
            }
        }
        out[row.entityId] = vars;
        ++count;
    }
    return out;
}

inline std::string runtimeVariableMeaning(const json& rv) {
    const std::string name = trim(strField(rv, "name"));
    const std::string scope = lower(trim(strField(rv, "scope")));
    const std::string kind = lower(trim(strField(rv, "compute_kind")));
    const json params = rv.value("compute_params", json::object());
    const std::string eventName = trim(strField(params, "event"));
    const int windowSeconds = intField(params, "window_seconds", intField(params, "duration_seconds", 0));
    const std::string scopeLabel = (scope == "global") ? "all tracked entities" : "that entity";
    if (kind == "event_counter") {
        if (windowSeconds <= 0) {
            return "Confirmed cumulative count of event '" + eventName + "' for " + scopeLabel + " while it remains in temporal memory.";
        }
        return "Confirmed count of event '" + eventName + "' for " + scopeLabel +
               " within the last " + std::to_string(windowSeconds) + " seconds.";
    }
    if (kind == "last_event_timestamp") {
        return "Most recent confirmed timestamp for event '" + eventName + "' for " + scopeLabel + ".";
    }
    if (kind == "duration_since_event") {
        return "Seconds since the most recent confirmed event '" + eventName + "' for " + scopeLabel + ".";
    }
    if (kind == "presence_flag") {
        return "Boolean indicating whether " + scopeLabel + " is still considered present in recent state.";
    }
    if (kind == "window_buffer") {
        return "Recent confirmed event buffer for event '" + eventName + "' for " + scopeLabel + ".";
    }
    return name.empty() ? "Runtime variable maintained by the temporal engine." : ("Runtime variable '" + name + "' maintained by the temporal engine.");
}

inline json buildRuntimeVariableContract(const json& envelope) {
    const json plan = effectivePlan(envelope);
    json out = json::array();
    if (!plan.is_object() || !plan.contains("runtime_variables") || !plan["runtime_variables"].is_array()) {
        return out;
    }
    for (const auto& rv : plan["runtime_variables"]) {
        if (!rv.is_object()) continue;
        json item = {
            { "name", strField(rv, "name") },
            { "scope", strField(rv, "scope") },
            { "type", strField(rv, "type") },
            { "compute_kind", strField(rv, "compute_kind") },
            { "meaning", runtimeVariableMeaning(rv) }
        };
        if (rv.contains("compute_params") && rv["compute_params"].is_object()) {
            item["compute_params"] = rv["compute_params"];
        }
        out.push_back(std::move(item));
    }
    return out;
}

inline constexpr const char* kTemporalStaticPromptMarker = "TEMPORAL_STATIC_CONTEXT_JSON:";
inline constexpr const char* kTemporalRuntimePromptMarker = "TEMPORAL_RUNTIME_STATE_JSON:";

inline json buildInferenceStaticContext(const json& envelope) {
    const json plan = effectivePlan(envelope);
    return json{
        { "plan_ref", {
            { "plan_id", strField(plan, "plan_id") },
            { "plan_hash", strField(plan, "plan_hash") },
            { "schema_version", strField(plan, "schema_version", "temporal-plan/1.0") }
        }},
        { "entities_contract", plan.value("entities", json::array()) },
        { "event_catalog", plan.value("event_catalog", json::array()) },
        { "identity_policy", plan.value("identity_policy", json::object()) },
        { "runtime_variable_contract", buildRuntimeVariableContract(envelope) },
        { "state_semantics", {
            { "state_slice_authority", "authoritative_confirmed_state_from_prior_rounds" },
            { "identity_memory_authority", "authoritative_identity_memory_from_prior_rounds" },
            { "observations_scope", "current_batch_only" },
            { "final_alert_authority", "temporal_engine" }
        }},
        { "expected_output_schema", {
            { "identity_patch", json::array() },
            { "observations", json::array() },
            { "unknown_reasons", json::array() }
        }}
    };
}

inline json sanitizePromptIdentityPayload(const json& value) {
    if (value.is_array()) {
        json out = json::array();
        for (const auto& item : value) {
            out.push_back(sanitizePromptIdentityPayload(item));
        }
        return out;
    }
    if (!value.is_object()) return value;

    json out = json::object();
    for (auto it = value.begin(); it != value.end(); ++it) {
        const std::string key = it.key();
        if (key == "stable_attributes" || key == "identity_signature_summary" || key == "appearance_summary") continue;
        out[key] = sanitizePromptIdentityPayload(it.value());
    }
    if ((!out.contains("description") || !out["description"].is_string() ||
         trim(out["description"].get<std::string>()).empty()) &&
        value.contains("appearance_summary") &&
        value["appearance_summary"].is_string())
    {
        const std::string legacyAppearanceSummary = trim(value["appearance_summary"].get<std::string>());
        if (!legacyAppearanceSummary.empty()) {
            out["description"] = legacyAppearanceSummary;
        }
    }
    return out;
}

inline json buildInferenceRuntimeState(const json& envelope,
                                       const json& st,
                                       int cameraId,
                                       const std::string& nowIsoUtc,
                                       const std::string& segmentStartTsRaw = std::string(),
                                       const std::string& segmentEndTsRaw = std::string()) {
    json idMem = json::array();
    if (st.is_object() && st.contains("identity_memory") && st["identity_memory"].is_array()) {
        struct IdentityMemoryPromptRow {
            std::string lastSeenTs;
            json row;
        };
        std::vector<IdentityMemoryPromptRow> orderedRows;
        orderedRows.reserve(st["identity_memory"].size());
        for (const auto& row : st["identity_memory"]) {
            if (!row.is_object()) continue;
            const json promptRow = sanitizePromptIdentityPayload(row);
            orderedRows.push_back(IdentityMemoryPromptRow{
                identityMemoryLastSeenTs(row),
                promptRow
            });
        }
        std::sort(
            orderedRows.begin(),
            orderedRows.end(),
            [](const IdentityMemoryPromptRow& lhs, const IdentityMemoryPromptRow& rhs) {
                if (lhs.lastSeenTs != rhs.lastSeenTs) return lhs.lastSeenTs > rhs.lastSeenTs;
                return lhs.row.dump() < rhs.row.dump();
            });
        for (std::size_t i = 0; i < orderedRows.size() && i < 24; ++i) {
            idMem.push_back(orderedRows[i].row);
        }
    }
    const std::string segmentStartTs = normalizeFlexibleTs(segmentStartTsRaw);
    const std::string segmentEndTs = normalizeFlexibleTs(segmentEndTsRaw);
    json timeContext = { { "now_utc", decisionAnchorUtc(nowIsoUtc, segmentEndTs) } };
    if (!segmentStartTs.empty()) timeContext["segment_start_utc"] = segmentStartTs;
    if (!segmentEndTs.empty()) timeContext["segment_end_utc"] = segmentEndTs;
    return json{
        { "camera_id", cameraId },
        { "state_slice", buildStateSlice(st, envelope) },
        { "identity_memory", idMem },
        { "time_context", timeContext }
    };
}

inline json buildInferenceInput(const json& envelope,
                                const json& st,
                                int cameraId,
                                const std::string& nowIsoUtc,
                                const std::string& segmentStartTsRaw = std::string(),
                                const std::string& segmentEndTsRaw = std::string()) {
    json combined = buildInferenceStaticContext(envelope);
    const json runtimeState = buildInferenceRuntimeState(
        envelope,
        st,
        cameraId,
        nowIsoUtc,
        segmentStartTsRaw,
        segmentEndTsRaw
    );
    for (auto it = runtimeState.begin(); it != runtimeState.end(); ++it) {
        combined[it.key()] = it.value();
    }
    return combined;
}

inline void splitInferenceInputForPrompt(const json& runtimeInput, json& staticContext, json& runtimeState) {
    staticContext = json::object();
    runtimeState = json::object();
    if (!runtimeInput.is_object()) return;

    const std::unordered_set<std::string> staticKeys = {
        "plan_ref",
        "entities_contract",
        "event_catalog",
        "identity_policy",
        "runtime_variable_contract",
        "state_semantics",
        "expected_output_schema"
    };

    for (auto it = runtimeInput.begin(); it != runtimeInput.end(); ++it) {
        if (staticKeys.find(it.key()) != staticKeys.end()) {
            staticContext[it.key()] = it.value();
        }
        else {
            runtimeState[it.key()] = it.value();
        }
    }
}

inline std::string runtimePromptAppendix(const json& runtimeInput) {
    json staticContext = json::object();
    json runtimeState = json::object();
    splitInferenceInputForPrompt(runtimeInput, staticContext, runtimeState);
    const json expectedOutputSchema =
        staticContext.contains("expected_output_schema") &&
        staticContext["expected_output_schema"].is_object()
            ? staticContext["expected_output_schema"]
            : json::object();
    const std::string watchlistMatchField =
        expectedOutputSchema.contains("watchlist_updates")
            ? std::string("watchlist_updates")
            : std::string("cross_camera_watchlist_matches");
    std::ostringstream oss;
    oss << "\n\n" << kTemporalStaticPromptMarker << "\n" << staticContext.dump()
        << "\n\n" << kTemporalRuntimePromptMarker << "\n" << runtimeState.dump()
        << "\n\nTEMPORAL_RUNTIME_INPUT_JSON_COMPAT_NOTE:\n"
        << "- Legacy TEMPORAL_RUNTIME_INPUT_JSON is now split between TEMPORAL_STATIC_CONTEXT_JSON and TEMPORAL_RUNTIME_STATE_JSON.\n"
        << "\n\nTEMPORAL OUTPUT RULES:\n"
        << "- Keep original output fields requested by this prompt.\n"
        << "- Also return identity_patch (array), observations (array), unknown_reasons (array).\n"
        << "- state_slice and identity_memory are authoritative confirmed state from prior rounds. Use them when interpreting cumulative behavior.\n"
        << "- If identity_memory contains resolved_identity metadata for an entity, preserve that metadata for the same entity_id; do not replace entity_id with a human name.\n"
        << "- observations and identity_patch MUST describe only what is visible in the current batch or snapshot.\n"
        << "- answer may combine the current batch with state_slice when explaining cumulative counts or prior confirmed context.\n"
        << "- alert_condition must reflect only whether the current batch itself satisfies the local alert condition; use state_slice only for explanation and identity continuity. The TemporalEngine is the final alert authority.\n"
        << "- Use time_context.now_utc as authoritative current time for temporal decisions.\n"
        << "- If an on-frame clock conflicts with provided temporal fields, prefer provided temporal fields.\n"
        << "- If time_context.segment_start_utc and time_context.segment_end_utc are present, any ts_utc you emit must stay inside that interval.\n"
        << "- identity_patch and observations MUST be arrays of JSON objects (never plain strings).\n"
        << "- For each tracked entity visible in this batch, return identity_patch with entity_id when known, plus entity_key and entity_type whenever they can be inferred from the plan or visible entity, along with a short description, identity_signature_traits, and updated_traits/key_traits.\n"
        << "- When possible, also emit identity_signature_traits as the primary language-agnostic identity field for cross-camera reidentification, focused on strong physical identity cues only.\n"
        << "- If a visible tracked entity or shared hunt target has enough appearance detail for reidentification, do not omit identity_signature_traits just because the identity looks unchanged from prior rounds. Repeat the explicit identity cues that remain visually supported.\n"
        << "- For a visible person, prioritize identity_signature_traits such as visible skin tone, hair color/style/length, beard or mustache, glasses, hat/cap color and type, upper clothing color/type/pattern/logo, lower clothing color/type, footwear, bag, tattoos, scars, jewelry, and clearly visible carried objects.\n"
        << "- For a visible vehicle, prioritize identity_signature_traits such as make, model, color, body style, plate or visible plate fragments, stickers, dents, scratches, broken lights, rack, or other distinctive body details.\n"
        << "- identity_context_traits is optional and should contain only a few brief non-identity continuity cues.\n"
        << "- scene_brief is optional and should be a very short scene hint only when useful for continuity.\n"
        << "- If the same continuous action stays visible across multiple frames, emit one event observation for the first clearly supported transition and use later frames only as continuity for that same episode.\n"
        << "- When you include a continuity object for a later frame of the same episode, mark it with continuation=true and counts_as_new_event=false.\n"
        << "- Reuse stable entity_id/entity_key across rounds for the same real-world entity; create a new ID only when it is clearly a different entity.\n"
        << "- Use canonical event object fields whenever possible.\n"
        << "- For video batches where each frame has FRAME_META_JSON, prefer event, frame_index, frame_timestamp_in_segment, and zone.\n"
        << "- If timestamp_name is available in FRAME_META_JSON, you may copy it exactly, but never invent or reformat it.\n"
        << "- When exact frame references are present, the backend will derive ts_utc, so do not invent ts_utc from timestamp_name.\n"
        << "- For stills or when no exact frame reference is available, use event, ts_utc, and zone.\n"
        << "- When providing zone information in identity_patch or observations, use zone as the canonical field name instead of zone_id, zone_key, region, region_id, or region_key.\n"
        << "- When the scenario is about entering/leaving places, use entered_zone and left_zone from event_catalog instead of only generic present.\n"
        << "- Do not infer entered_zone just because the entity is already visible in the first frame of the batch; only use entered_zone when the entry is actually visible.\n"
        << "- If an entity leaves and later re-enters in the same batch, emit both events in chronological order.\n"
        << "- Keep identity_signature_traits concise (2-8 items) and focused on durable target-centric identity cues: clothing colors/types, accessories, hair, beard, visible skin tone, carried object, build, markings, or vehicle make/model/color/plate fragments when visible.\n"
        << "- Do not place background, room layout, furniture, doors, walls, lighting, or surrounding scene details inside identity_signature_traits unless they are physically attached to the target.\n"
        << "- Do not place pose, action, hand state, gaze direction, relation to keyboard/computer/furniture, or scene layout inside identity_signature_traits.\n"
        << "- updated_traits may capture transient cues or scene context for continuity, but they must not replace the stable appearance signature.\n"
        << "- If a tracked entity is visible, include at least one identity_patch item with decision, confidence, and an appearance snapshot for continuity.\n"
        << "- When temporal context lets you match a visible entity to prior state, prefer including decision and confidence in identity_patch even when entity_id is inferred from that context.\n"
        << "- If a tracked entity from state_slice or identity_memory is no longer visible in this batch, return identity_patch for that same entity_id with decision set to not_visible_this_segment or absent.\n"
        << "- If TEMPORAL_RUNTIME_INPUT_JSON includes cross_camera_watchlist, treat it as an authoritative watchlist from other cameras in the same Job Step, even if this camera has different local alert logic.\n"
        << "- Each cross_camera_watchlist entry may include target_entity, entities, and search_prompt. Treat target_entity as an identity-only signature from the source camera and use target_entity plus search_prompt as the primary instructions for what to look for.\n"
        << "- target_entity.entity_id and source_entity_id in cross_camera_watchlist refer to the source-camera target that started the hunt, not to a local entity_id in the current camera.\n"
        << "- Treat cross_camera_watchlist as a high-priority shared hunt for this round, even when the local task text is about another class or activity.\n"
        << "- Evaluate cross_camera_watchlist independently from the local alert_condition. A strong watchlist match should still be reported even when the local alert_condition remains false.\n"
        << "- Do not let an unrelated local answer suppress a strong cross_camera_watchlist match.\n"
        << "- Compare watchlist targets using target-centric identity traits such as physical appearance, clothing, accessories, carried objects, body markings, vehicle details, and resolved_identity metadata when present. Ignore room/background details, furniture, doors, walls, lighting, activity, and surrounding scene unless physically attached to the target. Allow for normal cross-camera differences in angle, lighting, scale, and background.\n"
        << "- If the current batch strongly matches one or more watchlist entries, return " << watchlistMatchField << " as an array of JSON objects with hunt_id, matched_entity_id, confidence, and optional reason.\n"
        << "- matched_entity_id inside " << watchlistMatchField << " must be the local entity_id from the current camera when available. Do not copy target_entity.entity_id as matched_entity_id unless that exact same local ID is already being used in this camera.\n"
        << "- Do not write temporal state directly.\n";
    return oss.str();
}

inline json collectTriggeredEntityIdsForCrossCameraPublish(const json& operatorResults) {
    json ids = json::array();
    if (!operatorResults.is_array()) return ids;
    std::unordered_set<std::string> seen;
    auto appendId = [&](const std::string& rawId) {
        const std::string entityId = trim(rawId);
        if (entityId.empty()) return;
        if (!seen.insert(entityId).second) return;
        ids.push_back(entityId);
    };

    auto resultValueTrue = [&](const json& result) -> bool {
        if (!result.is_object() || !result.contains("value")) return false;
        const json& valueNode = result["value"];
        if (valueNode.is_boolean()) return valueNode.get<bool>();
        if (valueNode.is_string()) return lower(trim(valueNode.get<std::string>())) == "true";
        return false;
    };

    for (const auto& result : operatorResults) {
        if (!result.is_object() || !resultValueTrue(result)) continue;
        const std::string typ = lower(trim(strField(result, "type")));
        if (typ == "cross_camera_track_after_trigger") continue;

        appendId(strField(result, "entity_id"));
        appendId(strField(result, "matched_entity_id"));

        if (!result.contains("entities") || !result["entities"].is_array()) continue;
        bool useCrossedThresholdOnly = false;
        for (const auto& entityNode : result["entities"]) {
            if (!entityNode.is_object()) continue;
            if (entityNode.contains("crossed_threshold") && entityNode["crossed_threshold"].is_boolean()) {
                useCrossedThresholdOnly = true;
                break;
            }
        }
        for (const auto& entityNode : result["entities"]) {
            if (!entityNode.is_object()) continue;
            if (useCrossedThresholdOnly) {
                if (!entityNode.contains("crossed_threshold") ||
                    !entityNode["crossed_threshold"].is_boolean() ||
                    !entityNode["crossed_threshold"].get<bool>())
                {
                    continue;
                }
            }
            appendId(strField(entityNode, "entity_id", strField(entityNode, "matched_entity_id")));
        }
    }
    return ids;
}

struct EvalResult {
    bool alert = false;
    bool report = false;
    bool hasUnknownOperatorResults = false;
    bool hasActionableAlertOperator = false;
    json operatorResults = json::array();
    std::string summary;
};

inline bool shouldFallbackToLocalAlert(const EvalResult& eval, bool localAlertSignal) {
    if (!localAlertSignal || eval.alert) return false;
    return !eval.hasActionableAlertOperator;
}

inline std::string describeLocalAlertFallback(const EvalResult& eval) {
    if (eval.hasUnknownOperatorResults) {
        return "Temporal engine returned only unknown operator results; preserved local alert_condition=true.";
    }
    return "Temporal engine provided no actionable alert operator; preserved local alert_condition=true.";
}

inline long long countEvents(const json& st,
                             const std::string& eventName,
                             const std::string& nowIsoUtc,
                             int windowSeconds,
                             const std::string& entityFilter = std::string(),
                             const std::string& zoneFilter = std::string()) {
    if (isPresentEventName(eventName)) {
        if (windowSeconds > 0) {
            return countPresentEntitiesInState(st, nowIsoUtc, windowSeconds, entityFilter, zoneFilter);
        }
        return countDistinctEventEntities(st, eventName, nowIsoUtc, 0, entityFilter, zoneFilter);
    }
    if (!st.is_object() || !st.contains("events") || !st["events"].is_array()) return 0;
    const std::string ev = lower(trim(eventName));
    long long n = 0;
    for (const auto& item : st["events"]) {
        if (!item.is_object()) continue;
        if (eventRepresentsSyntheticAbsence(st, item)) continue;
        if (!ev.empty() && lower(trim(strField(item, "event"))) != ev) continue;
        if (!trim(entityFilter).empty() && !eventMatchesFilter(st, item, entityFilter)) continue;
        if (!zoneMatchesFilter(extractZoneField(item), zoneFilter)) continue;
        if (windowSeconds > 0 && ageSeconds(strField(item, "ts_utc"), nowIsoUtc) > windowSeconds) continue;
        ++n;
    }
    return n;
}

inline EvalResult evaluate(json& st, const json& envelope, const std::string& nowIsoUtc) {
    ensureState(st);
    EvalResult r;
    const json plan = effectivePlan(envelope);
    if (!plan.is_object() || !plan.contains("operators") || !plan["operators"].is_array()) return r;
    const json policy = plan.value("output_policy", json::object());
    const int cooldown = intField(policy, "alert_cooldown_seconds", 60);
    const int presenceRecencySeconds = std::max(
        1,
        intField(plan.value("retention_policy", json::object()), "forget_entity_missing_for_seconds", 300));
    json& operatorState = st["meta"]["operator_state"];
    if (!operatorState.is_object()) operatorState = json::object();
    std::vector<std::string> summaryParts;

    auto collectMatchingEntityIds = [&](const std::string& filter) -> std::vector<std::string> {
        std::vector<std::string> ids;
        std::unordered_set<std::string> seen;
        auto acceptId = [&](const std::string& rawId) {
            const std::string id = trim(rawId);
            if (id.empty()) return;
            const std::string normalizedId = lower(id);
            if (seen.insert(normalizedId).second) ids.push_back(id);
        };

        if (st.contains("entities") && st["entities"].is_object()) {
            for (auto it = st["entities"].begin(); it != st["entities"].end(); ++it) {
                if (!it.value().is_object()) continue;
                const json* identityMemoryRow = findIdentityMemoryByEntityId(st, it.key());
                if (!entityMatchesFilter(it.key(), filter, &it.value(), identityMemoryRow)) continue;
                acceptId(it.key());
            }
        }
        if (st.contains("events") && st["events"].is_array()) {
            for (const auto& ev : st["events"]) {
                if (!ev.is_object()) continue;
                if (!eventMatchesFilter(st, ev, filter)) continue;
                acceptId(eventEntityToken(ev));
            }
        }
        if (ids.empty() && !trim(filter).empty()) ids.push_back(filter);
        return ids;
    };

    auto countEventsExact = [&](const std::string& eventName,
                                int windowSeconds,
                                const std::string& entityId,
                                const std::string& zoneFilter = std::string()) -> long long {
        if (isPresentEventName(eventName)) {
            if (windowSeconds > 0) {
                return countPresentEntitiesInState(st, nowIsoUtc, windowSeconds, entityId, zoneFilter);
            }
            return countDistinctEventEntities(st, eventName, nowIsoUtc, 0, entityId, zoneFilter);
        }
        long long n = 0;
        const std::string ev = lower(trim(eventName));
        const std::string targetEntity = trim(entityId);
        for (const auto& item : st["events"]) {
            if (!item.is_object()) continue;
            if (eventRepresentsSyntheticAbsence(st, item)) continue;
            if (!ev.empty() && lower(trim(strField(item, "event"))) != ev) continue;
            if (!targetEntity.empty() && !eventMatchesFilter(st, item, targetEntity)) continue;
            if (!zoneMatchesFilter(extractZoneField(item), zoneFilter)) continue;
            if (windowSeconds > 0 && ageSeconds(strField(item, "ts_utc"), nowIsoUtc) > windowSeconds) continue;
            ++n;
        }
        return n;
    };

    auto zoneMatches = [&](const std::string& rawZone, const std::string& rawExpectedZone) -> bool {
        return zoneMatchesFilter(rawZone, rawExpectedZone);
    };

    auto collectKnownMatchingEntityIds = [&](const std::string& filter) -> std::vector<std::string> {
        std::vector<std::string> ids;
        std::unordered_set<std::string> seen;
        auto acceptId = [&](const std::string& rawId) {
            const std::string id = trim(rawId);
            if (id.empty()) return;
            const std::string normalizedId = lower(id);
            if (!seen.insert(normalizedId).second) return;
            ids.push_back(id);
        };

        if (st.contains("entities") && st["entities"].is_object()) {
            for (auto it = st["entities"].begin(); it != st["entities"].end(); ++it) {
                if (!it.value().is_object()) continue;
                const json* identityMemoryRow = findIdentityMemoryByEntityId(st, it.key());
                if (!entityMatchesFilter(it.key(), filter, &it.value(), identityMemoryRow)) continue;
                acceptId(it.key());
            }
        }
        if (st.contains("events") && st["events"].is_array()) {
            for (const auto& ev : st["events"]) {
                if (!ev.is_object()) continue;
                if (!eventMatchesFilter(st, ev, filter)) continue;
                acceptId(eventEntityToken(ev));
            }
        }
        return ids;
    };

    auto isEntityPresentNow = [&](const std::string& entityId, const std::string& zoneFilter) -> bool {
        const std::string trimmedId = trim(entityId);
        if (trimmedId.empty() ||
            !st.contains("entities") ||
            !st["entities"].is_object() ||
            !st["entities"].contains(trimmedId) ||
            !st["entities"][trimmedId].is_object())
        {
            return false;
        }

        const json& entityState = st["entities"][trimmedId];
        bool explicitPresentNow = false;
        if (entityStateHasExplicitPresentFlag(entityState, explicitPresentNow) && !explicitPresentNow) {
            return false;
        }
        const std::string lastSeen = strField(entityState, "last_seen_ts");
        if (lastSeen.empty()) return false;
        if (ageSeconds(lastSeen, nowIsoUtc) > presenceRecencySeconds) return false;
        return zoneMatches(strField(entityState, "current_zone"), zoneFilter);
    };

    auto latestMatchingEventTsForEntity = [&](const std::string& rawEventName,
                                              const std::string& entityId,
                                              const std::string& zoneFilter) -> std::string {
        const std::string eventName = lower(trim(normalizeEventName(rawEventName)));
        const std::string targetEntity = trim(entityId);
        std::string latest;
        if (eventName.empty() || targetEntity.empty() ||
            !st.contains("events") || !st["events"].is_array())
        {
            return latest;
        }

        for (const auto& item : st["events"]) {
            if (!item.is_object()) continue;
            if (trim(strField(item, "entity_id")) != targetEntity) continue;
            if (lower(trim(strField(item, "event"))) != eventName) continue;
            if (!zoneMatches(extractZoneField(item), zoneFilter)) continue;
            const std::string ts = trim(strField(item, "ts_utc"));
            if (ts.empty()) continue;
            if (latest.empty() || ts > latest) latest = ts;
        }
        return latest;
    };

    auto latestMatchingSightingTs = [&](const std::string& filter,
                                        const std::string& zoneFilter) -> std::string {
        std::string latest;
        for (const auto& entityId : collectKnownMatchingEntityIds(filter)) {
            if (st.contains("entities") &&
                st["entities"].is_object() &&
                st["entities"].contains(entityId) &&
                st["entities"][entityId].is_object())
            {
                const json& entityState = st["entities"][entityId];
                const std::string lastSeen = trim(strField(entityState, "last_seen_ts"));
                if (!lastSeen.empty() && zoneMatches(strField(entityState, "current_zone"), zoneFilter)) {
                    if (latest.empty() || lastSeen > latest) latest = lastSeen;
                }
            }
        }

        if (st.contains("events") && st["events"].is_array()) {
            for (const auto& item : st["events"]) {
                if (!item.is_object()) continue;
                const std::string entityId = eventEntityToken(item);
                if (!eventMatchesFilter(st, item, filter)) continue;
                if (!zoneMatches(extractZoneField(item), zoneFilter)) continue;
                const std::string ts = trim(strField(item, "ts_utc"));
                if (ts.empty()) continue;
                if (latest.empty() || ts > latest) latest = ts;
            }
        }

        return latest;
    };

    auto makeContributionDoc = [&](const json& source,
                                   const std::string& fallbackEntityId = std::string(),
                                   const std::string& fallbackEvent = std::string()) -> json {
        if (!source.is_object()) return json();

        json out = json::object();
        const std::string eventName =
            trim(strField(source, "event", strField(source, "type", fallbackEvent)));
        const std::string entityId =
            trim(strField(source, "entity_id", fallbackEntityId));
        const std::string tsUtc =
            trim(strField(source, "ts_utc", strField(source, "last_evidence_ts_utc", strField(source, "last_seen_ts"))));
        const std::string zone = trim(strField(source, "zone", strField(source, "current_zone")));
        const std::string evidenceKey =
            trim(strField(source, "temporal_evidence_key", strField(source, "last_evidence_key")));
        const std::string frameOffset =
            trim(strField(source, "frame_timestamp_in_segment", strField(source, "last_frame_timestamp_in_segment")));
        const std::string timestampName =
            trim(strField(source, "timestamp_name", strField(source, "last_timestamp_name")));

        if (!eventName.empty()) out["event"] = eventName;
        if (!entityId.empty()) out["entity_id"] = entityId;
        if (!tsUtc.empty()) out["ts_utc"] = tsUtc;
        if (!zone.empty()) out["zone"] = zone;
        if (!evidenceKey.empty()) out["temporal_evidence_key"] = evidenceKey;
        if (!frameOffset.empty()) out["frame_timestamp_in_segment"] = frameOffset;
        if (!timestampName.empty()) out["timestamp_name"] = timestampName;

        if (source.contains("frame_index") && source["frame_index"].is_number_integer()) {
            out["frame_index"] = source["frame_index"].get<int>();
        } else if (source.contains("last_frame_index") && source["last_frame_index"].is_number_integer()) {
            out["frame_index"] = source["last_frame_index"].get<int>();
        }

        return out.empty() ? json() : out;
    };

    auto makeContributionIdentityKey = [&](const json& doc) -> std::string {
        if (!doc.is_object()) return "";
        if (doc.contains("temporal_evidence_key") && doc["temporal_evidence_key"].is_string()) {
            const std::string key = trim(doc["temporal_evidence_key"].get<std::string>());
            if (!key.empty()) return "key:" + key;
        }
        return lower(trim(strField(doc, "event"))) + "|" +
               lower(trim(strField(doc, "entity_id"))) + "|" +
               trim(strField(doc, "ts_utc")) + "|" +
               trim(strField(doc, "timestamp_name")) + "|" +
               trim(strField(doc, "frame_timestamp_in_segment"));
    };

    auto appendContributionDoc = [&](json& target,
                                     std::unordered_set<std::string>& seenKeys,
                                     const json& doc) {
        if (!doc.is_object() || doc.empty()) return;
        const std::string identityKey = makeContributionIdentityKey(doc);
        if (identityKey.empty()) return;
        if (!seenKeys.insert(identityKey).second) return;
        target.push_back(doc);
    };

    auto appendContributionDocs = [&](json& target,
                                      std::unordered_set<std::string>& seenKeys,
                                      const json& docs) {
        if (!docs.is_array()) return;
        for (const auto& doc : docs) {
            appendContributionDoc(target, seenKeys, doc);
        }
    };

    auto collectEventContributionDocs = [&](const std::string& eventName,
                                            int windowSeconds,
                                            const std::string& entityFilter,
                                            int maxItems,
                                            const std::string& zoneFilter,
                                            bool exactEntityIdMatch = false) -> json {
        json arr = json::array();
        if (!st.contains("events") || !st["events"].is_array()) return arr;

        const std::string normalizedEvent = lower(trim(normalizeEventName(eventName)));
        const std::string normalizedEntity = trim(entityFilter);

        for (auto it = st["events"].rbegin(); it != st["events"].rend(); ++it) {
            if (!it->is_object()) continue;
            if (eventRepresentsSyntheticAbsence(st, *it)) continue;
            if (!normalizedEvent.empty() &&
                lower(trim(strField(*it, "event"))) != normalizedEvent)
            {
                continue;
            }
            if (!normalizedEntity.empty()) {
                if (exactEntityIdMatch) {
                    if (trim(strField(*it, "entity_id")) != normalizedEntity) continue;
                } else if (!eventMatchesFilter(st, *it, normalizedEntity)) {
                    continue;
                }
            }
            if (!zoneMatchesFilter(extractZoneField(*it), zoneFilter)) continue;
            if (windowSeconds > 0 && ageSeconds(strField(*it, "ts_utc"), nowIsoUtc) > windowSeconds) continue;

            const json doc = makeContributionDoc(*it, normalizedEntity, eventName);
            if (!doc.is_object() || doc.empty()) continue;
            arr.push_back(doc);
            if (maxItems > 0 && static_cast<int>(arr.size()) >= maxItems) break;
        }

        std::reverse(arr.begin(), arr.end());
        return arr;
    };

    auto buildEntityStateContributionDoc = [&](const std::string& entityId,
                                               const std::string& fallbackEvent) -> json {
        const std::string normalizedEntityId = trim(entityId);
        if (normalizedEntityId.empty() ||
            !st.contains("entities") ||
            !st["entities"].is_object() ||
            !st["entities"].contains(normalizedEntityId) ||
            !st["entities"][normalizedEntityId].is_object())
        {
            return json();
        }

        return makeContributionDoc(st["entities"][normalizedEntityId], normalizedEntityId, fallbackEvent);
    };

    for (const auto& op : plan["operators"]) {
        if (!op.is_object()) continue;
        const std::string opId = strField(op, "operator_id");
        const std::string typ = lower(trim(strField(op, "type")));
        const json p = op.value("params", json::object());
        const bool canDriveLocalAlert =
            typ != "schedule_at_time" &&
            typ != "summary_window" &&
            typ != "cross_camera_track_after_trigger";
        bool v = false;
        bool unk = false;
        json result = {
            { "operator_id", opId },
            { "type", typ },
            { "value", "false" }
        };
        if (typ == "entity_present") {
            const std::string ent = strField(p, "entity");
            const std::string zone = extractZoneField(p);
            const int minDurationSeconds = std::max(0, intField(p, "min_duration_seconds", 0));
            result["entity_filter"] = ent;
            if (!trim(zone).empty()) result["zone"] = zone;
            if (minDurationSeconds > 0) result["min_duration_seconds"] = minDurationSeconds;

            json entities = json::array();
            json contributingEvents = json::array();
            std::unordered_set<std::string> seenContributionKeys;
            for (const auto& entityId : collectKnownMatchingEntityIds(ent)) {
                json entityDoc = {
                    { "entity_id", entityId },
                    { "present_now", false },
                    { "qualifies", false }
                };
                if (!(st.contains("entities") &&
                      st["entities"].is_object() &&
                      st["entities"].contains(entityId) &&
                      st["entities"][entityId].is_object()))
                {
                    entities.push_back(std::move(entityDoc));
                    continue;
                }

                const json& entityState = st["entities"][entityId];
                const bool presentNow = isEntityPresentNow(entityId, zone);
                const std::string lastSeen = strField(entityState, "last_seen_ts");
                const std::string presentSince = strField(
                    entityState,
                    "present_since_ts",
                    strField(entityState, "last_seen_ts"));
                const long long presenceDurationSeconds =
                    (presentNow && !presentSince.empty())
                        ? std::max(0LL, ageSeconds(presentSince, nowIsoUtc))
                        : 0LL;
                const bool qualifies =
                    presentNow &&
                    (minDurationSeconds <= 0 || presenceDurationSeconds >= minDurationSeconds);

                entityDoc["present_now"] = presentNow;
                entityDoc["qualifies"] = qualifies;
                if (!lastSeen.empty()) entityDoc["last_seen_ts"] = lastSeen;
                if (!presentSince.empty()) entityDoc["present_since_ts"] = presentSince;
                if (entityState.contains("current_zone") && entityState["current_zone"].is_string()) {
                    entityDoc["current_zone"] = entityState["current_zone"];
                }
                entityDoc["presence_duration_seconds"] = presenceDurationSeconds;
                entities.push_back(std::move(entityDoc));

                if (qualifies) {
                    v = true;
                    appendContributionDoc(
                        contributingEvents,
                        seenContributionKeys,
                        buildEntityStateContributionDoc(entityId, "present"));
                    if (summaryParts.empty() || summaryParts.back().find(entityId) == std::string::npos) {
                        summaryParts.push_back(
                            entityId + " is present" +
                            (minDurationSeconds > 0
                                ? " for at least " + std::to_string(minDurationSeconds) + "s"
                                : std::string()));
                    }
                }
            }
            result["entities"] = std::move(entities);
            if (!contributingEvents.empty()) {
                result["contributing_events"] = std::move(contributingEvents);
            }
        } else if (typ == "entity_absent") {
            const std::string ent = strField(p, "entity");
            const std::string zone = extractZoneField(p);
            const int durationSeconds = intField(p, "duration_seconds", 0);
            result["entity_filter"] = ent;
            result["duration_seconds"] = durationSeconds;
            if (!trim(zone).empty()) result["zone"] = zone;

            if (durationSeconds <= 0) {
                unk = true;
            } else {
                const std::vector<std::string> matchingIds = collectKnownMatchingEntityIds(ent);
                json entities = json::array();
                json contributingEvents = json::array();
                std::unordered_set<std::string> seenContributionKeys;
                bool anyPresentNow = false;
                for (const auto& entityId : matchingIds) {
                    const bool presentNow = isEntityPresentNow(entityId, zone);
                    anyPresentNow = anyPresentNow || presentNow;
                    const std::string latestSeen = latestMatchingSightingTs(entityId, zone);
                    json entityDoc = {
                        { "entity_id", entityId },
                        { "present_now", presentNow }
                    };
                    if (!latestSeen.empty()) {
                        entityDoc["latest_seen_ts"] = latestSeen;
                        entityDoc["seconds_since_last_seen"] = std::max(0LL, ageSeconds(latestSeen, nowIsoUtc));
                        appendContributionDocs(
                            contributingEvents,
                            seenContributionKeys,
                            collectEventContributionDocs(
                                std::string(),
                                0,
                                entityId,
                                1,
                                zone,
                                true));
                        appendContributionDoc(
                            contributingEvents,
                            seenContributionKeys,
                            buildEntityStateContributionDoc(entityId, "present"));
                    }
                    entities.push_back(std::move(entityDoc));
                }
                result["entities"] = std::move(entities);
                result["present_now"] = anyPresentNow;

                if (!anyPresentNow) {
                    const std::string latestSeen = latestMatchingSightingTs(ent, zone);
                    if (!latestSeen.empty()) {
                        const long long secondsSinceLastSeen =
                            std::max(0LL, ageSeconds(latestSeen, nowIsoUtc));
                        result["latest_seen_ts"] = latestSeen;
                        result["seconds_since_last_seen"] = secondsSinceLastSeen;
                        v = secondsSinceLastSeen >= durationSeconds;
                        if (v) {
                            summaryParts.push_back(
                                "No matching " +
                                (trim(ent).empty() ? std::string("entity") : trim(ent)) +
                                " seen for " + std::to_string(durationSeconds) + "s"
                            );
                            if (!contributingEvents.empty()) {
                                result["contributing_events"] = std::move(contributingEvents);
                            }
                        }
                    }
                }
            }
        } else if (typ == "stopped_for_more_than_without_event") {
            const std::string ent = strField(p, "entity");
            const std::string zone = extractZoneField(p);
            const std::string withoutEvent = strField(p, "without_event");
            const int seconds = intField(p, "seconds", 0);
            result["entity_filter"] = ent;
            result["without_event"] = withoutEvent;
            result["seconds"] = seconds;
            if (!trim(zone).empty()) result["zone"] = zone;

            if (seconds <= 0 || trim(withoutEvent).empty()) {
                unk = true;
            } else {
                json entities = json::array();
                json contributingEvents = json::array();
                std::unordered_set<std::string> seenContributionKeys;
                for (const auto& entityId : collectKnownMatchingEntityIds(ent)) {
                    const bool presentNow = isEntityPresentNow(entityId, zone);
                    const std::string stoppedTs = latestMatchingEventTsForEntity("stopped", entityId, zone);
                    const std::string releaseTs = latestMatchingEventTsForEntity(withoutEvent, entityId, zone);
                    const bool releasedAfterStop =
                        !stoppedTs.empty() && !releaseTs.empty() && releaseTs >= stoppedTs;
                    const long long stoppedDurationSeconds =
                        stoppedTs.empty()
                            ? -1LL
                            : std::max(0LL, ageSeconds(stoppedTs, nowIsoUtc));
                    const bool qualifies =
                        presentNow &&
                        !stoppedTs.empty() &&
                        !releasedAfterStop &&
                        stoppedDurationSeconds >= seconds;

                    json entityDoc = {
                        { "entity_id", entityId },
                        { "present_now", presentNow },
                        { "qualifies", qualifies },
                        { "released_after_stop", releasedAfterStop }
                    };
                    if (!stoppedTs.empty()) {
                        entityDoc["stopped_ts"] = stoppedTs;
                        entityDoc["stopped_duration_seconds"] = stoppedDurationSeconds;
                    }
                    if (!releaseTs.empty()) entityDoc["without_event_ts"] = releaseTs;
                    entities.push_back(std::move(entityDoc));

                    if (qualifies) {
                        v = true;
                        appendContributionDocs(
                            contributingEvents,
                            seenContributionKeys,
                            collectEventContributionDocs(
                                "stopped",
                                0,
                                entityId,
                                1,
                                zone,
                                true));
                        summaryParts.push_back(
                            entityId + " remained stopped for " + std::to_string(seconds) +
                            "s without " + withoutEvent
                        );
                    }
                }
                result["entities"] = std::move(entities);
                if (!contributingEvents.empty()) {
                    result["contributing_events"] = std::move(contributingEvents);
                }
            }
        } else if (typ == "seen_n_times_in_window_by_entity") {
            const int n = intField(p, "n", 0);
            const int w = intField(p, "window_seconds", 0);
            const std::string eventName = strField(p, "event");
            const std::string ent = strField(p, "entity");
            const std::string zone = extractZoneField(p);
            const std::string triggerMode = lower(trim(strField(
                p,
                "trigger_mode",
                (n <= 1) ? std::string("event_observed") : std::string("threshold_cross"))));
            result["event"] = eventName;
            result["entity_filter"] = ent;
            result["threshold"] = n;
            result["window_seconds"] = w;
            result["trigger_mode"] = triggerMode;
            if (!trim(zone).empty()) result["zone"] = zone;
            if (n <= 0 || trim(eventName).empty()) {
                unk = true;
            }
            else {
                json entityCounts = json::array();
                json contributingEvents = json::array();
                std::unordered_set<std::string> seenContributionKeys;
                for (const auto& entityId : collectMatchingEntityIds(ent)) {
                    const long long currentCount = countEventsExact(eventName, w, entityId, zone);
                    const std::string stateKey =
                        (opId.empty() ? typ : opId) + "|" +
                        lower(trim(normalizeEventName(eventName))) + "|" +
                        lower(trim(zone)) + "|" +
                        entityId;
                    json& opState = operatorState[stateKey];
                    if (!opState.is_object()) opState = json::object();
                    const long long previousCount = opState.value("last_count", 0LL);
                    const bool crossedThreshold = previousCount < n && currentCount >= n;
                    const bool observedNewEvent = currentCount > previousCount && currentCount >= n;
                    const bool triggered =
                        (triggerMode == "event_observed") ? observedNewEvent : crossedThreshold;
                    entityCounts.push_back({
                        { "entity_id", entityId },
                        { "previous_count", previousCount },
                        { "current_count", currentCount },
                        { "delta_count", currentCount - previousCount },
                        { "crossed_threshold", crossedThreshold },
                        { "event_observed", observedNewEvent }
                    });
                    opState["last_count"] = currentCount;
                    opState["last_evaluated_ts_utc"] = nowIsoUtc;
                    if (triggered) {
                        v = true;
                        appendContributionDocs(
                            contributingEvents,
                            seenContributionKeys,
                            collectEventContributionDocs(
                                eventName,
                                w,
                                entityId,
                                (std::max)(1, n),
                                zone,
                                true));
                        if (triggerMode == "event_observed") {
                            summaryParts.push_back(
                                entityId + " observed new " + eventName +
                                " (previous=" + std::to_string(previousCount) +
                                ", current=" + std::to_string(currentCount) + ")"
                            );
                        } else {
                            summaryParts.push_back(
                                entityId + " crossed " + eventName +
                                " threshold " + std::to_string(n) +
                                " (previous=" + std::to_string(previousCount) +
                                ", current=" + std::to_string(currentCount) + ")"
                            );
                        }
                    }
                }
                result["entities"] = std::move(entityCounts);
                if (!contributingEvents.empty()) {
                    result["contributing_events"] = std::move(contributingEvents);
                }
            }
        } else if (typ == "count_events_in_window") {
            const int thr = intField(p, "threshold", 1);
            const int w = intField(p, "window_seconds", 0);
            const std::string eventName = strField(p, "event");
            const std::string ent = strField(p, "entity");
            const std::string zone = extractZoneField(p);
            result["event"] = eventName;
            result["entity_filter"] = ent;
            result["threshold"] = thr;
            result["window_seconds"] = w;
            if (!trim(zone).empty()) result["zone"] = zone;
            if (w <= 0 || trim(eventName).empty()) unk = true;
            else {
                const long long currentCount = countEvents(st, eventName, nowIsoUtc, w, ent, zone);
                json contributingEvents = json::array();
                std::unordered_set<std::string> seenContributionKeys;
                result["current_count"] = currentCount;
                if (isPresentEventName(eventName)) {
                    const std::string stateKey =
                        (opId.empty() ? typ : opId) + "|" +
                        lower(trim(normalizeEventName(eventName))) + "|" +
                        lower(trim(ent)) + "|" +
                        lower(trim(zone));
                    json& opState = operatorState[stateKey];
                    if (!opState.is_object()) opState = json::object();
                    const long long previousCount = opState.value("last_count", 0LL);
                    const bool crossedThreshold = previousCount < thr && currentCount >= thr;
                    result["previous_count"] = previousCount;
                    result["delta_count"] = currentCount - previousCount;
                    result["crossed_threshold"] = crossedThreshold;
                    result["trigger_mode"] = "edge";
                    opState["last_count"] = currentCount;
                    opState["last_evaluated_ts_utc"] = nowIsoUtc;
                    v = crossedThreshold;
                    if (crossedThreshold) {
                        for (const auto& entityId : collectKnownMatchingEntityIds(ent)) {
                            if (!isEntityPresentNow(entityId, zone)) continue;
                            appendContributionDoc(
                                contributingEvents,
                                seenContributionKeys,
                                buildEntityStateContributionDoc(entityId, "present"));
                            if (static_cast<int>(contributingEvents.size()) >= (std::max)(1, thr)) break;
                        }
                        summaryParts.push_back(
                            eventName + " reached " + std::to_string(currentCount) +
                            " within " + std::to_string(w) + "s"
                        );
                        if (!contributingEvents.empty()) {
                            result["contributing_events"] = std::move(contributingEvents);
                        }
                    }
                } else {
                    v = currentCount >= thr;
                    if (v) {
                        appendContributionDocs(
                            contributingEvents,
                            seenContributionKeys,
                            collectEventContributionDocs(
                                eventName,
                                w,
                                ent,
                                (std::max)(1, thr),
                                zone,
                                false));
                        summaryParts.push_back(
                            eventName + " reached " + std::to_string(currentCount) +
                            " within " + std::to_string(w) + "s"
                        );
                        if (!contributingEvents.empty()) {
                            result["contributing_events"] = std::move(contributingEvents);
                        }
                    }
                }
            }
        } else if (typ == "no_event_for_duration") {
            const int d = intField(p, "duration_seconds", 0);
            const std::string eventName = strField(p, "event");
            const std::string ent = strField(p, "entity");
            const std::string zone = extractZoneField(p);
            result["event"] = eventName;
            result["entity_filter"] = ent;
            result["duration_seconds"] = d;
            if (!trim(zone).empty()) result["zone"] = zone;
            if (d <= 0 || trim(eventName).empty()) unk = true;
            else {
                const long long currentCount = countEvents(st, eventName, nowIsoUtc, d, ent, zone);
                result["current_count"] = currentCount;
                v = currentCount == 0;
                if (v) {
                    json contributingEvents = collectEventContributionDocs(
                        eventName,
                        0,
                        ent,
                        1,
                        zone,
                        false);
                    if (!contributingEvents.empty()) {
                        result["contributing_events"] = std::move(contributingEvents);
                    }
                    summaryParts.push_back(
                        "No confirmed " + eventName + " for " + std::to_string(d) + "s"
                    );
                }
            }
        } else if (typ == "schedule_at_time" || typ == "summary_window") {
            v = true;
            r.report = true;
            summaryParts.push_back(opId.empty() ? typ : opId);
        } else if (typ == "cross_camera_track_after_trigger") {
            result["scope"] = strField(p, "scope", "job_step");
            result["trigger_mode"] = strField(p, "trigger_mode", "alert_condition_true");
            result["watch_ttl_seconds"] = intField(p, "watch_ttl_seconds", 900);
            if (p.contains("share_entity_types") && p["share_entity_types"].is_array()) {
                result["share_entity_types"] = p["share_entity_types"];
            }
        } else {
            unk = true;
        }
        if (!unk && canDriveLocalAlert) r.hasActionableAlertOperator = true;
        if (unk) r.hasUnknownOperatorResults = true;
        result["value"] = unk ? "unknown" : (v ? "true" : "false");
        if (v && typ == "seen_n_times_in_window_by_entity" && !result.contains("trigger_mode")) {
            result["trigger_mode"] = "edge";
        }
        r.operatorResults.push_back(std::move(result));
        if (!unk && v && typ != "schedule_at_time" && typ != "summary_window") r.alert = true;
    }
    const std::string mode = lower(trim(strField(policy, "mode", "alert")));
    if (mode == "report") r.alert = false;
    if (mode == "alert") r.report = false;
    const std::string lastAlert = strField(st["meta"], "last_alert_ts_utc");
    if (r.alert && !lastAlert.empty() && cooldown > 0) {
        if (ageSeconds(lastAlert, nowIsoUtc) < cooldown) r.alert = false;
    }
    if (r.alert) st["meta"]["last_alert_ts_utc"] = nowIsoUtc;
    if (r.report) st["meta"]["last_report_ts_utc"] = nowIsoUtc;
    if (!summaryParts.empty()) {
        std::ostringstream oss;
        for (std::size_t i = 0; i < summaryParts.size(); ++i) {
            if (i > 0) oss << "; ";
            oss << summaryParts[i];
        }
        r.summary = oss.str();
    }
    return r;
}

inline void extractOutputTemporalFields(const json& modelObject, json& identityPatch, json& observations, json& unknownReasons, bool& hasTemporal) {
    hasTemporal = false;
    identityPatch = json::array();
    observations = json::array();
    unknownReasons = json::array();
    if (!modelObject.is_object()) return;
    if (modelObject.contains("identity_patch") && modelObject["identity_patch"].is_array()) {
        identityPatch = modelObject["identity_patch"];
        hasTemporal = true;
    }
    if (modelObject.contains("observations") && modelObject["observations"].is_array()) {
        observations = modelObject["observations"];
        hasTemporal = true;
    }
    if (modelObject.contains("unknown_reasons") && modelObject["unknown_reasons"].is_array()) {
        unknownReasons = modelObject["unknown_reasons"];
        hasTemporal = true;
    }
}

} // namespace temporal

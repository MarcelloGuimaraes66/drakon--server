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
inline std::string canonicalZoneKey(const std::string& rawZone);
inline json effectivePlan(const json& envelope);
inline bool validateCompilerDecisionConsistency(const json& envelope, std::string* outReason = nullptr);
inline json parseTraitsValue(const json& value);
inline void appendUniqueStringsToArray(json& target, const json& value);
inline std::string normalizeEventName(const std::string& rawEvent);
inline std::string strField(const json& n, const char* key, const std::string& fallback);
inline int intField(const json& n, const char* key, int fallback);
inline bool parseClockTimeSeconds(const std::string& raw, int& outSeconds);
inline bool parseUtcOffsetSeconds(const std::string& raw, int& outSeconds);
inline std::string formatUtcOffsetSeconds(int offsetSeconds);
inline bool normalizeClockTimeString(const std::string& raw, std::string& outTime);
inline bool normalizeLocalDateString(const std::string& raw, std::string& outDate);
inline bool splitAndNormalizeLocalDateTime(
    const std::string& raw,
    std::string& outDate,
    std::string& outTime);
inline std::string canonicalFixedLocalTimezone(const std::string& raw);

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

inline std::string upper(std::string s) {
    for (char& c : s) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    return s;
}

inline std::string canonicalZoneKey(const std::string& rawZone) {
    const std::string input = trim(rawZone);
    if (input.empty()) return std::string();

    std::string out;
    out.reserve(input.size());
    bool previousSeparator = false;
    for (unsigned char ch : input) {
        if (std::isalnum(ch)) {
            out.push_back(static_cast<char>(std::tolower(ch)));
            previousSeparator = false;
        }
        else if (!out.empty() && !previousSeparator) {
            out.push_back('_');
            previousSeparator = true;
        }
    }
    while (!out.empty() && out.back() == '_') out.pop_back();
    return out;
}

inline void appendZoneAliasCandidate(
    json& aliases,
    std::unordered_set<std::string>& seen,
    const std::string& rawValue)
{
    const std::string trimmedValue = trim(rawValue);
    if (trimmedValue.empty()) return;

    if (seen.insert(trimmedValue).second) {
        aliases.push_back(trimmedValue);
    }

    const std::string loweredValue = lower(trimmedValue);
    if (!loweredValue.empty() && seen.insert(loweredValue).second) {
        aliases.push_back(loweredValue);
    }

    const std::string canonicalValue = canonicalZoneKey(trimmedValue);
    if (!canonicalValue.empty() && seen.insert(canonicalValue).second) {
        aliases.push_back(canonicalValue);
    }
}

inline json normalizeZoneCatalog(const json& envelope) {
    json rawCatalog = json::array();
    if (envelope.is_object() &&
        envelope.contains("zone_catalog") &&
        envelope["zone_catalog"].is_array())
    {
        rawCatalog = envelope["zone_catalog"];
    }
    else {
        const json plan = effectivePlan(envelope);
        if (plan.is_object() &&
            plan.contains("zone_catalog") &&
            plan["zone_catalog"].is_array())
        {
            rawCatalog = plan["zone_catalog"];
        }
    }

    json out = json::array();
    if (!rawCatalog.is_array()) return out;

    std::unordered_set<std::string> seenCanonicalKeys;
    for (const auto& item : rawCatalog) {
        if (!item.is_object()) continue;

        const std::string regionId =
            trim(strField(item, "region_id", strField(item, "regionId", std::string())));
        const std::string label =
            trim(strField(
                item,
                "label",
                strField(item, "region_label", strField(item, "regionLabel", std::string()))));
        std::string canonical =
            canonicalZoneKey(strField(
                item,
                "canonical_zone_key",
                strField(item, "canonicalZoneKey", label.empty() ? regionId : label)));
        if (canonical.empty()) canonical = canonicalZoneKey(regionId);
        if (canonical.empty()) continue;
        if (!seenCanonicalKeys.insert(canonical).second) continue;

        json aliases = json::array();
        std::unordered_set<std::string> seenAliases;
        appendZoneAliasCandidate(aliases, seenAliases, canonical);
        appendZoneAliasCandidate(aliases, seenAliases, regionId);
        appendZoneAliasCandidate(aliases, seenAliases, label);
        if (item.contains("aliases") && item["aliases"].is_array()) {
            for (const auto& alias : item["aliases"]) {
                if (!alias.is_string()) continue;
                appendZoneAliasCandidate(aliases, seenAliases, alias.get<std::string>());
            }
        }

        json row = {
            { "canonical_zone_key", canonical }
        };
        if (!regionId.empty()) row["region_id"] = regionId;
        if (!label.empty()) row["label"] = label;
        if (!aliases.empty()) row["aliases"] = aliases;
        out.push_back(std::move(row));
    }
    return out;
}

inline bool replaceWholeToken(std::string& text,
                              const std::string& token,
                              const std::string& replacement) {
    if (text.empty() || token.empty()) return false;

    bool replaced = false;
    std::size_t pos = 0;
    while ((pos = text.find(token, pos)) != std::string::npos) {
        const bool leftBoundary =
            pos == 0 ||
            !std::isalnum(static_cast<unsigned char>(text[pos - 1]));
        const std::size_t rightIndex = pos + token.size();
        const bool rightBoundary =
            rightIndex >= text.size() ||
            !std::isalnum(static_cast<unsigned char>(text[rightIndex]));
        if (!leftBoundary || !rightBoundary) {
            pos += token.size();
            continue;
        }
        text.replace(pos, token.size(), replacement);
        pos += replacement.size();
        replaced = true;
    }
    return replaced;
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

inline bool traitLooksLikePersonIdentityCue(const std::string& rawTrait);
inline bool traitLooksLikeVehicleIdentityCue(const std::string& rawTrait);
inline bool traitLooksLikeIdentityCueForEntityType(
    const std::string& rawEntityType,
    const std::string& rawTrait);

inline bool traitLooksLikePoseOrActivityContext(const std::string& rawTrait) {
    const std::string s = lower(trim(rawTrait));
    if (s.empty()) return false;
    if (containsAnySubstring(
            s,
            {
                "sitting", "seated", "standing", "walking", "running", "typing",
                "working", "using ", "holding ", "carrying ", "looking ",
                "gazing", "facing ", "turned ", "in front of", "next to",
                "beside", "near ", "at desk", "at table", "on computer",
                "with keyboard", "with laptop", "with monitor",
                "sentado", "sentada", "em pe", "em pé", "andando",
                "correndo", "digitando", "usando ", "segurando ",
                "carregando ", "olhando ", "virado", "virada",
                "em frente", "frente a", "ao lado", "perto de",
                "no computador", "no notebook", "no teclado",
                "na mesa", "na cadeira"
            }))
    {
        return true;
    }
    const std::vector<std::string> tokens = extractWordTokens(s);
    return tokenListContainsAny(
        tokens,
        {
            "sitting", "seated", "standing", "walking", "running", "typing",
            "working", "holding", "carrying", "looking", "gazing", "facing",
            "turned", "sentado", "sentada", "andando", "correndo",
            "digitando", "usando", "segurando", "carregando", "olhando",
            "virado", "virada", "computador", "notebook", "teclado",
            "mesa", "cadeira"
        });
}

inline bool traitLooksLikePersonIntrinsicPhysicalCue(const std::string& rawTrait) {
    const std::string s = lower(trim(rawTrait));
    if (s.empty()) return false;
    if (containsAnySubstring(
            s,
            {
                "skin tone", "light skin", "dark skin", "fair skin", "brown skin",
                "pele", "tom de pele", "cabelo", "hair", "beard", "mustache",
                "moustache", "barba", "bigode", "tattoo", "tatuagem",
                "scar", "cicatriz", "bald", "careca", "calvo",
                "body build", "build", "body type", "porte fisico", "porte físico",
                "slim", "thin", "heavyset", "stocky", "magro", "gordo",
                "coily hair", "curly hair", "wavy hair", "straight hair",
                "cacheado", "ondulado", "crespo", "liso",
                "short hair", "long hair", "cabelo curto", "cabelo longo",
                "stubble", "facial hair", "por fazer", "barba curta",
                "barba baixa", "short beard", "light beard",
                "jawline", "nose", "eyebrow", "sobrancelha", "nariz"
            }))
    {
        return true;
    }
    const std::vector<std::string> tokens = extractWordTokens(s);
    return tokenListContainsAny(
        tokens,
        {
            "pele", "skin", "cabelo", "hair", "beard", "mustache",
            "moustache", "barba", "bigode", "tattoo", "tatuagem",
            "scar", "cicatriz", "bald", "careca", "calvo",
            "build", "slim", "thin", "heavyset", "stocky", "magro",
            "gordo", "cacheado", "ondulado", "crespo", "liso",
            "stubble", "nose", "eyebrow", "sobrancelha", "nariz"
        });
}

inline bool traitLooksLikePersonSecondaryAttachedIdentityCue(const std::string& rawTrait) {
    const std::string s = lower(trim(rawTrait));
    if (s.empty()) return false;
    if (containsAnySubstring(
            s,
            {
                "hat", "cap", "beanie", "helmet", "glasses", "goggles",
                "mask", "bracelet", "watch", "necklace", "ring", "earring",
                "bone", "chapeu", "chapéu", "oculos", "óculos",
                "brinco", "pulseira", "colar", "anel"
            }))
    {
        return true;
    }
    const std::vector<std::string> tokens = extractWordTokens(s);
    return tokenListContainsAny(
        tokens,
        {
            "hat", "cap", "beanie", "helmet", "glasses", "goggles",
            "mask", "bracelet", "watch", "necklace", "ring", "earring",
            "bone", "chapeu", "oculos", "brinco", "pulseira",
            "colar", "anel"
        });
}

inline bool traitLooksLikePersonDiscardableIdentityCue(const std::string& rawTrait) {
    const std::string s = lower(trim(rawTrait));
    if (s.empty()) return false;
    if (containsAnySubstring(
            s,
            {
                "wearing ", "holding ", "carrying ", "shirt", "t-shirt", "tshirt",
                "camisa", "camiseta", "blouse", "jacket", "hoodie", "coat",
                "pants", "jeans", "shorts", "bermuda", "dress", "skirt",
                "shoe", "sneaker", "boot", "backpack", "shoulder bag",
                "purse", "bag", "weapon", "gun", "pistol", "rifle", "knife",
                "machete", "firearm", "roupa", "mochila", "bolsa", "arma",
                "calcado", "calçado", "tenis", "tênis", "jaqueta"
            }))
    {
        return true;
    }
    const std::vector<std::string> tokens = extractWordTokens(s);
    return tokenListContainsAny(
        tokens,
        {
            "shirt", "camisa", "camiseta", "blouse", "jacket", "hoodie",
            "coat", "pants", "jeans", "shorts", "bermuda", "dress",
            "skirt", "shoe", "sneaker", "boot", "backpack", "bag",
            "purse", "weapon", "gun", "pistol", "rifle", "knife",
            "machete", "firearm", "roupa", "mochila", "bolsa", "arma",
            "tenis", "calcado"
        });
}

inline int classifyIdentityTraitPriority(
    const std::string& rawEntityType,
    const std::string& rawTrait)
{
    const std::string trait = trim(rawTrait);
    if (trait.empty()) return 0;
    if (traitLooksLikeSceneOrBackgroundContext(trait) ||
        traitLooksLikePoseOrActivityContext(trait))
    {
        return 0;
    }

    if (entityTypeSuggestsVehicleIdentity(rawEntityType)) {
        return traitLooksLikeVehicleIdentityCue(trait) ? 3 : 0;
    }

    if (entityTypeSuggestsPersonIdentity(rawEntityType)) {
        if (traitLooksLikePersonDiscardableIdentityCue(trait)) return 0;
        if (traitLooksLikePersonIntrinsicPhysicalCue(trait)) return 3;
        if (traitLooksLikePersonSecondaryAttachedIdentityCue(trait)) return 2;
        if (traitLooksLikePersonIdentityCue(trait)) return 1;
        return 0;
    }

    return traitLooksLikeIdentityCueForEntityType(rawEntityType, trait) ? 2 : 0;
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
    auto appendMatchingTraitsByPriority = [&](const json& source, int minPriority) {
        const json parsed = parseTraitsValue(source);
        if (!parsed.is_array()) return;
        for (const auto& item : parsed) {
            if (!item.is_string()) continue;
            const std::string trait = trim(item.get<std::string>());
            if (trait.empty()) continue;
            const int priority = classifyIdentityTraitPriority(rawEntityType, trait);
            if (priority >= minPriority) {
                appendUniqueStringsToArray(curated, trait);
            }
        }
    };

    for (int priority = 3; priority >= 2; --priority) {
        appendMatchingTraitsByPriority(existingTraits, priority);
        appendMatchingTraitsByPriority(stableTraits, priority);
        appendMatchingTraitsByPriority(contextTraits, priority);
    }
    if (curated.size() < 2) {
        appendMatchingTraitsByPriority(existingTraits, 1);
        appendMatchingTraitsByPriority(stableTraits, 1);
        appendMatchingTraitsByPriority(contextTraits, 1);
    }
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

    auto appendContextTraits = [&](const json& source) {
        const json parsed = parseTraitsValue(source);
        if (!parsed.is_array()) return;
        for (const auto& item : parsed) {
            if (!item.is_string()) continue;
            const std::string trait = trim(item.get<std::string>());
            if (trait.empty()) continue;
            const bool sceneLike = traitLooksLikeSceneOrBackgroundContext(trait);
            const bool transientLike = traitLooksLikeTransientIdentityContext(trait);
            const bool poseLike = traitLooksLikePoseOrActivityContext(trait);
            if (!sceneLike && !poseLike && transientLike) {
                appendUniqueStringsToArray(curated, trait);
            }
        }
    };

    appendContextTraits(existingTraits);
    appendContextTraits(contextTraits);
    if (curated.empty()) appendContextTraits(stableTraits);
    if (curated.size() > 4) {
        curated.erase(curated.begin() + 4, curated.end());
    }
    return curated;
}

inline std::string buildIdentityDescriptionFromTraits(
    const json& traits,
    std::size_t maxItems = 4)
{
    const json parsed = parseTraitsValue(traits);
    if (!parsed.is_array() || parsed.empty()) return std::string();
    std::ostringstream oss;
    std::size_t emitted = 0;
    for (const auto& item : parsed) {
        if (!item.is_string()) continue;
        const std::string trait = trim(item.get<std::string>());
        if (trait.empty()) continue;
        if (emitted > 0) oss << "; ";
        oss << trait;
        ++emitted;
        if (emitted >= maxItems) break;
    }
    return emitted == 0 ? std::string() : oss.str();
}

inline std::string curateIdentityDescription(
    const std::string& rawEntityType,
    const std::string& rawDescription,
    const json& signatureTraits)
{
    (void)rawEntityType;
    const std::string curatedFromTraits = buildIdentityDescriptionFromTraits(signatureTraits);
    if (!curatedFromTraits.empty()) {
        return curatedFromTraits;
    }

    const std::string description = trim(rawDescription);
    if (description.empty()) return std::string();
    if (traitLooksLikeSceneOrBackgroundContext(description) ||
        traitLooksLikePoseOrActivityContext(description))
    {
        return std::string();
    }
    return description;
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
        "analyze_events_at_interval",
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

inline std::string normalizeAnalyzeIntervalScheduleModeToken(const std::string& rawMode) {
    const std::string mode = lower(trim(rawMode));
    if (mode == "one_shot" || mode == "single" || mode == "single_shot" || mode == "once_only") {
        return "once";
    }
    if (mode == "repeat" || mode == "repeating" || mode == "periodic" ||
        mode == "every_interval" || mode == "recurring_interval")
    {
        return "recurring";
    }
    return mode;
}

inline std::string normalizeAnalyzeIntervalAnchorModeToken(const std::string& rawMode) {
    const std::string mode = lower(trim(rawMode));
    if (mode == "start" || mode == "start_of_monitoring" || mode == "monitoring_begin" ||
        mode == "from_start" || mode == "window_start" || mode == "start_of_window" ||
        mode == "window_begin" || mode == "monitoring_window_start")
    {
        return "monitoring_start";
    }
    if (mode == "first_event" || mode == "first_match" ||
        mode == "first_matching_observation" || mode == "first_observed_event" ||
        mode == "on_first_match" || mode == "first_seen_event")
    {
        return "first_matching_event";
    }
    if (mode == "fixed_time" || mode == "fixed_local_time" ||
        mode == "fixed_clock_time" || mode == "scheduled_local_time" ||
        mode == "daily_local_time")
    {
        return "fixed_time_local";
    }
    return mode;
}

inline std::string normalizeAnalyzeIntervalCatchUpModeToken(const std::string& rawMode) {
    const std::string mode = lower(trim(rawMode));
    if (mode == "latest" || mode == "latest_only" || mode == "latest_due" ||
        mode == "latest_checkpoint_only" || mode == "most_recent_due_only")
    {
        return "latest_due_only";
    }
    if (mode == "all_due" || mode == "emit_every_due" ||
        mode == "emit_all_checkpoints" || mode == "process_all_due")
    {
        return "emit_all_due";
    }
    return mode;
}

inline std::string normalizeAnalyzeIntervalKindToken(const std::string& rawKind) {
    return lower(trim(rawKind));
}

inline std::string normalizeAnalyzeIntervalWindowModeToken(const std::string& rawMode) {
    return lower(trim(rawMode));
}

inline std::string normalizeAnalyzeIntervalDecisionModeToken(const std::string& rawMode) {
    return lower(trim(rawMode));
}

inline std::string normalizeAnalyzeIntervalDecisionOpToken(const std::string& rawOp) {
    return lower(trim(rawOp));
}

inline bool isAllowedAnalyzeIntervalScheduleMode(const std::string& rawMode) {
    static const std::unordered_set<std::string> kAllowed = {
        "once",
        "recurring"
    };
    return kAllowed.find(normalizeAnalyzeIntervalScheduleModeToken(rawMode)) != kAllowed.end();
}

inline bool isAllowedAnalyzeIntervalAnchorMode(const std::string& rawMode) {
    static const std::unordered_set<std::string> kAllowed = {
        "monitoring_start",
        "first_matching_event",
        "fixed_time_local"
    };
    return kAllowed.find(normalizeAnalyzeIntervalAnchorModeToken(rawMode)) != kAllowed.end();
}

inline bool isAllowedAnalyzeIntervalCatchUpMode(const std::string& rawMode) {
    static const std::unordered_set<std::string> kAllowed = {
        "latest_due_only",
        "emit_all_due"
    };
    return kAllowed.find(normalizeAnalyzeIntervalCatchUpModeToken(rawMode)) != kAllowed.end();
}

inline bool isAllowedAnalyzeIntervalKind(const std::string& rawKind) {
    static const std::unordered_set<std::string> kAllowed = {
        "count_occurrences",
        "count_distinct_entities",
        "has_any_event",
        "last_event_age_seconds",
        "first_event_ts",
        "last_event_ts",
        "event_rate",
        "window_buffer"
    };
    return kAllowed.find(normalizeAnalyzeIntervalKindToken(rawKind)) != kAllowed.end();
}

inline bool isAllowedAnalyzeIntervalWindowMode(const std::string& rawMode) {
    static const std::unordered_set<std::string> kAllowed = {
        "cumulative_from_anchor",
        "bucket"
    };
    return kAllowed.find(normalizeAnalyzeIntervalWindowModeToken(rawMode)) != kAllowed.end();
}

inline bool isAllowedAnalyzeIntervalDecisionMode(const std::string& rawMode) {
    static const std::unordered_set<std::string> kAllowed = {
        "report_only",
        "alert_if_true",
        "report_and_alert_if_true"
    };
    return kAllowed.find(normalizeAnalyzeIntervalDecisionModeToken(rawMode)) != kAllowed.end();
}

inline bool isAllowedAnalyzeIntervalDecisionOp(const std::string& rawOp) {
    static const std::unordered_set<std::string> kAllowed = {
        "<", "<=", ">", ">=", "==", "!=", "between", "outside", "is_true", "is_false"
    };
    return kAllowed.find(normalizeAnalyzeIntervalDecisionOpToken(rawOp)) != kAllowed.end();
}

inline json normalizeAnalyzeEventsAtIntervalParams(const json& rawParams) {
    json params = rawParams.is_object() ? rawParams : json::object();
    json schedule = params.value("schedule", json::object());
    if (!schedule.is_object()) schedule = json::object();
    json source = params.value("source", json::object());
    if (!source.is_object()) source = json::object();
    json analysis = params.value("analysis", json::object());
    if (!analysis.is_object()) analysis = json::object();
    json decision = params.value("decision", json::object());
    if (!decision.is_object()) decision = json::object();
    json output = params.value("output", json::object());
    if (!output.is_object()) output = json::object();

    const std::string rawDatetimeLocal = trim(strField(
        schedule,
        "datetime_local",
        strField(schedule, "local_datetime", std::string())));
    const std::string rawDateLocal = trim(strField(
        schedule,
        "date_local",
        strField(schedule, "local_date", std::string())));
    const std::string rawTimeLocal = trim(strField(
        schedule,
        "time_local",
        strField(schedule, "local_time", std::string())));
    const std::string rawTimezone = trim(strField(schedule, "timezone", std::string()));

    std::string normalizedDateLocal;
    std::string normalizedTimeLocal;
    if (!rawDatetimeLocal.empty()) {
        splitAndNormalizeLocalDateTime(rawDatetimeLocal, normalizedDateLocal, normalizedTimeLocal);
    }

    std::string explicitDateLocal;
    if (!rawDateLocal.empty()) {
        if (normalizeLocalDateString(rawDateLocal, explicitDateLocal)) {
            normalizedDateLocal = explicitDateLocal;
        } else {
            normalizedDateLocal.clear();
            schedule["date_local"] = rawDateLocal;
        }
    }

    std::string explicitTimeLocal;
    if (!rawTimeLocal.empty()) {
        if (normalizeClockTimeString(rawTimeLocal, explicitTimeLocal)) {
            normalizedTimeLocal = explicitTimeLocal;
        } else {
            normalizedTimeLocal.clear();
            schedule["time_local"] = rawTimeLocal;
        }
    }

    const bool fixedLocalFieldsPresent =
        !normalizedDateLocal.empty() ||
        !normalizedTimeLocal.empty() ||
        !rawDateLocal.empty() ||
        !rawTimeLocal.empty() ||
        !rawDatetimeLocal.empty();

    const std::string scheduleMode =
        normalizeAnalyzeIntervalScheduleModeToken(strField(schedule, "mode", std::string()));
    schedule["mode"] = scheduleMode.empty() ? "once" : scheduleMode;

    const std::string anchorMode =
        normalizeAnalyzeIntervalAnchorModeToken(strField(schedule, "anchor_mode", std::string()));
    schedule["anchor_mode"] =
        anchorMode.empty()
            ? (fixedLocalFieldsPresent ? "fixed_time_local" : "monitoring_start")
            : anchorMode;

    const std::string catchUpMode = normalizeAnalyzeIntervalCatchUpModeToken(
        strField(schedule, "catch_up_mode", "latest_due_only"));
    schedule["catch_up_mode"] = catchUpMode.empty() ? "latest_due_only" : catchUpMode;

    if (!normalizedDateLocal.empty()) {
        schedule["date_local"] = normalizedDateLocal;
    } else if (schedule.contains("date_local") && schedule["date_local"].is_string()) {
        schedule["date_local"] = trim(schedule["date_local"].get<std::string>());
    }

    if (!normalizedTimeLocal.empty()) {
        schedule["time_local"] = normalizedTimeLocal;
    } else if (schedule.contains("time_local") && schedule["time_local"].is_string()) {
        schedule["time_local"] = trim(schedule["time_local"].get<std::string>());
    }

    if (schedule.contains("datetime_local")) {
        schedule.erase("datetime_local");
    }
    if (schedule.contains("local_datetime")) {
        schedule.erase("local_datetime");
    }

    const std::string normalizedTimezone = canonicalFixedLocalTimezone(rawTimezone);
    if (!normalizedTimezone.empty()) {
        schedule["timezone"] = normalizedTimezone;
    } else if (!rawTimezone.empty()) {
        schedule["timezone"] = rawTimezone;
    }

    const std::string normalizedAnchorMode =
        normalizeAnalyzeIntervalAnchorModeToken(strField(schedule, "anchor_mode", std::string()));
    if (normalizedAnchorMode == "fixed_time_local" &&
        strField(schedule, "mode", std::string()) == "recurring" &&
        trim(strField(schedule, "date_local", std::string())).empty() &&
        intField(schedule, "interval_seconds", 0) <= 0)
    {
        schedule["interval_seconds"] = 86400;
    }

    const std::string sourceEvent = normalizeEventName(strField(source, "event", std::string()));
    if (!sourceEvent.empty()) source["event"] = sourceEvent;
    const std::string sourceEntity = trim(strField(source, "entity", std::string()));
    if (!sourceEntity.empty()) source["entity"] = sourceEntity;
    const std::string sourceZone = extractZoneField(source);
    if (!sourceZone.empty()) source["zone"] = sourceZone;

    const std::string analysisKind =
        normalizeAnalyzeIntervalKindToken(strField(analysis, "kind", std::string()));
    analysis["kind"] = analysisKind.empty() ? "count_occurrences" : analysisKind;

    const std::string windowMode =
        normalizeAnalyzeIntervalWindowModeToken(strField(analysis, "window_mode", std::string()));
    analysis["window_mode"] = windowMode.empty() ? "bucket" : windowMode;

    if (!analysis.contains("window_seconds") &&
        intField(schedule, "interval_seconds", 0) > 0)
    {
        analysis["window_seconds"] = intField(schedule, "interval_seconds", 0);
    }

    const std::string decisionMode =
        normalizeAnalyzeIntervalDecisionModeToken(strField(decision, "mode", std::string()));
    decision["mode"] = decisionMode.empty() ? "alert_if_true" : decisionMode;

    const std::string decisionOp =
        normalizeAnalyzeIntervalDecisionOpToken(strField(decision, "op", std::string()));
    if (!decisionOp.empty()) decision["op"] = decisionOp;

    const std::string summaryLabel = trim(strField(output, "summary_label", std::string()));
    if (!summaryLabel.empty()) output["summary_label"] = summaryLabel;

    params["schedule"] = std::move(schedule);
    params["source"] = std::move(source);
    params["analysis"] = std::move(analysis);
    params["decision"] = std::move(decision);
    params["output"] = std::move(output);
    return params;
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

inline std::string addSecondsIso(const std::string& tsIso, long long deltaSeconds) {
    std::chrono::system_clock::time_point tp;
    if (!parseFlexibleTs(tsIso, tp)) return "";
    tp += std::chrono::seconds(deltaSeconds);
    return formatIsoUtcNoSuffix(tp);
}

inline bool normalizeTsBetweenInclusive(const std::string& rawTs,
                                        const std::string& startIsoUtc,
                                        const std::string& endIsoUtc,
                                        std::string* outNormalizedTs = nullptr) {
    const std::string normalized = normalizeFlexibleTs(rawTs);
    if (normalized.empty()) return false;
    if (!trim(startIsoUtc).empty() && normalized < trim(startIsoUtc)) return false;
    if (!trim(endIsoUtc).empty() && normalized > trim(endIsoUtc)) return false;
    if (outNormalizedTs) *outNormalizedTs = normalized;
    return true;
}

inline bool isLeapYear(int year) {
    return (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
}

inline int daysInMonth(int year, int month) {
    static const std::array<int, 12> kDays = {
        31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31
    };
    if (month < 1 || month > 12) return 0;
    if (month == 2 && isLeapYear(year)) return 29;
    return kDays[static_cast<std::size_t>(month - 1)];
}

inline bool parseLocalDateParts(const std::string& raw, int& outYear, int& outMonth, int& outDay) {
    const std::string s = trim(raw);
    if (s.empty()) return false;

    char separator = '\0';
    for (char candidate : { '-', '/', '.' }) {
        if (s.find(candidate) != std::string::npos) {
            separator = candidate;
            break;
        }
    }
    if (separator == '\0') return false;

    std::vector<std::string> parts;
    std::size_t start = 0;
    while (start <= s.size()) {
        const std::size_t pos = s.find(separator, start);
        const std::string piece = trim(s.substr(start, pos == std::string::npos ? std::string::npos : pos - start));
        if (piece.empty()) return false;
        parts.push_back(piece);
        if (pos == std::string::npos) break;
        start = pos + 1;
    }
    if (parts.size() != 3) return false;

    int a = 0;
    int b = 0;
    int c = 0;
    try {
        a = std::stoi(parts[0]);
        b = std::stoi(parts[1]);
        c = std::stoi(parts[2]);
    } catch (...) {
        return false;
    }

    int year = 0;
    int month = 0;
    int day = 0;
    if (parts[0].size() == 4) {
        year = a;
        month = b;
        day = c;
    } else if (parts[2].size() == 4) {
        day = a;
        month = b;
        year = c;
    } else {
        return false;
    }

    if (year < 1900 || year > 9999) return false;
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > daysInMonth(year, month)) return false;

    outYear = year;
    outMonth = month;
    outDay = day;
    return true;
}

inline std::string formatLocalDateIso(int year, int month, int day) {
    std::ostringstream oss;
    oss << std::setfill('0')
        << std::setw(4) << year
        << "-"
        << std::setw(2) << month
        << "-"
        << std::setw(2) << day;
    return oss.str();
}

inline bool normalizeLocalDateString(const std::string& raw, std::string& outDate) {
    int year = 0;
    int month = 0;
    int day = 0;
    if (!parseLocalDateParts(raw, year, month, day)) return false;
    outDate = formatLocalDateIso(year, month, day);
    return true;
}

inline std::string formatClockTimeSeconds(int totalSeconds, bool forceSeconds = false) {
    if (totalSeconds < 0 || totalSeconds >= 24 * 3600) return std::string();
    const int hh = totalSeconds / 3600;
    const int mm = (totalSeconds % 3600) / 60;
    const int ss = totalSeconds % 60;
    std::ostringstream oss;
    oss << std::setfill('0') << std::setw(2) << hh
        << ":" << std::setw(2) << mm;
    if (forceSeconds || ss != 0) {
        oss << ":" << std::setw(2) << ss;
    }
    return oss.str();
}

inline bool parseClockTimeSeconds(const std::string& raw, int& outSeconds) {
    const std::string s = trim(raw);
    if (s.size() < 4 || s.size() > 8) return false;
    const auto firstColon = s.find(':');
    if (firstColon == std::string::npos) return false;
    const auto secondColon = s.find(':', firstColon + 1);
    if (secondColon != std::string::npos && s.find(':', secondColon + 1) != std::string::npos) {
        return false;
    }

    int hh = -1;
    int mm = -1;
    int ss = 0;
    try {
        hh = std::stoi(s.substr(0, firstColon));
        if (secondColon == std::string::npos) {
            mm = std::stoi(s.substr(firstColon + 1));
        } else {
            mm = std::stoi(s.substr(firstColon + 1, secondColon - firstColon - 1));
            ss = std::stoi(s.substr(secondColon + 1));
        }
    } catch (...) {
        return false;
    }
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) return false;
    outSeconds = hh * 3600 + mm * 60 + ss;
    return true;
}

inline bool normalizeClockTimeString(const std::string& raw, std::string& outTime) {
    const std::string trimmed = trim(raw);
    if (trimmed.empty()) return false;

    int parsedSeconds = 0;
    if (parseClockTimeSeconds(trimmed, parsedSeconds)) {
        outTime = formatClockTimeSeconds(parsedSeconds);
        return !outTime.empty();
    }

    std::string lowered = lower(trimmed);
    bool isPm = false;
    bool isAm = false;

    auto eraseToken = [&](const std::string& token, bool markAm, bool markPm) {
        std::size_t pos = lowered.find(token);
        if (pos == std::string::npos) return;
        lowered.erase(pos, token.size());
        if (markAm) isAm = true;
        if (markPm) isPm = true;
    };

    eraseToken("da tarde", false, true);
    eraseToken("da noite", false, true);
    eraseToken("da manha", true, false);
    eraseToken("pm", false, true);
    eraseToken("p.m.", false, true);
    eraseToken("p.m", false, true);
    eraseToken("am", true, false);
    eraseToken("a.m.", true, false);
    eraseToken("a.m", true, false);

    std::string compact;
    compact.reserve(lowered.size());
    for (char ch : lowered) {
        if (!std::isspace(static_cast<unsigned char>(ch)) && ch != '.') {
            compact.push_back(ch);
        }
    }
    while (!compact.empty() && compact.back() == 'm') compact.pop_back();

    std::string canonical = compact;
    const std::size_t hPos = canonical.find('h');
    if (hPos != std::string::npos) {
        const std::string hours = canonical.substr(0, hPos);
        const std::string suffix = canonical.substr(hPos + 1);
        if (hours.empty()) return false;
        if (suffix.empty()) {
            canonical = hours + ":00";
        } else if (suffix.size() == 2) {
            canonical = hours + ":" + suffix;
        } else if (suffix.size() == 4) {
            canonical = hours + ":" + suffix.substr(0, 2) + ":" + suffix.substr(2, 2);
        } else {
            return false;
        }
    } else if ((isAm || isPm) && canonical.find(':') == std::string::npos) {
        canonical += ":00";
    }

    if (!parseClockTimeSeconds(canonical, parsedSeconds)) return false;

    int hour = parsedSeconds / 3600;
    const int minute = (parsedSeconds % 3600) / 60;
    const int second = parsedSeconds % 60;
    if (isPm && hour < 12) {
        hour += 12;
    } else if (isAm && hour == 12) {
        hour = 0;
    }

    outTime = formatClockTimeSeconds(hour * 3600 + minute * 60 + second);
    return !outTime.empty();
}

inline bool splitAndNormalizeLocalDateTime(
    const std::string& raw,
    std::string& outDate,
    std::string& outTime)
{
    const std::string s = trim(raw);
    if (s.empty()) return false;

    const std::size_t sep = s.find('T') != std::string::npos ? s.find('T') : s.find(' ');
    if (sep == std::string::npos) return false;

    const std::string datePart = trim(s.substr(0, sep));
    const std::string timePart = trim(s.substr(sep + 1));
    if (!normalizeLocalDateString(datePart, outDate)) return false;
    if (!normalizeClockTimeString(timePart, outTime)) return false;
    return true;
}

inline bool parseKnownFixedTimezoneAliasSeconds(const std::string& raw, int& outSeconds) {
    static const std::unordered_map<std::string, int> kAliases = {
        { "ETC/UTC", 0 },
        { "ETC/GMT", 0 },
        { "AMERICA/SAO_PAULO", -3 * 3600 },
        { "AMERICA/BAHIA", -3 * 3600 },
        { "AMERICA/FORTALEZA", -3 * 3600 },
        { "AMERICA/RECIFE", -3 * 3600 },
        { "AMERICA/MANAUS", -4 * 3600 },
        { "AMERICA/CUIABA", -4 * 3600 }
    };
    const auto it = kAliases.find(upper(trim(raw)));
    if (it == kAliases.end()) return false;
    outSeconds = it->second;
    return true;
}

inline std::string formatUtcOffsetSeconds(int offsetSeconds) {
    if (offsetSeconds == 0) return "UTC";
    const char sign = offsetSeconds >= 0 ? '+' : '-';
    const int absSeconds = std::abs(offsetSeconds);
    const int hours = absSeconds / 3600;
    const int minutes = (absSeconds % 3600) / 60;
    std::ostringstream out;
    out << sign
        << std::setfill('0')
        << std::setw(2) << hours
        << ":"
        << std::setw(2) << minutes;
    return out.str();
}

inline bool parseUtcOffsetSeconds(const std::string& raw, int& outSeconds) {
    std::string s = upper(trim(raw));
    if (s.empty() || s == "UTC" || s == "GMT" || s == "Z") {
        outSeconds = 0;
        return true;
    }
    if (parseKnownFixedTimezoneAliasSeconds(s, outSeconds)) {
        return true;
    }
    if (s.rfind("UTC", 0) == 0) {
        s = trim(s.substr(3));
    } else if (s.rfind("GMT", 0) == 0) {
        s = trim(s.substr(3));
    }
    if (s.empty() || s == "Z") {
        outSeconds = 0;
        return true;
    }
    if (parseKnownFixedTimezoneAliasSeconds(s, outSeconds)) {
        return true;
    }
    if (s.size() < 2 || (s[0] != '+' && s[0] != '-')) return false;

    int sign = (s[0] == '-') ? -1 : 1;
    std::string rest = s.substr(1);
    int hh = -1;
    int mm = 0;
    try {
        const auto colon = rest.find(':');
        if (colon != std::string::npos) {
            hh = std::stoi(rest.substr(0, colon));
            mm = std::stoi(rest.substr(colon + 1));
        } else if (rest.size() == 4) {
            hh = std::stoi(rest.substr(0, 2));
            mm = std::stoi(rest.substr(2, 2));
        } else {
            hh = std::stoi(rest);
        }
    } catch (...) {
        return false;
    }
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return false;
    outSeconds = sign * (hh * 3600 + mm * 60);
    return true;
}

inline std::string canonicalFixedLocalTimezone(const std::string& raw) {
    int offsetSeconds = 0;
    if (!parseUtcOffsetSeconds(raw, offsetSeconds)) return std::string();
    return formatUtcOffsetSeconds(offsetSeconds);
}

inline bool computeAbsoluteFixedLocalCheckpointUtc(const std::string& dateLocal,
                                                   const std::string& timeLocal,
                                                   const std::string& timezone,
                                                   std::string& outDueIsoUtc) {
    int year = 0;
    int month = 0;
    int day = 0;
    if (!parseLocalDateParts(dateLocal, year, month, day)) return false;

    int localClockSeconds = 0;
    if (!parseClockTimeSeconds(timeLocal, localClockSeconds)) return false;

    int offsetSeconds = 0;
    if (!parseUtcOffsetSeconds(timezone, offsetSeconds)) return false;

    std::tm localTargetTm{};
    localTargetTm.tm_year = year - 1900;
    localTargetTm.tm_mon = month - 1;
    localTargetTm.tm_mday = day;
    localTargetTm.tm_hour = localClockSeconds / 3600;
    localTargetTm.tm_min = (localClockSeconds % 3600) / 60;
    localTargetTm.tm_sec = localClockSeconds % 60;

#if defined(_WIN32)
    std::time_t candidateLocalTt = _mkgmtime(&localTargetTm);
#else
    std::time_t candidateLocalTt = timegm(&localTargetTm);
#endif
    if (candidateLocalTt == static_cast<std::time_t>(-1)) return false;

    const auto candidateUtcTp =
        std::chrono::system_clock::from_time_t(candidateLocalTt - offsetSeconds);
    outDueIsoUtc = formatIsoUtcNoSuffix(candidateUtcTp);
    return !outDueIsoUtc.empty();
}

inline bool computeNextFixedLocalCheckpointUtc(const std::string& monitoringStartIsoUtc,
                                               const std::string& timeLocal,
                                               const std::string& timezone,
                                               std::string& outDueIsoUtc) {
    std::chrono::system_clock::time_point monitoringStartTp;
    if (!parseFlexibleTs(monitoringStartIsoUtc, monitoringStartTp)) return false;

    int localClockSeconds = 0;
    if (!parseClockTimeSeconds(timeLocal, localClockSeconds)) return false;

    int offsetSeconds = 0;
    if (!parseUtcOffsetSeconds(timezone, offsetSeconds)) return false;

    const auto localReferenceTp = monitoringStartTp + std::chrono::seconds(offsetSeconds);
    const std::time_t localReferenceTt = std::chrono::system_clock::to_time_t(localReferenceTp);
    std::tm localReferenceTm{};
#if defined(_WIN32)
    gmtime_s(&localReferenceTm, &localReferenceTt);
#else
    gmtime_r(&localReferenceTt, &localReferenceTm);
#endif
    localReferenceTm.tm_hour = localClockSeconds / 3600;
    localReferenceTm.tm_min = (localClockSeconds % 3600) / 60;
    localReferenceTm.tm_sec = localClockSeconds % 60;

#if defined(_WIN32)
    std::time_t candidateLocalTt = _mkgmtime(&localReferenceTm);
#else
    std::time_t candidateLocalTt = timegm(&localReferenceTm);
#endif
    if (candidateLocalTt == static_cast<std::time_t>(-1)) return false;

    auto candidateUtcTp =
        std::chrono::system_clock::from_time_t(candidateLocalTt - offsetSeconds);
    if (candidateUtcTp < monitoringStartTp) {
        candidateUtcTp += std::chrono::hours(24);
    }
    outDueIsoUtc = formatIsoUtcNoSuffix(candidateUtcTp);
    return !outDueIsoUtc.empty();
}

inline bool computeFixedLocalCheckpointUtc(const std::string& monitoringStartIsoUtc,
                                           const std::string& dateLocal,
                                           const std::string& timeLocal,
                                           const std::string& timezone,
                                           std::string& outDueIsoUtc) {
    const std::string normalizedDateLocal = trim(dateLocal);
    if (!normalizedDateLocal.empty()) {
        return computeAbsoluteFixedLocalCheckpointUtc(
            normalizedDateLocal,
            timeLocal,
            timezone,
            outDueIsoUtc);
    }
    return computeNextFixedLocalCheckpointUtc(
        monitoringStartIsoUtc,
        timeLocal,
        timezone,
        outDueIsoUtc);
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
    const json source = params.value("source", json::object());
    const std::string sourceEntity = strField(source, "entity");
    const std::string sourceEvent = strField(source, "event");

    if (tokenLooksLikeThreatEvidence(eventName) ||
        tokenLooksLikeThreatEvidence(withoutEvent) ||
        tokenLooksLikeThreatEvidence(triggerEvent) ||
        tokenLooksLikeThreatEvidence(sourceEvent) ||
        tokenLooksLikeThreatEvidence(strField(op, "operator_id")))
    {
        return true;
    }

    const bool threatEntity =
        tokenLooksLikeThreatEvidence(entity) ||
        tokenLooksLikeThreatEvidence(sourceEntity);
    if (!threatEntity) return false;

    return typ == "entity_present" ||
           typ == "entity_absent" ||
           typ == "count_events_in_window" ||
           typ == "analyze_events_at_interval" ||
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

inline bool eventNameSuggestsPersistentState(const std::string& rawEvent) {
    const std::string normalized = lower(trim(normalizeEventName(rawEvent)));
    if (normalized == "stopped" || normalized == "present") return true;

    const std::string token = lower(trim(rawEvent));
    return token.find("stopped") != std::string::npos ||
           token.find("parked") != std::string::npos ||
           token.find("stationary") != std::string::npos ||
           token.find("idle") != std::string::npos ||
           token.find("waiting") != std::string::npos ||
           token.find("queued") != std::string::npos ||
           token.find("dwell") != std::string::npos ||
           token.find("lingering") != std::string::npos ||
           token.find("paused") != std::string::npos ||
           token.find("present") != std::string::npos;
}

inline std::string inferDurationAnchorEventFromCatalog(
    const json& plan,
    const std::string& rawWithoutEvent)
{
    if (!plan.is_object() || !plan.contains("event_catalog") || !plan["event_catalog"].is_array()) {
        return std::string();
    }

    const std::string normalizedWithoutEvent = lower(trim(normalizeEventName(rawWithoutEvent)));
    std::vector<std::string> candidates;
    std::vector<std::string> persistentStateCandidates;
    std::unordered_set<std::string> seen;

    for (const auto& ev : plan["event_catalog"]) {
        const std::string eventName = eventCatalogNameFromNode(ev);
        if (eventName.empty()) continue;

        const std::string eventKey = lower(trim(eventName));
        if (!seen.insert(eventKey).second) continue;

        const std::string normalizedEvent = lower(trim(normalizeEventName(eventName)));
        if (!normalizedWithoutEvent.empty() &&
            normalizedEvent == normalizedWithoutEvent)
        {
            continue;
        }

        candidates.push_back(eventName);
        if (eventNameSuggestsPersistentState(eventName)) {
            persistentStateCandidates.push_back(eventName);
        }
    }

    if (candidates.size() == 1) return candidates.front();
    if (persistentStateCandidates.size() == 1) return persistentStateCandidates.front();
    return std::string();
}

inline void normalizeOperators(json& plan) {
    if (!plan.is_object()) return;
    if (!plan.contains("operators") || !plan["operators"].is_array()) return;

    const int defaultWindowSeconds = std::max(
        1,
        intField(plan.value("retention_policy", json::object()), "state_ttl_seconds", 43200));
    const json executionContext = plan.value("execution_context", json::object());
    const std::string defaultFixedTimeTimezone = [&]() -> std::string {
        const std::string hintedTimezone = canonicalFixedLocalTimezone(
            strField(executionContext, "fixed_time_timezone_hint"));
        if (!hintedTimezone.empty()) return hintedTimezone;
        return canonicalFixedLocalTimezone(strField(executionContext, "timezone"));
    }();

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
        } else if (typ == "stopped_for_more_than_without_event") {
            json params = op.value("params", json::object());
            if (!params.is_object()) params = json::object();

            std::string eventName = trim(strField(params, "event", strField(params, "anchor_event")));
            if (eventName.empty()) {
                eventName = inferDurationAnchorEventFromCatalog(plan, strField(params, "without_event"));
            }
            if (eventName.empty()) {
                eventName = "stopped";
            }

            params["event"] = eventName;
            if (params.contains("anchor_event")) {
                params.erase("anchor_event");
            }
            ensureEventInCatalog(plan, eventName);
            op["params"] = params;
        } else if (typ == "analyze_events_at_interval") {
            json params = normalizeAnalyzeEventsAtIntervalParams(
                op.value("params", json::object()));
            json schedule = params.value("schedule", json::object());
            if (!schedule.is_object()) schedule = json::object();
            const std::string anchorMode =
                normalizeAnalyzeIntervalAnchorModeToken(strField(schedule, "anchor_mode"));
            if (anchorMode == "fixed_time_local" &&
                trim(strField(schedule, "timezone")).empty() &&
                !defaultFixedTimeTimezone.empty())
            {
                schedule["timezone"] = defaultFixedTimeTimezone;
                params["schedule"] = schedule;
            }
            const json source = params.value("source", json::object());
            const std::string sourceEvent = trim(strField(source, "event"));
            if (!sourceEvent.empty()) {
                ensureEventInCatalog(plan, sourceEvent);
            }
            op["params"] = std::move(params);
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
        "visibility_condition",
        "continuity_context"
    };
    return kAllowed.find(normalizeIdentityFeatureEnumToken(rawCategory)) != kAllowed.end();
}

inline bool identityFeatureRelationEligibleForContext(const std::string& rawRelation) {
    static const std::unordered_set<std::string> kAllowed = {
        "visibility_condition",
        "continuity_context"
    };
    return kAllowed.find(normalizeIdentityFeatureEnumToken(rawRelation)) != kAllowed.end();
}

inline json deriveIdentitySignatureTraitsFromFeatureCandidates(
    const json& value,
    const std::string& rawEntityType = std::string(),
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
        if (classifyIdentityTraitPriority(rawEntityType, text) <= 0) {
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
        if (traitLooksLikeSceneOrBackgroundContext(text) ||
            traitLooksLikePoseOrActivityContext(text) ||
            !traitLooksLikeTransientIdentityContext(text))
        {
            continue;
        }
        appendUniqueStringsToArray(out, text);
        if (out.size() >= maxItems) break;
    }
    return out;
}

inline json filterIdentityFeatureCandidatesForMemory(
    const std::string& rawEntityType,
    const json& value,
    std::size_t maxItems = 12)
{
    const json candidates = parseIdentityFeatureCandidatesValue(value);
    json out = json::array();
    std::unordered_set<std::string> seen;
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
        if (classifyIdentityTraitPriority(rawEntityType, text) <= 0) {
            continue;
        }

        const std::string dedupeKey = lower(text) + "|" + category + "|" + relation;
        if (!seen.insert(dedupeKey).second) continue;

        json normalized = json::object();
        normalized["text"] = text;
        if (!category.empty()) normalized["category"] = category;
        if (!relation.empty()) normalized["relation_to_target"] = relation;
        if (item.contains("confidence") && item["confidence"].is_number()) {
            normalized["confidence"] = item["confidence"];
        }
        out.push_back(std::move(normalized));
        if (out.size() >= maxItems) break;
    }
    return out;
}

inline json extractStableTraitsFromNode(
    const json& node,
    const std::string& rawEntityType = std::string()) {
    if (!node.is_object()) return json::array();
    const json structuredCandidates = extractIdentityFeatureCandidatesFromNode(node);
    const json structuredIdentityTraits =
        deriveIdentitySignatureTraitsFromFeatureCandidates(structuredCandidates, rawEntityType);
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

inline json extractContextTraitsFromNode(
    const json& node,
    const std::string& rawEntityType = std::string()) {
    (void)rawEntityType;
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

inline bool validateAnalyzeEventsAtIntervalParams(
    const json& params,
    const std::unordered_set<std::string>& entityKeys,
    const std::unordered_set<std::string>& events,
    std::string* outReason = nullptr)
{
    auto fail = [&](const std::string& reason) -> bool {
        if (outReason) *outReason = reason;
        return false;
    };

    if (!params.is_object()) return fail("operator_params_invalid");
    const json normalizedParams = normalizeAnalyzeEventsAtIntervalParams(params);
    const json schedule = normalizedParams.value("schedule", json::object());
    const json source = normalizedParams.value("source", json::object());
    const json analysis = normalizedParams.value("analysis", json::object());
    const json decision = normalizedParams.value("decision", json::object());
    const json output = normalizedParams.value("output", json::object());

    if (!schedule.is_object()) return fail("operator_schedule_invalid");
    if (!source.is_object()) return fail("operator_source_invalid");
    if (!analysis.is_object()) return fail("operator_analysis_invalid");
    if (!decision.is_object()) return fail("operator_decision_invalid");
    if (!output.is_object()) return fail("operator_output_invalid");

    const std::string scheduleMode =
        normalizeAnalyzeIntervalScheduleModeToken(strField(schedule, "mode"));
    const std::string anchorMode =
        normalizeAnalyzeIntervalAnchorModeToken(strField(schedule, "anchor_mode"));
    const std::string catchUpMode =
        normalizeAnalyzeIntervalCatchUpModeToken(strField(schedule, "catch_up_mode", "latest_due_only"));
    const int intervalSeconds = intField(schedule, "interval_seconds", 0);
    const std::string dateLocal = trim(strField(schedule, "date_local"));
    if (!isAllowedAnalyzeIntervalScheduleMode(scheduleMode)) return fail("operator_schedule_mode_invalid");
    if (!isAllowedAnalyzeIntervalAnchorMode(anchorMode)) return fail("operator_anchor_mode_invalid");
    if (!isAllowedAnalyzeIntervalCatchUpMode(catchUpMode)) return fail("operator_catch_up_mode_invalid");
    if (scheduleMode == "recurring" && intervalSeconds <= 0) return fail("operator_interval_seconds_invalid");
    if (anchorMode != "fixed_time_local" && intervalSeconds <= 0) return fail("operator_interval_seconds_invalid");
    if (anchorMode == "fixed_time_local") {
        int parsedClockSeconds = 0;
        if (!parseClockTimeSeconds(strField(schedule, "time_local"), parsedClockSeconds)) {
            return fail("operator_time_local_invalid");
        }
        if (!dateLocal.empty()) {
            std::string normalizedDateLocal;
            if (!normalizeLocalDateString(dateLocal, normalizedDateLocal)) {
                return fail("operator_date_local_invalid");
            }
            if (scheduleMode != "once") return fail("operator_date_local_requires_once");
        }
        const std::string timezone = trim(strField(schedule, "timezone"));
        if (timezone.empty()) return fail("operator_timezone_missing");
        int parsedOffsetSeconds = 0;
        if (!parseUtcOffsetSeconds(timezone, parsedOffsetSeconds)) {
            return fail("operator_timezone_unsupported");
        }
    } else if (!dateLocal.empty()) {
        return fail("operator_date_local_requires_fixed_time_local");
    }

    const std::string sourceEvent = trim(strField(source, "event"));
    const std::string sourceEntity = trim(strField(source, "entity"));
    if (sourceEvent.empty()) return fail("operator_source_event_missing");
    if (events.find(sourceEvent) == events.end()) return fail("operator_source_event_missing");
    if (!sourceEntity.empty() && entityKeys.find(sourceEntity) == entityKeys.end()) {
        return fail("operator_source_entity_missing");
    }

    const std::string analysisKind =
        normalizeAnalyzeIntervalKindToken(strField(analysis, "kind"));
    const std::string windowMode =
        normalizeAnalyzeIntervalWindowModeToken(strField(analysis, "window_mode"));
    if (!isAllowedAnalyzeIntervalKind(analysisKind)) return fail("operator_analysis_kind_invalid");
    if (!isAllowedAnalyzeIntervalWindowMode(windowMode)) return fail("operator_window_mode_invalid");
    if (analysis.contains("window_seconds") && intField(analysis, "window_seconds", -1) < 0) {
        return fail("operator_window_seconds_invalid");
    }

    const std::string decisionMode =
        normalizeAnalyzeIntervalDecisionModeToken(strField(decision, "mode"));
    if (!isAllowedAnalyzeIntervalDecisionMode(decisionMode)) return fail("operator_decision_mode_invalid");
    if (decisionMode != "report_only") {
        const std::string decisionOp =
            normalizeAnalyzeIntervalDecisionOpToken(strField(decision, "op"));
        if (!isAllowedAnalyzeIntervalDecisionOp(decisionOp)) return fail("operator_decision_op_invalid");
        if (decisionOp == "between" || decisionOp == "outside") {
            if (!decision.contains("min") || !decision.contains("max")) return fail("operator_decision_range_missing");
            if (dblField(decision, "max", 0.0) < dblField(decision, "min", 0.0)) {
                return fail("operator_decision_range_invalid");
            }
        } else if (decisionOp != "is_true" && decisionOp != "is_false") {
            if (!decision.contains("value")) return fail("operator_decision_value_missing");
        }
    }

    return true;
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
        const std::string normalizedOpType = lower(opType);

        if (normalizedOpType == "analyze_events_at_interval") {
            std::string analyzeReason;
            if (!validateAnalyzeEventsAtIntervalParams(params, entityKeys, events, &analyzeReason)) {
                return fail(analyzeReason);
            }
            continue;
        }

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

        if (normalizedOpType == "stopped_for_more_than_without_event") {
            if (event.empty()) return fail("operator_event_missing");
            if (withoutEvent.empty()) return fail("operator_without_event_missing");
            if (intField(params, "seconds", 0) <= 0) return fail("operator_seconds_invalid");
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
    const std::string normalized = lower(trim(modelFamily));
    if (normalized == "core") return "GLM-4.6V-Flash";
    if (normalized == "ultra_plus" || normalized == "ultra+" || normalized == "ultra-plus") {
        return "gpt-5.4";
    }
    if (normalized == "light") return "gpt-5.4-mini";
    return "gpt-5.1";
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
            { "analyze_events_at_interval", {
                { "semantic_intent", "Evaluate confirmed event history only when a temporal checkpoint is reached, optionally reporting or alerting based on the analysis result." },
                { "positive_cues", json::array({
                    "after 30 minutes", "after x minutes", "at the end of the window", "only after the interval",
                    "every 10 minutes", "report every", "partial count every", "accumulated over 30 minutes",
                    "at 16:30", "at 4:30 pm", "on 2026-09-15 at 16:30",
                    "apos 30 minutos", "ao final de 30 minutos", "somente ao final", "a cada 10 minutos",
                    "as 16h30", "dia 15/09/2026 as 16h30",
                    "faca contagens parciais", "total acumulado", "janela acumulada", "depois de x minutos",
                    "despues de 30 minutos", "cada 10 minutos", "solo al final", "conteo parcial"
                })},
                { "negative_cues", json::array({
                    "alert immediately when threshold reached", "trigger as soon as count reaches", "instant alert on each event"
                })},
                { "canonical_schedule_modes", json::array({
                    "once", "recurring"
                })},
                { "canonical_anchor_modes", json::array({
                    "monitoring_start", "first_matching_event", "fixed_time_local"
                })},
                { "canonical_catch_up_modes", json::array({
                    "latest_due_only", "emit_all_due"
                })},
                { "canonical_analysis_kinds", json::array({
                    "count_occurrences", "count_distinct_entities", "has_any_event",
                    "last_event_age_seconds", "first_event_ts", "last_event_ts",
                    "event_rate", "window_buffer"
                })},
                { "canonical_window_modes", json::array({
                    "cumulative_from_anchor", "bucket"
                })},
                { "canonical_decision_modes", json::array({
                    "report_only", "alert_if_true", "report_and_alert_if_true"
                })},
                { "canonical_decision_ops", json::array({
                    "<", "<=", ">", ">=", "==", "!=", "between", "outside", "is_true", "is_false"
                })},
                { "canonical_output_fields", json::array({
                    "summary_label", "include_expected_value", "include_delta"
                })},
                { "semantic_mapping", json::array({
                    "single checkpoint after elapsed time -> schedule.mode=once",
                    "repeated checkpoints at a cadence -> schedule.mode=recurring",
                    "single checkpoint at a specific local clock time -> schedule.mode=once + schedule.anchor_mode=fixed_time_local + schedule.time_local=HH:MM",
                    "single checkpoint at an explicit local calendar date and time -> schedule.mode=once + schedule.anchor_mode=fixed_time_local + schedule.date_local=YYYY-MM-DD + schedule.time_local=HH:MM",
                    "accumulate from the anchor until the checkpoint -> analysis.window_mode=cumulative_from_anchor",
                    "evaluate only the last X minutes ending at the checkpoint -> analysis.window_mode=bucket"
                })},
                { "forbidden_aliases", json::array({
                    "relative", "rolling", "trailing", "threshold", "skip", "skip_missed",
                    "include_current_value", "include_difference", "include_threshold"
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
                { "semantic_intent", "Pure scheduling or reminder at a local time without event-history analysis." },
                { "negative_cues", json::array({
                    "analyze confirmed events at", "count events and report at", "summarize event history at",
                    "analise e me informe as", "conte eventos e informe as", "resuma eventos as"
                })}
            }},
            { "summary_window", {
                { "semantic_intent", "Summarize activity over a daily, hourly, or custom reporting window." }
            }}
        }}
    };
    json executionContext = {
        { "source_type", sourceType },
        { "source_id", sourceId },
        { "timezone", timezone }
    };
    const std::string fixedTimeTimezoneHint = canonicalFixedLocalTimezone(timezone);
    if (!fixedTimeTimezoneHint.empty()) {
        executionContext["fixed_time_timezone_hint"] = fixedTimeTimezoneHint;
    }

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
        { "execution_context", executionContext },
        { "allowed_operator_types", json::array({
            "stopped_for_more_than_without_event","seen_n_times_in_window_by_entity",
            "schedule_at_time","summary_window","entity_present","entity_absent",
            "count_events_in_window","no_event_for_duration",
            "analyze_events_at_interval",
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
  required_params: entity, event, seconds, without_event, zone(optional)
  example: vehicle event=stopped >300s without occupant_exit at front_gate
- seen_n_times_in_window_by_entity
  required_params: entity, event, n, window_seconds, zone(optional)
  example: same person picked_phone 3 times in 3600s
- schedule_at_time
  required_params: time_local, timezone
  use_only_when: pure scheduling or reminder without confirmed-event analysis
  example: trigger report at 17:00 -03:00
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
- analyze_events_at_interval
  required_params:
    schedule(mode, anchor_mode, catch_up_mode(optional), interval_seconds(required whenever the checkpoint is defined by elapsed time from monitoring_start or first_matching_event, and also for recurring schedules), time_local+timezone when anchor_mode=fixed_time_local, date_local(optional for a specific local calendar day), datetime_local(optional input alias that must be normalized into date_local+time_local)),
    source(event, entity(optional), zone(optional)),
    analysis(kind, window_mode, window_seconds(optional)),
    decision(mode, op/value or min/max when mode!=report_only),
    output(optional)
  canonical_enums:
    schedule.mode = once|recurring
    schedule.anchor_mode = monitoring_start|first_matching_event|fixed_time_local
    schedule.catch_up_mode = latest_due_only|emit_all_due
    analysis.kind = count_occurrences|count_distinct_entities|has_any_event|last_event_age_seconds|first_event_ts|last_event_ts|event_rate|window_buffer
    analysis.window_mode = cumulative_from_anchor|bucket
    decision.mode = report_only|alert_if_true|report_and_alert_if_true
    decision.op = <|<=|>|>=|==|!=|between|outside|is_true|is_false
    output fields = summary_label|include_expected_value|include_delta
  semantic_mapping:
    single checkpoint after elapsed time -> schedule.mode=once
    repeated checkpoints at a cadence -> schedule.mode=recurring
    accumulate from the anchor until the checkpoint -> analysis.window_mode=cumulative_from_anchor
    evaluate only the last X minutes ending at the checkpoint -> analysis.window_mode=bucket
  exact_examples:
    once after 30 minutes -> schedule={mode:"once", anchor_mode:"monitoring_start", interval_seconds:1800}, analysis={window_mode:"cumulative_from_anchor", window_seconds:1800}
    every 10 minutes on the last 10 minutes -> schedule={mode:"recurring", anchor_mode:"monitoring_start", interval_seconds:600}, analysis={window_mode:"bucket", window_seconds:600}
    every 10 minutes with accumulated partials over a 30-minute horizon -> schedule={mode:"recurring", anchor_mode:"monitoring_start", interval_seconds:600}, analysis={window_mode:"cumulative_from_anchor", window_seconds:1800}
    once at 16:30 local -> schedule={mode:"once", anchor_mode:"fixed_time_local", time_local:"16:30", timezone:INPUT_JSON.execution_context.fixed_time_timezone_hint}
    once on 2026-09-15 at 16:30 local -> schedule={mode:"once", anchor_mode:"fixed_time_local", date_local:"2026-09-15", time_local:"16:30", timezone:INPUT_JSON.execution_context.fixed_time_timezone_hint}
  forbidden_aliases:
    relative, rolling, trailing, threshold, skip, skip_missed, include_current_value, include_difference, include_threshold
  example: after 30 minutes count_distinct_entities of qualified_exit_porta_a and alert if result < 201
- cross_camera_track_after_trigger
  required_params: scope(job_step), trigger_mode(alert_condition_true|event_observed), watch_ttl_seconds, alert_on_match
  optional_params: trigger_event, share_entity_types
  example: after a robbery alert on one camera, share suspect traits to every camera in the same job step and alert on matches
  use_only_when: the user explicitly asks to search, track, follow or analyze across other cameras / all cameras after a trigger
- Prompts about armed people, weapons, guns, firearms, knives or similar threats must use an explicit threat event or threat-specific entity.
- Never reduce threat/weapon prompts to generic presence, entry, exit or stopped operators on plain person entities.
- cross_camera_track_after_trigger is opt-in only. If the prompt is only about local detection/alert in the current camera, DO NOT include it.
- Prefer compile_status="not_temporal" over weakly approximating a local single-batch detection with entity_present or other generic operators.
- Prefer analyze_events_at_interval when the request says to wait until a checkpoint such as "after X minutes", "at the end of 30 minutes", "every X minutes", "at 16:30", or "on 2026-09-15 at 16:30" before reporting or alerting on accumulated event analysis.
- If the user wants confirmed-event analysis at a fixed local time or a fixed local date+time, use analyze_events_at_interval, not schedule_at_time.
- Use schedule_at_time only for pure scheduling or reminder semantics without confirmed-event analysis.
- For analyze_events_at_interval, infer checkpoint behavior semantically from the whole multilingual request, not by copying literal words. Use canonical enum values only.
- If the request means a single elapsed checkpoint, emit schedule.mode="once". If it means repeated checkpoints, emit schedule.mode="recurring".
- If the request gives only a local clock time, emit schedule.anchor_mode="fixed_time_local", normalize time_local to HH:MM, and omit date_local.
- If the request gives a specific local calendar date and time, emit schedule.anchor_mode="fixed_time_local", normalize date_local to YYYY-MM-DD, and normalize time_local to HH:MM.
- If the request means accumulation from the anchor until the checkpoint, emit analysis.window_mode="cumulative_from_anchor". If it means only the last X minutes ending at the checkpoint, emit analysis.window_mode="bucket".
- Do not invent alias enums or ornamental output fields for analyze_events_at_interval. The runtime only accepts the canonical enums and the output fields summary_label, include_expected_value, include_delta.
- For analyze_events_at_interval with anchor_mode=fixed_time_local, prefer INPUT_JSON.execution_context.fixed_time_timezone_hint when it is present; otherwise use UTC or an explicit UTC offset like -03:00.

3) Event catalog rules
- Events must be atomic and observable from vision input.
- Event names in snake_case.
- event_catalog MUST be an array of plain snake_case strings only.
- Never return objects inside event_catalog.
- If event metadata is useful, put it in entities, operators or plan_explain_json, not in event_catalog.
- Do not create vague events (example: strange_behavior) unless explicitly requested.
- Use entered_zone and left_zone only as events/runtime-variable inputs, never as operator.type.
- For entry/exit alerts, prefer seen_n_times_in_window_by_entity over event entered_zone/left_zone.
- analyze_events_at_interval is event-centric: it analyzes confirmed events already stored by the temporal engine, not arbitrary scene state snapshots.

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
When type="analyze_events_at_interval", use only the canonical enum values from SYSTEM GUIDELINES. Do not invent aliases such as relative, rolling, trailing, threshold, skip or skip_missed.
For analyze_events_at_interval, decide from semantic intent:
- single checkpoint after elapsed time -> schedule.mode="once"
- repeated checkpoints -> schedule.mode="recurring"
- fixed local clock time such as 16:30 -> schedule.anchor_mode="fixed_time_local", schedule.time_local="HH:MM"
- fixed local date and time such as 2026-09-15 16:30 -> schedule.anchor_mode="fixed_time_local", schedule.date_local="YYYY-MM-DD", schedule.time_local="HH:MM"
- accumulated from the anchor until the checkpoint -> analysis.window_mode="cumulative_from_anchor"
- last X minutes ending at the checkpoint -> analysis.window_mode="bucket"
For analyze_events_at_interval fixed local checkpoints, prefer INPUT_JSON.execution_context.fixed_time_timezone_hint when present.
Do not use schedule_at_time when the request is to analyze confirmed events at a specific local time or date/time.
For analyze_events_at_interval output, use only summary_label, include_expected_value and include_delta.
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
                { "params", { { "entity", "vehicle" }, { "event", "stopped" }, { "seconds", 300 }, { "without_event", "occupant_exit" } } }
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
            { "first_round_start_ts_utc", "" },
            { "last_round_start_ts_utc", "" },
            { "last_round_end_ts_utc", "" },
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
    if (!st["meta"].contains("first_round_start_ts_utc") || !st["meta"]["first_round_start_ts_utc"].is_string()) {
        st["meta"]["first_round_start_ts_utc"] = "";
    }
    if (!st["meta"].contains("last_round_start_ts_utc") || !st["meta"]["last_round_start_ts_utc"].is_string()) {
        st["meta"]["last_round_start_ts_utc"] = "";
    }
    if (!st["meta"].contains("last_round_end_ts_utc") || !st["meta"]["last_round_end_ts_utc"].is_string()) {
        st["meta"]["last_round_end_ts_utc"] = "";
    }
    if (!st["meta"].contains("operator_state") || !st["meta"]["operator_state"].is_object()) st["meta"]["operator_state"] = json::object();
}

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
    const std::string normalizedZone = canonicalZoneKey(zone);
    if (!normalizedZone.empty()) ev["zone"] = normalizedZone;

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
        const std::string normalizedZone = canonicalZoneKey(zone);
        if (!normalizedZone.empty()) e["current_zone"] = normalizedZone;
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
    const std::string normalizedZone = canonicalZoneKey(zone);
    if (!normalizedZone.empty()) e["last_absent_zone"] = normalizedZone;
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
    if (!node.is_object()) return canonicalZoneKey(fallback);
    return canonicalZoneKey(strField(
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
    if (!node.is_object()) return canonicalZoneKey(fallback);
    return canonicalZoneKey(strField(node, "last_seen_zone", extractZoneField(node, fallback)));
}

inline bool zoneMatchesFilter(const std::string& rawZone, const std::string& rawExpectedZone) {
    const std::string expectedZone = canonicalZoneKey(rawExpectedZone);
    if (expectedZone.empty()) return true;
    return canonicalZoneKey(rawZone) == expectedZone;
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

inline long long countLoggedEventsBetween(
    const json& st,
    const std::string& rawEventName,
    const std::string& startIsoUtc,
    const std::string& endIsoUtc,
    const std::string& entityFilter = std::string(),
    const std::string& zoneFilter = std::string())
{
    if (!st.is_object() || !st.contains("events") || !st["events"].is_array()) return 0;
    const std::string eventName = lower(trim(normalizeEventName(rawEventName)));
    long long count = 0;
    for (const auto& item : st["events"]) {
        if (!item.is_object()) continue;
        if (eventRepresentsSyntheticAbsence(st, item)) continue;
        if (!eventName.empty() && lower(trim(strField(item, "event"))) != eventName) continue;
        if (!eventMatchesFilter(st, item, entityFilter)) continue;
        if (!zoneMatchesFilter(extractZoneField(item), zoneFilter)) continue;
        if (!normalizeTsBetweenInclusive(strField(item, "ts_utc"), startIsoUtc, endIsoUtc)) continue;
        ++count;
    }
    return count;
}

inline long long countDistinctLoggedEventEntitiesBetween(
    const json& st,
    const std::string& rawEventName,
    const std::string& startIsoUtc,
    const std::string& endIsoUtc,
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
        if (!normalizeTsBetweenInclusive(strField(item, "ts_utc"), startIsoUtc, endIsoUtc)) continue;
        const std::string entityToken = eventEntityToken(item);
        if (entityToken.empty()) continue;
        seen.insert(lower(entityToken));
    }
    return static_cast<long long>(seen.size());
}

inline std::string promptEventDocIdentityKey(const json& doc) {
    if (!doc.is_object()) return std::string();
    const std::string evidenceKey = trim(strField(doc, "temporal_evidence_key"));
    if (!evidenceKey.empty()) return "key:" + evidenceKey;
    return lower(trim(strField(doc, "event"))) + "|" +
           lower(trim(strField(doc, "entity_id"))) + "|" +
           trim(strField(doc, "ts_utc")) + "|" +
           trim(strField(doc, "timestamp_name")) + "|" +
           trim(strField(doc, "frame_timestamp_in_segment"));
}

inline json makePromptEventDoc(const json& source) {
    if (!source.is_object()) return json();
    json out = json::object();
    const std::string eventName = trim(strField(source, "event", strField(source, "type", strField(source, "event_type"))));
    const std::string entityId = trim(strField(source, "entity_id"));
    const std::string tsUtc = trim(strField(source, "ts_utc", strField(source, "last_evidence_ts_utc", strField(source, "last_seen_ts"))));
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
}

inline json collectLoggedEventDocsBetween(
    const json& st,
    const std::string& rawEventName,
    const std::string& startIsoUtc,
    const std::string& endIsoUtc,
    const std::string& entityFilter = std::string(),
    const std::string& zoneFilter = std::string(),
    int maxItems = 20)
{
    json docs = json::array();
    if (!st.is_object() || !st.contains("events") || !st["events"].is_array()) return docs;

    const std::string eventName = lower(trim(normalizeEventName(rawEventName)));
    std::unordered_set<std::string> seenIdentityKeys;
    for (auto it = st["events"].rbegin(); it != st["events"].rend(); ++it) {
        if (!it->is_object()) continue;
        if (eventRepresentsSyntheticAbsence(st, *it)) continue;
        if (!eventName.empty() && lower(trim(strField(*it, "event"))) != eventName) continue;
        if (!eventMatchesFilter(st, *it, entityFilter)) continue;
        if (!zoneMatchesFilter(extractZoneField(*it), zoneFilter)) continue;

        std::string normalizedTs;
        if (!normalizeTsBetweenInclusive(strField(*it, "ts_utc"), startIsoUtc, endIsoUtc, &normalizedTs)) continue;

        json doc = makePromptEventDoc(*it);
        if (!doc.is_object() || doc.empty()) continue;
        doc["ts_utc"] = normalizedTs;

        const std::string identityKey = promptEventDocIdentityKey(doc);
        if (identityKey.empty() || !seenIdentityKeys.insert(identityKey).second) continue;

        docs.push_back(std::move(doc));
        if (maxItems > 0 && static_cast<int>(docs.size()) >= maxItems) break;
    }

    std::reverse(docs.begin(), docs.end());
    return docs;
}

inline std::string earliestLoggedEventTsBetween(
    const json& st,
    const std::string& rawEventName,
    const std::string& startIsoUtc,
    const std::string& endIsoUtc,
    const std::string& entityFilter = std::string(),
    const std::string& zoneFilter = std::string())
{
    if (!st.is_object() || !st.contains("events") || !st["events"].is_array()) return std::string();
    const std::string eventName = lower(trim(normalizeEventName(rawEventName)));
    std::string earliest;
    for (const auto& item : st["events"]) {
        if (!item.is_object()) continue;
        if (eventRepresentsSyntheticAbsence(st, item)) continue;
        if (!eventName.empty() && lower(trim(strField(item, "event"))) != eventName) continue;
        if (!eventMatchesFilter(st, item, entityFilter)) continue;
        if (!zoneMatchesFilter(extractZoneField(item), zoneFilter)) continue;
        std::string normalizedTs;
        if (!normalizeTsBetweenInclusive(strField(item, "ts_utc"), startIsoUtc, endIsoUtc, &normalizedTs)) continue;
        if (earliest.empty() || normalizedTs < earliest) earliest = normalizedTs;
    }
    return earliest;
}

inline std::string latestLoggedEventTsBetween(
    const json& st,
    const std::string& rawEventName,
    const std::string& startIsoUtc,
    const std::string& endIsoUtc,
    const std::string& entityFilter = std::string(),
    const std::string& zoneFilter = std::string())
{
    if (!st.is_object() || !st.contains("events") || !st["events"].is_array()) return std::string();
    const std::string eventName = lower(trim(normalizeEventName(rawEventName)));
    std::string latest;
    for (const auto& item : st["events"]) {
        if (!item.is_object()) continue;
        if (eventRepresentsSyntheticAbsence(st, item)) continue;
        if (!eventName.empty() && lower(trim(strField(item, "event"))) != eventName) continue;
        if (!eventMatchesFilter(st, item, entityFilter)) continue;
        if (!zoneMatchesFilter(extractZoneField(item), zoneFilter)) continue;
        std::string normalizedTs;
        if (!normalizeTsBetweenInclusive(strField(item, "ts_utc"), startIsoUtc, endIsoUtc, &normalizedTs)) continue;
        if (latest.empty() || normalizedTs > latest) latest = normalizedTs;
    }
    return latest;
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
    const std::string normalizedZone = canonicalZoneKey(zone);
    if (!normalizedZone.empty()) mem["last_seen_zone"] = normalizedZone;

    const json rawIdentityFeatureCandidates =
        extractIdentityFeatureCandidatesFromNode(patch);
    const json structuredIdentityFeatureCandidates =
        filterIdentityFeatureCandidatesForMemory(
            entityTypeHint,
            rawIdentityFeatureCandidates);
    const json derivedIdentitySignatureTraits =
        deriveIdentitySignatureTraitsFromFeatureCandidates(
            structuredIdentityFeatureCandidates,
            entityTypeHint);
    const json derivedIdentityContextTraits =
        deriveIdentityContextTraitsFromFeatureCandidates(rawIdentityFeatureCandidates);
    const json stableTraits = extractStableTraitsFromNode(patch, entityTypeHint);
    const json contextTraits = extractContextTraitsFromNode(patch, entityTypeHint);
    const json explicitIdentitySignatureTraitsRaw =
        patch.contains("identity_signature_traits")
            ? parseTraitsValue(patch["identity_signature_traits"])
            : json::array();
    const json explicitIdentityContextTraitsRaw =
        patch.contains("identity_context_traits")
            ? parseTraitsValue(patch["identity_context_traits"])
            : json::array();
    const json explicitIdentitySignatureTraits =
        curateIdentitySignatureTraits(
            entityTypeHint,
            stableTraits,
            contextTraits,
            (derivedIdentitySignatureTraits.is_array() && !derivedIdentitySignatureTraits.empty())
                ? derivedIdentitySignatureTraits
                : explicitIdentitySignatureTraitsRaw);
    const json explicitIdentityContextTraits =
        curateIdentityContextTraits(
            entityTypeHint,
            stableTraits,
            contextTraits,
            (derivedIdentityContextTraits.is_array() && !derivedIdentityContextTraits.empty())
                ? derivedIdentityContextTraits
                : explicitIdentityContextTraitsRaw);
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

    json mergedStableAttributesRaw = json::array();
    if ((!hasStructuredIdentitySignature || trustExistingMemoryIdentity) &&
        mem.contains("stable_attributes"))
    {
        appendUniqueStringsToArray(mergedStableAttributesRaw, mem["stable_attributes"]);
    }
    if (entityState &&
        (!hasStructuredIdentitySignature || trustExistingEntityIdentity) &&
        entityState->contains("stable_attributes"))
    {
        appendUniqueStringsToArray(mergedStableAttributesRaw, (*entityState)["stable_attributes"]);
    }
    appendUniqueTraitsToArray(mergedStableAttributesRaw, stableTraits);
    if (mergedStableAttributesRaw.size() > 16) {
        mergedStableAttributesRaw.erase(
            mergedStableAttributesRaw.begin() + 16,
            mergedStableAttributesRaw.end());
    }

    json mergedKeyTraitsRaw = json::array();
    if ((!hasStructuredIdentitySignature || trustExistingMemoryIdentity) &&
        mem.contains("key_traits"))
    {
        appendUniqueTraitsToArray(mergedKeyTraitsRaw, mem["key_traits"]);
    }
    if (entityState &&
        (!hasStructuredIdentitySignature || trustExistingEntityIdentity) &&
        entityState->contains("key_traits"))
    {
        appendUniqueTraitsToArray(mergedKeyTraitsRaw, (*entityState)["key_traits"]);
    }
    appendUniqueTraitsToArray(mergedKeyTraitsRaw, stableTraits);
    if (mergedKeyTraitsRaw.size() > 16) {
        mergedKeyTraitsRaw.erase(mergedKeyTraitsRaw.begin() + 16, mergedKeyTraitsRaw.end());
    }

    if (explicitIdentityContextTraits.is_array() && !explicitIdentityContextTraits.empty()) {
        mem["latest_context_traits"] = explicitIdentityContextTraits;
        if (entityState) (*entityState)["latest_context_traits"] = explicitIdentityContextTraits;
    } else {
        mem.erase("latest_context_traits");
        if (entityState) entityState->erase("latest_context_traits");
    }
    mem.erase("scene_brief");
    if (entityState) entityState->erase("scene_brief");

    auto mergeIdentityFeatureCandidates = [&](json target, const json& source) {
        if (!target.is_array()) target = json::array();
        std::unordered_set<std::string> seen;
        for (const auto& item : target) {
            if (!item.is_object()) continue;
            const std::string key =
                lower(trim(strField(item, "text"))) + "|" +
                lower(trim(strField(item, "category"))) + "|" +
                lower(trim(strField(item, "relation_to_target")));
            if (key == "||") continue;
            seen.insert(key);
        }

        const json normalizedSource =
            filterIdentityFeatureCandidatesForMemory(entityTypeHint, source);
        if (normalizedSource.is_array()) {
            for (const auto& item : normalizedSource) {
                if (!item.is_object()) continue;
                const std::string key =
                    lower(trim(strField(item, "text"))) + "|" +
                    lower(trim(strField(item, "category"))) + "|" +
                    lower(trim(strField(item, "relation_to_target")));
                if (key == "||" || !seen.insert(key).second) continue;
                target.push_back(item);
            }
        }

        if (target.size() > 12) {
            target.erase(target.begin() + 12, target.end());
        }
        return target;
    };

    json mergedIdentityFeatureCandidates = json::array();
    if ((!hasStructuredIdentitySignature || trustExistingMemoryIdentity) &&
        mem.contains("identity_feature_candidates"))
    {
        mergedIdentityFeatureCandidates = mergeIdentityFeatureCandidates(
            mergedIdentityFeatureCandidates,
            mem["identity_feature_candidates"]);
    }
    if (entityState &&
        (!hasStructuredIdentitySignature || trustExistingEntityIdentity) &&
        entityState->contains("identity_feature_candidates"))
    {
        mergedIdentityFeatureCandidates = mergeIdentityFeatureCandidates(
            mergedIdentityFeatureCandidates,
            (*entityState)["identity_feature_candidates"]);
    }
    mergedIdentityFeatureCandidates = mergeIdentityFeatureCandidates(
        mergedIdentityFeatureCandidates,
        structuredIdentityFeatureCandidates);
    if (mergedIdentityFeatureCandidates.is_array() &&
        !mergedIdentityFeatureCandidates.empty())
    {
        mem["identity_feature_candidates"] = mergedIdentityFeatureCandidates;
        if (entityState) {
            (*entityState)["identity_feature_candidates"] = mergedIdentityFeatureCandidates;
        }
    } else {
        mem.erase("identity_feature_candidates");
        if (entityState) entityState->erase("identity_feature_candidates");
    }

    json existingIdentitySignatureTraits = json::array();
    if ((!hasStructuredIdentitySignature || trustExistingMemoryIdentity) &&
        mem.contains("identity_signature_traits"))
    {
        appendUniqueStringsToArray(
            existingIdentitySignatureTraits,
            mem["identity_signature_traits"]);
    }
    if (entityState &&
        (!hasStructuredIdentitySignature || trustExistingEntityIdentity) &&
        entityState->contains("identity_signature_traits"))
    {
        appendUniqueStringsToArray(
            existingIdentitySignatureTraits,
            (*entityState)["identity_signature_traits"]);
    }
    json identitySignatureSources = json::array();
    appendUniqueStringsToArray(identitySignatureSources, mergedStableAttributesRaw);
    appendUniqueStringsToArray(identitySignatureSources, mergedKeyTraitsRaw);
    appendUniqueStringsToArray(identitySignatureSources, explicitIdentitySignatureTraits);
    json mergedIdentitySignatureTraits =
        curateIdentitySignatureTraits(
            entityTypeHint,
            identitySignatureSources,
            explicitIdentityContextTraits,
            existingIdentitySignatureTraits);
    if (mergedIdentitySignatureTraits.size() > 16) {
        mergedIdentitySignatureTraits.erase(
            mergedIdentitySignatureTraits.begin() + 16,
            mergedIdentitySignatureTraits.end());
    }
    if (!mergedIdentitySignatureTraits.empty()) {
        mem["identity_signature_traits"] = mergedIdentitySignatureTraits;
        mem["stable_attributes"] = mergedIdentitySignatureTraits;
        mem["key_traits"] = mergedIdentitySignatureTraits;
        updateIdentitySignatureSource(mem);
        if (entityState) {
            (*entityState)["identity_signature_traits"] = mergedIdentitySignatureTraits;
            (*entityState)["stable_attributes"] = mergedIdentitySignatureTraits;
            (*entityState)["key_traits"] = mergedIdentitySignatureTraits;
            updateIdentitySignatureSource(*entityState);
        }
        const std::string curatedSummary =
            buildIdentitySignatureSummary(entityTypeHint, mergedIdentitySignatureTraits);
        if (!curatedSummary.empty()) {
            mem["identity_signature_summary"] = curatedSummary;
            if (entityState) (*entityState)["identity_signature_summary"] = curatedSummary;
        } else {
            mem.erase("identity_signature_summary");
            if (entityState) entityState->erase("identity_signature_summary");
        }
    } else {
        mem.erase("identity_signature_traits");
        mem.erase("stable_attributes");
        mem.erase("key_traits");
        mem.erase("identity_signature_summary");
        mem.erase("identity_signature_source");
        if (entityState) {
            entityState->erase("identity_signature_traits");
            entityState->erase("stable_attributes");
            entityState->erase("key_traits");
            entityState->erase("identity_signature_summary");
            entityState->erase("identity_signature_source");
        }
    }

    const std::string bestDescriptionSource = trim(
        strField(
            patch,
            "description",
            strField(
                mem,
                "description",
                entityState && entityState->contains("description")
                    ? strField(*entityState, "description")
                    : std::string())));
    const std::string curatedDescription =
        curateIdentityDescription(
            entityTypeHint,
            bestDescriptionSource,
            mergedIdentitySignatureTraits);
    if (!curatedDescription.empty()) {
        mem["description"] = curatedDescription;
        if (entityState) (*entityState)["description"] = curatedDescription;
    } else {
        mem.erase("description");
        if (entityState) entityState->erase("description");
    }

    json existingIdentityContextTraits = json::array();
    if (mem.contains("identity_context_traits")) {
        appendUniqueStringsToArray(existingIdentityContextTraits, mem["identity_context_traits"]);
    }
    if (entityState && entityState->contains("identity_context_traits")) {
        appendUniqueStringsToArray(existingIdentityContextTraits, (*entityState)["identity_context_traits"]);
    }
    if (mem.contains("latest_context_traits")) {
        appendUniqueStringsToArray(existingIdentityContextTraits, mem["latest_context_traits"]);
    }
    if (entityState && entityState->contains("latest_context_traits")) {
        appendUniqueStringsToArray(existingIdentityContextTraits, (*entityState)["latest_context_traits"]);
    }
    json mergedIdentityContextTraits =
        curateIdentityContextTraits(
            entityTypeHint,
            identitySignatureSources,
            explicitIdentityContextTraits,
            existingIdentityContextTraits);
    if (mergedIdentityContextTraits.size() > 4) {
        mergedIdentityContextTraits.erase(
            mergedIdentityContextTraits.begin() + 4,
            mergedIdentityContextTraits.end());
    }
    if (!mergedIdentityContextTraits.empty()) {
        mem["identity_context_traits"] = mergedIdentityContextTraits;
        if (entityState) (*entityState)["identity_context_traits"] = mergedIdentityContextTraits;
    } else {
        mem.erase("identity_context_traits");
        if (entityState) entityState->erase("identity_context_traits");
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
    const std::string roundStartTs = segmentStartTs.empty() ? nowTs : segmentStartTs;
    const std::string roundEndTs = segmentEndTs.empty() ? nowTs : segmentEndTs;
    if (trim(strField(st["meta"], "first_round_start_ts_utc")).empty()) {
        st["meta"]["first_round_start_ts_utc"] = roundStartTs;
    }
    st["meta"]["last_round_start_ts_utc"] = roundStartTs;
    st["meta"]["last_round_end_ts_utc"] = roundEndTs;
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

    auto makeIdentityPatchDecisionCandidate = [&](const json& patch,
                                                  const std::string& patchEntityId,
                                                  const std::string& patchEntityHint,
                                                  const std::string& patchZone,
                                                  const std::string& patchTs,
                                                  const json& patchEvidenceRef) {
        TemporalEvidenceCandidate candidate;
        candidate.eventName = "identity_patch";
        candidate.entityId = trim(patchEntityId);
        if (candidate.entityId.empty()) candidate.entityId = trim(patchEntityHint);
        candidate.zone = trim(patchZone);
        candidate.timestampUtcIso = normalizeAcceptedEventTs(patchTs, defaultRoundEventTs);
        if (candidate.timestampUtcIso.empty()) {
            candidate.timestampUtcIso = normalizeFlexibleTs(
                strField(patchEvidenceRef, "ts_utc", strField(patch, "ts_utc")));
        }
        if (candidate.timestampUtcIso.empty()) candidate.timestampUtcIso = nowTs;
        if (patchEvidenceRef.is_object()) {
            candidate.evidenceKey = trim(strField(patchEvidenceRef, "temporal_evidence_key"));
            candidate.frameIndex = intField(patchEvidenceRef, "frame_index", -1);
            candidate.timestampName = trim(strField(patchEvidenceRef, "timestamp_name"));
            candidate.frameTimestampInSegment = trim(strField(patchEvidenceRef, "frame_timestamp_in_segment"));
        }
        return candidate;
    };

    auto tryUpsertIdentityMemoryFromWeakPatch = [&](const json& patch,
                                                    const std::string& patchEntityId,
                                                    const std::string& patchEntityHint,
                                                    const std::string& patchEntityType,
                                                    const std::string& patchZone,
                                                    const std::string& patchTs) -> std::string {
        if (!patchSupportsIdentityMemoryFallback(patch)) return std::string();

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
        if (resolvedEntityId.empty()) return std::string();

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
        return resolvedEntityId;
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
                const std::string weakResolvedEntityId = tryUpsertIdentityMemoryFromWeakPatch(
                    p,
                    patchEntityId,
                    patchEntityHint,
                    patchEntityType,
                    patchZone,
                    patchTs);
                if (!weakResolvedEntityId.empty()) {
                    recordLastRoundCandidateDecision(
                        st,
                        makeIdentityPatchDecisionCandidate(
                            p,
                            patchEntityId,
                            patchEntityHint,
                            patchZone,
                            patchTs,
                            patchEvidenceRef),
                        "accepted_weak_identity_patch",
                        weakResolvedEntityId,
                        nowTs);
                }
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
            if (entityId.empty()) {
                recordLastRoundCandidateDecision(
                    st,
                    makeIdentityPatchDecisionCandidate(
                        p,
                        patchEntityId,
                        patchEntityHint,
                        patchZone,
                        patchTs,
                        patchEvidenceRef),
                    "rejected_missing_entity");
                continue;
            }

            const json traits = extractTraitsFromNode(p);
            const std::string zone = patchZone;
            touchEntity(st, entityId, nowTs, zone, traits, forgetEntityMissingForSeconds);
            applyEntityStateMetadata(entityId, entityHint, patchEntityType, patchEvidenceRef, nowTs);
            roundTouchedEntityIds.insert(entityId);
            roundPositiveEntityIds.insert(entityId);
            upsertIdentityMemory(st, entityId, p, nowTs, zone);
            recordLastRoundCandidateDecision(
                st,
                makeIdentityPatchDecisionCandidate(
                    p,
                    patchEntityId,
                    patchEntityHint,
                    patchZone,
                    patchTs,
                    patchEvidenceRef),
                decision == "new_entity" ? "accepted_new_identity_patch" : "accepted_identity_patch",
                entityId,
                nowTs);

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

inline json buildGlobalVarSlice(const json& st, const json& envelope) {
    const json plan = effectivePlan(envelope);
    json out = json::object();
    if (!st.is_object()) return out;

    const json globalVars =
        st.contains("global_vars") && st["global_vars"].is_object()
            ? st["global_vars"]
            : json::object();
    if (!plan.contains("runtime_variables") || !plan["runtime_variables"].is_array()) {
        return out;
    }

    std::unordered_set<std::string> seenNames;
    for (const auto& rv : plan["runtime_variables"]) {
        if (!rv.is_object()) continue;
        if (lower(trim(strField(rv, "scope"))) != "global") continue;

        const std::string name = trim(strField(rv, "name"));
        if (name.empty()) continue;

        const std::string normalizedName = lower(name);
        if (!seenNames.insert(normalizedName).second) continue;

        if (globalVars.contains(name)) out[name] = globalVars[name];
        else if (rv.contains("init")) out[name] = rv["init"];
    }

    return out;
}

inline json buildConfirmedRefs(const json& envelope,
                               const json& st,
                               const std::string& nowIsoUtc,
                               const std::string& segmentStartTsRaw = std::string(),
                               const std::string& segmentEndTsRaw = std::string())
{
    const json plan = effectivePlan(envelope);
    json refs = json::array();
    if (!st.is_object() || !plan.is_object() || !plan.contains("operators") || !plan["operators"].is_array()) {
        return refs;
    }

    const std::string segmentStartTs = normalizeFlexibleTs(segmentStartTsRaw);
    const std::string segmentEndTs = normalizeFlexibleTs(segmentEndTsRaw);
    std::string cutoffTs = !segmentStartTs.empty() ? segmentStartTs : decisionAnchorUtc(nowIsoUtc, segmentEndTs);
    if (cutoffTs.empty()) cutoffTs = normalizeFlexibleTs(nowIsoUtc);
    if (cutoffTs.empty()) return refs;

    const json meta =
        st.contains("meta") && st["meta"].is_object()
            ? st["meta"]
            : json::object();
    const json operatorState =
        meta.contains("operator_state") && meta["operator_state"].is_object()
            ? meta["operator_state"]
            : json::object();
    const std::string monitoringStartTs = trim(strField(
        meta,
        "first_round_start_ts_utc",
        strField(meta, "last_round_start_ts_utc", cutoffTs)));

    auto valueTypeLabel = [](const json& value) -> std::string {
        if (value.is_boolean()) return "bool";
        if (value.is_number_integer() || value.is_number_unsigned()) return "int";
        if (value.is_number_float()) return "float";
        if (value.is_array()) return "array";
        if (value.is_string()) return "string";
        if (value.is_object()) return "object";
        return "null";
    };

    auto appendRef = [&](const std::string& rawName,
                         const std::string& operatorId,
                         const std::string& operatorType,
                         const std::string& metric,
                         const json& value,
                         const std::string& meaning,
                         const json& source,
                         const json& window,
                         const json& extra = json::object()) {
        json ref = {
            { "name", sanitizeToken(rawName, "confirmed_ref") },
            { "operator_id", operatorId },
            { "operator_type", operatorType },
            { "metric", metric },
            { "value_type", valueTypeLabel(value) },
            { "value", value },
            { "authority", "authoritative_derived_from_accepted_st_events_prior_rounds" },
            { "precedence", "fallback_if_no_explicit_runtime_variable_matches" },
            { "meaning", meaning },
            { "source", source },
            { "window", window }
        };
        if (extra.is_object()) {
            for (auto it = extra.begin(); it != extra.end(); ++it) {
                ref[it.key()] = it.value();
            }
        }
        refs.push_back(std::move(ref));
    };

    auto buildSource = [](const std::string& eventName,
                          const std::string& entityFilter,
                          const std::string& zoneFilter) {
        json source = json::object();
        if (!trim(eventName).empty()) source["event"] = eventName;
        if (!trim(entityFilter).empty()) source["entity_filter"] = entityFilter;
        if (!trim(zoneFilter).empty()) source["zone"] = zoneFilter;
        return source;
    };

    auto buildWindow = [&](const std::string& mode,
                           const std::string& startTs,
                           const std::string& endTs,
                           const json& extra = json::object()) {
        json window = {
            { "mode", mode },
            { "cutoff_utc", cutoffTs }
        };
        if (!startTs.empty()) window["start_utc"] = startTs;
        if (!endTs.empty()) window["end_utc"] = endTs;
        if (extra.is_object()) {
            for (auto it = extra.begin(); it != extra.end(); ++it) {
                window[it.key()] = it.value();
            }
        }
        return window;
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

    auto countEventsBetweenExactEntityId = [&](const std::string& eventName,
                                               const std::string& startTs,
                                               const std::string& endTs,
                                               const std::string& entityId,
                                               const std::string& zoneFilter) -> long long {
        if (!st.contains("events") || !st["events"].is_array()) return 0;
        const std::string normalizedEvent = lower(trim(normalizeEventName(eventName)));
        const std::string targetEntity = trim(entityId);
        long long count = 0;
        for (const auto& item : st["events"]) {
            if (!item.is_object()) continue;
            if (eventRepresentsSyntheticAbsence(st, item)) continue;
            if (!normalizedEvent.empty() && lower(trim(strField(item, "event"))) != normalizedEvent) continue;
            if (!targetEntity.empty() && trim(strField(item, "entity_id")) != targetEntity) continue;
            if (!zoneMatchesFilter(extractZoneField(item), zoneFilter)) continue;
            if (!normalizeTsBetweenInclusive(strField(item, "ts_utc"), startTs, endTs)) continue;
            ++count;
        }
        return count;
    };

    auto countEventsForPrompt = [&](const std::string& eventName,
                                    int windowSeconds,
                                    const std::string& entityFilter,
                                    const std::string& zoneFilter) -> long long {
        if (isPresentEventName(eventName)) {
            if (windowSeconds > 0) {
                return countPresentEntitiesInState(st, cutoffTs, windowSeconds, entityFilter, zoneFilter);
            }
            return countDistinctEventEntities(st, eventName, cutoffTs, 0, entityFilter, zoneFilter);
        }
        if (!st.contains("events") || !st["events"].is_array()) return 0;
        const std::string normalizedEvent = lower(trim(normalizeEventName(eventName)));
        long long count = 0;
        for (const auto& item : st["events"]) {
            if (!item.is_object()) continue;
            if (eventRepresentsSyntheticAbsence(st, item)) continue;
            if (!normalizedEvent.empty() && lower(trim(strField(item, "event"))) != normalizedEvent) continue;
            if (!trim(entityFilter).empty() && !eventMatchesFilter(st, item, entityFilter)) continue;
            if (!zoneMatchesFilter(extractZoneField(item), zoneFilter)) continue;
            if (windowSeconds > 0 && ageSeconds(strField(item, "ts_utc"), cutoffTs) > windowSeconds) continue;
            ++count;
        }
        return count;
    };

    for (const auto& op : plan["operators"]) {
        if (!op.is_object()) continue;

        const std::string operatorType = lower(trim(strField(op, "type")));
        const std::string operatorId = trim(strField(op, "operator_id", operatorType));
        const std::string refPrefix = sanitizeToken(operatorId.empty() ? operatorType : operatorId, "operator");
        const json params = op.value("params", json::object());

        if (operatorType == "count_events_in_window") {
            const int windowSeconds = intField(params, "window_seconds", 0);
            const std::string eventName = strField(params, "event");
            const std::string entityFilter = strField(params, "entity");
            const std::string zoneFilter = extractZoneField(params);
            if (windowSeconds <= 0 || trim(eventName).empty()) continue;

            const std::string windowStartTs = addSecondsIso(cutoffTs, -windowSeconds);
            if (windowStartTs.empty()) continue;

            const long long currentCount = countEventsForPrompt(
                eventName,
                windowSeconds,
                entityFilter,
                zoneFilter);

            appendRef(
                refPrefix + "__prior_current_count",
                operatorId,
                operatorType,
                "prior_current_count",
                json(currentCount),
                "Confirmed count of accepted event '" + eventName +
                    "' before the current batch within the operator window.",
                buildSource(eventName, entityFilter, zoneFilter),
                buildWindow(
                    "sliding_window",
                    windowStartTs,
                    cutoffTs,
                    json{ { "window_seconds", windowSeconds } }),
                json{ { "threshold", intField(params, "threshold", 1) } });
            continue;
        }

        if (operatorType == "seen_n_times_in_window_by_entity") {
            const int threshold = intField(params, "n", 0);
            const int windowSeconds = intField(params, "window_seconds", 0);
            const std::string eventName = strField(params, "event");
            const std::string entityFilter = strField(params, "entity");
            const std::string zoneFilter = extractZoneField(params);
            if (threshold <= 0 || windowSeconds <= 0 || trim(eventName).empty()) continue;

            const std::string windowStartTs = addSecondsIso(cutoffTs, -windowSeconds);
            if (windowStartTs.empty()) continue;

            json entityCounts = json::array();
            struct EntityCountRow {
                std::string entityId;
                long long count = 0;
            };
            std::vector<EntityCountRow> rows;
            for (const auto& entityId : collectKnownMatchingEntityIds(entityFilter)) {
                const long long currentCount = countEventsBetweenExactEntityId(
                    eventName,
                    windowStartTs,
                    cutoffTs,
                    entityId,
                    zoneFilter);
                if (currentCount <= 0) continue;
                rows.push_back(EntityCountRow{ entityId, currentCount });
            }
            std::sort(
                rows.begin(),
                rows.end(),
                [](const EntityCountRow& lhs, const EntityCountRow& rhs) {
                    if (lhs.count != rhs.count) return lhs.count > rhs.count;
                    return lhs.entityId < rhs.entityId;
                });
            for (std::size_t i = 0; i < rows.size() && i < 24; ++i) {
                entityCounts.push_back({
                    { "entity_id", rows[i].entityId },
                    { "current_count", rows[i].count }
                });
            }

            appendRef(
                refPrefix + "__prior_entity_counts",
                operatorId,
                operatorType,
                "prior_entity_counts",
                entityCounts,
                "Confirmed per-entity counts of accepted event '" + eventName +
                    "' before the current batch within the operator window.",
                buildSource(eventName, entityFilter, zoneFilter),
                buildWindow(
                    "sliding_window",
                    windowStartTs,
                    cutoffTs,
                    json{ { "window_seconds", windowSeconds } }),
                json{ { "threshold", threshold } });
            continue;
        }

        if (operatorType == "no_event_for_duration") {
            const int durationSeconds = intField(params, "duration_seconds", 0);
            const std::string eventName = strField(params, "event");
            const std::string entityFilter = strField(params, "entity");
            const std::string zoneFilter = extractZoneField(params);
            if (durationSeconds <= 0 || trim(eventName).empty()) continue;

            const std::string windowStartTs = addSecondsIso(cutoffTs, -durationSeconds);
            if (windowStartTs.empty()) continue;

            const long long currentCount = countEventsForPrompt(
                eventName,
                durationSeconds,
                entityFilter,
                zoneFilter);

            appendRef(
                refPrefix + "__prior_current_count",
                operatorId,
                operatorType,
                "prior_current_count",
                json(currentCount),
                "Confirmed count of accepted event '" + eventName +
                    "' before the current batch within the duration checked by this operator.",
                buildSource(eventName, entityFilter, zoneFilter),
                buildWindow(
                    "sliding_window",
                    windowStartTs,
                    cutoffTs,
                    json{ { "window_seconds", durationSeconds } }),
                json{ { "absence_condition_true", currentCount == 0 } });
            continue;
        }

        if (operatorType == "analyze_events_at_interval") {
            const json schedule = params.value("schedule", json::object());
            const json source = params.value("source", json::object());
            const json analysis = params.value("analysis", json::object());

            const std::string eventName = strField(source, "event");
            const std::string entityFilter = strField(source, "entity");
            const std::string zoneFilter = extractZoneField(source);
            const std::string analysisKind = lower(trim(strField(analysis, "kind")));
            const std::string windowMode = lower(trim(strField(analysis, "window_mode", "cumulative_from_anchor")));
            const std::string anchorMode = lower(trim(strField(schedule, "anchor_mode", "monitoring_start")));
            const int intervalSeconds = intField(schedule, "interval_seconds", 0);
            const int windowSeconds = intField(analysis, "window_seconds", 0);
            const std::string dateLocal = strField(schedule, "date_local");
            const std::string timeLocal = strField(schedule, "time_local");
            const std::string timezone = strField(schedule, "timezone");
            if (trim(eventName).empty() || trim(analysisKind).empty()) continue;

            const json opState =
                operatorState.contains(operatorId) && operatorState[operatorId].is_object()
                    ? operatorState[operatorId]
                    : json::object();

            std::string analysisAnchorTs = trim(strField(opState, "analysis_anchor_ts_utc"));
            std::string firstDueTs = trim(strField(opState, "first_due_ts_utc"));
            std::string horizonEndTs = trim(strField(opState, "horizon_end_ts_utc"));
            std::string scheduledTargetTs = trim(strField(opState, "scheduled_target_ts_utc"));
            bool fixedTimeOverdue =
                opState.contains("fixed_time_local_overdue") &&
                opState["fixed_time_local_overdue"].is_boolean() &&
                opState["fixed_time_local_overdue"].get<bool>();

            if (anchorMode == "fixed_time_local") {
                analysisAnchorTs = monitoringStartTs;
                fixedTimeOverdue = false;
                if (!analysisAnchorTs.empty()) {
                    if (!computeFixedLocalCheckpointUtc(
                            analysisAnchorTs,
                            dateLocal,
                            timeLocal,
                            timezone,
                            scheduledTargetTs))
                    {
                        firstDueTs.clear();
                        scheduledTargetTs.clear();
                    } else {
                        fixedTimeOverdue =
                            !trim(dateLocal).empty() &&
                            scheduledTargetTs < analysisAnchorTs;
                        firstDueTs =
                            fixedTimeOverdue
                                ? (cutoffTs.empty() ? analysisAnchorTs : cutoffTs)
                                : scheduledTargetTs;
                    }
                }
            } else if (analysisAnchorTs.empty() || firstDueTs.empty()) {
                if (anchorMode == "monitoring_start") {
                    analysisAnchorTs = monitoringStartTs;
                    if (!analysisAnchorTs.empty() && intervalSeconds > 0) {
                        firstDueTs = addSecondsIso(analysisAnchorTs, intervalSeconds);
                    }
                } else if (anchorMode == "first_matching_event") {
                    analysisAnchorTs =
                        earliestLoggedEventTsBetween(st, eventName, std::string(), std::string(), entityFilter, zoneFilter);
                    if (!analysisAnchorTs.empty() && intervalSeconds > 0) {
                        firstDueTs = addSecondsIso(analysisAnchorTs, intervalSeconds);
                    }
                }
            }

            if (windowMode == "cumulative_from_anchor" &&
                windowSeconds > 0 &&
                !analysisAnchorTs.empty() &&
                horizonEndTs.empty())
            {
                horizonEndTs = addSecondsIso(analysisAnchorTs, windowSeconds);
            }

            if (analysisAnchorTs.empty()) continue;

            std::string windowStartTs;
            std::string windowEndTs = cutoffTs;
            if (windowMode == "cumulative_from_anchor") {
                windowStartTs = analysisAnchorTs;
                if (!horizonEndTs.empty() && windowEndTs > horizonEndTs) {
                    windowEndTs = horizonEndTs;
                }
            } else {
                const int effectiveWindowSeconds = windowSeconds > 0 ? windowSeconds : intervalSeconds;
                windowStartTs =
                    effectiveWindowSeconds > 0
                        ? addSecondsIso(windowEndTs, -effectiveWindowSeconds)
                        : analysisAnchorTs;
            }

            if (windowStartTs.empty() || windowEndTs.empty() || windowEndTs < windowStartTs) continue;

            json value = nullptr;
            if (analysisKind == "count_occurrences") {
                value = countLoggedEventsBetween(st, eventName, windowStartTs, windowEndTs, entityFilter, zoneFilter);
            } else if (analysisKind == "count_distinct_entities") {
                value = countDistinctLoggedEventEntitiesBetween(st, eventName, windowStartTs, windowEndTs, entityFilter, zoneFilter);
            } else if (analysisKind == "has_any_event") {
                value = countLoggedEventsBetween(st, eventName, windowStartTs, windowEndTs, entityFilter, zoneFilter) > 0;
            } else if (analysisKind == "last_event_age_seconds") {
                const std::string latestTs =
                    latestLoggedEventTsBetween(st, eventName, windowStartTs, windowEndTs, entityFilter, zoneFilter);
                value = latestTs.empty() ? json(nullptr) : json(std::max(0LL, ageSeconds(latestTs, windowEndTs)));
            } else if (analysisKind == "first_event_ts") {
                const std::string firstTs =
                    earliestLoggedEventTsBetween(st, eventName, windowStartTs, windowEndTs, entityFilter, zoneFilter);
                value = firstTs.empty() ? json(nullptr) : json(firstTs);
            } else if (analysisKind == "last_event_ts") {
                const std::string lastTs =
                    latestLoggedEventTsBetween(st, eventName, windowStartTs, windowEndTs, entityFilter, zoneFilter);
                value = lastTs.empty() ? json(nullptr) : json(lastTs);
            } else if (analysisKind == "event_rate") {
                const long long count =
                    countLoggedEventsBetween(st, eventName, windowStartTs, windowEndTs, entityFilter, zoneFilter);
                const long long seconds = (std::max)(1LL, ageSeconds(windowStartTs, windowEndTs));
                value = static_cast<double>(count) / static_cast<double>(seconds);
            } else if (analysisKind == "window_buffer") {
                value = collectLoggedEventDocsBetween(
                    st,
                    eventName,
                    windowStartTs,
                    windowEndTs,
                    entityFilter,
                    zoneFilter,
                    20);
            } else {
                continue;
            }

            json windowExtra = {
                { "window_mode", windowMode }
            };
            if (!analysisAnchorTs.empty()) windowExtra["anchor_utc"] = analysisAnchorTs;
            if (!firstDueTs.empty()) windowExtra["first_due_ts_utc"] = firstDueTs;
            if (!horizonEndTs.empty()) windowExtra["horizon_end_ts_utc"] = horizonEndTs;
            if (!scheduledTargetTs.empty()) windowExtra["scheduled_target_ts_utc"] = scheduledTargetTs;
            if (intervalSeconds > 0) windowExtra["interval_seconds"] = intervalSeconds;
            if (windowSeconds > 0) windowExtra["configured_window_seconds"] = windowSeconds;
            if (!trim(dateLocal).empty()) windowExtra["date_local"] = trim(dateLocal);
            if (!trim(timeLocal).empty()) windowExtra["time_local"] = trim(timeLocal);
            if (!trim(timezone).empty()) windowExtra["timezone"] = trim(timezone);
            if (fixedTimeOverdue) windowExtra["fixed_time_local_overdue"] = true;

            appendRef(
                refPrefix + "__prior_confirmed_value",
                operatorId,
                operatorType,
                "prior_confirmed_value",
                value,
                "Confirmed pre-batch value for analyze_events_at_interval derived from accepted events already committed to temporal state.",
                buildSource(eventName, entityFilter, zoneFilter),
                buildWindow(windowMode, windowStartTs, windowEndTs, windowExtra),
                json{ { "analysis_kind", analysisKind } });
            continue;
        }
    }

    return refs;
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
    json out = json{
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
            { "global_vars_authority", "authoritative_explicit_runtime_variables_from_prior_rounds" },
            { "confirmed_refs_authority", "authoritative_event_derived_refs_from_accepted_st_events_prior_rounds" },
            { "observations_scope", "current_batch_only" },
            { "final_alert_authority", "temporal_engine" }
        }},
        { "expected_output_schema", {
            { "identity_patch", json::array() },
            { "observations", json::array() },
            { "unknown_reasons", json::array() }
        }}
    };
    const json zoneCatalog = normalizeZoneCatalog(envelope);
    if (zoneCatalog.is_array() && !zoneCatalog.empty()) {
        out["zone_catalog"] = zoneCatalog;
    }
    return out;
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
        { "global_vars", buildGlobalVarSlice(st, envelope) },
        { "confirmed_refs", buildConfirmedRefs(envelope, st, nowIsoUtc, segmentStartTsRaw, segmentEndTsRaw) },
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
        "zone_catalog",
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
        << "- global_vars contains authoritative explicit global runtime-variable values from prior rounds.\n"
        << "- state_slice contains authoritative entity-scoped runtime-variable values for the listed entities from prior rounds.\n"
        << "- confirmed_refs contains authoritative refs derived from accepted st.events from prior rounds only. Each ref includes a value, meaning, source filter and window.\n"
        << "- When an explicit runtime-variable value already covers a quantity, prefer that explicit runtime-variable value over confirmed_refs.\n"
        << "- Use confirmed_refs as the prior numeric/event baseline when no explicit runtime-variable already provides that quantity.\n"
        << "- state_slice and identity_memory are authoritative confirmed prior-round context for identity continuity, but they are not complete numeric ledgers.\n"
        << "- If identity_memory contains resolved_identity metadata for an entity, preserve that metadata for the same entity_id; do not replace entity_id with a human name.\n"
        << "- observations and identity_patch MUST describe only what is visible in the current batch or snapshot.\n"
        << "- Do not estimate totals or cumulative baselines by counting state_slice entries or identity_memory rows.\n"
        << "- answer may combine the current batch with confirmed_refs and explicit runtime-variable values when explaining cumulative counts or prior confirmed context.\n"
        << "- alert_condition must reflect only whether the current batch itself satisfies the local alert condition; use prior runtime state only for explanation and identity continuity. The TemporalEngine is the final alert authority.\n"
        << "- Use time_context.now_utc as authoritative current time for temporal decisions.\n"
        << "- If an on-frame clock conflicts with provided temporal fields, prefer provided temporal fields.\n"
        << "- If time_context.segment_start_utc and time_context.segment_end_utc are present, any ts_utc you emit must stay inside that interval.\n"
        << "- identity_patch and observations MUST be arrays of JSON objects (never plain strings).\n"
        << "- For each tracked entity visible in this batch, return identity_patch with entity_id when known, plus entity_key and entity_type whenever they can be inferred from the plan or visible entity, along with a short description, identity_signature_traits, and updated_traits/key_traits.\n"
        << "- When possible, also emit identity_signature_traits as the primary language-agnostic identity field for cross-camera reidentification, focused on strong physical identity cues only.\n"
        << "- If a visible tracked entity or shared hunt target has enough appearance detail for reidentification, do not omit identity_signature_traits just because the identity looks unchanged from prior rounds. Repeat the explicit identity cues that remain visually supported.\n"
        << "- For a visible person, prioritize identity_signature_traits first around intrinsic physical cues such as visible skin tone, hair color/style/length, beard or mustache, tattoos, scars, body build, baldness, or other stable facial/body markers. Treat glasses or jewelry as secondary target-attached cues. Use clothing, bags, and carried objects only as fallback identity cues when stronger intrinsic traits are not clearly visible.\n"
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
        << "- If TEMPORAL_STATIC_CONTEXT_JSON contains zone_catalog, any emitted zone must use one of zone_catalog[*].canonical_zone_key exactly; do not emit the human label instead.\n"
        << "- When the scenario is about entering/leaving places, use entered_zone and left_zone from event_catalog instead of only generic present.\n"
        << "- Do not infer entered_zone just because the entity is already visible in the first frame of the batch; only use entered_zone when the entry is actually visible.\n"
        << "- If an entity leaves and later re-enters in the same batch, emit both events in chronological order.\n"
        << "- Keep identity_signature_traits concise (2-8 items) and focused on durable target-centric identity cues. For people, prefer skin tone, hair color/style/length, beard or mustache, tattoos, scars, and body build before clothing or surrounding context. Use clothing/accessories only as secondary fallback cues when stronger physical traits are unavailable.\n"
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
        bool canDriveLocalAlert =
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
            const std::string eventName = strField(p, "event", strField(p, "anchor_event", "stopped"));
            const std::string zone = extractZoneField(p);
            const std::string withoutEvent = strField(p, "without_event");
            const int seconds = intField(p, "seconds", 0);
            result["entity_filter"] = ent;
            result["event"] = eventName;
            result["without_event"] = withoutEvent;
            result["seconds"] = seconds;
            if (!trim(zone).empty()) result["zone"] = zone;

            if (seconds <= 0 || trim(eventName).empty() || trim(withoutEvent).empty()) {
                unk = true;
            } else {
                json entities = json::array();
                json contributingEvents = json::array();
                std::unordered_set<std::string> seenContributionKeys;
                for (const auto& entityId : collectKnownMatchingEntityIds(ent)) {
                    const bool presentNow = isEntityPresentNow(entityId, zone);
                    const std::string eventTs = latestMatchingEventTsForEntity(eventName, entityId, zone);
                    const std::string releaseTs = latestMatchingEventTsForEntity(withoutEvent, entityId, zone);
                    const bool releasedAfterEvent =
                        !eventTs.empty() && !releaseTs.empty() && releaseTs >= eventTs;
                    const long long eventDurationSeconds =
                        eventTs.empty()
                            ? -1LL
                            : std::max(0LL, ageSeconds(eventTs, nowIsoUtc));
                    const bool qualifies =
                        presentNow &&
                        !eventTs.empty() &&
                        !releasedAfterEvent &&
                        eventDurationSeconds >= seconds;

                    json entityDoc = {
                        { "entity_id", entityId },
                        { "present_now", presentNow },
                        { "qualifies", qualifies },
                        { "released_after_event", releasedAfterEvent }
                    };
                    if (!eventTs.empty()) {
                        entityDoc["event"] = eventName;
                        entityDoc["event_ts"] = eventTs;
                        entityDoc["event_duration_seconds"] = eventDurationSeconds;
                    }
                    if (!releaseTs.empty()) entityDoc["without_event_ts"] = releaseTs;
                    entities.push_back(std::move(entityDoc));

                    if (qualifies) {
                        v = true;
                        appendContributionDocs(
                            contributingEvents,
                            seenContributionKeys,
                            collectEventContributionDocs(
                                eventName,
                                0,
                                entityId,
                                1,
                                zone,
                                true));
                        summaryParts.push_back(
                            entityId + " maintained " + eventName + " for " + std::to_string(seconds) +
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
        } else if (typ == "analyze_events_at_interval") {
            const json normalizedParams = normalizeAnalyzeEventsAtIntervalParams(p);
            const json schedule = normalizedParams.value("schedule", json::object());
            const json source = normalizedParams.value("source", json::object());
            const json analysis = normalizedParams.value("analysis", json::object());
            const json decision = normalizedParams.value("decision", json::object());
            const json output = normalizedParams.value("output", json::object());

            const std::string scheduleMode =
                normalizeAnalyzeIntervalScheduleModeToken(strField(schedule, "mode", "once"));
            const std::string anchorMode =
                normalizeAnalyzeIntervalAnchorModeToken(
                    strField(schedule, "anchor_mode", "monitoring_start"));
            const std::string catchUpMode =
                normalizeAnalyzeIntervalCatchUpModeToken(
                    strField(schedule, "catch_up_mode", "latest_due_only"));
            const int intervalSeconds = intField(schedule, "interval_seconds", 0);
            const std::string dateLocal = trim(strField(schedule, "date_local"));
            const std::string timeLocal = trim(strField(schedule, "time_local"));
            const std::string timezone = trim(strField(schedule, "timezone"));
            const std::string eventName = strField(source, "event");
            const std::string ent = strField(source, "entity");
            const std::string zone = extractZoneField(source);
            const std::string analysisKind =
                normalizeAnalyzeIntervalKindToken(strField(analysis, "kind", "count_occurrences"));
            const std::string windowMode =
                normalizeAnalyzeIntervalWindowModeToken(
                    strField(analysis, "window_mode", "bucket"));
            const int windowSeconds = std::max(0, intField(analysis, "window_seconds", 0));
            const std::string decisionMode =
                normalizeAnalyzeIntervalDecisionModeToken(
                    strField(decision, "mode", "alert_if_true"));
            const std::string decisionOp =
                normalizeAnalyzeIntervalDecisionOpToken(strField(decision, "op"));
            const std::string summaryLabel = trim(strField(output, "summary_label", eventName));

            bool includeExpectedValue = false;
            bool includeDelta = false;
            boolFieldAny(output, { "include_expected_value" }, includeExpectedValue);
            boolFieldAny(output, { "include_delta" }, includeDelta);

            canDriveLocalAlert = canDriveLocalAlert && decisionMode != "report_only";
            result["event"] = eventName;
            result["entity_filter"] = ent;
            result["analysis_kind"] = analysisKind;
            result["window_mode"] = windowMode;
            result["schedule_mode"] = scheduleMode;
            result["anchor_mode"] = anchorMode;
            result["decision_mode"] = decisionMode;
            if (!decisionOp.empty()) result["decision_op"] = decisionOp;
            if (!trim(zone).empty()) result["zone"] = zone;
            if (intervalSeconds > 0) result["interval_seconds"] = intervalSeconds;
            if (windowSeconds > 0) result["window_seconds"] = windowSeconds;
            if (!catchUpMode.empty()) result["catch_up_mode"] = catchUpMode;
            if (!dateLocal.empty()) result["date_local"] = dateLocal;
            if (!timeLocal.empty()) result["time_local"] = timeLocal;
            if (!timezone.empty()) result["timezone"] = timezone;
            if (!summaryLabel.empty()) result["summary_label"] = summaryLabel;

            if (!isAllowedAnalyzeIntervalScheduleMode(scheduleMode) ||
                !isAllowedAnalyzeIntervalAnchorMode(anchorMode) ||
                !isAllowedAnalyzeIntervalCatchUpMode(catchUpMode) ||
                !isAllowedAnalyzeIntervalKind(analysisKind) ||
                !isAllowedAnalyzeIntervalWindowMode(windowMode) ||
                !isAllowedAnalyzeIntervalDecisionMode(decisionMode))
            {
                unk = true;
            }
            else if (trim(eventName).empty()) {
                unk = true;
            }
            else {
                const bool needsDecisionEvaluation = decisionMode != "report_only";
                if (needsDecisionEvaluation && !isAllowedAnalyzeIntervalDecisionOp(decisionOp)) {
                    unk = true;
                }
            }

            if (!unk) {
                const std::string opStateKey = opId.empty() ? typ : opId;
                json& opState = operatorState[opStateKey];
                if (!opState.is_object()) opState = json::object();
                if (!opState.contains("finalized") || !opState["finalized"].is_boolean()) {
                    opState["finalized"] = false;
                }

                const std::string normalizedNowTs = normalizeFlexibleTs(nowIsoUtc);
                const std::string monitoringStartTs = trim(strField(
                    st["meta"],
                    "first_round_start_ts_utc",
                    strField(st["meta"], "last_round_start_ts_utc", normalizedNowTs)));

                auto describeScalarValue = [&](const json& node) -> std::string {
                    if (node.is_boolean()) return node.get<bool>() ? "true" : "false";
                    if (node.is_number_integer()) return std::to_string(node.get<long long>());
                    if (node.is_number_unsigned()) return std::to_string(node.get<unsigned long long>());
                    if (node.is_number_float()) {
                        std::ostringstream oss;
                        oss << std::fixed << std::setprecision(3) << node.get<double>();
                        std::string out = oss.str();
                        while (out.size() > 2 && out.back() == '0' && out[out.size() - 2] != '.') out.pop_back();
                        if (!out.empty() && out.back() == '.') out.pop_back();
                        return out;
                    }
                    if (node.is_string()) return node.get<std::string>();
                    if (node.is_array()) return std::to_string(node.size()) + " items";
                    if (node.is_object()) return node.dump();
                    return "null";
                };
                auto renderAnalyzeIntervalSummary = [&](const json& checkpoint,
                                                        const std::string& latestDueTs,
                                                        std::size_t dueCount) -> std::string {
                    const std::string analysisValueText =
                        describeScalarValue(checkpoint.value("analysis_value", json(nullptr)));
                    const std::string expectedValueText =
                        checkpoint.contains("expected_value")
                            ? describeScalarValue(checkpoint["expected_value"])
                            : std::string();
                    const bool hasDeficit = checkpoint.contains("deficit");
                    const bool hasDelta = checkpoint.contains("delta");
                    const std::string deltaValueText =
                        hasDeficit
                            ? describeScalarValue(checkpoint["deficit"])
                            : (hasDelta ? describeScalarValue(checkpoint["delta"]) : std::string());
                    std::string renderedLabel = trim(summaryLabel.empty() ? eventName : summaryLabel);
                    bool usedTemplate = false;
                    if (!renderedLabel.empty()) {
                        usedTemplate =
                            replaceWholeToken(renderedLabel, "X", analysisValueText) || usedTemplate;
                        if (!expectedValueText.empty()) {
                            usedTemplate =
                                replaceWholeToken(renderedLabel, "EXPECTED", expectedValueText) || usedTemplate;
                        }
                        if (!deltaValueText.empty()) {
                            usedTemplate =
                                replaceWholeToken(renderedLabel, "Y", deltaValueText) || usedTemplate;
                        }
                    }
                    if (usedTemplate) {
                        return renderedLabel;
                    }

                    std::ostringstream summary;
                    summary << renderedLabel << " = " << analysisValueText;
                    if (includeExpectedValue && !expectedValueText.empty()) {
                        summary << "; expected=" << expectedValueText;
                    }
                    if (includeDelta && !deltaValueText.empty()) {
                        summary << (hasDeficit ? "; deficit=" : "; delta=") << deltaValueText;
                    }
                    if (anchorMode == "fixed_time_local" && !timeLocal.empty()) {
                        summary << " at local ";
                        if (!dateLocal.empty()) summary << dateLocal << " ";
                        summary << timeLocal;
                        if (!timezone.empty()) summary << " " << timezone;
                        if (checkpoint.contains("fixed_time_local_overdue") &&
                            checkpoint["fixed_time_local_overdue"].is_boolean() &&
                            checkpoint["fixed_time_local_overdue"].get<bool>())
                        {
                            summary << " (scheduled time already passed; evaluated now)";
                        }
                    } else if (!latestDueTs.empty()) {
                        summary << " at " << latestDueTs;
                    }
                    if (dueCount > 1) {
                        summary << " (" << dueCount << " checkpoints due)";
                    }
                    return summary.str();
                };

                auto nodeTruthy = [&](const json& node) -> bool {
                    if (node.is_null()) return false;
                    bool parsed = false;
                    if (tryParseBoolValue(node, parsed)) return parsed;
                    if (node.is_string()) return !trim(node.get<std::string>()).empty();
                    if (node.is_array()) return !node.empty();
                    if (node.is_object()) return !node.empty();
                    return false;
                };

                auto extractNumericNode = [&](const json& node, double& outValue) -> bool {
                    if (node.is_number()) {
                        outValue = node.get<double>();
                        return true;
                    }
                    bool parsedBool = false;
                    if (tryParseBoolValue(node, parsedBool)) {
                        outValue = parsedBool ? 1.0 : 0.0;
                        return true;
                    }
                    if (node.is_string()) {
                        try {
                            outValue = std::stod(node.get<std::string>());
                            return true;
                        } catch (...) {
                        }
                    }
                    return false;
                };

                auto collectMatchingEventsBetweenDocs = [&](const std::string& startTs,
                                                            const std::string& endTs,
                                                            int maxItems = 20) -> json {
                    json docs = json::array();
                    std::unordered_set<std::string> seenContributionKeys;
                    if (!st.contains("events") || !st["events"].is_array()) return docs;
                    const std::string normalizedEvent = lower(trim(normalizeEventName(eventName)));
                    for (auto it = st["events"].rbegin(); it != st["events"].rend(); ++it) {
                        if (!it->is_object()) continue;
                        if (eventRepresentsSyntheticAbsence(st, *it)) continue;
                        if (!normalizedEvent.empty() &&
                            lower(trim(strField(*it, "event"))) != normalizedEvent)
                        {
                            continue;
                        }
                        if (!trim(ent).empty() && !eventMatchesFilter(st, *it, ent)) continue;
                        if (!zoneMatchesFilter(extractZoneField(*it), zone)) continue;
                        std::string normalizedTs;
                        if (!normalizeTsBetweenInclusive(strField(*it, "ts_utc"), startTs, endTs, &normalizedTs)) {
                            continue;
                        }
                        json doc = makeContributionDoc(*it, trim(ent), eventName);
                        if (!doc.is_object() || doc.empty()) continue;
                        doc["ts_utc"] = normalizedTs;
                        appendContributionDoc(docs, seenContributionKeys, doc);
                        if (maxItems > 0 && static_cast<int>(docs.size()) >= maxItems) break;
                    }
                    std::reverse(docs.begin(), docs.end());
                    return docs;
                };

                auto computeAnalysisValue = [&](const std::string& startTs,
                                                const std::string& endTs,
                                                json& outContributingEvents) -> json {
                    outContributingEvents = collectMatchingEventsBetweenDocs(
                        startTs,
                        endTs,
                        analysisKind == "window_buffer" ? 50 : 20);
                    if (analysisKind == "count_occurrences") {
                        return json(countLoggedEventsBetween(st, eventName, startTs, endTs, ent, zone));
                    }
                    if (analysisKind == "count_distinct_entities") {
                        return json(countDistinctLoggedEventEntitiesBetween(st, eventName, startTs, endTs, ent, zone));
                    }
                    if (analysisKind == "has_any_event") {
                        return json(countLoggedEventsBetween(st, eventName, startTs, endTs, ent, zone) > 0);
                    }
                    if (analysisKind == "last_event_age_seconds") {
                        const std::string latestTs =
                            latestLoggedEventTsBetween(st, eventName, startTs, endTs, ent, zone);
                        return latestTs.empty() ? json(nullptr) : json(std::max(0LL, ageSeconds(latestTs, endTs)));
                    }
                    if (analysisKind == "first_event_ts") {
                        const std::string firstTs =
                            earliestLoggedEventTsBetween(st, eventName, startTs, endTs, ent, zone);
                        return firstTs.empty() ? json(nullptr) : json(firstTs);
                    }
                    if (analysisKind == "last_event_ts") {
                        const std::string lastTs =
                            latestLoggedEventTsBetween(st, eventName, startTs, endTs, ent, zone);
                        return lastTs.empty() ? json(nullptr) : json(lastTs);
                    }
                    if (analysisKind == "event_rate") {
                        const long long count =
                            countLoggedEventsBetween(st, eventName, startTs, endTs, ent, zone);
                        const long long seconds = (std::max)(1LL, ageSeconds(startTs, endTs));
                        return json(static_cast<double>(count) / static_cast<double>(seconds));
                    }
                    if (analysisKind == "window_buffer") {
                        return outContributingEvents;
                    }
                    return json(nullptr);
                };

                auto evaluateDecisionOnValue = [&](const json& analysisValue,
                                                   json& checkpoint,
                                                   bool& conditionTrue,
                                                   bool& conditionKnown) {
                    conditionTrue = false;
                    conditionKnown = decisionMode == "report_only";
                    if (decisionMode == "report_only") return;

                    checkpoint["decision_op"] = decisionOp;
                    if (decisionOp == "is_true") {
                        conditionKnown = true;
                        conditionTrue = nodeTruthy(analysisValue);
                        return;
                    }
                    if (decisionOp == "is_false") {
                        conditionKnown = true;
                        conditionTrue = !nodeTruthy(analysisValue);
                        return;
                    }

                    double actual = 0.0;
                    if (!extractNumericNode(analysisValue, actual)) {
                        conditionKnown = false;
                        return;
                    }

                    checkpoint["actual_value_numeric"] = actual;
                    if (decisionOp == "between" || decisionOp == "outside") {
                        const double minValue = dblField(decision, "min", 0.0);
                        const double maxValue = dblField(decision, "max", 0.0);
                        checkpoint["expected_min"] = minValue;
                        checkpoint["expected_max"] = maxValue;
                        conditionKnown = true;
                        const bool inside = actual >= minValue && actual <= maxValue;
                        conditionTrue = decisionOp == "between" ? inside : !inside;
                        return;
                    }

                    const double expectedValue = dblField(decision, "value", 0.0);
                    checkpoint["expected_value"] = expectedValue;
                    const double delta = actual - expectedValue;
                    checkpoint["delta"] = delta;
                    if (actual < expectedValue) checkpoint["deficit"] = expectedValue - actual;
                    if (actual > expectedValue) checkpoint["surplus"] = actual - expectedValue;
                    conditionKnown = true;
                    if (decisionOp == "<") conditionTrue = actual < expectedValue;
                    else if (decisionOp == "<=") conditionTrue = actual <= expectedValue;
                    else if (decisionOp == ">") conditionTrue = actual > expectedValue;
                    else if (decisionOp == ">=") conditionTrue = actual >= expectedValue;
                    else if (decisionOp == "==") conditionTrue = actual == expectedValue;
                    else if (decisionOp == "!=") conditionTrue = actual != expectedValue;
                    else conditionKnown = false;
                };

                std::string analysisAnchorTs = trim(strField(opState, "analysis_anchor_ts_utc"));
                std::string firstDueTs = trim(strField(opState, "first_due_ts_utc"));
                std::string horizonEndTs = trim(strField(opState, "horizon_end_ts_utc"));
                std::string scheduledTargetTs = trim(strField(opState, "scheduled_target_ts_utc"));
                bool fixedTimeOverdue =
                    opState.contains("fixed_time_local_overdue") &&
                    opState["fixed_time_local_overdue"].is_boolean() &&
                    opState["fixed_time_local_overdue"].get<bool>();

                if (anchorMode == "fixed_time_local") {
                    analysisAnchorTs = monitoringStartTs;
                    fixedTimeOverdue = false;
                    if (!computeFixedLocalCheckpointUtc(
                            monitoringStartTs,
                            dateLocal,
                            timeLocal,
                            timezone,
                            scheduledTargetTs))
                    {
                        firstDueTs.clear();
                        scheduledTargetTs.clear();
                        fixedTimeOverdue = false;
                        unk = true;
                        result["reason"] = "operator_fixed_time_local_unsupported";
                    } else {
                        fixedTimeOverdue =
                            !dateLocal.empty() &&
                            !analysisAnchorTs.empty() &&
                            scheduledTargetTs < analysisAnchorTs;
                        firstDueTs = fixedTimeOverdue ? normalizedNowTs : scheduledTargetTs;
                    }
                } else if (analysisAnchorTs.empty() || firstDueTs.empty()) {
                    if (anchorMode == "monitoring_start") {
                        analysisAnchorTs = monitoringStartTs;
                        if (intervalSeconds > 0) firstDueTs = addSecondsIso(analysisAnchorTs, intervalSeconds);
                    } else if (anchorMode == "first_matching_event") {
                        analysisAnchorTs =
                            earliestLoggedEventTsBetween(st, eventName, std::string(), std::string(), ent, zone);
                        if (!analysisAnchorTs.empty() && intervalSeconds > 0) {
                            firstDueTs = addSecondsIso(analysisAnchorTs, intervalSeconds);
                        }
                    }
                }
                if (!analysisAnchorTs.empty()) opState["analysis_anchor_ts_utc"] = analysisAnchorTs;
                if (!firstDueTs.empty()) opState["first_due_ts_utc"] = firstDueTs;
                if (!scheduledTargetTs.empty()) opState["scheduled_target_ts_utc"] = scheduledTargetTs;
                if (anchorMode == "fixed_time_local") opState["fixed_time_local_overdue"] = fixedTimeOverdue;

                if (!unk && windowMode == "cumulative_from_anchor" &&
                    windowSeconds > 0 && !analysisAnchorTs.empty())
                {
                    horizonEndTs = addSecondsIso(analysisAnchorTs, windowSeconds);
                    if (!horizonEndTs.empty()) opState["horizon_end_ts_utc"] = horizonEndTs;
                }

                result["analysis_anchor_ts_utc"] = analysisAnchorTs;
                result["first_due_ts_utc"] = firstDueTs;
                if (!horizonEndTs.empty()) result["horizon_end_ts_utc"] = horizonEndTs;
                if (!scheduledTargetTs.empty()) result["scheduled_target_ts_utc"] = scheduledTargetTs;
                if (fixedTimeOverdue) result["fixed_time_local_overdue"] = true;

                const bool alreadyFinalized =
                    opState.contains("finalized") &&
                    opState["finalized"].is_boolean() &&
                    opState["finalized"].get<bool>();
                result["finalized"] = alreadyFinalized;

                if (!unk) {
                    if (analysisAnchorTs.empty() || firstDueTs.empty()) {
                        result["anchor_pending"] = true;
                        result["checkpoint_due"] = false;
                    }
                    else if (alreadyFinalized) {
                        result["checkpoint_due"] = false;
                    }
                    else {
                        const std::string lastEmittedDueTs = trim(strField(opState, "last_emitted_due_ts_utc"));
                        std::vector<std::string> dueTimes;
                        if (scheduleMode == "once") {
                            if (firstDueTs <= normalizedNowTs &&
                                (lastEmittedDueTs.empty() || firstDueTs > lastEmittedDueTs))
                            {
                                dueTimes.push_back(firstDueTs);
                            }
                        } else {
                            std::string dueTs = firstDueTs;
                            int guard = 0;
                            while (!dueTs.empty() && dueTs <= normalizedNowTs && guard < 4096) {
                                if ((horizonEndTs.empty() || dueTs <= horizonEndTs) &&
                                    (lastEmittedDueTs.empty() || dueTs > lastEmittedDueTs))
                                {
                                    dueTimes.push_back(dueTs);
                                }
                                if (intervalSeconds <= 0) break;
                                const std::string nextDueTs = addSecondsIso(dueTs, intervalSeconds);
                                if (nextDueTs.empty() || nextDueTs <= dueTs) break;
                                dueTs = nextDueTs;
                                ++guard;
                            }
                            if (!horizonEndTs.empty() &&
                                horizonEndTs <= normalizedNowTs &&
                                (lastEmittedDueTs.empty() || horizonEndTs > lastEmittedDueTs))
                            {
                                if (dueTimes.empty() || dueTimes.back() < horizonEndTs) {
                                    dueTimes.push_back(horizonEndTs);
                                }
                            }
                        }

                        if (catchUpMode == "latest_due_only" && dueTimes.size() > 1) {
                            dueTimes = { dueTimes.back() };
                        }

                        result["checkpoint_due"] = !dueTimes.empty();
                        result["due_count"] = static_cast<int>(dueTimes.size());
                        if (!dueTimes.empty()) {
                            json checkpoints = json::array();
                            bool shouldReport = false;
                            bool anyConditionTrue = false;
                            std::string latestDueTs;
                            json latestCheckpoint = json::object();

                            for (const auto& dueTs : dueTimes) {
                                std::string windowStartTs;
                                std::string windowEndTs = dueTs;
                                if (windowMode == "cumulative_from_anchor") {
                                    windowStartTs = analysisAnchorTs;
                                    if (!horizonEndTs.empty() && windowEndTs > horizonEndTs) {
                                        windowEndTs = horizonEndTs;
                                    }
                                } else {
                                    const int effectiveWindowSeconds =
                                        windowSeconds > 0 ? windowSeconds : intervalSeconds;
                                    windowStartTs =
                                        effectiveWindowSeconds > 0
                                            ? addSecondsIso(windowEndTs, -effectiveWindowSeconds)
                                            : analysisAnchorTs;
                                }

                                if (windowStartTs.empty() ||
                                    windowEndTs.empty() ||
                                    windowEndTs < windowStartTs)
                                {
                                    unk = true;
                                    break;
                                }

                                json checkpoint = {
                                    { "checkpoint_end_ts_utc", dueTs },
                                    { "window_start_ts_utc", windowStartTs },
                                    { "window_end_ts_utc", windowEndTs },
                                    { "analysis_kind", analysisKind }
                                };
                                if (!scheduledTargetTs.empty()) {
                                    checkpoint["scheduled_target_ts_utc"] = scheduledTargetTs;
                                }
                                if (fixedTimeOverdue) checkpoint["fixed_time_local_overdue"] = true;
                                json contributingEvents = json::array();
                                const json analysisValue =
                                    computeAnalysisValue(windowStartTs, windowEndTs, contributingEvents);
                                checkpoint["analysis_value"] = analysisValue;
                                if (contributingEvents.is_array() && !contributingEvents.empty() &&
                                    analysisKind != "window_buffer")
                                {
                                    checkpoint["contributing_events"] = contributingEvents;
                                }

                                bool checkpointConditionTrue = false;
                                bool checkpointConditionKnown = decisionMode == "report_only";
                                evaluateDecisionOnValue(
                                    analysisValue,
                                    checkpoint,
                                    checkpointConditionTrue,
                                    checkpointConditionKnown);
                                checkpoint["condition_evaluable"] = checkpointConditionKnown;
                                if (checkpointConditionKnown) checkpoint["condition_true"] = checkpointConditionTrue;
                                else if (decisionMode != "report_only") {
                                    unk = true;
                                    checkpoint["condition_true"] = "unknown";
                                }

                                checkpoints.push_back(checkpoint);
                                latestDueTs = dueTs;
                                latestCheckpoint = checkpoint;
                                if (decisionMode == "report_only" ||
                                    decisionMode == "report_and_alert_if_true")
                                {
                                    shouldReport = true;
                                }
                                if ((decisionMode == "alert_if_true" ||
                                     decisionMode == "report_and_alert_if_true") &&
                                    checkpointConditionTrue)
                                {
                                    anyConditionTrue = true;
                                }
                            }

                            if (!unk) {
                                result["checkpoints"] = checkpoints;
                                if (latestCheckpoint.is_object() && !latestCheckpoint.empty()) {
                                    result["latest_checkpoint"] = latestCheckpoint;
                                    if (latestCheckpoint.contains("analysis_value")) {
                                        result["current_value"] = latestCheckpoint["analysis_value"];
                                    }
                                    if (latestCheckpoint.contains("condition_true")) {
                                        result["condition_true"] = latestCheckpoint["condition_true"];
                                    }
                                    if (latestCheckpoint.contains("contributing_events")) {
                                        result["contributing_events"] =
                                            latestCheckpoint["contributing_events"];
                                    }
                                }

                                opState["last_emitted_due_ts_utc"] = latestDueTs;
                                opState["last_evaluated_ts_utc"] = normalizedNowTs;
                                if (scheduleMode == "once" ||
                                    (!horizonEndTs.empty() && latestDueTs >= horizonEndTs))
                                {
                                    opState["finalized"] = true;
                                    result["finalized"] = true;
                                }

                                if (shouldReport) r.report = true;
                                v = anyConditionTrue;

                                if (shouldReport || v) {
                                    summaryParts.push_back(
                                        renderAnalyzeIntervalSummary(
                                            latestCheckpoint,
                                            latestDueTs,
                                            dueTimes.size()));
                                }
                            }
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

#include "PairingClient.h"

#include <fstream>
#include <stdexcept>
#include <curl/curl.h>
#include <nlohmann/json.hpp>
#include "../logging/Logging.h"
#include "SecureLocalStore.h"

#include <ctime>
#include <algorithm>
#include <cctype>

#include "../platform/platform_common.h"
#include "../platform/platform_secure_store.h"

using json = nlohmann::json;

static size_t WriteCallback(void* contents, size_t size, size_t nmemb, void* userp) {
    ((std::string*)userp)->append((char*)contents, size * nmemb);
    return size * nmemb;
}

static std::string TrimAscii(const std::string& input) {
    size_t start = 0;
    while (start < input.size() && std::isspace(static_cast<unsigned char>(input[start]))) {
        ++start;
    }
    size_t end = input.size();
    while (end > start && std::isspace(static_cast<unsigned char>(input[end - 1]))) {
        --end;
    }
    return input.substr(start, end - start);
}

static bool LooksLikeProtectedBlob(const std::string& input) {
    return perceptrum::platform::IsWindowsProtectedBlob(TrimAscii(input));
}

static std::string DetectMachineTimezoneForPairing() {
    return perceptrum::platform::DetectLocalTimezoneIana();
}

static constexpr const char* kPairedTimezoneFilename = "paired_timezone.txt";
static constexpr const char* kExeTokenFilename = "exe_token.txt";
static constexpr const char* kClientIdFilename = "client_id.txt";
static constexpr const char* kExeIdFilename = "exe_id.txt";
static constexpr const char* kProvisionedExeTokenEnv = "APP_PROVISIONED_EXE_TOKEN";
static constexpr const char* kProvisionedClientIdEnv = "APP_PROVISIONED_CLIENT_ID";
static constexpr const char* kProvisionedExeIdEnv = "APP_PROVISIONED_EXE_ID";
static constexpr const char* kProvisionedTimezoneEnv = "APP_PROVISIONED_TIMEZONE";

// ctor
PairingClient::PairingClient(const std::string& baseUrl)
    : baseUrl_(baseUrl) {
}

// simple loadSavedToken implementation (use what you already have if it's different)
bool PairingClient::loadSavedToken(std::string& exeTokenOut, std::string& clientIdOut) {
    const std::string provisionedExeToken =
        TrimAscii(perceptrum::platform::ReadEnvVar(kProvisionedExeTokenEnv));
    const std::string provisionedClientId =
        TrimAscii(perceptrum::platform::ReadEnvVar(kProvisionedClientIdEnv));
    const std::string provisionedExeId =
        TrimAscii(perceptrum::platform::ReadEnvVar(kProvisionedExeIdEnv));
    const std::string provisionedTimezone =
        TrimAscii(perceptrum::platform::ReadEnvVar(kProvisionedTimezoneEnv));
    if (!provisionedExeToken.empty() && !provisionedClientId.empty()) {
        if (LooksLikeProtectedBlob(provisionedExeToken) || LooksLikeProtectedBlob(provisionedClientId)) {
            Logger::instance().logDebug(
                "agent",
                "PairingClient::loadSavedToken: provisioned env session looks encrypted; ignoring"
            );
        } else {
            securelocal::WriteProtectedLocalText(kExeTokenFilename, provisionedExeToken);
            securelocal::WriteProtectedLocalText(kClientIdFilename, provisionedClientId);
            if (!provisionedExeId.empty()) {
                securelocal::WriteProtectedLocalText(kExeIdFilename, provisionedExeId);
            }
            if (!provisionedTimezone.empty()) {
                std::ofstream timezoneFile(kPairedTimezoneFilename, std::ios::trunc);
                if (timezoneFile.is_open()) {
                    timezoneFile << provisionedTimezone;
                }
            }

            exeTokenOut = provisionedExeToken;
            clientIdOut = provisionedClientId;
            return true;
        }
    }

    auto exeToken = securelocal::ReadProtectedLocalText(kExeTokenFilename);
    auto clientId = securelocal::ReadProtectedLocalText(kClientIdFilename);
    if (!exeToken.has_value() || !clientId.has_value()) return false;

    exeTokenOut = TrimAscii(*exeToken);
    clientIdOut = TrimAscii(*clientId);
    if (LooksLikeProtectedBlob(exeTokenOut) || LooksLikeProtectedBlob(clientIdOut)) {
        Logger::instance().logDebug(
            "agent",
            "PairingClient::loadSavedToken: protected local session looks encrypted/stale; waiting for reprovision"
        );
        exeTokenOut.clear();
        clientIdOut.clear();
        return false;
    }
    return !exeTokenOut.empty() && !clientIdOut.empty();
}

std::optional<PairingResult> PairingClient::pairWithCode(const std::string& pairCode,
    std::string& errorOut)
{
    errorOut.clear();

    CURL* curl = curl_easy_init();
    if (!curl) {
        errorOut = "curl_easy_init failed";
        Logger::instance().logDebug("agent", "PairingClient::pairWithCode failed: curl_easy_init failed");
        return std::nullopt;
    }

    std::string response;
    curl_easy_setopt(curl, CURLOPT_URL, (baseUrl_ + "/api/pairing/pair").c_str());

    curl_easy_setopt(curl, CURLOPT_POST, 1L);

    std::string exeId = loadOrCreateExeId();

    const std::string pairedTimezone = DetectMachineTimezoneForPairing();

    json bodyJson = {
        { "pair_code", pairCode },
        { "exe_id",    exeId    },
        { "timezone_iana", pairedTimezone }
    };
    std::string body = bodyJson.dump();
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, (long)body.size());

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);

    CURLcode res = curl_easy_perform(curl);

    long httpCode = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpCode);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) {
        errorOut = curl_easy_strerror(res);
        Logger::instance().logDebug(
            "agent",
            std::string("PairingClient::pairWithCode failed: curl error=") + errorOut
        );
        return std::nullopt;
    }

    try {
        auto j = json::parse(response);

        if (httpCode >= 400) {
            // backend error
            if (j.contains("error") && j["error"].is_string()) {
                errorOut = j["error"].get<std::string>();
            }
            else {
                errorOut = "Server returned error " + std::to_string(httpCode);
            }
            Logger::instance().logDebug(
                "agent",
                std::string("PairingClient::pairWithCode failed: HTTP ") +
                std::to_string(httpCode) + " error=" + errorOut
            );
            return std::nullopt;
        }

        std::string exeToken = j.at("exe_token").get<std::string>();
        std::string clientId = j.at("client_id").get<std::string>();

        if (!securelocal::WriteProtectedLocalText(kExeTokenFilename, exeToken) ||
            !securelocal::WriteProtectedLocalText(kClientIdFilename, clientId))
        {
            errorOut = "Failed to store local pairing secrets";
            Logger::instance().logDebug(
                "agent",
                "PairingClient::pairWithCode failed: could not persist protected local secrets"
            );
            return std::nullopt;
        }
        if (!pairedTimezone.empty()) {
            std::ofstream f(kPairedTimezoneFilename);
            if (f.is_open()) {
                f << pairedTimezone;
            }
        }

        PairingResult r{ exeToken, clientId };
        return r;
    }
    catch (const std::exception& e) {
        errorOut = e.what();
        Logger::instance().logDebug(
            "agent",
            std::string("PairingClient::pairWithCode exception: ") + errorOut
        );
        return std::nullopt;
    }
}


std::string PairingClient::loadOrCreateExeId()
{
    if (auto storedId = securelocal::ReadProtectedLocalText(kExeIdFilename); storedId.has_value()) {
        std::string id = TrimAscii(*storedId);
        if (!id.empty()) {
            return id;
        }
    }

    std::string id = "exe-" + std::to_string(std::time(nullptr));
    if (!securelocal::WriteProtectedLocalText(kExeIdFilename, id)) {
        Logger::instance().logDebug(
            "agent",
            "PairingClient::loadOrCreateExeId: failed to persist protected exe_id"
        );
    }
    return id;
}


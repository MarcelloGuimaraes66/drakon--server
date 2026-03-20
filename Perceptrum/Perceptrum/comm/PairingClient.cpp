#include "PairingClient.h"

#include <fstream>
#include <stdexcept>
#include <curl/curl.h>
#include <nlohmann/json.hpp>
#include "../logging/Logging.h"
#include "SecureLocalStore.h"

#include <ctime>
#include <cstdlib>
#include <cstdio>
#include <iomanip>
#include <sstream>
#include <unordered_map>
#include <algorithm>
#include <cctype>

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

static std::string ReadEnvVarLocal(const char* name) {
    char* buf = nullptr;
    size_t len = 0;
    if (_dupenv_s(&buf, &len, name) != 0 || !buf) {
        return "";
    }

    std::string out(buf);
    free(buf);
    return out;
}

static bool LooksLikeProtectedBlob(const std::string& input) {
    const std::string value = TrimAscii(input);
    if (value.size() < 32 || value.rfind("AQAAANCM", 0) != 0) {
        return false;
    }

    return std::all_of(value.begin(), value.end(), [](unsigned char ch) {
        return std::isalnum(ch) || ch == '+' || ch == '/' || ch == '=';
    });
}

static std::string DetectWindowsTimezoneKeyViaTzutil() {
    std::string output;
#if defined(_WIN32)
    FILE* pipe = _popen("tzutil /g", "r");
    if (!pipe) return "";

    char buffer[256];
    while (fgets(buffer, sizeof(buffer), pipe)) {
        output += buffer;
    }
    _pclose(pipe);
#endif
    return TrimAscii(output);
}

static std::string MapWindowsTimezoneToIana(const std::string& windowsKey) {
    if (windowsKey.empty()) return "";

    static const std::unordered_map<std::string, std::string> kMap = {
        { "E. South America Standard Time", "America/Sao_Paulo" },
        { "Bahia Standard Time", "America/Bahia" },
        { "SA Eastern Standard Time", "America/Manaus" },
        { "SA Western Standard Time", "America/Manaus" },
        { "Central Brazilian Standard Time", "America/Cuiaba" },
    };

    const auto it = kMap.find(windowsKey);
    if (it != kMap.end()) {
        return it->second;
    }
    return "";
}

static std::string DetectUtcOffsetTimezone() {
    std::time_t now = std::time(nullptr);
    std::tm localTm{};
    std::tm utcTm{};
    localtime_s(&localTm, &now);
    gmtime_s(&utcTm, &now);

    // mktime interprets tm as local time. Using UTC tm here yields local offset.
    std::time_t localEpoch = std::mktime(&localTm);
    std::time_t utcAsLocalEpoch = std::mktime(&utcTm);
    long offsetSeconds = static_cast<long>(std::difftime(localEpoch, utcAsLocalEpoch));

    const char sign = offsetSeconds >= 0 ? '+' : '-';
    const long absSeconds = std::labs(offsetSeconds);
    const int hours = static_cast<int>(absSeconds / 3600);
    const int minutes = static_cast<int>((absSeconds % 3600) / 60);

    std::ostringstream out;
    out << "UTC" << sign << hours;
    if (minutes > 0) {
        out << ":" << std::setw(2) << std::setfill('0') << minutes;
    }
    return out.str();
}

static std::string DetectMachineTimezoneForPairing() {
    const std::string windowsKey = DetectWindowsTimezoneKeyViaTzutil();
    const std::string iana = MapWindowsTimezoneToIana(windowsKey);
    if (!iana.empty()) {
        return iana;
    }

    return DetectUtcOffsetTimezone();
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
    const std::string provisionedExeToken = TrimAscii(ReadEnvVarLocal(kProvisionedExeTokenEnv));
    const std::string provisionedClientId = TrimAscii(ReadEnvVarLocal(kProvisionedClientIdEnv));
    const std::string provisionedExeId = TrimAscii(ReadEnvVarLocal(kProvisionedExeIdEnv));
    const std::string provisionedTimezone = TrimAscii(ReadEnvVarLocal(kProvisionedTimezoneEnv));
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


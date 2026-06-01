#include "PairingClient.h"

#include <algorithm>
#include <chrono>
#include <cctype>
#include <ctime>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <utility>

#include <curl/curl.h>
#include <nlohmann/json.hpp>

#include "../platform/platform_common.h"
#include "../platform/platform_secure_store.h"

#ifndef PERCEPTRUM_LINUX_BUILD
#include <fstream>

#include "../logging/Logging.h"
#include "SecureLocalStore.h"
#endif

using json = nlohmann::json;

namespace {

static constexpr const char* kPairedTimezoneFilename = "paired_timezone.txt";
static constexpr const char* kExeTokenFilename = "exe_token.txt";
static constexpr const char* kClientIdFilename = "client_id.txt";
static constexpr const char* kExeIdFilename = "exe_id.txt";
static constexpr const char* kProvisionedExeTokenEnv = "APP_PROVISIONED_EXE_TOKEN";
static constexpr const char* kProvisionedClientIdEnv = "APP_PROVISIONED_CLIENT_ID";
static constexpr const char* kProvisionedExeIdEnv = "APP_PROVISIONED_EXE_ID";
static constexpr const char* kProvisionedTimezoneEnv = "APP_PROVISIONED_TIMEZONE";

size_t WriteCallback(void* contents, size_t size, size_t nmemb, void* userp)
{
    auto* output = static_cast<std::string*>(userp);
    output->append(static_cast<const char*>(contents), size * nmemb);
    return size * nmemb;
}

std::string TrimAscii(std::string input)
{
    return perceptrum::platform::TrimAscii(std::move(input));
}

bool LooksLikeProtectedBlob(const std::string& input)
{
    return perceptrum::platform::IsWindowsProtectedBlob(TrimAscii(input));
}

std::string DefaultUtcNow()
{
    const auto now = std::chrono::system_clock::now();
    const std::time_t nowTime = std::chrono::system_clock::to_time_t(now);
    const std::tm utc = perceptrum::platform::UtcTime(nowTime);

    std::ostringstream output;
    output << std::put_time(&utc, "%Y-%m-%dT%H:%M:%SZ");
    return output.str();
}

std::string DefaultExeId()
{
    const auto now = std::chrono::system_clock::now();
    const auto millis = std::chrono::duration_cast<std::chrono::milliseconds>(
        now.time_since_epoch()).count();
    return "exe-" + std::to_string(millis);
}

std::string ExtractBackendError(const json& document, long httpCode)
{
    if (document.is_object() && document.contains("error") && document["error"].is_string()) {
        return document["error"].get<std::string>();
    }
    return "backend returned HTTP " + std::to_string(httpCode);
}

} // namespace

PairingClient::PairingClient(const std::string& baseUrl)
    : PairingClient(baseUrl, {})
{
}

PairingClient::PairingClient(const std::string& baseUrl, PairingClientOptions options)
    : baseUrl_(baseUrl)
    , options_(std::move(options))
{
}

bool PairingClient::hasPortableStores() const
{
    return options_.tokenStore != nullptr && options_.configStore != nullptr;
}

void PairingClient::logDebug(std::string_view message) const
{
    if (options_.logger != nullptr) {
        options_.logger->debug("agent", message);
        return;
    }

#ifndef PERCEPTRUM_LINUX_BUILD
    Logger::instance().logDebug("agent", std::string(message));
#else
    (void)message;
#endif
}

std::string PairingClient::resolveTimezone() const
{
    if (options_.timezoneProvider) {
        const std::string provided = TrimAscii(options_.timezoneProvider());
        if (!provided.empty()) {
            return provided;
        }
    }
    return perceptrum::platform::DetectLocalTimezoneIana();
}

std::string PairingClient::resolveNowUtc() const
{
    if (options_.nowUtcProvider) {
        const std::string provided = TrimAscii(options_.nowUtcProvider());
        if (!provided.empty()) {
            return provided;
        }
    }
    return DefaultUtcNow();
}

std::string PairingClient::generateExeId() const
{
    if (options_.exeIdProvider) {
        const std::string provided = TrimAscii(options_.exeIdProvider());
        if (!provided.empty()) {
            return provided;
        }
    }
    return DefaultExeId();
}

bool PairingClient::writePortablePairingConfig(
    perceptrum::runtime::PairingConfig config,
    std::string& errorOut)
{
    errorOut.clear();
    if (!hasPortableStores()) {
        errorOut = "portable pairing stores are not configured";
        return false;
    }

    std::string readError;
    const auto previous = options_.configStore->readPairingConfig(&readError);
    const std::string now = resolveNowUtc();

    if (config.baseUrl.empty()) {
        config.baseUrl = baseUrl_;
    }
    if (config.exeId.empty() && previous.has_value()) {
        config.exeId = previous->exeId;
    }
    if (config.timezone.empty()) {
        config.timezone = previous.has_value() && !previous->timezone.empty()
            ? previous->timezone
            : resolveTimezone();
    }
    if (config.state.empty()) {
        config.state = "paired";
    }
    if (config.createdUtc.empty()) {
        config.createdUtc = previous.has_value() && !previous->createdUtc.empty()
            ? previous->createdUtc
            : now;
    }
    config.updatedUtc = now;

    std::string writeError;
    if (!options_.configStore->writePairingConfig(config, &writeError)) {
        errorOut = writeError.empty() ? "Failed to persist portable pairing config" : writeError;
        return false;
    }

    return true;
}

bool PairingClient::loadSavedToken(std::string& exeTokenOut, std::string& clientIdOut)
{
    exeTokenOut.clear();
    clientIdOut.clear();

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
            logDebug("PairingClient::loadSavedToken: provisioned env session looks encrypted; ignoring");
            return false;
        }

        if (hasPortableStores()) {
            if (!options_.tokenStore->writeToken(provisionedExeToken)) {
                logDebug("PairingClient::loadSavedToken: portable token store rejected provisioned token");
                return false;
            }

            perceptrum::runtime::PairingConfig config;
            if (const auto previous = options_.configStore->readPairingConfig(); previous.has_value()) {
                config = *previous;
            }
            config.baseUrl = baseUrl_;
            config.clientId = provisionedClientId;
            config.exeId = !provisionedExeId.empty()
                ? provisionedExeId
                : (!config.exeId.empty() ? config.exeId : generateExeId());
            config.timezone = !provisionedTimezone.empty()
                ? provisionedTimezone
                : (!config.timezone.empty() ? config.timezone : resolveTimezone());
            config.state = "provisioned";
            config.paired = true;
            config.provisioned = true;

            std::string errorMessage;
            if (!writePortablePairingConfig(config, errorMessage)) {
                options_.tokenStore->clearToken();
                logDebug("PairingClient::loadSavedToken: " + errorMessage);
                return false;
            }

            exeTokenOut = provisionedExeToken;
            clientIdOut = provisionedClientId;
            return true;
        }

#ifndef PERCEPTRUM_LINUX_BUILD
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
#else
        logDebug("PairingClient::loadSavedToken: portable stores are required on Linux");
        return false;
#endif
    }

    if (hasPortableStores()) {
        const auto exeToken = options_.tokenStore->readToken();
        if (!exeToken.has_value()) {
            return false;
        }

        std::string configError;
        const auto config = options_.configStore->readPairingConfig(&configError);
        if (!config.has_value()) {
            if (!configError.empty()) {
                logDebug("PairingClient::loadSavedToken: " + configError);
            }
            return false;
        }

        exeTokenOut = TrimAscii(*exeToken);
        clientIdOut = TrimAscii(config->clientId);
        if (exeTokenOut.empty() || clientIdOut.empty()) {
            exeTokenOut.clear();
            clientIdOut.clear();
            return false;
        }
        if (LooksLikeProtectedBlob(exeTokenOut) || LooksLikeProtectedBlob(clientIdOut)) {
            logDebug("PairingClient::loadSavedToken: portable session looks encrypted/stale; waiting for reprovision");
            exeTokenOut.clear();
            clientIdOut.clear();
            return false;
        }
        return true;
    }

#ifndef PERCEPTRUM_LINUX_BUILD
    auto exeToken = securelocal::ReadProtectedLocalText(kExeTokenFilename);
    auto clientId = securelocal::ReadProtectedLocalText(kClientIdFilename);
    if (!exeToken.has_value() || !clientId.has_value()) {
        return false;
    }

    exeTokenOut = TrimAscii(*exeToken);
    clientIdOut = TrimAscii(*clientId);
    if (LooksLikeProtectedBlob(exeTokenOut) || LooksLikeProtectedBlob(clientIdOut)) {
        logDebug("PairingClient::loadSavedToken: protected local session looks encrypted/stale; waiting for reprovision");
        exeTokenOut.clear();
        clientIdOut.clear();
        return false;
    }
    return !exeTokenOut.empty() && !clientIdOut.empty();
#else
    logDebug("PairingClient::loadSavedToken: portable stores are required on Linux");
    return false;
#endif
}

std::optional<PairingResult> PairingClient::pairWithCode(
    const std::string& pairCode,
    std::string& errorOut)
{
    errorOut.clear();

    CURL* curl = curl_easy_init();
    if (!curl) {
        errorOut = "curl_easy_init failed";
        logDebug("PairingClient::pairWithCode failed: curl_easy_init failed");
        return std::nullopt;
    }

    const std::string endpoint = baseUrl_ + "/api/pairing/pair";
    const std::string exeId = loadOrCreateExeId();
    const std::string pairedTimezone = resolveTimezone();

    const json bodyJson = {
        { "pair_code", pairCode },
        { "exe_id", exeId },
        { "timezone_iana", pairedTimezone },
    };
    const std::string body = bodyJson.dump();

    std::string response;
    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, endpoint.c_str());
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, static_cast<long>(body.size()));
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, 2000L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, 5000L);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);

    const CURLcode res = curl_easy_perform(curl);

    long httpCode = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpCode);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) {
        errorOut = std::string("backend_unreachable: ") + curl_easy_strerror(res);
        logDebug("PairingClient::pairWithCode failed: " + errorOut);
        return std::nullopt;
    }

    const json document = json::parse(response, nullptr, false);
    if (httpCode >= 400) {
        const std::string backendError = ExtractBackendError(document, httpCode);
        if (httpCode == 400 || httpCode == 401 || httpCode == 404) {
            errorOut = "pairing_failed: " + backendError;
        } else {
            errorOut = "backend_error: " + backendError;
        }
        logDebug("PairingClient::pairWithCode failed: HTTP " + std::to_string(httpCode) + " error=" + errorOut);
        return std::nullopt;
    }

    if (!document.is_object() ||
        !document.contains("exe_token") ||
        !document.contains("client_id") ||
        !document["exe_token"].is_string() ||
        !document["client_id"].is_string()) {
        errorOut = "pairing backend contract not available yet";
        logDebug("PairingClient::pairWithCode failed: backend contract missing exe_token/client_id");
        return std::nullopt;
    }

    const std::string exeToken = TrimAscii(document["exe_token"].get<std::string>());
    const std::string clientId = TrimAscii(document["client_id"].get<std::string>());
    if (exeToken.empty() || clientId.empty()) {
        errorOut = "pairing backend contract not available yet";
        logDebug("PairingClient::pairWithCode failed: backend returned empty exe_token/client_id");
        return std::nullopt;
    }

    if (hasPortableStores()) {
        if (!options_.tokenStore->writeToken(exeToken)) {
            errorOut =
                "secure_store_unavailable: cannot store exe-token securely. "
                "Install Secret Service/secret-tool or set APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 "
                "for the explicit plaintext recovery fallback.";
            logDebug("PairingClient::pairWithCode failed: portable token store rejected token");
            return std::nullopt;
        }

        perceptrum::runtime::PairingConfig config;
        if (const auto previous = options_.configStore->readPairingConfig(); previous.has_value()) {
            config = *previous;
        }
        config.baseUrl = baseUrl_;
        config.clientId = clientId;
        config.exeId = exeId;
        config.timezone = pairedTimezone;
        config.state = "paired";
        config.paired = true;
        config.provisioned = false;

        std::string configError;
        if (!writePortablePairingConfig(config, configError)) {
            options_.tokenStore->clearToken();
            errorOut = "Failed to store local pairing session: " + configError;
            logDebug("PairingClient::pairWithCode failed: " + errorOut);
            return std::nullopt;
        }

        return PairingResult{ exeToken, clientId };
    }

#ifndef PERCEPTRUM_LINUX_BUILD
    if (!securelocal::WriteProtectedLocalText(kExeTokenFilename, exeToken) ||
        !securelocal::WriteProtectedLocalText(kClientIdFilename, clientId)) {
        errorOut = "Failed to store local pairing secrets";
        logDebug("PairingClient::pairWithCode failed: could not persist protected local secrets");
        return std::nullopt;
    }
    if (!pairedTimezone.empty()) {
        std::ofstream timezoneFile(kPairedTimezoneFilename);
        if (timezoneFile.is_open()) {
            timezoneFile << pairedTimezone;
        }
    }

    return PairingResult{ exeToken, clientId };
#else
    errorOut = "portable pairing stores are required on Linux";
    logDebug("PairingClient::pairWithCode failed: portable stores are required on Linux");
    return std::nullopt;
#endif
}

std::string PairingClient::loadOrCreateExeId()
{
    if (hasPortableStores()) {
        const auto config = options_.configStore->readPairingConfig();
        if (config.has_value()) {
            const std::string id = TrimAscii(config->exeId);
            if (!id.empty()) {
                return id;
            }
        }
        return generateExeId();
    }

#ifndef PERCEPTRUM_LINUX_BUILD
    if (auto storedId = securelocal::ReadProtectedLocalText(kExeIdFilename); storedId.has_value()) {
        const std::string id = TrimAscii(*storedId);
        if (!id.empty()) {
            return id;
        }
    }

    const std::string id = "exe-" + std::to_string(std::time(nullptr));
    if (!securelocal::WriteProtectedLocalText(kExeIdFilename, id)) {
        logDebug("PairingClient::loadOrCreateExeId: failed to persist protected exe_id");
    }
    return id;
#else
    return generateExeId();
#endif
}

// comm/PairingClient.h
#pragma once

#include <functional>
#include <optional>
#include <string>
#include <string_view>

#include "../runtime/interfaces/IPairingConfigStore.h"
#include "../runtime/interfaces/IRuntimeLogger.h"
#include "../runtime/interfaces/ITokenStore.h"

// Result of a successful pairing
struct PairingResult {
    std::string exeToken;
    std::string clientId;
};

struct PairingClientOptions {
    perceptrum::runtime::ITokenStore* tokenStore = nullptr;
    perceptrum::runtime::IPairingConfigStore* configStore = nullptr;
    perceptrum::runtime::IRuntimeLogger* logger = nullptr;
    std::function<std::string()> timezoneProvider;
    std::function<std::string()> nowUtcProvider;
    std::function<std::string()> exeIdProvider;
};

class PairingClient {
public:
    explicit PairingClient(const std::string& baseUrl);
    PairingClient(const std::string& baseUrl, PairingClientOptions options);

    // Load saved exe_token and client_id from local files.
    bool loadSavedToken(std::string& exeTokenOut, std::string& clientIdOut);

    // Call backend with pair_code + exe_id + machine timezone and return tokens, or std::nullopt on error.
    // If it fails, errorOut will contain a human-readable message.
    std::optional<PairingResult> pairWithCode(const std::string& pairCode,
        std::string& errorOut);

private:
    std::string loadOrCreateExeId();
    bool hasPortableStores() const;
    void logDebug(std::string_view message) const;
    std::string resolveTimezone() const;
    std::string resolveNowUtc() const;
    std::string generateExeId() const;
    bool writePortablePairingConfig(
        perceptrum::runtime::PairingConfig config,
        std::string& errorOut);

    std::string baseUrl_;
    PairingClientOptions options_;
};

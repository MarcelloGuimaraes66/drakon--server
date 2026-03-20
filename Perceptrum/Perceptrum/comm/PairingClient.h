// comm/PairingClient.h
#pragma once

#include <string>
#include <optional>

// Result of a successful pairing
struct PairingResult {
    std::string exeToken;
    std::string clientId;
};

class PairingClient {
public:
    explicit PairingClient(const std::string& baseUrl);

    // Load saved exe_token and client_id from local files.
    bool loadSavedToken(std::string& exeTokenOut, std::string& clientIdOut);

    // Call backend with pair_code + exe_id + machine timezone and return tokens, or std::nullopt on error.
    // If it fails, errorOut will contain a human-readable message.
    std::optional<PairingResult> pairWithCode(const std::string& pairCode,
        std::string& errorOut);

private:
    std::string loadOrCreateExeId();

    std::string baseUrl_;
};

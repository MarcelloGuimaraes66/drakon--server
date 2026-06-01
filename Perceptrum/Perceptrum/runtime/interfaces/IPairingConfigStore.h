#pragma once

#include <optional>
#include <string>

namespace perceptrum::runtime {

struct PairingConfig {
    std::string baseUrl;
    std::string clientId;
    std::string exeId;
    std::string timezone;
    std::string state;
    std::string createdUtc;
    std::string updatedUtc;
    std::string lastBackendStatus;
    bool paired = false;
    bool provisioned = false;
};

class IPairingConfigStore {
public:
    virtual ~IPairingConfigStore() = default;

    virtual std::optional<PairingConfig> readPairingConfig(
        std::string* errorMessage = nullptr) const = 0;
    virtual bool writePairingConfig(
        const PairingConfig& config,
        std::string* errorMessage = nullptr) = 0;
};

} // namespace perceptrum::runtime

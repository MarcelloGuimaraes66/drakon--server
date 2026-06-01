#pragma once

#include <optional>
#include <string>
#include <string_view>

namespace perceptrum::runtime {

class ITokenStore {
public:
    virtual ~ITokenStore() = default;

    virtual std::optional<std::string> readToken() const = 0;
    virtual bool writeToken(std::string_view token) = 0;
    virtual bool hasToken() const = 0;
    virtual void clearToken() noexcept = 0;
};

} // namespace perceptrum::runtime

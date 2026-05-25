#pragma once

#include <string_view>

namespace perceptrum::runtime {

class IRuntimeLogger {
public:
    virtual ~IRuntimeLogger() = default;

    virtual void debug(std::string_view component, std::string_view message) noexcept = 0;
    virtual void info(std::string_view component, std::string_view message) noexcept = 0;
    virtual void warn(std::string_view component, std::string_view message) noexcept = 0;
    virtual void error(std::string_view component, std::string_view message) noexcept = 0;
};

} // namespace perceptrum::runtime

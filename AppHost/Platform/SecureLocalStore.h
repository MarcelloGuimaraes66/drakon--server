#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <string_view>

namespace DrakonDesktop::platform
{
    std::optional<std::string> ReadProtectedLocalText(std::filesystem::path const& path);
    std::optional<std::string> ReadProtectedLocalTextStrict(std::filesystem::path const& path);
    bool WriteProtectedLocalText(std::filesystem::path const& path, std::string_view value);
    void RemoveProtectedLocalText(std::filesystem::path const& path) noexcept;
}

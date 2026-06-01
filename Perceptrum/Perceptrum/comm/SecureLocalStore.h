#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <string_view>

namespace securelocal
{
    std::optional<std::string> ReadProtectedLocalText(const std::filesystem::path& path);
    bool WriteProtectedLocalText(const std::filesystem::path& path, std::string_view value);
}

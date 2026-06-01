#pragma once

#include <filesystem>
#include <optional>
#include <string>

namespace DrakonDesktop::platform
{
    std::filesystem::path DesktopSqliteKeyPath(std::filesystem::path const& serviceSessionDirectory);
    std::optional<std::string> GetOrCreateDesktopSqliteKeyHex(std::filesystem::path const& serviceSessionDirectory);
}

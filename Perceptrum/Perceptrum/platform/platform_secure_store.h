#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <string_view>

namespace perceptrum::platform {

std::optional<std::string> ReadProtectedLocalText(const std::filesystem::path& path);
std::optional<std::string> ReadProtectedLocalTextStrict(const std::filesystem::path& path);
bool ProtectedLocalTextNeedsQuarantine(const std::filesystem::path& path);
bool WriteProtectedLocalText(const std::filesystem::path& path, std::string_view value);
void RemoveProtectedLocalText(const std::filesystem::path& path) noexcept;
bool IsWindowsProtectedBlob(std::string_view value);

} // namespace perceptrum::platform

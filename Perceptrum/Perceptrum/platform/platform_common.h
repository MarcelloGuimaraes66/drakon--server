#pragma once

#include <ctime>
#include <filesystem>
#include <string>
#include <string_view>

namespace perceptrum::platform {

std::string TrimAscii(std::string value);
std::string ReadEnvVar(const char* name);

std::wstring Utf8ToWide(std::string_view value);
std::string WideToUtf8(std::wstring_view value);

std::filesystem::path GetExecutablePath();
std::filesystem::path GetExecutableDirectory();
std::filesystem::path SearchExecutableInPath(const std::filesystem::path& executableName);

std::filesystem::path GetHomeDirectory();
std::filesystem::path ExpandUserPath(const std::filesystem::path& path);
std::filesystem::path GetPlatformDataRoot(std::string_view applicationName);

std::tm LocalTime(std::time_t timeValue);
std::tm UtcTime(std::time_t timeValue);

std::string DetectUtcOffsetTimezone();
std::string DetectLocalTimezoneIana();

} // namespace perceptrum::platform

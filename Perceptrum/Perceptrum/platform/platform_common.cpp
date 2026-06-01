#include "platform_common.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <unordered_map>
#include <vector>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <pwd.h>
#include <sys/types.h>
#include <unistd.h>
#endif

#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif

#ifdef __linux__
#include <limits.h>
#endif

namespace {

std::string ReadFirstLineTrimmed(const std::filesystem::path& path)
{
    std::ifstream stream(path);
    if (!stream.is_open()) {
        return {};
    }

    std::string line;
    std::getline(stream, line);
    return perceptrum::platform::TrimAscii(std::move(line));
}

std::string NormalizeTimezoneCandidate(std::string value)
{
    value = perceptrum::platform::TrimAscii(std::move(value));
    if (value.empty()) {
        return {};
    }

    if (value[0] == ':') {
        value.erase(value.begin());
    }

    constexpr const char* kZoneInfoToken = "zoneinfo/";
    const auto zoneInfoPos = value.find(kZoneInfoToken);
    if (zoneInfoPos != std::string::npos) {
        value = value.substr(zoneInfoPos + std::char_traits<char>::length(kZoneInfoToken));
    }

    if (value == "UTC" || value == "Etc/UTC" || value == "GMT" || value == "Etc/GMT") {
        return "Etc/UTC";
    }

    return value;
}

#ifdef _WIN32
std::string DetectWindowsTimezoneKey()
{
    std::string output;
    FILE* pipe = _popen("tzutil /g", "r");
    if (!pipe) {
        return {};
    }

    char buffer[256]{};
    while (fgets(buffer, static_cast<int>(sizeof(buffer)), pipe)) {
        output += buffer;
    }

    _pclose(pipe);
    return perceptrum::platform::TrimAscii(std::move(output));
}

std::string MapWindowsTimezoneToIana(const std::string& windowsKey)
{
    static const std::unordered_map<std::string, std::string> kWindowsToIana = {
        { "E. South America Standard Time", "America/Sao_Paulo" },
        { "Bahia Standard Time", "America/Bahia" },
        { "SA Eastern Standard Time", "America/Manaus" },
        { "SA Western Standard Time", "America/Manaus" },
        { "Central Brazilian Standard Time", "America/Cuiaba" },
        { "UTC", "Etc/UTC" },
    };

    const auto it = kWindowsToIana.find(windowsKey);
    if (it == kWindowsToIana.end()) {
        return {};
    }

    return it->second;
}
#endif

} // namespace

namespace perceptrum::platform {

std::string TrimAscii(std::string value)
{
    auto isSpace = [](unsigned char ch) { return std::isspace(ch) != 0; };

    while (!value.empty() && isSpace(static_cast<unsigned char>(value.front()))) {
        value.erase(value.begin());
    }

    while (!value.empty() && isSpace(static_cast<unsigned char>(value.back()))) {
        value.pop_back();
    }

    return value;
}

std::string ReadEnvVar(const char* name)
{
    if (!name || !*name) {
        return {};
    }

#ifdef _WIN32
    char* buffer = nullptr;
    size_t length = 0;
    if (_dupenv_s(&buffer, &length, name) != 0 || buffer == nullptr) {
        return {};
    }

    std::string value(buffer);
    free(buffer);
    return TrimAscii(std::move(value));
#else
    const char* value = std::getenv(name);
    return value ? TrimAscii(std::string(value)) : std::string{};
#endif
}

std::wstring Utf8ToWide(std::string_view value)
{
    if (value.empty()) {
        return {};
    }

#ifdef _WIN32
    const int required = MultiByteToWideChar(
        CP_UTF8,
        0,
        value.data(),
        static_cast<int>(value.size()),
        nullptr,
        0);
    if (required <= 0) {
        return std::wstring(value.begin(), value.end());
    }

    std::wstring wide(static_cast<size_t>(required), L'\0');
    MultiByteToWideChar(
        CP_UTF8,
        0,
        value.data(),
        static_cast<int>(value.size()),
        wide.data(),
        required);
    return wide;
#else
    return std::wstring(value.begin(), value.end());
#endif
}

std::string WideToUtf8(std::wstring_view value)
{
    if (value.empty()) {
        return {};
    }

#ifdef _WIN32
    const int required = WideCharToMultiByte(
        CP_UTF8,
        0,
        value.data(),
        static_cast<int>(value.size()),
        nullptr,
        0,
        nullptr,
        nullptr);
    if (required <= 0) {
        std::string fallback;
        fallback.reserve(value.size());
        for (const wchar_t ch : value) {
            fallback.push_back(ch <= 0x7F ? static_cast<char>(ch) : '?');
        }
        return fallback;
    }

    std::string utf8(static_cast<size_t>(required), '\0');
    WideCharToMultiByte(
        CP_UTF8,
        0,
        value.data(),
        static_cast<int>(value.size()),
        utf8.data(),
        required,
        nullptr,
        nullptr);
    return utf8;
#else
    return std::string(value.begin(), value.end());
#endif
}

std::filesystem::path GetExecutablePath()
{
#ifdef _WIN32
    std::wstring buffer(MAX_PATH, L'\0');

    while (true) {
        const DWORD written = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
        if (written == 0) {
            return {};
        }

        if (written < buffer.size() - 1) {
            buffer.resize(static_cast<size_t>(written));
            return std::filesystem::path(buffer);
        }

        buffer.resize(buffer.size() * 2);
    }
#elif defined(__APPLE__)
    uint32_t required = 0;
    _NSGetExecutablePath(nullptr, &required);
    if (required == 0) {
        return {};
    }

    std::vector<char> buffer(required + 1, '\0');
    if (_NSGetExecutablePath(buffer.data(), &required) != 0) {
        return {};
    }

    std::error_code errorCode;
    const auto canonical = std::filesystem::weakly_canonical(buffer.data(), errorCode);
    return errorCode ? std::filesystem::path(buffer.data()) : canonical;
#elif defined(__linux__)
    std::vector<char> buffer(1024, '\0');

    while (true) {
        const ssize_t written = ::readlink("/proc/self/exe", buffer.data(), buffer.size() - 1);
        if (written < 0) {
            return {};
        }

        if (static_cast<size_t>(written) < buffer.size() - 1) {
            buffer[static_cast<size_t>(written)] = '\0';
            return std::filesystem::path(buffer.data());
        }

        buffer.resize(buffer.size() * 2);
    }
#else
    std::error_code errorCode;
    return std::filesystem::current_path(errorCode);
#endif
}

std::filesystem::path GetExecutableDirectory()
{
    const auto executablePath = GetExecutablePath();
    return executablePath.empty() ? std::filesystem::path{} : executablePath.parent_path();
}

std::filesystem::path SearchExecutableInPath(const std::filesystem::path& executableName)
{
    if (executableName.empty()) {
        return {};
    }

#ifdef _WIN32
    const std::wstring executableWide = executableName.wstring();
    std::wstring buffer(MAX_PATH, L'\0');
    while (true) {
        const DWORD written = SearchPathW(
            nullptr,
            executableWide.c_str(),
            nullptr,
            static_cast<DWORD>(buffer.size()),
            buffer.data(),
            nullptr);
        if (written == 0) {
            return executableName;
        }

        if (written < buffer.size()) {
            buffer.resize(static_cast<size_t>(written));
            return std::filesystem::path(buffer);
        }

        buffer.resize(static_cast<size_t>(written) + 1);
    }
#else
    const auto candidateText = executableName.string();
    if (candidateText.find('/') != std::string::npos) {
        std::error_code errorCode;
        if (std::filesystem::exists(executableName, errorCode)) {
            return executableName;
        }
    }

    const std::string pathValue = ReadEnvVar("PATH");
    std::stringstream stream(pathValue);
    std::string entry;
    while (std::getline(stream, entry, ':')) {
        if (entry.empty()) {
            continue;
        }

        std::filesystem::path candidate = std::filesystem::path(entry) / executableName;
        if (::access(candidate.string().c_str(), X_OK) == 0) {
            return candidate;
        }
    }

    return executableName;
#endif
}

std::filesystem::path GetHomeDirectory()
{
#ifdef _WIN32
    const std::string userProfile = ReadEnvVar("USERPROFILE");
    if (!userProfile.empty()) {
        return std::filesystem::path(userProfile);
    }

    const std::string homeDrive = ReadEnvVar("HOMEDRIVE");
    const std::string homePath = ReadEnvVar("HOMEPATH");
    if (!homeDrive.empty() && !homePath.empty()) {
        return std::filesystem::path(homeDrive + homePath);
    }

    return {};
#else
    const std::string home = ReadEnvVar("HOME");
    if (!home.empty()) {
        return std::filesystem::path(home);
    }

    if (const passwd* passwdEntry = ::getpwuid(::getuid())) {
        if (passwdEntry->pw_dir != nullptr) {
            return std::filesystem::path(passwdEntry->pw_dir);
        }
    }

    return {};
#endif
}

std::filesystem::path ExpandUserPath(const std::filesystem::path& path)
{
    const std::string raw = path.string();
    if (raw.empty() || raw[0] != '~') {
        return path;
    }

    if (raw.size() > 1 && raw[1] != '/' && raw[1] != '\\') {
        return path;
    }

    const auto homeDirectory = GetHomeDirectory();
    if (homeDirectory.empty()) {
        return path;
    }

    if (raw.size() == 1) {
        return homeDirectory;
    }

    const std::string remainder = raw.substr(2);
    return remainder.empty() ? homeDirectory : (homeDirectory / remainder);
}

std::filesystem::path GetPlatformDataRoot(std::string_view applicationName)
{
    const std::string folderName(applicationName);

#ifdef _WIN32
    const std::string programData = ReadEnvVar("PROGRAMDATA");
    const std::filesystem::path root = programData.empty()
        ? std::filesystem::path("C:\\ProgramData")
        : std::filesystem::path(programData);
    return root / folderName;
#elif defined(__APPLE__)
    return GetHomeDirectory() / "Library" / "Application Support" / folderName;
#elif defined(__linux__)
    const std::string xdgDataHome = ReadEnvVar("XDG_DATA_HOME");
    if (!xdgDataHome.empty()) {
        return ExpandUserPath(std::filesystem::path(xdgDataHome)) / folderName;
    }

    return GetHomeDirectory() / ".local" / "share" / folderName;
#else
    return std::filesystem::temp_directory_path() / folderName;
#endif
}

std::tm LocalTime(std::time_t timeValue)
{
    std::tm result{};

#ifdef _WIN32
    localtime_s(&result, &timeValue);
#else
    localtime_r(&timeValue, &result);
#endif

    return result;
}

std::tm UtcTime(std::time_t timeValue)
{
    std::tm result{};

#ifdef _WIN32
    gmtime_s(&result, &timeValue);
#else
    gmtime_r(&timeValue, &result);
#endif

    return result;
}

std::string DetectUtcOffsetTimezone()
{
    const std::time_t now = std::time(nullptr);
    const std::tm localTm = LocalTime(now);
    const std::tm utcTm = UtcTime(now);

    std::tm localCopy = localTm;
    std::tm utcCopy = utcTm;
    const std::time_t localEpoch = std::mktime(&localCopy);
    const std::time_t utcAsLocalEpoch = std::mktime(&utcCopy);
    const long offsetSeconds = static_cast<long>(std::difftime(localEpoch, utcAsLocalEpoch));

    const char sign = offsetSeconds >= 0 ? '+' : '-';
    const long absSeconds = std::labs(offsetSeconds);
    const int hours = static_cast<int>(absSeconds / 3600);
    const int minutes = static_cast<int>((absSeconds % 3600) / 60);

    std::ostringstream output;
    output << "UTC" << sign << hours;
    if (minutes > 0) {
        output << ':' << std::setw(2) << std::setfill('0') << minutes;
    }

    return output.str();
}

std::string DetectLocalTimezoneIana()
{
    if (const std::string envTimezone = NormalizeTimezoneCandidate(ReadEnvVar("TZ")); !envTimezone.empty()) {
        return envTimezone;
    }

#ifdef _WIN32
    if (const std::string windowsTimezoneKey = DetectWindowsTimezoneKey(); !windowsTimezoneKey.empty()) {
        if (const std::string mappedTimezone = MapWindowsTimezoneToIana(windowsTimezoneKey); !mappedTimezone.empty()) {
            return mappedTimezone;
        }
    }
#else
    if (const std::string timezoneFromFile = NormalizeTimezoneCandidate(ReadFirstLineTrimmed("/etc/timezone"));
        !timezoneFromFile.empty()) {
        return timezoneFromFile;
    }

    std::error_code errorCode;
    const auto localtimeSymlink = std::filesystem::read_symlink("/etc/localtime", errorCode);
    if (!errorCode) {
        if (const std::string fromSymlink = NormalizeTimezoneCandidate(localtimeSymlink.string()); !fromSymlink.empty()) {
            return fromSymlink;
        }
    }
#endif

    return DetectUtcOffsetTimezone();
}

} // namespace perceptrum::platform

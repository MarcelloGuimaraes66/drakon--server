#include "ConfigUtils.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <fstream>
#include <limits>
#include <unordered_set>

#include <windows.h>

namespace chatv2 {

namespace fs = std::filesystem;

namespace {

fs::path normalizePath_(const fs::path& path)
{
    std::error_code ec;
    const fs::path weaklyCanonical = fs::weakly_canonical(path, ec);
    if (!ec && !weaklyCanonical.empty()) {
        return weaklyCanonical;
    }
    return path.lexically_normal();
}

bool pathExistsAndIsRegularFile_(const fs::path& path)
{
    std::error_code ec;
    return fs::exists(path, ec) && fs::is_regular_file(path, ec);
}

std::vector<fs::path> dedupePaths_(const std::vector<fs::path>& paths)
{
    std::vector<fs::path> unique;
    std::unordered_set<std::string> seen;
    unique.reserve(paths.size());

    for (const auto& path : paths) {
        if (path.empty()) continue;
        const fs::path normalized = normalizePath_(path);
        const std::string key = normalized.string();
        if (!seen.insert(key).second) continue;
        unique.push_back(normalized);
    }

    return unique;
}

std::vector<fs::path> existingDirectoriesOnly_(const std::vector<fs::path>& paths)
{
    std::vector<fs::path> directories;
    directories.reserve(paths.size());

    for (const auto& path : paths) {
        std::error_code ec;
        if (!path.empty() && fs::exists(path, ec) && fs::is_directory(path, ec)) {
            directories.push_back(path);
        }
    }

    return dedupePaths_(directories);
}

} // namespace

std::string trimCopy(std::string value)
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

std::string readEnvVar(const char* name)
{
    if (!name || !*name) return "";

    char* raw = nullptr;
    size_t length = 0;
    if (_dupenv_s(&raw, &length, name) != 0 || !raw) {
        return "";
    }

    std::string value(raw);
    free(raw);
    return trimCopy(std::move(value));
}

fs::path getExecutableDirPath()
{
    wchar_t buffer[MAX_PATH];
    const DWORD length = GetModuleFileNameW(nullptr, buffer, MAX_PATH);
    if (length == 0 || length >= MAX_PATH) {
        return fs::current_path();
    }

    return fs::path(buffer).parent_path();
}

std::vector<fs::path> buildConfigSearchRoots()
{
    std::vector<fs::path> roots;

    std::error_code ec;
    const fs::path currentPath = fs::current_path(ec);
    if (!ec && !currentPath.empty()) {
        roots.push_back(currentPath);
    }

    const fs::path exeDir = getExecutableDirPath();
    if (!exeDir.empty()) {
        roots.push_back(exeDir);
        roots.push_back(exeDir / "orchestrator");

        fs::path parent = exeDir.parent_path();
        for (int depth = 0; depth < 4 && !parent.empty(); ++depth) {
            roots.push_back(parent);
            roots.push_back(parent / "orchestrator");
            roots.push_back(parent / "Perceptrum");
            roots.push_back(parent / "Perceptrum" / "orchestrator");
            parent = parent.parent_path();
        }
    }

    return existingDirectoriesOnly_(roots);
}

std::vector<fs::path> buildLocalLlmRootCandidates()
{
    std::vector<fs::path> candidates;
    const auto searchRoots = buildConfigSearchRoots();

    for (const auto& root : searchRoots) {
        candidates.push_back(root / ".local" / "llm");
        candidates.push_back(root / "llm");
    }

    return existingDirectoriesOnly_(candidates);
}

std::string readFirstLineFile(const fs::path& path)
{
    if (path.empty()) return "";

    std::ifstream input(path);
    if (!input.is_open()) return "";

    std::string line;
    std::getline(input, line);
    return trimCopy(std::move(line));
}

std::string loadConfigValue(
    const char* envName,
    const std::vector<std::string>& fileNames)
{
    const std::string envValue = readEnvVar(envName);
    if (!envValue.empty()) {
        return envValue;
    }

    const auto roots = buildConfigSearchRoots();
    for (const auto& root : roots) {
        for (const auto& fileName : fileNames) {
            if (fileName.empty()) continue;
            const fs::path candidate = root / fileName;
            const std::string fileValue = readFirstLineFile(candidate);
            if (!fileValue.empty()) {
                return fileValue;
            }
        }
    }

    return "";
}

bool parseBoolValue(const std::string& rawValue, bool defaultValue)
{
    if (rawValue.empty()) return defaultValue;

    std::string normalized = trimCopy(rawValue);
    std::transform(normalized.begin(), normalized.end(), normalized.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });

    if (normalized == "1" || normalized == "true" || normalized == "yes" || normalized == "on") {
        return true;
    }
    if (normalized == "0" || normalized == "false" || normalized == "no" || normalized == "off") {
        return false;
    }

    return defaultValue;
}

int parseIntValue(
    const std::string& rawValue,
    int defaultValue,
    int minValue,
    int maxValue)
{
    if (rawValue.empty()) return defaultValue;

    try {
        const long long parsed = std::stoll(trimCopy(rawValue));
        if (parsed < static_cast<long long>(minValue)) return minValue;
        if (parsed > static_cast<long long>(maxValue)) return maxValue;
        return static_cast<int>(parsed);
    }
    catch (...) {
        return defaultValue;
    }
}

fs::path findExistingFile(const std::vector<fs::path>& candidates)
{
    for (const auto& candidate : candidates) {
        if (candidate.empty()) continue;
        const fs::path normalized = normalizePath_(candidate);
        if (pathExistsAndIsRegularFile_(normalized)) {
            return normalized;
        }
    }

    return fs::path();
}

fs::path findFirstGgufFile(const std::vector<fs::path>& directories)
{
    for (const auto& directory : directories) {
        if (directory.empty()) continue;

        std::error_code ec;
        if (!fs::exists(directory, ec) || !fs::is_directory(directory, ec)) {
            continue;
        }

        for (fs::recursive_directory_iterator it(directory, ec), end; !ec && it != end; it.increment(ec)) {
            if (ec) break;
            if (!it->is_regular_file(ec)) continue;
            if (it->path().extension() == ".gguf") {
                return normalizePath_(it->path());
            }
        }
    }

    return fs::path();
}

} // namespace chatv2

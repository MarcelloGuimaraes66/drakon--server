#pragma once

#include <filesystem>
#include <string>
#include <vector>

namespace chatv2 {

std::string trimCopy(std::string value);
std::string readEnvVar(const char* name);

std::filesystem::path getExecutableDirPath();
std::vector<std::filesystem::path> buildConfigSearchRoots();
std::vector<std::filesystem::path> buildLocalLlmRootCandidates();

std::string readFirstLineFile(const std::filesystem::path& path);
std::string loadConfigValue(
    const char* envName,
    const std::vector<std::string>& fileNames);

bool parseBoolValue(const std::string& rawValue, bool defaultValue);
int parseIntValue(
    const std::string& rawValue,
    int defaultValue,
    int minValue,
    int maxValue);

std::filesystem::path findExistingFile(
    const std::vector<std::filesystem::path>& candidates);
std::filesystem::path findFirstGgufFile(
    const std::vector<std::filesystem::path>& directories);

} // namespace chatv2

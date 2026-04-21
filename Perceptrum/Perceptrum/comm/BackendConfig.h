#pragma once

#include <string>
#include <fstream>
#include <cstdlib>
#include <cctype>
#include <stdlib.h>
#include "../generated/Branding.h"

inline std::string TrimCopyConfig(std::string s) {
    auto isSpace = [](unsigned char c) { return std::isspace(c) != 0; };
    while (!s.empty() && isSpace(static_cast<unsigned char>(s.front()))) s.erase(s.begin());
    while (!s.empty() && isSpace(static_cast<unsigned char>(s.back()))) s.pop_back();
    return s;
}

inline std::string NormalizeBaseUrl(std::string s) {
    s = TrimCopyConfig(std::move(s));
    while (!s.empty() && s.back() == '/') s.pop_back();
    return s;
}

inline std::string ReadEnvVar(const char* name) {
    char* buf = nullptr;
    size_t len = 0;
    if (_dupenv_s(&buf, &len, name) != 0 || !buf) {
        return "";
    }
    std::string out(buf);
    free(buf);
    return out;
}

inline std::string LoadBaseUrlFromFile() {
    const char* candidates[] = {
        AppBrand::kBaseUrlFileName,
        AppBrand::kLegacyBaseUrlFileName,
    };

    for (const char* candidate : candidates) {
        if (!candidate || !*candidate) continue;

        std::ifstream in(candidate);
        if (!in) continue;

        std::string line;
        std::getline(in, line);
        const std::string normalized = NormalizeBaseUrl(line);
        if (!normalized.empty()) {
            return normalized;
        }
    }

    return "";
}

// Order of precedence:
// 1) active brand env var
// 2) legacy brand env var
// 3) APP_BASE_URL env var injected by the desktop host
// 4) active brand base-url file
// 5) legacy brand base-url file
// 6) default to localhost
inline std::string GetPerceptrumBaseUrl() {
    const char* envCandidates[] = {
        AppBrand::kBaseUrlEnvVarName,
        AppBrand::kLegacyBaseUrlEnvVarName,
        "APP_BASE_URL",
    };

    for (const char* candidate : envCandidates) {
        if (!candidate || !*candidate) continue;
        std::string env = ReadEnvVar(candidate);
        if (!env.empty()) {
            return NormalizeBaseUrl(env);
        }
    }

    std::string fromFile = LoadBaseUrlFromFile();
    if (!fromFile.empty()) {
        return fromFile;
    }

    return "http://localhost:4000";
}

#pragma once

#include <string>
#include <fstream>
#include <cstdlib>
#include <cctype>
#include <stdlib.h>

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
    std::ifstream in("perceptrum_base_url.txt");
    if (!in) return "";

    std::string line;
    std::getline(in, line);
    return NormalizeBaseUrl(line);
}

// Order of precedence:
// 1) PERCEPTRUM_BASE_URL env var
// 2) perceptrum_base_url.txt (current working directory)
// 3) default to localhost
inline std::string GetPerceptrumBaseUrl() {
    std::string env = ReadEnvVar("PERCEPTRUM_BASE_URL");
    if (!env.empty()) {
        return NormalizeBaseUrl(env);
    }

    std::string fromFile = LoadBaseUrlFromFile();
    if (!fromFile.empty()) {
        return fromFile;
    }

    return "http://localhost:4000";
}

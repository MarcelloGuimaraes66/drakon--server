#include "Logging.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <filesystem>
#include <iostream>
#include <cstdio>
#include <cstdlib>
#include <sstream>
#include <iomanip>
#include <ctime>
#include <curl/curl.h>
#include <nlohmann/json.hpp>
#include "../comm/BackendConfig.h"
#include "../comm/SecureLocalStore.h"

#ifdef _WIN32
#include <windows.h>
#endif

namespace fs = std::filesystem;
using json = nlohmann::json;

static void appendBootstrapAgentLogLine(const std::string& msg) noexcept {
    try {
        fs::path logDir = "logs";
#ifdef __linux__
        const char* runtimeLogRoot = std::getenv("APP_RUNTIME_LOG_ROOT");
        if (runtimeLogRoot != nullptr && *runtimeLogRoot != '\0') {
            logDir = fs::path(runtimeLogRoot);
        }
#endif
        fs::create_directories(logDir);

        std::ofstream out(logDir / "agent.log", std::ios::app);
        if (!out.is_open()) return;

        char buf[32]{};
        try {
            auto now = std::chrono::system_clock::now();
            std::time_t now_c = std::chrono::system_clock::to_time_t(now);
            std::tm tm{};
#ifdef _WIN32
            localtime_s(&tm, &now_c);
#else
            localtime_r(&now_c, &tm);
#endif
            std::strftime(buf, sizeof(buf), "%H:%M:%S", &tm);
        }
        catch (...) {
            std::snprintf(buf, sizeof(buf), "??:??:??");
        }

        out << "[" << buf << "] [LOGGER] " << msg << "\n";
        out.flush();
    }
    catch (...) {
        // last-resort: never throw from logger internals
    }
}

static void safeCerr(const std::string& msg) noexcept {
    try { std::cerr << msg << "\n"; }
    catch (...) {}
    appendBootstrapAgentLogLine(msg);
}

static std::string trimAscii(std::string value) {
    auto isSpace = [](unsigned char ch) { return std::isspace(ch) != 0; };
    while (!value.empty() && isSpace(static_cast<unsigned char>(value.front()))) {
        value.erase(value.begin());
    }
    while (!value.empty() && isSpace(static_cast<unsigned char>(value.back()))) {
        value.pop_back();
    }
    return value;
}

static bool readProtectedLocalFile(const std::string& path, std::string& out) {
    auto value = securelocal::ReadProtectedLocalText(path);
    if (!value.has_value()) return false;

    std::string line = trimAscii(*value);
    if (line.empty()) return false;

    out = std::move(line);
    return true;
}

static std::string nowUtcIso8601Ms_() {
    const auto now = std::chrono::system_clock::now();
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        now.time_since_epoch()) % 1000;

    std::time_t nowTime = std::chrono::system_clock::to_time_t(now);
    std::tm tmUtc{};
#ifdef _WIN32
    gmtime_s(&tmUtc, &nowTime);
#else
    gmtime_r(&nowTime, &tmUtc);
#endif

    char buffer[48]{};
    std::snprintf(
        buffer,
        sizeof(buffer),
        "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
        tmUtc.tm_year + 1900,
        tmUtc.tm_mon + 1,
        tmUtc.tm_mday,
        tmUtc.tm_hour,
        tmUtc.tm_min,
        tmUtc.tm_sec,
        static_cast<int>(ms.count())
    );

    return std::string(buffer);
}

static size_t writeStringCb(void* contents, size_t size, size_t nmemb, void* userp) {
    if (!contents || !userp) return 0;
    const size_t total = size * nmemb;
    auto* out = static_cast<std::string*>(userp);
    out->append(static_cast<const char*>(contents), total);
    return total;
}

static std::string urlEncodeValue(const std::string& value) {
    CURL* curl = curl_easy_init();
    if (!curl) return value;

    char* encoded = curl_easy_escape(curl, value.c_str(), static_cast<int>(value.size()));
    std::string out = encoded ? std::string(encoded) : value;

    if (encoded) {
        curl_free(encoded);
    }
    curl_easy_cleanup(curl);
    return out;
}

static ErrorLogContext sanitizeErrorContext_(const ErrorLogContext& input);

static std::string resolveDefaultLogDir_() {
#ifdef __linux__
    const char* runtimeLogRoot = std::getenv("APP_RUNTIME_LOG_ROOT");
    if (runtimeLogRoot != nullptr) {
        std::string value = trimAscii(runtimeLogRoot);
        if (!value.empty()) {
            return value;
        }
    }
#endif
    return "logs";
}

Logger& Logger::instance() {
    static Logger inst;
    return inst;
}

Logger::Logger()
    : logDir_(resolveDefaultLogDir_())
{
    try {
        fs::create_directories(logDir_);
    }
    catch (const std::exception& ex) {
        safeCerr(std::string("[Logger] Failed to create logs directory: ") + ex.what());
    }
    catch (...) {
        safeCerr("[Logger] Failed to create logs directory: unknown exception");
    }

    // start workers
    worker_ = std::thread(&Logger::workerLoop_, this);
    errorWorker_ = std::thread(&Logger::errorExportLoop_, this);
}

Logger::~Logger() {
    // NEVER hang in destructor. Best-effort stop with short timeout.
    shutdown(500);
}

void Logger::shutdown(int timeoutMs) noexcept {
    bool expected = false;
    if (!stopping_.compare_exchange_strong(expected, true)) {
        return; // already stopping
    }

    try {
        qCv_.notify_all();
        errorCv_.notify_all();
    }
    catch (...) {}

#ifdef _WIN32
    auto stopThread = [timeoutMs](std::thread& t) noexcept {
        if (!t.joinable()) return;

        HANDLE h = (HANDLE)t.native_handle();
        DWORD w = WaitForSingleObject(h, (DWORD)timeoutMs);
        if (w == WAIT_OBJECT_0) {
            try { t.join(); }
            catch (...) {}
        }
        else {
            try { t.detach(); }
            catch (...) {}
        }
    };

    stopThread(worker_);
    stopThread(errorWorker_);
#else
    // Non-Windows: no timed join available; detach to avoid shutdown hang.
    if (worker_.joinable()) {
        try { worker_.detach(); }
        catch (...) {}
    }
    if (errorWorker_.joinable()) {
        try { errorWorker_.detach(); }
        catch (...) {}
    }
#endif
}

void Logger::enqueue_(LogItem&& item) noexcept {
    if (stopping_.load()) return;

    try {
        std::unique_lock<std::mutex> lk(qMutex_, std::try_to_lock);
        if (!lk.owns_lock()) {
            // avoid blocking real-time threads
            dropped_.fetch_add(1);
            return;
        }

        if (q_.size() >= maxQueue_) {
            // drop oldest (or you can drop newest � either is fine)
            q_.pop_front();
            dropped_.fetch_add(1);
        }

        q_.push_back(std::move(item));
        qCv_.notify_one();
    }
    catch (...) {
        // never throw from logging
    }
}

void Logger::enqueueErrorExport_(ErrorExportItem&& item) noexcept {
    if (stopping_.load()) return;

    try {
        std::lock_guard<std::mutex> lk(errorQMutex_);
        if (errorQ_.size() >= maxErrorQueue_) {
            errorQ_.pop_front();
            droppedError_.fetch_add(1);
        }
        errorQ_.push_back(std::move(item));
        errorCv_.notify_one();
    }
    catch (...) {
        // never throw from logging
    }
}

bool Logger::flushErrorBatch_(const std::vector<ErrorExportItem>& batch) noexcept {
    if (batch.empty()) return true;

#ifdef __linux__
    safeCerr("[Logger] Linux error export disabled until an explicit runtime token store is injected");
    return false;
#else
    const std::string baseUrl = trimAscii(GetPerceptrumAgentBaseUrl());
    if (baseUrl.empty()) {
        safeCerr("[Logger] flushErrorBatch_: empty base URL");
        return false;
    }

    std::string clientId;
    if (!readProtectedLocalFile("client_id.txt", clientId)) {
        safeCerr("[Logger] flushErrorBatch_: client_id.txt missing/empty");
        return false;
    }

    std::string exeToken;
    if (!readProtectedLocalFile("exe_token.txt", exeToken)) {
        safeCerr("[Logger] flushErrorBatch_: exe_token.txt missing/empty");
        return false;
    }

    std::string exeId;
    if (!readProtectedLocalFile("exe_id.txt", exeId)) {
        exeId = "unknown_exe";
    }

    json body;
    body["logs"] = json::array();

    for (const auto& item : batch) {
        json exported = json{
            { "source_id", item.sourceId.empty() ? "agent" : item.sourceId },
            { "level", item.level.empty() ? "ERROR" : item.level },
            { "message", item.message },
            { "occurred_at", item.occurredAtIsoUtc.empty() ? nowUtcIso8601Ms_() : item.occurredAtIsoUtc },
            { "exe_id", exeId },
            { "client_id", clientId }
        };

        const ErrorLogContext context = sanitizeErrorContext_(item.context);
        if (!context.flow.empty()) {
            exported["flow"] = context.flow;
        }
        if (!context.functionName.empty()) {
            exported["function_name"] = context.functionName;
        }
        if (!context.operation.empty()) {
            exported["operation"] = context.operation;
        }
        if (!context.contextJson.empty()) {
            exported["context_json"] = context.contextJson;
        }

        body["logs"].push_back(std::move(exported));
    }

    const std::string payload = body.dump();
    const std::string url = baseUrl + "/api/agent/error-logs?client_id=" + urlEncodeValue(clientId);

    CURL* curl = curl_easy_init();
    if (!curl) {
        safeCerr("[Logger] flushErrorBatch_: curl_easy_init failed");
        return false;
    }

    std::string response;

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    const std::string auth = "Authorization: Bearer " + exeToken;
    headers = curl_slist_append(headers, auth.c_str());

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, payload.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, static_cast<long>(payload.size()));
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeStringCb);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 5L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 15L);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);

    const CURLcode rc = curl_easy_perform(curl);
    long httpCode = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpCode);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (rc != CURLE_OK) {
        safeCerr(std::string("[Logger] flushErrorBatch_: curl error: ") + curl_easy_strerror(rc));
        return false;
    }

    if (httpCode < 200 || httpCode >= 300) {
        std::string responseShort = response;
        if (responseShort.size() > 220) {
            responseShort.resize(220);
            responseShort += "...";
        }
        safeCerr(
            std::string("[Logger] flushErrorBatch_: HTTP ") + std::to_string(httpCode) +
            " response=" + responseShort
        );
        return false;
    }

    return true;
#endif
}

static bool isImportantMsg(const std::string& s) {
    std::string lower = s;
    std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
        });

    static constexpr std::array<const char*, 19> kErrorTokens = {
        "error",
        "erro",
        "failed",
        "failure",
        "exception",
        "invalid",
        "cannot",
        "unable",
        "timeout",
        "timed out",
        "threw",
        "throw",
        "crash",
        "fatal",
        "denied",
        "refused",
        "offline",
        "unreachable",
        "falha"
    };

    for (const char* token : kErrorTokens) {
        if (lower.find(token) != std::string::npos) {
            return true;
        }
    }
    return false;
}

static void maskParamValue(std::string& url, const std::string& key) {
    size_t pos = 0;
    while ((pos = url.find(key, pos)) != std::string::npos) {
        const size_t valueStart = pos + key.size();
        size_t valueEnd = url.find_first_of("&/?#|\"' ,)]}\t\r\n", valueStart);
        if (valueEnd == std::string::npos) {
            valueEnd = url.size();
        }

        if (valueEnd > valueStart) {
            url.replace(valueStart, valueEnd - valueStart, "***");
        }
        pos = valueStart + 3; // skip the masked value
    }
}
static bool isJsonValueDelimiter(char c) {
    return c == ',' || c == '}' || c == ']' || std::isspace(static_cast<unsigned char>(c)) != 0;
}

static size_t findJsonStringEnd(const std::string& s, size_t quotePos) {
    if (quotePos >= s.size() || s[quotePos] != '"') return std::string::npos;
    bool escaped = false;
    for (size_t i = quotePos + 1; i < s.size(); ++i) {
        const char c = s[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (c == '\\') {
            escaped = true;
            continue;
        }
        if (c == '"') return i;
    }
    return std::string::npos;
}

static void maskJsonKeyValue(std::string& text, const std::string& key) {
    const std::string quotedKey = "\"" + key + "\"";
    size_t pos = 0;

    while ((pos = text.find(quotedKey, pos)) != std::string::npos) {
        size_t prev = pos;
        while (prev > 0 && std::isspace(static_cast<unsigned char>(text[prev - 1])) != 0) {
            --prev;
        }
        if (prev == 0 || (text[prev - 1] != '{' && text[prev - 1] != ',')) {
            pos += quotedKey.size();
            continue;
        }

        size_t colon = pos + quotedKey.size();
        while (colon < text.size() && std::isspace(static_cast<unsigned char>(text[colon])) != 0) {
            ++colon;
        }
        if (colon >= text.size() || text[colon] != ':') {
            pos += quotedKey.size();
            continue;
        }

        size_t valueStart = text.find_first_not_of(" \t\r\n", colon + 1);
        if (valueStart == std::string::npos) break;

        size_t valueEnd = std::string::npos;
        if (text[valueStart] == '"') {
            size_t strEnd = findJsonStringEnd(text, valueStart);
            if (strEnd == std::string::npos) {
                pos = colon + 1;
                continue;
            }
            valueEnd = strEnd + 1; // include trailing quote
        }
        else {
            valueEnd = valueStart;
            while (valueEnd < text.size() && !isJsonValueDelimiter(text[valueEnd])) {
                ++valueEnd;
            }
        }

        if (valueEnd > valueStart) {
            text.replace(valueStart, valueEnd - valueStart, "\"****\"");
            pos = valueStart + 6; // len("\"****\"")
        }
        else {
            pos = colon + 1;
        }
    }
}

static void maskKeyEqualsValue(std::string& text, const std::string& key) {
    const std::string needle = key + "=";
    size_t pos = 0;
    while ((pos = text.find(needle, pos)) != std::string::npos) {
        const size_t valueStart = pos + needle.size();
        size_t valueEnd = text.find_first_of(" \t\r\n,|&;)]}\"'", valueStart);
        if (valueEnd == std::string::npos) {
            valueEnd = text.size();
        }
        if (valueEnd > valueStart) {
            text.replace(valueStart, valueEnd - valueStart, "****");
            pos = valueStart + 4;
        }
        else {
            pos = valueStart;
        }
    }
}

static std::string redactRtspUrl(std::string url) {
    size_t schemePos = url.find("rtsp://");
    if (schemePos == std::string::npos) {
        schemePos = url.find("RTSP://");
    }
    if (schemePos == std::string::npos) {
        return url;
    }

    const size_t authStart = schemePos + 7; // len("rtsp://")
    size_t authEnd = url.find_first_of("/?#", authStart);
    if (authEnd == std::string::npos) {
        authEnd = url.size();
    }

    const size_t atPos = url.find('@', authStart);
    if (atPos != std::string::npos && atPos < authEnd) {
        const size_t colonPos = url.find(':', authStart);
        const std::string repl = (colonPos != std::string::npos && colonPos < atPos) ? "***:***" : "***";
        url.replace(authStart, atPos - authStart, repl);
    }

    // Handles formats like ".../user=...&password=..." used by some cameras.
    maskParamValue(url, "user=");
    maskParamValue(url, "USER=");
    maskParamValue(url, "username=");
    maskParamValue(url, "USERNAME=");
    maskParamValue(url, "usuario=");
    maskParamValue(url, "USUARIO=");
    maskParamValue(url, "password=");
    maskParamValue(url, "PASSWORD=");
    maskParamValue(url, "passwd=");
    maskParamValue(url, "PASSWD=");
    maskParamValue(url, "pwd=");
    maskParamValue(url, "PWD=");
    maskParamValue(url, "senha=");
    maskParamValue(url, "SENHA=");

    return url;
}

static std::string redactSensitiveRtspInLog(const std::string& message) {
    size_t firstLower = message.find("rtsp://");
    size_t firstUpper = message.find("RTSP://");
    if (firstLower == std::string::npos && firstUpper == std::string::npos) {
        return message;
    }

    std::string out = message;
    size_t searchPos = 0;

    while (searchPos < out.size()) {
        size_t posLower = out.find("rtsp://", searchPos);
        size_t posUpper = out.find("RTSP://", searchPos);
        size_t pos = std::string::npos;

        if (posLower == std::string::npos) {
            pos = posUpper;
        }
        else if (posUpper == std::string::npos) {
            pos = posLower;
        }
        else {
            pos = (posLower < posUpper) ? posLower : posUpper;
        }

        if (pos == std::string::npos) {
            break;
        }

        size_t end = out.find_first_of(" \t\r\n\"'<>|,)]}", pos);
        if (end == std::string::npos) {
            end = out.size();
        }

        const std::string rawUrl = out.substr(pos, end - pos);
        const std::string redacted = redactRtspUrl(rawUrl);

        out.replace(pos, rawUrl.size(), redacted);
        searchPos = pos + redacted.size();
    }

    return out;
}

static std::string redactSensitiveFieldsInLog(const std::string& message) {
    std::string out = message;

    // Existing camera URL redaction (credentials in RTSP).
    out = redactSensitiveRtspInLog(out);

    // JSON-like sensitive fields in payload/cmd logs.
    static constexpr std::array<const char*, 43> kJsonSensitiveKeys = {
        "password",
        "passwd",
        "pwd",
        "senha",
        "username",
        "user",
        "ip",
        "ip_address",
        "ipAddress",
        "api_key",
        "model_api_key",
        "description_model_api_key",
        "validator_model_api_key",
        "router_api_key",
        "apiKey",
        "apikey",
        "token",
        "access_token",
        "refresh_token",
        "session_token",
        "exe_token",
        "exe-token",
        "grant_token",
        "central_grant_token",
        "central_device_session_token",
        "workspace_token",
        "relay_token",
        "authorization",
        "cookie",
        "set-cookie",
        "client_secret",
        "oauth_secret",
        "telegram_bot_token",
        "telegramBotToken",
        "bot_token",
        "telegram_chat_id",
        "telegramChatId",
        "chat_id",
        "rtsp_url",
        "openai_api_key",
        "z_ai_api_key",
        "zai_api_key",
        "zai_key"
    };

    for (const char* key : kJsonSensitiveKeys) {
        maskJsonKeyValue(out, key);
    }

    // key=value patterns that may appear outside JSON.
    static constexpr std::array<const char*, 32> kEqualsSensitiveKeys = {
        "password",
        "passwd",
        "pwd",
        "senha",
        "username",
        "user",
        "ip",
        "api_key",
        "model_api_key",
        "description_model_api_key",
        "validator_model_api_key",
        "router_api_key",
        "token",
        "access_token",
        "refresh_token",
        "session_token",
        "exe_token",
        "exe-token",
        "grant_token",
        "central_grant_token",
        "central_device_session_token",
        "workspace_token",
        "relay_token",
        "authorization",
        "cookie",
        "client_secret",
        "oauth_secret",
        "telegram_bot_token",
        "telegram_chat_id",
        "z_ai_api_key",
        "zai_api_key",
        "zai_key"
    };
    for (const char* key : kEqualsSensitiveKeys) {
        maskKeyEqualsValue(out, key);
    }

    return out;
}

static std::string truncateWithEllipsis_(std::string value, size_t maxLen) {
    if (value.size() <= maxLen) return value;
    value.resize(maxLen);
    value += "...";
    return value;
}

static ErrorLogContext sanitizeErrorContext_(const ErrorLogContext& input) {
    ErrorLogContext out = input;
    out.flow = trimAscii(out.flow);
    out.functionName = trimAscii(out.functionName);
    out.operation = trimAscii(out.operation);
    out.contextJson = trimAscii(redactSensitiveFieldsInLog(out.contextJson));
    if (out.contextJson.size() > 8000) {
        out.contextJson = truncateWithEllipsis_(out.contextJson, 8000);
    }
    return out;
}

static std::string buildErrorContextPrefix_(const ErrorLogContext& input) {
    const ErrorLogContext context = sanitizeErrorContext_(input);
    std::string prefix;
    if (!context.flow.empty()) {
        prefix += "[flow=" + context.flow + "] ";
    }
    if (!context.functionName.empty()) {
        prefix += "[fn=" + context.functionName + "] ";
    }
    if (!context.operation.empty()) {
        prefix += "[op=" + context.operation + "] ";
    }
    if (!context.contextJson.empty()) {
        prefix += "[ctx=" + truncateWithEllipsis_(context.contextJson, 320) + "] ";
    }
    return prefix;
}

void Logger::logDebug(const std::string& cameraId, const std::string& message) {
    const std::string sanitizedMessage = redactSensitiveFieldsInLog(message);
    const bool important = isImportantMsg(sanitizedMessage);

    // timestamp (HH:MM:SS)
    char buf[32]{};
    try {
        auto now = std::chrono::system_clock::now();
        std::time_t now_c = std::chrono::system_clock::to_time_t(now);
        std::tm tm{};
#ifdef _WIN32
        localtime_s(&tm, &now_c);
#else
        localtime_r(&now_c, &tm);
#endif
        std::strftime(buf, sizeof(buf), "%H:%M:%S", &tm);
    }
    catch (...) {
        std::snprintf(buf, sizeof(buf), "??:??:??");
    }

    std::string line;
    line.reserve(sanitizedMessage.size() + 64);
    line += "[";
    line += buf;
    line += important ? "] [ERROR] " : "] [DEBUG] ";
    line += sanitizedMessage;
    line += "\n";

    LogItem item;
    item.cameraId = cameraId;
    item.line = std::move(line);
    item.rawMessage = sanitizedMessage;
    item.occurredAtIsoUtc = nowUtcIso8601Ms_();
    item.level = important ? "ERROR" : "DEBUG";
    item.errorContext = {};
    item.important = important;

    enqueue_(std::move(item));
}


void Logger::logDebugNoEscalation(const std::string& cameraId, const std::string& message) {
    const std::string sanitizedMessage = redactSensitiveFieldsInLog(message);

    // timestamp (HH:MM:SS)
    char buf[32]{};
    try {
        auto now = std::chrono::system_clock::now();
        std::time_t now_c = std::chrono::system_clock::to_time_t(now);
        std::tm tm{};
#ifdef _WIN32
        localtime_s(&tm, &now_c);
#else
        localtime_r(&now_c, &tm);
#endif
        std::strftime(buf, sizeof(buf), "%H:%M:%S", &tm);
    }
    catch (...) {
        std::snprintf(buf, sizeof(buf), "??:??:??");
    }

    std::string line;
    line.reserve(sanitizedMessage.size() + 64);
    line += "[";
    line += buf;
    line += "] [DEBUG] ";
    line += sanitizedMessage;
    line += "\n";

    LogItem item;
    item.cameraId = cameraId;
    item.line = std::move(line);
    item.rawMessage = sanitizedMessage;
    item.occurredAtIsoUtc = nowUtcIso8601Ms_();
    item.level = "DEBUG";
    item.errorContext = {};
    item.important = false;

    enqueue_(std::move(item));
}

void Logger::logWarning(const std::string& cameraId, const std::string& message) {
    const std::string sanitizedMessage = redactSensitiveFieldsInLog(message);

    char buf[32]{};
    try {
        auto now = std::chrono::system_clock::now();
        std::time_t now_c = std::chrono::system_clock::to_time_t(now);
        std::tm tm{};
#ifdef _WIN32
        localtime_s(&tm, &now_c);
#else
        localtime_r(&now_c, &tm);
#endif
        std::strftime(buf, sizeof(buf), "%H:%M:%S", &tm);
    }
    catch (...) {
        std::snprintf(buf, sizeof(buf), "??:??:??");
    }

    std::string line;
    line.reserve(sanitizedMessage.size() + 64);
    line += "[";
    line += buf;
    line += "] [WARNING] ";
    line += sanitizedMessage;
    line += "\n";

    LogItem item;
    item.cameraId = cameraId;
    item.line = std::move(line);
    item.rawMessage = sanitizedMessage;
    item.occurredAtIsoUtc = nowUtcIso8601Ms_();
    item.level = "WARNING";
    item.errorContext = {};
    item.important = true;

    enqueue_(std::move(item));
}

void Logger::logError(
    const std::string& cameraId,
    const std::string& message,
    const ErrorLogContext& context)
{
    const std::string sanitizedMessage = redactSensitiveFieldsInLog(message);
    const ErrorLogContext sanitizedContext = sanitizeErrorContext_(context);
    const std::string contextPrefix = buildErrorContextPrefix_(sanitizedContext);

    char buf[32]{};
    try {
        auto now = std::chrono::system_clock::now();
        std::time_t now_c = std::chrono::system_clock::to_time_t(now);
        std::tm tm{};
#ifdef _WIN32
        localtime_s(&tm, &now_c);
#else
        localtime_r(&now_c, &tm);
#endif
        std::strftime(buf, sizeof(buf), "%H:%M:%S", &tm);
    }
    catch (...) {
        std::snprintf(buf, sizeof(buf), "??:??:??");
    }

    std::string line;
    line.reserve(contextPrefix.size() + sanitizedMessage.size() + 64);
    line += "[";
    line += buf;
    line += "] [ERROR] ";
    line += contextPrefix;
    line += sanitizedMessage;
    line += "\n";

    LogItem item;
    item.cameraId = cameraId;
    item.line = std::move(line);
    item.rawMessage = sanitizedMessage;
    item.occurredAtIsoUtc = nowUtcIso8601Ms_();
    item.level = "ERROR";
    item.errorContext = sanitizedContext;
    item.important = true;

    enqueue_(std::move(item));
}

void Logger::logException(
    const std::string& cameraId,
    const ErrorLogContext& context,
    const std::exception& ex)
{
    logError(cameraId, std::string("exception: ") + ex.what(), context);
}

void Logger::logUnknownException(
    const std::string& cameraId,
    const ErrorLogContext& context)
{
    logError(cameraId, "unknown exception", context);
}

void Logger::logCameraSample(const std::string& cameraId,
    long long frame_time_ms,
    double inferenceLatencyMs,
    double cpuMemPercent,
    double gpuMemPercent,
    double cpuUsagePercent,
    double gpuUsagePercent)
{
    std::ostringstream oss;
    oss << std::left
        << std::setw(16) << frame_time_ms
        << std::setw(8) << cameraId
        << std::setw(12) << std::fixed << std::setprecision(1) << inferenceLatencyMs
        << std::setw(12) << std::setprecision(1) << cpuMemPercent
        << std::setw(12) << std::setprecision(1) << gpuMemPercent
        << std::setw(12) << std::setprecision(1) << cpuUsagePercent
        << std::setw(12) << std::setprecision(1) << gpuUsagePercent
        << "\n";

    LogItem item;
    item.cameraId = cameraId;
    item.line = oss.str();
    item.important = false;
    enqueue_(std::move(item));
}

CameraLogStream* Logger::getOrCreateStream_(const std::string& cameraId) noexcept {
    const std::string streamId = cameraId.empty() ? "agent" : cameraId;

    auto it = streams_.find(streamId);
    if (it != streams_.end()) return &it->second;

    CameraLogStream s;

    std::string filename = logDir_ + "/" + streamId + ".log";
    try {
        s.stream.open(filename, std::ios::app);
        if (!s.stream.is_open()) {
            s.disabled = true;
            safeCerr("[Logger] Failed to open log file: " + filename + " (disabled for stream " + streamId + ")");
        }
    }
    catch (...) {
        s.disabled = true;
        safeCerr("[Logger] Exception opening log file: " + filename + " (disabled for stream " + streamId + ")");
    }

    auto [insIt, _] = streams_.emplace(streamId, std::move(s));
    return &insIt->second;
}

static void writeSampleHeader(std::ofstream& out) {
    out << std::left
        << std::setw(16) << "frame_time_ms"
        << std::setw(8) << "camera"
        << std::setw(12) << "lat_ms"
        << std::setw(12) << "cpu_mem%"
        << std::setw(12) << "gpu_mem%"
        << std::setw(12) << "cpu%"
        << std::setw(12) << "gpu%"
        << "\n";
}

void Logger::errorExportLoop_() noexcept {
    std::vector<ErrorExportItem> batch;
    batch.reserve(512);

    auto nextTick = std::chrono::steady_clock::now() + std::chrono::seconds(30);

    while (!stopping_.load()) {
        {
            std::unique_lock<std::mutex> lk(errorQMutex_);
            errorCv_.wait_until(lk, nextTick, [&] {
                return stopping_.load();
                });
        }

        if (stopping_.load()) {
            break;
        }

        const auto now = std::chrono::steady_clock::now();
        if (now < nextTick) {
            continue;
        }

        nextTick = now + std::chrono::seconds(30);

        const uint64_t droppedNow = droppedError_.exchange(0);
        if (droppedNow > 0) {
            safeCerr("[Logger] errorExportLoop_: dropped " + std::to_string(droppedNow) + " error logs due queue limit");
        }

        while (!stopping_.load()) {
            batch.clear();
            {
                std::lock_guard<std::mutex> lk(errorQMutex_);
                while (!errorQ_.empty() && batch.size() < 512) {
                    batch.push_back(std::move(errorQ_.front()));
                    errorQ_.pop_front();
                }
            }

            if (batch.empty()) {
                break;
            }

            if (!flushErrorBatch_(batch)) {
                safeCerr(
                    "[Logger] errorExportLoop_: failed to flush error logs batch size=" +
                    std::to_string(batch.size())
                );

                // Requeue failed batch at the front; drop newest if queue is full.
                {
                    std::lock_guard<std::mutex> lk(errorQMutex_);
                    for (auto it = batch.rbegin(); it != batch.rend(); ++it) {
                        if (errorQ_.size() >= maxErrorQueue_) {
                            errorQ_.pop_back();
                            droppedError_.fetch_add(1);
                        }
                        errorQ_.push_front(std::move(*it));
                    }
                }
                break;
            }
        }
    }

    // Best-effort final flush on shutdown (bounded to one batch).
    batch.clear();
    {
        std::lock_guard<std::mutex> lk(errorQMutex_);
        while (!errorQ_.empty() && batch.size() < 512) {
            batch.push_back(std::move(errorQ_.front()));
            errorQ_.pop_front();
        }
    }

    if (!batch.empty()) {
        (void)flushErrorBatch_(batch);
    }
}
void Logger::workerLoop_() noexcept {
    std::vector<LogItem> batch;
    batch.reserve(512);

    while (!stopping_.load()) {
        batch.clear();

        // wait for work
        {
            std::unique_lock<std::mutex> lk(qMutex_);
            qCv_.wait_for(lk, std::chrono::milliseconds(200), [&] {
                return stopping_.load() || !q_.empty();
                });

            while (!q_.empty() && batch.size() < 512) {
                batch.push_back(std::move(q_.front()));
                q_.pop_front();
            }
        }

        if (batch.empty()) continue;

                // process batch (NO locks held here)
        for (auto& item : batch) {
            const std::string targetLogId =
                item.important ? "agent" : (item.cameraId.empty() ? "agent" : item.cameraId);

            CameraLogStream* s = getOrCreateStream_(targetLogId);
            if (!s || s->disabled || !s->stream.is_open()) continue;

            try {
                // If this file looks like sample log (you can remove this if you don't want headers)
                // Write header once if file is empty.
                if (!s->headerWritten) {
                    auto pos = s->stream.tellp();
                    if (pos == std::streampos(0)) {
                        // only if it's a new file
                        writeSampleHeader(s->stream);
                        s->stream.flush();
                    }
                    s->headerWritten = true;
                }

                if (item.important && !item.cameraId.empty() && item.cameraId != "agent") {
                    s->stream << "[src=" << item.cameraId << "] ";
                }
                s->stream << item.line;
                s->pendingLines++;

                auto now = std::chrono::steady_clock::now();
                if (s->pendingLines >= 50 || (now - s->lastFlush) > std::chrono::seconds(1)) {
                    s->stream.flush();
                    s->lastFlush = now;
                    s->pendingLines = 0;
                }

                // Console output + async export for important logs only.
                if (item.important) {
                    const std::string sourceId = item.cameraId.empty() ? "agent" : item.cameraId;

                    ErrorExportItem exportItem;
                    exportItem.sourceId = sourceId;
                    exportItem.level = item.level.empty() ? "ERROR" : item.level;
                    exportItem.message = item.rawMessage.empty() ? item.line : item.rawMessage;
                    exportItem.occurredAtIsoUtc = item.occurredAtIsoUtc.empty()
                        ? nowUtcIso8601Ms_()
                        : item.occurredAtIsoUtc;
                    exportItem.context = item.errorContext;
                    enqueueErrorExport_(std::move(exportItem));

                    std::cout << "[" << sourceId << "] " << item.line; // item.line already has \n
                }
            }
            catch (...) {
                s->disabled = true;
                safeCerr("[Logger] Exception writing log for stream " + targetLogId + " (disabled)");
            }
        }
    }

    // Best-effort flush on exit (won't be waited forever due to shutdown timeout)
    try {
        for (auto& kv : streams_) {
            auto& s = kv.second;
            if (s.stream.is_open()) {
                try { s.stream.flush(); }
                catch (...) {}
                try { s.stream.close(); }
                catch (...) {}
            }
        }
    }
    catch (...) {}
}

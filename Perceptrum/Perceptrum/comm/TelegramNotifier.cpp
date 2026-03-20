#include "TelegramNotifier.h"

#include <curl/curl.h>
#include <string>
#include "../logging/Logging.h"

// Desarma o macro do Windows APENAS neste .cpp, sem afetar o resto do projeto
#pragma push_macro("SendMessage")
#ifdef SendMessage
#undef SendMessage
#endif

static size_t WriteToString(char* ptr, size_t size, size_t nmemb, void* userdata)
{
    const size_t total = size * nmemb;
    auto* s = reinterpret_cast<std::string*>(userdata);
    s->append(ptr, total);
    return total;
}


static size_t DiscardWrite(char* ptr, size_t size, size_t nmemb, void* userdata)
{
    (void)ptr; (void)userdata;
    return size * nmemb;
}

static bool CurlPostMultipart(
    const std::string& url,
    curl_mime* mime,
    curl_write_callback writeFn,
    void* writeData,
    long timeoutMs,
    std::string* errOut,
    std::string* respOut)
{
    CURL* curl = curl_easy_init();
    if (!curl) {
        if (errOut) *errOut = "curl_easy_init failed";
        Logger::instance().logDebug("agent", "TelegramNotifier failed: curl_easy_init failed");
        return false;
    }

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_MIMEPOST, mime);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeFn);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, writeData);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, 5000L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, timeoutMs);

    CURLcode rc = curl_easy_perform(curl);

    long http = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http);

    curl_easy_cleanup(curl);

    if (rc != CURLE_OK) {
        if (errOut) *errOut = curl_easy_strerror(rc);
        Logger::instance().logDebug(
            "agent",
            std::string("TelegramNotifier request failed: curl error=") + curl_easy_strerror(rc)
        );
        return false;
    }
    if (http < 200 || http >= 300) {
        if (errOut) {
            std::string r = (respOut ? *respOut : std::string());
            *errOut = "HTTP " + std::to_string(http) + (r.empty() ? "" : (" resp=" + r));
        }
        Logger::instance().logDebug(
            "agent",
            std::string("TelegramNotifier request failed: HTTP ") + std::to_string(http)
        );
        return false;
    }
    return true;
}

bool TelegramNotifier::SendTelegramMessage(const TelegramSettings& cfg,
    const std::string& text,
    std::string* err)
{
    if (cfg.bot_token.empty() || cfg.chat_id.empty()) {
        if (err) *err = "telegram: bot_token/chat_id vazio";
        return false;
    }

    std::string url = "https://api.telegram.org/bot" + cfg.bot_token + "/sendMessage";

    CURL* curl = curl_easy_init();
    if (!curl) {
        if (err) *err = "curl_easy_init falhou";
        Logger::instance().logDebug("agent", "TelegramNotifier::SendTelegramMessage failed: curl_easy_init falhou");
        return false;
    }

    curl_mime* mime = curl_mime_init(curl);
    curl_mimepart* part = nullptr;

    part = curl_mime_addpart(mime);
    curl_mime_name(part, "chat_id");
    curl_mime_data(part, cfg.chat_id.c_str(), CURL_ZERO_TERMINATED);

    part = curl_mime_addpart(mime);
    curl_mime_name(part, "text");
    curl_mime_data(part, text.c_str(), CURL_ZERO_TERMINATED);

    std::string response;
    bool ok = CurlPostMultipart(url, mime, WriteToString, &response, 15000L, err, &response);

    curl_mime_free(mime);
    curl_easy_cleanup(curl);

    return ok;
}

bool TelegramNotifier::SendDocument(const TelegramSettings& cfg,
    const std::string& filePathUtf8,
    const std::string& captionUtf8,
    std::string* err)
{
    if (cfg.bot_token.empty() || cfg.chat_id.empty()) {
        if (err) *err = "telegram: bot_token/chat_id vazio";
        return false;
    }

    std::string url = "https://api.telegram.org/bot" + cfg.bot_token + "/sendDocument";

    CURL* curl = curl_easy_init();
    if (!curl) {
        if (err) *err = "curl_easy_init falhou";
        Logger::instance().logDebug("agent", "TelegramNotifier::SendDocument failed: curl_easy_init falhou");
        return false;
    }

    curl_mime* mime = curl_mime_init(curl);
    curl_mimepart* part = nullptr;

    part = curl_mime_addpart(mime);
    curl_mime_name(part, "chat_id");
    curl_mime_data(part, cfg.chat_id.c_str(), CURL_ZERO_TERMINATED);

    if (!captionUtf8.empty()) {
        part = curl_mime_addpart(mime);
        curl_mime_name(part, "caption");
        curl_mime_data(part, captionUtf8.c_str(), CURL_ZERO_TERMINATED);
    }

    part = curl_mime_addpart(mime);
    curl_mime_name(part, "document");
    curl_mime_filedata(part, filePathUtf8.c_str());

    std::string response;
    bool ok = CurlPostMultipart(url, mime, WriteToString, &response, 30000L, err, &response);

    curl_mime_free(mime);
    curl_easy_cleanup(curl);

    return ok;
}

bool TelegramNotifier::SendVoiceFile(const TelegramSettings& s,
    const std::string& oggPathUtf8,
    const std::string& captionUtf8,
    std::string* errOut)
{
    if (s.bot_token.empty() || s.chat_id.empty()) {
        if (errOut) *errOut = "telegram: bot_token/chat_id vazio";
        return false;
    }

    std::string url = "https://api.telegram.org/bot" + s.bot_token + "/sendVoice";

    CURL* curl = curl_easy_init();
    if (!curl) {
        if (errOut) *errOut = "curl init failed";
        Logger::instance().logDebug("agent", "TelegramNotifier::SendVoiceFile failed: curl init failed");
        return false;
    }

    curl_mime* mime = curl_mime_init(curl);

    curl_mimepart* p = curl_mime_addpart(mime);
    curl_mime_name(p, "chat_id");
    curl_mime_data(p, s.chat_id.c_str(), CURL_ZERO_TERMINATED);

    p = curl_mime_addpart(mime);
    curl_mime_name(p, "voice");
    curl_mime_filedata(p, oggPathUtf8.c_str());

    if (!captionUtf8.empty()) {
        p = curl_mime_addpart(mime);
        curl_mime_name(p, "caption");
        curl_mime_data(p, captionUtf8.c_str(), CURL_ZERO_TERMINATED);
    }

    std::string response;
    bool ok = CurlPostMultipart(url, mime, WriteToString, &response, 30000L, errOut, &response);

    curl_mime_free(mime);
    curl_easy_cleanup(curl);

    return ok;
}

// Restaura o macro como estava, mas só “fora” deste cpp
#pragma pop_macro("SendMessage")

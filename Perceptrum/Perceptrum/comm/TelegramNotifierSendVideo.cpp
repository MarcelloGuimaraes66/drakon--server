#include "TelegramNotifier.h"

#include <curl/curl.h>
#include <string>

#include "../logging/Logging.h"

#pragma push_macro("SendMessage")
#ifdef SendMessage
#undef SendMessage
#endif

namespace {
    size_t WriteToString_(char* ptr, size_t size, size_t nmemb, void* userdata)
    {
        const size_t total = size * nmemb;
        auto* s = reinterpret_cast<std::string*>(userdata);
        s->append(ptr, total);
        return total;
    }

    bool CurlPostMultipart_(
        CURL* curl,
        const std::string& url,
        curl_mime* mime,
        curl_write_callback writeFn,
        void* writeData,
        long timeoutMs,
        std::string* errOut,
        std::string* respOut)
    {
        if (!curl) {
            if (errOut) *errOut = "curl_easy_init failed";
            Logger::instance().logDebug("agent", "TelegramNotifier::SendVideo failed: curl_easy_init failed");
            return false;
        }

        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl, CURLOPT_MIMEPOST, mime);
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeFn);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, writeData);
        curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, 5000L);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, timeoutMs);
        curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);

        CURLcode rc = curl_easy_perform(curl);

        long http = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http);

        if (rc != CURLE_OK) {
            if (errOut) *errOut = curl_easy_strerror(rc);
            Logger::instance().logDebug(
                "agent",
                std::string("TelegramNotifier::SendVideo request failed: curl error=") + curl_easy_strerror(rc)
            );
            return false;
        }

        if (http < 200 || http >= 300) {
            if (errOut) {
                const std::string response = respOut ? *respOut : std::string();
                *errOut = "HTTP " + std::to_string(http) + (response.empty() ? "" : (" resp=" + response));
            }
            Logger::instance().logDebug(
                "agent",
                std::string("TelegramNotifier::SendVideo request failed: HTTP ") + std::to_string(http)
            );
            return false;
        }

        return true;
    }
}

bool TelegramNotifier::SendVideo(const TelegramSettings& cfg,
    const std::string& filePathUtf8,
    const std::string& captionUtf8,
    std::string* err)
{
    if (cfg.bot_token.empty() || cfg.chat_id.empty()) {
        if (err) *err = "telegram: bot_token/chat_id vazio";
        return false;
    }

    std::string url = "https://api.telegram.org/bot" + cfg.bot_token + "/sendVideo";

    CURL* curl = curl_easy_init();
    if (!curl) {
        if (err) *err = "curl_easy_init falhou";
        Logger::instance().logDebug("agent", "TelegramNotifier::SendVideo failed: curl_easy_init falhou");
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
    curl_mime_name(part, "supports_streaming");
    curl_mime_data(part, "true", CURL_ZERO_TERMINATED);

    part = curl_mime_addpart(mime);
    curl_mime_name(part, "video");
    curl_mime_filename(part, "alert.mp4");
    curl_mime_type(part, "video/mp4");
    curl_mime_filedata(part, filePathUtf8.c_str());

    std::string response;
    const bool ok = CurlPostMultipart_(curl, url, mime, WriteToString_, &response, 30000L, err, &response);

    curl_mime_free(mime);
    curl_easy_cleanup(curl);

    return ok;
}

#pragma pop_macro("SendMessage")

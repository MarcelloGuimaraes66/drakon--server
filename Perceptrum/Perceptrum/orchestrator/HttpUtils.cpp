#include "HttpUtils.h"

#include <curl/curl.h>

namespace chatv2 {

namespace {

size_t WriteHttpBody_(void* ptr, size_t size, size_t nmemb, void* userdata)
{
    if (!userdata) return 0;
    auto* output = static_cast<std::string*>(userdata);
    output->append(static_cast<const char*>(ptr), size * nmemb);
    return size * nmemb;
}

} // namespace

HttpResponse postJson(
    const std::string& url,
    const std::string& jsonBody,
    const std::string& bearerToken,
    const std::vector<std::string>& extraHeaders,
    long timeoutMs)
{
    HttpResponse response;
    CURL* curl = curl_easy_init();
    if (!curl) {
        response.error = "curl_easy_init failed";
        return response;
    }

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, jsonBody.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, jsonBody.size());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteHttpBody_);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response.body);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, timeoutMs);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, timeoutMs);

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    if (!bearerToken.empty()) {
        const std::string auth = "Authorization: Bearer " + bearerToken;
        headers = curl_slist_append(headers, auth.c_str());
    }
    for (const auto& header : extraHeaders) {
        if (!header.empty()) {
            headers = curl_slist_append(headers, header.c_str());
        }
    }
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

    const CURLcode result = curl_easy_perform(curl);
    if (result != CURLE_OK) {
        response.error = curl_easy_strerror(result);
    }
    else {
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response.statusCode);
    }

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    return response;
}

HttpResponse putJson(
    const std::string& url,
    const std::string& jsonBody,
    const std::string& bearerToken,
    const std::vector<std::string>& extraHeaders,
    long timeoutMs)
{
    HttpResponse response;
    CURL* curl = curl_easy_init();
    if (!curl) {
        response.error = "curl_easy_init failed";
        return response;
    }

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "PUT");
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, jsonBody.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, jsonBody.size());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteHttpBody_);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response.body);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, timeoutMs);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, timeoutMs);

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    if (!bearerToken.empty()) {
        const std::string auth = "Authorization: Bearer " + bearerToken;
        headers = curl_slist_append(headers, auth.c_str());
    }
    for (const auto& header : extraHeaders) {
        if (!header.empty()) {
            headers = curl_slist_append(headers, header.c_str());
        }
    }
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

    const CURLcode result = curl_easy_perform(curl);
    if (result != CURLE_OK) {
        response.error = curl_easy_strerror(result);
    }
    else {
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response.statusCode);
    }

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    return response;
}

HttpResponse patchJson(
    const std::string& url,
    const std::string& jsonBody,
    const std::string& bearerToken,
    const std::vector<std::string>& extraHeaders,
    long timeoutMs)
{
    HttpResponse response;
    CURL* curl = curl_easy_init();
    if (!curl) {
        response.error = "curl_easy_init failed";
        return response;
    }

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "PATCH");
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, jsonBody.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, jsonBody.size());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteHttpBody_);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response.body);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, timeoutMs);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, timeoutMs);

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    if (!bearerToken.empty()) {
        const std::string auth = "Authorization: Bearer " + bearerToken;
        headers = curl_slist_append(headers, auth.c_str());
    }
    for (const auto& header : extraHeaders) {
        if (!header.empty()) {
            headers = curl_slist_append(headers, header.c_str());
        }
    }
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

    const CURLcode result = curl_easy_perform(curl);
    if (result != CURLE_OK) {
        response.error = curl_easy_strerror(result);
    }
    else {
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response.statusCode);
    }

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    return response;
}

HttpResponse getUrl(
    const std::string& url,
    const std::string& bearerToken,
    const std::vector<std::string>& extraHeaders,
    long timeoutMs)
{
    HttpResponse response;
    CURL* curl = curl_easy_init();
    if (!curl) {
        response.error = "curl_easy_init failed";
        return response;
    }

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPGET, 1L);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteHttpBody_);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response.body);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, timeoutMs);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, timeoutMs);

    struct curl_slist* headers = nullptr;
    if (!bearerToken.empty()) {
        const std::string auth = "Authorization: Bearer " + bearerToken;
        headers = curl_slist_append(headers, auth.c_str());
    }
    for (const auto& header : extraHeaders) {
        if (!header.empty()) {
            headers = curl_slist_append(headers, header.c_str());
        }
    }
    if (headers) {
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    }

    const CURLcode result = curl_easy_perform(curl);
    if (result != CURLE_OK) {
        response.error = curl_easy_strerror(result);
    }
    else {
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response.statusCode);
    }

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    return response;
}

} // namespace chatv2

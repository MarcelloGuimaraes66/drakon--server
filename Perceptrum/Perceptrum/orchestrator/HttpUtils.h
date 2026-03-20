#pragma once

#include <string>
#include <vector>

namespace chatv2 {

struct HttpResponse {
    long statusCode = 0;
    std::string body;
    std::string error;

    bool ok() const {
        return error.empty() && statusCode >= 200 && statusCode < 300;
    }
};

HttpResponse postJson(
    const std::string& url,
    const std::string& jsonBody,
    const std::string& bearerToken = "",
    const std::vector<std::string>& extraHeaders = {},
    long timeoutMs = 15000);

HttpResponse getUrl(
    const std::string& url,
    const std::string& bearerToken = "",
    const std::vector<std::string>& extraHeaders = {},
    long timeoutMs = 5000);

} // namespace chatv2

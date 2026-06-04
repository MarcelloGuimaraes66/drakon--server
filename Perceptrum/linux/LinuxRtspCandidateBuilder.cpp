#include "LinuxRtspCandidateBuilder.h"

#include "../Perceptrum/platform/platform_common.h"

#include <algorithm>
#include <cctype>
#include <set>
#include <sstream>
#include <utility>

namespace {

std::string Trim(std::string value)
{
    return perceptrum::platform::TrimAscii(std::move(value));
}

std::string Lower(std::string value)
{
    value = Trim(std::move(value));
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

std::string JsonString(const nlohmann::json& value, const char* key)
{
    const auto it = value.find(key);
    if (it == value.end() || it->is_null()) {
        return {};
    }
    if (it->is_string()) {
        return Trim(it->get<std::string>());
    }
    if (it->is_number_integer()) {
        return std::to_string(it->get<int>());
    }
    return {};
}

std::string FirstNonEmpty(std::initializer_list<std::string> values)
{
    for (auto value : values) {
        value = Trim(std::move(value));
        if (!value.empty()) {
            return value;
        }
    }
    return {};
}

std::string NormalizeNumericToken(std::string value)
{
    value = Trim(std::move(value));
    if (value.empty()) {
        return {};
    }
    for (const unsigned char ch : value) {
        if (std::isdigit(ch) == 0) {
            return {};
        }
    }
    return value;
}

std::string PercentEncodeUrlComponent(std::string_view value)
{
    static constexpr char kHex[] = "0123456789ABCDEF";
    std::string encoded;
    encoded.reserve(value.size());
    for (const unsigned char ch : value) {
        const bool unreserved =
            (ch >= 'A' && ch <= 'Z') ||
            (ch >= 'a' && ch <= 'z') ||
            (ch >= '0' && ch <= '9') ||
            ch == '-' || ch == '.' || ch == '_' || ch == '~';
        if (unreserved) {
            encoded.push_back(static_cast<char>(ch));
            continue;
        }
        encoded.push_back('%');
        encoded.push_back(kHex[(ch >> 4) & 0x0F]);
        encoded.push_back(kHex[ch & 0x0F]);
    }
    return encoded;
}

std::string ReplaceAll(std::string value, const std::string& needle, const std::string& replacement)
{
    std::size_t pos = 0;
    while ((pos = value.find(needle, pos)) != std::string::npos) {
        value.replace(pos, needle.size(), replacement);
        pos += replacement.size();
    }
    return value;
}

void ReplaceQueryParamValue(std::string& url, const std::string& key, const std::string& newValue)
{
    const std::string needle = key + "=";
    std::size_t pos = 0;
    while ((pos = url.find(needle, pos)) != std::string::npos) {
        const std::size_t valueStart = pos + needle.size();
        std::size_t valueEnd = url.find_first_of("&#? \t\r\n|\"'", valueStart);
        if (valueEnd == std::string::npos) {
            valueEnd = url.size();
        }
        url.replace(valueStart, valueEnd - valueStart, newValue);
        pos = valueStart + newValue.size();
    }
}

void ReplaceHikvisionChannelInPath(std::string& url, const std::string& channelValue)
{
    const std::string marker = "/Streaming/Channels/";
    const std::size_t pos = url.find(marker);
    if (pos == std::string::npos) {
        return;
    }
    std::size_t digitsStart = pos + marker.size();
    std::size_t digitsEnd = digitsStart;
    while (digitsEnd < url.size() &&
           std::isdigit(static_cast<unsigned char>(url[digitsEnd])) != 0) {
        ++digitsEnd;
    }
    if (digitsEnd > digitsStart) {
        url.replace(digitsStart, digitsEnd - digitsStart, channelValue);
    }
}

void PushUnique(std::vector<std::string>& values, std::set<std::string>& seen, std::string value)
{
    value = Trim(std::move(value));
    if (value.empty() || seen.count(value) != 0) {
        return;
    }
    seen.insert(value);
    values.push_back(std::move(value));
}

} // namespace

namespace perceptrum::linux_runtime {

std::vector<std::string> SplitLinuxRtspCandidateList(const std::string& raw)
{
    std::vector<std::string> candidates;
    std::set<std::string> seen;
    std::size_t start = 0;
    while (start <= raw.size()) {
        const std::size_t sep = raw.find('|', start);
        PushUnique(
            candidates,
            seen,
            raw.substr(start, sep == std::string::npos ? std::string::npos : sep - start));
        if (sep == std::string::npos) {
            break;
        }
        start = sep + 1;
    }
    return candidates;
}

std::string MaskLinuxRtspCredentials(std::string value)
{
    const std::size_t scheme = value.find("://");
    if (scheme != std::string::npos) {
        const std::size_t authorityStart = scheme + 3;
        const std::size_t authorityEnd = value.find_first_of("/?#", authorityStart);
        const std::size_t at = value.find('@', authorityStart);
        if (at != std::string::npos &&
            (authorityEnd == std::string::npos || at < authorityEnd)) {
            value.replace(authorityStart, at - authorityStart, "***:***");
        }
    }

    for (const std::string needle : {
             "user=", "username=", "usuario=",
             "password=", "passwd=", "pwd=", "senha=",
         }) {
        std::size_t cursor = 0;
        std::string lowered = value;
        std::transform(lowered.begin(), lowered.end(), lowered.begin(), [](unsigned char ch) {
            return static_cast<char>(std::tolower(ch));
        });
        while ((cursor = lowered.find(needle, cursor)) != std::string::npos) {
            const std::size_t valueStart = cursor + needle.size();
            std::size_t valueEnd = valueStart;
            while (valueEnd < value.size() &&
                   std::string(" \t\r\n,|&;)]}\"'").find(value[valueEnd]) == std::string::npos) {
                ++valueEnd;
            }
            value.replace(valueStart, valueEnd - valueStart, "****");
            lowered.replace(valueStart, valueEnd - valueStart, "****");
            cursor = valueStart + 4;
        }
    }
    return value;
}

std::vector<std::string> BuildLinuxRtspCandidatesFromCameraJson(const nlohmann::json& camera)
{
    if (!camera.is_object()) {
        return {};
    }

    const std::string directUrl = FirstNonEmpty({
        JsonString(camera, "rtsp_url"),
        JsonString(camera, "rtspUrl"),
        JsonString(camera, "stream_url"),
        JsonString(camera, "streamUrl"),
    });
    if (!directUrl.empty()) {
        return SplitLinuxRtspCandidateList(directUrl);
    }

    const std::string ip = FirstNonEmpty({
        JsonString(camera, "ip"),
        JsonString(camera, "ip_address"),
        JsonString(camera, "host"),
    });
    if (ip.empty()) {
        return {};
    }

    std::string port = NormalizeNumericToken(FirstNonEmpty({
        JsonString(camera, "port"),
        JsonString(camera, "rtsp_port"),
        "554",
    }));
    if (port.empty()) {
        port = "554";
    }

    const std::string username = JsonString(camera, "username");
    const std::string password = JsonString(camera, "password");
    const std::string encodedUsername = PercentEncodeUrlComponent(username);
    const std::string encodedPassword = PercentEncodeUrlComponent(password);
    const std::string manufacturer = Lower(JsonString(camera, "manufacturer"));
    const bool isHikvision = manufacturer == "hikvision";
    const bool isDahua = manufacturer == "dahua";
    const bool isIntelbras = manufacturer == "intelbras";
    const bool isAxis = manufacturer == "axis";
    const std::string channelOverride = NormalizeNumericToken(JsonString(camera, "channel"));
    const std::string subtypeOverride = NormalizeNumericToken(JsonString(camera, "subtype"));

    auto make = [&](std::string value) {
        value = ReplaceAll(value, "__RTSP_USERNAME__", encodedUsername);
        value = ReplaceAll(value, "__RTSP_PASSWORD__", encodedPassword);
        value = ReplaceAll(value, "__RTSP_HOST__", ip);
        value = ReplaceAll(value, "__RTSP_PORT__", port);
        return value;
    };

    std::vector<std::string> candidates;
    if (isHikvision) {
        candidates.push_back(make(
            "rtsp://__RTSP_USERNAME__:__RTSP_PASSWORD__@__RTSP_HOST__:__RTSP_PORT__/Streaming/Channels/101"));
    } else if (isDahua) {
        candidates.push_back(make(
            "rtsp://__RTSP_USERNAME__:__RTSP_PASSWORD__@__RTSP_HOST__:__RTSP_PORT__/cam/realmonitor?channel=1&subtype=0"));
        candidates.push_back(make(
            "rtsp://__RTSP_USERNAME__:__RTSP_PASSWORD__@__RTSP_HOST__:__RTSP_PORT__/cam/realmonitor?channel=1&subtype=1"));
    } else if (isIntelbras) {
        candidates.push_back(make(
            "rtsp://__RTSP_USERNAME__:__RTSP_PASSWORD__@__RTSP_HOST__:__RTSP_PORT__/cam/realmonitor?channel=1&subtype=0"));
        candidates.push_back(make(
            "rtsp://__RTSP_USERNAME__:__RTSP_PASSWORD__@__RTSP_HOST__:__RTSP_PORT__/cam/realmonitor?channel=1&subtype=0&unicast=true&proto=Onvif"));
        candidates.push_back(make(
            "rtsp://__RTSP_HOST__:__RTSP_PORT__/user=__RTSP_USERNAME__&password=__RTSP_PASSWORD__&channel=1&stream=0.sdp?"));
    } else if (isAxis) {
        candidates.push_back(make(
            "rtsp://__RTSP_USERNAME__:__RTSP_PASSWORD__@__RTSP_HOST__:__RTSP_PORT__/axis-media/media.amp"));
        candidates.push_back(make(
            "rtsp://__RTSP_USERNAME__:__RTSP_PASSWORD__@__RTSP_HOST__:__RTSP_PORT__/axis-media/media.amp?camera=1"));
    } else if (!username.empty() || !password.empty()) {
        candidates.push_back(
            "rtsp://" + encodedUsername + ":" + encodedPassword + "@" +
            ip + ":" + port + "/Streaming/Channels/101");
    } else {
        candidates.push_back("rtsp://" + ip + ":" + port + "/Streaming/Channels/101");
    }

    for (auto& url : candidates) {
        if (isHikvision && !channelOverride.empty()) {
            ReplaceHikvisionChannelInPath(url, channelOverride);
        }
        if ((isDahua || isIntelbras) && !channelOverride.empty()) {
            ReplaceQueryParamValue(url, "channel", channelOverride);
        }
        if ((isDahua || isIntelbras) && !subtypeOverride.empty()) {
            ReplaceQueryParamValue(url, "subtype", subtypeOverride);
        }
        if (isAxis && !channelOverride.empty()) {
            ReplaceQueryParamValue(url, "camera", channelOverride);
        }
    }

    std::vector<std::string> unique;
    std::set<std::string> seen;
    for (auto& candidate : candidates) {
        PushUnique(unique, seen, std::move(candidate));
    }
    return unique;
}

} // namespace perceptrum::linux_runtime

#pragma once

#include <string>
#include <string_view>

namespace drakon::runtime {

std::string redact_uri_credentials(std::string_view value);
std::string redact_secret_like_values(std::string_view value);
bool contains_unmasked_rtsp_credentials(std::string_view value);

}  // namespace drakon::runtime

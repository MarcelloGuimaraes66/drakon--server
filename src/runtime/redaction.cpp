#include "drakon/runtime/redaction.h"

#include <algorithm>
#include <cctype>
#include <string>
#include <vector>

namespace drakon::runtime {

namespace {

std::string lower_copy(std::string_view value) {
  std::string out(value);
  std::ranges::transform(out, out.begin(), [](unsigned char c) {
    return static_cast<char>(std::tolower(c));
  });
  return out;
}

bool is_uri_boundary(char c) {
  return c == '"' || c == '\'' || std::isspace(static_cast<unsigned char>(c)) != 0;
}

}  // namespace

bool contains_unmasked_rtsp_credentials(std::string_view value) {
  const std::string lower = lower_copy(value);
  std::size_t search_from = 0;

  while (true) {
    const auto scheme_pos = lower.find("rtsp://", search_from);
    if (scheme_pos == std::string::npos) {
      return false;
    }

    const std::size_t authority_begin = scheme_pos + 7;
    std::size_t authority_end = value.size();
    for (std::size_t i = authority_begin; i < value.size(); ++i) {
      if (value[i] == '/' || value[i] == '?' || value[i] == '#' || is_uri_boundary(value[i])) {
        authority_end = i;
        break;
      }
    }

    const std::string authority(value.substr(authority_begin, authority_end - authority_begin));
    const auto at_pos = authority.find('@');
    if (at_pos != std::string::npos) {
      const std::string credentials = authority.substr(0, at_pos);
      if (credentials.find(':') != std::string::npos && credentials.find("***") == std::string::npos) {
        return true;
      }
    }

    search_from = authority_end;
  }
}

std::string redact_uri_credentials(std::string_view value) {
  std::string out(value);
  std::string lower = lower_copy(out);
  std::size_t search_from = 0;

  while (true) {
    const auto scheme_pos = lower.find("rtsp://", search_from);
    if (scheme_pos == std::string::npos) {
      break;
    }

    const std::size_t authority_begin = scheme_pos + 7;
    std::size_t authority_end = out.size();
    for (std::size_t i = authority_begin; i < out.size(); ++i) {
      if (out[i] == '/' || out[i] == '?' || out[i] == '#' || is_uri_boundary(out[i])) {
        authority_end = i;
        break;
      }
    }

    const std::string authority = out.substr(authority_begin, authority_end - authority_begin);
    const auto at_pos = authority.find('@');
    if (at_pos == std::string::npos) {
      search_from = authority_end;
      continue;
    }

    const std::string credentials = authority.substr(0, at_pos);
    std::string replacement = "***@";
    const auto colon_pos = credentials.find(':');
    if (colon_pos != std::string::npos && colon_pos > 0) {
      replacement = credentials.substr(0, colon_pos) + ":***@";
    }

    out.replace(authority_begin, at_pos + 1, replacement);
    lower = lower_copy(out);
    search_from = authority_begin + replacement.size();
  }

  return out;
}

std::string redact_secret_like_values(std::string_view value) {
  std::string out = redact_uri_credentials(value);

  const std::vector<std::string> markers = {
      "api_key=", "token=", "password=", "secret=", "dsn=",
  };

  std::string lower = lower_copy(out);
  for (const auto& marker : markers) {
    std::size_t search_from = 0;
    while (true) {
      const auto pos = lower.find(marker, search_from);
      if (pos == std::string::npos) {
        break;
      }

      const std::size_t value_begin = pos + marker.size();
      std::size_t value_end = out.size();
      for (std::size_t i = value_begin; i < out.size(); ++i) {
        if (out[i] == '&' || out[i] == ';' || is_uri_boundary(out[i])) {
          value_end = i;
          break;
        }
      }

      out.replace(value_begin, value_end - value_begin, "***");
      lower = lower_copy(out);
      search_from = value_begin + 3;
    }
  }

  return out;
}

}  // namespace drakon::runtime

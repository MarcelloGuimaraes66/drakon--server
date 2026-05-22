#pragma once

#include <string>

namespace drakon::database {

struct PostgresConnectionPlan {
  bool configured = false;
  std::string connection_string_ref;
  std::string status = "not-implemented";
};

}  // namespace drakon::database

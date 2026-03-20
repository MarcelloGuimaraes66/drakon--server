#pragma once

#include <string>

namespace PerceptrumCore {
struct HeadlessServiceOptions {
    std::wstring shutdownEventName;
};

int RunHeadlessService(const HeadlessServiceOptions& options);
}

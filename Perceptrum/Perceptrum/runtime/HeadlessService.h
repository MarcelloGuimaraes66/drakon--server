#pragma once

#include "interfaces/IHeadlessRuntime.h"

#include <chrono>
#include <functional>
#include <string>

namespace PerceptrumCore {
struct HeadlessServiceOptions {
    std::wstring shutdownEventName;
};

struct HeadlessServiceDependencies {
    perceptrum::runtime::HeadlessRuntimeContext runtime;
};

int RunHeadlessService(const HeadlessServiceOptions& options);
int RunHeadlessService(const HeadlessServiceOptions& options, HeadlessServiceDependencies& dependencies);
}

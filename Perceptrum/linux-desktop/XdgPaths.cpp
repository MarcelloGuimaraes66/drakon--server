#include "XdgPaths.h"

#include "../Perceptrum/platform/platform_common.h"

#include <cstdlib>

namespace {

std::filesystem::path ReadPathEnv(const char* name) {
    const auto value = perceptrum::platform::TrimAscii(perceptrum::platform::ReadEnvVar(name));
    if (value.empty()) {
        return {};
    }
    return perceptrum::platform::ExpandUserPath(value);
}

std::filesystem::path HomeRelative(const char* suffix) {
    return perceptrum::platform::GetHomeDirectory() / suffix;
}

} // namespace

namespace perceptrum::linux_desktop {

XdgPaths ResolveXdgPaths(std::string_view applicationId) {
    const std::filesystem::path app{std::string(applicationId)};

    XdgPaths paths;
    paths.dataHome = ReadPathEnv("XDG_DATA_HOME");
    if (paths.dataHome.empty()) {
        paths.dataHome = HomeRelative(".local/share");
    }

    paths.configHome = ReadPathEnv("XDG_CONFIG_HOME");
    if (paths.configHome.empty()) {
        paths.configHome = HomeRelative(".config");
    }

    paths.cacheHome = ReadPathEnv("XDG_CACHE_HOME");
    if (paths.cacheHome.empty()) {
        paths.cacheHome = HomeRelative(".cache");
    }

    paths.runtimeDir = ReadPathEnv("XDG_RUNTIME_DIR");

    paths.dataHome /= app;
    paths.configHome /= app;
    paths.cacheHome /= app;
    if (!paths.runtimeDir.empty()) {
        paths.runtimeDir /= app;
    }

    return paths;
}

} // namespace perceptrum::linux_desktop

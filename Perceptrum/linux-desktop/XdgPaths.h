#pragma once

#include <filesystem>
#include <string_view>

namespace perceptrum::linux_desktop {

struct XdgPaths {
    std::filesystem::path dataHome;
    std::filesystem::path configHome;
    std::filesystem::path cacheHome;
    std::filesystem::path runtimeDir;
};

XdgPaths ResolveXdgPaths(std::string_view applicationId);

} // namespace perceptrum::linux_desktop

#include "pch.h"
#include "SecureLocalStore.h"

#include <platform/platform_secure_store.h>

namespace DrakonDesktop::platform
{
    std::optional<std::string> ReadProtectedLocalText(std::filesystem::path const& path)
    {
        return perceptrum::platform::ReadProtectedLocalText(path);
    }

    std::optional<std::string> ReadProtectedLocalTextStrict(std::filesystem::path const& path)
    {
        return perceptrum::platform::ReadProtectedLocalTextStrict(path);
    }

    bool ProtectedLocalTextNeedsQuarantine(std::filesystem::path const& path)
    {
        return perceptrum::platform::ProtectedLocalTextNeedsQuarantine(path);
    }

    bool WriteProtectedLocalText(std::filesystem::path const& path, std::string_view value)
    {
        return perceptrum::platform::WriteProtectedLocalText(path, value);
    }

    void RemoveProtectedLocalText(std::filesystem::path const& path) noexcept
    {
        perceptrum::platform::RemoveProtectedLocalText(path);
    }
}

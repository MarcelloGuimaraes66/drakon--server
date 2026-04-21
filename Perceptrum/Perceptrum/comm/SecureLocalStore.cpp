#include "SecureLocalStore.h"

#include "../platform/platform_secure_store.h"

namespace securelocal
{
    std::optional<std::string> ReadProtectedLocalText(const std::filesystem::path& path)
    {
        return perceptrum::platform::ReadProtectedLocalText(path);
    }

    bool WriteProtectedLocalText(const std::filesystem::path& path, std::string_view value)
    {
        return perceptrum::platform::WriteProtectedLocalText(path, value);
    }
}

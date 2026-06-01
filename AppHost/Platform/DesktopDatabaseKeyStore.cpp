#include "pch.h"
#include "DesktopDatabaseKeyStore.h"

#include "SecureLocalStore.h"

#include <Windows.h>
#include <bcrypt.h>

#include <algorithm>
#include <array>
#include <cctype>

namespace
{
    constexpr wchar_t kDesktopSqliteKeyFileName[] = L"sqlite_key_v1.txt";
    constexpr size_t kDesktopSqliteKeyBytes = 32;

    bool IsHexCharacter(unsigned char value) noexcept
    {
        return std::isdigit(value) != 0 || (value >= 'a' && value <= 'f') || (value >= 'A' && value <= 'F');
    }

    std::optional<std::string> NormalizeHex(std::string value)
    {
        if (value.size() != (kDesktopSqliteKeyBytes * 2))
        {
            return std::nullopt;
        }

        for (auto& ch : value)
        {
            auto const unsignedCh = static_cast<unsigned char>(ch);
            if (!IsHexCharacter(unsignedCh))
            {
                return std::nullopt;
            }

            ch = static_cast<char>(std::tolower(unsignedCh));
        }

        return value;
    }

    std::string BytesToHex(std::array<unsigned char, kDesktopSqliteKeyBytes> const& bytes)
    {
        constexpr char hexDigits[] = "0123456789abcdef";

        std::string value;
        value.reserve(bytes.size() * 2);
        for (auto const byte : bytes)
        {
            value.push_back(hexDigits[(byte >> 4) & 0x0F]);
            value.push_back(hexDigits[byte & 0x0F]);
        }

        return value;
    }

    std::optional<std::array<unsigned char, kDesktopSqliteKeyBytes>> GenerateRandomKey()
    {
        std::array<unsigned char, kDesktopSqliteKeyBytes> bytes{};
        auto const status = BCryptGenRandom(
            nullptr,
            bytes.data(),
            static_cast<ULONG>(bytes.size()),
            BCRYPT_USE_SYSTEM_PREFERRED_RNG);
        if (status < 0)
        {
            return std::nullopt;
        }

        return bytes;
    }
}

namespace DrakonDesktop::platform
{
    std::filesystem::path DesktopSqliteKeyPath(std::filesystem::path const& serviceSessionDirectory)
    {
        return serviceSessionDirectory / kDesktopSqliteKeyFileName;
    }

    std::optional<std::string> GetOrCreateDesktopSqliteKeyHex(std::filesystem::path const& serviceSessionDirectory)
    {
        auto const keyPath = DesktopSqliteKeyPath(serviceSessionDirectory);
        if (std::filesystem::exists(keyPath))
        {
            auto const existing = ReadProtectedLocalTextStrict(keyPath);
            if (!existing.has_value())
            {
                return std::nullopt;
            }

            auto const normalized = NormalizeHex(*existing);
            if (!normalized.has_value())
            {
                return std::nullopt;
            }

            std::error_code errorCode;
            auto const encodedSize = std::filesystem::file_size(keyPath, errorCode);
            if (!errorCode && (encodedSize % 4) != 0)
            {
                WriteProtectedLocalText(keyPath, *normalized);
            }

            return normalized;
        }

        auto const generated = GenerateRandomKey();
        if (!generated.has_value())
        {
            return std::nullopt;
        }

        auto const keyHex = BytesToHex(*generated);
        if (!WriteProtectedLocalText(keyPath, keyHex))
        {
            return std::nullopt;
        }

        auto const persisted = ReadProtectedLocalTextStrict(keyPath);
        if (!persisted.has_value())
        {
            return std::nullopt;
        }

        return NormalizeHex(*persisted);
    }
}

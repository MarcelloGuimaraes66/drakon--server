#include "pch.h"
#include "SecureLocalStore.h"

#include <Windows.h>
#include <wincrypt.h>

#include <cctype>
#include <fstream>
#include <memory>
#include <sstream>
#include <type_traits>
#include <utility>

namespace
{
    std::string TrimAscii(std::string value)
    {
        auto isSpace = [](unsigned char ch) { return std::isspace(ch) != 0; };
        while (!value.empty() && isSpace(static_cast<unsigned char>(value.front())))
        {
            value.erase(value.begin());
        }
        while (!value.empty() && isSpace(static_cast<unsigned char>(value.back())))
        {
            value.pop_back();
        }
        return value;
    }

    bool LooksLikeBase64(std::string const& value)
    {
        bool seenPadding = false;
        for (auto const ch : value)
        {
            auto const unsignedCh = static_cast<unsigned char>(ch);
            auto const isBase64Character =
                std::isalnum(unsignedCh) != 0 || ch == '+' || ch == '/' || ch == '=';
            if (!isBase64Character)
            {
                return false;
            }

            if (ch == '=')
            {
                seenPadding = true;
                continue;
            }

            if (seenPadding)
            {
                return false;
            }
        }

        return !value.empty();
    }

    std::string FileEntropy(std::filesystem::path const& path)
    {
        auto const fileName = path.filename().string();
        return "DrakonDesktop|" + (fileName.empty() ? path.string() : fileName);
    }

    std::optional<std::string> ReadRawFile(std::filesystem::path const& path)
    {
        std::ifstream stream(path, std::ios::binary);
        if (!stream)
        {
            return std::nullopt;
        }

        std::ostringstream buffer;
        buffer << stream.rdbuf();
        return TrimAscii(buffer.str());
    }

    std::optional<std::string> EncodeBase64(DATA_BLOB const& blob)
    {
        DWORD required = 0;
        if (!CryptBinaryToStringA(
            blob.pbData,
            blob.cbData,
            CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF,
            nullptr,
            &required))
        {
            return std::nullopt;
        }

        std::string encoded(static_cast<size_t>(required), '\0');
        if (!CryptBinaryToStringA(
            blob.pbData,
            blob.cbData,
            CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF,
            encoded.data(),
            &required))
        {
            return std::nullopt;
        }

        encoded.resize(static_cast<size_t>(required));
        while (!encoded.empty() && encoded.back() == '\0')
        {
            encoded.pop_back();
        }
        return encoded;
    }

    std::optional<std::string> DecodeBase64Exact(std::string const& encoded)
    {
        DWORD required = 0;
        if (!CryptStringToBinaryA(
            encoded.c_str(),
            0,
            CRYPT_STRING_BASE64,
            nullptr,
            &required,
            nullptr,
            nullptr))
        {
            return std::nullopt;
        }

        std::string decoded(static_cast<size_t>(required), '\0');
        if (!CryptStringToBinaryA(
            encoded.c_str(),
            0,
            CRYPT_STRING_BASE64,
            reinterpret_cast<BYTE*>(decoded.data()),
            &required,
            nullptr,
            nullptr))
        {
            return std::nullopt;
        }

        decoded.resize(required);
        return decoded;
    }

    std::optional<std::string> DecodeBase64(std::string const& encoded)
    {
        if (auto decoded = DecodeBase64Exact(encoded))
        {
            return decoded;
        }

        // Older builds truncated the final base64 padding character when
        // persisting DPAPI blobs. Add the missing padding back so those
        // installs can recover in place.
        if (!LooksLikeBase64(encoded) || (encoded.size() % 4) == 0)
        {
            return std::nullopt;
        }

        auto legacyEncoded = encoded;
        while ((legacyEncoded.size() % 4) != 0)
        {
            legacyEncoded.push_back('=');
        }

        return DecodeBase64Exact(legacyEncoded);
    }

    std::optional<std::string> ProtectText(std::string_view plainText, std::filesystem::path const& path)
    {
        auto const entropy = FileEntropy(path);

        DATA_BLOB inputBlob{};
        inputBlob.cbData = static_cast<DWORD>(plainText.size());
        inputBlob.pbData = reinterpret_cast<BYTE*>(const_cast<char*>(plainText.data()));

        DATA_BLOB entropyBlob{};
        entropyBlob.cbData = static_cast<DWORD>(entropy.size());
        entropyBlob.pbData = reinterpret_cast<BYTE*>(const_cast<char*>(entropy.data()));

        DATA_BLOB outputBlob{};
        if (!CryptProtectData(
            &inputBlob,
            L"DrakonDesktop local secret",
            &entropyBlob,
            nullptr,
            nullptr,
            CRYPTPROTECT_UI_FORBIDDEN,
            &outputBlob))
        {
            return std::nullopt;
        }

        std::unique_ptr<std::remove_pointer_t<BYTE>[], decltype(&LocalFree)> outputGuard(outputBlob.pbData, &LocalFree);
        return EncodeBase64(outputBlob);
    }

    std::optional<std::string> UnprotectText(std::string const& encoded, std::filesystem::path const& path)
    {
        auto const encrypted = DecodeBase64(encoded);
        if (!encrypted.has_value())
        {
            return std::nullopt;
        }

        auto const entropy = FileEntropy(path);

        DATA_BLOB inputBlob{};
        inputBlob.cbData = static_cast<DWORD>(encrypted->size());
        inputBlob.pbData = reinterpret_cast<BYTE*>(const_cast<char*>(encrypted->data()));

        DATA_BLOB entropyBlob{};
        entropyBlob.cbData = static_cast<DWORD>(entropy.size());
        entropyBlob.pbData = reinterpret_cast<BYTE*>(const_cast<char*>(entropy.data()));

        DATA_BLOB outputBlob{};
        if (!CryptUnprotectData(
            &inputBlob,
            nullptr,
            &entropyBlob,
            nullptr,
            nullptr,
            CRYPTPROTECT_UI_FORBIDDEN,
            &outputBlob))
        {
            return std::nullopt;
        }

        std::unique_ptr<std::remove_pointer_t<BYTE>[], decltype(&LocalFree)> outputGuard(outputBlob.pbData, &LocalFree);
        return std::string(
            reinterpret_cast<char const*>(outputBlob.pbData),
            reinterpret_cast<char const*>(outputBlob.pbData) + outputBlob.cbData);
    }
}

namespace DrakonDesktop::platform
{
    std::optional<std::string> ReadProtectedLocalText(std::filesystem::path const& path)
    {
        auto const raw = ReadRawFile(path);
        if (!raw.has_value() || raw->empty())
        {
            return std::nullopt;
        }

        auto decrypted = UnprotectText(*raw, path);
        if (decrypted.has_value())
        {
            return *decrypted;
        }

        return *raw;
    }

    std::optional<std::string> ReadProtectedLocalTextStrict(std::filesystem::path const& path)
    {
        auto const raw = ReadRawFile(path);
        if (!raw.has_value() || raw->empty())
        {
            return std::nullopt;
        }

        return UnprotectText(*raw, path);
    }

    bool WriteProtectedLocalText(std::filesystem::path const& path, std::string_view value)
    {
        auto const encrypted = ProtectText(value, path);
        if (!encrypted.has_value())
        {
            return false;
        }

        std::error_code errorCode;
        std::filesystem::create_directories(path.parent_path(), errorCode);

        std::ofstream stream(path, std::ios::binary | std::ios::trunc);
        if (!stream)
        {
            return false;
        }

        stream << *encrypted;
        return stream.good();
    }

    void RemoveProtectedLocalText(std::filesystem::path const& path) noexcept
    {
        std::error_code errorCode;
        std::filesystem::remove(path, errorCode);
    }
}

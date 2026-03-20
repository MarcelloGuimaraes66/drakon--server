#include "SecureLocalStore.h"

#include <Windows.h>
#include <wincrypt.h>

#include <cctype>
#include <fstream>
#include <memory>
#include <sstream>
#include <system_error>
#include <type_traits>

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

    std::string FileEntropy(const std::filesystem::path& path)
    {
        const auto fileName = path.filename().string();
        return "DrakonDesktop|" + (fileName.empty() ? path.string() : fileName);
    }

    std::optional<std::string> ReadRawFile(const std::filesystem::path& path)
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

    std::optional<std::string> EncodeBase64(const DATA_BLOB& blob)
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

        encoded.resize(required > 0 ? static_cast<size_t>(required) - 1 : 0);
        return encoded;
    }

    std::optional<std::string> DecodeBase64(const std::string& encoded)
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

    std::optional<std::string> ProtectText(std::string_view plainText, const std::filesystem::path& path)
    {
        const auto entropy = FileEntropy(path);

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

        std::unique_ptr<std::remove_pointer_t<BYTE>, decltype(&LocalFree)> outputGuard(outputBlob.pbData, &LocalFree);
        return EncodeBase64(outputBlob);
    }

    std::optional<std::string> UnprotectText(const std::string& encoded, const std::filesystem::path& path)
    {
        const auto encrypted = DecodeBase64(encoded);
        if (!encrypted.has_value())
        {
            return std::nullopt;
        }

        const auto entropy = FileEntropy(path);

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

        std::unique_ptr<std::remove_pointer_t<BYTE>, decltype(&LocalFree)> outputGuard(outputBlob.pbData, &LocalFree);
        return std::string(
            reinterpret_cast<const char*>(outputBlob.pbData),
            reinterpret_cast<const char*>(outputBlob.pbData) + outputBlob.cbData);
    }
}

namespace securelocal
{
    std::optional<std::string> ReadProtectedLocalText(const std::filesystem::path& path)
    {
        const auto raw = ReadRawFile(path);
        if (!raw.has_value() || raw->empty())
        {
            return std::nullopt;
        }

        const auto decrypted = UnprotectText(*raw, path);
        if (decrypted.has_value())
        {
            return *decrypted;
        }

        return *raw;
    }

    bool WriteProtectedLocalText(const std::filesystem::path& path, std::string_view value)
    {
        const auto encrypted = ProtectText(value, path);
        if (!encrypted.has_value())
        {
            return false;
        }

        if (path.has_parent_path())
        {
            std::error_code errorCode;
            std::filesystem::create_directories(path.parent_path(), errorCode);
        }

        std::ofstream stream(path, std::ios::binary | std::ios::trunc);
        if (!stream)
        {
            return false;
        }

        stream << *encrypted;
        return stream.good();
    }
}

#include "platform_secure_store.h"

#include "platform_common.h"

#include <array>
#include <cctype>
#include <fstream>
#include <memory>
#include <sstream>
#include <type_traits>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <wincrypt.h>
#endif

namespace {

using perceptrum::platform::TrimAscii;

std::optional<std::string> NormalizePlainText(std::string value)
{
    if (value.find('\0') != std::string::npos) {
        return std::nullopt;
    }

    value = TrimAscii(std::move(value));
    if (value.empty()) {
        return std::nullopt;
    }

    return value;
}

bool LooksLikeBase64(std::string_view value)
{
    if (value.empty()) {
        return false;
    }

    bool seenPadding = false;
    for (const char ch : value) {
        const unsigned char unsignedCh = static_cast<unsigned char>(ch);
        const bool isBase64Character =
            std::isalnum(unsignedCh) != 0 || ch == '+' || ch == '/' || ch == '=';
        if (!isBase64Character) {
            return false;
        }

        if (ch == '=') {
            seenPadding = true;
            continue;
        }

        if (seenPadding) {
            return false;
        }
    }

    return true;
}

std::optional<std::string> ReadRawFile(const std::filesystem::path& path)
{
    std::ifstream stream(path, std::ios::binary);
    if (!stream.is_open()) {
        return std::nullopt;
    }

    std::ostringstream buffer;
    buffer << stream.rdbuf();
    return TrimAscii(buffer.str());
}

std::string FileEntropyWithPrefix(
    const std::filesystem::path& path,
    std::string_view prefix)
{
    const auto fileName = path.filename().string();
    return std::string(prefix) + (fileName.empty() ? path.string() : fileName);
}

std::string CanonicalFileEntropy(const std::filesystem::path& path)
{
    // Preserve the legacy DPAPI entropy so previously provisioned desktop
    // secrets remain readable after the shared platform refactor.
    return FileEntropyWithPrefix(path, "DrakonDesktop|");
}

std::array<std::string, 2> FileEntropyCandidates(const std::filesystem::path& path)
{
    return {
        CanonicalFileEntropy(path),
        FileEntropyWithPrefix(path, "PerceptrumShared|"),
    };
}

std::optional<std::string> EncodeBase64(std::string_view input)
{
    static constexpr char kBase64Table[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    std::string output;
    output.reserve(((input.size() + 2) / 3) * 4);

    size_t index = 0;
    while (index + 3 <= input.size()) {
        const auto a = static_cast<unsigned char>(input[index++]);
        const auto b = static_cast<unsigned char>(input[index++]);
        const auto c = static_cast<unsigned char>(input[index++]);

        output.push_back(kBase64Table[(a >> 2) & 0x3F]);
        output.push_back(kBase64Table[((a & 0x03) << 4) | ((b >> 4) & 0x0F)]);
        output.push_back(kBase64Table[((b & 0x0F) << 2) | ((c >> 6) & 0x03)]);
        output.push_back(kBase64Table[c & 0x3F]);
    }

    const size_t remaining = input.size() - index;
    if (remaining == 1) {
        const auto a = static_cast<unsigned char>(input[index]);
        output.push_back(kBase64Table[(a >> 2) & 0x3F]);
        output.push_back(kBase64Table[(a & 0x03) << 4]);
        output.push_back('=');
        output.push_back('=');
    }
    else if (remaining == 2) {
        const auto a = static_cast<unsigned char>(input[index]);
        const auto b = static_cast<unsigned char>(input[index + 1]);
        output.push_back(kBase64Table[(a >> 2) & 0x3F]);
        output.push_back(kBase64Table[((a & 0x03) << 4) | ((b >> 4) & 0x0F)]);
        output.push_back(kBase64Table[(b & 0x0F) << 2]);
        output.push_back('=');
    }

    return output;
}

std::optional<std::string> DecodeBase64(std::string value)
{
    value = TrimAscii(std::move(value));
    if (value.empty() || !LooksLikeBase64(value)) {
        return std::nullopt;
    }

    while ((value.size() % 4) != 0) {
        value.push_back('=');
    }

    static const std::array<int, 256> kDecodeTable = [] {
        std::array<int, 256> table{};
        table.fill(-1);

        for (int index = 0; index < 26; ++index) {
            table[static_cast<size_t>('A' + index)] = index;
            table[static_cast<size_t>('a' + index)] = 26 + index;
        }
        for (int index = 0; index < 10; ++index) {
            table[static_cast<size_t>('0' + index)] = 52 + index;
        }
        table[static_cast<size_t>('+')] = 62;
        table[static_cast<size_t>('/')] = 63;
        return table;
    }();

    std::string output;
    output.reserve((value.size() / 4) * 3);

    for (size_t index = 0; index < value.size(); index += 4) {
        const unsigned char c0 = static_cast<unsigned char>(value[index + 0]);
        const unsigned char c1 = static_cast<unsigned char>(value[index + 1]);
        const unsigned char c2 = static_cast<unsigned char>(value[index + 2]);
        const unsigned char c3 = static_cast<unsigned char>(value[index + 3]);

        if (kDecodeTable[c0] < 0 || kDecodeTable[c1] < 0) {
            return std::nullopt;
        }

        const unsigned int b0 = static_cast<unsigned int>(kDecodeTable[c0]);
        const unsigned int b1 = static_cast<unsigned int>(kDecodeTable[c1]);
        const unsigned int b2 = c2 == '=' ? 0u : static_cast<unsigned int>(kDecodeTable[c2]);
        const unsigned int b3 = c3 == '=' ? 0u : static_cast<unsigned int>(kDecodeTable[c3]);
        if ((c2 != '=' && kDecodeTable[c2] < 0) || (c3 != '=' && kDecodeTable[c3] < 0)) {
            return std::nullopt;
        }

        output.push_back(static_cast<char>((b0 << 2) | (b1 >> 4)));
        if (c2 != '=') {
            output.push_back(static_cast<char>(((b1 & 0x0F) << 4) | (b2 >> 2)));
        }
        if (c3 != '=') {
            output.push_back(static_cast<char>(((b2 & 0x03) << 6) | b3));
        }
    }

    return output;
}

#ifdef _WIN32
std::optional<std::string> ProtectText(
    std::string_view plainText,
    const std::filesystem::path& path)
{
    const std::string entropy = CanonicalFileEntropy(path);

    DATA_BLOB inputBlob{};
    inputBlob.cbData = static_cast<DWORD>(plainText.size());
    inputBlob.pbData = reinterpret_cast<BYTE*>(const_cast<char*>(plainText.data()));

    DATA_BLOB entropyBlob{};
    entropyBlob.cbData = static_cast<DWORD>(entropy.size());
    entropyBlob.pbData = reinterpret_cast<BYTE*>(const_cast<char*>(entropy.data()));

    DATA_BLOB outputBlob{};
    if (!CryptProtectData(
            &inputBlob,
            L"Perceptrum shared secret",
            &entropyBlob,
            nullptr,
            nullptr,
            CRYPTPROTECT_UI_FORBIDDEN,
            &outputBlob)) {
        return std::nullopt;
    }

    std::unique_ptr<std::remove_pointer_t<BYTE>, decltype(&LocalFree)> outputGuard(
        outputBlob.pbData,
        &LocalFree);
    return EncodeBase64(std::string_view(
        reinterpret_cast<const char*>(outputBlob.pbData),
        outputBlob.cbData));
}

std::optional<std::string> UnprotectText(
    const std::string& encoded,
    const std::filesystem::path& path)
{
    const auto encrypted = DecodeBase64(encoded);
    if (!encrypted.has_value()) {
        return std::nullopt;
    }

    DATA_BLOB inputBlob{};
    inputBlob.cbData = static_cast<DWORD>(encrypted->size());
    inputBlob.pbData = reinterpret_cast<BYTE*>(const_cast<char*>(encrypted->data()));

    for (const std::string& entropy : FileEntropyCandidates(path)) {
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
                &outputBlob)) {
            continue;
        }

        std::unique_ptr<std::remove_pointer_t<BYTE>, decltype(&LocalFree)> outputGuard(
            outputBlob.pbData,
            &LocalFree);
        return std::string(
            reinterpret_cast<const char*>(outputBlob.pbData),
            reinterpret_cast<const char*>(outputBlob.pbData) + outputBlob.cbData);
    }

    return std::nullopt;
}
#endif

} // namespace

namespace perceptrum::platform {

bool IsWindowsProtectedBlob(std::string_view value)
{
    return value.size() >= 32 &&
        value.rfind("AQAAANCM", 0) == 0 &&
        LooksLikeBase64(value);
}

std::optional<std::string> ReadProtectedLocalText(const std::filesystem::path& path)
{
    const auto raw = ReadRawFile(path);
    if (!raw.has_value() || raw->empty()) {
        return std::nullopt;
    }

#ifdef _WIN32
    if (const auto decrypted = UnprotectText(*raw, path); decrypted.has_value()) {
        return NormalizePlainText(*decrypted);
    }
#endif

    return NormalizePlainText(*raw);
}

std::optional<std::string> ReadProtectedLocalTextStrict(const std::filesystem::path& path)
{
    const auto raw = ReadRawFile(path);
    if (!raw.has_value() || raw->empty()) {
        return std::nullopt;
    }

#ifdef _WIN32
    if (const auto decrypted = UnprotectText(*raw, path); decrypted.has_value()) {
        return NormalizePlainText(*decrypted);
    }
    return std::nullopt;
#else
    return NormalizePlainText(*raw);
#endif
}

bool ProtectedLocalTextNeedsQuarantine(const std::filesystem::path& path)
{
    const auto raw = ReadRawFile(path);
    if (!raw.has_value()) {
        return false;
    }

    if (raw->empty()) {
        return true;
    }

#ifdef _WIN32
    if (const auto decrypted = UnprotectText(*raw, path); decrypted.has_value()) {
        return !NormalizePlainText(*decrypted).has_value();
    }

    if (IsWindowsProtectedBlob(*raw)) {
        return true;
    }
#endif

    return !NormalizePlainText(*raw).has_value();
}

bool WriteProtectedLocalText(const std::filesystem::path& path, std::string_view value)
{
    const auto normalized = NormalizePlainText(std::string(value));
    if (!normalized.has_value()) {
        return false;
    }

#ifdef _WIN32
    const auto encoded = ProtectText(*normalized, path);
    if (!encoded.has_value()) {
        return false;
    }
    const std::string outputValue = *encoded;
#else
    const std::string outputValue = *normalized;
#endif

    if (path.has_parent_path()) {
        std::error_code errorCode;
        std::filesystem::create_directories(path.parent_path(), errorCode);
    }

    std::ofstream stream(path, std::ios::binary | std::ios::trunc);
    if (!stream.is_open()) {
        return false;
    }

    stream << outputValue;
    return stream.good();
}

void RemoveProtectedLocalText(const std::filesystem::path& path) noexcept
{
    std::error_code errorCode;
    std::filesystem::remove(path, errorCode);
}

} // namespace perceptrum::platform

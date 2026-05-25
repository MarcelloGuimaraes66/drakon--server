#include "platform_secure_store.h"

#include "platform_common.h"

#include <array>
#include <cerrno>
#include <cctype>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <memory>
#include <sstream>
#include <type_traits>
#include <vector>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <wincrypt.h>
#else
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
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

#ifndef _WIN32
bool IsExplicitPlaintextRecoveryAllowed()
{
    const std::string appFlag = TrimAscii(perceptrum::platform::ReadEnvVar("APP_ALLOW_PLAINTEXT_SECRET_RECOVERY"));
    const std::string brandFlag = TrimAscii(perceptrum::platform::ReadEnvVar("PERCEPTRUM_ALLOW_PLAINTEXT_SECRET_RECOVERY"));
    return appFlag == "1" || brandFlag == "1";
}

bool EnsurePrivateParentDirectory(const std::filesystem::path& path)
{
    if (!path.has_parent_path()) {
        return true;
    }

    std::error_code errorCode;
    std::filesystem::create_directories(path.parent_path(), errorCode);
    if (errorCode) {
        return false;
    }

    return ::chmod(path.parent_path().string().c_str(), S_IRWXU) == 0 || errno == ENOENT;
}

bool WritePlaintextRecoveryFile(const std::filesystem::path& path, std::string_view value)
{
    if (!EnsurePrivateParentDirectory(path)) {
        return false;
    }

    const int fd = ::open(
        path.string().c_str(),
        O_WRONLY | O_CREAT | O_TRUNC,
        S_IRUSR | S_IWUSR);
    if (fd < 0) {
        return false;
    }

    (void)::fchmod(fd, S_IRUSR | S_IWUSR);

    const char* cursor = value.data();
    size_t remaining = value.size();
    while (remaining > 0) {
        const ssize_t written = ::write(fd, cursor, remaining);
        if (written < 0) {
            const int savedErrno = errno;
            ::close(fd);
            errno = savedErrno;
            return false;
        }

        cursor += written;
        remaining -= static_cast<size_t>(written);
    }

    const bool closed = ::close(fd) == 0;
    (void)::chmod(path.string().c_str(), S_IRUSR | S_IWUSR);
    return closed;
}

std::filesystem::path ResolveSecretTool()
{
#ifdef __linux__
    const std::string pathValue = perceptrum::platform::ReadEnvVar("PATH");
    std::stringstream stream(pathValue);
    std::string entry;
    while (std::getline(stream, entry, ':')) {
        if (entry.empty()) {
            continue;
        }

        std::filesystem::path candidate = std::filesystem::path(entry) / "secret-tool";
        if (::access(candidate.string().c_str(), X_OK) == 0) {
            return candidate;
        }
    }
#endif

    return {};
}

std::string SecretPathAttribute(const std::filesystem::path& path)
{
    std::error_code errorCode;
    const auto absolute = std::filesystem::absolute(path, errorCode);
    return errorCode ? path.lexically_normal().string() : absolute.lexically_normal().string();
}

bool RunSecretTool(
    const std::vector<std::string>& arguments,
    std::string_view input,
    std::string* output)
{
#ifndef __linux__
    (void)arguments;
    (void)input;
    if (output != nullptr) {
        output->clear();
    }
    return false;
#else
    const auto secretTool = ResolveSecretTool();
    if (secretTool.empty()) {
        return false;
    }

    int stdinPipe[2]{ -1, -1 };
    int stdoutPipe[2]{ -1, -1 };
    if (::pipe(stdinPipe) != 0) {
        return false;
    }
    if (::pipe(stdoutPipe) != 0) {
        ::close(stdinPipe[0]);
        ::close(stdinPipe[1]);
        return false;
    }

    const pid_t childPid = ::fork();
    if (childPid < 0) {
        ::close(stdinPipe[0]);
        ::close(stdinPipe[1]);
        ::close(stdoutPipe[0]);
        ::close(stdoutPipe[1]);
        return false;
    }

    if (childPid == 0) {
        ::dup2(stdinPipe[0], STDIN_FILENO);
        ::dup2(stdoutPipe[1], STDOUT_FILENO);
        ::dup2(stdoutPipe[1], STDERR_FILENO);

        ::close(stdinPipe[0]);
        ::close(stdinPipe[1]);
        ::close(stdoutPipe[0]);
        ::close(stdoutPipe[1]);

        std::vector<std::string> storage;
        storage.reserve(arguments.size() + 1);
        storage.push_back(secretTool.string());
        for (const auto& argument : arguments) {
            storage.push_back(argument);
        }

        std::vector<char*> argv;
        argv.reserve(storage.size() + 1);
        for (auto& argument : storage) {
            argv.push_back(argument.data());
        }
        argv.push_back(nullptr);

        ::execv(secretTool.string().c_str(), argv.data());
        std::_Exit(127);
    }

    ::close(stdinPipe[0]);
    ::close(stdoutPipe[1]);

    if (!input.empty()) {
        const std::string inputText(input);
        (void)::write(stdinPipe[1], inputText.data(), inputText.size());
    }
    ::close(stdinPipe[1]);

    std::string captured;
    std::array<char, 4096> buffer{};
    while (true) {
        const ssize_t bytesRead = ::read(stdoutPipe[0], buffer.data(), buffer.size());
        if (bytesRead <= 0) {
            break;
        }
        captured.append(buffer.data(), buffer.data() + bytesRead);
    }
    ::close(stdoutPipe[0]);

    int status = 0;
    while (::waitpid(childPid, &status, 0) < 0 && errno == EINTR) {
    }

    if (output != nullptr) {
        *output = TrimAscii(std::move(captured));
    }

    return WIFEXITED(status) && WEXITSTATUS(status) == 0;
#endif
}

std::optional<std::string> ReadSecretServiceText(const std::filesystem::path& path)
{
    std::string output;
    const bool ok = RunSecretTool(
        {
            "lookup",
            "application",
            "perceptrum",
            "path",
            SecretPathAttribute(path),
        },
        {},
        &output);
    if (!ok) {
        return std::nullopt;
    }

    return NormalizePlainText(std::move(output));
}

bool WriteSecretServiceText(const std::filesystem::path& path, std::string_view value)
{
    const std::string input = std::string(value) + '\n';
    return RunSecretTool(
        {
            "store",
            "--label=Perceptrum local secret",
            "application",
            "perceptrum",
            "path",
            SecretPathAttribute(path),
        },
        input,
        nullptr);
}

bool RemoveSecretServiceText(const std::filesystem::path& path)
{
    return RunSecretTool(
        {
            "clear",
            "application",
            "perceptrum",
            "path",
            SecretPathAttribute(path),
        },
        {},
        nullptr);
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
#ifndef _WIN32
    if (const auto secret = ReadSecretServiceText(path); secret.has_value()) {
        return secret;
    }
#endif

    const auto raw = ReadRawFile(path);
    if (!raw.has_value() || raw->empty()) {
        return std::nullopt;
    }

#ifdef _WIN32
    if (const auto decrypted = UnprotectText(*raw, path); decrypted.has_value()) {
        return NormalizePlainText(*decrypted);
    }
#else
    if (!IsExplicitPlaintextRecoveryAllowed()) {
        return std::nullopt;
    }
#endif

    return NormalizePlainText(*raw);
}

std::optional<std::string> ReadProtectedLocalTextStrict(const std::filesystem::path& path)
{
#ifndef _WIN32
    if (const auto secret = ReadSecretServiceText(path); secret.has_value()) {
        return secret;
    }
#endif

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
    if (!IsExplicitPlaintextRecoveryAllowed()) {
        return std::nullopt;
    }
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
#else
    if (ReadSecretServiceText(path).has_value()) {
        return false;
    }
    if (!IsExplicitPlaintextRecoveryAllowed()) {
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

    std::string outputValue;

#ifdef _WIN32
    const auto encoded = ProtectText(*normalized, path);
    if (!encoded.has_value()) {
        return false;
    }
    outputValue = *encoded;
#else
    if (WriteSecretServiceText(path, *normalized)) {
        std::error_code errorCode;
        std::filesystem::remove(path, errorCode);
        return true;
    }

    if (!IsExplicitPlaintextRecoveryAllowed()) {
        return false;
    }

    return WritePlaintextRecoveryFile(path, *normalized);
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
#ifndef _WIN32
    (void)RemoveSecretServiceText(path);
#endif
    std::error_code errorCode;
    std::filesystem::remove(path, errorCode);
}

} // namespace perceptrum::platform

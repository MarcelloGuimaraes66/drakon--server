#pragma once

#include <optional>

namespace winrt::DrakonDesktop
{
    struct CameraRecord
    {
        int32_t id{};
        winrt::hstring name;
        winrt::hstring ipAddress;
        winrt::hstring rtspPort;
        winrt::hstring manufacturer;
        winrt::hstring description;
        winrt::hstring username;
        winrt::hstring password;
        winrt::hstring channel;
        winrt::hstring subtype;
        winrt::hstring connectionMethod;
        winrt::hstring street;
        winrt::hstring number;
        winrt::hstring city;
        winrt::hstring state;
        winrt::hstring zipCode;
        winrt::hstring country;
        int32_t retentionDays{ 1 };
        bool allowPublicAccess{ false };
        bool isServiceRunning{ false };
        std::optional<int32_t> webcamIndex;

        bool IsWebcam() const noexcept
        {
            return connectionMethod == L"WEBCAM" || webcamIndex.has_value();
        }
    };
}

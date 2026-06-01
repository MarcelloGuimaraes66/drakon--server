#pragma once
#include <string>
#include "TelegramSettings.h"

class TelegramNotifier {
public:
    static bool SendTelegramMessage(const TelegramSettings& cfg,
        const std::string& text,
        std::string* err = nullptr);

    static bool SendDocument(const TelegramSettings& cfg,
        const std::string& filePathUtf8,
        const std::string& captionUtf8,
        std::string* err);

    static bool SendVideo(const TelegramSettings& cfg,
        const std::string& filePathUtf8,
        const std::string& captionUtf8,
        std::string* err);

    bool SendVoiceFile(const TelegramSettings& s,
        const std::string& oggPathUtf8,
        const std::string& captionUtf8,
        std::string* errOut);
};

#pragma once
#include <string>

struct TelegramSettings {
    bool enabled = false;
    std::string profile;
    std::string chat_id;
    std::string bot_token;
};

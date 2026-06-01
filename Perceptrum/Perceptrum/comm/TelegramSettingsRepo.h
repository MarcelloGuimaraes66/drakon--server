#pragma once
#include <optional>
#include <string>
#include "TelegramSettings.h"

class PgClient;

class TelegramSettingsRepo {
public:
    explicit TelegramSettingsRepo(PgClient* db);
    std::optional<TelegramSettings> GetByUserId(const std::string& userId);
    bool UpsertByUserId(const std::string& userId,
        const TelegramSettings& s,
        std::string* err = nullptr);
private:
    PgClient* db_;
};

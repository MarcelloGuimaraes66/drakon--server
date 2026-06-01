#pragma once

#include "Database.h"

#include <optional>
#include <string>

namespace DrakonDesktop::persistence
{
    struct TelegramSettingsRecord
    {
        bool enabled{ false };
        std::string profile;
        std::string chatId;
        std::string botToken;
    };

    class TelegramSettingsRepository
    {
    public:
        explicit TelegramSettingsRepository(DatabaseConnection& database);

        std::optional<TelegramSettingsRecord> GetByUserId(std::string const& userId);
        bool UpsertByUserId(std::string const& userId, TelegramSettingsRecord const& settings, std::string& errorOut);

    private:
        DatabaseConnection& m_database;
    };
}

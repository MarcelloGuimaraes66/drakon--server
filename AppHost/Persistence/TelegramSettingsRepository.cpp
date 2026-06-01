#include "pch.h"
#include "TelegramSettingsRepository.h"

#include <exception>

namespace DrakonDesktop::persistence
{
    TelegramSettingsRepository::TelegramSettingsRepository(DatabaseConnection& database)
        : m_database(database)
    {
    }

    std::optional<TelegramSettingsRecord> TelegramSettingsRepository::GetByUserId(std::string const& userId)
    {
        auto row = m_database.First(
            "SELECT enabled, profile, chat_id, bot_token "
            "FROM telegram_settings "
            "WHERE user_id = ?",
            { userId });

        if (!row.has_value())
        {
            return std::nullopt;
        }

        TelegramSettingsRecord record;
        record.enabled = GetBool(*row, "enabled", false);
        record.profile = GetString(*row, "profile");
        record.chatId = GetString(*row, "chat_id");
        record.botToken = GetString(*row, "bot_token");
        return record;
    }

    bool TelegramSettingsRepository::UpsertByUserId(
        std::string const& userId,
        TelegramSettingsRecord const& settings,
        std::string& errorOut)
    {
        try
        {
            auto existing = GetByUserId(userId);
            if (existing.has_value())
            {
                m_database.Run(
                    "UPDATE telegram_settings "
                    "SET enabled = ?, profile = ?, chat_id = ?, bot_token = ?, updated_at = CURRENT_TIMESTAMP "
                    "WHERE user_id = ?",
                    { settings.enabled, settings.profile, settings.chatId, settings.botToken, userId });
            }
            else
            {
                m_database.Run(
                    "INSERT INTO telegram_settings(id, user_id, enabled, profile, chat_id, bot_token, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                    { "telegram:" + userId, userId, settings.enabled, settings.profile, settings.chatId, settings.botToken });
            }

            return true;
        }
        catch (std::exception const& ex)
        {
            errorOut = ex.what();
            return false;
        }
    }
}

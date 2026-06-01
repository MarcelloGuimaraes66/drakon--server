#include "TelegramSettingsRepo.h"
#include "PgClient.h"
#include "../logging/Logging.h"
#include <vector>

static bool str_to_bool(const std::string& v) {
    return (v == "t" || v == "true" || v == "1" || v == "TRUE");
}

TelegramSettingsRepo::TelegramSettingsRepo(PgClient* db)
    : db_(db) {
}

std::optional<TelegramSettings> TelegramSettingsRepo::GetByUserId(const std::string& userId)
{
    if (!db_) {
        Logger::instance().logDebug("agent", "TelegramSettingsRepo::GetByUserId failed: db_ null");
        return std::nullopt;
    }

    const std::string sql =
        "SELECT enabled, profile, chat_id, bot_token "
        "FROM public.telegram_settings "
        "WHERE user_id = $1::uuid;";

    PGresult* r = db_->ExecParams(sql, std::vector<std::string>{ userId });
    if (!r) {
        Logger::instance().logDebug("agent", "TelegramSettingsRepo::GetByUserId failed: ExecParams returned null");
        return std::nullopt;
    }

    if (PgClient::Rows(r) <= 0) {
        PgClient::Clear(r);
        return std::nullopt;
    }

    TelegramSettings s;
    s.enabled = str_to_bool(PgClient::GetValue(r, 0, 0));
    s.profile = PgClient::GetValue(r, 0, 1);
    s.chat_id = PgClient::GetValue(r, 0, 2);
    s.bot_token = PgClient::GetValue(r, 0, 3);

    PgClient::Clear(r);
    return s;
}

bool TelegramSettingsRepo::UpsertByUserId(const std::string& userId, const TelegramSettings& s, std::string* err)
{
    if (!db_) {
        if (err) *err = "db_ null";
        Logger::instance().logDebug("agent", "TelegramSettingsRepo::UpsertByUserId failed: db_ null");
        return false;
    }

    const std::string sql =
        "INSERT INTO public.telegram_settings(user_id, enabled, profile, chat_id, bot_token) "
        "VALUES ($1::uuid, $2::boolean, $3, $4, $5) "
        "ON CONFLICT (user_id) DO UPDATE SET "
        "enabled = EXCLUDED.enabled, "
        "profile = EXCLUDED.profile, "
        "chat_id = EXCLUDED.chat_id, "
        "bot_token = EXCLUDED.bot_token;";

    std::vector<std::string> p;
    p.push_back(userId);
    p.push_back(s.enabled ? "true" : "false");
    p.push_back(s.profile);
    p.push_back(s.chat_id);
    p.push_back(s.bot_token);

    PGresult* r = db_->ExecParams(sql, p);
    if (!r) {
        if (err) *err = "ExecParams falhou";
        Logger::instance().logDebug("agent", "TelegramSettingsRepo::UpsertByUserId failed: ExecParams falhou");
        return false;
    }

    PgClient::Clear(r);
    return true;
}

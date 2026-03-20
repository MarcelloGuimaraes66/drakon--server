#include "pch.h"
#include "Database.h"

#include <windows.h>
#include <winsqlite/winsqlite3.h>
#include <libpq-fe.h>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <fstream>
#include <mutex>
#include <regex>
#include <sstream>
#include <stdexcept>

using json = nlohmann::json;

namespace
{
    using namespace DrakonDesktop::persistence;

    struct BrandConfigData
    {
        std::string brandId{ "drakon" };
        std::string dataRootWindows;
    };

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

    std::string ToLowerAscii(std::string value)
    {
        std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch)
        {
            return static_cast<char>(std::tolower(ch));
        });
        return value;
    }

    std::string ReadEnvVar(char const* name)
    {
        char* buffer = nullptr;
        size_t length = 0;
        if (_dupenv_s(&buffer, &length, name) != 0 || buffer == nullptr)
        {
            return {};
        }

        std::string value(buffer);
        free(buffer);
        return TrimAscii(std::move(value));
    }

    std::string ReadTextFileTrimmed(std::filesystem::path const& path)
    {
        std::ifstream stream(path);
        if (!stream)
        {
            return {};
        }

        std::ostringstream buffer;
        buffer << stream.rdbuf();
        return TrimAscii(buffer.str());
    }

    std::string WideToUtf8(std::wstring const& value)
    {
        if (value.empty())
        {
            return {};
        }

        auto const size = WideCharToMultiByte(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
        if (size <= 0)
        {
            return {};
        }

        std::string result(static_cast<size_t>(size), '\0');
        WideCharToMultiByte(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), result.data(), size, nullptr, nullptr);
        return result;
    }

    std::string EscapeConninfoValue(std::string value)
    {
        std::string escaped;
        escaped.reserve(value.size() + 2);
        escaped.push_back('\'');
        for (auto ch : value)
        {
            if (ch == '\\' || ch == '\'')
            {
                escaped.push_back('\\');
            }
            escaped.push_back(ch);
        }
        escaped.push_back('\'');
        return escaped;
    }

    std::string BuildConninfo(PersistenceConfig const& config)
    {
        return "host=" + EscapeConninfoValue(config.postgresHost) +
            " port=" + EscapeConninfoValue(std::to_string(config.postgresPort)) +
            " dbname=" + EscapeConninfoValue(config.postgresDatabase) +
            " user=" + EscapeConninfoValue(config.postgresUser) +
            " password=" + EscapeConninfoValue(config.postgresPassword);
    }

    void ApplyConninfoOverrides(PersistenceConfig& config, std::string const& conninfo)
    {
        if (conninfo.empty())
        {
            config.postgresConninfo = BuildConninfo(config);
            return;
        }

        char* errorMessage = nullptr;
        auto* options = PQconninfoParse(conninfo.c_str(), &errorMessage);
        if (options == nullptr)
        {
            std::string message = errorMessage != nullptr ? errorMessage : "Unknown libpq conninfo parse error.";
            if (errorMessage != nullptr)
            {
                PQfreemem(errorMessage);
            }
            throw std::runtime_error(message);
        }

        for (auto* option = options; option->keyword != nullptr; ++option)
        {
            if (option->val == nullptr)
            {
                continue;
            }

            auto const keyword = std::string(option->keyword);
            auto const value = std::string(option->val);

            if (keyword == "host")
            {
                config.postgresHost = value;
            }
            else if (keyword == "port")
            {
                config.postgresPort = (std::max)(1, std::atoi(value.c_str()));
            }
            else if (keyword == "dbname")
            {
                config.postgresDatabase = value;
            }
            else if (keyword == "user")
            {
                config.postgresUser = value;
            }
            else if (keyword == "password")
            {
                config.postgresPassword = value;
            }
        }

        PQconninfoFree(options);
        if (errorMessage != nullptr)
        {
            PQfreemem(errorMessage);
        }

        config.postgresConninfo = conninfo;
    }

    BrandConfigData LoadBrandConfig(std::filesystem::path const& workspaceRoot)
    {
        BrandConfigData data;

        auto const brandConfigPath = workspaceRoot / "brand.config.json";
        auto const brandSelectorPath = workspaceRoot / "brand.txt";

        auto const selectorValue = ToLowerAscii(ReadTextFileTrimmed(brandSelectorPath));
        if (!selectorValue.empty())
        {
            data.brandId = selectorValue;
        }

        auto const rawConfig = ReadTextFileTrimmed(brandConfigPath);
        if (!rawConfig.empty())
        {
            auto parsed = json::parse(rawConfig, nullptr, false);
            if (parsed.is_object())
            {
                if (selectorValue.empty())
                {
                    auto active = ToLowerAscii(parsed.value("activeBrand", std::string{}));
                    if (!active.empty())
                    {
                        data.brandId = active;
                    }
                }

                if (parsed.contains("brands") && parsed["brands"].is_object())
                {
                    auto brands = parsed["brands"];
                    if (brands.contains(data.brandId) && brands[data.brandId].is_object())
                    {
                        data.dataRootWindows = TrimAscii(brands[data.brandId].value("dataRootWindows", std::string{}));
                    }
                }
            }
        }

        return data;
    }

    std::string BackendToString(PersistenceBackend backend)
    {
        return backend == PersistenceBackend::Sqlite ? "sqlite" : "postgres";
    }

    std::string ModeToString(PersistenceMode mode)
    {
        switch (mode)
        {
        case PersistenceMode::SqliteOnly:
            return "sqlite-only";
        case PersistenceMode::PostgresOnly:
            return "postgres-only";
        default:
            return "dual-compatible";
        }
    }

    std::optional<PersistenceBackend> ParseBackend(std::string value)
    {
        value = ToLowerAscii(TrimAscii(std::move(value)));
        if (value == "sqlite")
        {
            return PersistenceBackend::Sqlite;
        }
        if (value == "postgres")
        {
            return PersistenceBackend::Postgres;
        }
        return std::nullopt;
    }

    std::optional<PersistenceMode> ParseMode(std::string value)
    {
        value = ToLowerAscii(TrimAscii(std::move(value)));
        if (value == "sqlite-only" || value == "sqlite")
        {
            return PersistenceMode::SqliteOnly;
        }
        if (value == "postgres-only" || value == "postgres")
        {
            return PersistenceMode::PostgresOnly;
        }
        if (value == "dual-compatible" || value == "dual" || value == "compatible")
        {
            return PersistenceMode::DualCompatible;
        }
        return std::nullopt;
    }

    std::optional<int64_t> ParseInteger(std::string const& value)
    {
        try
        {
            size_t parsed = 0;
            auto const number = std::stoll(value, &parsed);
            if (parsed == value.size())
            {
                return number;
            }
        }
        catch (...)
        {
        }
        return std::nullopt;
    }

    std::optional<bool> ParseBool(std::string value)
    {
        value = ToLowerAscii(TrimAscii(std::move(value)));
        if (value == "1" || value == "t" || value == "true" || value == "yes" || value == "y")
        {
            return true;
        }
        if (value == "0" || value == "f" || value == "false" || value == "no" || value == "n")
        {
            return false;
        }
        return std::nullopt;
    }

    std::string DbValueToString(DbValue const& value)
    {
        if (std::holds_alternative<std::nullptr_t>(value))
        {
            return {};
        }
        if (auto const* number = std::get_if<int64_t>(&value))
        {
            return std::to_string(*number);
        }
        if (auto const* number = std::get_if<double>(&value))
        {
            std::ostringstream stream;
            stream << *number;
            return stream.str();
        }
        if (auto const* flag = std::get_if<bool>(&value))
        {
            return *flag ? "true" : "false";
        }
        return std::get<std::string>(value);
    }

    DbValue SqliteColumnToValue(sqlite3_stmt* statement, int index)
    {
        switch (sqlite3_column_type(statement, index))
        {
        case SQLITE_INTEGER:
            return static_cast<int64_t>(sqlite3_column_int64(statement, index));
        case SQLITE_FLOAT:
            return sqlite3_column_double(statement, index);
        case SQLITE_NULL:
            return nullptr;
        case SQLITE_BLOB:
        {
            auto const* bytes = static_cast<char const*>(sqlite3_column_blob(statement, index));
            auto const size = sqlite3_column_bytes(statement, index);
            if (bytes == nullptr || size <= 0)
            {
                return std::string{};
            }
            return std::string(bytes, static_cast<size_t>(size));
        }
        case SQLITE_TEXT:
        default:
        {
            auto const* text = reinterpret_cast<char const*>(sqlite3_column_text(statement, index));
            return text != nullptr ? std::string(text) : std::string{};
        }
        }
    }

    void ThrowSqliteError(sqlite3* db, std::string const& action)
    {
        auto const* message = sqlite3_errmsg(db);
        throw std::runtime_error(action + ": " + (message != nullptr ? message : "unknown sqlite error"));
    }

    class SqliteConnection final : public DatabaseConnection
    {
    public:
        explicit SqliteConnection(PersistenceConfig config)
            : DatabaseConnection(std::move(config))
        {
            std::filesystem::create_directories(m_config.sqlitePath.parent_path());
            auto const utf8Path = WideToUtf8(m_config.sqlitePath.wstring());
            if (sqlite3_open_v2(utf8Path.c_str(), &m_db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nullptr) != SQLITE_OK)
            {
                auto message = m_db != nullptr ? sqlite3_errmsg(m_db) : "sqlite3_open_v2 failed";
                throw std::runtime_error(message != nullptr ? message : "sqlite3_open_v2 failed");
            }

            ExecPragma("PRAGMA foreign_keys = ON");
            ExecPragma("PRAGMA journal_mode = WAL");
            ExecPragma("PRAGMA synchronous = NORMAL");
            ExecPragma("PRAGMA busy_timeout = 5000");
        }

        ~SqliteConnection() override
        {
            if (m_db != nullptr)
            {
                sqlite3_close(m_db);
                m_db = nullptr;
            }
        }

        QueryResult All(std::string const& sql, DbParams const& params) override
        {
            auto statement = Prepare(sql);
            BindAll(statement.get(), params);

            QueryResult result;
            while (true)
            {
                auto const rc = sqlite3_step(statement.get());
                if (rc == SQLITE_ROW)
                {
                    DbRow row;
                    auto const columnCount = sqlite3_column_count(statement.get());
                    for (int index = 0; index < columnCount; ++index)
                    {
                        auto const* name = sqlite3_column_name(statement.get(), index);
                        row[name != nullptr ? name : ""] = SqliteColumnToValue(statement.get(), index);
                    }
                    result.rows.push_back(std::move(row));
                    continue;
                }

                if (rc == SQLITE_DONE)
                {
                    break;
                }

                ThrowSqliteError(m_db, "sqlite step failed");
            }

            return result;
        }

        std::optional<DbRow> First(std::string const& sql, DbParams const& params) override
        {
            auto result = All(sql, params);
            if (result.rows.empty())
            {
                return std::nullopt;
            }
            return result.rows.front();
        }

        QueryMeta Run(std::string const& sql, DbParams const& params) override
        {
            auto statement = Prepare(sql);
            BindAll(statement.get(), params);

            while (true)
            {
                auto const rc = sqlite3_step(statement.get());
                if (rc == SQLITE_DONE)
                {
                    break;
                }
                if (rc != SQLITE_ROW)
                {
                    ThrowSqliteError(m_db, "sqlite run failed");
                }
            }

            QueryMeta meta;
            meta.changes = static_cast<int64_t>(sqlite3_changes64(m_db));
            auto const lastId = sqlite3_last_insert_rowid(m_db);
            if (lastId > 0)
            {
                meta.lastRowId = static_cast<int64_t>(lastId);
            }
            return meta;
        }

    private:
        struct StatementDeleter
        {
            void operator()(sqlite3_stmt* statement) const noexcept
            {
                if (statement != nullptr)
                {
                    sqlite3_finalize(statement);
                }
            }
        };

        using StatementPtr = std::unique_ptr<sqlite3_stmt, StatementDeleter>;

        StatementPtr Prepare(std::string const& sql)
        {
            sqlite3_stmt* statement = nullptr;
            if (sqlite3_prepare_v2(m_db, sql.c_str(), -1, &statement, nullptr) != SQLITE_OK)
            {
                ThrowSqliteError(m_db, "sqlite prepare failed");
            }
            return StatementPtr(statement);
        }

        void BindAll(sqlite3_stmt* statement, DbParams const& params)
        {
            for (size_t index = 0; index < params.size(); ++index)
            {
                auto sqliteIndex = static_cast<int>(index + 1);
                auto const& value = params[index];
                int rc = SQLITE_OK;

                if (std::holds_alternative<std::nullptr_t>(value))
                {
                    rc = sqlite3_bind_null(statement, sqliteIndex);
                }
                else if (auto const* number = std::get_if<int64_t>(&value))
                {
                    rc = sqlite3_bind_int64(statement, sqliteIndex, *number);
                }
                else if (auto const* number = std::get_if<double>(&value))
                {
                    rc = sqlite3_bind_double(statement, sqliteIndex, *number);
                }
                else if (auto const* flag = std::get_if<bool>(&value))
                {
                    rc = sqlite3_bind_int(statement, sqliteIndex, *flag ? 1 : 0);
                }
                else if (auto const* text = std::get_if<std::string>(&value))
                {
                    rc = sqlite3_bind_text(statement, sqliteIndex, text->c_str(), static_cast<int>(text->size()), SQLITE_TRANSIENT);
                }

                if (rc != SQLITE_OK)
                {
                    ThrowSqliteError(m_db, "sqlite bind failed");
                }
            }
        }

        void ExecPragma(char const* sql)
        {
            char* errorMessage = nullptr;
            if (sqlite3_exec(m_db, sql, nullptr, nullptr, &errorMessage) != SQLITE_OK)
            {
                std::string message = errorMessage != nullptr ? errorMessage : "sqlite pragma failed";
                if (errorMessage != nullptr)
                {
                    sqlite3_free(errorMessage);
                }
                throw std::runtime_error(message);
            }
        }

        sqlite3* m_db{ nullptr };
    };

    std::string ReplaceParams(std::string const& sql)
    {
        std::string out;
        out.reserve(sql.size() + 8);

        int paramIndex = 0;
        bool inSingle = false;
        bool inDouble = false;

        for (size_t index = 0; index < sql.size(); ++index)
        {
            auto const ch = sql[index];
            if (ch == '\'' && !inDouble)
            {
                inSingle = !inSingle;
                out.push_back(ch);
                continue;
            }

            if (ch == '"' && !inSingle)
            {
                inDouble = !inDouble;
                out.push_back(ch);
                continue;
            }

            if (ch == '?' && !inSingle && !inDouble)
            {
                ++paramIndex;
                out.push_back('$');
                out += std::to_string(paramIndex);
                continue;
            }

            out.push_back(ch);
        }

        return out;
    }

    std::string TranslateGroupConcat(std::string const& sql)
    {
        static const std::regex pattern(R"(GROUP_CONCAT\(\s*([^)]+?)\s*\))", std::regex_constants::icase);
        return std::regex_replace(sql, pattern, "STRING_AGG($1, ',')");
    }

    std::string ReplaceDatetimePattern(std::string const& input, std::regex const& pattern)
    {
        std::string output;
        std::smatch match;
        auto searchStart = input.cbegin();

        while (std::regex_search(searchStart, input.cend(), match, pattern))
        {
            output.append(searchStart, match[0].first);

            auto const amount = std::stoi(match[1].str());
            auto const unit = ToLowerAscii(match[2].str());
            output += "CURRENT_TIMESTAMP ";
            output += amount >= 0 ? "+" : "-";
            output += " INTERVAL '";
            output += std::to_string(std::abs(amount));
            output += " ";
            output += unit;
            output += "'";

            searchStart = match[0].second;
        }

        output.append(searchStart, input.cend());
        return output;
    }

    std::string TranslateDatetime(std::string sql)
    {
        static const std::regex nowPattern(
            R"(datetime\('now'\s*,\s*'([+-]?\d+)\s*(day|month|hour|minute|second)s?'\))",
            std::regex_constants::icase);
        static const std::regex currentPattern(
            R"(datetime\(CURRENT_TIMESTAMP\s*,\s*'([+-]?\d+)\s*(day|month|hour|minute|second)s?'\))",
            std::regex_constants::icase);

        sql = ReplaceDatetimePattern(sql, nowPattern);
        sql = ReplaceDatetimePattern(sql, currentPattern);
        return sql;
    }

    std::string TranslateSql(std::string const& sql)
    {
        return ReplaceParams(TranslateGroupConcat(TranslateDatetime(sql)));
    }

    bool HasReturning(std::string const& sql)
    {
        static const std::regex returningPattern(R"(\breturning\b)", std::regex_constants::icase);
        return std::regex_search(sql, returningPattern);
    }

    bool IsInsert(std::string const& sql)
    {
        static const std::regex insertPattern(R"(^\s*insert\b)", std::regex_constants::icase);
        return std::regex_search(sql, insertPattern);
    }

    std::string ExtractInsertTable(std::string const& sql)
    {
        static const std::regex pattern(R"(insert\s+into\s+([a-zA-Z0-9_."']+))", std::regex_constants::icase);
        std::smatch match;
        if (!std::regex_search(sql, match, pattern))
        {
            return {};
        }

        auto table = match[1].str();
        table.erase(std::remove(table.begin(), table.end(), '"'), table.end());
        table.erase(std::remove(table.begin(), table.end(), '\''), table.end());
        auto const dotIndex = table.find_last_of('.');
        if (dotIndex != std::string::npos)
        {
            table = table.substr(dotIndex + 1);
        }
        return ToLowerAscii(table);
    }

    class PostgresConnection final : public DatabaseConnection
    {
    public:
        explicit PostgresConnection(PersistenceConfig config)
            : DatabaseConnection(std::move(config))
        {
            m_connection = PQconnectdb(m_config.postgresConninfo.c_str());
            if (m_connection == nullptr || PQstatus(m_connection) != CONNECTION_OK)
            {
                auto const* message = m_connection != nullptr ? PQerrorMessage(m_connection) : "PQconnectdb failed";
                throw std::runtime_error(message != nullptr ? message : "PQconnectdb failed");
            }
        }

        ~PostgresConnection() override
        {
            if (m_connection != nullptr)
            {
                PQfinish(m_connection);
                m_connection = nullptr;
            }
        }

        QueryResult All(std::string const& sql, DbParams const& params) override
        {
            auto result = Execute(TranslateSql(sql), params);
            auto const status = PQresultStatus(result.get());
            if (status != PGRES_TUPLES_OK && status != PGRES_COMMAND_OK)
            {
                ThrowPostgresError(result.get(), "postgres query failed");
            }

            QueryResult queryResult;
            auto const rowCount = PQntuples(result.get());
            auto const columnCount = PQnfields(result.get());
            for (int rowIndex = 0; rowIndex < rowCount; ++rowIndex)
            {
                DbRow row;
                for (int columnIndex = 0; columnIndex < columnCount; ++columnIndex)
                {
                    auto const* name = PQfname(result.get(), columnIndex);
                    if (PQgetisnull(result.get(), rowIndex, columnIndex) != 0)
                    {
                        row[name != nullptr ? name : ""] = nullptr;
                        continue;
                    }

                    auto const* value = PQgetvalue(result.get(), rowIndex, columnIndex);
                    row[name != nullptr ? name : ""] = value != nullptr ? std::string(value) : std::string{};
                }

                NormalizeTokenAliases(row);
                queryResult.rows.push_back(std::move(row));
            }

            return queryResult;
        }

        std::optional<DbRow> First(std::string const& sql, DbParams const& params) override
        {
            auto result = All(sql, params);
            if (result.rows.empty())
            {
                return std::nullopt;
            }
            return result.rows.front();
        }

        QueryMeta Run(std::string const& sql, DbParams const& params) override
        {
            auto text = TranslateSql(sql);
            bool expectsId = false;

            if (IsInsert(text) && !HasReturning(text))
            {
                auto const table = ExtractInsertTable(text);
                if (!table.empty() && TableHasId(table))
                {
                    text += " RETURNING id";
                    expectsId = true;
                }
            }
            else if (HasReturning(text))
            {
                expectsId = true;
            }

            auto result = Execute(text, params);
            auto const status = PQresultStatus(result.get());
            if (status != PGRES_TUPLES_OK && status != PGRES_COMMAND_OK)
            {
                ThrowPostgresError(result.get(), "postgres run failed");
            }

            QueryMeta meta;
            auto const* commandTuples = PQcmdTuples(result.get());
            if (commandTuples != nullptr && *commandTuples != '\0')
            {
                meta.changes = std::strtoll(commandTuples, nullptr, 10);
            }

            if (expectsId && PQntuples(result.get()) > 0)
            {
                auto const* value = PQgetvalue(result.get(), 0, 0);
                if (value != nullptr)
                {
                    meta.lastRowId = ParseInteger(value);
                }
            }

            return meta;
        }

    private:
        struct ResultDeleter
        {
            void operator()(PGresult* result) const noexcept
            {
                if (result != nullptr)
                {
                    PQclear(result);
                }
            }
        };

        using ResultPtr = std::unique_ptr<PGresult, ResultDeleter>;

        ResultPtr Execute(std::string const& sql, DbParams const& params)
        {
            std::vector<std::string> valuesStorage;
            valuesStorage.reserve(params.size());

            std::vector<char const*> values;
            values.reserve(params.size());

            for (auto const& parameter : params)
            {
                if (std::holds_alternative<std::nullptr_t>(parameter))
                {
                    valuesStorage.emplace_back();
                    values.push_back(nullptr);
                    continue;
                }

                valuesStorage.push_back(DbValueToString(parameter));
                values.push_back(valuesStorage.back().c_str());
            }

            auto* rawResult = PQexecParams(
                m_connection,
                sql.c_str(),
                static_cast<int>(values.size()),
                nullptr,
                values.empty() ? nullptr : values.data(),
                nullptr,
                nullptr,
                0);

            if (rawResult == nullptr)
            {
                throw std::runtime_error("PQexecParams returned null");
            }

            return ResultPtr(rawResult);
        }

        void ThrowPostgresError(PGresult* result, std::string const& action)
        {
            auto const* message = result != nullptr ? PQresultErrorMessage(result) : PQerrorMessage(m_connection);
            throw std::runtime_error(action + ": " + (message != nullptr ? std::string(message) : "unknown postgres error"));
        }

        bool TableHasId(std::string const& table)
        {
            std::lock_guard lock(m_idCacheMutex);
            if (auto it = m_tableIdCache.find(table); it != m_tableIdCache.end())
            {
                return it->second;
            }

            auto result = Execute(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'id' LIMIT 1",
                { table });

            auto const hasId = PQresultStatus(result.get()) == PGRES_TUPLES_OK && PQntuples(result.get()) > 0;
            m_tableIdCache.emplace(table, hasId);
            return hasId;
        }

        void NormalizeTokenAliases(DbRow& row)
        {
            static const std::pair<char const*, char const*> aliases[] = {
                { "inputtokensm", "InputTokensM" },
                { "outputtokensm", "OutputTokensM" },
                { "inputtokensusedm", "InputTokensUsedM" },
                { "outputtokensusedm", "OutputTokensUsedM" },
            };

            for (auto const& [from, to] : aliases)
            {
                if (row.contains(from) && !row.contains(to))
                {
                    row[to] = row[from];
                }
            }
        }

        PGconn* m_connection{ nullptr };
        std::unordered_map<std::string, bool> m_tableIdCache;
        std::mutex m_idCacheMutex;
    };
}

namespace DrakonDesktop::persistence
{
    DatabaseConnection::DatabaseConnection(PersistenceConfig config)
        : m_config(std::move(config))
    {
    }

    PersistenceConfig const& DatabaseConnection::Config() const noexcept
    {
        return m_config;
    }

    PersistenceConfig ResolvePersistenceConfig(std::filesystem::path const& workspaceRoot)
    {
        PersistenceConfig config;
        config.workspaceRoot = workspaceRoot.empty() ? std::filesystem::path{ L"C:\\dev" } : workspaceRoot;

        auto const brandData = LoadBrandConfig(config.workspaceRoot);
        config.brandId = brandData.brandId.empty() ? "drakon" : brandData.brandId;

        if (auto mode = ParseMode(ReadEnvVar("DRAKON_DB_MODE")))
        {
            config.mode = *mode;
        }

        auto requestedBackend = ParseBackend(ReadEnvVar("DRAKON_DB_BACKEND"));
        if (!requestedBackend.has_value())
        {
            requestedBackend = ParseBackend(ReadEnvVar("APP_DB_BACKEND"));
        }
        if (!requestedBackend.has_value())
        {
            requestedBackend = ParseBackend(ReadEnvVar("LOCAL_DB_BACKEND"));
        }

        if (requestedBackend.has_value())
        {
            config.backend = *requestedBackend;
            config.explicitBackend = true;
        }
        else
        {
            config.backend = config.brandId == "perceptrum"
                ? PersistenceBackend::Sqlite
                : PersistenceBackend::Postgres;
            config.explicitBackend = false;
        }

        if (config.mode == PersistenceMode::SqliteOnly)
        {
            config.backend = PersistenceBackend::Sqlite;
        }
        else if (config.mode == PersistenceMode::PostgresOnly)
        {
            config.backend = PersistenceBackend::Postgres;
        }

        auto sqliteOverride = ReadEnvVar("SQLITE_DB_PATH");
        if (!sqliteOverride.empty())
        {
            config.sqlitePath = std::filesystem::path(sqliteOverride);
        }
        else if (config.brandId == "perceptrum" && !brandData.dataRootWindows.empty())
        {
            config.sqlitePath = std::filesystem::path(brandData.dataRootWindows) / "local-site" / (config.brandId + "_site.sqlite");
        }
        else
        {
            config.sqlitePath = config.workspaceRoot / "DrakonSite" / "storage" / "sqlite" / "local-site" / (config.brandId + "_site.sqlite");
        }

        auto const pgHost = ReadEnvVar("PGHOST");
        if (!pgHost.empty())
        {
            config.postgresHost = pgHost;
        }

        auto const pgPort = ReadEnvVar("PGPORT");
        if (!pgPort.empty())
        {
            config.postgresPort = (std::max)(1, std::atoi(pgPort.c_str()));
        }

        auto const pgDatabase = ReadEnvVar("PGDATABASE");
        if (!pgDatabase.empty())
        {
            config.postgresDatabase = pgDatabase;
        }

        auto const pgUser = ReadEnvVar("PGUSER");
        if (!pgUser.empty())
        {
            config.postgresUser = pgUser;
        }

        auto const pgPassword = ReadEnvVar("PGPASSWORD");
        if (!pgPassword.empty())
        {
            config.postgresPassword = pgPassword;
        }

        ApplyConninfoOverrides(config, ReadEnvVar("DRAKON_PG_CONNINFO"));
        if (config.postgresConninfo.empty())
        {
            config.postgresConninfo = BuildConninfo(config);
        }

        config.summary = DescribeConfig(config);
        return config;
    }

    std::string DescribeConfig(PersistenceConfig const& config)
    {
        std::ostringstream stream;
        stream << "mode=" << ModeToString(config.mode)
               << " backend=" << BackendToString(config.backend)
               << " brand=" << config.brandId;

        if (config.backend == PersistenceBackend::Sqlite)
        {
            stream << " sqlite=" << config.sqlitePath.string();
        }
        else
        {
            stream << " pg=" << config.postgresHost << ':' << config.postgresPort
                   << '/' << config.postgresDatabase << " user=" << config.postgresUser;
        }

        if (config.explicitBackend)
        {
            stream << " explicit=true";
        }

        return stream.str();
    }

    std::unique_ptr<DatabaseConnection> OpenDatabase(PersistenceConfig const& config)
    {
        if (config.backend == PersistenceBackend::Sqlite)
        {
            return std::make_unique<SqliteConnection>(config);
        }

        return std::make_unique<PostgresConnection>(config);
    }

    std::optional<DbValue> GetValue(DbRow const& row, std::string const& key)
    {
        if (auto it = row.find(key); it != row.end())
        {
            return it->second;
        }
        return std::nullopt;
    }

    std::string GetString(DbRow const& row, std::string const& key, std::string const& fallback)
    {
        auto value = GetValue(row, key);
        if (!value.has_value() || std::holds_alternative<std::nullptr_t>(*value))
        {
            return fallback;
        }

        if (auto const* text = std::get_if<std::string>(&*value))
        {
            return *text;
        }
        if (auto const* integer = std::get_if<int64_t>(&*value))
        {
            return std::to_string(*integer);
        }
        if (auto const* number = std::get_if<double>(&*value))
        {
            std::ostringstream stream;
            stream << *number;
            return stream.str();
        }
        if (auto const* flag = std::get_if<bool>(&*value))
        {
            return *flag ? "true" : "false";
        }

        return fallback;
    }

    int64_t GetInt64(DbRow const& row, std::string const& key, int64_t fallback)
    {
        auto value = GetValue(row, key);
        if (!value.has_value())
        {
            return fallback;
        }

        if (auto const* integer = std::get_if<int64_t>(&*value))
        {
            return *integer;
        }
        if (auto const* number = std::get_if<double>(&*value))
        {
            return static_cast<int64_t>(*number);
        }
        if (auto const* flag = std::get_if<bool>(&*value))
        {
            return *flag ? 1 : 0;
        }
        if (auto const* text = std::get_if<std::string>(&*value))
        {
            if (auto parsed = ParseInteger(*text))
            {
                return *parsed;
            }
        }

        return fallback;
    }

    bool GetBool(DbRow const& row, std::string const& key, bool fallback)
    {
        auto value = GetValue(row, key);
        if (!value.has_value())
        {
            return fallback;
        }

        if (auto const* flag = std::get_if<bool>(&*value))
        {
            return *flag;
        }
        if (auto const* integer = std::get_if<int64_t>(&*value))
        {
            return *integer != 0;
        }
        if (auto const* number = std::get_if<double>(&*value))
        {
            return *number != 0.0;
        }
        if (auto const* text = std::get_if<std::string>(&*value))
        {
            if (auto parsed = ParseBool(*text))
            {
                return *parsed;
            }
        }

        return fallback;
    }
}

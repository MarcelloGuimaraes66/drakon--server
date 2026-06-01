#pragma once

#include <cstdint>
#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <variant>
#include <vector>

namespace DrakonDesktop::persistence
{
    enum class PersistenceBackend
    {
        Sqlite,
        Postgres,
    };

    enum class PersistenceMode
    {
        SqliteOnly,
        PostgresOnly,
        DualCompatible,
    };

    using DbValue = std::variant<std::nullptr_t, int64_t, double, bool, std::string>;
    using DbParams = std::vector<DbValue>;
    using DbRow = std::unordered_map<std::string, DbValue>;

    struct QueryMeta
    {
        int64_t changes{ 0 };
        std::optional<int64_t> lastRowId;
    };

    struct QueryResult
    {
        std::vector<DbRow> rows;
        QueryMeta meta;
    };

    struct PersistenceConfig
    {
        PersistenceMode mode{ PersistenceMode::DualCompatible };
        PersistenceBackend backend{ PersistenceBackend::Sqlite };
        std::filesystem::path workspaceRoot;
        std::filesystem::path sqlitePath;
        std::string postgresHost{ "localhost" };
        int postgresPort{ 5433 };
        std::string postgresDatabase{ "perceptrum_site" };
        std::string postgresUser{ "postgres" };
        std::string postgresPassword{ "1234" };
        std::string postgresConninfo;
        std::string brandId{ "drakon" };
        std::string summary;
        bool explicitBackend{ false };
    };

    class DatabaseConnection
    {
    public:
        explicit DatabaseConnection(PersistenceConfig config);
        virtual ~DatabaseConnection() = default;

        DatabaseConnection(DatabaseConnection const&) = delete;
        DatabaseConnection& operator=(DatabaseConnection const&) = delete;

        virtual QueryResult All(std::string const& sql, DbParams const& params = {}) = 0;
        virtual std::optional<DbRow> First(std::string const& sql, DbParams const& params = {}) = 0;
        virtual QueryMeta Run(std::string const& sql, DbParams const& params = {}) = 0;

        PersistenceConfig const& Config() const noexcept;

    protected:
        PersistenceConfig m_config;
    };

    PersistenceConfig ResolvePersistenceConfig(std::filesystem::path const& workspaceRoot);
    std::string DescribeConfig(PersistenceConfig const& config);
    std::unique_ptr<DatabaseConnection> OpenDatabase(PersistenceConfig const& config);

    std::optional<DbValue> GetValue(DbRow const& row, std::string const& key);
    std::string GetString(DbRow const& row, std::string const& key, std::string const& fallback = {});
    int64_t GetInt64(DbRow const& row, std::string const& key, int64_t fallback = 0);
    bool GetBool(DbRow const& row, std::string const& key, bool fallback = false);
}

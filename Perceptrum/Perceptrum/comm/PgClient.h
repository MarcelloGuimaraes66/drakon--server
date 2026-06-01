#pragma once
#include <string>
#include <vector>

// libpq define:
//   typedef struct pg_conn PGconn;
//   typedef struct pg_result PGresult;
// Então NÃO use "struct PGconn;" (isso conflita).
typedef struct pg_conn   PGconn;
typedef struct pg_result PGresult;

class PgClient {
public:
    PgClient();
    ~PgClient();

    void Connect(const std::string& conninfo);
    bool IsConnected() const;

    PGresult* Exec(const std::string& sql);
    PGresult* ExecParams(const std::string& sql, const std::vector<std::string>& params);

    static void Clear(PGresult* r);
    static int Rows(PGresult* r);
    static std::string GetValue(PGresult* r, int row, int col);

private:
    PGconn* m_conn = nullptr;
};

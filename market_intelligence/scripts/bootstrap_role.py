"""Create/update the least-privilege application role on Tiger Data.

Run with an owner/admin URL after migrations:

    MIGRATION_DATABASE_URL=postgresql://... \
    RELAY_DB_PASSWORD=... \
    python -m market_intelligence.scripts.bootstrap_role

The role can read and write market rows, but cannot run DDL. The API uses it
through DATABASE_URL; migrations use the owner URL.
"""

from __future__ import annotations

import os

import psycopg
from psycopg import sql


def main() -> None:
    admin_url = os.environ.get("MIGRATION_DATABASE_URL") or os.environ.get("DATABASE_URL")
    password = os.environ.get("RELAY_DB_PASSWORD")
    role = os.environ.get("RELAY_DB_ROLE", "relay_market_app")
    if not admin_url:
        raise SystemExit("MIGRATION_DATABASE_URL (or DATABASE_URL) is required")
    if not password:
        raise SystemExit("RELAY_DB_PASSWORD is required")

    with psycopg.connect(admin_url, autocommit=True) as connection:
        exists = connection.execute(
            "SELECT 1 FROM pg_roles WHERE rolname = %s", (role,)
        ).fetchone()
        if exists:
            connection.execute(
                sql.SQL("ALTER ROLE {} WITH LOGIN PASSWORD {}").format(
                    sql.Identifier(role), sql.Literal(password)
                )
            )
            print(f"updated role {role}")
        else:
            connection.execute(
                sql.SQL(
                    "CREATE ROLE {} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD {}"
                ).format(sql.Identifier(role), sql.Literal(password))
            )
            print(f"created role {role}")

        database = connection.execute("SELECT current_database()").fetchone()[0]
        connection.execute(
            sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                sql.Identifier(database), sql.Identifier(role)
            )
        )
        connection.execute(
            sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(sql.Identifier(role))
        )
        connection.execute(
            sql.SQL(
                "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {}"
            ).format(sql.Identifier(role))
        )
        connection.execute(
            sql.SQL("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {}").format(
                sql.Identifier(role)
            )
        )
        connection.execute(
            sql.SQL(
                "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
                "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {}"
            ).format(sql.Identifier(role))
        )
        connection.execute(
            sql.SQL(
                "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
                "GRANT USAGE, SELECT ON SEQUENCES TO {}"
            ).format(sql.Identifier(role))
        )
    print("application role ready; set DATABASE_URL to that role")


if __name__ == "__main__":
    main()

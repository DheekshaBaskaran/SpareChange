"""Apply Tiger Data migrations in order.

Run with a database-owner URL, not the least-privilege application role:

    MIGRATION_DATABASE_URL=postgresql://... python -m market_intelligence.scripts.migrate
"""

from __future__ import annotations

import os
from pathlib import Path

import psycopg

MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations" / "market_intelligence"


def main() -> None:
    url = os.environ.get("MIGRATION_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("MIGRATION_DATABASE_URL (or DATABASE_URL) is required")
    files = sorted(MIGRATIONS.glob("*.sql"))
    if not files:
        raise SystemExit(f"no migrations found in {MIGRATIONS}")

    with psycopg.connect(url, autocommit=True) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version text PRIMARY KEY,
                applied_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        applied = {
            row[0] for row in connection.execute("SELECT version FROM schema_migrations").fetchall()
        }
        for path in files:
            version = path.stem
            if version in applied:
                print(f"skip {version}")
                continue
            print(f"apply {version}")
            connection.execute(path.read_text(encoding="utf-8"))
            connection.execute(
                "INSERT INTO schema_migrations (version) VALUES (%s) ON CONFLICT DO NOTHING",
                (version,),
            )
    print("migrations complete")


if __name__ == "__main__":
    main()

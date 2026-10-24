"""Export the OpenAPI schema to the shared contracts folder."""

from __future__ import annotations

import json
from pathlib import Path

from market_intelligence.main import create_app


def main() -> None:
    app = create_app()
    schema = app.openapi()
    destination = Path("contracts") / "market-intelligence.openapi.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {destination}")


if __name__ == "__main__":
    main()

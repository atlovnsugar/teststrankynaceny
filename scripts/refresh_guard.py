from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
EU_CODES = {
    "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU",
    "IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE",
}


def load(name: str):
    path = DATA / name
    return json.loads(path.read_text(encoding="utf-8"))


def fail(message: str) -> None:
    print(f"::error title=Refresh guard::{message}")
    raise SystemExit(message)


def main() -> int:
    report_path = DATA / "refresh-report.json"
    if not report_path.exists():
        fail("update_data.py did not produce data/refresh-report.json")

    report = load("refresh-report.json")
    print("=== refresh-report.json ===")
    print(json.dumps(report, ensure_ascii=False, indent=2))

    hard_failures = list(report.get("hard_failures") or [])
    warnings = list(report.get("warnings") or [])

    # Older update_data.py versions swallowed required-source failures when an
    # existing archive was present. Treat those warnings as hard failures too.
    required_warning_tokens = (
        "fuel refresh failed:",
        "gas refresh failed:",
        "Brent refresh failed:",
        "FX refresh failed:",
        "Supply refresh failed:",
    )
    swallowed = [
        w for w in warnings
        if any(token.lower() in str(w).lower() for token in required_warning_tokens)
    ]
    if swallowed:
        hard_failures.extend(swallowed)

    if hard_failures:
        fail("Required data refresh failed before validation: " + " | ".join(str(x) for x in hard_failures))

    # The refresh must have replaced the seed archive with a real EU archive.
    fuel = load("fuel-history.json")
    history = fuel.get("history", {})
    eu_count = len(set(history) & EU_CODES)
    cz_count = len(history.get("CZ", []))
    lpg_count = sum(
        1 for code, series in history.items()
        if code in EU_CODES and any("lpg" in row for row in series)
    )

    print(f"Fuel archive after refresh: {eu_count} EU countries, {cz_count} Czech observations, {lpg_count} LPG countries")

    if eu_count < 20:
        fail(
            f"Refresh did not produce a full fuel archive: only {eu_count} EU countries are present. "
            "See the refresh diagnostics above for the source error."
        )
    if cz_count < 500:
        fail(f"Refresh did not produce enough Czech fuel history: {cz_count} observations")
    if lpg_count < 12:
        fail(f"Refresh did not produce enough LPG history: {lpg_count} EU countries")

    print("REFRESH GUARD OK: required refreshes produced complete archives")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

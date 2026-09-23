from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
EU_CODES = {"AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"}
CZ_CODES = {"CZ010","CZ020","CZ031","CZ032","CZ041","CZ042","CZ051","CZ052","CZ053","CZ063","CZ064","CZ071","CZ072","CZ080"}


def load(name: str):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def fail(message: str) -> None:
    raise SystemExit(f"DATA VALIDATION FAILED: {message}")


def main() -> int:
    current = load("current.json")
    fuel = load("fuel-history.json")
    gas = load("gas.json")
    oil = load("oil.json")
    fx = load("fx.json")

    fuel_hist = fuel.get("history", {})
    if len(set(fuel_hist) & EU_CODES) < 20:
        fail(f"fuel archive contains only {len(set(fuel_hist) & EU_CODES)} EU countries")
    if len(fuel_hist.get("CZ", [])) < 500:
        fail(f"fuel archive contains only {len(fuel_hist.get('CZ', []))} Czech observations")
    lpg_countries = sum(1 for code, series in fuel_hist.items() if code in EU_CODES and any("lpg" in row for row in series))
    if lpg_countries < 12:
        fail(f"fuel archive contains only {lpg_countries} EU countries with LPG history")
    if not current.get("fuel", {}).get("history_from"):
        fail("current fuel metadata has no history_from")
    if len(current.get("fuel", {}).get("countries", [])) < 20:
        fail("current fuel snapshot is incomplete")
    current_lpg = sum(1 for row in current.get("fuel", {}).get("countries", []) if row.get("lpg") is not None)
    if current_lpg < 12:
        fail(f"current fuel snapshot contains only {current_lpg} countries with LPG")

    gas_hist = gas.get("history", {})
    if len(gas_hist.get("CZ", [])) < 10:
        fail("Eurostat gas archive is too short")
    if len(gas_hist.get("EU27", [])) < 10:
        fail("Eurostat EU27 gas archive is too short")
    if len(oil.get("history", [])) < 1000:
        fail("Brent archive is too short")
    if len(fx.get("eur_czk", [])) < 1000 or len(fx.get("usd_czk", [])) < 1000:
        fail("ECB FX archive is too short")

    regions = current.get("czech_regions", {})
    if len(regions.get("regions", [])) < 14:
        fail("Czech current regional snapshot is incomplete")
    if not CZ_CODES.issubset({r.get("code") for r in regions.get("regions", [])}):
        fail("Czech region codes are incomplete")

    for path, minimum in [(DATA / "geo" / "eu-countries.geojson", 20), (DATA / "geo" / "cz-regions.geojson", 14)]:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if len(payload.get("features", [])) < minimum:
            fail(f"{path.name} contains too few features")

    print("DATA VALIDATION OK")
    print(f"Fuel: {len(fuel_hist)} country series · CZ={len(fuel_hist.get('CZ', []))} · LPG countries={lpg_countries}")
    print(f"Gas: CZ={len(gas_hist.get('CZ', []))} · EU27={len(gas_hist.get('EU27', []))}")
    print(f"Brent: {len(oil.get('history', []))} · FX EUR/CZK={len(fx.get('eur_czk', []))} · USD/CZK={len(fx.get('usd_czk', []))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import csv
import io
import json
import math
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import pandas as pd
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
GEO = DATA / "geo"
USER_AGENT = "eu-energy-price-tracker/1.0 (+https://github.com/)"
TIMEOUT = 60

EU = [
    ("AT", "Austria"), ("BE", "Belgium"), ("BG", "Bulgaria"), ("HR", "Croatia"),
    ("CY", "Cyprus"), ("CZ", "Czechia"), ("DK", "Denmark"), ("EE", "Estonia"),
    ("FI", "Finland"), ("FR", "France"), ("DE", "Germany"), ("GR", "Greece"),
    ("HU", "Hungary"), ("IE", "Ireland"), ("IT", "Italy"), ("LV", "Latvia"),
    ("LT", "Lithuania"), ("LU", "Luxembourg"), ("MT", "Malta"), ("NL", "Netherlands"),
    ("PL", "Poland"), ("PT", "Portugal"), ("RO", "Romania"), ("SK", "Slovakia"),
    ("SI", "Slovenia"), ("ES", "Spain"), ("SE", "Sweden"),
]
EU_CODES = {code for code, _ in EU}
EU_NAMES = {code: name for code, name in EU}
CZ_REGIONS = {
    "CZ010": "Praha", "CZ020": "Středočeský kraj", "CZ031": "Jihočeský kraj",
    "CZ032": "Plzeňský kraj", "CZ041": "Karlovarský kraj", "CZ042": "Ústecký kraj",
    "CZ051": "Liberecký kraj", "CZ052": "Královéhradecký kraj", "CZ053": "Pardubický kraj",
    "CZ063": "Vysočina", "CZ064": "Jihomoravský kraj", "CZ071": "Olomoucký kraj",
    "CZ072": "Zlínský kraj", "CZ080": "Moravskoslezský kraj",
}

EC_WEEKLY_URL = "https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en"
EUROSTAT_GAS_URL = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nrg_pc_202"
BRENT_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU"
REGIONAL_URL = "https://cenaphm.cz/data.json"
NUTS_COUNTRIES_URL = "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_20M_2024_4326_LEVL_0.geojson"
NUTS_REGIONS_URL = "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_20M_2024_4326_LEVL_3.geojson"


def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT, "Accept": "*/*"})
    return s


def get(s: requests.Session, url: str, **kwargs) -> requests.Response:
    kwargs.setdefault("timeout", TIMEOUT)
    r = s.get(url, **kwargs)
    r.raise_for_status()
    return r


def load_json(path: Path, fallback: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback.copy() if fallback else {}


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_eu_number(value: Any) -> float | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().replace("\u00a0", " ")
    if not s or s.lower() in {"nan", "n/a", "-", "—"}:
        return None
    s = re.sub(r"[^0-9,.-]", "", s)
    if not s:
        return None
    if "," in s and "." in s:
        # European decimal notation: 1.234,56; or workbook thousands: 1,234.56.
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        parts = s.split(",")
        if len(parts) == 2 and len(parts[1]) == 3 and len(parts[0]) <= 3:
            # Commission workbook values are typically rendered as thousands separators.
            s = "".join(parts)
        else:
            s = s.replace(",", ".")
    elif s.count(".") > 1:
        s = s.replace(".", "")
    try:
        return float(s)
    except ValueError:
        return None


def find_ec_history_xlsx(s: requests.Session) -> tuple[str, bytes]:
    html = get(s, EC_WEEKLY_URL).text
    soup = BeautifulSoup(html, "html.parser")
    candidates: list[tuple[int, str]] = []
    for a in soup.find_all("a", href=True):
        href = urljoin(EC_WEEKLY_URL, a["href"])
        if not re.search(r"\.xlsx(?:\?|$)", href, re.I):
            continue
        text = " ".join(a.stripped_strings).lower()
        parent_text = " ".join(a.parent.stripped_strings).lower() if a.parent else ""
        score = 0
        blob = f"{text} {parent_text} {href.lower()}"
        if "price developments" in blob:
            score += 10
        if "2005" in blob or "history" in blob:
            score += 5
        if "price" in blob:
            score += 2
        candidates.append((score, href))
    if not candidates:
        raise RuntimeError("European Commission Weekly Oil Bulletin page did not expose an .xlsx history link.")
    _, href = sorted(candidates, key=lambda x: (x[0], x[1]), reverse=True)[0]
    return href, get(s, href).content


def parse_fuel_history(s: requests.Session) -> tuple[dict[str, Any], str, str]:
    href, content = find_ec_history_xlsx(s)
    df = pd.read_excel(io.BytesIO(content), sheet_name="Prices with taxes, per CTR", header=None)
    records: dict[str, list[dict[str, Any]]] = defaultdict(list)
    country = None
    latest_by_country: dict[str, dict[str, Any]] = {}

    for _, row in df.iterrows():
        cells = list(row)
        first = str(cells[0]).strip().upper() if cells and not pd.isna(cells[0]) else ""
        if first in EU_CODES:
            country = first
            continue
        if country is None or len(cells) < 5:
            continue
        dt = pd.to_datetime(cells[1], errors="coerce")
        if pd.isna(dt):
            continue
        petrol = parse_eu_number(cells[3]) if len(cells) > 3 else None
        diesel = parse_eu_number(cells[4]) if len(cells) > 4 else None
        lpg = parse_eu_number(cells[8]) if len(cells) > 8 else None
        if petrol is None and diesel is None and lpg is None:
            continue
        rec = {"date": dt.strftime("%Y-%m-%d")}
        if petrol is not None:
            rec["petrol95"] = round(petrol / 1000, 4)
        if diesel is not None:
            rec["diesel"] = round(diesel / 1000, 4)
        if lpg is not None:
            rec["lpg"] = round(lpg / 1000, 4)
        records[country].append(rec)

    if len(records) < 20:
        raise RuntimeError(f"Fuel workbook parsed, but only {len(records)} EU countries were found.")

    for code in records:
        records[code].sort(key=lambda r: r["date"])
        latest_by_country[code] = records[code][-1]

    as_of = max(r["date"] for r in latest_by_country.values())
    countries = []
    for code, name in EU:
        row = latest_by_country.get(code, {})
        item = {"code": code, "name": name}
        for key in ("petrol95", "diesel", "lpg"):
            if key in row:
                item[key] = row[key]
        countries.append(item)
    return {
        "as_of": as_of,
        "currency": "EUR",
        "unit": "EUR/L",
        "source": "European Commission Weekly Oil Bulletin",
        "source_url": EC_WEEKLY_URL,
        "countries": countries,
    }, records, href


def flatten_jsonstat(data: dict[str, Any]) -> list[dict[str, Any]]:
    dims = data["id"]
    sizes = data["size"]
    cats: dict[str, list[str]] = {}
    for dim in dims:
        index = data["dimension"][dim]["category"].get("index", {})
        if isinstance(index, dict):
            cats[dim] = [k for k, _ in sorted(index.items(), key=lambda kv: kv[1])]
        else:
            cats[dim] = list(index)
    values = data.get("value", {})
    if isinstance(values, list):
        valmap = {str(i): v for i, v in enumerate(values)}
    else:
        valmap = values
    rows = []
    total = math.prod(sizes)
    for flat in range(total):
        rem = flat
        coords = [0] * len(dims)
        for i in range(len(dims) - 1, -1, -1):
            coords[i] = rem % sizes[i]
            rem //= sizes[i]
        key = str(flat)
        value = valmap.get(key)
        if value is None:
            continue
        row = {dim: cats[dim][coords[i]] for i, dim in enumerate(dims)}
        row["value"] = value
        rows.append(row)
    return rows


def parse_gas(s: requests.Session) -> tuple[dict[str, Any], dict[str, Any]]:
    params = {
        "format": "JSON",
        "lang": "en",
        "unit": "KWH",
        "nrg_cons": "GJ20-199",
        "currency": "EUR",
        "tax": "I_TAX",
    }
    r = get(s, EUROSTAT_GAS_URL, params=params)
    raw = r.json()
    rows = flatten_jsonstat(raw)
    history: dict[str, list[dict[str, Any]]] = defaultdict(list)
    geo_dim = "geo"
    time_dim = "TIME_PERIOD"
    for row in rows:
        code = row.get(geo_dim)
        period = row.get(time_dim)
        if not code or not period or not (code in EU_CODES or code in {"EU27_2020", "EU27"}):
            continue
        out_code = "EU27" if code in {"EU27_2020", "EU27"} else code
        history[out_code].append({"period": period, "value": round(float(row["value"]), 6)})
    for code in history:
        history[code].sort(key=lambda x: x["period"])
    if "CZ" not in history or not history["CZ"]:
        raise RuntimeError("Eurostat gas API returned no Czechia series for the requested D2/I_TAX selection.")
    latest_period = max(series[-1]["period"] for series in history.values() if series)
    countries = []
    for code, name in EU + [("EU27", "EU-27")]:
        if code in history and history[code]:
            countries.append({"code": code, "name": name, "price": history[code][-1]["value"]})
    meta = {
        "as_of": latest_period,
        "unit": "EUR/kWh",
        "band": "D2 (20–199 GJ/year)",
        "tax": "I_TAX (all taxes and levies included)",
        "source": "Eurostat nrg_pc_202",
        "source_url": EUROSTAT_GAS_URL,
        "countries": countries,
    }
    return meta, {"history": dict(history), **meta}


def parse_fred_brent(s: requests.Session) -> dict[str, Any]:
    text = get(s, BRENT_URL).text
    reader = csv.DictReader(io.StringIO(text))
    history = []
    for row in reader:
        value = parse_eu_number(row.get("DCOILBRENTEU"))
        date = row.get("DATE")
        if not date or value is None:
            continue
        history.append({"date": date, "value": round(value, 3)})
    if len(history) < 100:
        raise RuntimeError("FRED Brent series returned unexpectedly little data.")
    history.sort(key=lambda x: x["date"])
    return {
        "as_of": history[-1]["date"],
        "unit": "USD/barrel",
        "source": "U.S. Energy Information Administration via FRED, DCOILBRENTEU",
        "source_url": "https://fred.stlouisfed.org/series/DCOILBRENTEU",
        "latest": history[-1]["value"],
        "history": history,
    }


def norm_key(x: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(x).lower())


def date_from_any(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        m = re.search(r"(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})", value)
        if m:
            return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
        m = re.search(r"(20\d{2})[-/.](\d{1,2})", value)
        if m:
            return f"{m.group(1)}-{int(m.group(2)):02d}-01"
    try:
        return pd.to_datetime(value).strftime("%Y-%m-%d")
    except Exception:
        return None


def infer_region_code(obj: Any) -> str | None:
    if not isinstance(obj, dict):
        return None
    for k, v in obj.items():
        nk = norm_key(k)
        if nk in {"nuts", "nutsid", "code", "regioncode", "id", "kraj", "region"}:
            sv = str(v).upper()
            if sv in CZ_REGIONS:
                return sv
    joined = " ".join(str(v) for v in obj.values() if isinstance(v, (str, int, float)))
    for code, name in CZ_REGIONS.items():
        if code in joined.upper() or name.lower() in joined.lower():
            return code
    return None


def infer_metric(obj: dict[str, Any], wanted: set[str]) -> float | None:
    for k, v in obj.items():
        nk = norm_key(k)
        if any(token in nk for token in wanted):
            n = parse_eu_number(v)
            if n is not None and 10 <= n <= 100:
                return n
    return None


def walk_region_objects(node: Any, out: dict[str, dict[str, Any]], inherited_date: str | None = None) -> None:
    if isinstance(node, dict):
        local_date = inherited_date
        for k, v in node.items():
            if norm_key(k) in {"date", "updated", "update", "datum", "asof", "aktualizace", "timestamp"}:
                local_date = date_from_any(v) or local_date
        code = infer_region_code(node)
        if code:
            petrol = infer_metric(node, {"petrol", "benzin", "benz", "natural95", "natural"})
            diesel = infer_metric(node, {"diesel", "nafta"})
            lpg = infer_metric(node, {"lpg"})
            if petrol is not None or diesel is not None or lpg is not None:
                out[code] = {
                    "code": code,
                    "name": CZ_REGIONS[code],
                    **({"petrol95": round(petrol, 2)} if petrol is not None else {}),
                    **({"diesel": round(diesel, 2)} if diesel is not None else {}),
                    **({"lpg": round(lpg, 2)} if lpg is not None else {}),
                    "as_of": local_date,
                }
        for value in node.values():
            walk_region_objects(value, out, local_date)
    elif isinstance(node, list):
        for value in node:
            walk_region_objects(value, out, inherited_date)


def refresh_czech_regions(s: requests.Session, current: dict[str, Any]) -> bool:
    r = get(s, REGIONAL_URL)
    payload = r.json()
    found: dict[str, dict[str, Any]] = {}
    walk_region_objects(payload, found)
    if len(found) < 10:
        raise RuntimeError(f"Regional feed parsed, but only {len(found)} Czech regions were recognized.")
    dates = [v.get("as_of") for v in found.values() if v.get("as_of")]
    as_of = max(dates) if dates else datetime.now(timezone.utc).date().isoformat()
    regions = []
    for code in CZ_REGIONS:
        rgn = found.get(code)
        if not rgn:
            continue
        rgn.pop("as_of", None)
        regions.append(rgn)
    if len(regions) < 10:
        raise RuntimeError("Regional feed did not contain a sufficiently complete Czech set.")
    old = current.get("czech_regions", {})
    history = old.get("history", [])
    if isinstance(history, list):
        history = [x for x in history if x.get("as_of") != as_of]
        history.append({"as_of": as_of, "regions": regions})
        history = sorted(history, key=lambda x: x.get("as_of", ""))[-104:]
    current["czech_regions"] = {
        "as_of": as_of,
        "source": "cenaPHM.cz regional public feed (secondary Czech fuel-price source)",
        "source_url": REGIONAL_URL,
        "regions": regions,
        "history": history,
    }
    return True


def fetch_geojson(s: requests.Session, url: str, target: Path) -> None:
    content = get(s, url).content
    json.loads(content)
    target.write_bytes(content)


def main() -> int:
    DATA.mkdir(exist_ok=True)
    GEO.mkdir(exist_ok=True)
    current_path = DATA / "current.json"
    fuel_history_path = DATA / "fuel-history.json"
    gas_path = DATA / "gas.json"
    oil_path = DATA / "oil.json"
    current = load_json(current_path, {})
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    current["generated_at"] = now
    current.setdefault("notes", "Data refreshed automatically by GitHub Actions from cited public sources.")

    s = session()
    successes: list[str] = []
    warnings: list[str] = []

    try:
        fuel_meta, fuel_records, source_xlsx = parse_fuel_history(s)
        current["fuel"] = fuel_meta
        write_json(fuel_history_path, {"source": fuel_meta["source"], "source_url": fuel_meta["source_url"], "history": fuel_records})
        successes.append(f"fuel: {fuel_meta['as_of']} from {source_xlsx}")
    except Exception as exc:
        warnings.append(f"fuel refresh failed; retaining previous data: {exc}")

    try:
        gas_meta, gas_all = parse_gas(s)
        current["natural_gas"] = gas_meta
        write_json(gas_path, gas_all)
        successes.append(f"gas: {gas_meta['as_of']} ({len(gas_all['history'])} series)")
    except Exception as exc:
        warnings.append(f"gas refresh failed; retaining previous data: {exc}")

    try:
        oil = parse_fred_brent(s)
        current["brent"] = {k: oil[k] for k in ("as_of", "unit", "source", "source_url", "latest")}
        write_json(oil_path, oil)
        successes.append(f"Brent: {oil['as_of']}")
    except Exception as exc:
        warnings.append(f"Brent refresh failed; retaining previous data: {exc}")

    try:
        refresh_czech_regions(s, current)
        successes.append(f"Czech regions: {current['czech_regions']['as_of']}")
    except Exception as exc:
        warnings.append(f"Czech regional refresh skipped; retaining previous snapshot: {exc}")

    for url, target in [
        (NUTS_COUNTRIES_URL, GEO / "eu-countries.geojson"),
        (NUTS_REGIONS_URL, GEO / "cz-regions.geojson"),
    ]:
        try:
            fetch_geojson(s, url, target)
            successes.append(f"geometry: {target.name}")
        except Exception as exc:
            warnings.append(f"geometry refresh failed for {target.name}; runtime fallback remains available: {exc}")

    if warnings:
        current["refresh_warnings"] = warnings
    else:
        current.pop("refresh_warnings", None)
    write_json(current_path, current)

    print("EU Energy Price Tracker data refresh")
    for item in successes:
        print(f"  OK   {item}")
    for item in warnings:
        print(f"  WARN {item}")

    # A data refresh is allowed to succeed partially because the site is designed to keep
    # the last known-good snapshot rather than replacing it with a blank/partial dataset.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

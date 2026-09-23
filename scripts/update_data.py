from __future__ import annotations

import csv
import io
import json
import math
import re
import sys
import time
import unicodedata
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

import pandas as pd
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
GEO = DATA / "geo"
USER_AGENT = "eu-energy-price-tracker/2.0 (+https://github.com/)"
TIMEOUT = 90
RETRY_TOTAL = 4

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
ECB_FX_URL = "https://data-api.ecb.europa.eu/service/data/EXR/{series}"
NUTS_COUNTRIES_URL = "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_20M_2024_4326_LEVL_0.geojson"
NUTS_REGIONS_URL = "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_20M_2024_4326_LEVL_3.geojson"
FUEL_HISTORY_MIRROR_URL = "https://huggingface.co/datasets/FionnHughes/eu-weekly-oil-bulletin/resolve/main/eu_oil_bulletin.csv"
SUPPLY_SINCE = "2016-01"
EUROSTAT_OIL_IMPORTS_URL = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nrg_ti_oilm"
EUROSTAT_GAS_IMPORTS_URL = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nrg_ti_gasm"
EUROSTAT_REFINERY_URL = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/ei_isen_m"


def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT, "Accept": "*/*"})
    retry = Retry(
        total=RETRY_TOTAL,
        connect=RETRY_TOTAL,
        read=RETRY_TOTAL,
        status=RETRY_TOTAL,
        backoff_factor=1.0,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    return s


def get(s: requests.Session, url: str, **kwargs) -> requests.Response:
    kwargs.setdefault("timeout", TIMEOUT)
    last_exc: Exception | None = None
    for attempt in range(1, RETRY_TOTAL + 1):
        try:
            r = s.get(url, **kwargs)
            r.raise_for_status()
            return r
        except Exception as exc:
            last_exc = exc
            if attempt == RETRY_TOTAL:
                break
            time.sleep(min(2 ** (attempt - 1), 8))
    raise RuntimeError(f"GET failed after {RETRY_TOTAL} attempts: {url} :: {last_exc}")


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
    if not s or s.lower() in {"nan", "n/a", "-", "—", "na"}:
        return None
    s = re.sub(r"[^0-9,.-]", "", s)
    if not s:
        return None
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        parts = s.split(",")
        if len(parts) == 2 and len(parts[1]) == 3 and len(parts[0]) <= 3:
            s = "".join(parts)
        else:
            s = s.replace(",", ".")
    elif s.count(".") > 1:
        s = s.replace(".", "")
    try:
        return float(s)
    except ValueError:
        return None


def norm_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value).lower())


def as_litre_value(value: Any) -> float | None:
    n = parse_eu_number(value)
    if n is None:
        return None
    # The Commission history workbook quotes petrol, diesel and LPG per 1000 litres.
    # Keep a guard for future layouts that may already expose €/L.
    litre = n / 1000 if abs(n) > 20 else n
    if not (0.2 <= litre <= 5.0):
        return None
    return round(litre, 4)


def parse_date(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return None
        m = re.search(r"(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})", value)
        if m:
            return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
        # Commission dates sometimes arrive as Excel serials embedded in text.
        if re.fullmatch(r"\d{4,6}(?:\.0+)?", value):
            try:
                return pd.to_datetime(float(value), unit="D", origin="1899-12-30").strftime("%Y-%m-%d")
            except Exception:
                pass
    try:
        dt = pd.to_datetime(value, errors="coerce")
        if pd.isna(dt):
            return None
        return dt.strftime("%Y-%m-%d")
    except Exception:
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
        blob = f"{text} {parent_text} {href.lower()}"
        score = 0
        if "price developments 2005 onwards" in blob:
            score += 100
        if "price developments" in blob:
            score += 20
        if "2005" in blob or "history" in blob:
            score += 15
        if "prices with taxes" in blob:
            score += 5
        candidates.append((score, href))
    if not candidates:
        raise RuntimeError("European Commission Weekly Oil Bulletin page did not expose a history workbook link.")
    _, href = sorted(candidates, key=lambda x: (x[0], x[1]), reverse=True)[0]
    return href, get(s, href).content


def score_fuel_header(header: Any, fuel: str) -> int:
    h = norm_key(header)
    if not h:
        return -999
    positive = {
        "petrol95": ("eurosuper95", "eurosuper", "super95", "superplus95", "motorspirit", "motor95", "motorfuel95", "petrol95", "gasoline95", "unleaded95", "benzin95", "benzine95", "essence95", "petrol", "gasoline", "benzin", "benzine", "essence"),
        "diesel": ("gasoilautomotive", "automotivegasoil", "automotivediesel", "diesel", "gazole", "nafta", "motorin", "gasoil"),
        "lpg": ("liquefiedpetroleumgas", "liquefiedpetroleum", "autogas", "lpg"),
    }[fuel]
    negatives = {
        "petrol95": ("diesel", "gasoil", "heating", "kerosene", "lpg", "98", "100"),
        "diesel": ("petrol", "gasoline", "essence", "benzine", "benzin", "heating", "kerosene", "lpg", "95", "98"),
        "lpg": ("petrol", "gasoline", "diesel", "gasoil", "heating"),
    }[fuel]
    score = 0
    for token in positive:
        if token in h:
            score = max(score, 100 if token in ("diesel", "lpg", "eurosuper95", "petrol95", "gasoline95", "gazoilautomotive") else 70)
    for token in negatives:
        if token in h:
            score -= 80
    return score


def find_fuel_columns(headers: list[Any]) -> dict[str, int]:
    found: dict[str, int] = {}
    for fuel in ("petrol95", "diesel", "lpg"):
        scored = sorted(((score_fuel_header(h, fuel), i) for i, h in enumerate(headers)), reverse=True)
        if scored and scored[0][0] >= 50:
            found[fuel] = scored[0][1]
    return found


def parse_fuel_sheet(raw: pd.DataFrame) -> dict[str, list[dict[str, Any]]]:
    """Parse the Commission's repeated-country-block workbook layout.

    The first row contains repeated ``CTR`` markers.  Each marker starts a country
    block, while column 0 is the date.  The workbook is rebuilt in this shape by
    the Commission, so parsing the block rather than hard-coding column numbers
    survives inserted/reordered fields much better.
    """
    if raw.empty:
        return {}
    header = [str(x).strip() if not pd.isna(x) else "" for x in raw.iloc[0].tolist()]
    ctr_positions = [i for i, value in enumerate(header) if norm_key(value) == "ctr"]
    if len(ctr_positions) < 10:
        return parse_legacy_fuel_sheet(raw)

    records: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for i, start in enumerate(ctr_positions):
        end = ctr_positions[i + 1] - 1 if i + 1 < len(ctr_positions) else raw.shape[1] - 1
        if end <= start:
            continue
        block_headers = header[start:end + 1]
        data_headers = block_headers[1:]
        fuel_cols = find_fuel_columns(data_headers)
        if "petrol95" not in fuel_cols or "diesel" not in fuel_cols:
            continue

        country_values = raw.iloc[3:, start].dropna().astype(str).str.strip()
        if country_values.empty:
            continue
        country = country_values.iloc[0].rstrip("_").upper()
        if country not in EU_CODES:
            continue

        for _, row in raw.iloc[3:].iterrows():
            dt = parse_date(row.iloc[0] if len(row) else None)
            if not dt:
                continue
            rec: dict[str, Any] = {"date": dt}
            for fuel, rel_idx in fuel_cols.items():
                absolute_index = start + 1 + rel_idx
                if absolute_index > end:
                    continue
                value = as_litre_value(row.iloc[absolute_index])
                if value is not None:
                    rec[fuel] = value
            if len(rec) > 1:
                records[country].append(rec)

    for code, series in list(records.items()):
        dedup: dict[str, dict[str, Any]] = {}
        for row in series:
            dedup[row["date"]] = {**dedup.get(row["date"], {}), **row}
        records[code] = sorted(dedup.values(), key=lambda r: r["date"])
    return dict(records)

def parse_legacy_fuel_sheet(raw: pd.DataFrame) -> dict[str, list[dict[str, Any]]]:
    records: dict[str, list[dict[str, Any]]] = defaultdict(list)
    country: str | None = None
    for _, row in raw.iterrows():
        cells = list(row)
        first = str(cells[0]).strip().upper() if cells and not pd.isna(cells[0]) else ""
        if first.rstrip("_") in EU_CODES:
            country = first.rstrip("_")
            continue
        if country is None or len(cells) < 9:
            continue
        dt = parse_date(cells[1] if len(cells) > 1 else None)
        if not dt:
            continue
        rec = {"date": dt}
        for key, idx in (("petrol95", 3), ("diesel", 4), ("lpg", 8)):
            value = as_litre_value(cells[idx]) if len(cells) > idx else None
            if value is not None:
                rec[key] = value
        if len(rec) > 1:
            records[country].append(rec)
    for code in records:
        dedup = {r["date"]: r for r in records[code]}
        records[code] = sorted(dedup.values(), key=lambda r: r["date"])
    return dict(records)


def _validate_fuel_history_records(records: dict[str, list[dict[str, Any]]]) -> tuple[bool, str]:
    country_count = len(records)
    cz_count = len(records.get("CZ", []))
    lpg_countries = sum(1 for series in records.values() if any("lpg" in row for row in series))
    if country_count < 20:
        return False, f"only {country_count} EU countries"
    if cz_count < 500:
        return False, f"only {cz_count} Czech weekly observations"
    if lpg_countries < 12:
        return False, f"only {lpg_countries} countries with LPG"
    latest = max((series[-1]["date"] for series in records.values() if series), default=None)
    if not latest:
        return False, "no latest observation"
    try:
        latest_dt = pd.to_datetime(latest).date()
    except Exception:
        return False, f"invalid latest date {latest}"
    if latest_dt < datetime.now(timezone.utc).date() - timedelta(days=45):
        return False, f"latest observation {latest} is stale"
    return True, "ok"


def parse_fuel_history_mirror(s: requests.Session) -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]], str]:
    r = get(s, FUEL_HISTORY_MIRROR_URL)
    reader = csv.DictReader(io.StringIO(r.text.lstrip("\ufeff")))
    fields = {norm_key(f): f for f in (reader.fieldnames or [])}
    def pick(*names: str, contains: str | None = None) -> str | None:
        for n in names:
            if n in fields:
                return fields[n]
        if contains:
            for k, f in fields.items():
                if contains in k:
                    return f
        return None
    c_country = pick("country", "countrycode", "geo", "ctr", "code")
    c_fuel = pick("fueltype", "fuel", "product", "productname")
    c_date = pick("date", "week", "observationdate", "pricedate")
    c_price = pick("priceeurperlitre", "priceperlitre", "eurperlitre", contains="price")
    if not all((c_country, c_fuel, c_date, c_price)):
        raise RuntimeError(f"unexpected mirror CSV header: {reader.fieldnames}")

    def fuel_of(label: Any) -> str | None:
        k = norm_key(label)
        if "lpg" in k or "autogas" in k:
            return "lpg"
        if "diesel" in k or "gasoil" in k or "gazole" in k:
            return "diesel"
        if ("95" in k or k in {"petrol", "gasoline", "eurosuper"}) and not any(x in k for x in ("98", "100", "heating")):
            return "petrol95"
        return None

    records: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in reader:
        code = str(row.get(c_country, "")).strip().upper()
        fuel = fuel_of(row.get(c_fuel))
        date = parse_date(row.get(c_date))
        value = parse_eu_number(row.get(c_price))
        if code not in EU_CODES or not fuel or not date or value is None:
            continue
        if value > 20:  # per-1000-L layout
            value /= 1000
        if not (0.1 <= value <= 5):
            continue
        records[code].append({"date": date, fuel: round(value, 4)})

    merged: dict[str, list[dict[str, Any]]] = {}
    for code, series in records.items():
        by_date: dict[str, dict[str, Any]] = {}
        for row in series:
            by_date[row["date"]] = {**by_date.get(row["date"], {}), **row}
        merged[code] = sorted(by_date.values(), key=lambda x: x["date"])

    ok, reason = _validate_fuel_history_records(merged)
    if not ok:
        raise RuntimeError(f"fuel history mirror validation failed: {reason}")

    latest_by_country = {code: series[-1] for code, series in merged.items() if series}
    as_of = max(r["date"] for r in latest_by_country.values())
    oldest = min(series[0]["date"] for series in merged.values() if series)
    countries = []
    for code, name in EU:
        row = latest_by_country.get(code, {})
        item = {"code": code, "name": name}
        for key in ("petrol95", "diesel", "lpg"):
            if key in row:
                item[key] = row[key]
        countries.append(item)
    meta = {
        "as_of": as_of,
        "history_from": oldest,
        "currency": "EUR",
        "unit": "EUR/L",
        "observation_cadence": "weekly",
        "observation_count": sum(len(series) for series in merged.values()),
        "source": "European Commission Weekly Oil Bulletin (historical archive mirrored and flattened from the Commission series)",
        "source_url": EC_WEEKLY_URL,
        "archive_mirror_url": FUEL_HISTORY_MIRROR_URL,
        "archive_mirror_license": "CC BY 4.0; mirror states the underlying source is the European Commission Weekly Oil Bulletin",
        "countries": countries,
    }
    return meta, merged, FUEL_HISTORY_MIRROR_URL


def parse_fuel_history_official(s: requests.Session) -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]], str]:
    href, content = find_ec_history_xlsx(s)
    xl = pd.ExcelFile(io.BytesIO(content))
    names = [n for n in xl.sheet_names if "prices with taxes" in n.lower() or norm_key(n) in {"priceswithtaxes", "priceswithtax"}]
    if not names:
        raise RuntimeError(f"no 'Prices with taxes' sheet in workbook; sheets: {xl.sheet_names}")
    records = parse_fuel_sheet(pd.read_excel(xl, sheet_name=names[0], header=None))
    ok, reason = _validate_fuel_history_records(records)
    if not ok:
        raise RuntimeError(f"official workbook validation failed: {reason}")
    latest = {c: sr[-1] for c, sr in records.items() if sr}
    meta = {
        "as_of": max(r["date"] for r in latest.values()),
        "history_from": min(sr[0]["date"] for sr in records.values() if sr),
        "currency": "EUR", "unit": "EUR/L", "observation_cadence": "weekly",
        "observation_count": sum(len(sr) for sr in records.values()),
        "source": "European Commission Weekly Oil Bulletin, Price developments 2005 onwards",
        "source_url": EC_WEEKLY_URL, "official_workbook_verified": True, "official_workbook_url": href,
        "countries": [{"code": c, "name": n, **{k: latest[c][k] for k in ("petrol95", "diesel", "lpg") if c in latest and k in latest[c]}} for c, n in EU],
    }
    return meta, records, href


def parse_fuel_history(s: requests.Session) -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]], str]:
    """Build the full weekly fuel archive with the Commission workbook first.

    The Commission's ``Price developments 2005 onwards`` workbook is the primary
    source. A machine-readable mirror of the same Weekly Oil Bulletin is used only
    as a fallback when the official workbook is temporarily unavailable or its layout
    cannot be parsed. A successful refresh must still pass the full archive validation.
    """
    official_exc: Exception | None = None
    try:
        meta, records, href = parse_fuel_history_official(s)
        meta["transport_note"] = "Loaded directly from the European Commission Weekly Oil Bulletin historical workbook."
        meta["official_workbook_verified"] = True
        return meta, records, href
    except Exception as exc:
        official_exc = exc
        print(f"::warning title=Official fuel workbook failed::{exc}")

    try:
        meta, records, href = parse_fuel_history_mirror(s)
    except Exception as mirror_exc:
        raise RuntimeError(f"official workbook: {official_exc} | machine-readable mirror: {mirror_exc}") from mirror_exc
    meta["transport_note"] = (
        "Machine-readable archive from a cleaned mirror of the European Commission "
        "Weekly Oil Bulletin; official workbook was unavailable or could not be parsed "
        "during this refresh."
    )
    meta["official_workbook_verified"] = False
    meta["official_workbook_check"] = {"status": "fallback_used", "reason": str(official_exc)}
    return meta, records, href

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
        valmap = {str(k): v for k, v in values.items()}
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
    raw = get(s, EUROSTAT_GAS_URL, params=params).json()
    rows = flatten_jsonstat(raw)
    history: dict[str, list[dict[str, Any]]] = defaultdict(list)
    dims = raw.get("id", [])
    geo_dim = "geo" if "geo" in dims else None
    time_dim = "time" if "time" in dims else ("TIME_PERIOD" if "TIME_PERIOD" in dims else None)
    if not geo_dim or not time_dim:
        raise RuntimeError(f"Eurostat gas response lacks expected geo/time dimensions: {dims}")
    for row in rows:
        code = row.get(geo_dim)
        period = row.get(time_dim)
        if not code or not period or not (code in EU_CODES or code in {"EU27_2020", "EU27"}):
            continue
        out_code = "EU27" if code in {"EU27_2020", "EU27"} else code
        history[out_code].append({"period": str(period), "value": round(float(row["value"]), 6)})
    for code in history:
        history[code] = sorted({x["period"]: x for x in history[code]}.values(), key=lambda x: x["period"])
    if "CZ" not in history or len(history["CZ"]) < 5:
        raise RuntimeError("Eurostat gas API returned unexpectedly little Czechia history for D2/I_TAX/KWH/EUR.")
    latest_period = max(series[-1]["period"] for series in history.values() if series)
    oldest_period = min(series[0]["period"] for series in history.values() if series)
    countries = []
    for code, name in EU + [("EU27", "EU-27")]:
        if code in history and history[code]:
            countries.append({"code": code, "name": name, "price": history[code][-1]["value"]})
    meta = {
        "as_of": latest_period,
        "history_from": oldest_period,
        "unit": "EUR/kWh",
        "band": "D2 (20–199 GJ/year)",
        "tax": "I_TAX (all taxes and levies included)",
        "source": "Eurostat nrg_pc_202",
        "source_url": EUROSTAT_GAS_URL,
        "countries": countries,
    }
    return meta, {"history": dict(history), **meta}


def parse_fred_csv(text: str, series_id: str) -> list[dict[str, Any]]:
    """Parse FRED's fredgraph.csv.

    FRED renamed the date column from ``DATE`` to ``observation_date``; accept both
    (and fall back to the first column) so a further rename does not break the refresh.
    Missing observations are published as ``.`` and are skipped.
    """
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
    fields = reader.fieldnames or []
    date_key = next((f for f in fields if f.strip().lower() in {"observation_date", "date"}), fields[0] if fields else None)
    value_key = next((f for f in fields if f.strip().upper() == series_id.upper()), fields[1] if len(fields) > 1 else None)
    if not date_key or not value_key:
        raise RuntimeError(f"Unexpected FRED CSV header: {fields}")
    history = []
    for row in reader:
        date = parse_date(row.get(date_key))
        value = parse_eu_number(row.get(value_key))
        if not date or value is None:
            continue
        history.append({"date": date, "value": round(value, 3)})
    return history


def parse_fred_brent(s: requests.Session) -> dict[str, Any]:
    text = get(s, BRENT_URL).text
    history = parse_fred_csv(text, "DCOILBRENTEU")
    if len(history) < 1000:
        raise RuntimeError("FRED Brent series returned unexpectedly little history.")
    history.sort(key=lambda x: x["date"])
    return {
        "as_of": history[-1]["date"],
        "history_from": history[0]["date"],
        "unit": "USD/barrel",
        "source": "U.S. Energy Information Administration via FRED, DCOILBRENTEU",
        "source_url": "https://fred.stlouisfed.org/series/DCOILBRENTEU",
        "latest": history[-1]["value"],
        "history": history,
    }


def parse_ecb_series(s: requests.Session, series: str, start: str) -> list[dict[str, Any]]:
    url = ECB_FX_URL.format(series=series)
    r = get(s, url, params={"format": "csvdata", "startPeriod": start})
    reader = csv.DictReader(io.StringIO(r.text))
    rows = []
    for row in reader:
        date = row.get("TIME_PERIOD") or row.get("TIME_PERIOD ")
        value = parse_eu_number(row.get("OBS_VALUE"))
        if date and value is not None:
            rows.append({"date": date, "value": round(value, 8)})
    if len(rows) < 1000:
        raise RuntimeError(f"ECB series {series} returned too little history ({len(rows)} observations).")
    rows.sort(key=lambda x: x["date"])
    return rows


def parse_fx(s: requests.Session) -> dict[str, Any]:
    eur_czk = parse_ecb_series(s, "D.CZK.EUR.SP00.A", "2005-01-01")
    usd_eur = parse_ecb_series(s, "D.USD.EUR.SP00.A", "2005-01-01")
    usd_by_date = {row["date"]: row["value"] for row in usd_eur}
    usd_czk = []
    for row in eur_czk:
        usd_per_eur = usd_by_date.get(row["date"])
        if usd_per_eur:
            usd_czk.append({"date": row["date"], "value": round(row["value"] / usd_per_eur, 8)})
    if len(usd_czk) < 1000:
        raise RuntimeError("Could not derive a sufficiently long USD/CZK series from ECB reference rates.")
    return {
        "as_of": min(eur_czk[-1]["date"], usd_czk[-1]["date"]),
        "history_from": max(eur_czk[0]["date"], usd_czk[0]["date"]),
        "source": "ECB reference exchange rates",
        "source_url": "https://data.ecb.europa.eu/data/datasets/EXR",
        "eur_czk": eur_czk,
        "usd_czk": usd_czk,
    }


def date_from_any(value: Any) -> str | None:
    return parse_date(value)


def _strip_diacritics(value: str) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFKD", value) if not unicodedata.combining(ch))


def _region_name_key(value: str) -> str:
    text = _strip_diacritics(str(value)).casefold().strip()
    text = re.sub(r"\s+kraj$", "", text)
    return re.sub(r"[^a-z0-9]+", "", text)


REGION_NAME_TO_CODE = {_region_name_key(name): code for code, name in CZ_REGIONS.items()}
REGION_NAME_TO_CODE.update({_region_name_key(name.replace(" kraj", "")): code for code, name in CZ_REGIONS.items()})


def infer_region_code(obj: Any) -> str | None:
    if not isinstance(obj, dict):
        return None
    for k, v in obj.items():
        nk = norm_key(k)
        if nk in {"nuts", "nutsid", "code", "regioncode", "id", "kraj", "region"}:
            sv = str(v).upper().strip()
            if sv in CZ_REGIONS:
                return sv
            candidate = REGION_NAME_TO_CODE.get(_region_name_key(str(v)))
            if candidate:
                return candidate
    for k, v in obj.items():
        if isinstance(v, str):
            candidate = REGION_NAME_TO_CODE.get(_region_name_key(v))
            if candidate:
                return candidate
    joined = " ".join(str(v) for v in obj.values() if isinstance(v, (str, int, float)))
    for code, name in CZ_REGIONS.items():
        if code in joined.upper() or _region_name_key(name) in _region_name_key(joined):
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
            petrol = infer_metric(node, {"petrol", "benzin", "benz", "natural95", "natural", "n95"})
            diesel = infer_metric(node, {"diesel", "nafta"})
            # The current public regional feed exposes LPG fields, but currently
            # publishes zero rather than a regional observation. Zero is therefore
            # treated as missing instead of a fabricated price.
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
    payload = get(s, REGIONAL_URL).json()
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
        rgn = dict(rgn)
        rgn.pop("as_of", None)
        regions.append(rgn)
    if len(regions) < 10:
        raise RuntimeError("Regional feed did not contain a sufficiently complete Czech set.")
    old = current.get("czech_regions", {})
    history = old.get("history", []) if isinstance(old.get("history", []), list) else []
    history = [x for x in history if x.get("as_of") != as_of]
    history.append({"as_of": as_of, "regions": regions})
    history = sorted(history, key=lambda x: x.get("as_of", ""))[-260:]
    current["czech_regions"] = {
        "as_of": as_of,
        "history_from": history[0].get("as_of") if history else as_of,
        "source": "cenaPHM.cz regional public feed (secondary Czech fuel-price source; cites Czech Statistical Office data)",
        "source_url": REGIONAL_URL,
        "regions": regions,
        "history": history,
        "notes": "The current regional feed exposes an LPG field but currently reports zero for all regions; zeros are intentionally treated as not reported rather than as prices.",
    }
    return True

def point_in_europe(lon: float, lat: float) -> bool:
    # Practical display mask: mainland Europe plus Ireland, UK-adjacent Atlantic edge,
    # and Mediterranean EU members. This intentionally excludes overseas departments,
    # dependent territories and distant islands from the strategic Europe map.
    return -11.5 <= lon <= 33.0 and 34.0 <= lat <= 72.5


def coord_centroid(coords: Any) -> tuple[float, float] | None:
    points: list[tuple[float, float]] = []
    def collect(node: Any):
        if isinstance(node, (list, tuple)) and len(node) >= 2 and all(isinstance(x, (int, float)) for x in node[:2]):
            points.append((float(node[0]), float(node[1])))
            return
        if isinstance(node, (list, tuple)):
            for child in node:
                collect(child)
    collect(coords)
    if not points:
        return None
    return (sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points))


def clip_geojson_to_europe(payload: dict[str, Any]) -> dict[str, Any]:
    def clip_geometry(geometry: dict[str, Any] | None) -> dict[str, Any] | None:
        if not geometry:
            return geometry
        kind = geometry.get("type")
        coords = geometry.get("coordinates")
        if kind == "Polygon":
            c = coord_centroid(coords)
            return geometry if c and point_in_europe(*c) else None
        if kind == "MultiPolygon":
            kept = []
            for polygon in coords or []:
                c = coord_centroid(polygon)
                if c and point_in_europe(*c):
                    kept.append(polygon)
            if not kept:
                return None
            return {**geometry, "coordinates": kept}
        if kind == "GeometryCollection":
            geoms = [clip_geometry(g) for g in geometry.get("geometries", [])]
            geoms = [g for g in geoms if g]
            return {**geometry, "geometries": geoms} if geoms else None
        return geometry

    features = []
    for feature in payload.get("features", []):
        geom = clip_geometry(feature.get("geometry"))
        if not geom:
            continue
        features.append({**feature, "geometry": geom})
    return {**payload, "features": features}


def fetch_geojson(s: requests.Session, url: str, target: Path, clip_europe: bool = False) -> None:
    payload = get(s, url).json()
    if clip_europe:
        payload = clip_geojson_to_europe(payload)
    json.dumps(payload)  # validation
    write_json(target, payload)



SUPPLY_GROUPS = {
    "Russia": {"RU"},
    "United States": {"US"},
    "Middle East": {"AE","BH","IQ","IR","KW","OM","QA","SA","YE"},
    "North Africa": {"DZ","EG","LY"},
    "Norway": {"NO"},
    "Azerbaijan / Caspian": {"AZ","KZ"},
    "United Kingdom": {"GB","UK"},
}


def eurostat_json(s: requests.Session, url: str, params: list[tuple[str, str]]) -> dict[str, Any]:
    base = [("format", "JSON"), ("lang", "en")] + params
    return get(s, url, params=base).json()


def supply_group(partner: str) -> str:
    p = str(partner or "").upper()
    for group, codes in SUPPLY_GROUPS.items():
        if p in codes:
            return group
    if p in EU_CODES:
        return "EU / intra-EU"
    if p in {"WORLD", "EXT_EU27_2020", "EU27_2020", "EU27"} or not re.fullmatch(r"[A-Z]{2}", p):
        return "Other"
    return "Other"


def build_supply_rows(raw: dict[str, Any], value_unit: str, allowed_geos: set[str]) -> dict[str, dict[str, list[dict[str, Any]]]]:
    rows = flatten_jsonstat(raw)
    out: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        geo = str(row.get("geo", ""))
        partner = str(row.get("partner", ""))
        period = str(row.get("time", ""))
        value = row.get("value")
        if geo not in allowed_geos or not period or value is None:
            continue
        try:
            numeric = float(value)
        except Exception:
            continue
        if numeric < 0:
            continue
        unit = str(row.get("unit", value_unit))
        out[geo][partner].append({"period": period, "value": numeric, "unit": unit})
    return out


def compact_origin_history(raw: dict[str, dict[str, list[dict[str, Any]]]], unit: str) -> dict[str, Any]:
    # raw[geo][partner] -> observations. Collapse to per-month totals, group volumes and top partners.
    by_geo_period: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    for geo, partners in raw.items():
        for partner, obs in partners.items():
            for r in obs:
                period = r["period"]
                bucket = by_geo_period[geo].setdefault(period, {"period": period, "total": 0.0, "partnerVolumes": defaultdict(float)})
                bucket["total"] += float(r["value"])
                bucket["partnerVolumes"][partner] += float(r["value"])
    out: dict[str, Any] = {}
    for geo, periods in by_geo_period.items():
        hist=[]
        for period, bucket in periods.items():
            total=float(bucket["total"])
            groups=defaultdict(float)
            for partner,value in bucket["partnerVolumes"].items():
                groups[supply_group(partner)] += float(value)
            partners=sorted(bucket["partnerVolumes"].items(), key=lambda kv: kv[1], reverse=True)[:10]
            hist.append({
                "period": period,
                "total": round(total, 3),
                "groupVolumes": {g: round(v,3) for g,v in sorted(groups.items(), key=lambda kv: kv[1], reverse=True)},
                "partners": [{"code":p,"value":round(v,3),"share":round(v/total,6) if total else 0} for p,v in partners]
            })
        out[geo] = {"unit": unit, "history": sorted(hist, key=lambda x: x["period"])}
    return out


def _chunks(items: list[str], size: int = 3):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def eurostat_rows_batched(s: requests.Session, url: str, common_params: list[tuple[str, str]], geo_codes: list[str], *, chunk_size: int = 3) -> list[dict[str, Any]]:
    """Fetch Eurostat rows in small geo batches to avoid HTTP 413 URL-length failures."""
    rows: list[dict[str, Any]] = []
    for chunk in _chunks(geo_codes, chunk_size):
        raw = eurostat_json(s, url, list(common_params) + [("geo", code) for code in chunk])
        if "time" not in raw.get("id", []):
            raise RuntimeError(f"Eurostat response has no time dimension for geos {','.join(chunk)}")
        rows.extend(flatten_jsonstat(raw))
    return rows


def rows_to_nested(rows: list[dict[str, Any]], unit: str) -> dict[str, dict[str, list[dict[str, Any]]]]:
    nested = defaultdict(lambda: defaultdict(list))
    for row in rows:
        geo = str(row.get("geo", ""))
        partner = str(row.get("partner", ""))
        period = str(row.get("time", ""))
        value = row.get("value")
        if geo not in EU_CODES or not period or value is None:
            continue
        try:
            value = float(value)
        except Exception:
            continue
        if value < 0:
            continue
        nested[geo][partner].append({"period": period, "value": value, "unit": unit})
    return nested


def parse_supply_oil(s: requests.Session) -> dict[str, Any]:
    products = {"petrol95": "O4652", "diesel": "O4671", "lpg": "O4630"}
    geos = [code for code, _ in EU]
    product_out = {}
    for product, siec in products.items():
        rows = eurostat_rows_batched(
            s, EUROSTAT_OIL_IMPORTS_URL,
            [("freq", "M"), ("unit", "THS_T"), ("sinceTimePeriod", SUPPLY_SINCE), ("siec", siec)],
            geos, chunk_size=3,
        )
        product_out[product] = compact_origin_history(rows_to_nested(rows, "THS_T"), "THS_T")
    return product_out


def parse_supply_gas(s: requests.Session) -> tuple[dict[str, Any], dict[str, Any]]:
    geos = [code for code, _ in EU]
    out = {}
    for key, siec in (("gas_pipeline", "G3000"), ("gas_lng", "G3200")):
        rows = eurostat_rows_batched(
            s, EUROSTAT_GAS_IMPORTS_URL,
            [("freq", "M"), ("unit", "TJ_GCV"), ("siec", siec), ("sinceTimePeriod", SUPPLY_SINCE)],
            geos, chunk_size=3,
        )
        out[key] = compact_origin_history(rows_to_nested(rows, "TJ_GCV"), "TJ_GCV")
    return out["gas_pipeline"], out["gas_lng"]


def parse_refinery_output(s: requests.Session) -> dict[str, Any]:
    indicator_map = {"petrol95": "IS-ROMS-T", "diesel": "IS-ROGD-T"}
    geos = [code for code, _ in EU]
    out = {code: {} for code, _ in EU}
    for product, indicator in indicator_map.items():
        rows = eurostat_rows_batched(
            s, EUROSTAT_REFINERY_URL,
            [("freq", "M"), ("unit", "THS_T"), ("sinceTimePeriod", SUPPLY_SINCE), ("indic_nrg", indicator)],
            geos, chunk_size=3,
        )
        for row in rows:
            geo = str(row.get("geo", ""))
            period = str(row.get("time", ""))
            value = row.get("value")
            if geo not in EU_CODES or not period or value is None:
                continue
            try:
                value = float(value)
            except Exception:
                continue
            if value < 0:
                continue
            out.setdefault(geo, {}).setdefault(product, []).append({"period": period, "value": round(value, 3)})
    for geo in out:
        for product in list(out[geo]):
            out[geo][product] = sorted(out[geo][product], key=lambda x: x["period"])
    return out


def parse_supply(s: requests.Session) -> dict[str, Any]:
    oil=parse_supply_oil(s)
    gas_pipeline,gas_lng=parse_supply_gas(s)
    try:
        refinery=parse_refinery_output(s)
        refinery_status="available"
    except Exception as exc:
        print(f"::warning title=Refinery output unavailable::{exc}")
        refinery={}
        refinery_status=f"unavailable: {exc}"
    # Basic completeness validation: every EU country needs at least one oil and gas series.
    for product in ("petrol95","diesel","lpg"):
        minimum = 10 if product == "lpg" else 20
        if len(oil.get(product,{})) < minimum:
            raise RuntimeError(f"supply oil {product} contains only {len(oil.get(product,{}))} EU countries")
    if len(gas_pipeline) < 20 or len(gas_lng) < 15:
        raise RuntimeError(f"supply gas coverage too small: pipeline={len(gas_pipeline)} LNG={len(gas_lng)}")
    latest_candidates=[]
    for coll in list(oil.values())+[gas_pipeline,gas_lng]:
        for item in coll.values():
            if item.get("history"): latest_candidates.append(item["history"][-1]["period"])
    meta={
        "supply_from":SUPPLY_SINCE,
        "supply_to":max(latest_candidates) if latest_candidates else None,
        "history_months":"10 years rolling",
        "source":"Eurostat monthly energy imports by partner country; partner is ultimate country of origin",
        "oil_source_url":"https://ec.europa.eu/eurostat/web/energy/data",
        "gas_source_url":"https://ec.europa.eu/eurostat/web/energy/data",
        "refinery_source_url":"https://ec.europa.eu/eurostat/web/energy/data",
        "method_notes":[
            "Oil products use SIEC O4652 motor gasoline, O4671 gas/diesel oil and O4630 liquefied petroleum gases.",
            "Natural gas uses SIEC G3000 gaseous natural gas and G3200 LNG.",
            "Country partner values are retained as the top ten monthly origins; group volumes retain the full partner set.",
            "Russia/United States/Middle East shares are shares of recorded imports in the selected series, not shares of total national energy consumption.",
            "Refinery output is shown next to imported product volume as a structural signal, not as domestic-consumption share."
        ],
        "groups": {k:sorted(v) for k,v in SUPPLY_GROUPS.items()},
        "refinery_status": refinery_status
    }
    return {"generated_at":datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00","Z"),"meta":meta,"oil":oil,"gas":{"pipeline":gas_pipeline,"lng":gas_lng},"refinery":refinery}


def main() -> int:
    DATA.mkdir(exist_ok=True)
    GEO.mkdir(exist_ok=True)
    current_path = DATA / "current.json"
    fuel_history_path = DATA / "fuel-history.json"
    gas_path = DATA / "gas.json"
    oil_path = DATA / "oil.json"
    fx_path = DATA / "fx.json"
    current = load_json(current_path, {})
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    current["generated_at"] = now
    current["notes"] = "Each refresh rebuilds the full published historical archive for the primary sources; the first post-deployment refresh is a deliberate historical backfill, not just a current-value update."

    s = session()
    successes: list[str] = []
    warnings: list[str] = []
    hard_failures: list[str] = []

    try:
        fuel_meta, fuel_records, source_xlsx = parse_fuel_history(s)
        current["fuel"] = fuel_meta
        write_json(fuel_history_path, {"generated_at": now, **fuel_meta, "history": fuel_records})
        successes.append(f"fuel: {fuel_meta['as_of']} / from {fuel_meta['history_from']} ({len(fuel_records)} countries)")
    except Exception as exc:
        message = f"fuel refresh failed: {exc}"
        warnings.append(message)
        hard_failures.append(message)

    try:
        gas_meta, gas_all = parse_gas(s)
        current["natural_gas"] = gas_meta
        write_json(gas_path, {"generated_at": now, **gas_all})
        successes.append(f"gas: {gas_meta['as_of']} / from {gas_meta['history_from']} ({len(gas_all['history'])} series)")
    except Exception as exc:
        message = f"gas refresh failed: {exc}"
        warnings.append(message)
        hard_failures.append(message)

    try:
        supply = parse_supply(s)
        # Supply archive is comparatively large; use compact separators while preserving numeric precision.
        (DATA / "supply.json").write_text(json.dumps(supply, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        successes.append(f"supply: {supply['meta'].get('supply_from')} → {supply['meta'].get('supply_to')} · oil={len(supply['oil']['petrol95'])} countries")
    except Exception as exc:
        message = f"Supply refresh failed: {exc}"
        warnings.append(message)
        hard_failures.append(message)

    try:
        oil = parse_fred_brent(s)
        current["brent"] = {k: oil[k] for k in ("as_of", "history_from", "unit", "source", "source_url", "latest")}
        write_json(oil_path, {"generated_at": now, **oil})
        successes.append(f"Brent: {oil['as_of']} / from {oil['history_from']}")
    except Exception as exc:
        message = f"Brent refresh failed: {exc}"
        warnings.append(message)
        hard_failures.append(message)

    try:
        fx = parse_fx(s)
        current["fx"] = {k: fx[k] for k in ("as_of", "history_from", "source", "source_url")}
        write_json(fx_path, {"generated_at": now, **fx})
        successes.append(f"FX: {fx['as_of']} / from {fx['history_from']}")
    except Exception as exc:
        message = f"FX refresh failed: {exc}"
        warnings.append(message)
        hard_failures.append(message)

    try:
        refresh_czech_regions(s, current)
        successes.append(f"Czech regions: {current['czech_regions']['as_of']} ({len(current['czech_regions']['history'])} snapshots retained)")
    except Exception as exc:
        warnings.append(f"Czech regional refresh skipped; retaining previous snapshot: {exc}")

    for url, target, clip in [
        (NUTS_COUNTRIES_URL, GEO / "eu-countries.geojson", True),
        (NUTS_REGIONS_URL, GEO / "cz-regions.geojson", False),
    ]:
        try:
            fetch_geojson(s, url, target, clip_europe=clip)
            successes.append(f"geometry: {target.name}")
        except Exception as exc:
            warnings.append(f"geometry refresh failed for {target.name}; runtime fallback remains available: {exc}")

    if warnings:
        current["refresh_warnings"] = warnings
    else:
        current.pop("refresh_warnings", None)
    report = {
        "generated_at": now,
        "successes": successes,
        "warnings": warnings,
        "hard_failures": hard_failures,
    }
    write_json(DATA / "refresh-report.json", report)
    write_json(current_path, current)

    print("EU Energy Price Tracker data refresh")
    print(f"  ARCHIVE STATE before commit: fuel={len(load_json(fuel_history_path, {}).get('history', {}))} countries · gas={len(load_json(gas_path, {}).get('history', {}))} series · supply_file={(DATA / 'supply.json').exists()}")
    for item in successes:
        print(f"  OK   {item}")
    for item in warnings:
        print(f"  WARN {item}")
        print(f"::warning title=Data refresh warning::{item[:400]}")
    if hard_failures:
        print("  ERROR required archive refreshes failed; no data commit should occur.")
        for item in hard_failures:
            print(f"    - {item}")
            print(f"::error title=Data refresh failed::{item[:400]}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

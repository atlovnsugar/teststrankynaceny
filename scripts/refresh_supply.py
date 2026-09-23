from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from collections import defaultdict

from update_data import (
    DATA, EU, EU_CODES, SUPPLY_SINCE,
    EUROSTAT_OIL_IMPORTS_URL, EUROSTAT_GAS_IMPORTS_URL, EUROSTAT_REFINERY_URL,
    compact_origin_history, eurostat_json, flatten_jsonstat, session,
    supply_group,
)


def chunks(items: list[str], size: int = 3):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def batched_rows(s, url: str, base: list[tuple[str, str]], chunk_size: int = 3) -> list[dict]:
    rows=[]
    geos=[code for code,_ in EU]
    for chunk in chunks(geos, chunk_size):
        raw=eurostat_json(s, url, base + [("geo", code) for code in chunk])
        if "time" not in raw.get("id", []):
            raise RuntimeError(f"Eurostat response has no time dimension for geos {','.join(chunk)}")
        rows.extend(flatten_jsonstat(raw))
    return rows


def nested(rows: list[dict], unit: str):
    out=defaultdict(lambda: defaultdict(list))
    for row in rows:
        geo=str(row.get("geo", "")); partner=str(row.get("partner", "")); period=str(row.get("time", "")); value=row.get("value")
        if geo not in EU_CODES or not period or value is None:
            continue
        try:
            value=float(value)
        except Exception:
            continue
        if value < 0:
            continue
        out[geo][partner].append({"period":period, "value":value, "unit":unit})
    return out


def build_supply():
    s=session()
    products={"petrol95":"O4652", "diesel":"O4671", "lpg":"O4630"}
    oil={}
    for product,siec in products.items():
        rows=batched_rows(s, EUROSTAT_OIL_IMPORTS_URL, [("freq","M"),("unit","THS_T"),("sinceTimePeriod",SUPPLY_SINCE),("siec",siec)])
        oil[product]=compact_origin_history(nested(rows,"THS_T"),"THS_T")

    gas={}
    for key,siec in (("pipeline","G3000"),("lng","G3200")):
        rows=batched_rows(s, EUROSTAT_GAS_IMPORTS_URL, [("freq","M"),("unit","TJ_GCV"),("siec",siec),("sinceTimePeriod",SUPPLY_SINCE)])
        gas[key]=compact_origin_history(nested(rows,"TJ_GCV"),"TJ_GCV")

    refinery={code:{} for code,_ in EU}
    for product,indicator in (("petrol95","IS-ROMS-T"),("diesel","IS-ROGD-T")):
        rows=batched_rows(s, EUROSTAT_REFINERY_URL, [("freq","M"),("unit","THS_T"),("sinceTimePeriod",SUPPLY_SINCE),("indic_nrg",indicator)])
        for row in rows:
            geo=str(row.get("geo", "")); period=str(row.get("time", "")); value=row.get("value")
            if geo not in EU_CODES or not period or value is None:
                continue
            try:
                value=float(value)
            except Exception:
                continue
            if value < 0:
                continue
            refinery.setdefault(geo,{}).setdefault(product,[]).append({"period":period,"value":round(value,3)})
    for geo in refinery:
        for product in refinery[geo]:
            refinery[geo][product]=sorted(refinery[geo][product], key=lambda x:x["period"])

    latest=[]
    starts=[]
    for coll in list(oil.values())+[gas["pipeline"],gas["lng"]]:
        for item in coll.values():
            if item.get("history"):
                starts.append(item["history"][0]["period"])
                latest.append(item["history"][-1]["period"])
    if not starts or not latest:
        raise RuntimeError("Supply refresh produced no time-series observations")

    for product,minimum in (("petrol95",20),("diesel",20),("lpg",10)):
        if len(oil.get(product,{})) < minimum:
            raise RuntimeError(f"supply oil {product} contains only {len(oil.get(product,{}))} EU countries")
    if len(gas["pipeline"]) < 20:
        raise RuntimeError(f"supply gaseous-gas archive covers only {len(gas['pipeline'])} EU countries")
    if len(gas["lng"]) < 15:
        raise RuntimeError(f"supply LNG archive covers only {len(gas['lng'])} EU countries")

    return {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00","Z"),
        "meta": {
            "supply_from": min(starts),
            "supply_to": max(latest),
            "history_months": "10 years rolling",
            "source": "Eurostat monthly energy imports by partner country; partner is ultimate country of origin",
            "oil_source_url": "https://ec.europa.eu/eurostat/web/energy/data",
            "gas_source_url": "https://ec.europa.eu/eurostat/web/energy/data",
            "refinery_source_url": "https://ec.europa.eu/eurostat/web/energy/data",
            "method_notes": [
                "Eurostat requests are split into small country batches to avoid HTTP 413 Request Entity Too Large failures.",
                "Oil products use SIEC O4652 motor gasoline, O4671 gas/diesel oil and O4630 liquefied petroleum gases.",
                "Natural gas uses SIEC G3000 gaseous natural gas and G3200 LNG.",
                "Country partner values are retained as the top ten monthly origins; group volumes retain the full partner set.",
                "Russia/United States/Middle East shares are shares of recorded imports in the selected series, not shares of total national energy consumption.",
            ],
        },
        "oil": oil,
        "gas": gas,
        "refinery": refinery,
    }


def main():
    payload=build_supply()
    target=DATA/"supply.json"
    temp=DATA/"supply.json.tmp"
    temp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",",":")), encoding="utf-8")
    temp.replace(target)
    print(f"SUPPLY REFRESH OK: {payload['meta']['supply_from']} -> {payload['meta']['supply_to']}")
    print(f"  petrol countries: {len(payload['oil']['petrol95'])}")
    print(f"  diesel countries: {len(payload['oil']['diesel'])}")
    print(f"  LPG countries: {len(payload['oil']['lpg'])}")
    print(f"  pipeline-gas countries: {len(payload['gas']['pipeline'])}")
    print(f"  LNG countries: {len(payload['gas']['lng'])}")


if __name__ == "__main__":
    main()

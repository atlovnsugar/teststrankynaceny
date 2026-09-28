from __future__ import annotations

import json
import math
import os
import re
import tempfile
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
GEO = DATA / 'geo'
INFRA = DATA / 'infrastructure'

EU = [
    ('AT','Austria'),('BE','Belgium'),('BG','Bulgaria'),('HR','Croatia'),('CY','Cyprus'),('CZ','Czechia'),
    ('DK','Denmark'),('EE','Estonia'),('FI','Finland'),('FR','France'),('DE','Germany'),('GR','Greece'),
    ('HU','Hungary'),('IE','Ireland'),('IT','Italy'),('LV','Latvia'),('LT','Lithuania'),('LU','Luxembourg'),
    ('MT','Malta'),('NL','Netherlands'),('PL','Poland'),('PT','Portugal'),('RO','Romania'),('SK','Slovakia'),
    ('SI','Slovenia'),('ES','Spain'),('SE','Sweden')
]
EU_CODES = {c for c,_ in EU}
EU_NAMES = {c:n for c,n in EU}

EUROSTAT = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/'
GEM_GAS = 'https://raw.githubusercontent.com/GlobalEnergyMonitor/goit-ggit-data-ops/map-data/ggit_map_latest.geojson'
GEM_OIL = 'https://raw.githubusercontent.com/GlobalEnergyMonitor/goit-ggit-data-ops/map-data/goit_map_latest.geojson'


def session() -> requests.Session:
    s = requests.Session()
    s.headers['User-Agent'] = 'eu-energy-price-tracker-energy-system/1.0'
    retry = Retry(total=5, connect=5, read=5, backoff_factor=1.2,
                  status_forcelist=(429, 500, 502, 503, 504),
                  allowed_methods=frozenset({'GET'}), raise_on_status=False)
    a = HTTPAdapter(max_retries=retry)
    s.mount('https://', a)
    return s


def get_json(s: requests.Session, url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    r = s.get(url, params=params or {}, timeout=120)
    r.raise_for_status()
    return r.json()


def parse_num(v: Any) -> float | None:
    if v is None:
        return None
    try:
        if isinstance(v, str) and v.strip() in {'', ':', 'na', 'n/a', '-'}:
            return None
        x = float(v)
        return x if math.isfinite(x) else None
    except Exception:
        return None


def flatten_jsonstat(data: dict[str, Any]) -> list[dict[str, Any]]:
    dims = data['id']
    sizes = data['size']
    cats = {}
    labels = {}
    for dim in dims:
        cat = data['dimension'][dim]['category']
        idx = cat.get('index', {})
        if isinstance(idx, dict):
            cats[dim] = [k for k, _ in sorted(idx.items(), key=lambda kv: kv[1])]
        else:
            cats[dim] = list(idx)
        labels[dim] = cat.get('label', {}) or {}
    values = data.get('value', {})
    if isinstance(values, list):
        values = {str(i): v for i, v in enumerate(values)}
    rows = []
    total = math.prod(sizes)
    for flat in range(total):
        rem = flat
        coords = [0] * len(dims)
        for i in range(len(dims) - 1, -1, -1):
            coords[i] = rem % sizes[i]
            rem //= sizes[i]
        v = values.get(str(flat))
        if v is None:
            continue
        row = {dim: cats[dim][coords[i]] for i, dim in enumerate(dims)}
        row['value'] = v
        row['_labels'] = {dim: labels[dim].get(row[dim], row[dim]) for dim in dims}
        rows.append(row)
    return rows


def chunk(seq: list[str], n: int):
    for i in range(0, len(seq), n):
        yield seq[i:i+n]


def classify_source(code: str, label: str) -> str | None:
    text = f'{code} {label}'.lower()
    # Ignore aggregate rows to avoid double counting.
    aggregate_tokens = ('total', 'all fuels', 'combustible fuels', 'electricity generation', 'gross', 'net generation')
    if any(t in text for t in aggregate_tokens):
        return None
    if any(t in text for t in ('nuclear', 'nuclear fuel')):
        return 'nuclear'
    if any(t in text for t in ('wind', 'solar', 'hydro', 'water power', 'geothermal', 'biomass', 'biogas', 'renewable', 'ambient heat', 'tide', 'wave')):
        return 'renewable'
    if any(t in text for t in ('coal', 'lignite', 'peat', 'oil shale', 'crude oil', 'petroleum', 'natural gas', 'manufactured gas', 'coke oven', 'blast furnace gas', 'waste non-renewable', 'fossil')):
        return 'fossil'
    return 'other'


def fetch_generation(s: requests.Session) -> tuple[dict[str, Any], dict[str, Any]]:
    mix: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    min_year, max_year = None, None
    for codes in chunk([c for c,_ in EU], 4):
        params = {
            'format':'JSON','lang':'en','freq':'M','unit':'GWH','sinceTimePeriod':'2008-01',
            'geo':codes,
        }
        raw = get_json(s, EUROSTAT + 'nrg_cb_pem', params)
        rows = flatten_jsonstat(raw)
        for row in rows:
            code = row.get('geo')
            if code not in EU_CODES:
                continue
            label = str(row.get('_labels', {}).get('siec', row.get('siec','')))
            group = classify_source(str(row.get('siec','')), label)
            if not group:
                continue
            period = str(row.get('time',''))
            if not re.fullmatch(r'\d{4}-\d{2}', period):
                continue
            year = period[:4]
            value = parse_num(row.get('value'))
            if value is None or value < 0:
                continue
            slot = mix[code].setdefault(year, {'total':0.0,'sources':defaultdict(float),'shares':{}})
            slot['sources'][label] += value
            slot['total'] += value
            if min_year is None or year < min_year: min_year = year
            if max_year is None or year > max_year: max_year = year
    # Convert sources to a clean structure and compute shares from grouped generation.
    for code, years in mix.items():
        for year, slot in years.items():
            grouped = defaultdict(float)
            for label, value in slot['sources'].items():
                grouped[classify_source('', label) or 'other'] += value
            total = sum(grouped.values())
            slot['total'] = round(total, 3)
            slot['sources'] = {k: round(v, 3) for k,v in sorted(slot['sources'].items(), key=lambda kv: kv[1], reverse=True)}
            slot['shares'] = {k: round(grouped.get(k,0)/total, 6) if total else 0 for k in ('renewable','fossil','nuclear','other')}
    return dict(mix), {'history_from':min_year,'history_to':max_year}


def fetch_electricity_prices(s: requests.Session) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for codes in chunk([c for c,_ in EU], 6):
        params = {
            'format':'JSON','lang':'en','freq':'S','unit':'KWH','nrg_cons':'KWH2500-4999','currency':'EUR','tax':'I_TAX','geo':codes,'sinceTimePeriod':'2007-S1',
        }
        raw = get_json(s, EUROSTAT + 'nrg_pc_204', params)
        for row in flatten_jsonstat(raw):
            c = row.get('geo')
            if c not in EU_CODES:
                continue
            t = str(row.get('time',''))
            v = parse_num(row.get('value'))
            if c and t and v is not None:
                out[c].append({'period':t,'value':round(v,6)})
    for c in out:
        out[c] = sorted({x['period']:x for x in out[c]}.values(), key=lambda x:x['period'])
    return dict(out)


def bbox_of_geometry(geometry):
    if not geometry:
        return None
    pts=[]
    def walk(n):
        if isinstance(n,(list,tuple)) and len(n)>=2 and all(isinstance(x,(int,float)) for x in n[:2]):
            pts.append((float(n[0]),float(n[1]))); return
        if isinstance(n,(list,tuple)):
            for x in n: walk(x)
    walk(geometry.get('coordinates') if isinstance(geometry,dict) else None)
    if not pts:return None
    return min(p[0] for p in pts),min(p[1] for p in pts),max(p[0] for p in pts),max(p[1] for p in pts)


def europe_bbox_intersects(b):
    if not b:return False
    minx,miny,maxx,maxy=b
    return not (maxx < -12 or minx > 34 or maxy < 34 or miny > 72.5)


def fetch_infrastructure(s: requests.Session, url: str, target: Path, kind: str):
    raw = get_json(s,url)
    kept=[]
    for f in raw.get('features',[]):
        if europe_bbox_intersects(bbox_of_geometry(f.get('geometry'))):
            kept.append(f)
    out={'type':'FeatureCollection','features':kept,'metadata':{
        'source':'Global Energy Monitor GOIT/GGIT map-data branch','source_url':url,'kind':kind,'refreshed_at':datetime.utcnow().replace(microsecond=0).isoformat()+'Z',
        'note':'Current route snapshot. Route geometry is infrastructure metadata; it is not a flow-volume measurement.'
    }}
    target.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile('w',delete=False,dir=target.parent,encoding='utf-8') as tmp:
        json.dump(out,tmp,ensure_ascii=False,separators=(',',':'))
        tmp.flush(); tmp_path=Path(tmp.name)
    tmp_path.replace(target)


def main():
    s=session(); DATA.mkdir(exist_ok=True); INFRA.mkdir(parents=True,exist_ok=True)
    mix,meta=fetch_generation(s)
    prices=fetch_electricity_prices(s)
    fetch_infrastructure(s,GEM_GAS,INFRA/'gas-pipelines.geojson','gas')
    fetch_infrastructure(s,GEM_OIL,INFRA/'oil-pipelines.geojson','oil')
    result={
        'generated_at':datetime.utcnow().replace(microsecond=0).isoformat()+'Z',
        'meta':{
            'history_from':meta['history_from'],'history_to':meta['history_to'],'source_generation':'Eurostat nrg_cb_pem · monthly net electricity generation by fuel type','source_generation_url':'https://ec.europa.eu/eurostat/databrowser/view/nrg_cb_pem/default/table','source_electricity_price':'Eurostat nrg_pc_204 · household electricity prices, all taxes, 2,500–4,999 kWh/year band','source_electricity_price_url':'https://ec.europa.eu/eurostat/databrowser/view/nrg_pc_204/default/table','method':'Annual generation is aggregated from monthly GWh observations; SIEC labels are grouped into renewable/fossil/nuclear/other with aggregate rows excluded to avoid double counting.'
        },
        'mix':mix,'prices':{'electricity':prices}
    }
    target=DATA/'electricity-system.json'
    with tempfile.NamedTemporaryFile('w',delete=False,dir=DATA,encoding='utf-8') as tmp:
        json.dump(result,tmp,ensure_ascii=False,indent=2)
        tmp.flush();tmp_path=Path(tmp.name)
    tmp_path.replace(target)
    print(f'Energy system archive written: {target}')
    print(f'Countries with generation history: {len(mix)}/27')
    print(f'Countries with electricity price history: {len(prices)}/27')
    print('Infrastructure snapshots written: gas-pipelines.geojson, oil-pipelines.geojson')

if __name__=='__main__':
    main()

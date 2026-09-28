from __future__ import annotations
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=ROOT/'data/electricity-system.json'
if not p.exists():
    raise SystemExit('ENERGY SYSTEM VALIDATION FAILED: data/electricity-system.json is missing')
data=json.loads(p.read_text(encoding='utf-8'))
mix=data.get('mix',{})
prices=data.get('prices',{}).get('electricity',{})
if len(mix)<20:
    raise SystemExit(f'ENERGY SYSTEM VALIDATION FAILED: only {len(mix)} EU countries have generation history')
if len(prices)<20:
    raise SystemExit(f'ENERGY SYSTEM VALIDATION FAILED: only {len(prices)} EU countries have electricity-price history')
if not data.get('meta',{}).get('history_from') or not data.get('meta',{}).get('history_to'):
    raise SystemExit('ENERGY SYSTEM VALIDATION FAILED: generation archive has no start/end period')
for path, label in [(ROOT/'data/infrastructure/gas-pipelines.geojson','gas'),(ROOT/'data/infrastructure/oil-pipelines.geojson','oil')]:
    if not path.exists():
        raise SystemExit(f'ENERGY SYSTEM VALIDATION FAILED: {label} route snapshot missing')
    obj=json.loads(path.read_text(encoding='utf-8'))
    if obj.get('type')!='FeatureCollection':
        raise SystemExit(f'ENERGY SYSTEM VALIDATION FAILED: {label} routes not GeoJSON FeatureCollection')
print('ENERGY SYSTEM VALIDATION OK')
print(f'Generation countries: {len(mix)} | Electricity prices: {len(prices)} | Generation: {data["meta"]["history_from"]} → {data["meta"]["history_to"]}')

"""Fast offline regression tests for the historical-data parsers.

These tests intentionally use synthetic source-shaped fixtures so the GitHub
Actions workflow can catch layout regressions before it touches checked-in data.
"""
from pathlib import Path
import sys
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import update_data as u  # noqa: E402


def test_commission_blocks() -> None:
    countries = ['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR']
    header = ['DATE']
    for _ in countries:
        header += ['CTR','Motor Fuel 95 RON','Automotive Gas Oil','LPG']
    rows = [header, [None] * len(header), [None] * len(header)]
    for d in pd.date_range('2005-01-03', periods=520, freq='7D'):
        row = [d]
        for idx, code in enumerate(countries):
            row += [f'{code}_', 2143 + idx, 2032 + idx, 861 + idx]
        rows.append(row)
    parsed = u.parse_fuel_sheet(pd.DataFrame(rows))
    assert len(parsed) == len(countries)
    assert len(parsed['CZ']) == 520
    assert parsed['CZ'][0]['petrol95'] == 2.148
    assert parsed['CZ'][0]['diesel'] == 2.037
    assert parsed['CZ'][0]['lpg'] == 0.866


def test_jsonstat_time_axis() -> None:
    fixture = {
        'id': ['freq', 'unit', 'geo', 'time'],
        'size': [1, 1, 1, 3],
        'dimension': {
            'freq': {'category': {'index': {'S': 0}}},
            'unit': {'category': {'index': {'KWH': 0}}},
            'geo': {'category': {'index': {'CZ': 0}}},
            'time': {'category': {'index': {'2024-S1': 0, '2024-S2': 1, '2025-S1': 2}}},
        },
        'value': [10, 11, 12],
    }
    rows = u.flatten_jsonstat(fixture)
    assert [r['time'] for r in rows] == ['2024-S1', '2024-S2', '2025-S1']


def test_overseas_map_trim() -> None:
    def poly(lon, lat):
        return [[[lon, lat], [lon + .2, lat], [lon + .2, lat + .2], [lon, lat + .2], [lon, lat]]]
    fixture = {
        'type': 'FeatureCollection',
        'features': [{
            'type': 'Feature',
            'properties': {'CNTR_CODE': 'FR'},
            'geometry': {'type': 'MultiPolygon', 'coordinates': [poly(2,48)[0], poly(-61,16)[0], poly(55,-21)[0]]},
        }],
    }
    clipped = u.clip_geojson_to_europe(fixture)
    assert len(clipped['features'][0]['geometry']['coordinates']) == 1


def test_czech_region_names_and_lpg_absence() -> None:
    assert u.infer_region_code({'nazev': 'Liberecký kraj'}) == 'CZ051'
    assert u.infer_region_code({'region': 'Ústecký'}) == 'CZ042'
    found = {}
    fixture = {'updated': '2026-09-19', 'kraje': [
        {'nazev': 'Liberecký kraj', 'n95': 43.2, 'nafta': 47.8, 'lpg': 0},
        {'nazev': 'Ústecký kraj', 'n95': 42.9, 'nafta': 47.4, 'lpg': 0},
    ]}
    u.walk_region_objects(fixture, found)
    assert found['CZ051']['petrol95'] == 43.2
    assert found['CZ051']['diesel'] == 47.8
    assert 'lpg' not in found['CZ051']


def test_fred_csv_headers() -> None:
    new = "observation_date,DCOILBRENTEU\n2026-09-18,97.5\n2026-09-19,.\n2026-09-22,98.55\n"
    old = "DATE,DCOILBRENTEU\n2026-09-18,97.5\n2026-09-22,98.55\n"
    assert u.parse_fred_csv(new, 'DCOILBRENTEU') == [
        {'date': '2026-09-18', 'value': 97.5}, {'date': '2026-09-22', 'value': 98.55}]
    assert len(u.parse_fred_csv(old, 'DCOILBRENTEU')) == 2


if __name__ == '__main__':
    test_commission_blocks()
    test_jsonstat_time_axis()
    test_overseas_map_trim()
    test_czech_region_names_and_lpg_absence()
    test_fred_csv_headers()
    print('offline parser checks: OK')

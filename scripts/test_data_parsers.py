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


if __name__ == '__main__':
    test_commission_blocks()
    test_jsonstat_time_axis()
    test_overseas_map_trim()
    print('offline parser checks: OK')

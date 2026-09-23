
from pathlib import Path
import ast

ROOT=Path(__file__).resolve().parents[1]
text=(ROOT/'scripts/update_data.py').read_text(encoding='utf-8')
ast.parse(text)
js=(ROOT/'site/app.js').read_text(encoding='utf-8')
assert 'function renderSupply()' in js
assert 'loadJson(\'./data/supply.json\').catch(()=>null)' in js
idx=(ROOT/'site/index.html').read_text(encoding='utf-8')
assert 'data-view="supply"' in idx
assert 'id="view-supply"' in idx
print('SUPPLY OFFLINE TESTS OK')


assert 'def eurostat_rows_batched' in text
assert 'chunk_size=3' in text
assert 'Request Entity Too Large' in text or '413' in text or 'URL-length' in text
print('SUPPLY BATCHING REGRESSION OK')


# Required archive refreshes must never silently accept a one-country seed archive.
assert 'hard_failures.append(message)' in text
required_blocks = [
    'fuel refresh failed:',
    'gas refresh failed:',
    'Supply refresh failed:',
    'Brent refresh failed:',
    'FX refresh failed:',
]
for marker in required_blocks:
    pos=text.find(marker)
    assert pos >= 0, marker
    window=text[pos:pos+420]
    assert 'hard_failures.append(message)' in window, marker
for forbidden in (
    'keeping previous archive',
    'keeping previous supply archive',
):
    assert forbidden not in text, forbidden
print('REQUIRED ARCHIVE FAILURE-GATE REGRESSION OK')

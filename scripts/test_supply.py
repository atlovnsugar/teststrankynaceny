
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

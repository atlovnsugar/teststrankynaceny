# v8 supply refresh fix

This patch fixes the Eurostat `413 Request Entity Too Large` failure in the Supply & Flows archive.

## What changed

- Supply imports are fetched in small batches of 3 EU countries per request instead of sending all 27 countries in one URL.
- Oil, pipeline gas, LNG and refinery queries all use the batching logic.
- The new `scripts/refresh_supply.py` builds `data/supply.json` and replaces it atomically only after the complete archive passes coverage checks.
- The refresh workflow runs the new supply refresh before validation.
- `data/supply.json` was removed from the workflow's `push.paths`; otherwise a successful data commit would trigger the refresh workflow again indefinitely.
- Existing historical fuel/gas/oil/FX data are not replaced by this patch.

## Deploy

Replace in the repository:

- `scripts/update_data.py`
- `scripts/refresh_supply.py`
- `.github/workflows/update-data.yml`

Do not replace your existing `data/` directory with the sample data from older patches.

Commit and push these changes to `main`. The refresh workflow should run automatically. Then check:

`Actions → Refresh energy data (full archive)`

Expected messages include:

`SUPPLY REFRESH OK: 2016-01 -> ...`

and then:

`DATA VALIDATION OK`

Only after that should the Pages deployment run.

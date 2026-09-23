# Supply & Flows add-on

This patch adds a new **Supply & flows** tab to the EU Energy Situation Room.

## What it adds

- Monthly import-origin history for EU petrol/motor gasoline, diesel/gas oil and LPG.
- Monthly natural-gas import history split into gaseous natural gas and LNG.
- Country-level top import partners and grouped shares for:
  - Russia
  - United States
  - Middle East
  - Norway
  - North Africa
  - Azerbaijan / Caspian
  - United Kingdom
  - EU / intra-EU
  - Other
- EU-27 aggregate calculated by summing the EU member-state import records.
- Interactive origin-share or volume timeline (2/5/10 years or all available).
- A schematic supply-corridor map with animated flow lines. These lines are deliberately **not** presented as literal pipeline routes.
- A refinery-output vs imported-product signal for petrol/diesel where Eurostat short-term refinery data is available.
- External specialist infrastructure links for ENTSOG gas flow/transparency data and Global Energy Monitor oil/gas infrastructure GIS.

## Data sources / methodology

The supply importer uses Eurostat monthly energy-trade datasets:

- `nrg_ti_oilm` for oil-product imports.
- `nrg_ti_gasm` for natural-gas imports.
- `ei_isen_m` for refinery output, when the current Eurostat API exposes the requested indicators.

Oil-product SIEC codes used by the importer:

- `O4652` motor gasoline / petrol.
- `O4671` gas/diesel oil.
- `O4630` liquefied petroleum gases.

Gas SIEC codes:

- `G3000` gaseous natural gas.
- `G3200` LNG.

Eurostat's energy-trade metadata defines the import partner for these energy carriers in terms of the **country of ultimate origin / production**, rather than simply the last transit country.

### Important interpretation limits

The Russia/USA/Middle-East numbers shown by the app are shares of the **selected recorded import stream**. They are not a percentage of total national energy consumption or total energy dependence.

The refinery panel compares refinery output with imported finished-product volume. It is **not** a domestic-consumption share calculation because exports, stocks, blending and refinery feedstock flows are separate accounting items.

The supply corridor lines are a visual flow schematic. They are not a substitute for the exact ENTSOG transmission-point network or an oil-pipeline GIS dataset.

## Deployment sequence

1. Copy the patch files into the existing repository.
2. Do **not** delete your existing `data/fuel-history.json`, `data/gas.json`, `data/oil.json` or `data/fx.json`.
3. Commit and push the patch to `main`.
4. Run:
   `Actions → Refresh energy data (full archive) → Run workflow`
5. Wait for `DATA VALIDATION OK`.
6. The refresh workflow commits the new `data/supply.json`.
7. It then starts the Pages deployment workflow.
8. Open the site and switch to **Supply & flows**.

The first supply refresh downloads a rolling ten-year monthly archive (`2016-01` onward). The app lets users inspect 2 years, 5 years, 10 years or all available observations.

## Existing data safety

This is intentionally delivered as a patch. The ZIP does not contain replacement copies of your already-working historical fuel archive. The only new data file is the small bootstrap `data/supply.json`; it is replaced by the refresh workflow with the validated supply archive.

# EU Energy Price Tracker

A static, source-traceable situation-room dashboard for EU petroleum prices, Czech regional fuel prices, household natural-gas prices, Brent crude, and historical EUR/CZK + USD/CZK conversion. It is designed for free deployment on **GitHub Pages**, with **GitHub Actions** refreshing the data automatically.

## What is included

- EU-27 weekly petrol / diesel / LPG prices from the **European Commission Weekly Oil Bulletin**.
- Full weekly petroleum history back to the oldest date published by the Commission workbook (the publisher labels the archive **2005 onward**). The first post-deployment data-refresh run is a deliberate full backfill, not just a latest-week fetch.
- Czechia highlighted separately, including its EU-wide national fuel history.
- Czech NUTS-3 regional fuel-price map/table. Regional data is deliberately labelled as **secondary** rather than presented as an EU official statistic.
- Household natural-gas prices from **Eurostat `nrg_pc_202`**, using band D2 (20–199 GJ/year), EUR/kWh and `I_TAX` (all taxes and levies included). Eurostat is half-yearly, so the chart is semester-based.
- Daily Europe Brent Spot Price FOB (`DCOILBRENTEU`) from EIA/FRED, with the full available daily series retained.
- Official NUTS 2024 map geometry stored in the repository after each refresh, so the map does not depend on a live third-party tile service.
- Dark/light theme, responsive tables and charts, an international-relations / Cold-War-era operations-room visual language, source badges, and explicit archive dates.

## Deployment: no local hosting required

GitHub Pages can publish a public repository for free, and GitHub's documented workflow is to set **Settings → Pages → Source → GitHub Actions**. The supplied deployment workflow then builds `dist/` and publishes it whenever `main` changes.

### Step 1 — Create the repository

1. Sign in to https://github.com/.
2. Click **New repository**.
3. Give it a name such as `eu-energy-price-tracker`.
4. Set the repository to **Public**. GitHub Pages is available for public repositories on GitHub Free.
5. Do not add another template or generated application framework. You already have all required files in this project.
6. Create the repository.

### Step 2 — Upload this project

You do **not** need to install Node, Python, npm, or a local web server just to deploy the site.

The simplest browser-only route is:

1. Open your new repository.
2. Choose **Add file → Upload files**.
3. Upload the complete contents of this project, including the hidden `.github` directory.
4. Commit directly to the `main` branch.

The `.github/workflows/` directory is important. It contains both the deployment workflow and the scheduled data refresh workflow.

### Step 3 — Enable GitHub Pages

After the repository has the files:

1. Open **Settings**.
2. In the left sidebar, open **Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Save if GitHub shows a save button.

This matches GitHub's current documented Pages workflow.

### Step 4 — Make sure Actions are allowed to write the refreshed data

For this repository, the data-refresh workflow commits refreshed JSON/GeoJSON files back to `main`.

1. Open **Settings → Actions → General**.
2. Keep Actions enabled.
3. Under **Workflow permissions**, choose **Read and write permissions**.
4. Save.

This is required because the refresh workflow needs to push updated files into the repository.

### Step 5 — Run the data refresh once

The refresh workflow runs automatically on its schedule, but you can run it immediately:

1. Open the **Actions** tab.
2. Select **Refresh energy data (full archive)**.
3. Click **Run workflow**.
4. Leave the branch as `main` and run it.
5. Open the run and wait for the job to finish.

The refresh is fail-safe at the source level: when one source is temporarily unavailable or its structure changes, the script keeps the last known-good dataset and records a warning. The separate validation gate then prevents GitHub Pages from publishing a partial/bootstrap archive.

### Step 6 — Watch the deployment

After the refresh creates a new commit, the **Deploy to GitHub Pages** workflow runs automatically.

You can also run deployment manually:

1. Actions → **Deploy to GitHub Pages**.
2. **Run workflow** → `main`.
3. Open the completed run and the GitHub Pages environment URL.

For a repository named `eu-energy-price-tracker`, the normal public URL is:

`https://YOUR-GITHUB-USERNAME.github.io/eu-energy-price-tracker/`

### Step 7 — Future updates

You do not have to update the JSON files by hand.

- GitHub Actions performs a **full archive rebuild** every Friday at **06:15 UTC**, after the Commission's weekly bulletin cycle.
- A manual refresh is available at any time from **Actions → Refresh energy data (full archive) → Run workflow**.
- A successful data commit automatically triggers the deployment workflow.

The source cadence is intentionally not forced to daily: the European Commission oil bulletin is weekly, Eurostat household gas prices are half-yearly, and Brent is daily.

## Data sources and accuracy model

### 1. Petroleum: European Commission Weekly Oil Bulletin

**Historical backfill:** when you deploy the repository for the first time, the checked-in JSON files are only bootstrap content. Run the data workflow once before considering the archive live. That workflow downloads the Commission's historical workbook and rebuilds every EU country's weekly series. The source page explicitly publishes a 'Price developments 2005 onwards' workbook; the parser validates that it sees at least 20 EU countries and a substantial Czech weekly history before replacing the archive.

The user-facing EU Fuel archive selector includes 6 months, 1 year, 5 years, 10 years and **All history**.

This is the primary source used for EU country petrol, diesel and LPG values. The repository parses the Commission's historical workbook rather than copying values from a comparison website. The resulting history is stored as JSON so the public site remains a static app.

The dashboard keeps the source date next to each snapshot and does not interpolate missing source observations.

### 2. Natural gas: Eurostat

The gas loader requests the complete available time dimension from Eurostat rather than the latest observation. The UI exposes the entire stored semester series for a selected country.

The gas dataset is `nrg_pc_202`. This app fixes the selection to:

- household consumer band **D2 (20–199 GJ/year)**
- **EUR/kWh**
- `I_TAX` = all taxes and levies included
- semi-annual frequency

This makes comparisons reproducible instead of mixing household-size bands or tax bases.

### 3. Brent: EIA/FRED

The ETL stores the complete daily CSV response returned by FRED, from the oldest available observation through the newest successful observation.

`DCOILBRENTEU` is used as the daily Europe Brent Spot Price FOB series in USD/barrel. It is a separate market benchmark from retail pump prices.

### 4. Czech regional fuel prices

The Czech regional view is deliberately treated as a separate source class. The app attempts to refresh from a public Czech regional feed (`cenaPHM.cz/data.json`) and keeps the latest successful regional snapshot when that feed is unavailable or changes shape. The UI labels this dataset as secondary.

That distinction matters: the European Commission bulletin gives national consumer-price data; it is not a station-by-station Czech NUTS-3 feed.

### 5. Currency display

The global **EUR / KČ** switch is a display conversion layer; the source values remain stored in their native units. EUR/CZK and USD/CZK come from the ECB's historical reference-rate series. For a historical chart, the rate at the observation date (or the nearest preceding ECB observation) is used. The app never substitutes 1.00 when FX is missing; the converted value stays blank until a valid rate exists.

### 6. Map geometry

The map uses Eurostat GISCO NUTS 2024 geometry. Country and Czech NUTS-3 GeoJSON files are refreshed into `data/geo/` so the published site can use local geometry.

## Optional local validation

You do not need local hosting for deployment. For a developer doing a one-time validation, the project contains dependency-free JavaScript build commands plus a Python ETL environment.

### Validate the static build

Requires Node.js:

```text
node --check site/app.js
node --check scripts/build.mjs
node scripts/build.mjs
```

The build output is written to `dist/`.

### Validate the data refresh script

Requires Python 3.13:

```text
python -m pip install -r requirements.txt
python scripts/update_data.py
```

The script needs outbound internet access to fetch the public source datasets. The historical refresh is intentionally all-or-nothing for the primary series: if a source parser sees an implausibly short archive, it refuses to overwrite the previous dataset.

## Repository structure

```text
.github/workflows/deploy.yml       GitHub Pages deployment
.github/workflows/update-data.yml  scheduled ETL refresh
site/index.html                    app shell
site/styles.css                    styling
site/app.js                        dashboard logic
scripts/build.mjs                  static build
scripts/update_data.py              data ETL
scripts/test_data_parsers.py        offline parser regression checks
requirements.txt                   pinned Python ETL dependencies
data/current.json                  current source snapshots
data/fuel-history.json             EU petroleum history
data/gas.json                      Eurostat gas history
data/oil.json                      Brent history
data/fx.json                       ECB EUR/CZK + USD/CZK history
data/geo/*.geojson                 map geometry
```

## Troubleshooting

### Pages says "Not Found"

Check that **Settings → Pages → Source** is **GitHub Actions** and that the deployment workflow completed successfully.

### The deployment workflow succeeds but the page has no data

Open the repository and verify that `data/current.json`, `data/fuel-history.json`, `data/gas.json`, `data/oil.json`, `data/fx.json`, and the `data/geo/` files exist. Run **Refresh energy data (full archive)** once and then redeploy.

### The regional Czech map falls back to the simplified visualization

The app is designed to remain usable without geometry. Run the data refresh again. If the GISCO download is temporarily unavailable, the existing fallback remains valid and the regional table still works.

### A source changes its public format

The ETL is intentionally defensive. A parser failure leaves the previous dataset in place and records `refresh_warnings` in `data/current.json`. Update `scripts/update_data.py`, commit it, and run the refresh workflow manually.

## Important publishing note

GitHub Pages is well suited to this public informational dashboard because it is a static site. GitHub documents Pages as a website-hosting service rather than a general SaaS/backend platform. The project therefore keeps the data ingestion inside GitHub Actions and publishes only static JSON/assets to Pages.

## Important: first deployment and historical backfill

This version deliberately refuses to publish the dashboard when the checked-in datasets are still the compact bootstrap snapshots. The repository may therefore show a failed **Deploy to GitHub Pages** run immediately after you replace the files; that is intentional.

After replacing the repository contents:

1. Open **Actions → Refresh energy data (full archive) → Run workflow**.
2. Wait for **Validate refreshed archives** to report `DATA VALIDATION OK`.
3. The workflow commits the refreshed `data/` directory.
4. That commit automatically starts **Deploy to GitHub Pages**.
5. The deployed site's top-right **ARCHIVE LIVE** badge links directly to this refresh workflow. If the badge says **BOOTSTRAP · OPEN DATA PIPELINE**, the archive has not passed the validation gate.

The fuel backfill first attempts the European Commission's historical workbook and falls back to a validated flattened mirror of the same Weekly Oil Bulletin series if the workbook layout cannot be parsed safely. The current Commission page explicitly publishes a **Price developments 2005 onwards** workbook.

## Entity dashboards

Countries are clickable in the EU map, fuel tables and natural-gas table. Czech regions are clickable on the Czech map, regional table and regional bars. Clicking opens a modal dashboard with current values, a selectable fuel, a selectable history window and a hoverable historical chart.

## Czech regional LPG

The current public regional feed exposes an LPG field but currently publishes zero placeholders for the regions. The ETL treats those zeros as **not reported** rather than as real prices, so the application intentionally shows `NR` on the Czech regional LPG map/table/dashboard until a genuine regional observation becomes available.


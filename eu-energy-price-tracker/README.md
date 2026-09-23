# EU Energy Price Tracker

A static, professional dashboard for EU petroleum prices, Czech regional fuel prices, household natural-gas prices, and Brent crude. It is designed for free deployment on **GitHub Pages**, with **GitHub Actions** refreshing the data automatically.

## What is included

- EU-27 weekly petrol / diesel / LPG prices from the **European Commission Weekly Oil Bulletin**.
- Historical petroleum prices back to the history exposed by the Commission workbook (currently the workbook covers 2005 onward).
- Czechia highlighted separately, including its EU-wide national fuel history.
- Czech NUTS-3 regional fuel-price map/table. Regional data is deliberately labelled as **secondary** rather than presented as an EU official statistic.
- Household natural-gas prices from **Eurostat `nrg_pc_202`**, using band D2 (20–199 GJ/year), EUR/kWh and `I_TAX` (all taxes and levies included). Eurostat is half-yearly, so the chart is semester-based.
- Daily Europe Brent Spot Price FOB (`DCOILBRENTEU`) from EIA/FRED.
- Official NUTS 2024 map geometry stored in the repository after each refresh, so the map does not depend on a live third-party tile service.
- Dark/light theme, responsive layout, tables, charts, data-source page, and date labels.

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
2. Select **Refresh energy data**.
3. Click **Run workflow**.
4. Leave the branch as `main` and run it.
5. Open the run and wait for the job to finish.

The workflow is intentionally fail-safe for individual sources: when a source is temporarily unavailable or its structure changes, the script keeps the last known-good dataset and records a warning rather than replacing good data with blanks.

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

- GitHub Actions refreshes the sources every Thursday at **06:00 UTC**.
- A manual refresh is available at any time from **Actions → Refresh energy data → Run workflow**.
- A successful data commit automatically triggers the deployment workflow.

The source cadence is intentionally not forced to daily: the European Commission oil bulletin is weekly, Eurostat household gas prices are half-yearly, and Brent is daily.

## Data sources and accuracy model

### 1. Petroleum: European Commission Weekly Oil Bulletin

This is the primary source used for EU country petrol, diesel and LPG values. The repository parses the Commission's historical workbook rather than copying values from a comparison website. The resulting history is stored as JSON so the public site remains a static app.

The dashboard keeps the source date next to each snapshot and does not interpolate missing source observations.

### 2. Natural gas: Eurostat

The gas dataset is `nrg_pc_202`. This app fixes the selection to:

- household consumer band **D2 (20–199 GJ/year)**
- **EUR/kWh**
- `I_TAX` = all taxes and levies included
- semi-annual frequency

This makes comparisons reproducible instead of mixing household-size bands or tax bases.

### 3. Brent: EIA/FRED

`DCOILBRENTEU` is used as the daily Europe Brent Spot Price FOB series in USD/barrel. It is a separate market benchmark from retail pump prices.

### 4. Czech regional fuel prices

The Czech regional view is deliberately treated as a separate source class. The app attempts to refresh from a public Czech regional feed (`cenaPHM.cz/data.json`) and keeps the latest successful regional snapshot when that feed is unavailable or changes shape. The UI labels this dataset as secondary.

That distinction matters: the European Commission bulletin gives national consumer-price data; it is not a station-by-station Czech NUTS-3 feed.

### 5. Map geometry

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

The script needs outbound internet access to fetch the public source datasets.

## Repository structure

```text
.github/workflows/deploy.yml       GitHub Pages deployment
.github/workflows/update-data.yml  scheduled ETL refresh
site/index.html                    app shell
site/styles.css                    styling
site/app.js                        dashboard logic
scripts/build.mjs                  static build
scripts/update_data.py              data ETL
requirements.txt                   pinned Python ETL dependencies
data/current.json                  current source snapshots
data/fuel-history.json             EU petroleum history
data/gas.json                      Eurostat gas history
data/oil.json                      Brent history
data/geo/*.geojson                 map geometry
```

## Troubleshooting

### Pages says "Not Found"

Check that **Settings → Pages → Source** is **GitHub Actions** and that the deployment workflow completed successfully.

### The deployment workflow succeeds but the page has no data

Open the repository and verify that `data/current.json`, `data/fuel-history.json`, `data/gas.json`, `data/oil.json`, and the `data/geo/` files exist. Run **Refresh energy data** once and then redeploy.

### The regional Czech map falls back to the simplified visualization

The app is designed to remain usable without geometry. Run the data refresh again. If the GISCO download is temporarily unavailable, the existing fallback remains valid and the regional table still works.

### A source changes its public format

The ETL is intentionally defensive. A parser failure leaves the previous dataset in place and records `refresh_warnings` in `data/current.json`. Update `scripts/update_data.py`, commit it, and run the refresh workflow manually.

## Important publishing note

GitHub Pages is well suited to this public informational dashboard because it is a static site. GitHub documents Pages as a website-hosting service rather than a general SaaS/backend platform. The project therefore keeps the data ingestion inside GitHub Actions and publishes only static JSON/assets to Pages.

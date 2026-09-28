# v13 — source-only, data-generated-on-GitHub installation

This package is designed for the repository state where your local checkout contains **only source code** and GitHub Actions creates `data/` during the refresh workflow.

## You do NOT need locally

- `data/`
- `dist/`
- historical JSON archives
- GeoJSON archives
- downloaded pipeline files

Do not copy any of those from an older package.

## Copy these files into your repository

Overwrite only:

- `.github/workflows/deploy.yml`
- `.github/workflows/update-data.yml`
- `scripts/build.mjs`

Add:

- `scripts/refresh_energy_system.py`
- `scripts/validate_energy_system.py`
- `site/energy_system.js`
- `site/energy_system.css`
- `site/system_section.html`

Keep your existing `site/index.html`, `site/app.js`, `scripts/update_data.py`, `scripts/validate_data.py`, and the rest of your source tree.

## Why this is simpler

The build script automatically injects the Energy System module into the published site. You do not have to edit `index.html` or `app.js`, and you do not have to run an `apply_patch.py` script.

The Energy System module also removes the old `Supply & flows` tab at runtime and inserts the new `Energy system` tab.

## Local workflow

Your local machine can contain only code.

1. Copy the files above.
2. Commit the code.
3. Force-push the source repository to `main`, as you currently do.
4. GitHub Actions automatically starts `Refresh energy data (full archive)` because the source paths changed.
5. The refresh workflow creates/updates `data/` on the GitHub runner, validates it, and commits the generated archives.
6. A successful completion of that workflow automatically starts `Deploy to GitHub Pages` through `workflow_run`.

The Pages workflow no longer runs on every source push. That prevents the old failure mode where Pages tried to deploy before generated data existed.

## Important

A source-only code push can therefore be followed by **one** refresh workflow run and **one** Pages deployment. You should not manually upload data and you should not run a local ETL just to deploy.

## Manual deployment

`Actions → Deploy to GitHub Pages → Run workflow` is still available, but it expects a previously generated and validated `data/` directory in `main`.

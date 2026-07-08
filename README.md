# warframe-weekly-rivens-archive

Static archive of Warframe's official weekly Riven price JSON files.

This repository is intended for Warframe toolbuilders, data analysis, and
price-history experiments that need stable CDN access to archived official
weekly Riven data.

## What is included

- Official weekly Riven JSON snapshots for `PC`, `PS4`, `XB1`, and `SWI`.
- CDN access through Cloudflare Pages.
- `dates.json` for discovering available archive keys.
- `coverage.json` for latest-week and missing-week metadata.
- Scripts for fetching historical snapshots, fetching current official data,
  regenerating indexes, and auditing the archive.

## Coverage and limitations

This is a transparent archive, not a guarantee of complete historical coverage.
Some weeks are missing, especially between older Internet Archive snapshots and
the current automated collection period.

Use `coverage.json` to inspect coverage before building assumptions into a
client. Each platform includes:

- `latestWeek`: latest archived ISO week key for that platform.
- `fileCount`: number of archived files for that platform.
- `missingWeeks`: ISO week keys missing between the first and latest archived
  weeks.

## CDN access

The `data` directory is deployed as a static Cloudflare Pages site:

- Base URL: https://warframe-weekly-rivens-archive.pages.dev
- Directory page: https://warframe-weekly-rivens-archive.pages.dev/
- Dates index: https://warframe-weekly-rivens-archive.pages.dev/dates.json
- Coverage index: https://warframe-weekly-rivens-archive.pages.dev/coverage.json

Archived weekly files are available by platform and ISO week key:

```text
https://warframe-weekly-rivens-archive.pages.dev/<platform>/<week>_weeklyRivens<platform>.json
```

Example:

```text
https://warframe-weekly-rivens-archive.pages.dev/PC/2026_W28_weeklyRivensPC.json
```

Supported platform keys are `PC`, `PS4`, `XB1`, and `SWI`. Use `dates.json` to discover available weeks, and `coverage.json` for latest-week and coverage metadata.

Cloudflare Pages publishes `data` as the output directory, so files under `data/` are served from the site root. CORS is enabled for all files. `dates.json` and `coverage.json` use `Cache-Control: no-cache` so clients can see new weekly indexes after deployment; platform data files use long immutable caching because archived week files are content-stable.

## Official data source

Announced in official forum post [Riven Trading & Toolbuilders: Phase 1](https://forums.warframe.com/topic/1077490-riven-trading-toolbuilders-phase-1/).

Official endpoints are updated weekly based on the prior week's trades:

- PC: https://www-static.warframe.com/repos/weeklyRivensPC.json
- PS4: https://www-static.warframe.com/repos/weeklyRivensPS4.json
- XB1: https://www-static.warframe.com/repos/weeklyRivensXB1.json
- Switch: https://www-static.warframe.com/repos/weeklyRivensSWI.json

## Scripts

Install dependencies once:

```bash
pnpm install
```

Run the full validation suite:

```bash
pnpm test
```

### Fetch historical Wayback data

```bash
pnpm run fetch:wayback
```

[Fetch from Wayback Machine](scripts/fetch_from_wayback_machine/README.md)
looks up archived snapshots for the official weekly Riven endpoints, keeps one
snapshot per ISO week, writes only new files under `data/<platform>/`, and never
overwrites existing archive files.

To fetch only specific platforms:

```bash
pnpm run fetch:wayback -- PC PS4
```

### Fetch latest official data

```bash
pnpm run fetch:latest
```

[Fetch latest weekly Rivens](scripts/fetch_latest_weekly_rivens/README.md)
fetches the current official endpoint for each platform, compares it with the
latest saved archive file, and writes a new file only when the official JSON has
changed.

The workflow at `.github/workflows/fetch-latest-weekly-rivens.yml` runs this
daily and can also be started manually with `workflow_dispatch`.

### Generate indexes

```bash
pnpm run data:indexes
```

[Generate data indexes](scripts/generate_data_indexes/README.md) rebuilds
`data/dates.json` and `data/coverage.json` from the archive files already
present under `data/<platform>/`. It does not fetch network data and does not
modify weekly Riven JSON files.

### Audit archive data

```bash
pnpm run data:audit
```

Audits archived files for parse errors, duplicate same-week content, and stale
`dates.json` or `coverage.json` indexes. A non-empty finding list exits with a
non-zero status so it can be used in CI.

## Acknowledgments

This project stands on the shoulders of giants. Special thanks to the following open-source projects:

- [rivens-json-browse-back-end](https://github.com/Kanjirito/rivens-json-browse-back-end) - Provided the historical data from `2019-03-25` to `2020-03-30`.

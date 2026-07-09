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

## Usage

### CDN

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

### NPM

For a lightweight SDK wrapper, see [CloudeaSoft/warframe-weekly-rivens](https://github.com/CloudeaSoft/warframe-weekly-rivens).

The package does not include archive data. It builds CDN URLs, fetches JSON from
this archive, and returns the CDN payloads with conservative TypeScript types.

## Official data source

Announced in official forum post [Riven Trading & Toolbuilders: Phase 1](https://forums.warframe.com/topic/1077490-riven-trading-toolbuilders-phase-1/).

Official endpoints are updated weekly based on the prior week's trades:

- PC: https://www-static.warframe.com/repos/weeklyRivensPC.json
- PS4: https://www-static.warframe.com/repos/weeklyRivensPS4.json
- XB1: https://www-static.warframe.com/repos/weeklyRivensXB1.json
- Switch: https://www-static.warframe.com/repos/weeklyRivensSWI.json

## Scripts

Script details are documented in each linked README.

- [Fetch from Wayback Machine](scripts/fetch_from_wayback_machine/README.md) - Fetch historical snapshots from the Wayback Machine.
- [Fetch latest weekly Rivens](scripts/fetch_latest_weekly_rivens/README.md) - Fetch current official weekly Riven data.
- [Generate data indexes](scripts/generate_data_indexes/README.md) - Regenerate `data/dates.json` and `data/coverage.json`.
- [Audit archive data](scripts/audit_archive_data/README.md) - Audit archive files and generated indexes.

## Acknowledgments

This project stands on the shoulders of giants. Special thanks to the following open-source projects:

- [rivens-json-browse-back-end](https://github.com/Kanjirito/rivens-json-browse-back-end) - Provided the historical data from `2019-03-25` to `2020-03-30`.

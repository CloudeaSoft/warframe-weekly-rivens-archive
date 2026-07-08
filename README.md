# warframe-weekly-rivens-archive

Static archive of Warframe's official weekly Riven prices.

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
https://warframe-weekly-rivens-archive.pages.dev/PC/2026_W27_weeklyRivensPC.json
```

Supported platform keys are `PC`, `PS4`, `XB1`, and `SWI`. Use `dates.json` to discover available weeks, and `coverage.json` for latest-week and coverage metadata.

Cloudflare Pages publishes `data` as the output directory, so files under `data/` are served from the site root. CORS is enabled for all files. `dates.json` and `coverage.json` use `Cache-Control: no-cache` so clients can see new weekly indexes after deployment; platform data files use long immutable caching because archived week files are content-stable.

## Official data source

Announced in official forum post [Riven Trading & Toolbuilders: Phase 1](https://forums.warframe.com/topic/1077490-riven-trading-toolbuilders-phase-1/).

PC: Updated weekly based on the prior week's trades: https://www-static.warframe.com/repos/weeklyRivensPC.json
PS4: Updated weekly based on the prior week's trades: https://www-static.warframe.com/repos/weeklyRivensPS4.json
XB1: Updated weekly based on the prior week's trades: https://www-static.warframe.com/repos/weeklyRivensXB1.json
SWITCH: Updated weekly based on the prior week's trades: https://www-static.warframe.com/repos/weeklyRivensSWI.json

## Scripts

- [Fetch from Wayback Machine](scripts/fetch_from_wayback_machine/README.md) - Fetch archived weekly Riven data without overwriting existing files.
- [Fetch latest weekly Rivens](scripts/fetch_latest_weekly_rivens/README.md) - Fetch current official weekly Riven data and save only new content.
- [Generate data indexes](scripts/generate_data_indexes/README.md) - Regenerate `data/dates.json` and `data/coverage.json` from local data files.

## Acknowledgments

This project stands on the shoulders of giants. Special thanks to the following open-source projects:

- [rivens-json-browse-back-end](https://github.com/Kanjirito/rivens-json-browse-back-end) - Provided the historical data from `2019-03-25` to `2020-03-30`.

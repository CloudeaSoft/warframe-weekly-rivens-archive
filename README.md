# warframe-weekly-rivens-history

Historical data for Warframe's official weekly Riven prices.

## Official data source

Announced in official forum post [Riven Trading & Toolbuilders: Phase 1](https://forums.warframe.com/topic/1077490-riven-trading-toolbuilders-phase-1/).

PC: Updated weekly based on the prior week's trades: https://www-static.warframe.com/repos/weeklyRivensPC.json
PS4: Updated weekly based on the prior week's trades: https://www-static.warframe.com/repos/weeklyRivensPS4.json
XB1: Updated weekly based on the prior week's trades: https://www-static.warframe.com/repos/weeklyRivensXB1.json
SWITCH: Updated weekly based on the prior week's trades: https://www-static.warframe.com/repos/weeklyRivensSWI.json

## Scripts

- [Fetch from Wayback Machine](scripts/fetch_from_wayback_machine/README.md) - Fetch archived weekly Riven data without overwriting existing files.
- [Fetch latest weekly Rivens](scripts/fetch_latest_weekly_rivens/README.md) - Fetch current official weekly Riven data and save only new content.

## Acknowledgments

This project stands on the shoulders of giants. Special thanks to the following open-source projects:

- [rivens-json-browse-back-end](https://github.com/Kanjirito/rivens-json-browse-back-end) - Provided the historical data from `2019-03-25` to `2020-03-30`.

# Fetch latest weekly Rivens

Fetch the current official weekly Riven JSON files and save only new content.

This script is written in TypeScript and is intended for GitHub Actions on `ubuntu-latest`.

## Usage

Install dependencies once from the repository root:

```bash
pnpm install
```

Run from the repository root:

```bash
pnpm run fetch:latest
```

By default, the script fetches all supported platforms:

- `PC`
- `PS4`
- `XB1`
- `SWI`

To fetch specific platforms only, pass one or more platform suffixes:

```bash
pnpm run fetch:latest -- PC PS4
```

## Behavior

- Fetches the official latest weekly Riven JSON endpoints.
- Compares fetched JSON against the latest saved file for each platform.
- Skips a platform when the fetched JSON is unchanged.
- Writes a new file when the fetched JSON differs.
- Updates `data/dates.json` after writing new files.

Normal weekly files use this naming pattern:

```text
YYYY_WNN_weeklyRivens<platform>.json
```

If the current ISO week already has a saved file and the official JSON changes again, the script keeps both files and writes a timestamped revision:

```text
YYYY_WNN_YYYYMMDDTHHMMSSZ_weeklyRivens<platform>.json
```

Example:

```text
data/PC/2026_W30_weeklyRivensPC.json
data/PC/2026_W30_20260701T060000Z_weeklyRivensPC.json
```

`data/dates.json` stores the same file keys:

```json
{
  "PC": ["2026_W30", "2026_W30_20260701T060000Z"]
}
```

## GitHub Actions

The workflow at `.github/workflows/fetch-latest-weekly-rivens.yml` runs daily and can also be started manually with `workflow_dispatch`.

When generated data changes, the workflow commits the changed `data/` files with:

```text
chore(data): fetch latest weekly rivens
```

## Tests

Run from the repository root:

```bash
pnpm test
```

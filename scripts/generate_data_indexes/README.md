# Generate data indexes

Generate repository index files from local weekly Riven data files.

## Usage

Run from the repository root:

```bash
pnpm run data:indexes
```

## Behavior

- Scans `data/PC`, `data/PS4`, `data/XB1`, and `data/SWI`.
- Regenerates `data/dates.json` from existing weekly Riven JSON files.
- Regenerates `data/coverage.json` from existing weekly Riven JSON files.
- Does not fetch network data.
- Does not modify weekly Riven JSON data files.

`data/dates.json` stores available file keys by platform:

```json
{
  "PC": ["2026_W27", "2026_W27_20260702T010000Z"]
}
```

`data/coverage.json` summarizes each platform:

```json
{
  "platforms": {
    "PC": {
      "latestWeek": "2026_W27",
      "fileCount": 83,
      "missingWeeks": ["2020_W02"]
    }
  }
}
```

## GitHub Actions

The latest-data workflow runs this script after fetching official data.

## Tests

Run from the repository root:

```bash
pnpm test
```

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
- Uses git history to populate last updated commit and commit time in coverage.
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
      "missingWeeks": ["2020_W02"],
      "lastUpdatedCommit": "42ba3ff527c3f3864796bc9ef58640582e1c4307",
      "lastUpdatedTime": "2026-07-01T14:47:50+08:00"
    }
  }
}
```

## GitHub Actions

The latest-data workflow runs this script after fetching official data. The workflow uses full git history so coverage can calculate last updated metadata.

## Tests

Run from the repository root:

```bash
pnpm test
```

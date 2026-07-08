# Contributing

Contributions are welcome when they improve archive accuracy, documentation, or
the maintenance scripts.

## Setup

Install dependencies from the repository root:

```bash
pnpm install
```

Run the full validation suite before submitting changes:

```bash
pnpm test
```

## Data changes

Archived weekly files live under `data/<platform>/` and use this naming pattern:

```text
YYYY_WNN_weeklyRivens<platform>.json
```

Timestamped revisions are allowed when the same ISO week receives different
official content:

```text
YYYY_WNN_YYYYMMDDTHHMMSSZ_weeklyRivens<platform>.json
```

Do not overwrite existing archive files. Add new files instead, then regenerate
the indexes:

```bash
pnpm run data:indexes
```

Run the archive audit after changing data:

```bash
pnpm run data:audit
```

## Scripts

- `pnpm run fetch:wayback` fetches historical snapshots from the Internet Archive
  Wayback Machine. It skips archive files that already exist.
- `pnpm run fetch:latest` fetches the current official weekly Riven endpoints and
  saves only changed content.
- `pnpm run data:indexes` rebuilds `data/dates.json` and `data/coverage.json`
  from local archive files.
- `pnpm run data:audit` checks JSON parseability, duplicate same-week content,
  and stale generated indexes.

The latest-data workflow at
`.github/workflows/fetch-latest-weekly-rivens.yml` runs daily and can also be
started manually with `workflow_dispatch`.

## Documentation

Keep `README.md` focused on consumers of the archive. Put contributor workflow
details here or in the script-specific README files under `scripts/`.

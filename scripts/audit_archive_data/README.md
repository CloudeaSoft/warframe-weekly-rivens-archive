# Audit archive data

Audit archived weekly Riven data for parse errors, duplicate same-week content,
and stale generated indexes.

## Usage

Run from the repository root:

```bash
pnpm run data:audit
```

To audit a different data directory:

```bash
pnpm run build
node dist/scripts/audit_archive_data/audit_archive_data.js --data-dir path/to/data
```

To write the Markdown report to a file:

```bash
pnpm run build
node dist/scripts/audit_archive_data/audit_archive_data.js --report audit-report.md
```

## Behavior

- Parses archive files under `data/PC`, `data/PS4`, `data/XB1`, and `data/SWI`.
- Reports archive JSON files that cannot be parsed.
- Reports archive JSON files whose payload is not an array.
- Warns when multiple files for the same platform week have duplicate normalized
  content.
- Verifies that `data/dates.json` matches the archive files currently present.
- Verifies that `data/coverage.json` matches the archive files currently
  present.

The script prints a Markdown report to stdout. It exits with status `0` when no
findings are detected, and exits with status `1` when errors or warnings are
reported.

## Options

- `--data-dir <path>`: audit a data directory other than `data`.
- `--report <path>`: write the Markdown report to a file.
- `--help`: print usage information.

## Tests

Run from the repository root:

```bash
pnpm test
```

# Fetch from Wayback Machine

Fetch historical Warframe weekly Riven data snapshots from the Internet Archive Wayback Machine.

## Usage

Run from the repository root:

```powershell
pnpm run fetch:wayback
```

By default, the script fetches all supported platforms:

- `PC`
- `PS4`
- `XB1`
- `SWI`

To fetch specific platforms only, pass one or more platform suffixes:

```powershell
pnpm run build && node dist/scripts/fetch_from_wayback_machine/fetch_from_wayback_machine.js PC PS4
```

If Node reports a local TLS certificate verification error, for example `CERTIFICATE_VERIFY_FAILED`, and you trust your current network, rerun with:

```powershell
pnpm run build && node dist/scripts/fetch_from_wayback_machine/fetch_from_wayback_machine.js --insecure
```

This disables HTTPS certificate verification for the script run. Prefer fixing the local certificate store or proxy certificate chain when possible.

## Behavior

- Looks up archived snapshots for the official weekly Riven JSON endpoints.
- Keeps one snapshot per ISO week, using the latest archived timestamp found for that week.
- Writes new files to `data/<platform>/`.
- Skips files that already exist and never overwrites existing data.
- Adds newly downloaded week keys to `data/dates.json`.

Output files use this naming pattern:

```text
YYYY_WNN_weeklyRivens<platform>.json
```

Example:

```text
data/PC/2019_W13_weeklyRivensPC.json
```

## Requirements

Node.js 18 or newer with `pnpm`. Install dependencies with `pnpm install`.

## Tests

Run from the repository root:

```powershell
pnpm test
```

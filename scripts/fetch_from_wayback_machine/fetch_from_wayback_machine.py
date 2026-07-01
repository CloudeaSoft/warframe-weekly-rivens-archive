from __future__ import annotations

import argparse
import gzip
import json
import random
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Iterable, Mapping


VALID_PLATFORMS = ("PC", "PS4", "XB1", "SWI")
DEFAULT_PLATFORMS = VALID_PLATFORMS
TARGET_URL_TEMPLATE = "https://www-static.warframe.com/repos/weeklyRivens{platform}.json"
CDX_API_URL = "https://web.archive.org/cdx/search/cdx"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"
DATES_PATH = DATA_DIR / "dates.json"
REQUEST_TIMEOUT_SECONDS = 60
DOWNLOAD_DELAY_SECONDS = 1.5
RETRY_COUNT = 3
RETRY_DELAY_SECONDS = 5
RIVEN_FILE_RE = re.compile(
    r"^(?P<week>\d{4}_W\d{2})_weeklyRivens(?P<platform>PC|PS4|XB1|SWI)\.json$",
)


class DownloadError(RuntimeError):
    pass


class HttpResponse:
    def __init__(self, status_code: int, text: str, url: str) -> None:
        self.status_code = status_code
        self.text = text
        self.url = url

    def json(self) -> object:
        return json.loads(self.text)

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise DownloadError(f"HTTP {self.status_code}: {self.url}")


class HttpSession:
    def __init__(self, *, verify_tls: bool = True) -> None:
        self.headers: dict[str, str] = {}
        self.tls_context = build_tls_context(verify_tls=verify_tls)

    def __enter__(self) -> HttpSession:
        return self

    def __exit__(self, exc_type: object, exc_value: object, traceback: object) -> None:
        return None

    def get(
        self,
        url: str,
        *,
        params: dict[str, str] | None = None,
        timeout: int = REQUEST_TIMEOUT_SECONDS,
    ) -> HttpResponse:
        if params:
            separator = "&" if "?" in url else "?"
            url = f"{url}{separator}{urllib.parse.urlencode(params)}"

        request = urllib.request.Request(url, headers=self.headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout, context=self.tls_context) as response:
                body = response.read()
                charset = response.headers.get_content_charset() or "utf-8"
                return HttpResponse(
                    response.status,
                    decode_response_body(body, response.headers, charset),
                    response.geturl(),
                )
        except urllib.error.HTTPError as error:
            body = error.read()
            charset = error.headers.get_content_charset() if error.headers else None
            return HttpResponse(
                error.code,
                decode_response_body(body, error.headers or {}, charset or "utf-8"),
                url,
            )


def decode_response_body(body: bytes, headers: Mapping[str, str], charset: str) -> str:
    encoding = headers.get("Content-Encoding", "")
    if "gzip" in encoding.lower():
        body = gzip.decompress(body)

    return body.decode(charset, errors="replace")


def build_tls_context(*, verify_tls: bool) -> ssl.SSLContext | None:
    if verify_tls:
        return None

    return ssl._create_unverified_context()


def request_with_retries(
    session: HttpSession,
    url: str,
    *,
    params: dict[str, str] | None = None,
) -> HttpResponse:
    last_error: Exception | None = None

    for attempt in range(1, RETRY_COUNT + 1):
        try:
            response = session.get(url, params=params, timeout=REQUEST_TIMEOUT_SECONDS)
            if response.status_code == 503:
                raise DownloadError("HTTP 503")
            response.raise_for_status()
            return response
        except (TimeoutError, OSError, urllib.error.URLError, DownloadError) as error:
            last_error = error
            if attempt < RETRY_COUNT:
                print(
                    f"  retry {attempt}/{RETRY_COUNT - 1}: {error}; wait {RETRY_DELAY_SECONDS}s",
                    flush=True,
                )
                time.sleep(RETRY_DELAY_SECONDS)

    raise DownloadError(f"request failed: {url}") from last_error


def target_url_for_platform(platform: str) -> str:
    return TARGET_URL_TEMPLATE.format(platform=platform)


def fetch_cdx_rows(session: HttpSession, target_url: str) -> list[list[str]]:
    params = {
        "url": target_url,
        "output": "json",
        "fl": "timestamp,original,statuscode",
        "filter": "statuscode:200",
    }
    response = request_with_retries(session, CDX_API_URL, params=params)
    data = response.json()
    if not isinstance(data, list) or len(data) < 2:
        return []
    return data[1:]


def unique_weekly_timestamps(rows: Iterable[list[str]]) -> list[str]:
    timestamp_by_week: dict[tuple[int, int], str] = {}

    for row in rows:
        if not row:
            continue
        timestamp = row[0]
        captured_at = datetime.strptime(timestamp, "%Y%m%d%H%M%S")
        iso_year, iso_week, _ = captured_at.isocalendar()
        week_key = (iso_year, iso_week)
        if timestamp > timestamp_by_week.get(week_key, ""):
            timestamp_by_week[week_key] = timestamp

    return sorted(timestamp_by_week.values())


def output_path_for_timestamp(platform: str, timestamp: str) -> Path:
    captured_at = datetime.strptime(timestamp, "%Y%m%d%H%M%S")
    iso_year, iso_week, _ = captured_at.isocalendar()
    return DATA_DIR / platform / f"{iso_year}_W{iso_week:02d}_weeklyRivens{platform}.json"


def archive_download_url(target_url: str, timestamp: str) -> str:
    return f"https://web.archive.org/web/{timestamp}id_/{target_url}"


def normalize_json_payload(text: str) -> str | None:
    stripped = text.lstrip()
    if not stripped.startswith(("[", "{")):
        return None

    def dump_json(data: object) -> str:
        return json.dumps(data, ensure_ascii=False, indent=2)

    try:
        return dump_json(json.loads(stripped))
    except json.JSONDecodeError:
        pass

    # Some Warframe snapshots are served as JS object literals:
    # unquoted keys with single-quoted strings. Normalize them to strict JSON.
    normalized = re.sub(r"'([^'\\]*(?:\\.[^'\\]*)*)'", r'"\1"', stripped)
    normalized = re.sub(
        r"([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)",
        r'\1"\2"\3',
        normalized,
    )

    try:
        return dump_json(json.loads(normalized))
    except json.JSONDecodeError:
        return None


def download_snapshot(
    session: HttpSession,
    platform: str,
    target_url: str,
    timestamp: str,
    index: int,
    total: int,
) -> Path | None:
    date = timestamp[:8]
    output_path = output_path_for_timestamp(platform, timestamp)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if output_path.exists():
        print(f"[{platform} {index}/{total}] {date} exists, skip", flush=True)
        return None

    print(f"[{platform} {index}/{total}] downloading {date} ...", end=" ", flush=True)
    try:
        try:
            response = request_with_retries(session, archive_download_url(target_url, timestamp))
        except DownloadError as error:
            print(f"failed: {error}", flush=True)
            return None

        text = normalize_json_payload(response.text)
        if text is None:
            print("failed: response is not plain JSON", flush=True)
            return None

        output_path.write_text(text, encoding="utf-8")
        print("ok", flush=True)
        return output_path
    finally:
        time.sleep(DOWNLOAD_DELAY_SECONDS)


def week_sort_key(week_key: str) -> tuple[int, int]:
    year, week = week_key.split("_W", maxsplit=1)
    return int(year), int(week)


def date_index_for_platforms(data: object) -> dict[str, list[str]]:
    if not isinstance(data, dict):
        data = {}

    dates: dict[str, list[str]] = {}
    for platform in VALID_PLATFORMS:
        values = data.get(platform, [])
        if not isinstance(values, list):
            values = []
        dates[platform] = sorted({str(value) for value in values}, key=week_sort_key)

    return dates


def riven_file_week(path: Path) -> tuple[str, str] | None:
    match = RIVEN_FILE_RE.match(path.name)
    if match is None:
        return None

    return match.group("platform"), match.group("week")


def load_dates_index(dates_path: Path) -> dict[str, list[str]]:
    if not dates_path.exists():
        return date_index_for_platforms({})

    return date_index_for_platforms(json.loads(dates_path.read_text(encoding="utf-8")))


def update_dates_index(dates_path: Path, downloaded_paths: Iterable[Path]) -> bool:
    downloaded = list(downloaded_paths)
    if not downloaded:
        return False

    dates = load_dates_index(dates_path)
    before = json.dumps(dates, ensure_ascii=False, sort_keys=True)

    for path in downloaded:
        week_info = riven_file_week(path)
        if week_info is None:
            continue

        platform, week_key = week_info
        dates.setdefault(platform, [])
        if week_key not in dates[platform]:
            dates[platform].append(week_key)
            dates[platform].sort(key=week_sort_key)

    after = json.dumps(dates, ensure_ascii=False, sort_keys=True)
    if after == before:
        return False

    dates_path.parent.mkdir(parents=True, exist_ok=True)
    dates_path.write_text(
        json.dumps(dates, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return True


def json_files(path: Path) -> list[Path]:
    return sorted(path.rglob("*.json"))


def folder_size_mb(path: Path) -> float:
    total_bytes = sum(file.stat().st_size for file in json_files(path))
    return total_bytes / 1024 / 1024


def print_sample_file(path: Path) -> None:
    files = json_files(path)
    if not files:
        print("no local JSON files found; cannot sample", flush=True)
        return

    sample = random.choice(files)
    head = sample.read_text(encoding="utf-8", errors="replace")[:100]
    print(f"sample file: {sample.relative_to(path)}", flush=True)
    print(f"first 100 chars: {head}", flush=True)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch historical Warframe weekly riven snapshots from Wayback Machine.",
    )
    parser.add_argument(
        "--insecure",
        action="store_true",
        help="Disable TLS certificate verification. Use only when a local proxy or certificate store breaks HTTPS verification.",
    )
    parser.add_argument(
        "platforms",
        nargs="*",
        choices=VALID_PLATFORMS,
        default=None,
        help="Platform suffixes to fetch. Defaults to PC PS4 XB1 SWI.",
    )
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    platforms = list(dict.fromkeys(args.platforms or DEFAULT_PLATFORMS))
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    total_downloaded = 0
    downloaded_paths: list[Path] = []
    if args.insecure:
        print("warning: TLS certificate verification is disabled", flush=True)

    with HttpSession(verify_tls=not args.insecure) as session:
        session.headers.update(
            {
                "User-Agent": "koishi-plugin-warframe-riven-history-fetcher/1.0",
            },
        )

        for platform in platforms:
            target_url = target_url_for_platform(platform)
            rows = fetch_cdx_rows(session, target_url)
            timestamps = unique_weekly_timestamps(rows)
            print(
                f"[CDX {platform}] rows={len(rows)} unique_weeks={len(timestamps)}",
                flush=True,
            )

            downloaded = 0
            for index, timestamp in enumerate(timestamps, start=1):
                downloaded_path = download_snapshot(
                    session,
                    platform,
                    target_url,
                    timestamp,
                    index,
                    len(timestamps),
                )
                if downloaded_path is not None:
                    downloaded += 1
                    downloaded_paths.append(downloaded_path)

            total_downloaded += downloaded
            platform_file_count = len(json_files(DATA_DIR / platform))
            print(
                f"[summary {platform}] downloaded={downloaded} files={platform_file_count}",
                flush=True,
            )

    dates_updated = update_dates_index(DATES_PATH, downloaded_paths)
    print(f"dates index updated: {dates_updated}", flush=True)
    print(f"downloaded this run: {total_downloaded}", flush=True)
    print(f"local JSON files total: {len(json_files(DATA_DIR))}", flush=True)
    print(f"disk usage: {folder_size_mb(DATA_DIR):.2f} MB", flush=True)
    print_sample_file(DATA_DIR)


if __name__ == "__main__":
    main()

import JSON5 from "json5";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export const VALID_PLATFORMS = ["PC", "PS4", "XB1", "SWI"] as const;

export type Platform = (typeof VALID_PLATFORMS)[number];

export const DEFAULT_PLATFORMS: readonly Platform[] = VALID_PLATFORMS;

const TARGET_URL_TEMPLATE = "https://www-static.warframe.com/repos/weeklyRivens{platform}.json";
const CDX_API_URL = "https://web.archive.org/cdx/search/cdx";
const REQUEST_TIMEOUT_MS = 60_000;
const DOWNLOAD_DELAY_MS = 1_500;
const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 5_000;
const RIVEN_FILE_RE = /^(\d{4}_W\d{2})_weeklyRivens(PC|PS4|XB1|SWI)\.json$/;

export class DownloadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DownloadError";
  }
}

export interface HttpResponse {
  status: number;
  text: string;
  url: string;
}

export type FetchResponseFn = (url: string, params?: Record<string, string>) => Promise<HttpResponse>;

export interface ParsedArgs {
  help: boolean;
  insecure: boolean;
  platforms: Platform[];
}

export interface DownloadSnapshotOptions {
  downloadDelayMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
}

export interface RunOptions {
  argv?: string[];
  cwd?: string;
  dataDir?: string;
  datesPath?: string;
  fetchResponse?: FetchResponseFn;
  downloadDelayMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
}

export function projectDataPaths(cwd: string): { dataDir: string; datesPath: string } {
  const dataDir = join(cwd, "data");
  return {
    dataDir,
    datesPath: join(dataDir, "dates.json"),
  };
}

export function targetUrlForPlatform(platform: Platform): string {
  return TARGET_URL_TEMPLATE.replace("{platform}", platform);
}

export function applyInsecureTls(): void {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

function parseTimestamp(timestamp: string): Date {
  const year = Number(timestamp.slice(0, 4));
  const month = Number(timestamp.slice(4, 6)) - 1;
  const day = Number(timestamp.slice(6, 8));
  const hour = Number(timestamp.slice(8, 10));
  const minute = Number(timestamp.slice(10, 12));
  const second = Number(timestamp.slice(12, 14));
  return new Date(Date.UTC(year, month, day, hour, minute, second));
}

function isoYearWeek(date: Date): { year: number; week: number } {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const isoYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const isoWeek = Math.ceil(((utcDate.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);

  return { year: isoYear, week: isoWeek };
}

export function outputPathForTimestamp(dataDir: string, platform: string, timestamp: string): string {
  const date = parseTimestamp(timestamp);
  const { year, week } = isoYearWeek(date);
  const weekKey = `${year}_W${String(week).padStart(2, "0")}`;
  return join(dataDir, platform, `${weekKey}_weeklyRivens${platform}.json`);
}

export function archiveDownloadUrl(targetUrl: string, timestamp: string): string {
  return `https://web.archive.org/web/${timestamp}id_/${targetUrl}`;
}

export function normalizeJsonPayload(text: string): string | null {
  const stripped = text.trimStart();
  if (!stripped.startsWith("[") && !stripped.startsWith("{")) {
    return null;
  }

  try {
    return JSON.stringify(JSON5.parse(stripped), null, 2);
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function requestWithRetries(
  fetchResponse: FetchResponseFn,
  url: string,
  options: { retryCount?: number; retryDelayMs?: number; params?: Record<string, string> } = {},
): Promise<HttpResponse> {
  const retryCount = options.retryCount ?? RETRY_COUNT;
  const retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      const response = await fetchResponse(url, options.params);
      if (response.status === 503) {
        throw new DownloadError("HTTP 503");
      }
      if (response.status >= 400) {
        throw new DownloadError(`HTTP ${response.status}: ${response.url}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retryCount) {
        console.log(
          `  retry ${attempt}/${retryCount - 1}: ${error instanceof Error ? error.message : error}; wait ${retryDelayMs / 1000}s`,
        );
        await sleep(retryDelayMs);
      }
    }
  }

  throw new DownloadError(`request failed: ${url}`, { cause: lastError });
}

export async function fetchCdxRows(
  fetchResponse: FetchResponseFn,
  targetUrl: string,
  options: { retryCount?: number; retryDelayMs?: number } = {},
): Promise<string[][]> {
  const params: Record<string, string> = {
    url: targetUrl,
    output: "json",
    fl: "timestamp,original,statuscode",
    filter: "statuscode:200",
  };
  const response = await requestWithRetries(fetchResponse, CDX_API_URL, {
    ...options,
    params,
  });
  const data: unknown = JSON.parse(response.text);
  if (!Array.isArray(data) || data.length < 2) {
    return [];
  }
  return data.slice(1) as string[][];
}

export function uniqueWeeklyTimestamps(rows: string[][]): string[] {
  const timestampByWeek = new Map<string, string>();

  for (const row of rows) {
    if (!row || row.length === 0) {
      continue;
    }
    const timestamp = row[0];
    if (timestamp === undefined) {
      continue;
    }
    const date = parseTimestamp(timestamp);
    const { year, week } = isoYearWeek(date);
    const weekKey = `${year}_W${String(week).padStart(2, "0")}`;
    const existing = timestampByWeek.get(weekKey);
    if (existing === undefined || timestamp > existing) {
      timestampByWeek.set(weekKey, timestamp);
    }
  }

  return [...timestampByWeek.values()].sort();
}

export function compareWeekKeys(left: string, right: string): number {
  const parseKey = (key: string): [number, number, string] => {
    const match = /^(\d{4})_W(\d{2})(?:_(\d{8}T\d{6}Z))?$/.exec(key);
    if (match === null) {
      return [0, 0, key];
    }
    return [Number(match[1]), Number(match[2]), match[3] ?? ""];
  };
  const [ly, lw, lr] = parseKey(left);
  const [ry, rw, rr] = parseKey(right);
  if (ly !== ry) {
    return ly - ry;
  }
  if (lw !== rw) {
    return lw - rw;
  }
  return lr.localeCompare(rr);
}

export function dateIndexForPlatforms(data: unknown): Record<string, string[]> {
  const record = (data !== null && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const dates: Record<string, string[]> = {};
  for (const platform of VALID_PLATFORMS) {
    const values = Array.isArray(record[platform]) ? record[platform] : [];
    dates[platform] = [...new Set(values.map(String))].sort(compareWeekKeys);
  }

  return dates;
}

export function rivenFileWeek(filePath: string): { platform: string; week: string } | null {
  const match = RIVEN_FILE_RE.exec(basename(filePath));
  if (match === null) {
    return null;
  }

  return { platform: match[2], week: match[1] };
}

async function loadDatesIndex(datesPath: string): Promise<Record<string, string[]>> {
  if (!existsSync(datesPath)) {
    return dateIndexForPlatforms({});
  }

  return dateIndexForPlatforms(JSON.parse(await readFile(datesPath, "utf8")));
}

export async function updateDatesIndex(
  datesPath: string,
  downloadedPaths: string[],
): Promise<boolean> {
  if (downloadedPaths.length === 0) {
    return false;
  }

  const dates = await loadDatesIndex(datesPath);
  const before = JSON.stringify(dates);

  for (const filePath of downloadedPaths) {
    const weekInfo = rivenFileWeek(filePath);
    if (weekInfo === null) {
      continue;
    }

    const { platform, week: weekKey } = weekInfo;
    if (!dates[platform]) {
      dates[platform] = [];
    }
    if (!dates[platform].includes(weekKey)) {
      dates[platform].push(weekKey);
      dates[platform].sort(compareWeekKeys);
    }
  }

  const after = JSON.stringify(dates);
  if (after === before) {
    return false;
  }

  await mkdir(dirname(datesPath), { recursive: true });
  await writeFile(datesPath, `${JSON.stringify(dates, null, 2)}\n`, "utf8");
  return true;
}

async function jsonFiles(dirPath: string): Promise<string[]> {
  if (!existsSync(dirPath)) {
    return [];
  }

  const result: string[] = [];
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await jsonFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      result.push(fullPath);
    }
  }

  return result.sort();
}

async function folderSizeMb(dirPath: string): Promise<number> {
  const files = await jsonFiles(dirPath);
  let totalBytes = 0;
  for (const file of files) {
    const stats = await stat(file);
    totalBytes += stats.size;
  }
  return totalBytes / 1024 / 1024;
}

async function printSampleFile(dirPath: string): Promise<void> {
  const files = await jsonFiles(dirPath);
  if (files.length === 0) {
    console.log("no local JSON files found; cannot sample");
    return;
  }

  const sample = files[Math.floor(Math.random() * files.length)] ?? files[0];
  const content = await readFile(sample, "utf8");
  const head = content.slice(0, 100);
  console.log(`sample file: ${relative(dirPath, sample)}`);
  console.log(`first 100 chars: ${head}`);
}

export async function downloadSnapshot(
  fetchResponse: FetchResponseFn,
  dataDir: string,
  platform: string,
  targetUrl: string,
  timestamp: string,
  index: number,
  total: number,
  options: DownloadSnapshotOptions = {},
): Promise<string | null> {
  const downloadDelayMs = options.downloadDelayMs ?? DOWNLOAD_DELAY_MS;
  const retryCount = options.retryCount ?? RETRY_COUNT;
  const retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;

  const date = timestamp.slice(0, 8);
  const outputPath = outputPathForTimestamp(dataDir, platform, timestamp);
  await mkdir(dirname(outputPath), { recursive: true });

  if (existsSync(outputPath)) {
    console.log(`[${platform} ${index}/${total}] ${date} exists, skip`);
    return null;
  }

  process.stdout.write(`[${platform} ${index}/${total}] downloading ${date} ... `);
  try {
    let response: HttpResponse;
    try {
      response = await requestWithRetries(fetchResponse, archiveDownloadUrl(targetUrl, timestamp), {
        retryCount,
        retryDelayMs,
      });
    } catch (error) {
      console.log(`failed: ${error instanceof Error ? error.message : error}`);
      return null;
    }

    const text = normalizeJsonPayload(response.text);
    if (text === null) {
      console.log("failed: response is not plain JSON");
      return null;
    }

    await writeFile(outputPath, text, "utf8");
    console.log("ok");
    return outputPath;
  } finally {
    await sleep(downloadDelayMs);
  }
}

function createDefaultFetchResponse(): FetchResponseFn {
  return async (url: string, params?: Record<string, string>): Promise<HttpResponse> => {
    let fullUrl = url;
    if (params) {
      const search = new URLSearchParams(params).toString();
      fullUrl += (url.includes("?") ? "&" : "?") + search;
    }

    console.log(`request: ${decodeURIComponent(fullUrl)}`);
    const response = await fetch(fullUrl, {
      headers: {
        "User-Agent": "warframe-weekly-rivens-history-fetcher/1.0",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();

    return {
      status: response.status,
      text,
      url: response.url || fullUrl,
    };
  };
}

function printHelp(): void {
  console.log(`Usage: node dist/scripts/fetch_from_wayback_machine/fetch_from_wayback_machine.js [options] [platform ...]

Fetch historical Warframe weekly riven snapshots from Wayback Machine.

Options:
  --insecure    Disable TLS certificate verification. Use only when a local proxy
                or certificate store breaks HTTPS verification.

Platforms: ${VALID_PLATFORMS.join(" ")}
Defaults to PC PS4 XB1 SWI
`);
}

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { help: true, insecure: false, platforms: [] };
  }

  const insecure = argv.includes("--insecure");
  const rest = argv.filter((arg) => arg !== "--insecure" && arg !== "--help" && arg !== "-h");

  const platformList = rest.length === 0 ? [...DEFAULT_PLATFORMS] : [...new Set(rest)];
  for (const platform of platformList) {
    if (!VALID_PLATFORMS.includes(platform as Platform)) {
      throw new Error(`Unknown platform: ${platform}`);
    }
  }

  return { help: false, insecure, platforms: platformList as Platform[] };
}

export async function run({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  dataDir,
  datesPath,
  fetchResponse,
  downloadDelayMs = DOWNLOAD_DELAY_MS,
  retryCount = RETRY_COUNT,
  retryDelayMs = RETRY_DELAY_MS,
}: RunOptions = {}): Promise<void> {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const resolvedDataDir = dataDir ?? projectDataPaths(cwd).dataDir;
  const resolvedDatesPath = datesPath ?? join(resolvedDataDir, "dates.json");
  await mkdir(resolvedDataDir, { recursive: true });

  if (args.insecure) {
    console.log("warning: TLS certificate verification is disabled");
    applyInsecureTls();
  }

  const sessionFetch = fetchResponse ?? createDefaultFetchResponse();
  const platforms = [...new Set(args.platforms)];

  let totalDownloaded = 0;
  const downloadedPaths: string[] = [];

  for (const platform of platforms) {
    const targetUrl = targetUrlForPlatform(platform);
    const rows = await fetchCdxRows(sessionFetch, targetUrl, { retryCount, retryDelayMs });
    const timestamps = uniqueWeeklyTimestamps(rows);
    console.log(`[CDX ${platform}] rows=${rows.length} unique_weeks=${timestamps.length}`);

    let downloaded = 0;
    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = timestamps[i];
      if (timestamp === undefined) {
        continue;
      }
      const downloadedPath = await downloadSnapshot(
        sessionFetch,
        resolvedDataDir,
        platform,
        targetUrl,
        timestamp,
        i + 1,
        timestamps.length,
        { downloadDelayMs, retryCount, retryDelayMs },
      );
      if (downloadedPath !== null) {
        downloaded++;
        downloadedPaths.push(downloadedPath);
      }
    }

    totalDownloaded += downloaded;
    const platformFiles = await jsonFiles(join(resolvedDataDir, platform));
    console.log(`[summary ${platform}] downloaded=${downloaded} files=${platformFiles.length}`);
  }

  const datesUpdated = await updateDatesIndex(resolvedDatesPath, downloadedPaths);
  console.log(`dates index updated: ${datesUpdated}`);
  console.log(`downloaded this run: ${totalDownloaded}`);
  const allFiles = await jsonFiles(resolvedDataDir);
  console.log(`local JSON files total: ${allFiles.length}`);
  const sizeMb = await folderSizeMb(resolvedDataDir);
  console.log(`disk usage: ${sizeMb.toFixed(2)} MB`);
  await printSampleFile(resolvedDataDir);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

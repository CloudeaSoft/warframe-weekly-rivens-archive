import JSON5 from "json5";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const VALID_PLATFORMS = ["PC", "PS4", "XB1", "SWI"] as const;

export type Platform = (typeof VALID_PLATFORMS)[number];
export type FetchResultStatus = "saved" | "unchanged";

export interface FetchResult {
  status: FetchResultStatus;
  platform: Platform;
  key: string;
  filePath: string;
}

export interface FetchAndStoreOptions {
  dataDir: string;
  platform: Platform;
  now?: Date;
  fetchText?: (url: string) => Promise<string>;
}

export interface RunOptions {
  argv?: string[];
  cwd?: string;
  dataDir?: string;
  now?: Date;
  fetchText?: (url: string) => Promise<string>;
}

const TARGET_URL_TEMPLATE = "https://www-static.warframe.com/repos/weeklyRivens{platform}.json";
const FILE_KEY_RE = /^(\d{4})_W(\d{2})(?:_(\d{8}T\d{6}Z))?$/;
const RIVEN_FILE_RE = /^(\d{4}_W\d{2}(?:_\d{8}T\d{6}Z)?)_weeklyRivens(PC|PS4|XB1|SWI)\.json$/;
const RIVEN_FIELD_ORDER = [
  "itemType",
  "compatibility",
  "rerolled",
  "avg",
  "stddev",
  "min",
  "max",
  "pop",
  "median",
] as const;

export function projectDataPaths(cwd: string): { dataDir: string } {
  const dataDir = join(cwd, "data");
  return {
    dataDir,
  };
}

export function targetUrlForPlatform(platform: Platform): string {
  return TARGET_URL_TEMPLATE.replace("{platform}", platform);
}

export function isoWeekKey(date: Date): string {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const isoYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const isoWeek = Math.ceil(((utcDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

  return `${isoYear}_W${String(isoWeek).padStart(2, "0")}`;
}

export function revisionTimestamp(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");

  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function isRivenRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && typeof value.itemType === "string";
}

function rivenSortName(value: Record<string, unknown>): string {
  return typeof value.compatibility === "string" ? value.compatibility : String(value.itemType ?? "");
}

function compareRivenRecords(left: Record<string, unknown>, right: Record<string, unknown>): number {
  const leftGeneric = left.compatibility === null || left.compatibility === undefined;
  const rightGeneric = right.compatibility === null || right.compatibility === undefined;
  if (leftGeneric !== rightGeneric) {
    return leftGeneric ? -1 : 1;
  }

  const nameCompare = compareStrings(rivenSortName(left), rivenSortName(right));
  if (nameCompare !== 0) {
    return nameCompare;
  }

  if (left.rerolled !== right.rerolled) {
    if (left.rerolled === false) {
      return -1;
    }
    if (right.rerolled === false) {
      return 1;
    }
  }

  return compareStrings(String(left.itemType ?? ""), String(right.itemType ?? ""));
}

function orderObjectFields(record: Record<string, unknown>): Record<string, unknown> {
  const knownKeys = RIVEN_FIELD_ORDER.filter((key) => Object.hasOwn(record, key));
  const extraKeys = Object.keys(record)
    .filter((key) => !RIVEN_FIELD_ORDER.includes(key as (typeof RIVEN_FIELD_ORDER)[number]))
    .sort(compareStrings);

  return Object.fromEntries(
    [...knownKeys, ...extraKeys].map((key) => [key, normalizeOutputValue(record[key])]),
  );
}

function normalizeOutputValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const normalizedItems = value.map(normalizeOutputValue);
    if (normalizedItems.every(isRivenRecord)) {
      return [...normalizedItems].sort(compareRivenRecords);
    }
    return normalizedItems;
  }

  if (isRecord(value)) {
    return orderObjectFields(value);
  }

  return value;
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalJsonValue);
  }

  if (isRecord(value)) {
    const record = value;
    return Object.fromEntries(
      Object.keys(record)
        .sort(compareStrings)
        .map((key) => [key, canonicalJsonValue(record[key])]),
    );
  }

  return value;
}

export function normalizeJsonText(text: string): string {
  return `${JSON.stringify(normalizeOutputValue(JSON5.parse(text)), null, 2)}\n`;
}

function canonicalJsonText(text: string): string {
  return `${JSON.stringify(canonicalJsonValue(JSON5.parse(text)), null, 2)}\n`;
}

interface ParsedFileKey {
  year: number;
  week: number;
  revision: string;
}

function parseFileKey(key: string): ParsedFileKey | null {
  const match = FILE_KEY_RE.exec(key);
  if (match === null) {
    return null;
  }

  return {
    year: Number(match[1]),
    week: Number(match[2]),
    revision: match[3] ?? "",
  };
}

export function compareFileKeys(left: string, right: string): number {
  const parsedLeft = parseFileKey(left);
  const parsedRight = parseFileKey(right);
  if (parsedLeft === null || parsedRight === null) {
    return left.localeCompare(right);
  }

  if (parsedLeft.year !== parsedRight.year) {
    return parsedLeft.year - parsedRight.year;
  }
  if (parsedLeft.week !== parsedRight.week) {
    return parsedLeft.week - parsedRight.week;
  }

  return parsedLeft.revision.localeCompare(parsedRight.revision);
}

export function filePathForKey(dataDir: string, platform: Platform, key: string): string {
  return join(dataDir, platform, `${key}_weeklyRivens${platform}.json`);
}

async function scanPlatformKeys(dataDir: string, platform: Platform): Promise<string[]> {
  const platformDir = join(dataDir, platform);
  if (!existsSync(platformDir)) {
    return [];
  }

  const files = await readdir(platformDir);
  return files.flatMap((file) => {
    const match = RIVEN_FILE_RE.exec(file);
    if (match === null || match[2] !== platform) {
      return [];
    }
    return [match[1]];
  });
}

async function latestSavedKey(dataDir: string, platform: Platform): Promise<string | null> {
  const scannedKeys = await scanPlatformKeys(dataDir, platform);
  const keys = [...new Set(scannedKeys)].sort(compareFileKeys);

  return keys.at(-1) ?? null;
}

async function nextOutputKey(dataDir: string, platform: Platform, now: Date): Promise<string> {
  const baseKey = isoWeekKey(now);
  if (!existsSync(filePathForKey(dataDir, platform, baseKey))) {
    return baseKey;
  }

  let offsetSeconds = 0;
  while (true) {
    const revisedKey = `${baseKey}_${revisionTimestamp(new Date(now.getTime() + offsetSeconds * 1000))}`;
    if (!existsSync(filePathForKey(dataDir, platform, revisedKey))) {
      return revisedKey;
    }
    offsetSeconds += 1;
  }
}

async function defaultFetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "warframe-weekly-rivens-history-fetcher/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }

  return response.text();
}

export async function fetchAndStorePlatform({
  dataDir,
  platform,
  now = new Date(),
  fetchText = defaultFetchText,
}: FetchAndStoreOptions): Promise<FetchResult> {
  const fetchedText = await fetchText(targetUrlForPlatform(platform));
  const normalizedFetchedText = normalizeJsonText(fetchedText);
  const latestKey = await latestSavedKey(dataDir, platform);

  if (latestKey !== null) {
    const latestPath = filePathForKey(dataDir, platform, latestKey);
    if (existsSync(latestPath)) {
      const canonicalLatestText = canonicalJsonText(await readFile(latestPath, "utf8"));
      const canonicalFetchedText = canonicalJsonText(fetchedText);
      if (canonicalLatestText === canonicalFetchedText) {
        return { status: "unchanged", platform, key: latestKey, filePath: latestPath };
      }
    }
  }

  const outputKey = await nextOutputKey(dataDir, platform, now);
  const outputPath = filePathForKey(dataDir, platform, outputKey);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, normalizedFetchedText);

  return { status: "saved", platform, key: outputKey, filePath: outputPath };
}

function printHelp(): void {
  console.log(`Usage: node dist/scripts/fetch_latest_weekly_rivens/fetch_latest_weekly_rivens.js [platform ...]

Fetch current official weekly Riven files and store new content.

Platforms: ${VALID_PLATFORMS.join(" ")}
Default: all platforms
`);
}

function parseArgs(argv: string[]): { help: boolean; platforms: Platform[] } {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { help: true, platforms: [] };
  }

  const platforms = argv.length === 0 ? VALID_PLATFORMS : [...new Set(argv)];
  for (const platform of platforms) {
    if (!VALID_PLATFORMS.includes(platform as Platform)) {
      throw new Error(`Unknown platform: ${platform}`);
    }
  }

  return { help: false, platforms: platforms as Platform[] };
}

export async function run({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  dataDir = projectDataPaths(cwd).dataDir,
  now = new Date(),
  fetchText = defaultFetchText,
}: RunOptions = {}): Promise<FetchResult[]> {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return [];
  }

  const results: FetchResult[] = [];
  for (const platform of args.platforms) {
    const result = await fetchAndStorePlatform({ dataDir, platform, now, fetchText });
    results.push(result);
    console.log(`[${platform}] ${result.status} ${result.key}`);
  }

  const saved = results.filter((result) => result.status === "saved").length;
  console.log(`saved this run: ${saved}`);
  return results;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

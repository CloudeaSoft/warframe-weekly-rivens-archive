import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  VALID_PLATFORMS,
  compareFileKeys,
  isoWeekKey,
  type Platform,
} from "../fetch_latest_weekly_rivens/fetch_latest_weekly_rivens.js";

export interface LastUpdated {
  commit: string | null;
  time: string | null;
}

export interface PlatformCoverage {
  latestWeek: string | null;
  fileCount: number;
  missingWeeks: string[];
  lastUpdatedCommit: string | null;
  lastUpdatedTime: string | null;
}

export type DatesIndex = Record<Platform, string[]>;

export interface Coverage {
  platforms: Record<Platform, PlatformCoverage>;
}

export interface BuildCoverageOptions {
  dataDir: string;
  cwd?: string;
  getLastUpdated?: (platform: Platform) => Promise<LastUpdated>;
}

export interface WriteDataIndexOptions extends BuildCoverageOptions {
  datesPath?: string;
  coveragePath?: string;
}

const RIVEN_FILE_RE = /^((\d{4}_W\d{2})(?:_\d{8}T\d{6}Z)?)_weeklyRivens(PC|PS4|XB1|SWI)\.json$/;

function parseWeekKey(key: string): { year: number; week: number } | null {
  const match = /^(\d{4})_W(\d{2})$/.exec(key);
  if (match === null) {
    return null;
  }

  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > weeksInIsoYear(year)) {
    return null;
  }

  return { year, week };
}

function compareWeekKeys(left: string, right: string): number {
  const parsedLeft = parseWeekKey(left);
  const parsedRight = parseWeekKey(right);
  if (parsedLeft === null || parsedRight === null) {
    return left.localeCompare(right);
  }

  if (parsedLeft.year !== parsedRight.year) {
    return parsedLeft.year - parsedRight.year;
  }

  return parsedLeft.week - parsedRight.week;
}

function weeksInIsoYear(year: number): number {
  const lastIsoWeek = isoWeekKey(new Date(Date.UTC(year, 11, 28)));
  return Number(lastIsoWeek.slice(-2));
}

function nextWeekKey(key: string): string {
  const parsed = parseWeekKey(key);
  if (parsed === null) {
    throw new Error(`Invalid ISO week key: ${key}`);
  }

  const weeksInYear = weeksInIsoYear(parsed.year);
  if (parsed.week < weeksInYear) {
    return `${parsed.year}_W${String(parsed.week + 1).padStart(2, "0")}`;
  }

  return `${parsed.year + 1}_W01`;
}

function missingWeeksBetween(presentWeeks: Set<string>, firstWeek: string, latestWeek: string): string[] {
  const missingWeeks: string[] = [];
  for (let week = firstWeek; compareWeekKeys(week, latestWeek) <= 0; week = nextWeekKey(week)) {
    if (!presentWeeks.has(week)) {
      missingWeeks.push(week);
    }
  }

  return missingWeeks;
}

async function scanPlatformFiles(dataDir: string, platform: Platform): Promise<{
  fileKeys: string[];
  weekKeys: string[];
}> {
  const platformDir = join(dataDir, platform);
  if (!existsSync(platformDir)) {
    return { fileKeys: [], weekKeys: [] };
  }

  const files = await readdir(platformDir);
  const fileKeys: string[] = [];
  const weekKeys: string[] = [];

  for (const file of files) {
    const match = RIVEN_FILE_RE.exec(file);
    if (match === null || match[3] !== platform || parseWeekKey(match[2]) === null) {
      continue;
    }

    fileKeys.push(match[1]);
    weekKeys.push(match[2]);
  }

  return {
    fileKeys: [...new Set(fileKeys)].sort(compareFileKeys),
    weekKeys: [...new Set(weekKeys)].sort(compareWeekKeys),
  };
}

export async function buildDatesIndex(dataDir: string): Promise<DatesIndex> {
  const dates = {} as DatesIndex;

  for (const platform of VALID_PLATFORMS) {
    const { fileKeys } = await scanPlatformFiles(dataDir, platform);
    dates[platform] = fileKeys;
  }

  return dates;
}

async function scanPlatformCoverage(dataDir: string, platform: Platform): Promise<{
  fileCount: number;
  latestWeek: string | null;
  missingWeeks: string[];
}> {
  const { fileKeys, weekKeys } = await scanPlatformFiles(dataDir, platform);
  const latestWeek = weekKeys.at(-1) ?? null;
  const firstWeek = weekKeys[0] ?? null;
  const presentWeeks = new Set(weekKeys);
  const missingWeeks =
    firstWeek === null || latestWeek === null ? [] : missingWeeksBetween(presentWeeks, firstWeek, latestWeek);

  return { fileCount: fileKeys.length, latestWeek, missingWeeks };
}

export async function lastUpdatedFromGit(cwd: string, platform: Platform): Promise<LastUpdated> {
  const result = spawnSync(
    "git",
    ["log", "-1", "--format=%H%x00%cI", "--", `data/${platform}`],
    {
      cwd,
      encoding: "utf8",
    },
  );

  if (result.status !== 0 || result.stdout.trim() === "") {
    return { commit: null, time: null };
  }

  const [commit, time] = result.stdout.trim().split("\0");
  return {
    commit: commit || null,
    time: time || null,
  };
}

export async function buildCoverage({
  dataDir,
  cwd = process.cwd(),
  getLastUpdated = (platform) => lastUpdatedFromGit(cwd, platform),
}: BuildCoverageOptions): Promise<Coverage> {
  const platforms = {} as Record<Platform, PlatformCoverage>;

  for (const platform of VALID_PLATFORMS) {
    const [coverage, lastUpdated] = await Promise.all([
      scanPlatformCoverage(dataDir, platform),
      getLastUpdated(platform),
    ]);

    platforms[platform] = {
      latestWeek: coverage.latestWeek,
      fileCount: coverage.fileCount,
      missingWeeks: coverage.missingWeeks,
      lastUpdatedCommit: lastUpdated.commit,
      lastUpdatedTime: lastUpdated.time,
    };
  }

  return { platforms };
}

export async function writeDataIndexFiles({
  dataDir,
  datesPath = join(dataDir, "dates.json"),
  coveragePath = join(dataDir, "coverage.json"),
  cwd = process.cwd(),
  getLastUpdated,
}: WriteDataIndexOptions): Promise<{ dates: DatesIndex; coverage: Coverage }> {
  const [dates, coverage] = await Promise.all([
    buildDatesIndex(dataDir),
    buildCoverage({ dataDir, cwd, getLastUpdated }),
  ]);

  await mkdir(dirname(datesPath), { recursive: true });
  await mkdir(dirname(coveragePath), { recursive: true });
  await writeFile(datesPath, `${JSON.stringify(dates, null, 2)}\n`);
  await writeFile(coveragePath, `${JSON.stringify(coverage, null, 2)}\n`);

  return { dates, coverage };
}

function printHelp(): void {
  console.log(`Usage: node dist/scripts/generate_data_indexes/generate_data_indexes.js

Generate data/dates.json and data/coverage.json from local weekly Riven data files.
`);
}

export async function run({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
}: {
  argv?: string[];
  cwd?: string;
} = {}): Promise<{ dates: DatesIndex; coverage: Coverage }> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return {
      dates: {} as DatesIndex,
      coverage: { platforms: {} as Record<Platform, PlatformCoverage> },
    };
  }

  return writeDataIndexFiles({
    dataDir: join(cwd, "data"),
    datesPath: join(cwd, "data", "dates.json"),
    coveragePath: join(cwd, "data", "coverage.json"),
    cwd,
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

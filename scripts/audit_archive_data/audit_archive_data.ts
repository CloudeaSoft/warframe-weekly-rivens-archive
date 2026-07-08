import JSON5 from "json5";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import {
  VALID_PLATFORMS,
  normalizeJsonText,
  type Platform,
} from "../fetch_latest_weekly_rivens/fetch_latest_weekly_rivens.js";
import {
  buildCoverage,
  buildDatesIndex,
  type DatesIndex,
} from "../generate_data_indexes/generate_data_indexes.js";

export type FindingSeverity = "error" | "warning";

export interface AuditFinding {
  severity: FindingSeverity;
  message: string;
  files: string[];
}

export interface AuditReport {
  findings: AuditFinding[];
}

export interface AuditArchiveDataOptions {
  dataDir: string;
}

const RIVEN_FILE_RE = /^((\d{4}_W\d{2})(?:_\d{8}T\d{6}Z)?)_weeklyRivens(PC|PS4|XB1|SWI)\.json$/;

interface RivenFile {
  platform: Platform;
  key: string;
  week: string;
  path: string;
}

function formatPath(dataDir: string, path: string): string {
  return relative(join(dataDir, ".."), path).replaceAll("\\", "/");
}

function isDatesIndex(value: unknown): value is DatesIndex {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return VALID_PLATFORMS.every((platform) => Array.isArray(record[platform]));
}

function sortedDatesIndex(value: DatesIndex): DatesIndex {
  const dates = {} as DatesIndex;
  for (const platform of VALID_PLATFORMS) {
    dates[platform] = [...value[platform]].sort();
  }
  return dates;
}

async function scanRivenFiles(dataDir: string): Promise<RivenFile[]> {
  const files: RivenFile[] = [];

  for (const platform of VALID_PLATFORMS) {
    const platformDir = join(dataDir, platform);
    if (!existsSync(platformDir)) {
      continue;
    }

    for (const file of await readdir(platformDir)) {
      const match = RIVEN_FILE_RE.exec(file);
      if (match === null || match[3] !== platform) {
        continue;
      }

      files.push({
        platform,
        key: match[1],
        week: match[2],
        path: join(platformDir, file),
      });
    }
  }

  return files;
}

async function auditJsonPayloads(dataDir: string, files: RivenFile[]): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  for (const file of files) {
    const path = formatPath(dataDir, file.path);
    try {
      const payload = JSON5.parse(await readFile(file.path, "utf8"));
      if (!Array.isArray(payload)) {
        findings.push({
          severity: "error",
          message: "Riven archive file payload is not an array.",
          files: [path],
        });
      }
    } catch (error) {
      findings.push({
        severity: "error",
        message: `Riven archive file cannot be parsed: ${error instanceof Error ? error.message : String(error)}`,
        files: [path],
      });
    }
  }

  return findings;
}

async function auditDuplicateWeekContent(dataDir: string, files: RivenFile[]): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const byPlatformWeek = new Map<string, RivenFile[]>();

  for (const file of files) {
    const key = `${file.platform}/${file.week}`;
    byPlatformWeek.set(key, [...(byPlatformWeek.get(key) ?? []), file]);
  }

  for (const group of byPlatformWeek.values()) {
    if (group.length < 2) {
      continue;
    }

    const byContent = new Map<string, RivenFile[]>();
    for (const file of group) {
      let normalized: string;
      try {
        normalized = normalizeJsonText(await readFile(file.path, "utf8"));
      } catch {
        continue;
      }
      byContent.set(normalized, [...(byContent.get(normalized) ?? []), file]);
    }

    for (const duplicates of byContent.values()) {
      if (duplicates.length < 2) {
        continue;
      }

      findings.push({
        severity: "warning",
        message: `Duplicate normalized content for ${duplicates[0]?.platform} ${duplicates[0]?.week}.`,
        files: duplicates.map((file) => formatPath(dataDir, file.path)),
      });
    }
  }

  return findings;
}

async function auditDatesIndex(dataDir: string): Promise<AuditFinding[]> {
  const datesPath = join(dataDir, "dates.json");
  if (!existsSync(datesPath)) {
    return [
      {
        severity: "error",
        message: "dates.json is missing.",
        files: [formatPath(dataDir, datesPath)],
      },
    ];
  }

  const parsed = JSON5.parse(await readFile(datesPath, "utf8"));
  if (!isDatesIndex(parsed)) {
    return [
      {
        severity: "error",
        message: "dates.json does not contain platform arrays for PC, PS4, XB1, and SWI.",
        files: [formatPath(dataDir, datesPath)],
      },
    ];
  }

  const expected = sortedDatesIndex(await buildDatesIndex(dataDir));
  const actual = sortedDatesIndex(parsed);
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    return [];
  }

  return [
    {
      severity: "error",
      message: "dates.json does not match the archive files currently present under data/<platform>/.",
      files: [formatPath(dataDir, datesPath)],
    },
  ];
}

async function auditCoverageIndex(dataDir: string): Promise<AuditFinding[]> {
  const coveragePath = join(dataDir, "coverage.json");
  if (!existsSync(coveragePath)) {
    return [
      {
        severity: "error",
        message: "coverage.json is missing.",
        files: [formatPath(dataDir, coveragePath)],
      },
    ];
  }

  const actual = JSON5.parse(await readFile(coveragePath, "utf8"));
  const expected = await buildCoverage({ dataDir });
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    return [];
  }

  return [
    {
      severity: "error",
      message: "coverage.json does not match the archive files currently present under data/<platform>/.",
      files: [formatPath(dataDir, coveragePath)],
    },
  ];
}

export async function auditArchiveData({
  dataDir,
}: AuditArchiveDataOptions): Promise<AuditReport> {
  const files = await scanRivenFiles(dataDir);
  const findings = [
    ...(await auditJsonPayloads(dataDir, files)),
    ...(await auditDuplicateWeekContent(dataDir, files)),
    ...(await auditDatesIndex(dataDir)),
    ...(await auditCoverageIndex(dataDir)),
  ];

  return { findings };
}

export function renderMarkdownReport(report: AuditReport): string {
  if (report.findings.length === 0) {
    return [
      "# Archive Data Audit",
      "",
      "No archive data issues were detected.",
      "",
    ].join("\n");
  }

  const lines = [
    "# Archive Data Audit",
    "",
    `Detected ${report.findings.length} archive data issue(s).`,
    "",
  ];

  for (const finding of report.findings) {
    lines.push(`## ${finding.severity.toUpperCase()}: ${finding.message}`);
    lines.push("");
    for (const file of finding.files) {
      lines.push(`- \`${file}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function parseArgs(argv: string[]): { dataDir: string; reportPath: string | null } {
  let dataDir = join(process.cwd(), "data");
  let reportPath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--data-dir") {
      dataDir = argv[index + 1] ?? dataDir;
      index += 1;
    } else if (arg === "--report") {
      reportPath = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node dist/scripts/audit_archive_data/audit_archive_data.js [--data-dir data] [--report report.md]

Audit archived weekly Riven data for parse errors, duplicate same-week content, and stale indexes.
`);
      process.exitCode = 0;
    }
  }

  return { dataDir, reportPath };
}

export async function run(argv = process.argv.slice(2)): Promise<AuditReport> {
  const { dataDir, reportPath } = parseArgs(argv);
  const report = await auditArchiveData({ dataDir });
  const markdown = renderMarkdownReport(report);

  if (reportPath !== null) {
    await writeFile(reportPath, markdown);
  }

  console.log(markdown);
  process.exitCode = report.findings.length === 0 ? 0 : 1;
  return report;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  DEFAULT_PLATFORMS,
  DownloadError,
  VALID_PLATFORMS,
  applyInsecureTls,
  downloadSnapshot,
  normalizeJsonPayload,
  outputPathForTimestamp,
  parseArgs,
  updateDatesIndex,
  type FetchResponseFn,
} from "./fetch_from_wayback_machine.js";

async function makeTempDataDir(): Promise<{ dataDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "wayback-rivens-"));
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  return { dataDir };
}

test("default platforms include all known platforms for one-click run", () => {
  assert.deepEqual([...DEFAULT_PLATFORMS], [...VALID_PLATFORMS]);
});

test("script help runs without external requests dependency", () => {
  const scriptPath = fileURLToPath(new URL("./fetch_from_wayback_machine.js", import.meta.url));
  const result = spawnSync(process.execPath, [scriptPath, "--help"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout ?? "", /Fetch historical Warframe weekly riven snapshots/);
  assert.match(result.stdout ?? "", /Defaults to PC PS4 XB1 SWI/);
  assert.match(result.stdout ?? "", /--insecure/);
});

test("parseArgs supports insecure TLS option", () => {
  const args = parseArgs(["--insecure", "PC"]);

  assert.equal(args.insecure, true);
  assert.deepEqual(args.platforms, ["PC"]);
});

test("applyInsecureTls disables TLS certificate verification", () => {
  const original = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try {
    applyInsecureTls();
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0");
  } finally {
    if (original === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = original;
    }
  }
});

test("outputPathForTimestamp targets project data folder", () => {
  const output_path = outputPathForTimestamp("D:\\repo\\data", "PC", "20190327120000");
  const expected = join("D:\\repo\\data", "PC", "2019_W13_weeklyRivensPC.json");

  assert.equal(output_path, expected);
});

test("downloadSnapshot skips existing data file without fetching", async () => {
  const { dataDir } = await makeTempDataDir();
  const timestamp = "20190327120000";
  const outputPath = outputPathForTimestamp(dataDir, "PC", timestamp);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, "existing", "utf8");

  let called = false;
  const fetchResponse: FetchResponseFn = () => {
    called = true;
    return Promise.reject(new Error("should not be called"));
  };

  const downloadedPath = await downloadSnapshot(
    fetchResponse,
    dataDir,
    "PC",
    "https://example.test/weeklyRivensPC.json",
    timestamp,
    1,
    1,
    { downloadDelayMs: 0 },
  );

  assert.equal(downloadedPath, null);
  assert.equal(await readFile(outputPath, "utf8"), "existing");
  assert.equal(called, false);
});

test("downloadSnapshot continues after snapshot download error", async () => {
  const { dataDir } = await makeTempDataDir();

  const fetchResponse: FetchResponseFn = () =>
    Promise.reject(new DownloadError("request failed"));

  const downloadedPath = await downloadSnapshot(
    fetchResponse,
    dataDir,
    "PC",
    "https://example.test/weeklyRivensPC.json",
    "20240621163605",
    1,
    1,
    { downloadDelayMs: 0, retryCount: 1, retryDelayMs: 0 },
  );

  assert.equal(downloadedPath, null);
});

test("normalizeJsonPayload parses Warframe object-literal payloads", () => {
  const result = normalizeJsonPayload("[{ itemType: 'Archgun Riven Mod', compatibility: null }]");

  assert.equal(
    result,
    '[\n  {\n    "itemType": "Archgun Riven Mod",\n    "compatibility": null\n  }\n]',
  );
});

test("normalizeJsonPayload returns null for non-JSON text", () => {
  assert.equal(normalizeJsonPayload("<html>not json</html>"), null);
});

test("updateDatesIndex merges downloaded weeks sorted and unique", async () => {
  const root = await mkdtemp(join(tmpdir(), "wayback-dates-"));
  const datesPath = join(root, "dates.json");
  await writeFile(
    datesPath,
    `${JSON.stringify({ PC: ["2019_W14"], PS4: [], XB1: [], SWI: [] }, null, 2)}\n`,
    "utf8",
  );

  const changed = await updateDatesIndex(datesPath, [
    join(root, "data", "PC", "2019_W13_weeklyRivensPC.json"),
    join(root, "data", "PC", "2019_W14_weeklyRivensPC.json"),
  ]);

  assert.equal(changed, true);
  const dates = JSON.parse(await readFile(datesPath, "utf8")) as Record<string, string[]>;
  assert.deepEqual(dates.PC, ["2019_W13", "2019_W14"]);
});

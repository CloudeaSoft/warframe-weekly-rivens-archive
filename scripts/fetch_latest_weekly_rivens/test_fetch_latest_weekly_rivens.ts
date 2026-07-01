import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  fetchAndStorePlatform,
  isoWeekKey,
  normalizeJsonText,
  projectDataPaths,
  run,
  updateDatesIndex,
} from "./fetch_latest_weekly_rivens.js";

async function makeTempRepo(): Promise<{ dataDir: string; datesPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "weekly-rivens-"));
  const dataDir = join(root, "data");
  const datesPath = join(dataDir, "dates.json");
  await mkdir(join(dataDir, "PC"), { recursive: true });
  await writeFile(
    datesPath,
    `${JSON.stringify({ PC: [], PS4: [], XB1: [], SWI: [] }, null, 2)}\n`,
  );

  return { dataDir, datesPath };
}

test("isoWeekKey uses ISO week year boundaries", () => {
  assert.equal(isoWeekKey(new Date(Date.UTC(2021, 0, 1))), "2020_W53");
  assert.equal(isoWeekKey(new Date(Date.UTC(2021, 0, 4))), "2021_W01");
});

test("normalizeJsonText compares equivalent JSON independent of object key order", () => {
  assert.equal(
    normalizeJsonText('[{"b":2,"a":1}]'),
    normalizeJsonText('[{"a":1,"b":2}]'),
  );
});

test("normalizeJsonText parses Warframe object-literal payloads", () => {
  assert.equal(
    normalizeJsonText("[{ itemType: 'Archgun Riven Mod', compatibility: null }]"),
    '[\n  {\n    "compatibility": null,\n    "itemType": "Archgun Riven Mod"\n  }\n]\n',
  );
});

test("projectDataPaths uses the provided working directory", () => {
  assert.deepEqual(projectDataPaths("D:\\repo"), {
    dataDir: join("D:\\repo", "data"),
    datesPath: join("D:\\repo", "data", "dates.json"),
  });
});

test("updateDatesIndex merges file keys sorted and unique", async () => {
  const { datesPath } = await makeTempRepo();

  const changed = await updateDatesIndex(datesPath, [
    { platform: "PC", key: "2021_W01_20210105T123456Z" },
    { platform: "PC", key: "2021_W01" },
    { platform: "PC", key: "2021_W01" },
  ]);

  const dates = JSON.parse(await readFile(datesPath, "utf8")) as Record<string, string[]>;
  assert.equal(changed, true);
  assert.deepEqual(dates.PC, [
    "2021_W01",
    "2021_W01_20210105T123456Z",
  ]);
});

test("fetchAndStorePlatform skips when fetched JSON matches latest saved file", async () => {
  const { dataDir, datesPath } = await makeTempRepo();
  await writeFile(
    join(dataDir, "PC", "2021_W01_weeklyRivensPC.json"),
    '[{"weapon":"Braton","rank":1}]\n',
  );
  await writeFile(
    datesPath,
    `${JSON.stringify({ PC: ["2021_W01"], PS4: [], XB1: [], SWI: [] }, null, 2)}\n`,
  );

  const result = await fetchAndStorePlatform({
    dataDir,
    datesPath,
    platform: "PC",
    now: new Date(Date.UTC(2021, 0, 11, 12, 0, 0)),
    fetchText: async () => '[{"rank":1,"weapon":"Braton"}]',
  });

  assert.equal(result.status, "unchanged");
  assert.deepEqual(await readdir(join(dataDir, "PC")), [
    "2021_W01_weeklyRivensPC.json",
  ]);
});

test("fetchAndStorePlatform writes the current week when content changes", async () => {
  const { dataDir, datesPath } = await makeTempRepo();
  await writeFile(
    join(dataDir, "PC", "2020_W53_weeklyRivensPC.json"),
    '[{"weapon":"Old"}]\n',
  );
  await writeFile(
    datesPath,
    `${JSON.stringify({ PC: ["2020_W53"], PS4: [], XB1: [], SWI: [] }, null, 2)}\n`,
  );

  const result = await fetchAndStorePlatform({
    dataDir,
    datesPath,
    platform: "PC",
    now: new Date(Date.UTC(2021, 0, 4, 12, 0, 0)),
    fetchText: async () => '[{"weapon":"New"}]',
  });

  assert.equal(result.status, "saved");
  assert.equal(result.key, "2021_W01");
  assert.equal(result.filePath, join(dataDir, "PC", "2021_W01_weeklyRivensPC.json"));

  const dates = JSON.parse(await readFile(datesPath, "utf8")) as Record<string, string[]>;
  assert.deepEqual(dates.PC, ["2020_W53", "2021_W01"]);
});

test("fetchAndStorePlatform writes a timestamped revision when the current week already exists", async () => {
  const { dataDir, datesPath } = await makeTempRepo();
  await writeFile(
    join(dataDir, "PC", "2021_W01_weeklyRivensPC.json"),
    '[{"weapon":"Old"}]\n',
  );
  await writeFile(
    datesPath,
    `${JSON.stringify({ PC: ["2021_W01"], PS4: [], XB1: [], SWI: [] }, null, 2)}\n`,
  );

  const result = await fetchAndStorePlatform({
    dataDir,
    datesPath,
    platform: "PC",
    now: new Date(Date.UTC(2021, 0, 5, 12, 34, 56)),
    fetchText: async () => '[{"weapon":"Revised"}]',
  });

  assert.equal(result.status, "saved");
  assert.equal(result.key, "2021_W01_20210105T123456Z");
  assert.equal(
    result.filePath,
    join(dataDir, "PC", "2021_W01_20210105T123456Z_weeklyRivensPC.json"),
  );

  const dates = JSON.parse(await readFile(datesPath, "utf8")) as Record<string, string[]>;
  assert.deepEqual(dates.PC, [
    "2021_W01",
    "2021_W01_20210105T123456Z",
  ]);
});

test("run defaults data paths to the provided working directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "weekly-rivens-root-"));
  const dataDir = join(root, "data");
  const datesPath = join(dataDir, "dates.json");
  await mkdir(join(dataDir, "PC"), { recursive: true });
  await writeFile(
    datesPath,
    `${JSON.stringify({ PC: [], PS4: [], XB1: [], SWI: [] }, null, 2)}\n`,
  );

  const results = await run({
    argv: ["PC"],
    cwd: root,
    now: new Date(Date.UTC(2021, 0, 4, 12, 0, 0)),
    fetchText: async () => "[{ itemType: 'Archgun Riven Mod' }]",
  });

  assert.equal(results[0]?.status, "saved");
  assert.equal(
    await readFile(join(dataDir, "PC", "2021_W01_weeklyRivensPC.json"), "utf8"),
    '[\n  {\n    "itemType": "Archgun Riven Mod"\n  }\n]\n',
  );
});

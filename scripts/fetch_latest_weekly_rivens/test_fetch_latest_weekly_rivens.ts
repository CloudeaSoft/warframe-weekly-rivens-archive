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
} from "./fetch_latest_weekly_rivens.js";

async function makeTempRepo(): Promise<{ dataDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "weekly-rivens-"));
  const dataDir = join(root, "data");
  await mkdir(join(dataDir, "PC"), { recursive: true });

  return { dataDir };
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
    '[\n  {\n    "itemType": "Archgun Riven Mod",\n    "compatibility": null\n  }\n]\n',
  );
});

test("normalizeJsonText writes riven fields in official schema order", () => {
  assert.equal(
    normalizeJsonText(
      '[{"median":7,"pop":2,"max":12,"min":3,"stddev":4.5,"avg":8,"rerolled":false,"compatibility":"Braton","itemType":"Rifle Riven Mod"}]',
    ),
    '[\n  {\n    "itemType": "Rifle Riven Mod",\n    "compatibility": "Braton",\n    "rerolled": false,\n    "avg": 8,\n    "stddev": 4.5,\n    "min": 3,\n    "max": 12,\n    "pop": 2,\n    "median": 7\n  }\n]\n',
  );
});

test("normalizeJsonText sorts riven entries by item name then rerolled state", () => {
  assert.equal(
    normalizeJsonText(
      JSON.stringify([
        { itemType: "Rifle Riven Mod", compatibility: "Braton", rerolled: true },
        { itemType: "Rifle Riven Mod", compatibility: "Acceltra", rerolled: true },
        { itemType: "Rifle Riven Mod", compatibility: "Acceltra", rerolled: false },
        { itemType: "Melee Riven Mod", compatibility: null, rerolled: false },
      ]),
    ),
    '[\n  {\n    "itemType": "Melee Riven Mod",\n    "compatibility": null,\n    "rerolled": false\n  },\n  {\n    "itemType": "Rifle Riven Mod",\n    "compatibility": "Acceltra",\n    "rerolled": false\n  },\n  {\n    "itemType": "Rifle Riven Mod",\n    "compatibility": "Acceltra",\n    "rerolled": true\n  },\n  {\n    "itemType": "Rifle Riven Mod",\n    "compatibility": "Braton",\n    "rerolled": true\n  }\n]\n',
  );
});

test("projectDataPaths uses the provided working directory", () => {
  assert.deepEqual(projectDataPaths("D:\\repo"), {
    dataDir: join("D:\\repo", "data"),
  });
});

test("fetchAndStorePlatform skips when fetched JSON matches latest saved file", async () => {
  const { dataDir } = await makeTempRepo();
  await writeFile(
    join(dataDir, "PC", "2021_W01_weeklyRivensPC.json"),
    '[{"weapon":"Braton","rank":1}]\n',
  );

  const result = await fetchAndStorePlatform({
    dataDir,
    platform: "PC",
    now: new Date(Date.UTC(2021, 0, 11, 12, 0, 0)),
    fetchText: async () => '[{"rank":1,"weapon":"Braton"}]',
  });

  assert.equal(result.status, "unchanged");
  assert.deepEqual(await readdir(join(dataDir, "PC")), [
    "2021_W01_weeklyRivensPC.json",
  ]);
});

test("fetchAndStorePlatform skips unchanged latest file when dates index is stale", async () => {
  const { dataDir } = await makeTempRepo();
  const datesPath = join(dataDir, "dates.json");
  await writeFile(
    join(dataDir, "PC", "2021_W01_weeklyRivensPC.json"),
    '[{"weapon":"Old"}]\n',
  );
  await writeFile(
    join(dataDir, "PC", "2021_W02_weeklyRivensPC.json"),
    '[{"weapon":"Braton","rank":1}]\n',
  );
  await writeFile(
    datesPath,
    `${JSON.stringify({ PC: ["2021_W01"], PS4: [], XB1: [], SWI: [] }, null, 2)}\n`,
  );

  const result = await fetchAndStorePlatform({
    dataDir,
    platform: "PC",
    now: new Date(Date.UTC(2021, 0, 11, 12, 0, 0)),
    fetchText: async () => '[{"rank":1,"weapon":"Braton"}]',
  });

  assert.equal(result.status, "unchanged");
  assert.deepEqual(await readdir(join(dataDir, "PC")), [
    "2021_W01_weeklyRivensPC.json",
    "2021_W02_weeklyRivensPC.json",
  ]);
});

test("fetchAndStorePlatform skips unchanged latest file when fetched riven rows are unsorted", async () => {
  const { dataDir } = await makeTempRepo();
  await writeFile(
    join(dataDir, "PC", "2021_W01_weeklyRivensPC.json"),
    normalizeJsonText(
      JSON.stringify([
        { itemType: "Rifle Riven Mod", compatibility: "Acceltra", rerolled: false },
        { itemType: "Rifle Riven Mod", compatibility: "Braton", rerolled: true },
      ]),
    ),
  );

  const result = await fetchAndStorePlatform({
    dataDir,
    platform: "PC",
    now: new Date(Date.UTC(2021, 0, 5, 12, 34, 56)),
    fetchText: async () =>
      JSON.stringify([
        { itemType: "Rifle Riven Mod", compatibility: "Braton", rerolled: true },
        { itemType: "Rifle Riven Mod", compatibility: "Acceltra", rerolled: false },
      ]),
  });

  assert.equal(result.status, "unchanged");
  assert.deepEqual(await readdir(join(dataDir, "PC")), [
    "2021_W01_weeklyRivensPC.json",
  ]);
});

test("fetchAndStorePlatform writes the current week when content changes", async () => {
  const { dataDir } = await makeTempRepo();
  await writeFile(
    join(dataDir, "PC", "2020_W53_weeklyRivensPC.json"),
    '[{"weapon":"Old"}]\n',
  );

  const result = await fetchAndStorePlatform({
    dataDir,
    platform: "PC",
    now: new Date(Date.UTC(2021, 0, 4, 12, 0, 0)),
    fetchText: async () => '[{"weapon":"New"}]',
  });

  assert.equal(result.status, "saved");
  assert.equal(result.key, "2021_W01");
  assert.equal(result.filePath, join(dataDir, "PC", "2021_W01_weeklyRivensPC.json"));
  assert.equal(await readFile(result.filePath, "utf8"), '[\n  {\n    "weapon": "New"\n  }\n]\n');
});

test("fetchAndStorePlatform writes a timestamped revision when the current week already exists", async () => {
  const { dataDir } = await makeTempRepo();
  await writeFile(
    join(dataDir, "PC", "2021_W01_weeklyRivensPC.json"),
    '[{"weapon":"Old"}]\n',
  );

  const result = await fetchAndStorePlatform({
    dataDir,
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
  assert.equal(await readFile(result.filePath, "utf8"), '[\n  {\n    "weapon": "Revised"\n  }\n]\n');
});

test("run defaults data paths to the provided working directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "weekly-rivens-root-"));
  const dataDir = join(root, "data");
  await mkdir(join(dataDir, "PC"), { recursive: true });

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

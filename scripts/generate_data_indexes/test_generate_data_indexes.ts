import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildCoverage,
  buildDatesIndex,
  writeDataIndexFiles,
} from "./generate_data_indexes.js";

async function makeTempDataDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "weekly-rivens-indexes-"));
  const dataDir = join(root, "data");
  await mkdir(join(dataDir, "PC"), { recursive: true });
  await mkdir(join(dataDir, "PS4"), { recursive: true });
  await mkdir(join(dataDir, "XB1"), { recursive: true });
  await mkdir(join(dataDir, "SWI"), { recursive: true });
  return dataDir;
}

test("buildDatesIndex derives sorted platform keys from data files", async () => {
  const dataDir = await makeTempDataDir();
  await writeFile(join(dataDir, "PC", "2021_W03_20210120T120000Z_weeklyRivensPC.json"), "[]\n");
  await writeFile(join(dataDir, "PC", "2021_W01_weeklyRivensPC.json"), "[]\n");
  await writeFile(join(dataDir, "PC", "2021_W03_weeklyRivensPC.json"), "[]\n");
  await writeFile(join(dataDir, "PC", "not-riven.json"), "[]\n");
  await writeFile(join(dataDir, "PS4", "2020_W53_weeklyRivensPS4.json"), "[]\n");

  assert.deepEqual(await buildDatesIndex(dataDir), {
    PC: ["2021_W01", "2021_W03", "2021_W03_20210120T120000Z"],
    PS4: ["2020_W53"],
    XB1: [],
    SWI: [],
  });
});

test("buildCoverage summarizes platform files and missing weeks", async () => {
  const dataDir = await makeTempDataDir();
  await writeFile(join(dataDir, "PC", "2021_W01_weeklyRivensPC.json"), "[]\n");
  await writeFile(join(dataDir, "PC", "2021_W03_weeklyRivensPC.json"), "[]\n");
  await writeFile(join(dataDir, "PC", "2021_W03_20210120T120000Z_weeklyRivensPC.json"), "[]\n");
  await writeFile(join(dataDir, "PS4", "2020_W53_weeklyRivensPS4.json"), "[]\n");
  await writeFile(join(dataDir, "PS4", "2021_W02_weeklyRivensPS4.json"), "[]\n");

  const coverage = await buildCoverage({ dataDir });

  assert.deepEqual(coverage.platforms.PC, {
    latestWeek: "2021_W03",
    fileCount: 3,
    missingWeeks: ["2021_W02"],
  });
  assert.deepEqual(coverage.platforms.PS4, {
    latestWeek: "2021_W02",
    fileCount: 2,
    missingWeeks: ["2021_W01"],
  });
  assert.deepEqual(coverage.platforms.XB1, {
    latestWeek: null,
    fileCount: 0,
    missingWeeks: [],
  });
});

test("writeDataIndexFiles writes dates and coverage JSON", async () => {
  const dataDir = await makeTempDataDir();
  await writeFile(join(dataDir, "SWI", "2021_W01_weeklyRivensSWI.json"), "[]\n");
  const datesPath = join(dataDir, "dates.json");
  const coveragePath = join(dataDir, "coverage.json");

  await writeDataIndexFiles({
    dataDir,
    datesPath,
    coveragePath,
  });

  assert.equal(
    await readFile(datesPath, "utf8"),
    `${JSON.stringify({ PC: [], PS4: [], XB1: [], SWI: ["2021_W01"] }, null, 2)}\n`,
  );
  assert.equal(
    await readFile(coveragePath, "utf8"),
    `${JSON.stringify(
      {
        platforms: {
          PC: {
            latestWeek: null,
            fileCount: 0,
            missingWeeks: [],
          },
          PS4: {
            latestWeek: null,
            fileCount: 0,
            missingWeeks: [],
          },
          XB1: {
            latestWeek: null,
            fileCount: 0,
            missingWeeks: [],
          },
          SWI: {
            latestWeek: "2021_W01",
            fileCount: 1,
            missingWeeks: [],
          },
        },
      },
      null,
      2,
    )}\n`,
  );
});

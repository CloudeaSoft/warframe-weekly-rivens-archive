import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { auditArchiveData } from "./audit_archive_data.js";

async function makeTempDataDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "archive-data-audit-"));
  const dataDir = join(root, "data");
  await mkdir(join(dataDir, "PC"), { recursive: true });
  await mkdir(join(dataDir, "PS4"), { recursive: true });
  await mkdir(join(dataDir, "XB1"), { recursive: true });
  await mkdir(join(dataDir, "SWI"), { recursive: true });
  return dataDir;
}

test("auditArchiveData reports duplicate content for the same platform week", async () => {
  const dataDir = await makeTempDataDir();
  await writeFile(
    join(dataDir, "PC", "2026_W28_weeklyRivensPC.json"),
    '[{"itemType":"Rifle Riven Mod","compatibility":"Braton","rerolled":false}]\n',
  );
  await writeFile(
    join(dataDir, "PC", "2026_W28_20260707T050620Z_weeklyRivensPC.json"),
    '[{"rerolled":false,"compatibility":"Braton","itemType":"Rifle Riven Mod"}]\n',
  );
  await writeFile(
    join(dataDir, "dates.json"),
    `${JSON.stringify({ PC: ["2026_W28", "2026_W28_20260707T050620Z"], PS4: [], XB1: [], SWI: [] }, null, 2)}\n`,
  );

  const report = await auditArchiveData({ dataDir });

  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0]?.severity, "warning");
  assert.match(report.findings[0]?.message ?? "", /Duplicate normalized content/);
});

test("auditArchiveData reports dates index entries without data files", async () => {
  const dataDir = await makeTempDataDir();
  await writeFile(
    join(dataDir, "dates.json"),
    `${JSON.stringify({ PC: ["2026_W28"], PS4: [], XB1: [], SWI: [] }, null, 2)}\n`,
  );

  const report = await auditArchiveData({ dataDir });

  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0]?.severity, "error");
  assert.match(report.findings[0]?.message ?? "", /dates.json does not match/);
});

test("auditArchiveData reports invalid JSON without aborting duplicate checks", async () => {
  const dataDir = await makeTempDataDir();
  await writeFile(
    join(dataDir, "PC", "2026_W28_weeklyRivensPC.json"),
    "[not-json]\n",
  );
  await writeFile(
    join(dataDir, "PC", "2026_W28_20260707T050620Z_weeklyRivensPC.json"),
    '[{"itemType":"Rifle Riven Mod","compatibility":"Latron","rerolled":false}]\n',
  );
  await writeFile(
    join(dataDir, "dates.json"),
    `${JSON.stringify({ PC: ["2026_W28", "2026_W28_20260707T050620Z"], PS4: [], XB1: [], SWI: [] }, null, 2)}\n`,
  );

  const report = await auditArchiveData({ dataDir });

  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0]?.severity, "error");
  assert.match(report.findings[0]?.message ?? "", /cannot be parsed/);
});

test("auditArchiveData accepts valid unique archive data", async () => {
  const dataDir = await makeTempDataDir();
  await writeFile(
    join(dataDir, "PC", "2026_W28_weeklyRivensPC.json"),
    '[{"itemType":"Rifle Riven Mod","compatibility":"Braton","rerolled":false}]\n',
  );
  await writeFile(
    join(dataDir, "PC", "2026_W28_20260707T050620Z_weeklyRivensPC.json"),
    '[{"itemType":"Rifle Riven Mod","compatibility":"Latron","rerolled":false}]\n',
  );
  await writeFile(
    join(dataDir, "dates.json"),
    `${JSON.stringify({ PC: ["2026_W28", "2026_W28_20260707T050620Z"], PS4: [], XB1: [], SWI: [] }, null, 2)}\n`,
  );

  const report = await auditArchiveData({ dataDir });

  assert.deepEqual(report.findings, []);
});

// Disposable Compose fixture helper. Never run against a real config/library.
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { openCatalogue } from "../src/model/catalogue.js";
import { Metadata } from "../src/model/metadata.js";
import assert from "node:assert/strict";
await fs.access("/config/fixture-seeded");
const action = process.argv[2],
  api = "http://127.0.0.1:3001/api",
  headers = {
    "X-Api-Key": "fixture-admin-synthetic-key-0000000000000000",
    "Content-Type": "application/json",
  };
const request = async (route, body) => {
  const r = await fetch(api + route, {
    headers,
    ...(body && { method: "POST", body: JSON.stringify(body) }),
  });
  assert.equal(r.status, 200, await r.clone().text());
  return r.json();
};
const digest = async (file) =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
if (action === "prepare") {
  const { getLibrary } =
    await import("/app/backend/services/libraryQueryService.ts");
  const library = getLibrary({ availableOnly: true });
  const files = library.tracks.flatMap((t) =>
    t.files.filter((f) => f.available).map((f) => f.path),
  );
  const evidence = Object.fromEntries(
    await Promise.all(
      files.map(async (file) => {
        await fs.chmod(file, 0o444);
        return [file, await digest(file)];
      }),
    ),
  );
  await fs.writeFile(
    "/config/editor-media-evidence.json",
    JSON.stringify(evidence),
  );
  await request("/plugins/aurral-classical/actions/classical-model-scan", {
    albumId: library.albums[0].id,
  });
  let done = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const c = await openCatalogue(
        "/config/plugin-data/aurral-classical/model",
      );
      done = !!c.db.prepare("SELECT 1 FROM model_job WHERE state='done'").get();
      c.close();
      if (done) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(done, "read-only model scan completed");
  console.log("Editor fixtures prepared; media is read only");
} else if (action === "refresh") {
  const c = await openCatalogue("/config/plugin-data/aurral-classical/model");
  try {
    const work = process.argv[3];
    c.entity(work, "work");
    const m = new Metadata(c);
    m.refresh(work, "musicbrainz", "editor-fixture", {
      title: process.argv[4] || "Provider title",
      nickname: "Provider nickname",
    });
    m.refresh(work, "openopus", "editor-conflict", {
      title: "Conflicting provider title",
    });
  } finally {
    c.close();
  }
} else if (action === "remember") {
  await fs.writeFile("/config/editor-browser-result.json", process.argv[3]);
} else if (action === "check") {
  const evidence = JSON.parse(
    await fs.readFile("/config/editor-media-evidence.json", "utf8"),
  );
  for (const [file, hash] of Object.entries(evidence)) {
    assert.equal(await digest(file), hash);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o444);
  }
  const saved = JSON.parse(
    await fs.readFile("/config/editor-browser-result.json", "utf8"),
  );
  const c = await openCatalogue("/config/plugin-data/aurral-classical/model");
  try {
    const m = new Metadata(c);
    assert.equal(m.resolve(saved.work, "title").value, "");
    assert.equal(m.resolve(saved.work, "title").pinned, true);
    const movements = c.db
      .prepare(
        "SELECT target_id FROM relation WHERE source_id=? AND kind='movement' ORDER BY position",
      )
      .all(saved.work);
    assert.equal(
      m.resolve(movements[0].target_id, "title").value,
      "II. Second",
    );
    assert.ok(c.db.prepare("SELECT 1 FROM realization_item").get());
    assert.ok(
      c.db
        .prepare("SELECT 1 FROM review_item WHERE kind='provider_conflict'")
        .get(),
    );
  } finally {
    c.close();
  }
  const page = await request(
    `/plugins/aurral-classical/pages/editor?selection=${saved.work}`,
  );
  assert.equal(
    page.forms.find((f) => f.id === "edit-title").fields[0].value,
    "",
  );
  console.log(
    "PASS: editor metadata, pinned blanks, movement order, attachments and media hashes survive restart",
  );
} else throw new Error("Expected prepare, refresh, remember or check");

// Disposable Compose fixture helper. Never run against a real config/library.
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { openCatalogue } from "../src/model/catalogue.js";
import { Metadata } from "../src/model/metadata.js";
import { classify } from "../src/model/reconcile.js";
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
  const beforeScan = await openCatalogue(
    "/config/plugin-data/aurral-classical/model",
  );
  const previousGeneration = beforeScan.db
    .prepare("SELECT coalesce(max(generation),0) AS n FROM core_instance")
    .get().n;
  beforeScan.close();
  await request("/plugins/aurral-classical/actions/classical-model-scan", {
    albumId: library.albums[0].id,
  });
  let done = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const c = await openCatalogue(
        "/config/plugin-data/aurral-classical/model",
      );
      done =
        c.db
          .prepare("SELECT coalesce(max(generation),0) AS n FROM core_instance")
          .get().n > previousGeneration;
      c.close();
      if (done) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(done, "read-only model scan completed");
  const phase4 = await openCatalogue(
    "/config/plugin-data/aurral-classical/model",
  );
  try {
    const metadata = new Metadata(phase4);
    let work = phase4.db
      .prepare(
        `SELECT e.id FROM entity e JOIN metadata_target t ON t.entity_id=e.id
         JOIN assertion a ON a.target_id=t.id
         WHERE e.kind='work' AND a.field='title' AND json_extract(a.value,'$')='Fixture Sonata'
         LIMIT 1`,
      )
      .get()?.id;
    if (!work) {
      const links = phase4.db
        .prepare("SELECT * FROM track_link WHERE state='active' ORDER BY id")
        .all()
        .map((row) => ({ ...row, evidence: JSON.parse(row.evidence) }))
        .filter(
          (row) =>
            row.evidence.hints?.album === "sonata" ||
            row.evidence.path?.includes("/sonata/"),
        )
        .sort(
          (left, right) =>
            Number(left.evidence.hints?.trackNumber || 0) -
            Number(right.evidence.hints?.trackNumber || 0),
        );
      assert.equal(links.length, 3, "sonata fixture links are indexed");
      const composer = phase4.createEntity("person");
      metadata.manual(composer, "name", "Fixture Composer", {
        actor: "fixture",
      });
      work = phase4.createEntity("work");
      metadata.manual(work, "title", "Fixture Sonata", { actor: "fixture" });
      phase4.credit(work, composer, "composer");
      const movements = ["I. Allegro", "II. Adagio", "III. Finale"].map(
        (title, index) => {
          const movement = phase4.createEntity("movement");
          metadata.manual(movement, "title", title, { actor: "fixture" });
          phase4.relate("movement", work, movement, { position: index + 1 });
          return movement;
        },
      );
      const createRecording = (label, indexes) => {
        const performance = phase4.createEntity("performance");
        const performanceWork = phase4.relate(
          "performance_work",
          performance,
          work,
        );
        const recording = phase4.createEntity("recording");
        phase4.relate("recording_performance", recording, performance);
        const realization = phase4.realization(work, performanceWork, label);
        indexes.forEach((movementIndex, sequence) => {
          const link = links[movementIndex];
          classify(
            phase4,
            link.id,
            {},
            { manual: "classical", actor: "fixture" },
          );
          const content = phase4.recordingContent(recording, performanceWork, {
            movement: movements[movementIndex],
            position: sequence + 1,
          });
          const segment = phase4.segment(link.id, { kind: "whole" });
          phase4.segmentContent(segment, content);
          phase4.realizationItem(realization, segment, {
            movement: movements[movementIndex],
            sequence: sequence + 1,
          });
        });
        return realization;
      };
      const complete = createRecording("Complete fixture recording", [0, 1, 2]);
      createRecording("Incomplete fixture recording", [0, 2]);
      phase4.db
        .prepare("INSERT INTO admin_work_pick VALUES (?,?,?,?)")
        .run(work, complete, 1, Date.now());
    }
    const albumId = JSON.parse(
      phase4.db
        .prepare(
          `SELECT evidence FROM track_link WHERE state='active'
           AND json_extract(evidence,'$.hints.album')='sonata' LIMIT 1`,
        )
        .get().evidence,
    ).albumId;
    await fs.writeFile(
      "/config/phase4-fixture.json",
      JSON.stringify({ albumId, work }),
    );
  } finally {
    phase4.close();
  }
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
} else if (action === "phase4") {
  console.log(await fs.readFile("/config/phase4-fixture.json", "utf8"));
} else if (action === "phase4-reset") {
  const fixture = JSON.parse(
    await fs.readFile("/config/phase4-fixture.json", "utf8"),
  );
  const c = await openCatalogue("/config/plugin-data/aurral-classical/model");
  try {
    c.db.prepare("DELETE FROM user_work_state WHERE work_id=?").run(fixture.work);
  } finally {
    c.close();
  }
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
  const phase4Saved = JSON.parse(
    await fs.readFile("/config/phase4-fixture.json", "utf8"),
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
    assert.equal(c.db.prepare("PRAGMA user_version").get().user_version, 2);
    const adminPick = c.db
      .prepare("SELECT realization_id FROM admin_work_pick WHERE work_id=?")
      .get(phase4Saved.work)?.realization_id;
    assert.ok(adminPick);
    const userStates = c.db
      .prepare("SELECT * FROM user_work_state WHERE work_id=? ORDER BY user_id")
      .all(phase4Saved.work);
    assert.equal(
      userStates.length,
      1,
      "only the first regular user changed work state",
    );
    assert.equal(userStates[0].favourite, 1);
    assert.notEqual(userStates[0].picked_realization_id, adminPick);
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
  const presentation = await request(
    `/plugins/album-presentation/${phase4Saved.albumId}`,
  );
  assert.equal(
    presentation.groups.filter((group) => group.workId === phase4Saved.work)
      .length,
    2,
  );
  const workPage = await request(
    `/plugins/aurral-classical/resources/work/${phase4Saved.work}`,
  );
  assert.equal(
    workPage.favourite,
    false,
    "admin state is separate from regular-user state",
  );
  assert.equal(workPage.pickScope, "admin");
  console.log(
    "PASS: editor metadata, pinned blanks, movement order, attachments and media hashes survive restart",
  );
} else
  throw new Error(
    "Expected prepare, refresh, remember, phase4, phase4-reset or check",
  );

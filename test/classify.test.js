import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { tempFolders } from "./helpers.js";
import { openCatalogue } from "../src/model/catalogue.js";
import { reconcile, classify } from "../src/model/reconcile.js";

test("title, WORK and album text count as classical evidence; no evidence is not a review item", async (t) => {
  const folders = await tempFolders();
  const c = await openCatalogue(folders.dataFolder);
  t.after(async () => {
    c.close();
    await fs.rm(folders.root, { recursive: true, force: true });
  });
  const cases = [
    // Untagged genre, but structured classical titles.
    [{ title: "Symphony No. 5 in C minor, Op. 67: I. Allegro con brio", composer: ["Beethoven"] }, "classical"],
    [{ title: "II. Adagio sostenuto", album: "Piano Sonatas", composer: [] }, "classical"],
    [{ title: "Cello Suite No. 1, BWV 1007" }, "classical"],
    [{ title: "Études, Op. 10: No. 3", composer: [] }, "classical"],
    // A composer tag but nothing else stays uncertain.
    [{ title: "Track 3", composer: ["Someone"], composerDistinct: true }, "unsure"],
    // Nothing classical and no composer: ordinary, without a review item.
    [{ title: "Song for a Friend", album: "Summer", composer: [] }, "not_classical"],
    [{ title: "Highway", genres: ["Rock"] }, "not_classical"],
  ];
  const links = reconcile(c, {
    version: 1,
    complete: true,
    instanceId: "i",
    epoch: "e",
    generation: 1,
    tracks: cases.map((_, i) => ({
      coreId: `t${i}`,
      fileId: `f${i}`,
      path: `/library/${i}.flac`,
      size: 1,
      durationMs: 1000,
    })),
  });
  cases.forEach(([hints, expected], i) =>
    assert.equal(classify(c, links[i].id, hints), expected, JSON.stringify(hints)),
  );
  assert.equal(
    c.db.prepare("SELECT count(*) AS n FROM review_item WHERE kind='classification'").get().n,
    1,
  );
  // A later, clearer scan closes the earlier review item.
  classify(c, links[4].id, { title: "Piano Sonata No. 11 in A major, K. 331: I. Andante grazioso", composer: ["Someone"], composerDistinct: true });
  assert.equal(
    c.db.prepare("SELECT count(*) AS n FROM review_item WHERE kind='classification' AND status='open'").get().n,
    0,
  );
  // Manual overrides still win.
  classify(c, links[5].id, {}, { manual: "classical", actor: "admin" });
  assert.equal(classify(c, links[5].id, { title: "Song for a Friend" }), "classical");
});

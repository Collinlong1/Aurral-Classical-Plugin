import assert from "node:assert/strict";
import test from "node:test";
import { albums, kobayashi, lugansky, trifonovArranged } from "./corpus/albums.js";
import { runCorpus, trackId } from "./corpus/run.js";

const results = await runCorpus(albums);

for (const album of albums)
  test(`corpus: ${album.title} (${album.kind})`, () => {
    const presentation = results.get(album.id);
    if (album.expect === null) return assert.equal(presentation, null);
    assert.ok(presentation, "expected a work view");
    assert.deepEqual(
      presentation.groups.map((group) => [group.title, group.items.map((item) => item.title)]),
      album.expect.groups,
    );
  });

test("corpus: an already-matched work gains the tracks an older pass left out", async () => {
  const left = lugansky.tracks.filter((track) => [2, 7, 10, 11].includes(track.number));
  const later = await runCorpus([lugansky], { heldBack: left.map((track) => trackId(lugansky, track)) });
  assert.deepEqual(
    later.get(lugansky.id).groups.map((group) => [group.title, group.items.map((item) => item.title)]),
    lugansky.expect.groups,
  );
});

test("corpus: an arrangement joins the work it arranges through MusicBrainz", async () => {
  const alone = await runCorpus([trifonovArranged]);
  const groups = alone.get(trifonovArranged.id).groups;
  assert.deepEqual(groups.map((group) => [group.title, group.items.length]), [["The Bells, op. 35", 4]]);
  assert.ok(groups[0].workId);
});

test("corpus: tracks under one heading that are not a work say so", () => {
  const groups = results.get(kobayashi.id).groups;
  assert.deepEqual(
    groups.map((group) => [Boolean(group.workId), group.detail ?? null]),
    [
      [true, null],
      [false, "Not matched to a work"],
    ],
  );
});

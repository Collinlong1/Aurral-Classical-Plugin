// v0.3 8.1: proposed classical tags come from the catalogue alone.
import assert from "node:assert/strict";
import test from "node:test";
import { library, workId } from "./library-fixture.js";
import { Metadata } from "../src/model/metadata.js";
import { proposedTags } from "../src/model/tag-plan.js";

const linkOf = (c, coreId) => c.db.prepare("SELECT id FROM track_link WHERE core_id=?").get(coreId).id;

test("a movement proposes its composer, work, movement, performers, conductor, catalogue and MusicBrainz work", async (t) => {
  const { c } = await library(t);
  const m = new Metadata(c);
  const dvorak = workId(c, "Symphony No. 9");
  const composer = c.db.prepare("SELECT contributor_id FROM credit WHERE target_id=? AND role='composer'").get(dvorak).contributor_id;
  m.manual(composer, "sortName", "Dvořák, Antonín", { actor: "admin", pin: true });
  m.manual(dvorak, "catalogue", ["Op. 95", "B. 178"], { actor: "admin", pin: true });
  const largo = c.db.prepare("SELECT target_id FROM relation WHERE kind='movement' AND source_id=? ORDER BY position").all(dvorak)[1].target_id;
  c.externalIdentity(largo, "musicbrainz", "work", "mb-largo", { evidence: { source: "test" } });
  c.externalIdentity(dvorak, "musicbrainz", "work", "mb-new-world", { evidence: { source: "test" } });

  const plan = proposedTags(c, linkOf(c, "dvorak-1"));
  assert.equal(plan.workId, dvorak);
  assert.deepEqual(plan.fields, {
    composer: ["Antonín Dvořák"],
    composerSort: ["Dvořák, Antonín"],
    work: ["Symphony No. 9 in E minor, Op. 95"],
    movementName: ["II. Largo"],
    movementNumber: ["2"],
    movementTotal: ["2"],
    performers: ["Berliner Philharmoniker (orchestra)"],
    conductor: ["Herbert von Karajan"],
    catalogue: ["Op. 95", "B. 178"],
    workId: ["mb-largo"],
  });
  // The first movement has no MusicBrainz work of its own: the work's.
  assert.deepEqual(proposedTags(c, linkOf(c, "dvorak-0")).fields.workId, ["mb-new-world"]);
  // Never the release's fields.
  for (const field of ["title", "album", "albumArtist", "artist"]) assert.equal(plan.fields[field], undefined, field);
});

test("the plan follows the catalogue: an admin's credit and values, and what is missing is left out", async (t) => {
  const { c } = await library(t);
  // Levit is credited as soloist by hand; no sort name, catalogue or MusicBrainz work.
  const plan = proposedTags(c, linkOf(c, "levit-2")).fields;
  assert.deepEqual(plan.performers, ["Igor Levit (soloist)"]);
  assert.deepEqual(plan.movementName, ["III. Presto agitato"]);
  assert.deepEqual([plan.movementNumber, plan.movementTotal], [["3"], ["3"]]);
  for (const field of ["composerSort", "conductor", "catalogue", "workId"]) assert.equal(plan[field], undefined, field);
  // An instrument on the credit names it, as Picard writes performers.
  c.db.prepare("UPDATE credit SET instrument='piano' WHERE role='soloist' AND target_id=(SELECT source_id FROM relation WHERE id=(SELECT performance_work_id FROM realization WHERE label='Album levit'))").run();
  assert.deepEqual(proposedTags(c, linkOf(c, "levit-2")).fields.performers, ["Igor Levit (piano)"]);
  // A renamed work proposes the new name.
  new Metadata(c).manual(workId(c, "Piano Sonata No. 14"), "title", "Piano Sonata No. 14 “Moonlight”", { actor: "admin", pin: true });
  assert.deepEqual(proposedTags(c, linkOf(c, "levit-2")).fields.work, ["Piano Sonata No. 14 “Moonlight”"]);
});

test("not classical, in no work, or in two works: nothing is proposed, and the reason says why", async (t) => {
  const { c } = await library(t, null, [
    { coreId: "loose", fileId: "loose", path: "/library/loose.flac", size: 1, durationMs: 1000, fingerprint: "audio-sha256-v2:loose", albumId: "loose", hints: { title: "Loose piece", composer: ["Erik Satie"], genres: ["Classical"], trackNumber: 1, discNumber: 1 } },
  ]);
  c.db.prepare("UPDATE classification SET state='not_classical' WHERE target_id=?").run(linkOf(c, "ma-0"));
  assert.deepEqual(proposedTags(c, linkOf(c, "ma-0")), { fields: {}, workId: null, reason: "Not classical" });
  assert.deepEqual(proposedTags(c, linkOf(c, "loose")).reason, "Not in a work");
  assert.deepEqual(proposedTags(c, "missing").reason, "Not classical");
  // A second work on the same track.
  const other = c.createEntity("work");
  const performance = c.createEntity("performance");
  const pw = c.relate("performance_work", performance, other);
  const realization = c.realization(other, pw, "Other");
  const recording = c.createEntity("recording");
  c.relate("recording_performance", recording, performance);
  const content = c.recordingContent(recording, pw, {});
  const segment = c.segment(linkOf(c, "levit-0"), { startMs: 0, endMs: 1000 });
  c.segmentContent(segment, content);
  c.realizationItem(realization, segment, {});
  assert.deepEqual(proposedTags(c, linkOf(c, "levit-0")).reason, "Plays parts of two works");
});

import fs from "node:fs/promises";
import path from "node:path";
import { File } from "node-taglib-sharp";
import { writeTags } from "../src/tags.js";
const root = path.resolve(import.meta.dirname, "library");
const cases = JSON.parse(await fs.readFile(new URL("./fixtures.json", import.meta.url), "utf8"));
for (const fixture of cases) {
  for (let i=1; i<=fixture.tracks; i++) {
    const target = path.join(root, fixture.id, `${i}.flac`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(new URL("../test/fixtures/sine.flac", import.meta.url), target);
    const file = File.createFromPath(target);
    file.tag.album = fixture.id;
    file.tag.track = i; file.tag.disc = 1;
    file.tag.genres = [fixture.classical === false || (fixture.mixed && i === 2) ? "Rock" : "Classical"];
    file.tag.musicBrainzReleaseId = undefined; file.tag.musicBrainzReleaseGroupId = undefined;
    file.save(); file.dispose();
    const classical = fixture.classical !== false && !(fixture.mixed && i === 2);
    const values = fixture.sevenValues ? Array.from({length:7}, (_,n) => `Performer ${n+1}`) : [fixture.performer || "Synthetic Performer"];
    const movement = fixture.missingMovement && i >= fixture.missingMovement ? i+1 : i;
    await writeTags(target, {
      title: [`${fixture.id}: ${movement}`], artist: values, albumArtist: values,
      composer: classical ? [fixture.composer || "Synthetic Composer"] : [],
      work: classical ? [`${fixture.work}: ${fixture.sameMovement ? 1 : movement}`] : [],
      workId: classical ? [`fixture-${fixture.work}-${fixture.sameMovement ? 1 : movement}`] : [],
      recordingMbid: fixture.noRecordingId ? [] : [fixture.recording || `recording-${fixture.id}-${i}`],
    });
  }
}
console.log(`Generated synthetic fixtures in ${root}`);

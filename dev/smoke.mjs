import assert from "node:assert/strict";
const { getLibrary } = await import("/app/backend/services/libraryQueryService.ts");
const api = "http://127.0.0.1:3001/api";
const request = (user, route, body) => fetch(`${api}${route}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { "X-Api-Key": `${user}-synthetic-key-0000000000000000`, "Content-Type":"application/json" },
  ...(body !== undefined && {body:JSON.stringify(body)}),
});
const selected = getLibrary({availableOnly:true}).tracks.find((track) => track.files.some((file) => file.path.includes("multiple-recordings")));
assert.ok(selected,"Synthetic library was indexed");
// Comparisons are saved from the work page (the album and track menus no
// longer carry "Compare recordings"): every person reads the work's
// recordings as themselves and saves them as their own playlist.
const fs = await import("node:fs/promises");
const { work } = JSON.parse(await fs.readFile("/config/phase4-fixture.json", "utf8"));
const owned = [];
for (const user of ["fixture-admin","fixture-one","fixture-two"]) {
  const page = await request(user,`/plugins/aurral-classical/resources/work/${work}`);
  assert.equal(page.status,200,await page.clone().text());
  const view = await page.json();
  const items = view.recordings.flatMap((recording) => recording.items);
  const itemIds = items.map((item) => item.id);
  assert.ok(itemIds.length >= 5,`The work page lists every owned recording for ${user}`);
  // The playlist's jobs are its distinct files: core saves one file per run
  // of items on it (movements sharing an attacca track) and lists a file
  // used again later in the playlist once.
  const files = new Set(items.map((item) => item.fileId)).size;
  const name = `Recordings: Fixture Sonata (${user})`;
  const response = await request(user,`/plugins/aurral-classical/resources/work/${work}/playlist`,{name,itemIds});
  assert.equal(response.status,200,await response.text());
  let playlist;
  for (let attempt=0; attempt<120; attempt++) {
    const status = await (await request(user,"/playlists/status")).json();
    playlist = status.staticPlaylists.find((p) => p.name === name);
    if (playlist) break;
    await new Promise((resolve) => setTimeout(resolve,250));
  }
  assert.ok(playlist,`Comparison completed for ${user}`);
  // The playlist appears before its tracks finish as jobs; wait for them.
  let jobs = [];
  for (let attempt=0; attempt<120; attempt++) {
    jobs = await (await request(user,`/playlists/jobs/${playlist.id}`)).json();
    if (Array.isArray(jobs) && jobs.length >= files && jobs.every((job) => job.status === "done")) break;
    await new Promise((resolve) => setTimeout(resolve,250));
  }
  assert.ok(Array.isArray(jobs) && jobs.length === files, `Comparison jobs for ${user}: expected ${files} (${itemIds.length} items on files ${items.map((item) => item.fileId).join(",")}), got ${JSON.stringify(Array.isArray(jobs) ? jobs.map((job) => job.status) : jobs).slice(0, 300)}`);
  for (const job of jobs) {
    assert.equal(job.status,"done");
    const audio = await request(user,`/playlists/stream/${job.id}`);
    assert.equal(audio.status,200);
    assert.ok((await audio.arrayBuffer()).byteLength > 100);
  }
  owned.push(playlist.id);
}
assert.equal(new Set(owned).size,3,"Each real user owns a separate comparison");
assert.equal((await request("fixture-two",`/playlists/jobs/${owned[1]}`)).status,404);
const { db } = await import("/app/backend/config/db-sqlite.ts");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM download_jobs WHERE status NOT IN ('done','saved')").get().n,0,"No acquisitions queued");
console.log("PASS: admin and two regular users compare and stream exact owned files; isolation and zero acquisition checks pass");

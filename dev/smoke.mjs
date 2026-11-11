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
const owned = [];
for (const user of ["fixture-admin","fixture-one","fixture-two"]) {
  const response = await request(user,"/plugins/aurral-classical/actions/compare-track",{trackIds:[selected.id]});
  assert.equal(response.status,200,await response.text());
  let playlist;
  for (let attempt=0; attempt<120; attempt++) {
    const status = await (await request(user,"/playlists/status")).json();
    playlist = status.staticPlaylists.find((p) => p.name.startsWith("Recordings:"));
    if (playlist) break;
    await new Promise((resolve) => setTimeout(resolve,250));
  }
  assert.ok(playlist,`Comparison completed for ${user}`);
  const jobs = await (await request(user,`/playlists/jobs/${playlist.id}`)).json();
  assert.ok(jobs.length >= 5);
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

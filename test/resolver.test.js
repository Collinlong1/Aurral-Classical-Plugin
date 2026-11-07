// Ported from Classical-Artists-Plugin's tests/test_classicalartist.py.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ClassicalResolver } from "../src/resolver.js";

const artist = (id, name, sortName, type) => ({ id, name, "sort-name": sortName || name, ...(type && { type }) });
function rel(type, target, extra = {}) {
  const key = "title" in target ? "work" : "artist";
  return { type, "target-type": key, [key]: target, direction: "backward", ...extra };
}

class FakeMb {
  constructor(entities) {
    this.entities = entities;
    this.calls = [];
  }
  async get(type, id, inc) {
    if (inc === ClassicalResolver.MEMBERSHIP_INC) type = "artist-rels";
    this.calls.push(`${type}:${id}`);
    return structuredClone(this.entities[`${type}:${id}`] ?? null);
  }
}

function resolver(entities, options = {}) {
  const mb = new FakeMb(entities);
  return [new ClassicalResolver(mb, { knownNames: {}, ...options }), mb];
}

const BEETHOVEN = artist("beet", "Ludwig van Beethoven", "Beethoven, Ludwig van");
const KARAJAN = artist("kara", "Herbert von Karajan", "Karajan, Herbert von");
const BPO = artist("bpo", "Berliner Philharmoniker", null, "Orchestra");
const ENGINEER = artist("eng", "Some Engineer");

function symphony(recordingExtra = {}) {
  return {
    "recording:rec": {
      id: "rec",
      title: "Symphony No. 5: I.",
      "artist-credit": [{ artist: BPO }, { artist: KARAJAN }],
      relations: [
        rel("performance", { id: "mvt1", title: "Symphony 5: I" }),
        rel("performing orchestra", BPO),
        rel("conductor", KARAJAN),
        rel("recording", ENGINEER),
        rel("engineer", ENGINEER),
      ],
      ...recordingExtra,
    },
    "work:mvt1": {
      id: "mvt1",
      title: "Symphony No. 5 in C minor, op. 67: I. Allegro con brio",
      relations: [rel("composer", BEETHOVEN)],
    },
    "artist:bpo": { aliases: [{ name: "Berlin Philharmonic", locale: "en", primary: true }] },
    "artist:beet": { aliases: [] },
    "artist:kara": { aliases: [] },
  };
}
const rec = (e) => e["recording:rec"];
const members = (count) =>
  Array.from({ length: count }, (_, n) => rel("instrument", artist(`m${n}`, `Member ${n}`, null, "Person"), { attributes: ["violin"] }));

test("builds the artist string", async () => {
  const [r] = resolver(symphony());
  const f = await r.resolve("rec");
  assert.equal(f.artist, "Ludwig van Beethoven — Berlin Philharmonic — Herbert von Karajan");
  assert.deepEqual(f.artists, ["Ludwig van Beethoven", "Berlin Philharmonic", "Herbert von Karajan"]);
  assert.ok(f.artistSort.startsWith("Beethoven, Ludwig van — "));
  assert.deepEqual(f.composers, ["Ludwig van Beethoven"]);
  assert.deepEqual(f.composersIds, ["beet"]);
  assert.equal(f.workId, "mvt1");
  assert.ok(f.work.startsWith("Symphony No. 5"));
  assert.equal(f.classicalEnsembles, "Berlin Philharmonic");
  assert.equal(f.classicalConductors, "Herbert von Karajan");
  assert.equal(f.classicalSoloists, null);
});

test("irrelevant relations are not looked up", async () => {
  const [r, mb] = resolver(symphony());
  await r.resolve("rec");
  assert.ok(!mb.calls.includes("artist:eng"));
});

test("no composer leaves the track alone", async () => {
  const e = symphony();
  e["work:mvt1"].relations = [];
  const [r] = resolver(e);
  assert.equal(await r.resolve("rec"), null);
  assert.equal(r.skipReason, "no composer");
});

test("unreachable recording leaves the track alone", async () => {
  const [r] = resolver({});
  assert.equal(await r.resolve("missing"), null);
  assert.equal(r.skipReason, "unreachable");
});

test("composer found on the parent work", async () => {
  const e = symphony();
  e["work:mvt1"].relations = [rel("parts", { id: "whole", title: "Symphony No. 5" })];
  e["work:whole"] = { id: "whole", title: "Symphony No. 5", relations: [rel("composer", BEETHOVEN)] };
  const [r] = resolver(e);
  const f = await r.resolve("rec");
  assert.deepEqual(f.composers, ["Ludwig van Beethoven"]);
  assert.equal(f.workId, "mvt1");
});

test("writer relation counts as composer", async () => {
  const e = symphony();
  e["work:mvt1"].relations = [rel("writer", artist("mach", "Guillaume de Machaut", "Machaut, Guillaume de"))];
  e["artist:mach"] = { aliases: [] };
  const [r] = resolver(e);
  assert.deepEqual((await r.resolve("rec")).composers, ["Guillaume de Machaut"]);
});

test("ensemble detected by artist type", async () => {
  const e = symphony();
  rec(e).relations.push(rel("instrument", artist("q", "Emerson String Quartet", null, "Group"), { attributes: ["strings"] }));
  const [r] = resolver(e);
  const f = await r.resolve("rec");
  assert.equal(f.classicalEnsembles, "Berlin Philharmonic / Emerson String Quartet");
  assert.equal(f.classicalSoloists, null);
});

test("ensemble type looked up when missing from the relation", async () => {
  const e = symphony();
  e["artist:q"] = { type: "Group", aliases: [] };
  rec(e).relations.push(rel("performer", artist("q", "Emerson String Quartet")));
  const [r] = resolver(e);
  assert.ok((await r.resolve("rec")).classicalEnsembles.includes("Emerson String Quartet"));
});

test("orchestra members are not listed", async () => {
  const e = symphony();
  rec(e).relations.push(...members(12));
  const [r] = resolver(e);
  const f = await r.resolve("rec");
  assert.equal(f.artist, "Ludwig van Beethoven — Berlin Philharmonic — Herbert von Karajan");
  assert.equal(f.classicalSoloists, null);
});

test("credited concerto soloist kept among orchestra members", async () => {
  const e = symphony();
  const pianist = artist("p", "Martha Argerich", "Argerich, Martha", "Person");
  rec(e).relations.push(...members(10), rel("instrument", pianist, { attributes: ["piano"] }));
  rec(e)["artist-credit"].unshift({ artist: pianist });
  const [r] = resolver(e);
  const f = await r.resolve("rec");
  assert.equal(f.classicalSoloists, "Martha Argerich");
  assert.equal(f.artist, "Ludwig van Beethoven — Martha Argerich — Berlin Philharmonic — Herbert von Karajan");
});

test("solo attribute kept among orchestra members", async () => {
  const e = symphony();
  rec(e).relations.push(...members(10), rel("instrument", artist("l", "Concert Master", null, "Person"), { attributes: ["violin", "solo"] }));
  const [r] = resolver(e);
  assert.equal((await r.resolve("rec")).classicalSoloists, "Concert Master");
});

test("small group without an ensemble listed as soloists", async () => {
  const e = symphony();
  rec(e)["artist-credit"] = [];
  rec(e).relations = [
    rec(e).relations[0],
    rel("instrument", artist("v", "A Violinist"), { attributes: ["violin"] }),
    rel("instrument", artist("p", "A Pianist"), { attributes: ["piano"] }),
    rel("vocal", artist("s", "A Singer")),
  ];
  const [r] = resolver(e);
  assert.equal((await r.resolve("rec")).classicalSoloists, "A Violinist / A Pianist / A Singer");
});

test("large group without an ensemble left out", async () => {
  const e = symphony();
  rec(e)["artist-credit"] = [];
  rec(e).relations = [rec(e).relations[0], ...members(8)];
  const [r] = resolver(e, { maxSoloists: 4 });
  const f = await r.resolve("rec");
  assert.equal(f.artist, "Ludwig van Beethoven");
  assert.equal(f.classicalSoloists, null);
});

test("composer who also performs is listed once", async () => {
  const e = symphony();
  rec(e).relations.push(rel("conductor", BEETHOVEN));
  const [r] = resolver(e);
  assert.equal((await r.resolve("rec")).artist.split("Beethoven").length - 1, 1);
});

test("custom separator and order", async () => {
  const [r] = resolver(symphony(), { separator: "; ", order: ["composers", "conductors", "ensembles"] });
  assert.equal((await r.resolve("rec")).artist, "Ludwig van Beethoven; Herbert von Karajan; Berlin Philharmonic");
});

test("neoclassical metal is not classical", async () => {
  const [r] = resolver(symphony({ genres: [{ name: "neoclassical metal" }, { name: "metal" }] }));
  assert.equal(await r.resolve("rec"), null);
});

test("classical genre wins over non-classical", async () => {
  const [r] = resolver(symphony({ genres: [{ name: "classical" }, { name: "rock" }] }));
  assert.notEqual(await r.resolve("rec"), null);
});

test("listed non-classical artist is skipped", async () => {
  const [r] = resolver(symphony(), { nonClassicalArtists: ["kara"] });
  assert.equal(await r.resolve("rec"), null);
});

test("artist genres exclude when the recording has none", async () => {
  const e = symphony();
  e["artist:kara"].genres = [{ name: "progressive metal", count: 9 }, { name: "rock", count: 3 }];
  const [r] = resolver(e);
  assert.equal(await r.resolve("rec"), null);
});

test("stray pop vote does not exclude", async () => {
  const e = symphony();
  e["artist:kara"].genres = [{ name: "classical", count: 1 }, { name: "pop", count: 5 }];
  const [r] = resolver(e);
  assert.notEqual(await r.resolve("rec"), null);
});

test("artist genre check can be disabled", async () => {
  const e = symphony();
  e["artist:kara"].genres = [{ name: "metal", count: 9 }];
  const [r] = resolver(e, { checkArtistGenres: false });
  assert.notEqual(await r.resolve("rec"), null);
});

for (const name of ["Tomás Luis de Victoria", "Antonín Dvořák", "Vincent d’Indy", "Nguyễn Văn Tuấn"]) {
  test(`latin name kept whole: ${name}`, async () => {
    const [r] = resolver({ "artist:x": { aliases: [] } });
    assert.equal(await r.englishName(artist("x", name, "Whatever, Given Names")), name);
  });
}

test("primary English alias preferred", () => {
  assert.equal(
    ClassicalResolver.pickEnglishAlias([
      { name: "Chaikovsky", locale: "en", type: "Search hint" },
      { name: "Peter Tchaikovsky", locale: "en_GB", type: "Artist name" },
      { name: "Pyotr Ilyich Tchaikovsky", locale: "en", primary: true },
    ]),
    "Pyotr Ilyich Tchaikovsky",
  );
});

test("search hint and ended aliases ignored", () => {
  assert.equal(
    ClassicalResolver.pickEnglishAlias([
      { name: "Tchaikofsky", locale: "en", type: "Search hint" },
      { name: "Old Name", locale: "en", ended: true },
      { name: "Peter Tchaikovsky", locale: "en_US" },
    ]),
    "Peter Tchaikovsky",
  );
});

test("known names by id and by name", async () => {
  const [r] = resolver({}, { knownNames: { "id-1": "By ID", "Сергей Сергеевич Прокофьев": "Sergei Prokofiev" } });
  assert.equal(await r.englishName(artist("id-1", "Whatever")), "By ID");
  assert.equal(await r.englishName(artist("id-2", "Сергей Сергеевич Прокофьев")), "Sergei Prokofiev");
});

test("non-latin name falls back to the sort name", async () => {
  const [r] = resolver({ "artist:x": { aliases: [] } });
  assert.equal(await r.englishName(artist("x", "Пётр Ильич Чайковский", "Chaikovsky, Pyotr Ilyich")), "Pyotr Chaikovsky");
});

test("sort name comes from the chosen alias", async () => {
  const rach = artist("rach", "Сергей Васильевич Рахманинов", "Rachmaninoff, Sergei Vasilievich");
  const e = symphony();
  e["work:mvt1"].relations = [rel("composer", rach)];
  e["artist:rach"] = { aliases: [{ name: "Sergei Rachmaninoff", "sort-name": "Rachmaninoff, Sergei", locale: "en", primary: true }] };
  const [r] = resolver(e);
  const f = await r.resolve("rec");
  assert.deepEqual(f.composers, ["Sergei Rachmaninoff"]);
  assert.equal(f.composerSort, "Rachmaninoff, Sergei");
  assert.equal(f.artistsSort[0], "Rachmaninoff, Sergei");
  assert.equal(f.artistsSort[2], "Karajan, Herbert von");
});

test("known names still use the alias sort name", async () => {
  const [r] = resolver(
    {
      "artist:rach": {
        aliases: [
          { name: "Rachmaninoff", "sort-name": "Rachmaninoff", locale: "en", primary: false },
          { name: "Sergei Rachmaninoff", "sort-name": "Rachmaninoff, Sergei", locale: "en", primary: true, type: "Artist name" },
          { name: "Sergei Vasilievich Rachmaninoff", "sort-name": "Rachmaninoff, Sergei Vasilievich", locale: "en", primary: false, type: "Artist name" },
        ],
      },
    },
    { knownNames: { "Сергей Васильевич Рахманинов": "Sergei Rachmaninov" } },
  );
  const p = await r.person(artist("rach", "Сергей Васильевич Рахманинов", "Rachmaninoff, Sergei Vasilievich"));
  assert.equal(p.name, "Sergei Rachmaninov");
  assert.equal(p.sortName, "Rachmaninoff, Sergei");
});

test("quartet named only in the artist credit", async () => {
  const e = symphony();
  const quartet = artist("q", "Takács Quartet", null, "Group");
  rec(e)["artist-credit"] = [{ artist: quartet }];
  rec(e).relations = [rec(e).relations[0], ...members(4)];
  e["artist:q"] = { aliases: [] };
  const [r] = resolver(e);
  const f = await r.resolve("rec");
  assert.equal(f.artist, "Ludwig van Beethoven — Takács Quartet");
  assert.equal(f.classicalEnsembles, "Takács Quartet");
  assert.equal(f.classicalSoloists, null);
});

const SCHUBERT = artist("schu", "Franz Schubert", "Schubert, Franz", "Person");
const STERN = artist("stern", "Edna Stern", "Stern, Edna", "Person");
const noWork = () => ({
  "recording:rec": { id: "rec", title: "Impromptu D. 899 no. 1", "artist-credit": [{ artist: STERN }], relations: [] },
  "artist:schu": { ...SCHUBERT, aliases: [] },
  "artist:stern": { aliases: [] },
});

test("no work link is left alone by default", async () => {
  const [r] = resolver(noWork());
  assert.equal(await r.resolve("rec", { trackArtistIds: ["schu"] }), null);
});

test("track artist fallback uses the track artist as composer", async () => {
  const [r] = resolver(noWork(), { trackArtistFallback: true });
  const f = await r.resolve("rec", { trackArtistIds: ["schu"] });
  assert.equal(f.artist, "Franz Schubert — Edna Stern");
  assert.equal(f.classicalSoloists, "Edna Stern");
  assert.equal(f.workId, null);
});

test("track artist fallback needs a different person", async () => {
  const [r] = resolver(noWork(), { trackArtistFallback: true });
  assert.equal(await r.resolve("rec", { trackArtistIds: ["stern"] }), null);
  assert.equal(await r.resolve("rec", { trackArtistIds: [] }), null);
});

test("track artist fallback ignores groups, listed and non-classical people", async () => {
  const e = noWork();
  e["artist:band"] = { ...artist("band", "Some Band", null, "Group"), aliases: [] };
  let [r] = resolver(e, { trackArtistFallback: true });
  assert.equal(await r.resolve("rec", { trackArtistIds: ["band"] }), null);
  [r] = resolver(noWork(), { trackArtistFallback: true, nonClassicalArtists: ["schu"] });
  assert.equal(await r.resolve("rec", { trackArtistIds: ["schu"] }), null);
  const pop = noWork();
  pop["artist:schu"].genres = [{ name: "pop", count: 7 }];
  [r] = resolver(pop, { trackArtistFallback: true });
  assert.equal(await r.resolve("rec", { trackArtistIds: ["schu"] }), null);
});

test("film score does not override a non-classical genre", async () => {
  const [r] = resolver(symphony({ genres: [{ name: "film score" }, { name: "electronic" }] }));
  assert.equal(await r.resolve("rec"), null);
});

test("opera soloists kept beside orchestra and chorus", async () => {
  const e = symphony();
  rec(e).relations.push(
    rel("vocal", artist("dom", "Plácido Domingo", null, "Person"), { attributes: ["tenor vocals"] }),
    rel("vocal", artist("mil", "Sherrill Milnes", null, "Person"), { attributes: ["baritone vocals"] }),
    rel("vocal", artist("cho", "Some Chorister", null, "Person"), { attributes: ["choir vocals"] }),
    rel("vocal", artist("bg", "Backing Singer"), { attributes: [] }),
    ...members(6),
  );
  const [r] = resolver(e);
  const f = await r.resolve("rec");
  assert.equal(f.classicalSoloists, "Plácido Domingo / Sherrill Milnes");
  assert.equal(f.artist, "Ludwig van Beethoven — Plácido Domingo — Sherrill Milnes — Berlin Philharmonic — Herbert von Karajan");
});

test("credited conductor without a relation stays last", async () => {
  const choir = artist("mch", "Monteverdi-Chor Hamburg", null, "Choir");
  const jurgens = artist("jj", "Jürgen Jürgens", "Jürgens, Jürgen", "Person");
  const e = symphony();
  rec(e).relations = [rec(e).relations[0], rel("vocal", choir, { attributes: ["choir vocals"] })];
  rec(e)["artist-credit"] = [{ artist: choir }, { artist: jurgens }];
  e["artist:mch"] = { aliases: [] };
  e["artist:jj"] = { aliases: [] };
  const [r] = resolver(e);
  const f = await r.resolve("rec");
  assert.equal(f.artist, "Ludwig van Beethoven — Monteverdi-Chor Hamburg — Jürgen Jürgens");
  assert.equal(f.classicalSoloists, null);
});

const membersOf = (ensemble) => ({ relations: [{ type: "member of band", direction: "forward", artist: ensemble }] });

test("consort singers are members, not soloists", async () => {
  const consort = artist("oc", "Orlando Consort", null, "Group");
  const singers = Array.from({ length: 4 }, (_, n) => artist(`s${n}`, `Singer ${n}`, null, "Person"));
  const guest = artist("guest", "Guest Soprano", null, "Person");
  const e = symphony();
  rec(e)["artist-credit"] = [{ artist: consort }];
  rec(e).relations = [
    rec(e).relations[0],
    ...singers.map((s) => rel("vocal", s, { attributes: ["tenor vocals"] })),
    rel("vocal", guest, { attributes: ["soprano vocals"] }),
  ];
  e["artist:oc"] = { aliases: [] };
  for (const s of singers) {
    e[`artist:${s.id}`] = { aliases: [] };
    e[`artist-rels:${s.id}`] = membersOf(consort);
  }
  e["artist:guest"] = { aliases: [] };
  e["artist-rels:guest"] = { relations: [] };
  const [r, mb] = resolver(e);
  const f = await r.resolve("rec");
  assert.ok(!mb.calls.includes("artist-rels:oc"));
  assert.equal(f.artist, "Ludwig van Beethoven — Guest Soprano — Orlando Consort");
});

test("sparse recording with an orchestra keeps the conductor last", async () => {
  const pops = artist("pops", "Boston Pops Orchestra", null, "Orchestra");
  const fiedler = artist("af", "Arthur Fiedler", "Fiedler, Arthur", "Person");
  const e = symphony();
  rec(e).relations = [rec(e).relations[0]];
  rec(e)["artist-credit"] = [{ artist: pops }, { artist: fiedler }];
  e["artist:pops"] = { aliases: [] };
  e["artist:af"] = { aliases: [] };
  const [r] = resolver(e);
  const f = await r.resolve("rec");
  assert.equal(f.artist, "Ludwig van Beethoven — Boston Pops Orchestra — Arthur Fiedler");
  assert.equal(f.classicalSoloists, null);
});

test("many soloists beside an ensemble are left out of the artist", async () => {
  const e = symphony();
  const singers = Array.from({ length: 6 }, (_, n) => artist(`v${n}`, `Singer ${n}`, null, "Person"));
  rec(e).relations.push(...singers.map((s) => rel("vocal", s, { attributes: ["soprano vocals"] })));
  const [r] = resolver(e);
  const f = await r.resolve("rec");
  assert.equal(f.artist, "Ludwig van Beethoven — Berlin Philharmonic — Herbert von Karajan");
  assert.equal(f.classicalSoloists, singers.map((s) => s.name).join(" / "));
});

test("soloist limit applies only above the limit and with an ensemble", async () => {
  const e = symphony();
  const singers = Array.from({ length: 4 }, (_, n) => artist(`v${n}`, `Singer ${n}`, null, "Person"));
  rec(e).relations.push(...singers.map((s) => rel("vocal", s, { attributes: ["tenor vocals"] })));
  let [r] = resolver(e);
  assert.ok((await r.resolve("rec")).artist.includes("Singer 3"));
  [r] = resolver(e, { maxArtistSoloists: 0 });
  assert.ok((await r.resolve("rec")).artist.includes("Singer 3"));
});

test("credited headline soloists survive the limit", async () => {
  const e = symphony();
  const singers = Array.from({ length: 5 }, (_, n) => artist(`v${n}`, `Singer ${n}`, null, "Person"));
  rec(e).relations.push(...singers.map((s) => rel("vocal", s, { attributes: ["soprano vocals"] })));
  rec(e)["artist-credit"].unshift({ artist: singers[2] });
  let [r] = resolver(e);
  const f = await r.resolve("rec");
  assert.equal(f.artist, "Ludwig van Beethoven — Singer 2 — Berlin Philharmonic — Herbert von Karajan");
  assert.equal(f.classicalSoloists.split("Singer").length - 1, 5);
  rec(e)["artist-credit"].unshift(...singers.map((s) => ({ artist: s })));
  [r] = resolver(e);
  assert.ok(!(await r.resolve("rec")).artist.includes("Singer"));
});

for (const [name, aliases] of [
  ["Edvard Grieg", [{ name: "E.Grieg", locale: "en" }]],
  ["Orchestra della Svizzera italiana", [{ name: "Orchestra RTSI", locale: "en", type: "Artist name" }]],
]) {
  test(`latin name beats a non-primary alias: ${name}`, async () => {
    const [r] = resolver({ "artist:x": { aliases } });
    assert.equal(await r.englishName(artist("x", name)), name);
  });
}

test("primary alias still beats a latin name", async () => {
  const [r] = resolver({ "artist:x": { aliases: [{ name: "Berlin Philharmonic", locale: "en", primary: true }] } });
  assert.equal(await r.englishName(artist("x", "Berliner Philharmoniker")), "Berlin Philharmonic");
});

test("non-latin name uses a non-primary alias", async () => {
  const [r] = resolver({ "artist:x": { aliases: [{ name: "Alexander Scriabin", locale: "en" }] } });
  assert.equal(await r.englishName(artist("x", "Александр Скрябин", "Scriabin, Alexander")), "Alexander Scriabin");
});

test("credited members of a credited ensemble are left out", async () => {
  const quartet = artist("aq", "Amadeus Quartet", null, "Group");
  const players = Array.from({ length: 4 }, (_, n) => artist(`p${n}`, `Player ${n}`, null, "Person"));
  const guest = artist("gp", "Gervase de Peyer", null, "Person");
  const e = symphony();
  rec(e).relations = [rec(e).relations[0], ...[...players, guest].map((p) => rel("instrument", p, { attributes: ["violin"] }))];
  rec(e)["artist-credit"] = [quartet, guest, ...players].map((a) => ({ artist: a }));
  e["artist:aq"] = { aliases: [] };
  for (const p of players) {
    e[`artist:${p.id}`] = { aliases: [] };
    e[`artist-rels:${p.id}`] = membersOf(quartet);
  }
  e["artist:gp"] = { aliases: [] };
  e["artist-rels:gp"] = { relations: [] };
  const [r] = resolver(e);
  assert.equal((await r.resolve("rec")).artist, "Ludwig van Beethoven — Gervase de Peyer — Amadeus Quartet");
});

test("placeholder composers and arrangers dropped beside real ones", async () => {
  const anon = artist("anon", "[anonymous]");
  const trad = artist("trad", "[traditional]");
  const e = symphony();
  e["work:mvt1"].relations.push(rel("composer", anon), rel("arranger", anon));
  e["artist:anon"] = { aliases: [] };
  e["artist:trad"] = { aliases: [] };
  let [r] = resolver(e);
  const f = await r.resolve("rec");
  assert.ok(!f.artist.includes("[anonymous]"));
  assert.deepEqual(f.composers, ["Ludwig van Beethoven"]);
  e["work:mvt1"].relations = [rel("composer", trad)];
  [r] = resolver(e);
  assert.deepEqual((await r.resolve("rec")).composers, ["[traditional]"]);
});

test("one credited member is a soloist", async () => {
  const orchestra = artist("ec", "The English Concert", null, "Orchestra");
  const leader = artist("ss", "Simon Standage", null, "Person");
  const e = symphony();
  rec(e).relations = [rec(e).relations[0], rel("performing orchestra", orchestra), rel("instrument", leader, { attributes: ["violin"] })];
  rec(e)["artist-credit"] = [{ artist: leader }, { artist: orchestra }];
  e["artist:ec"] = { aliases: [] };
  e["artist:ss"] = { aliases: [] };
  e["artist-rels:ss"] = membersOf(orchestra);
  const [r] = resolver(e);
  assert.equal((await r.resolve("rec")).artist, "Ludwig van Beethoven — Simon Standage — The English Concert");
});

test("performers follow billing order", async () => {
  const kohn = artist("ck", "Christian Köhn", "Köhn, Christian", "Person");
  const matthies = artist("stm", "Silke-Thora Matthies", "Matthies, Silke-Thora", "Person");
  const e = symphony();
  rec(e).relations = [rec(e).relations[0], rel("instrument", kohn, { attributes: ["piano"] }), rel("instrument", matthies, { attributes: ["piano"] })];
  rec(e)["artist-credit"] = [{ artist: kohn }, { artist: matthies }];
  e["artist:ck"] = { aliases: [] };
  e["artist:stm"] = { aliases: [] };
  const [r] = resolver(e);
  assert.equal((await r.resolve("rec", { albumArtistIds: ["stm", "ck"] })).artist, "Ludwig van Beethoven — Silke-Thora Matthies — Christian Köhn");
  assert.equal((await r.resolve("rec", { albumArtistIds: ["various"] })).artist, "Ludwig van Beethoven — Christian Köhn — Silke-Thora Matthies");
});

function song({ artistGenres = [], releaseGenres = [], writerGenres = [] } = {}) {
  const rapper = artist("rap", "Some Rapper", null, "Person");
  const producer = artist("prod", "Some Producer", null, "Person");
  const genres = (names) => names.map((name) => ({ name, count: 3 }));
  return {
    "recording:rec": { id: "rec", title: "Song", "artist-credit": [{ artist: rapper }], relations: [rel("performance", { id: "song", title: "Song" })] },
    "work:song": { id: "song", title: "Song", relations: [rel("writer", rapper), rel("composer", producer)] },
    "artist:rap": { ...rapper, genres: genres(artistGenres) },
    "artist:prod": { ...producer, genres: genres(writerGenres) },
    "release-group:rg": { id: "rg", genres: genres(releaseGenres) },
  };
}

for (const genre of ["trap", "east coast hip hop", "Hip-Hop", "k-pop", "drill"]) {
  test(`non-classical genres match as words: ${genre}`, async () => {
    const [r] = resolver(song({ artistGenres: [genre] }));
    assert.equal(await r.resolve("rec"), null);
  });
}

test("classical words are not non-classical", () => {
  const [r] = resolver(symphony());
  for (const genre of ["classical", "baroque", "opera", "chamber music"]) assert.equal(r.isNonClassicalGenre(genre), false);
  assert.equal(r.isNonClassicalGenre("poprock"), false);
});

test("album genres exclude when nobody is tagged", async () => {
  const [r] = resolver(song({ releaseGenres: ["hip hop"] }));
  assert.notEqual(await r.resolve("rec"), null);
  assert.equal(await r.resolve("rec", { releaseGroupId: "rg" }), null);
});

test("non-classical songwriter excludes", async () => {
  const [r] = resolver(song({ writerGenres: ["trap"] }));
  assert.equal(await r.resolve("rec"), null);
});

test("classical album overrides performer genres", async () => {
  const e = symphony();
  e["artist:kara"].genres = [{ name: "jazz", count: 9 }];
  e["release-group:rg"] = { genres: [{ name: "baroque" }] };
  const [r] = resolver(e);
  assert.equal(await r.resolve("rec"), null);
  assert.notEqual(await r.resolve("rec", { releaseGroupId: "rg" }), null);
});

test("recording genres beat album genres", async () => {
  const e = symphony({ genres: [{ name: "classical" }] });
  e["release-group:rg"] = { genres: [{ name: "rock" }] };
  const [r, mb] = resolver(e);
  assert.notEqual(await r.resolve("rec", { releaseGroupId: "rg" }), null);
  assert.ok(!mb.calls.includes("release-group:rg"));
});

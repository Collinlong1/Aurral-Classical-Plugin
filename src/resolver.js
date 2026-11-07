// Port of beetsplug/classicalartist.py (Collinlong1/Classical-Artists-Plugin).
// Turns a MusicBrainz recording into
//   Composer — Arranger — Soloist — Ensemble — Conductor
// and acts ONLY when one of its Works has a composer (or "writer").

export const DEFAULT_KNOWN_NAMES = {
  "Сергей Сергеевич Прокофьев": "Sergei Prokofiev",
  "Пётр Ильич Чайковский": "Pyotr Tchaikovsky",
  "Петр Ильич Чайковский": "Pyotr Tchaikovsky",
  "Дмитрий Дмитриевич Шостакович": "Dmitri Shostakovich",
  "Модест Петрович Мусоргский": "Modest Mussorgsky",
  "Николай Андреевич Римский-Корсаков": "Nikolai Rimsky-Korsakov",
  "Игорь Фёдорович Стравинский": "Igor Stravinsky",
  "Игорь Федорович Стравинский": "Igor Stravinsky",
  "Сергей Васильевич Рахманинов": "Sergei Rachmaninoff",
  "Михаил Иванович Глинка": "Mikhail Glinka",
  "Александр Порфирьевич Бородин": "Alexander Borodin",
  "Fryderyk Chopin": "Frédéric Chopin",
  "Fryderyk Franciszek Chopin": "Frédéric Chopin",
  "Фридерик Шопен": "Frédéric Chopin",
  "Фридерик Францишек Шопен": "Frédéric Chopin",
  "Иоганн Себастьян Бах": "Johann Sebastian Bach",
  "התזמורת הפילהרמונית הישראלית": "Israel Philharmonic Orchestra",
};

export const DEFAULT_NON_CLASSICAL_ARTISTS = [
  "28503ab7-8bf2-4666-a7bd-2644bfc7cb1d", // Dream Theater
  "bc641be9-ca36-4c61-9394-5230433f6646", // Liquid Tension Experiment
  "72eabb1a-4d2c-4de6-90f2-671b2cada42b", // Caravan Palace
  "6f45f514-a46b-4153-808b-731fccd3da74", // Abstract Orchestra
  "0aef8ffd-942e-4e03-bf4a-1749ddebc00a", // Evan Marien
];

export const DEFAULT_CLASSICAL_GENRES = [
  "baroque", "renaissance", "medieval", "early music", "romanticism",
  "opera", "operetta", "chamber music", "art song", "lied", "choral",
  "orchestral", "symphony", "concerto", "sonata", "oratorio", "mass",
  "requiem", "string quartet", "impressionism", "neoclassicism",
  "minimalism", "serialism", "twelve-tone", "gregorian chant",
  "sacred choral music",
];

export const DEFAULT_NON_CLASSICAL_GENRES = [
  "rock", "pop", "metal", "punk", "grunge", "emo", "indie",
  "hip hop", "hiphop", "rap", "trap", "drill", "grime", "phonk",
  "r&b", "rnb", "soul", "funk", "disco", "gospel", "blues", "jazz",
  "swing", "country", "folk", "bluegrass", "americana",
  "singer songwriter", "reggae", "dancehall", "reggaeton", "ska",
  "afrobeats", "electronic", "electro", "edm", "dance", "house",
  "techno", "trance", "dubstep", "drum and bass", "breakbeat",
  "hyperpop", "synthwave", "darkwave", "shoegaze", "lo fi",
];

// Genres of records that sound classical but aren't concert music. They
// count against a recording even beside "classical", and genres such as
// "cinematic classical" or "classical crossover" aren't classical.
export const HARD_NON_CLASSICAL_GENRES = [
  "christmas", "holiday", "soundtrack", "film score", "film soundtrack",
  "cinematic", "video game", "game music", "musical", "musicals", "show tunes",
  "broadway", "crossover", "easy listening", "children's music", "lullaby",
  "new age", "lounge", "bossa nova", "trailer music",
];

// Release-group types that aren't classical albums.
export const NON_CLASSICAL_RELEASE_TYPES = ["soundtrack", "spokenword", "audiobook", "audio drama", "interview", "dj-mix", "mixtape/street"];

// Work types that are classical forms, and ones that never are. "Song" is
// neither: an art song is classical, a pop song isn't.
export const CLASSICAL_WORK_TYPES = [
  "aria", "ballet", "cantata", "concerto", "étude", "etude", "incidental music",
  "madrigal", "mass", "motet", "opera", "operetta", "oratorio", "overture",
  "partita", "quartet", "sonata", "song-cycle", "suite", "symphonic poem",
  "symphony", "zarzuela", "variations", "prelude", "chorale", "chanson",
];
export const NON_CLASSICAL_WORK_TYPES = ["soundtrack", "musical", "play", "audio drama", "beijing opera"];

// A composer born before this year is evidence of classical music.
const EARLY_COMPOSER_YEAR = 1900;

export const DEFAULT_COMPOSER_RELATIONS = ["composer", "writer"];
export const DEFAULT_ORDER = [
  "composers", "arrangers", "soloists", "ensembles", "conductors", "credited",
];
export const ROLES = DEFAULT_ORDER;

const LYRICIST_RELATIONS = new Set(["lyricist", "librettist"]);
const ARRANGER_RELATIONS = new Set([
  "arranger", "instrument arranger", "orchestrator", "vocal arranger",
]);
const PERFORMER_RELATIONS = new Set(["instrument", "vocal", "performer"]);
const ENSEMBLE_ARTIST_TYPES = new Set(["orchestra", "choir", "group"]);
const PERFORMER_ROLE_RELATIONS = new Set([
  ...PERFORMER_RELATIONS, "conductor", "performing orchestra", "chorus master",
]);
const GROUP_VOCAL_ATTRIBUTES = new Set(["choir vocals", "background vocals"]);
const WORK_PARTS_RELATION = "parts";
const MAX_PARENT_WORK_DEPTH = 3;

const lowerSet = (values) => new Set((values || []).map((a) => String(a).toLowerCase()));

export function isSoloistRelation(rel) {
  const attributes = lowerSet(rel.attributes);
  if (attributes.has("solo")) return true;
  return rel.type === "vocal" && [...attributes].some((a) => !GROUP_VOCAL_ATTRIBUTES.has(a));
}

export const unique = (values) => [...new Set(values.filter(Boolean))];

export function isPlaceholder(name) {
  const text = String(name || "").trim();
  return text.startsWith("[") && text.endsWith("]");
}

export function isLatin(text) {
  for (const ch of String(text || "")) {
    if (/\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch)) return false;
  }
  return true;
}

const CLASSICAL_WORD = /(^|\s)classical(\s|$)/;

export function normGenre(name) {
  return String(name || "").toLowerCase().replaceAll("-", " ").split(/\s+/).filter(Boolean).join(" ");
}

export function genreNames(entity) {
  const names = new Set((entity?.genres || []).map((g) => normGenre(g?.name)));
  names.delete("");
  return names;
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function addPerson(people, person) {
  if (person && people.every((p) => p.id !== person.id)) people.push(person);
}

const emptyCredits = () => ({
  composers: [], lyricists: [], arrangers: [], soloists: [],
  ensembles: [], conductors: [], credited: [], work: null,
});

export class ClassicalResolver {
  static RECORDING_INC = "artist-credits+artist-rels+work-rels+genres";
  static RELEASE_GROUP_INC = "genres";
  static WORK_INC = "artist-rels+work-rels";
  static ARTIST_INC = "aliases+genres";
  static MEMBERSHIP_INC = "artist-rels";
  static MIN_CREDITED_LINEUP = 3;

  // `mb` is { get(entityType, id, inc, { ttl }) -> Promise<object|null> }.
  constructor(mb, {
    log = () => {},
    knownNames = DEFAULT_KNOWN_NAMES,
    nonClassicalArtists = DEFAULT_NON_CLASSICAL_ARTISTS,
    classicalGenres = DEFAULT_CLASSICAL_GENRES,
    nonClassicalGenres = DEFAULT_NON_CLASSICAL_GENRES,
    composerRelations = DEFAULT_COMPOSER_RELATIONS,
    checkArtistGenres = true,
    separator = " — ",
    listSeparator = " / ",
    order = DEFAULT_ORDER,
    maxSoloists = 4,
    maxArtistSoloists = 4,
    trackArtistFallback = false,
    requireEvidence = true,
    recordingTtlMs,
  } = {}) {
    this.mb = mb;
    this.log = log;
    this.knownNames = { ...knownNames };
    this.nonClassicalArtists = new Set(nonClassicalArtists);
    this.classicalGenres = new Set(classicalGenres.map(normGenre));
    const terms = [...new Set(nonClassicalGenres.map(normGenre))]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    this.nonClassicalRe = terms.length
      ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${terms.map(escapeRegex).join("|")})(?![\\p{L}\\p{N}_])`, "u")
      : null;
    this.composerRelations = new Set(composerRelations);
    this.checkArtistGenres = checkArtistGenres;
    this.separator = separator;
    this.listSeparator = listSeparator;
    this.order = [...order];
    this.maxSoloists = maxSoloists;
    this.maxArtistSoloists = maxArtistSoloists;
    this.trackArtistFallback = trackArtistFallback;
    this.requireEvidence = requireEvidence;
    const hard = HARD_NON_CLASSICAL_GENRES.map(normGenre).sort((a, b) => b.length - a.length);
    this.hardNonClassicalRe = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${hard.map(escapeRegex).join("|")})(?![\\p{L}\\p{N}_])`, "u");
    this.recordingTtlMs = recordingTtlMs;
    this.skipReason = null;
  }

  // -- fetching -----------------------------------------------------------

  getRecording(id) {
    return this.mb.get("recording", id, ClassicalResolver.RECORDING_INC, { ttl: this.recordingTtlMs });
  }
  getWork(id) {
    return id ? this.mb.get("work", id, ClassicalResolver.WORK_INC) : null;
  }
  getArtist(id) {
    return id ? this.mb.get("artist", id, ClassicalResolver.ARTIST_INC) : null;
  }
  getReleaseGroup(id) {
    return id ? this.mb.get("release-group", id, ClassicalResolver.RELEASE_GROUP_INC) : null;
  }

  // -- genres -------------------------------------------------------------

  isHardNonClassicalGenre(name) {
    return this.hardNonClassicalRe.test(name);
  }
  isClassicalGenre(name) {
    if (this.isHardNonClassicalGenre(name)) return false;
    return this.classicalGenres.has(name) || CLASSICAL_WORD.test(name);
  }
  isNonClassicalGenre(name) {
    return this.isHardNonClassicalGenre(name) || Boolean(this.nonClassicalRe && this.nonClassicalRe.test(name));
  }
  // true (classical), false (not classical) or null (no signal). A
  // classical genre wins over "pop" or "rock" on the same entity, but not
  // over Christmas, soundtrack or crossover genres.
  classifyGenres(genres) {
    const list = [...genres];
    if (list.some((g) => this.isHardNonClassicalGenre(g))) return false;
    if (list.some((g) => this.isClassicalGenre(g))) return true;
    if (list.some((g) => this.isNonClassicalGenre(g))) return false;
    return null;
  }

  async isNonClassicalArtist(artist) {
    const id = artist?.id;
    if (this.nonClassicalArtists.has(id)) return true;
    if (!this.checkArtistGenres || !id) return false;
    const data = (await this.getArtist(id)) || {};
    const genres = data.genres || [];
    if (!genres.length) return false;
    if (this.classifyGenres(genreNames(data)) === true) return false;
    const top = Math.max(...genres.map((g) => g.count || 0));
    const topNames = genreNames({ genres: genres.filter((g) => (g.count || 0) === top) });
    return [...topNames].some((g) => this.isNonClassicalGenre(g));
  }

  // -- names --------------------------------------------------------------

  static bestEnglishAlias(aliases) {
    const candidates = (aliases || []).filter(
      (a) =>
        String(a.locale || "").replaceAll("-", "_").split("_")[0] === "en" &&
        a.name &&
        a.type !== "Search hint" &&
        !a.ended,
    );
    if (!candidates.length) return null;
    const key = (a) => [a.primary ? 0 : 1, a.type == null || a.type === "Artist name" ? 0 : 1];
    return [...candidates].sort((x, y) => {
      const [a, b] = [key(x), key(y)];
      return a[0] - b[0] || a[1] - b[1];
    })[0];
  }

  static pickEnglishAlias(aliases) {
    return ClassicalResolver.bestEnglishAlias(aliases)?.name ?? null;
  }

  async englishName(artist) {
    return (await this.englishNames(artist))[0];
  }

  async englishNames(artist) {
    if (!artist) return [null, null];
    const id = artist.id;
    const name = artist.name || "";
    const sortName = artist["sort-name"] || artist.sort_name || "";
    const override = [id, name, sortName]
      .filter((key) => key && Object.hasOwn(this.knownNames, key))
      .map((key) => this.knownNames[key])[0];
    if (!name && !override) return [null, null];

    let aliases = artist.aliases;
    if (aliases == null) aliases = ((await this.getArtist(id)) || {}).aliases || [];
    const alias = ClassicalResolver.bestEnglishAlias(aliases);
    const aliasSort = alias ? alias["sort-name"] : null;

    if (override) return [override, aliasSort || sortName || null];
    if (alias && (alias.primary || !isLatin(name))) return [alias.name, aliasSort || sortName || null];
    if (isLatin(name)) return [name, sortName || null];
    if (sortName && sortName.includes(",") && isLatin(sortName)) {
      const [surname, rest] = sortName.split(/,(.*)/s).map((s) => (s || "").trim());
      const given = rest ? rest.split(/\s+/)[0] : "";
      return [`${given} ${surname}`.trim(), sortName];
    }
    return [name, sortName || null];
  }

  async person(artist) {
    const [name, sortName] = await this.englishNames(artist);
    if (!name) return null;
    return { id: artist.id || name, name, sortName: sortName || name };
  }

  // -- credits ------------------------------------------------------------

  async collectWorkCredits(workId, credits, depth = 0, seen = new Set()) {
    if (!workId || seen.has(workId)) return;
    seen.add(workId);
    const work = await this.getWork(workId);
    if (!work) return;
    if (credits.work == null) credits.work = work;

    let foundComposer = false;
    const parents = [];
    for (const rel of work.relations || []) {
      const type = rel.type;
      if (rel["target-type"] === "work" || "work" in rel) {
        if (type === WORK_PARTS_RELATION && rel.direction === "backward") parents.push(rel.work?.id);
        continue;
      }
      const artist = rel.artist;
      if (!artist) continue;
      if (this.composerRelations.has(type)) {
        addPerson(credits.composers, await this.person(artist));
        foundComposer = true;
      } else if (LYRICIST_RELATIONS.has(type)) {
        addPerson(credits.lyricists, await this.person(artist));
      } else if (ARRANGER_RELATIONS.has(type)) {
        addPerson(credits.arrangers, await this.person(artist));
      }
    }
    if (!foundComposer && depth < MAX_PARENT_WORK_DEPTH) {
      for (const parentId of parents) await this.collectWorkCredits(parentId, credits, depth + 1, seen);
    }
  }

  async workCredits(recording) {
    const credits = emptyCredits();
    for (const rel of recording.relations || []) {
      if (rel.type !== "performance") continue;
      await this.collectWorkCredits(rel.work?.id, credits);
    }
    return credits;
  }

  async isMemberOf(artistId, ensembleIds) {
    const data = (await this.mb.get("artist", artistId, ClassicalResolver.MEMBERSHIP_INC)) || {};
    return (data.relations || []).some(
      (rel) =>
        rel.type === "member of band" &&
        (rel.direction ?? "forward") === "forward" &&
        ensembleIds.has(rel.artist?.id),
    );
  }

  async artistType(artist) {
    let type = artist?.type;
    if (type == null && artist?.id) type = ((await this.getArtist(artist.id)) || {}).type;
    return String(type || "").toLowerCase();
  }

  async addPerformers(recording, credits) {
    const markedSoloists = [];
    const individuals = [];
    const voiceOnly = new Set();
    const wanted = new Set(["conductor", "performing orchestra", ...PERFORMER_RELATIONS, ...ARRANGER_RELATIONS]);

    for (const rel of recording.relations || []) {
      const type = rel.type;
      const artist = rel.artist;
      if (!artist || !wanted.has(type)) continue;
      const person = await this.person(artist);
      if (type === "conductor") addPerson(credits.conductors, person);
      else if (ARRANGER_RELATIONS.has(type)) addPerson(credits.arrangers, person);
      else if (type === "performing orchestra" || ENSEMBLE_ARTIST_TYPES.has(await this.artistType(artist)))
        addPerson(credits.ensembles, person);
      else if (isSoloistRelation(rel)) {
        addPerson(markedSoloists, person);
        if (person && !lowerSet(rel.attributes).has("solo")) voiceOnly.add(person.id);
      } else addPerson(individuals, person);
    }

    const creditedIds = new Set();
    for (const credit of recording["artist-credit"] || []) {
      const artist = credit.artist || {};
      creditedIds.add(artist.id);
      if (ENSEMBLE_ARTIST_TYPES.has(await this.artistType(artist)))
        addPerson(credits.ensembles, await this.person(artist));
    }

    const ensembleIds = new Set(credits.ensembles.map((p) => p.id));
    const isMember = async (person) => ensembleIds.size > 0 && (await this.isMemberOf(person.id, ensembleIds));

    const keptSoloists = [];
    for (const p of markedSoloists) if (!voiceOnly.has(p.id) || !(await isMember(p))) keptSoloists.push(p);

    const creditedIndividuals = individuals.filter((p) => creditedIds.has(p.id));
    let creditedMembers = new Set();
    for (const p of creditedIndividuals) if (await isMember(p)) creditedMembers.add(p.id);
    if (creditedMembers.size < ClassicalResolver.MIN_CREDITED_LINEUP) creditedMembers = new Set();
    for (const p of creditedIndividuals) if (!creditedMembers.has(p.id)) addPerson(keptSoloists, p);
    const others = individuals.filter((p) => !creditedIds.has(p.id));

    for (const p of keptSoloists) addPerson(credits.soloists, p);
    if (!credits.ensembles.length && others.length <= this.maxSoloists) {
      for (const p of others) addPerson(credits.soloists, p);
    } else if (others.length) {
      this.log(`left out ${others.length} individual performer(s) as ensemble members`);
    }

    const sparse = !(recording.relations || []).some((rel) => PERFORMER_ROLE_RELATIONS.has(rel.type));
    const placed = new Set(
      [credits.composers, credits.arrangers, credits.soloists, credits.ensembles, credits.conductors]
        .flat()
        .map((p) => p.id),
    );
    for (const credit of recording["artist-credit"] || []) {
      const artist = credit.artist || {};
      const person = await this.person(artist);
      if (person && creditedMembers.has(person.id)) continue;
      addPerson(credits.credited, person);
      if (
        sparse &&
        !credits.ensembles.length &&
        person &&
        !placed.has(person.id) &&
        (await this.artistType(artist)) === "person"
      )
        addPerson(credits.soloists, person);
    }
  }

  async composersFromTrackArtist(recording, trackArtistIds, credits) {
    const recordingIds = new Set((recording["artist-credit"] || []).map((c) => c.artist?.id));
    for (const id of unique(trackArtistIds || [])) {
      if (recordingIds.has(id) || this.nonClassicalArtists.has(id)) continue;
      const artist = await this.getArtist(id);
      if (!artist || String(artist.type || "").toLowerCase() !== "person") continue;
      if (await this.isNonClassicalArtist({ id })) continue;
      const person = await this.person(artist);
      if (person) addPerson(credits.composers, person);
    }
  }

  static orderByBilling(recording, albumArtistIds, credits) {
    const billing = [...(albumArtistIds || []), ...(recording["artist-credit"] || []).map((c) => c.artist?.id)];
    const rank = new Map();
    billing.forEach((id, position) => {
      if (!rank.has(id)) rank.set(id, position);
    });
    for (const role of ["soloists", "ensembles", "conductors"]) {
      const people = credits[role];
      const sorted = people
        .map((p, i) => [rank.has(p.id) ? rank.get(p.id) : billing.length, i, p])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1])
        .map(([, , p]) => p);
      credits[role] = sorted;
    }
  }

  // -- evidence -----------------------------------------------------------

  // An artist known only for classical music: their most-voted genres are
  // classical, and none of them isn't.
  async isClassicalArtist(id) {
    const data = (await this.getArtist(id)) || {};
    const genres = data.genres || [];
    if (!genres.length) return false;
    const top = Math.max(...genres.map((g) => g.count || 0));
    const names = [...genreNames({ genres: genres.filter((g) => (g.count || 0) === top) })];
    return names.some((g) => this.isClassicalGenre(g)) && !names.some((g) => this.isNonClassicalGenre(g));
  }

  async isEarlyComposer(id) {
    const year = Number(String(((await this.getArtist(id)) || {})["life-span"]?.begin || "").slice(0, 4));
    return year > 0 && year < EARLY_COMPOSER_YEAR;
  }

  // The types of the recorded Work and the Work it belongs to.
  async workTypes(credits) {
    const work = credits.work;
    if (!work) return [];
    const types = [work.type];
    const parent = (work.relations || []).find((rel) => rel.type === "parts" && rel.direction === "backward" && rel.work?.id);
    if (parent) types.push(((await this.getWork(parent.work.id)) || {}).type);
    return types.filter(Boolean).map((t) => String(t).toLowerCase());
  }

  // Why this recording is classical, or null when nothing says so.
  async classicalEvidence(recording, credits, workTypes) {
    if (workTypes.some((t) => CLASSICAL_WORK_TYPES.includes(t))) return "work type";
    for (const p of credits.composers) {
      if (p.id === p.name) continue;
      if (await this.isEarlyComposer(p.id)) return "composer's dates";
      if (await this.isClassicalArtist(p.id)) return "composer's genres";
    }
    for (const credit of recording["artist-credit"] || [])
      if (credit.artist?.id && (await this.isClassicalArtist(credit.artist.id))) return "performer's genres";
    return null;
  }

  // -- entry point --------------------------------------------------------

  // Returns the classical fields for a recording, or null to leave it alone.
  // `skipReason` says why: "no composer", "non-classical", or null when
  // MusicBrainz couldn't be reached.
  // `confirmed`: an admin said it's classical, so missing evidence doesn't
  // keep it from being tagged (signs that it isn't classical still do).
  async resolve(recordingId, { trackArtistIds = [], albumArtistIds = [], releaseGroupId = null, confirmed = false } = {}) {
    this.skipReason = null;
    if (!recordingId) return null;
    const recording = await this.getRecording(recordingId);
    if (!recording) {
      // MusicBrainz answered "not found" (a merged or deleted recording), or
      // couldn't be reached, in which case the file waits for the next run.
      this.skipReason = this.mb.lastResult === "missing" ? "not on MusicBrainz" : "unreachable";
      return null;
    }
    for (const credit of recording["artist-credit"] || []) {
      if (this.nonClassicalArtists.has(credit.artist?.id)) {
        this.skipReason = "non-classical";
        return null;
      }
    }

    // The beets rules look at the album only when the recording has no
    // genre; the stricter rules always need the album's type.
    const needAlbum = this.requireEvidence || this.classifyGenres(genreNames(recording)) == null;
    const releaseGroup = releaseGroupId && needAlbum ? (await this.getReleaseGroup(releaseGroupId)) || {} : {};
    const albumTypes = (releaseGroup["secondary-types"] || []).map((t) => String(t).toLowerCase());
    if (this.requireEvidence && albumTypes.some((t) => NON_CLASSICAL_RELEASE_TYPES.includes(t))) {
      this.skipReason = "non-classical";
      return null;
    }
    let verdict = this.classifyGenres(genreNames(recording));
    const albumVerdict = this.classifyGenres(genreNames(releaseGroup));
    // Christmas, soundtrack and crossover genres on the album count even
    // when the recording's own genres say classical.
    if (this.requireEvidence && albumVerdict === false && [...genreNames(releaseGroup)].some((g) => this.isHardNonClassicalGenre(g)))
      verdict = false;
    if (verdict == null) verdict = albumVerdict;
    if (verdict === false) {
      this.skipReason = "non-classical";
      return null;
    }

    const credits = await this.workCredits(recording);
    if (!credits.composers.length && this.trackArtistFallback)
      await this.composersFromTrackArtist(recording, trackArtistIds, credits);
    if (!credits.composers.length) {
      this.skipReason = "no composer";
      return null;
    }

    if (verdict == null) {
      const performers = (recording["artist-credit"] || []).map((c) => c.artist || {});
      const composers = credits.composers.filter((p) => p.id !== p.name).map((p) => ({ id: p.id, name: p.name }));
      for (const artist of [...performers, ...composers]) {
        if (await this.isNonClassicalArtist(artist)) {
          this.skipReason = "non-classical";
          return null;
        }
      }
    }

    if (this.requireEvidence) {
      const types = await this.workTypes(credits);
      if (types.some((t) => NON_CLASSICAL_WORK_TYPES.includes(t))) {
        this.skipReason = "non-classical";
        return null;
      }
      // Without a classical genre, something else has to say it's
      // classical; when nothing does, the file is left alone.
      if (!confirmed && verdict !== true && !(await this.classicalEvidence(recording, credits, types))) {
        this.skipReason = "not clearly classical";
        return null;
      }
    }

    await this.addPerformers(recording, credits);
    ClassicalResolver.orderByBilling(recording, albumArtistIds, credits);
    const fields = this.buildFields(credits);
    fields.recording = recording;
    return fields;
  }

  static dropPlaceholders(people, keepIfAlone) {
    const real = people.filter((p) => !isPlaceholder(p.name));
    return real.length || !keepIfAlone ? real : people;
  }

  buildFields(credits) {
    credits.composers = ClassicalResolver.dropPlaceholders(credits.composers, true);
    credits.arrangers = ClassicalResolver.dropPlaceholders(credits.arrangers, false);
    const roles = {
      composers: credits.composers,
      arrangers: credits.arrangers,
      soloists: credits.soloists,
      ensembles: credits.ensembles,
      conductors: credits.conductors,
      credited: credits.credited,
    };
    let hidden = new Set();
    if (this.maxArtistSoloists && credits.ensembles.length && credits.soloists.length > this.maxArtistSoloists) {
      const creditedIds = new Set(credits.credited.map((p) => p.id));
      let headline = credits.soloists.filter((p) => creditedIds.has(p.id));
      if (!(headline.length > 0 && headline.length <= this.maxArtistSoloists)) headline = [];
      const keep = new Set(headline.map((p) => p.id));
      hidden = new Set(credits.soloists.map((p) => p.id).filter((id) => !keep.has(id)));
    }
    const parts = [];
    for (const role of this.order) for (const p of roles[role] || []) if (!hidden.has(p.id)) addPerson(parts, p);

    const names = unique(parts.map((p) => p.name));
    const sortNames = unique(parts.map((p) => p.sortName));
    const joined = (people) => people.map((p) => p.name).join(this.listSeparator) || null;
    const work = credits.work || null;
    return {
      artist: names.join(this.separator),
      artists: names,
      artistSort: sortNames.join(this.separator),
      artistsSort: sortNames,
      composers: credits.composers.map((p) => p.name),
      composersIds: credits.composers.map((p) => p.id),
      composerSort: credits.composers.map((p) => p.sortName).join(", "),
      lyricists: credits.lyricists.map((p) => p.name),
      arrangers: credits.arrangers.map((p) => p.name),
      classicalComposers: joined(credits.composers),
      classicalArrangers: joined(credits.arrangers),
      classicalSoloists: joined(credits.soloists),
      classicalEnsembles: joined(credits.ensembles),
      classicalConductors: joined(credits.conductors),
      people: {
        composers: credits.composers,
        arrangers: credits.arrangers,
        soloists: credits.soloists,
        ensembles: credits.ensembles,
        conductors: credits.conductors,
      },
      work: work ? work.title : null,
      workId: work ? work.id : null,
    };
  }
}

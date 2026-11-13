import { createHash } from "node:crypto";
import { Metadata } from "./metadata.js";
import { transaction } from "./database.js";
import { catalogueNumber, cataloguePiece } from "../works.js";
import { artistCredits } from "./credits.js";

const MULTI_MOVEMENT =
  /\b(symphon(?:y|ie)|sinfonia|sonata|sonatina|concerto|suite|partita|quartet|quintet|sextet|septet|octet|nonet|trio|serenade|divertimento|cassation|mass|missa|requiem|stabat mater|magnificat|te deum|vespers|cantata|oratorio|passion|variations?|ballet)\b/i;
// Letter boundaries, not \b, which doesn't see "É" as part of a word.
const COLLECTION_LIKE = /(?<!\p{L})(etudes?|études?|preludes?|préludes?|songs?|lieder)(?!\p{L})/iu;
export const isCollectionLike = (value) => COLLECTION_LIKE.test(clean(value));
const MOVEMENT_PREFIX = /^(?:[IVXLCDM]+|\d+)[.)\s:-]/i;
const clean = (value) => String(value || "").trim().replace(/\s+/g, " ");
const normalized = (value) =>
  clean(value)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
const sameCatalogue = (a, b) => {
  const number = catalogueNumber(a).toLowerCase();
  return Boolean(number) && number === catalogueNumber(b).toLowerCase();
};
const identity = (...values) =>
  createHash("sha256").update(JSON.stringify(values)).digest("hex");

// Sets named in the plural whose pieces are numbered, not Field's single
// "Nocturne no. 10", which is a piece of its own.
export const NUMBERED_SET =
  /(?<!\p{L})(pr[eé]ludes|[eé]tudes|nocturnes|mazurkas|waltzes|valses|impromptus|ballades|polonaises|bagatelles|intermezzi|consolations|songs without words|lieder ohne worte)(?!\p{L})/iu;
// "Rachmaninoff: Piano Concerto No. 2…: I. Moderato" from a store that puts
// the composer first: the title is what follows, when the prefix names one
// of the track's composers in full or by surname.
export function withoutComposer(title, composers = []) {
  const text = clean(title);
  const match = text.match(/^([^:]{2,60}):\s+(\S.*)$/);
  if (!match) return text;
  const prefix = nameKey(match[1]);
  const named = (Array.isArray(composers) ? composers : [composers]).some((name) => {
    const full = nameKey(name);
    return Boolean(full) && (prefix === full || prefix === full.split(" ").at(-1));
  });
  return named ? clean(match[2]) : text;
}

// A name as it sounds across transliterations, so Rachmaninoff and
// Rachmaninov, Tchaikovsky and Tschaikowsky, or Prokofieff and Prokofiev
// compare equal.
export function nameKey(name) {
  return normalized(name)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/ts?ch/g, "ch")
    .replace(/ff\b/g, "v")
    .replace(/w/g, "v")
    .replace(/[yj]/g, "i")
    .replace(/kh/g, "h");
}

// The work part of a structured title: text before the first ":", ";" or
// spaced dash. "B-flat" has no spaces, so it stays in the work.
// A colon straight before a quote counts too ('Carmen, Act 1:"Avec la
// garde…"'); "Hob. XVI:52" has none, so it stays whole.
const WORK_HEAD = /^(.+?)(?:\s*[:;]\s+|\s+[–—-]\s+|:(?=["“„'‘]))(.+)$/;
export const titleHead = (title) => splitTitle(title).head;
// Some stores separate a numbered movement with a comma instead:
// "Winterreise, D. 911, II. Die Wetterfahne". That counts only when the head
// reads as a work (a catalogue number or a form such as Sonata) and the
// comma comes before any other separator.
// "L. 103" after the comma is a catalogue number, not movement fifty.
const COMMA_MOVEMENT = /^(.{4,}?),\s+((?:[IVXLC]+|\d{1,2})\.\s+(?!\d)\S.*)$/;
export function splitTitle(title) {
  const text = clean(title);
  const match = text.match(WORK_HEAD);
  const comma = text.match(COMMA_MOVEMENT);
  if (comma && (!match || comma[1].length < match[1].length) && (catalogueNumber(comma[1]) || MULTI_MOVEMENT.test(comma[1])))
    return { head: clean(comma[1]), tail: clean(comma[2]) };
  return match ? { head: clean(match[1]), tail: clean(match[2]) } : { head: "", tail: text };
}

// A track that is a whole piece: its WORK (or GROUPING) tag names the work
// with no movement part, and its title is that work with nothing after it but
// details such as "(Live)". A lone movement on a compilation never is.
function standalonePiece(hints, workTitle, tag = hints.work) {
  const tagged = clean(tag);
  const title = clean(hints.title);
  if (!tagged || tagged.includes(":") || isCollectionLike(tagged) || title.includes(":")) return false;
  const head = words(workTitle);
  const text = words(title);
  return text === head || (text.startsWith(`${head} `) && splitTitle(title).head === "" && !MOVEMENT_PREFIX.test(stripWorkPrefix(title, workTitle)));
}

// A catalogue range names several works: "Book 1, BWV 846-869", or
// "HWV 349/350". "Op. 8/3" (No. 3) and "K. 138/125c" (a second catalogue's
// number) name one.
const isCatalogueRange = (text) =>
  /\d+[a-z]?\s*[-–—]\s*\d+/i.test(text) ||
  [...String(text).matchAll(/\b(\d+)\s*\/\s*(\d+)\b(?![a-z])/gi)].some(([, a, b]) => Number(b) > Number(a));
// A name reads as a work when it names a form ("Sonata") or carries a
// catalogue number ("The Bells, op. 35"); a set such as "Études" never does.
const catalogued = (text) => Boolean(catalogueNumber(text)) && !isCatalogueRange(text);
// A set named in the plural with its own catalogue number ("Waltzes, op.
// 34", "24 Préludes, op. 28") is one work; a set's name alone ("Études") is
// not, and "Prelude No. 1, Op. 23/1" is one piece of a set.
const catalogueSet = (text) => NUMBERED_SET.test(text) && catalogued(text);
const readsAsWork = (text) =>
  Boolean(text) &&
  ((!isCollectionLike(text) && (MULTI_MOVEMENT.test(text) || catalogued(text))) || catalogueSet(text));

// "24 Préludes, op. 28 no. 6 in B minor": a numbered piece of a set named in
// the plural. A key before the number names one piece instead ("Études in
// G-flat major, Op. 10 No. 5").
export function numberedPiece(title) {
  const match = String(title).match(/^(.+?)[,\s]+(no\.?\s*\d+\b.*)$/i);
  if (!match || !NUMBERED_SET.test(match[1]) || /\bin\s+[a-h]\b/i.test(match[1])) return null;
  return { set: match[1].trim(), part: match[2].charAt(0).toUpperCase() + match[2].slice(1) };
}

// A title with a catalogue number of its own and nothing after it names a
// whole piece on one track: "Ballade No. 1 in G Minor, Op. 23", "Tapiola,
// op. 112". A number within an opus ("Op. 28 No. 3", "Op. 23/1") makes it one
// of a set, which the album page groups instead, and "from" an excerpt.
const wholePiece = (title) =>
  !splitTitle(title).head &&
  !MOVEMENT_PREFIX.test(title) &&
  !NUMBERED_SET.test(title) &&
  catalogued(title) &&
  !/ no /.test(catalogueNumber(title)) &&
  !/\d+\s*\/\s*\d+/.test(title) &&
  !/(?<!\p{L})(?:from|aus|extrait)(?!\p{L})/iu.test(title);

// GROUPING is free text in some taggers ("Favourite Sonatas"), so without a
// catalogue number it counts only when the track's title names it too.
function groupingWork(grouping, title) {
  const parent = clean(clean(grouping).split(/\s*:\s*/, 1)[0]);
  if (!readsAsWork(parent)) return null;
  if (catalogueNumber(parent) && !isCatalogueRange(parent)) return parent;
  const named = words(parent);
  const head = words(titleHead(title) || title);
  return head === named || head.startsWith(`${named} `) || named.startsWith(`${head} `) ? parent : null;
}

// "S 161" -> "S. 161", which reads back as the same catalogue number.
const catalogueText = (number) => number.replace(/^([A-Z])\s/, "$1. ");

function proposedWork({ work, grouping, title }, allowStructuredTitles) {
  const tagged = clean(work);
  if (tagged && (!isCollectionLike(tagged) || catalogueSet(clean(tagged.split(/\s*:\s*/, 1)[0])))) {
    const parent = clean(tagged.split(/\s*:\s*/, 1)[0]);
    // A WORK tag names a work outright when it reads like one or carries
    // a catalogue number, as song cycles do ("Winterreise, D. 911").
    if (MULTI_MOVEMENT.test(parent) || catalogueNumber(parent))
      return { title: parent, evidence: "work-tag" };
    // A set's name with its catalogue number only in the titles: WORK
    // "Années de pèlerinage, Deuxième année" on "Italie, S. 161, no. 4:
    // Sonetto 47 del Petrarca". The number, not the name, is its identity.
    // A title that names its own form ("Symphony No. 5, Op. 67: I.") is
    // that work, whatever label WORK carries.
    const head = titleHead(title) || title;
    const number = catalogueNumber(head);
    if (number && !isCatalogueRange(head) && !MULTI_MOVEMENT.test(head) && !isCollectionLike(parent))
      return { title: parent, evidence: "work-tag", catalogue: catalogueText(number) };
  }
  if (!tagged && grouping) {
    const named = groupingWork(grouping, title);
    if (named) return { title: named, evidence: "grouping-tag" };
  }
  if (!allowStructuredTitles) return null;
  // Every track of a work shares the head, numbered or not ("Theme: Largo").
  const candidate = titleHead(title);
  if (readsAsWork(candidate)) return { title: candidate, evidence: "structured-title" };
  if (candidate) {
    // "Années de pèlerinage, Deuxième année: Italie, S. 161, no. 4: Sonetto
    // 47": the head names the work and the next part its number, as a WORK
    // tag with the number in the title does. A next part naming its own
    // form ("Favourites: Symphony No. 5, Op. 67: I.") is that work instead.
    const next = titleHead(splitTitle(title).tail) || splitTitle(title).tail;
    const number = catalogueNumber(next);
    // A head with numbers of its own ("Book 1, BWV 846-869") names a set of
    // works, not one.
    return number && !catalogueNumber(candidate) && !isCollectionLike(candidate) && !isCatalogueRange(next) && !MULTI_MOVEMENT.test(next)
      ? { title: candidate, evidence: "structured-title", catalogue: catalogueText(number) }
      : null;
  }
  const set = numberedPiece(clean(title));
  if (set) return catalogueSet(set.set) ? { title: set.set, evidence: "structured-title" } : null;
  return wholePiece(clean(title)) ? { title: clean(title), evidence: "structured-title", standalone: true } : null;
}

// `explain`, when given, gets each track's proposed work and why it was
// left out (the audit's dry run); matching itself never passes one.
function candidates(
  catalogue,
  albumId = null,
  allowStructuredTitles = false,
  providerMatches = new Map(),
  explain = null,
) {
  // One album's match reads only that album's tracks, through its index.
  const rows = catalogue.db
    .prepare(
      `SELECT t.id,t.instance_id,t.evidence,
        EXISTS(SELECT 1 FROM segment s JOIN realization_item i ON i.segment_id=s.id WHERE s.track_link_id=t.id) AS attached
       FROM track_link t
       JOIN classification c ON c.target_id=t.id AND c.state='classical'
       WHERE t.state='active'
       ${albumId == null ? "" : "AND CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=?"}`,
    )
    .all(...(albumId == null ? [] : [String(albumId)]))
    .map((row) => ({ ...row, evidence: JSON.parse(row.evidence) }))
    .filter(
      (row) =>
        row.evidence.albumId != null &&
        (albumId == null || String(row.evidence.albumId) === String(albumId)),
    );
  const groups = new Map();
  // Composers the library already credits corroborate a name read from an
  // artist field.
  const knownComposers = rows.length ? knownComposerNames(catalogue) : new Set();
  for (const row of rows) {
    const tagged = row.evidence.hints || {};
    const hints = { ...tagged, title: withoutComposer(tagged.title, tagged.composer) };
    const provider = providerMatches.get(row.id);
    const local = proposedWork(hints, true);
    const proposal = provider
      ? {
          // The tags' own title wins when it names the same catalogue number.
          title:
            local && sameCatalogue(local.title, provider.work)
              ? local.title
              : clean(provider.work),
          evidence: "musicbrainz-parent",
          identity: provider.workId,
          ...(provider.standalone && { standalone: true }),
        }
      : proposedWork(hints, allowStructuredTitles);
    // GROUPING names a whole piece the way WORK does.
    if (
      proposal &&
      !provider &&
      ((proposal.evidence === "work-tag" && standalonePiece(hints, proposal.title)) ||
        (proposal.evidence === "grouping-tag" && standalonePiece(hints, proposal.title, hints.grouping)))
    )
      proposal.standalone = true;
    // No composer tag and no provider composer: an artist field such as
    // "Bedřich Smetana; Vienna Philharmonic" may name one. Only a
    // corroborated name makes a work; an uncorroborated one goes to review.
    const credit =
      hints.composer?.length || provider?.composers?.length
        ? null
        : artistCredits(hints, { knownComposers });
    const composers = [
      ...new Set(
        (hints.composer?.length ? hints.composer : provider?.composers?.length ? provider.composers : credit?.composers || [])
          .map(clean)
          .filter(Boolean),
      ),
    ];
    const trackNumber = Number(hints.trackNumber);
    const discNumber = Number(hints.discNumber) || 1;
    if (
      !proposal ||
      !composers.length ||
      !Number.isSafeInteger(trackNumber) ||
      trackNumber < 1
    ) {
      explain?.set(row.id, {
        work: proposal?.title ?? null,
        reason: !proposal
          ? "no work named: no WORK or GROUPING tag, and the title names no work"
          : !composers.length
            ? credit?.confidence === "medium"
              ? "composer only guessed from the artist field"
              : "no composer tag"
            : "no track number",
      });
      continue;
    }
    const keyWith = (subjectOf) =>
      JSON.stringify([
        row.instance_id,
        String(row.evidence.albumId),
        proposal.identity || subjectOf(proposal.title, composers),
        composers.map(normalized).sort(),
        proposal.evidence,
        // Appended only for whole pieces, so earlier groups keep their keys.
        ...(proposal.standalone ? ["standalone"] : []),
        // Likewise for composers read from the artist field.
        ...(credit ? [`artist-field:${credit.confidence}`] : []),
        // And for a set named by WORK with its number in the titles.
        ...(proposal.catalogue ? [`catalogue:${proposal.catalogue}`] : []),
      ]);
    const key = keyWith(workKey);
    // The key before catalogue suffixes counted (1.0.22), whose album
    // records still say what this album made.
    const legacy = keyWith(legacyWorkKey);
    if (!groups.has(key))
      groups.set(key, {
        key,
        legacyKey: legacy !== key ? legacy : null,
        work: proposal.title,
        titles: new Map(),
        evidence: proposal.evidence,
        catalogue: proposal.catalogue || null,
        standalone: !!proposal.standalone,
        providerWorkId: proposal.identity || null,
        localTitle: provider && local ? local.title : null,
        providerAliases: provider?.aliases || [],
        composers,
        composerIds: provider?.composerIds || {},
        composerSource: credit ? { field: "artist", confidence: credit.confidence, evidence: credit.evidence } : null,
        albumId: String(row.evidence.albumId),
        album: clean(hints.album),
        tracks: [],
      });
    const group = groups.get(key);
    group.titles.set(proposal.title, (group.titles.get(proposal.title) || 0) + 1);
    group.tracks.push({
      ...row,
      composers,
      providerMovement: provider?.movement ? clean(provider.movement) : null,
      title: clean(tagged.title),
      // The title without a "Composer: " prefix, for reading the movement.
      parsedTitle: clean(hints.title),
      discNumber,
      trackNumber,
    });
  }
  return separateRecordings(mergeCompletions([...groups.values()])).filter((group) => {
    // The title most of the work's tracks use, so one typo doesn't name it.
    group.work = [...group.titles].sort((a, b) => b[1] - a[1])[0][0];
    const positions = group.tracks.map(
      (track) => `${track.discNumber}:${track.trackNumber}`,
    );
    const reason = group.tracks.every((track) => track.attached)
      ? "matched"
      : // Whole pieces are one track each; anything else needs two movements.
        group.standalone && group.tracks.length !== 1
        ? "several tracks name the same whole piece"
        : !group.standalone && group.tracks.length < 2
          ? "only one track of a work with movements on this album"
          : new Set(positions).size !== positions.length
            ? "two tracks share a disc and track number"
            : new Set(group.tracks.map((track) => normalized(track.title))).size !== group.tracks.length
              ? "two tracks share a title"
              : null;
    if (explain)
      for (const track of group.tracks)
        explain.set(track.id, { work: group.work, evidence: group.evidence, reason: reason ?? "matches when Auto-match runs" });
    return !reason;
  });
}

// What Auto-match would make of each classical track on an album, and why a
// track stays out of every work. Reads only.
export function explainMatching(catalogue, albumId) {
  const explain = new Map();
  candidates(catalogue, albumId, true, new Map(), explain);
  return explain;
}

// One work whose movements credit different people: Mozart's Requiem names
// Süßmayr on some movements and Eybler on others. An album's groups that
// share a MusicBrainz work, or a catalogue number and a composer, are that
// one work, credited to the composers every movement names. The others stay
// on the recordings of the movements that name them.
function mergeCompletions(groups) {
  const subject = (group) =>
    group.providerWorkId ? `mb:${group.providerWorkId}` : catalogueSubject(group.work);
  const families = new Map();
  for (const group of groups) {
    const key = subject(group);
    if (!key || group.standalone || group.composerSource) continue;
    const family = JSON.stringify([group.tracks[0].instance_id, group.albumId, group.evidence, key]);
    families.set(family, [...(families.get(family) || []), group]);
  }
  const merged = new Set();
  const result = [];
  for (const family of families.values()) {
    if (family.length < 2) continue;
    const shared = family[0].composers.filter((name) =>
      family.every((group) => group.composers.some((other) => normalized(other) === normalized(name))),
    );
    if (!shared.length) continue;
    const group = {
      ...family[0],
      key: JSON.stringify([...JSON.parse(family[0].key).slice(0, 2), subject(family[0]), shared.map(normalized).sort(), family[0].evidence, "completion"]),
      composers: shared,
      titles: new Map(),
      tracks: [],
    };
    for (const part of family) {
      merged.add(part);
      for (const [title, count] of part.titles) group.titles.set(title, (group.titles.get(title) || 0) + count);
      group.tracks.push(...part.tracks);
    }
    result.push(group);
  }
  return [...groups.filter((group) => !merged.has(group)), ...result];
}

// A box set can hold two recordings of one work (Capriccio espagnol on two
// discs), which share every title. Only for such a group: in album order,
// the work's opening movements coming round again, in order, start the next
// recording, and each is matched on its own; a whole piece listed twice is
// two recordings. A movement repeated inside one work (the B minor Mass
// returns to "Kyrie eleison" after the Christe) starts nothing.
// A recording's credit after a title ("I. Moderato - Allegro (Philadelphia
// Orchestra feat. conductor: Leopold Stokowski)") and punctuation ("I.
// Moderato; Allegro") don't make it another movement.
// A bracket of numbers only ("Mazurka … (3)") tells repeats apart, so it stays.
const recordingTitle = (title) =>
  words(clean(title).replace(/\s*[([][^()[\]]*\p{L}[^()[\]]*[)\]]\s*$/u, ""));
function separateRecordings(groups) {
  return groups.flatMap((group) => {
    const titles = group.tracks.map((track) => recordingTitle(track.title));
    if (new Set(titles).size === titles.length) return [group];
    const ordered = [...group.tracks].sort(albumOrder);
    const title = (track) => recordingTitle(track?.title);
    const runs = [[]];
    ordered.forEach((track, i) => {
      const run = runs.at(-1);
      const again =
        run.length > 0 &&
        title(run[0]) === title(track) &&
        (group.standalone || (run.length > 1 && title(run[1]) === title(ordered[i + 1])));
      if (again) runs.push([track]);
      else run.push(track);
    });
    if (runs.length === 1) return [group];
    return runs.map((tracks, i) => ({
      ...group,
      key: i ? JSON.stringify([...JSON.parse(group.key), `recording:${i + 1}`]) : group.key,
      legacyKey: group.legacyKey && i ? JSON.stringify([...JSON.parse(group.legacyKey), `recording:${i + 1}`]) : group.legacyKey,
      tracks,
    }));
  });
}

function knownComposerNames(catalogue) {
  const names = new Set();
  for (const { id } of catalogue.db
    .prepare(
      `SELECT DISTINCT c.contributor_id AS id FROM credit c JOIN entity e ON e.id=c.contributor_id
       WHERE c.role='composer' AND e.deleted_at IS NULL`,
    )
    .all()) {
    const name = resolvedName(catalogue, id, "name");
    if (typeof name === "string" && words(name)) names.add(words(name));
  }
  return names;
}

function existingIdentity(catalogue, recordKind, recordId) {
  return catalogue.db
    .prepare(
      `SELECT x.entity_id FROM external_identity x JOIN entity e ON e.id=x.entity_id
       WHERE x.provider='embedded-tags' AND x.record_kind=? AND x.record_id=?
       AND x.state='active' AND e.deleted_at IS NULL`,
    )
    .get(recordKind, recordId)?.entity_id;
}

// Identity keys shared across albums. Album placement never changes which
// work a performance realizes, so two albums of the same work share it.
const words = (value) =>
  normalized(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const CATALOGUE =
  /\b(op|opus|bwv|kv|k|d|hob|rv|woo|hwv|sz|twv|bb)\s*((?:[ivxlc]+\s+)?\d+[a-z]?)(?:\s+(?:no|nr|n)\s*(\d+))?\b/;
const KEY_PHRASE =
  /\bin\s+[a-h](?:\s*(?:flat|sharp|b|#))?(?:\s+(?:major|minor|dur|moll))?\b/g;
// The catalogue number a work's identity rests on, or "" without one.
export function catalogueSubject(title) {
  // "Op. 27/2" is "Op. 27 No. 2", not op. 27; "Op. 2/3" too. A second
  // number above both is a range ("Op. 30/31").
  const slashed = String(title || "").match(/\bop(?:us|\.)?\s*(\d+[a-z]?)\s*\/\s*(\d+)\b(?![a-z])/i);
  if (slashed && (Number(slashed[2]) < Number.parseInt(slashed[1], 10) || Number(slashed[2]) <= 12)) return `cat:op:${slashed[1].toLowerCase()}:${slashed[2]}`;
  const cat = words(title).match(CATALOGUE);
  if (cat)
    return `cat:${cat[1] === "opus" ? "op" : cat[1] === "kv" ? "k" : cat[1]}:${cat[2].replace(/\s+/g, "")}${cat[3] ? `:${cat[3]}` : ""}`;
  // Systems the word form can't tell from ordinary words ("S. 161", "L. 109")
  // come from the catalogue reader, which needs their punctuation.
  // The piece within it is part of the identity, as "op 10 no 3" is: Liszt's
  // "S164e No. 1" and "S164e No. 2" are two album leaves.
  const number = catalogueNumber(title).toLowerCase();
  const piece = number ? cataloguePiece(title) : "";
  return number ? `cat:${number.replace(/\s+/g, ":")}${piece ? `:${piece}` : ""}` : "";
}
// Before 1.0.23 the systems read by `catalogueNumber` alone kept only the
// digits: S172a and S172b were S172.
function legacyCatalogueSubject(title) {
  if (words(title).match(CATALOGUE)) return catalogueSubject(title);
  const [system, number = ""] = catalogueNumber(title).toLowerCase().split(" ");
  return system ? `cat:${system}:${number.match(/^\d+/)?.[0] ?? number}` : "";
}
const keyOf = (subjectOf) => (title, composers) =>
  JSON.stringify([
    [...new Set(composers.map(words))].filter(Boolean).sort(),
    subjectOf(title) || `title:${words(title).replace(KEY_PHRASE, " ").replace(/\s+/g, " ").trim()}`,
  ]);
export const workKey = keyOf(catalogueSubject);
const legacyWorkKey = keyOf(legacyCatalogueSubject);

const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100 };
function romanValue(value) {
  let total = 0;
  for (let i = 0; i < value.length; i++) {
    const n = ROMAN[value[i]],
      next = ROMAN[value[i + 1]] || 0;
    if (!n) return null;
    total += n < next ? -n : n;
  }
  return total || null;
}
// "II. Andante con moto" -> { index: 2, text: "andante con moto" }
export function movementParts(title) {
  const text = words(title);
  // "I. Allegro", a set's "No. 6 in B minor", and a part of a movement
  // ("XVIa. Valse allemande") only with its punctuation, so "La Mer" is no
  // fiftieth movement.
  const part = clean(title).match(/^([ivxlc]+|\d+)[a-d][.)]\s+(.*)$/i);
  const match = part ? [part[0], part[1].toLowerCase(), words(part[2])] : text.match(/^(no\s+)?((?:[ivxlc]+)|\d+)\s+(.*)$/)?.filter((_, i) => i !== 1);
  if (!match) return { index: null, text };
  const index = /^\d+$/.test(match[1])
    ? Number(match[1])
    : romanValue(match[1]);
  // "No. 2" numbers a piece of a set, not a movement: it lines up only with
  // pieces numbered the same way.
  const piece = !part && /^no\s/.test(text);
  return index ? { index, text: match[2], ...(piece && { piece: true }) } : { index: null, text };
}
// The movement part of a structured track title or WORK tag.
export function movementTitle(track, workTitle) {
  // The track title usually spells the movement out in full; a WORK tag
  // holds MusicBrainz's shorter name, so it is the fallback.
  const fromTitle = stripWorkPrefix(clean(track.title), workTitle);
  if (fromTitle !== clean(track.title) || MOVEMENT_PREFIX.test(fromTitle)) return fromTitle;
  const work = clean(track.work);
  if (work.includes(":")) {
    const tail = clean(work.slice(work.indexOf(":") + 1));
    if (tail) return stripWorkPrefix(tail, workTitle);
  }
  return fromTitle;
}

const SEPARATOR = /[:;]\s*|\s+[–—-]\s+/g;
const NICKNAME = /^["“„«'‘][^"”»'’]+["”»'’]\s*(?:[:;]|\s[–—-])\s*(.+)$/;
// "Piano Sonata No. 29, Op. 106 - "Hammerklavier": Allegro" -> "Allegro".
// A head names the work when it matches its words or catalogue number.
export function stripWorkPrefix(title, workTitle, depth = 0) {
  const stripped = stripWorkPrefixOnce(title, workTitle);
  // Some stores repeat the work: "Variations on a Theme of Chopin, Op. 22 :
  // Rachmaninoff: Variations on a Theme of Chopin, Op. 22: Theme".
  const again = stripWorkPrefixOnce(withoutRepeatedComposer(stripped, workTitle), workTitle);
  return depth < 2 && again !== stripped && words(stripped).includes(words(workTitle)) ? stripWorkPrefix(again, workTitle, depth + 1) : stripped;
}
// "Rachmaninoff: <the work>: …": a name before the work's own name.
const withoutRepeatedComposer = (text, workTitle) => {
  const match = clean(text).match(/^([^:]{2,60}):\s+(\S.*)$/);
  return match && words(match[2]).startsWith(words(workTitle)) && words(match[1]).split(" ").length <= 3 ? match[2] : text;
};
function stripWorkPrefixOnce(title, workTitle) {
  const text = clean(title);
  const separators = [...text.matchAll(SEPARATOR)];
  const tailAt = (match) => clean(text.slice(match.index + match[0].length));
  // A numbered movement starts the movement part: "…: I. Allegro".
  for (const match of separators) {
    const tail = tailAt(match);
    if (tail && MOVEMENT_PREFIX.test(tail)) return tail;
  }
  const workWords = words(workTitle);
  const workCatalogue = catalogueNumber(workTitle).toLowerCase();
  // "Winterreise, D. 911, II. Die Wetterfahne" under "Winterreise, D. 911".
  const comma = splitTitle(text);
  if (comma.head && text.startsWith(`${comma.head},`) &&
    ((workWords && words(comma.head) === workWords) || (workCatalogue && catalogueNumber(comma.head).toLowerCase() === workCatalogue)))
    return comma.tail;
  // "Iberia, T. 105 / Book 4" names "Iberia, B. 47": same name before the comma.
  const workName = words(String(workTitle).split(",")[0]);
  for (const match of separators) {
    const head = text.slice(0, match.index);
    const tail = tailAt(match);
    const headWords = words(head);
    const namesWork =
      (workWords && (headWords === workWords || headWords.startsWith(`${workWords} `) || workWords.startsWith(`${headWords} `))) ||
      (workCatalogue && catalogueNumber(head).toLowerCase() === workCatalogue) ||
      (workName.length >= 4 && words(head.split(",")[0]) === workName);
    if (!tail || !namesWork) continue;
    return clean(tail.match(NICKNAME)?.[1] ?? tail);
  }
  // A numbered piece of a set, named in full: "24 Préludes, op. 28 no. 6 in
  // B minor" under "24 Préludes, op. 28" reads "No. 6 in B minor".
  const set = clean(workTitle);
  // Only a set named in the plural: "Metamorphosis No. 1" is its own name.
  const rest =
    set && NUMBERED_SET.test(set) && normalized(text).startsWith(normalized(set))
      ? text.slice(set.length).match(/^[,\s]+(no\.?\s*\d+\b.*)$/i)
      : null;
  if (rest) return rest[1].charAt(0).toUpperCase() + rest[1].slice(1);
  return text;
}

function resolvedName(catalogue, id, field) {
  const row = catalogue.db
    .prepare(
      `SELECT a.value FROM field_resolution f JOIN assertion a ON a.id=f.assertion_id
       WHERE f.target_id=? AND f.field=?`,
    )
    .get(id, field);
  return row ? JSON.parse(row.value) : null;
}
function composerNames(catalogue, work) {
  return catalogue.db
    .prepare(
      `SELECT c.contributor_id AS id FROM credit c JOIN entity e ON e.id=c.contributor_id
       WHERE c.target_id=? AND c.role='composer' AND e.deleted_at IS NULL ORDER BY c.position`,
    )
    .all(work)
    .map((row) => resolvedName(catalogue, row.id, "name"))
    .filter((name) => typeof name === "string" && name.trim());
}

// Live works an admin is probably about to duplicate: the same title or
// catalogue number under the same composers (any composer when none is given).
export function similarWorks(catalogue, title, composers = []) {
  const subject = (key) => JSON.parse(key)[1];
  const wanted = workKey(title, composers);
  const named = composers.map(words).filter(Boolean).length > 0;
  const people = (key) => JSON.parse(key)[0].join("|");
  // The title with its key and catalogue number dropped, so "Symphony No.5"
  // and "Symphony No. 5 in C minor, Op. 67" read alike.
  const bare = (text) =>
    words(text).replace(KEY_PHRASE, " ").replace(new RegExp(CATALOGUE.source, "g"), " ").replace(/\s+/g, " ").trim();
  return catalogue.db
    .prepare("SELECT id FROM entity WHERE kind='work' AND deleted_at IS NULL ORDER BY created_at,id")
    .all()
    .map((row) => row.id)
    .filter((id) => {
      const existing = resolvedName(catalogue, id, "title");
      if (typeof existing !== "string" || !existing.trim()) return false;
      const key = workKey(existing, composerNames(catalogue, id));
      if (named && people(key) !== people(wanted)) return false;
      if (named ? key === wanted : subject(key) === subject(wanted)) return true;
      return bare(existing) !== "" && bare(existing) === bare(title);
    });
}

// Index existing works and composers once per pass, so manual works the admin
// created also absorb matching albums.
export function catalogueIndex(catalogue) {
  const works = new Map(),
    aliases = new Map(),
    people = new Map();
  for (const { id } of catalogue.db
    .prepare("SELECT id FROM entity WHERE kind='work' AND deleted_at IS NULL")
    .all()) {
    const title = resolvedName(catalogue, id, "title");
    const composers = composerNames(catalogue, id);
    if (typeof title !== "string" || !composers.length) continue;
    const key = workKey(title, composers);
    works.set(key, [...(works.get(key) || []), id]);
    // Other names of the work (MusicBrainz aliases), for lookups only.
    const other = resolvedName(catalogue, id, "aliases");
    for (const alias of Array.isArray(other) ? other : []) {
      const aliasKey = workKey(String(alias), composers);
      if (aliasKey !== key) aliases.set(aliasKey, [...new Set([...(aliases.get(aliasKey) || []), id])]);
    }
  }
  for (const { id } of catalogue.db
    .prepare(
      `SELECT id FROM entity WHERE kind='person' AND deleted_at IS NULL
       AND (json_extract(data,'$.roles') LIKE '%composer%'
         OR EXISTS(SELECT 1 FROM credit WHERE contributor_id=entity.id AND role='composer'))
       ORDER BY created_at,id`,
    )
    .all()) {
    const name = resolvedName(catalogue, id, "name");
    if (typeof name !== "string" || !words(name)) continue;
    people.set(words(name), [...(people.get(words(name)) || []), id]);
  }
  return { works, aliases, people };
}

const artistIdOf = (catalogue, person) =>
  catalogue.db
    .prepare("SELECT record_id FROM external_identity WHERE entity_id=? AND provider='musicbrainz' AND record_kind='artist' AND state='active'")
    .get(person)?.record_id;
function composerEntity(catalogue, metadata, index, name, mbid = null) {
  const key = words(name);
  if (mbid) {
    // A verified MusicBrainz composer wins over any name match.
    const known = catalogue.db
      .prepare(
        `SELECT x.entity_id FROM external_identity x JOIN entity e ON e.id=x.entity_id
         WHERE x.provider='musicbrainz' AND x.record_kind='artist' AND x.record_id=? AND x.state='active' AND e.deleted_at IS NULL`,
      )
      .get(mbid)?.entity_id;
    if (known) return known;
    // The one person with this name gains the ID, unless they carry another.
    const sameName = index.people.get(key) || [];
    const named = sameName.filter((id) => !artistIdOf(catalogue, id));
    const person = named.length === 1 ? named[0] : catalogue.createEntity("person", { roles: ["composer"] });
    if (person !== named[0]) {
      metadata.derived(person, "name", name);
      index.people.set(key, [...sameName, person]);
    }
    catalogue.externalIdentity(person, "musicbrainz", "artist", mbid, { evidence: { source: "work-composer" } });
    return person;
  }
  const existing = index.people.get(key) || [];
  // Reuse a composer only when exactly one person has this name; two
  // same-named composers stay separate until an admin resolves them.
  if (existing.length === 1) return existing[0];
  const person = catalogue.createEntity("person", { roles: ["composer"] });
  metadata.derived(person, "name", name);
  if (existing.length > 1)
    catalogue.review("identity", person, { reason: "same-name-composers", name });
  index.people.set(key, [...existing, person]);
  return person;
}

export function workMovements(catalogue, work) {
  return catalogue.db
    .prepare(
      `SELECT r.target_id AS id,r.position FROM relation r JOIN entity e ON e.id=r.target_id
       WHERE r.kind='movement' AND r.source_id=? AND e.deleted_at IS NULL ORDER BY r.position`,
    )
    .all(work)
    .map((row) => {
      const title = resolvedName(catalogue, row.id, "title") || "";
      return { ...row, title, ...movementParts(title) };
    });
}

// The number of a piece within its set, when the title gives one: "No. 3.
// Allegro vivace", "Allegro agitato in C minor, no. 1", or the set's own
// catalogue number with the piece after it ("Prelude, Op. 32, No. 3" in
// "13 Preludes, op. 32"). Null for an ordinary "II. Andante".
function pieceNumber(title, setSubject) {
  const parts = movementParts(title);
  if (parts.piece) return parts.index;
  const trailing = clean(title).match(/(?:^|[\s,])(?:no\.?|nr\.?|n°)\s*(\d+)\s*$/i);
  if (trailing) return Number(trailing[1]);
  const subject = catalogueSubject(title);
  if (setSubject && subject.startsWith(`${setSubject}:`)) {
    const rest = subject.slice(setSubject.length + 1);
    if (/^\d+$/.test(rest)) return Number(rest);
  }
  return null;
}
// A movement's number as a piece of its set: its own piece number, or, in a
// set whose movements are numbered "IV. Sonetto 47", that number.
const movementPiece = (movement, setSubject) => pieceNumber(movement.title || "", setSubject) ?? movement.index ?? null;

// Two names that differ only by an abbreviation written with a full stop:
// "Dr. Gradus ad Parnassum" and "Doctor Gradus ad Parnassum". Every other
// word is the same, and the short form keeps the long one's first and last
// letters, in order ("Dr." for Doctor, "St." for Saint).
function abbreviates(short, long) {
  if (short.length < 2 || short.length >= long.length || short[0] !== long[0] || short.at(-1) !== long.at(-1)) return false;
  let at = 0;
  for (const letter of long) if (letter === short[at]) at++;
  return at === short.length;
}
function sameNameAbbreviated(a, b) {
  const tokens = (text) =>
    normalized(text)
      .replace(/^(?:[ivxlc]+|\d+)[.)]\s+/, "")
      .replace(/[^\p{L}\p{N}.]+/gu, " ")
      .trim()
      .split(" ")
      .filter(Boolean);
  const [x, y] = [tokens(a), tokens(b)];
  if (!x.length || x.length !== y.length) return false;
  let abbreviated = 0;
  for (let i = 0; i < x.length; i++) {
    const [p, q] = [x[i].replace(/\.$/, ""), y[i].replace(/\.$/, "")];
    if (p === q) continue;
    const shortened = x[i].endsWith(".") ? abbreviates(p, q) : y[i].endsWith(".") ? abbreviates(q, p) : false;
    if (!shortened) return false;
    abbreviated++;
  }
  return abbreviated > 0;
}

// A track's movement on a work, from its name, its abbreviated name or its
// number as a piece of the set. Null unless exactly one movement fits.
function namedMovement(movements, title, used, setSubject) {
  const text = movementParts(title).text;
  const free = movements.filter((m) => !used.has(m.id));
  let found = free.filter((m) => m.text && m.text === text);
  if (found.length !== 1) found = free.filter((m) => m.title && sameNameAbbreviated(m.title, title));
  if (found.length !== 1) {
    const piece = pieceNumber(title, setSubject);
    found = piece == null ? [] : free.filter((m) => movementPiece(m, setSubject) === piece);
  }
  return found.length === 1 ? found[0] : null;
}

// A movement that names several sections ("Theme: L'istesso tempo / II.
// L'istesso tempo / III. L'istesso tempo", from an album that gave them one
// track) and an album that gives each section, or a run of them, its own
// track. Sections compare by their words, with "Variation No. 2", "Var. 2."
// and "II." alike as variation two and Tema, Thema and Theme alike.
function sectionWords(text) {
  const out = [];
  for (const section of clean(text).split(/\s+\/\s+/)) {
    let value = words(section)
      .replace(/^(?:var(?:iation|iazione)?s?|variazioni)\s+(?:(?:no|nr|n)\s+)?/, "")
      .replace(/\b(?:var(?:iation)?|variazione)\s+(?:(?:no|nr|n)\s+)?(?=\d)/g, "")
      .replace(/\b(?:tema|thema)\b/g, "theme");
    const roman = value.match(/^([ivxlc]+)\s+(.*)$/);
    if (roman && romanValue(roman[1])) value = `${romanValue(roman[1])} ${roman[2]}`;
    out.push(value.trim());
  }
  return out.join(" ");
}
function mapBySections(movements, tracks) {
  if (!movements.some((m) => / \/ /.test(m.title || ""))) return null;
  const sections = movements.map((m) => clean(m.title).split(/\s+\/\s+/).map(sectionWords));
  const result = [];
  let at = 0,
    offset = 0;
  for (const track of tracks) {
    const wanted = sectionWords(track.movementTitle);
    let hit = null;
    // The next sections in order, within one movement; earlier sections an
    // album leaves out are skipped, never revisited.
    for (let m = at; m < movements.length && !hit; m++)
      for (let from = m === at ? offset : 0; from < sections[m].length && !hit; from++)
        for (let to = from + 1; to <= sections[m].length; to++)
          if (sections[m].slice(from, to).join(" ") === wanted) {
            hit = { m, to };
            break;
          }
    if (!hit) return null;
    result.push(movements[hit.m].id);
    [at, offset] = hit.to === sections[hit.m].length ? [hit.m + 1, 0] : [hit.m, hit.to];
  }
  return result;
}

// Map an album's tracks to an existing work's movements: by title, then by
// numbered prefix, then by order when the counts agree. Null when unsure.
// `setSubject` is the work's catalogue identity, for pieces numbered within it.
export function mapToMovements(movements, tracks, { setSubject = "" } = {}) {
  const used = new Set(),
    result = [];
  const firstWord = (text) => text.split(" ")[0];
  let previous = null;
  for (const track of tracks) {
    const parts = movementParts(track.movementTitle);
    // A movement split over two tracks ("IV. Presto", then "IV. O Freunde…")
    // is one movement in both.
    if (previous && parts.index && parts.index === previous.index) {
      result.push(previous.id);
      continue;
    }
    let found = movements.filter(
      (m) => !used.has(m.id) && m.text && m.text === parts.text,
    );
    // A piece numbered within its set ("No. 3", "Op. 32, No. 3") or an
    // abbreviated name ("Dr. Gradus").
    if (found.length !== 1) {
      const named = namedMovement(movements, track.movementTitle, used, setSubject);
      if (named) found = [named];
    }
    if (found.length !== 1 && parts.index)
      found = movements.filter(
        (m) =>
          !used.has(m.id) &&
          Boolean(m.piece) === Boolean(parts.piece) &&
          (parts.piece ? m.index : (m.index ?? m.position)) === parts.index,
      );
    // A number gives way only to a name the work holds elsewhere: an
    // arrangement's "2. Gavotte" is the partita's "Gavotte en rondeau", not
    // its "II. Loure". A different tempo ("III. Scherzo" for "III. Allegro")
    // is still the third movement.
    if (
      found.length === 1 &&
      found[0].text &&
      parts.text &&
      firstWord(found[0].text) !== firstWord(parts.text) &&
      movements.some((m) => m.id !== found[0].id && m.text && firstWord(m.text) === firstWord(parts.text))
    )
      found = [];
    if (found.length !== 1) {
      result.push(null);
      previous = null;
      continue;
    }
    used.add(found[0].id);
    result.push(found[0].id);
    previous = { id: found[0].id, index: parts.index };
  }
  if (result.every(Boolean)) return result;
  if (movements.length === tracks.length) return movements.map((m) => m.id);
  return mapBySections(movements, tracks);
}

const albumOrder = (a, b) =>
  a.discNumber - b.discNumber || a.trackNumber - b.trackNumber || a.id.localeCompare(b.id);

// Moves rows at or after `from` up one, through a gap, so unique positions
// never collide mid-update.
function shiftUp(catalogue, table, column, where, args, from) {
  catalogue.db
    .prepare(`UPDATE ${table} SET ${column}=${column}+1000000 WHERE ${where} AND ${column}>=?`)
    .run(...args, from);
  catalogue.db
    .prepare(`UPDATE ${table} SET ${column}=${column}-999999 WHERE ${where} AND ${column}>=1000000`)
    .run(...args);
}

// A work this album already has gains the album's other tracks of it, such
// as a theme or intermezzo an earlier pass left out. Each new movement goes
// right after the movement of the track before it on the album.
// A movement's own composers beyond the work's, such as Süßmayr on the
// Lacrimosa, stay on that movement's recording.
function creditMovementComposers(catalogue, metadata, index, recording, track, group) {
  const work = new Set(group.composers.map(normalized));
  (track.composers || [])
    .filter((name) => !work.has(normalized(name)))
    .forEach((name, i) => {
      const person = composerEntity(catalogue, metadata, index, name, group.composerIds?.[name]);
      if (!catalogue.db.prepare("SELECT 1 FROM credit WHERE target_id=? AND contributor_id=? AND role='composer'").get(recording, person))
        catalogue.credit(recording, person, "composer", { position: i + 1 });
    });
}

function extendRealization(catalogue, group, actor, people) {
  const attached = group.tracks.filter((track) => track.attached);
  const found = catalogue.db
    .prepare(
      `SELECT DISTINCT i.realization_id AS id,r.work_id,r.performance_work_id FROM realization_item i
       JOIN segment s ON s.id=i.segment_id JOIN realization r ON r.id=i.realization_id
       WHERE s.track_link_id IN (${attached.map(() => "?").join(",")})`,
    )
    .all(...attached.map((track) => track.id));
  if (found.length !== 1) return false;
  const [realization] = found;
  const metadata = new Metadata(catalogue);
  return transaction(catalogue.db, () => {
    const workTitle = resolvedName(catalogue, realization.work_id, "title") || group.work;
    const performance = catalogue.db
      .prepare("SELECT source_id FROM relation WHERE id=?")
      .get(realization.performance_work_id).source_id;
    const itemOf = catalogue.db.prepare(
      `SELECT i.movement_id,i.sequence FROM realization_item i JOIN segment s ON s.id=i.segment_id
       WHERE i.realization_id=? AND s.track_link_id=?`,
    );
    const ordered = [...group.tracks].sort(albumOrder);
    let added = 0;
    const held = new Set(
      catalogue.db.prepare("SELECT movement_id FROM realization_item WHERE realization_id=?").all(realization.id).map((row) => row.movement_id),
    );
    for (const [index, track] of ordered.entries()) {
      if (track.attached) continue;
      const before = ordered
        .slice(0, index)
        .reverse()
        .map((other) => itemOf.get(realization.id, other.id))
        .find(Boolean);
      const named = movementTitle({ title: track.parsedTitle, work: track.evidence.hints?.work }, workTitle);
      // A movement the work has and this recording lacks ("Missing I.
      // Allegro vivace") takes the track when their names agree; the number
      // alone only settles which of two same-named movements it is.
      const parts = movementParts(named);
      const sameName = workMovements(catalogue, realization.work_id).filter((m) => !held.has(m.id) && parts.text && m.text === parts.text);
      const existing = sameName.length === 1 ? sameName[0] : sameName.find((m) => parts.index && (m.index ?? m.position) === parts.index);
      let movement = existing?.id;
      if (!movement) {
        const position = before?.movement_id
          ? catalogue.db
              .prepare("SELECT position FROM relation WHERE kind='movement' AND source_id=? AND target_id=?")
              .get(realization.work_id, before.movement_id).position + 1
          : 1;
        shiftUp(catalogue, "relation", "position", "kind='movement' AND source_id=?", [realization.work_id], position);
        movement = catalogue.createEntity("movement");
        metadata.derived(movement, "title", named || `Movement ${position}`);
        catalogue.relate("movement", realization.work_id, movement, { position });
      }
      held.add(movement);
      const sequence = (before?.sequence || 0) + 1;
      shiftUp(catalogue, "realization_item", "sequence", "realization_id=?", [realization.id], sequence);
      const recording = catalogue.createEntity("recording", { durationMs: track.evidence.durationMs });
      metadata.derived(recording, "title", track.title);
      creditMovementComposers(catalogue, metadata, people, recording, track, group);
      catalogue.relate("recording_performance", recording, performance);
      const content = catalogue.recordingContent(recording, realization.performance_work_id, { movement });
      const segment = catalogue.segment(track.id, { kind: "whole" });
      catalogue.segmentContent(segment, content);
      catalogue.realizationItem(realization.id, segment, { movement, sequence });
      track.attached = 1;
      added++;
    }
    catalogue.audit(
      "work.auto_match_extend",
      realization.work_id,
      { albumId: group.albumId, added, tracks: ordered.map((track) => track.id) },
      actor,
    );
    return added > 0;
  });
}

// The editor's latest word on this album and work, from its audit trail:
// Unassign holds until the admin assigns the album to the work again.
function unassignedByAdmin(catalogue, work, albumId) {
  return (
    catalogue.db
      .prepare(
        `SELECT action FROM audit_event WHERE target_id=? AND action IN ('editor.unassign-album','editor.assign-album')
         AND CAST(json_extract(data,'$.values.albumId') AS TEXT)=? ORDER BY id DESC LIMIT 1`,
      )
      .get(work, String(albumId))?.action === "editor.unassign-album"
  );
}

// This album made this piece under its 1.0.22 key, whose catalogue number
// had lost its suffix, and its tracks were taken out since. That holds only
// when the work it made has this exact number: one made under a sibling
// number ("Klavierstück, S189" for S189a) was the false join being undone.
function madeBeforeSuffixes(catalogue, group) {
  if (!group.legacyKey) return false;
  const made = existingIdentity(catalogue, "album-work", identity("album-work", group.legacyKey));
  if (!made) return false;
  const title = resolvedName(catalogue, made, "title");
  const wanted = group.catalogue ? `${group.work}, ${group.catalogue}` : group.work;
  return typeof title === "string" && catalogueSubject(title) === catalogueSubject(wanted);
}

function createGroup(catalogue, group, actor, index) {
  // A composer read from the artist field with nothing to back it up: an
  // admin confirms before any work is made.
  if (group.composerSource?.confidence === "medium") {
    const tracks = [...group.tracks].sort(albumOrder);
    catalogue.review("auto_match", tracks[0].id, {
      reason: "uncertain-composer",
      composers: group.composers,
      work: group.work,
      source: "artist field",
      albumId: group.albumId,
      tracks: tracks.map((t) => t.id),
    });
    return false;
  }
  if (group.tracks.some((track) => track.attached))
    return extendRealization(catalogue, group, actor, index);
  const metadata = new Metadata(catalogue);
  const recordId = identity("album-work", group.key);
  if (existingIdentity(catalogue, "album-work", recordId)) return false;
  if (madeBeforeSuffixes(catalogue, group)) return false;
  return transaction(catalogue.db, () => {
    const ordered = group.tracks
      .sort(
        (a, b) =>
          a.discNumber - b.discNumber ||
          a.trackNumber - b.trackNumber ||
          a.id.localeCompare(b.id),
      )
      .map((track) => ({
        ...track,
        movementTitle: fullerTitle(
          movementTitle({ title: track.parsedTitle, work: track.evidence.hints?.work }, group.work),
          track.providerMovement ? stripWorkPrefix(track.providerMovement, group.work) : null,
        ),
      }));
    const key = group.providerWorkId
      ? JSON.stringify(["musicbrainz", group.providerWorkId])
      : workKey(group.work, group.composers);
    let providerWork =
      group.providerWorkId &&
      catalogue.db
        .prepare(
          `SELECT x.entity_id FROM external_identity x JOIN entity e ON e.id=x.entity_id
           WHERE x.provider='musicbrainz' AND x.record_kind='work' AND x.record_id=?
           AND x.state='active' AND e.deleted_at IS NULL`,
        )
        .get(group.providerWorkId)?.entity_id;
    // An old merge across sibling numbers left this MusicBrainz work on
    // another piece's work: the tags' number says which piece this is, and
    // the identity conflict goes to review.
    if (
      providerWork &&
      group.localTitle &&
      provablyDifferent(catalogueSubject(group.localTitle), catalogueSubject(String(resolvedName(catalogue, providerWork, "title") || "")))
    )
      providerWork = null;
    // A same-titled work by a same-named but differently verified composer
    // is someone else's work.
    const otherComposer = (id) =>
      catalogue.db
        .prepare("SELECT contributor_id FROM credit WHERE target_id=? AND role='composer'")
        .all(id)
        .some(({ contributor_id: person }) => {
          const mbid = group.composerIds?.[resolvedName(catalogue, person, "name")];
          const held = artistIdOf(catalogue, person);
          return mbid && held && held !== mbid;
        });
    // An unrecorded MusicBrainz work can still be one the tags already made:
    // look it up under the tags' title and MusicBrainz's aliases too.
    // A set named by WORK is found by its catalogue number alone, so another
    // book under the same name ("Années de pèlerinage") stays apart.
    const catalogued = group.catalogue && `${group.work}, ${group.catalogue}`;
    const titles = catalogued
      ? [catalogued]
      : [
          group.work,
          ...(group.providerWorkId ? [group.localTitle, ...(group.providerAliases || [])] : []),
        ].filter(Boolean);
    const known = providerWork
      ? [providerWork]
      : [
          ...new Set(
            titles.flatMap((title) => {
              const key = workKey(title, group.composers);
              return [...(index.works.get(key) || []), ...(index.aliases?.get(key) || [])];
            }),
          ),
        ].filter(
          (id) =>
            !otherComposer(id) &&
            // A work already tied to a different MusicBrainz work is another piece.
            !(group.providerWorkId &&
              catalogue.db
                .prepare("SELECT 1 FROM external_identity WHERE entity_id=? AND provider='musicbrainz' AND record_kind='work' AND state='active' AND record_id!=?")
                .get(id, group.providerWorkId)),
        );
    // Several works fit: an admin picks one. Creating another would only add
    // a third copy for the next album to land on.
    if (known.length > 1) {
      catalogue.review("auto_match", ordered[0].id, {
        reason: "ambiguous-work",
        candidates: known,
        albumId: group.albumId,
        tracks: ordered.map((t) => t.id),
      });
      return false;
    }
    let work = known.length === 1 ? known[0] : null;
    let movements = null;
    // An admin took this album out of this work; a rescan must not put it back.
    if (work && unassignedByAdmin(catalogue, work, group.albumId)) return false;
    if (work) {
      const existing = workMovements(catalogue, work);
      const setSubject = catalogueSubject(String(resolvedName(catalogue, work, "title") || "")) || catalogueSubject(catalogued || group.work);
      movements = existing.length
        ? mapToMovements(existing, ordered, { setSubject })
        : null;
      // A work an earlier album made from part of a piece takes the rest
      // from this fuller album.
      if (!movements && existing.length) movements = expandIncompleteWork(catalogue, metadata, work, existing, ordered, setSubject, group, actor);
      if (!movements && existing.length) {
        // Same work, but the album's movements can't be mapped safely.
        catalogue.review("auto_match", ordered[0].id, {
          reason: "movement-mismatch",
          work,
          albumId: group.albumId,
          tracks: ordered.map((t) => t.id),
        });
        return false;
      }
      // Record the identity on the work the tags made, so tag and MusicBrainz
      // matches of this piece keep landing on one work.
      if (group.providerWorkId) catalogue.externalIdentity(work, "musicbrainz", "work", group.providerWorkId, { evidence: { source: "parent-work" } });
    } else {
      // Same for a composer name several people share.
      const ambiguous = group.composers.filter((name) => {
        const sameName = index.people.get(words(name)) || [];
        const mbid = group.composerIds?.[name];
        if (!mbid) return sameName.length > 1;
        // A verified ID settles it when someone holds it, or when at most one
        // same-named person could still be them (no other ID).
        if (sameName.some((id) => artistIdOf(catalogue, id) === mbid)) return false;
        return sameName.filter((id) => !artistIdOf(catalogue, id)).length > 1;
      });
      if (ambiguous.length) {
        catalogue.review("auto_match", ordered[0].id, {
          reason: "ambiguous-composer",
          composers: ambiguous,
          candidates: ambiguous.flatMap((name) => index.people.get(words(name))),
          albumId: group.albumId,
          tracks: ordered.map((t) => t.id),
        });
        return false;
      }
      work = catalogue.createEntity("work");
      metadata.derived(work, "title", group.work);
      group.composers.forEach((name, i) =>
        catalogue.credit(
          work,
          composerEntity(catalogue, metadata, index, name, group.composerIds?.[name]),
          "composer",
          { position: i + 1 },
        ),
      );
      if (group.providerAliases?.length)
        metadata.derived(work, "aliases", group.providerAliases);
      else if (catalogued) {
        metadata.derived(work, "aliases", [catalogued]);
        index.aliases.set(workKey(catalogued, group.composers), [work]);
      }
      if (group.providerWorkId)
        catalogue.externalIdentity(
          work,
          "musicbrainz",
          "work",
          group.providerWorkId,
          { evidence: { source: "parent-work" } },
        );
      if (!catalogued) index.works.set(workKey(group.work, group.composers), [work]);
    }
    // A whole piece has no movements; its one track realizes the work.
    if (group.standalone && !workMovements(catalogue, work).length) movements = [null];
    if (!movements)
      movements = ordered.map((track, i) => {
        const movement = catalogue.createEntity("movement");
        metadata.derived(movement, "title", track.movementTitle || `Movement ${i + 1}`);
        metadata.derived(movement, "movementNumber", String(i + 1));
        catalogue.relate("movement", work, movement, { position: i + 1 });
        return movement;
      });
    catalogue.externalIdentity(work, "embedded-tags", "album-work", recordId, {
      evidence: {
        albumId: group.albumId,
        work: group.work,
        composers: group.composers,
        providerWorkId: group.providerWorkId,
      },
    });
    const performance = catalogue.createEntity("performance");
    const performanceWork = catalogue.relate(
      "performance_work",
      performance,
      work,
    );
    const realization = catalogue.realization(
      work,
      performanceWork,
      group.album || null,
    );
    ordered.forEach((track, i) => {
      const movement = movements[i];
      const recording = catalogue.createEntity("recording", {
        durationMs: track.evidence.durationMs,
      });
      metadata.derived(recording, "title", track.title || track.movementTitle);
      creditMovementComposers(catalogue, metadata, index, recording, track, group);
      catalogue.relate("recording_performance", recording, performance);
      const content = catalogue.recordingContent(recording, performanceWork, {
        movement,
      });
      const segment = catalogue.segment(track.id, { kind: "whole" });
      catalogue.segmentContent(segment, content);
      catalogue.realizationItem(realization, segment, {
        movement,
        sequence: i + 1,
        // A movement split over two tracks is its first and second part.
        occurrence: movement ? movements.slice(0, i).filter((id) => id === movement).length + 1 : 1,
      });
    });
    catalogue.audit(
      "work.auto_match",
      work,
      {
        rule: "classical-grouping-v2",
        evidence: group.evidence,
        albumId: group.albumId,
        reused: known.length === 1,
        tracks: ordered.map((track) => track.id),
      },
      actor,
    );
    return true;
  });
}

// An auto-made work holding only part of a piece (two of Debussy's six
// Children's Corner pieces, two of nine Études-tableaux) takes a fuller
// album's movements. Only when nobody edited the work or its movements,
// every movement it has is on this album, by name, abbreviated name or
// piece number, once each and in the album's order, and every other track
// names its movement. The work's movements then follow the album; the
// movements it had keep their recordings. Null when any of that fails.
function expandIncompleteWork(catalogue, metadata, work, existing, ordered, setSubject, group, actor) {
  if (ordered.length <= existing.length) return null;
  const ids = [work, ...existing.map((m) => m.id)];
  const madeByMatching = catalogue.db.prepare("SELECT 1 FROM external_identity WHERE entity_id=? AND record_kind='album-work'").get(work);
  const edited = catalogue.db
    .prepare(`SELECT 1 FROM audit_event WHERE action LIKE 'editor.%' AND target_id IN (${ids.map(() => "?").join(",")}) LIMIT 1`)
    .get(...ids);
  if (!madeByMatching || edited || hasManualEdits(catalogue, ids)) return null;
  const used = new Set();
  const mapped = ordered.map((track) => {
    const movement = namedMovement(existing, track.movementTitle, used, setSubject);
    if (movement) used.add(movement.id);
    return movement;
  });
  if (used.size !== existing.length) return null;
  const positions = mapped.filter(Boolean).map((m) => m.position);
  if (positions.some((position, i) => i && position < positions[i - 1])) return null;
  // A new track must name its movement, and not a number the work holds.
  const held = new Set(existing.map((m) => movementPiece(m, setSubject)).filter((n) => n != null));
  for (const [i, track] of ordered.entries()) {
    if (mapped[i]) continue;
    const name = movementParts(track.movementTitle).text;
    const piece = pieceNumber(track.movementTitle, setSubject);
    if (!name || (piece != null && held.has(piece))) return null;
    // A track continuing a movement the work names in full ("IV. Fuga"
    // after "III. Adagio ma non troppo - Fuga") divides it, adds nothing.
    if (existing.some((m) => m.text && ` ${m.text} `.includes(` ${name} `))) return null;
  }
  // Renumber through a gap, so unique positions never collide.
  catalogue.db.prepare("UPDATE relation SET position=position+1000000 WHERE kind='movement' AND source_id=?").run(work);
  const result = ordered.map((track, i) => {
    const position = i + 1;
    let movement = mapped[i]?.id;
    if (movement) catalogue.db.prepare("UPDATE relation SET position=? WHERE kind='movement' AND source_id=? AND target_id=?").run(position, work, movement);
    else {
      movement = catalogue.createEntity("movement");
      metadata.derived(movement, "title", track.movementTitle);
      catalogue.relate("movement", work, movement, { position });
    }
    metadata.derived(movement, "movementNumber", String(position));
    return movement;
  });
  catalogue.audit("work.auto_match_expand", work, { albumId: group.albumId, from: existing.length, to: result.length, tracks: ordered.map((t) => t.id) }, actor);
  return result;
}

const hasManualEdits = (catalogue, ids) =>
  ids.some((id) =>
    catalogue.db
      .prepare(
        "SELECT 1 FROM assertion WHERE target_id=? AND source='manual' LIMIT 1",
      )
      .get(id),
  );

// Every provider identity of a merged-away entity now names the kept one, so
// later matching by MusicBrainz or tags finds the survivor, not a deleted row.
function transferIdentities(db, keep, drop) {
  for (const row of db.prepare("SELECT * FROM external_identity WHERE entity_id=?").all(drop)) {
    const same = db
      .prepare("SELECT state FROM external_identity WHERE entity_id=? AND provider=? AND record_kind=? AND record_id=?")
      .get(keep, row.provider, row.record_kind, row.record_id);
    if (same) {
      if (row.state === "active" && same.state !== "active")
        db.prepare("UPDATE external_identity SET state='active' WHERE entity_id=? AND provider=? AND record_kind=? AND record_id=?")
          .run(keep, row.provider, row.record_kind, row.record_id);
      db.prepare("DELETE FROM external_identity WHERE entity_id=? AND provider=? AND record_kind=? AND record_id=?")
        .run(drop, row.provider, row.record_kind, row.record_id);
    } else
      db.prepare("UPDATE external_identity SET entity_id=? WHERE entity_id=? AND provider=? AND record_kind=? AND record_id=?")
        .run(keep, drop, row.provider, row.record_kind, row.record_id);
  }
}

// Catalogues merged before identities moved with the merge: follow each
// deleted entity's merge record to its survivor and hand the identities over.
export function repairMergedIdentities(catalogue) {
  const db = catalogue.db;
  const intoOf = db.prepare(
    `SELECT json_extract(data,'$.into') AS into_id FROM audit_event
     WHERE action IN ('work.merge','person.merge') AND target_id=? ORDER BY id DESC LIMIT 1`,
  );
  const live = db.prepare("SELECT deleted_at FROM entity WHERE id=?");
  let repaired = 0;
  for (const { entity_id: drop } of db
    .prepare(
      `SELECT DISTINCT x.entity_id FROM external_identity x JOIN entity e ON e.id=x.entity_id
       WHERE e.deleted_at IS NOT NULL`,
    )
    .all()) {
    let keep = drop;
    for (let hops = 0; hops < 20 && keep && live.get(keep)?.deleted_at != null; hops++) keep = intoOf.get(keep)?.into_id;
    if (!keep || keep === drop || !live.get(keep) || live.get(keep).deleted_at != null) continue;
    transaction(db, () => transferIdentities(db, keep, drop));
    repaired++;
  }
  return repaired;
}

// Fold one person or ensemble into another: credits move, duplicates drop.
export function mergeContributor(catalogue, keep, drop, actor) {
  for (const credit of catalogue.db
    .prepare("SELECT * FROM credit WHERE contributor_id=?")
    .all(drop)) {
    const duplicate = catalogue.db
      .prepare(
        "SELECT 1 FROM credit WHERE target_id=? AND contributor_id=? AND role=? AND instrument IS ?",
      )
      .get(credit.target_id, keep, credit.role, credit.instrument);
    if (duplicate)
      catalogue.db.prepare("DELETE FROM credit WHERE id=?").run(credit.id);
    else
      catalogue.db
        .prepare("UPDATE credit SET contributor_id=? WHERE id=?")
        .run(keep, credit.id);
  }
  transferIdentities(catalogue.db, keep, drop);
  catalogue.db
    .prepare("UPDATE entity SET deleted_at=?,updated_at=? WHERE id=?")
    .run(Date.now(), Date.now(), drop);
  catalogue.audit("person.merge", drop, { into: keep }, actor);
}

// Merge composers that earlier auto-match passes created once per album.
function mergeDuplicateComposers(catalogue, index, actor) {
  let merged = 0;
  for (const [name, ids] of index.people) {
    if (ids.length < 2) continue;
    const auto = ids.filter(
      (id) =>
        !hasManualEdits(catalogue, [id]) &&
        !catalogue.db
          .prepare("SELECT 1 FROM external_identity WHERE entity_id=? AND provider!='embedded-tags'")
          .get(id),
    );
    // Keep the oldest (or the one with manual/provider identity) and fold auto copies in.
    const keep = ids.find((id) => !auto.includes(id)) || auto[0];
    const drop = auto.filter((id) => id !== keep);
    if (ids.filter((id) => !auto.includes(id)).length > 1) continue;
    for (const id of drop) {
      mergeContributor(catalogue, keep, id, actor);
      merged++;
    }
    index.people.set(name, [keep]);
  }
  return merged;
}

// Fold a duplicate auto-created work into another work with the same identity.
export function mergeWork(catalogue, keep, drop, actor) {
  const keepMovements = workMovements(catalogue, keep),
    dropMovements = workMovements(catalogue, drop);
  let map = new Map();
  if (dropMovements.length) {
    const mapped = mapToMovements(
      keepMovements,
      dropMovements.map((m) => ({ movementTitle: resolvedName(catalogue, m.id, "title") || "" })),
    );
    if (!mapped) return false;
    map = new Map(dropMovements.map((m, i) => [m.id, mapped[i]]));
  }
  const db = catalogue.db;
  db.prepare("UPDATE relation SET target_id=? WHERE kind='performance_work' AND target_id=?").run(keep, drop);
  db.prepare("UPDATE OR IGNORE relation SET target_id=? WHERE kind='collection_member' AND target_id=?").run(keep, drop);
  db.prepare("DELETE FROM relation WHERE kind='collection_member' AND target_id=?").run(drop);
  db.prepare("UPDATE realization SET work_id=? WHERE work_id=?").run(keep, drop);
  for (const [from, to] of map) {
    db.prepare("UPDATE realization_item SET movement_id=? WHERE movement_id=?").run(to, from);
    db.prepare("UPDATE recording_content SET movement_id=? WHERE movement_id=?").run(to, from);
    transferIdentities(db, to, from);
    db.prepare("UPDATE entity SET deleted_at=?,updated_at=? WHERE id=?").run(Date.now(), Date.now(), from);
  }
  db.prepare("DELETE FROM relation WHERE kind='movement' AND source_id=?").run(drop);
  for (const credit of db.prepare("SELECT * FROM credit WHERE target_id=?").all(drop)) {
    if (
      db
        .prepare("SELECT 1 FROM credit WHERE target_id=? AND contributor_id=? AND role=? AND instrument IS ?")
        .get(keep, credit.contributor_id, credit.role, credit.instrument)
    )
      db.prepare("DELETE FROM credit WHERE id=?").run(credit.id);
    else db.prepare("UPDATE credit SET target_id=? WHERE id=?").run(keep, credit.id);
  }
  // A user who liked or picked either work keeps that on the merged work. The
  // kept work's own pick wins; the dropped work's pick is now one of its realizations.
  for (const state of db.prepare("SELECT * FROM user_work_state WHERE work_id=?").all(drop)) {
    const kept = db.prepare("SELECT * FROM user_work_state WHERE user_id=? AND work_id=?").get(state.user_id, keep);
    if (!kept) db.prepare("UPDATE user_work_state SET work_id=? WHERE user_id=? AND work_id=?").run(keep, state.user_id, drop);
    else {
      db.prepare("UPDATE user_work_state SET favourite=?,picked_realization_id=?,updated_at=? WHERE user_id=? AND work_id=?").run(
        kept.favourite || state.favourite ? 1 : 0,
        kept.picked_realization_id || state.picked_realization_id,
        Math.max(kept.updated_at, state.updated_at),
        state.user_id,
        keep,
      );
      db.prepare("DELETE FROM user_work_state WHERE user_id=? AND work_id=?").run(state.user_id, drop);
    }
  }
  db.prepare("UPDATE OR IGNORE admin_work_pick SET work_id=? WHERE work_id=?").run(keep, drop);
  db.prepare("DELETE FROM admin_work_pick WHERE work_id=?").run(drop);
  transferIdentities(db, keep, drop);
  db.prepare("UPDATE entity SET deleted_at=?,updated_at=? WHERE id=?").run(Date.now(), Date.now(), drop);
  catalogue.audit("work.merge", drop, { into: keep }, actor);
  return true;
}

function verifiedIdentities(catalogue, entity, kind) {
  return new Set(
    catalogue.db
      .prepare("SELECT provider,record_id FROM external_identity WHERE entity_id=? AND record_kind=? AND provider!='embedded-tags' AND state='active'")
      .all(entity, kind)
      .map((row) => JSON.stringify([row.provider, row.record_id])),
  );
}
const distinctIdentities = (a, b) => a.size > 0 && b.size > 0 && ![...a].some((id) => b.has(id));
function compatibleAutoWorks(catalogue, a, b) {
  // Matching names cannot override distinct verified work or composer identities.
  if (distinctIdentities(verifiedIdentities(catalogue, a, "work"), verifiedIdentities(catalogue, b, "work"))) return false;
  const composers = (work) => {
    const identities = new Map();
    for (const { contributor_id: person } of catalogue.db.prepare("SELECT contributor_id FROM credit WHERE target_id=? AND role='composer'").all(work)) {
      const name = words(resolvedName(catalogue, person, "name"));
      identities.set(name, new Set([...(identities.get(name) || []), ...verifiedIdentities(catalogue, person, "artist")]));
    }
    return identities;
  };
  const other = composers(b);
  return ![...composers(a)].some(([name, ids]) => distinctIdentities(ids, other.get(name) || new Set()));
}

// Repairs catalogues built by the per-album grouping rule: same-named composers
// and same works that were created once per album. Only auto-created entities
// without manual edits are merged; anything else is left for review.
export function mergeDuplicateAutoWorks(catalogue, { actor = null } = {}) {
  return transaction(catalogue.db, () => {
    let index = catalogueIndex(catalogue);
    const people = mergeDuplicateComposers(catalogue, index, actor);
    if (people) index = catalogueIndex(catalogue);
    let works = 0;
    for (const [key, ids] of index.works) {
      if (ids.length < 2) continue;
      // Same composers and a title with no number ("Prelude", "Ave Maria")
      // can be two pieces: an admin decides. A catalogue number, or a title
      // with a number of its own ("Symphony No. 5", "Z. 629"), is identity.
      if (!/\d/.test(JSON.parse(key)[1])) {
        for (const id of ids.slice(1)) catalogue.review("identity", id, { reason: "duplicate-work", keep: ids[0], evidence: "same title, no number" });
        continue;
      }
      const auto = (id) =>
        catalogue.db
          .prepare("SELECT 1 FROM external_identity WHERE entity_id=? AND record_kind='album-work'")
          .get(id) &&
        !hasManualEdits(catalogue, [id, ...workMovements(catalogue, id).map((m) => m.id)]);
      const keep = ids.find((id) => !auto(id)) || ids[0];
      if (ids.filter((id) => !auto(id)).length > 1) continue;
      for (const id of ids.filter((id) => id !== keep))
        if (!compatibleAutoWorks(catalogue, keep, id)) continue;
        else if (mergeWork(catalogue, keep, id, actor)) works++;
        else catalogue.review("identity", id, { reason: "duplicate-work", keep });
    }
    return { people, works };
  });
}

// Two catalogue identities that cannot be one piece under any reading.
// Liszt's numbers write a version or piece three ways ("S443i", "S. 443/1",
// "S443 No. 1"), and a lone "i" may be a letter, so each reading is tried:
// different when the base numbers differ, the letters after the number
// differ, or both give a sub-number and those differ. A set and its
// numbered piece ("S145" and "S145 No. 1"), notation twins ("S. 443/1" and
// "S443i") and two systems ("Sz. 107", "BB 105") are not.
const ROMAN_SUFFIX = /^(?:i{1,3}|iv|v|vi{1,3}|ix|x)$/;
function catalogueReadings(subject) {
  const match = subject.match(/^cat:([a-z]+):(\d+)([a-z]*)(?:\/([0-9a-z]+))?(?::([0-9a-z/]+))?$/);
  if (!match) return null;
  const [, system, base, suffix, slash, piece] = match;
  const sub = piece || (slash && /^\d/.test(slash) ? slash : "") || "";
  const readings = [];
  const add = (letters, number) => readings.push({ system, base, letters, sub: number });
  if (ROMAN_SUFFIX.test(suffix) && !sub) {
    add("", String(romanValue(suffix)));
    if (suffix.length === 1) add(suffix, "");
  } else add(suffix, sub.replace(/[a-z]+$/, ""));
  return readings;
}
export function provablyDifferent(a, b) {
  const x = catalogueReadings(a),
    y = catalogueReadings(b);
  if (!x || !y || x[0].system !== y[0].system) return false;
  const differ = (p, q) =>
    p.base !== q.base || p.letters !== q.letters || (p.sub && q.sub && p.sub !== q.sub);
  return x.every((p) => y.every((q) => differ(p, q)));
}

// Repairs works that an earlier rule joined across sibling numbers: under
// 1.0.22 keys S215 No. 1–4 were one identity, so the duplicate merge folded
// four valses into one work. A recording whose own tracks all name a number
// that is provably another piece than its work's is detached, and this
// match then gives it its own work (or the right one). Only works matching
// made that nobody edited, and albums nobody assigned by hand.
function repairSiblingJoins(catalogue, albumId, actor) {
  const db = catalogue.db;
  const works = db
    .prepare(
      `SELECT DISTINCT r.work_id AS id FROM realization r
       ${albumId == null ? "" : `JOIN realization_item i ON i.realization_id=r.id JOIN segment s ON s.id=i.segment_id
         JOIN track_link t ON t.id=s.track_link_id AND CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=?`}
       JOIN entity e ON e.id=r.work_id AND e.deleted_at IS NULL
       WHERE EXISTS(SELECT 1 FROM external_identity x WHERE x.entity_id=r.work_id AND x.record_kind='album-work')
       -- A merge leaves its work two recordings or more.
       AND (SELECT count(*) FROM realization r2 WHERE r2.work_id=r.work_id)>1`,
    )
    .all(...(albumId == null ? [] : [String(albumId)]));
  let repaired = 0;
  for (const { id: work } of works) {
    const subject = catalogueSubject(String(resolvedName(catalogue, work, "title") || ""));
    if (!subject) continue;
    const ids = [work, ...workMovements(catalogue, work).map((m) => m.id)];
    if (hasManualEdits(catalogue, ids)) continue;
    if (db.prepare(`SELECT 1 FROM audit_event WHERE action LIKE 'editor.%' AND target_id IN (${ids.map(() => "?").join(",")}) LIMIT 1`).get(...ids)) continue;
    for (const realization of db.prepare("SELECT id FROM realization WHERE work_id=?").all(work)) {
      const items = db
        .prepare(
          `SELECT i.id,t.evidence FROM realization_item i JOIN segment s ON s.id=i.segment_id
           JOIN track_link t ON t.id=s.track_link_id WHERE i.realization_id=?`,
        )
        .all(realization.id);
      if (!items.length) continue;
      const named = new Set(
        items.map(({ evidence }) => {
          const tagged = JSON.parse(evidence).hints || {};
          const proposal = proposedWork({ ...tagged, title: withoutComposer(tagged.title, tagged.composer) }, true);
          return proposal ? catalogueSubject(proposal.catalogue ? `${proposal.title}, ${proposal.catalogue}` : proposal.title) : "";
        }),
      );
      const [own] = named;
      if (named.size !== 1 || !own || !provablyDifferent(own, subject)) continue;
      const album = String(JSON.parse(items[0].evidence).albumId);
      if (db.prepare(`SELECT 1 FROM audit_event WHERE target_id=? AND action='editor.assign-album' AND CAST(json_extract(data,'$.values.albumId') AS TEXT)=?`).get(work, album)) continue;
      transaction(db, () => {
        for (const item of items) catalogue.detachItem(item.id, { dropRecording: true });
        // The merge moved the album's record of making that piece here; it
        // no longer says this album made this work.
        for (const record of db
          .prepare("SELECT record_id,evidence FROM external_identity WHERE entity_id=? AND record_kind='album-work' AND state='active' AND CAST(json_extract(evidence,'$.albumId') AS TEXT)=?")
          .all(work, album))
          if (catalogueSubject(String(JSON.parse(record.evidence).work || "")) === own)
            db.prepare("UPDATE external_identity SET state='stale' WHERE entity_id=? AND record_kind='album-work' AND record_id=?").run(work, record.record_id);
        catalogue.audit("work.split_sibling", work, { albumId: album, subject, tracks: own }, actor);
      });
      repaired++;
    }
  }
  return repaired;
}

// Repairs albums matched before completer credits were merged: one auto-made
// work per credit combination (Mozart and Süßmayr; Mozart and Eybler). The
// work the album reaches first keeps the identity; the others' tracks are
// detached so this match adds them to it, and favourites and picks follow.
// Only unedited auto works of one album, sharing a catalogue number and a
// composer, with no conflicting verified identity, are combined.
function repairCompletionSplits(catalogue, albumId, actor) {
  const db = catalogue.db;
  const families = new Map();
  for (const { entity_id: work, album } of db
    .prepare(
      `SELECT x.entity_id,CAST(json_extract(x.evidence,'$.albumId') AS TEXT) AS album FROM external_identity x
       JOIN entity e ON e.id=x.entity_id AND e.deleted_at IS NULL
       WHERE x.provider='embedded-tags' AND x.record_kind='album-work' AND x.state='active'
       ${albumId == null ? "" : "AND CAST(json_extract(x.evidence,'$.albumId') AS TEXT)=?"}`,
    )
    .all(...(albumId == null ? [] : [String(albumId)]))) {
    const subject = catalogueSubject(String(resolvedName(catalogue, work, "title") || ""));
    if (!subject) continue;
    const key = JSON.stringify([album, subject]);
    families.set(key, [...new Set([...(families.get(key) || []), work])]);
  }
  let repaired = 0;
  for (const [key, works] of families) {
    if (works.length < 2) continue;
    const [album] = JSON.parse(key);
    const realizations = works.map((work) =>
      db
        .prepare(
          `SELECT r.id,MIN(COALESCE(CAST(json_extract(t.evidence,'$.hints.discNumber') AS INTEGER),1)*10000+CAST(json_extract(t.evidence,'$.hints.trackNumber') AS INTEGER)) AS first,
             SUM(CAST(json_extract(t.evidence,'$.albumId') AS TEXT)!=?) AS elsewhere
           FROM realization r JOIN realization_item i ON i.realization_id=r.id JOIN segment s ON s.id=i.segment_id
           JOIN track_link t ON t.id=s.track_link_id WHERE r.work_id=? GROUP BY r.id`,
        )
        .all(album, work),
    );
    const names = (work) => composerNames(catalogue, work).map(words);
    const shared = names(works[0]).filter((name) => works.every((work) => names(work).includes(name)));
    if (
      !shared.length ||
      realizations.some((list) => list.length !== 1 || list[0].elsewhere > 0) ||
      works.some((work) => hasManualEdits(catalogue, [work, ...workMovements(catalogue, work).map((m) => m.id)]))
    )
      continue;
    const order = works.map((work, i) => ({ work, realization: realizations[i][0] })).sort((a, b) => a.realization.first - b.realization.first);
    const [keep, ...drops] = order;
    if (drops.some(({ work }) => !compatibleAutoWorks(catalogue, keep.work, work))) continue;
    transaction(db, () => {
      const now = Date.now();
      for (const drop of drops) {
        for (const state of db.prepare("SELECT * FROM user_work_state WHERE work_id=?").all(drop.work)) {
          const picked = state.picked_realization_id === drop.realization.id ? keep.realization.id : state.picked_realization_id;
          const kept = db.prepare("SELECT * FROM user_work_state WHERE user_id=? AND work_id=?").get(state.user_id, keep.work);
          if (kept)
            db.prepare("UPDATE user_work_state SET favourite=?,picked_realization_id=?,updated_at=? WHERE user_id=? AND work_id=?").run(
              kept.favourite || state.favourite ? 1 : 0, kept.picked_realization_id || picked, now, state.user_id, keep.work,
            );
          else
            db.prepare("INSERT INTO user_work_state VALUES (?,?,?,?,?)").run(state.user_id, keep.work, state.favourite, picked, now);
          db.prepare("DELETE FROM user_work_state WHERE user_id=? AND work_id=?").run(state.user_id, drop.work);
        }
        const pick = db.prepare("SELECT * FROM admin_work_pick WHERE work_id=?").get(drop.work);
        if (pick && !db.prepare("SELECT 1 FROM admin_work_pick WHERE work_id=?").get(keep.work))
          db.prepare("INSERT INTO admin_work_pick VALUES (?,?,?,?)").run(
            keep.work, pick.realization_id === drop.realization.id ? keep.realization.id : pick.realization_id, pick.actor_id, now,
          );
        db.prepare("DELETE FROM admin_work_pick WHERE work_id=?").run(drop.work);
        for (const { id } of db.prepare("SELECT id FROM realization_item WHERE realization_id=?").all(drop.realization.id))
          catalogue.detachItem(id, { dropRecording: true });
        for (const movement of workMovements(catalogue, drop.work))
          db.prepare("UPDATE entity SET deleted_at=?,updated_at=? WHERE id=?").run(now, now, movement.id);
        db.prepare("DELETE FROM relation WHERE kind='movement' AND source_id=?").run(drop.work);
        db.prepare("DELETE FROM credit WHERE target_id=?").run(drop.work);
        transferIdentities(db, keep.work, drop.work);
        db.prepare("UPDATE entity SET deleted_at=?,updated_at=? WHERE id=?").run(now, now, drop.work);
        catalogue.audit("work.merge", drop.work, { into: keep.work, reason: "completion-split" }, actor);
      }
      // The kept work names only the composers every movement shares; its
      // own movements keep their other composers on their recordings.
      const metadata = new Metadata(catalogue);
      const index = catalogueIndex(catalogue);
      const group = { composers: [], composerIds: {} };
      for (const credit of db.prepare("SELECT id,contributor_id FROM credit WHERE target_id=? AND role='composer'").all(keep.work)) {
        const name = resolvedName(catalogue, credit.contributor_id, "name");
        if (shared.includes(words(name))) group.composers.push(name);
        else db.prepare("DELETE FROM credit WHERE id=?").run(credit.id);
      }
      for (const row of db
        .prepare(
          `SELECT DISTINCT c.recording_id,t.evidence FROM realization_item i JOIN segment s ON s.id=i.segment_id
           JOIN segment_content sc ON sc.segment_id=s.id JOIN recording_content c ON c.id=sc.content_id
           JOIN track_link t ON t.id=s.track_link_id WHERE i.realization_id=?`,
        )
        .all(keep.realization.id))
        creditMovementComposers(catalogue, metadata, index, row.recording_id, { composers: JSON.parse(row.evidence).hints?.composer || [] }, group);
      repaired += drops.length;
    });
  }
  return repaired;
}

// This only changes the plugin catalogue. It never writes the indexed media.
const INSTRUMENT =
  /\b(piano|violin|viola|cello|violoncello|double bass|flute|oboe|clarinet|bassoon|horn|trumpet|trombone|organ|harpsichord|guitar|harp|string|wind|piano and violin|violin and piano|cello and piano)\s+(?=(?:sonata|sonatina|concerto|quartet|quintet|trio|sextet|octet|suite|partita)\b)/i;
const KEY = /\bin\s+([a-h])(?:[\s-]?(flat|sharp|♭|♯))?\s+(major|minor)\b/i;
const CATALOGUE_TEXT =
  /\b(?:op(?:us|\.)?\s*\d+[a-z]?(?:\s*,?\s*no\.?\s*\d+)?|(?:BWV|HWV|RV|WoO|TWV|K(?:V|\.)?|D\.?|Hob\.?\s*[IVXL]+[a-z]?:?)\s*\d+[a-z]?)/gi;
const tidyCatalogue = (value) =>
  clean(value)
    .replace(/^op(?:us|\.)?\s*/i, "Op. ")
    .replace(/\s*,?\s*no\.?\s*(\d)/i, " No. $1");
// Fields a work's title states outright: "Piano Sonata no. 1 in F minor, op. 2 no. 1".
export function workFieldsFromTitle(title) {
  const text = clean(title);
  const fields = {};
  const key = text.match(KEY);
  if (key)
    fields.key = `${key[1].toUpperCase()}${key[2] ? `-${key[2].toLowerCase().replace("♭", "flat").replace("♯", "sharp")}` : ""} ${key[3].toLowerCase()}`;
  const catalogue = [...new Set((text.match(CATALOGUE_TEXT) || []).map(tidyCatalogue))];
  if (catalogue.length) fields.catalogue = catalogue;
  const form = text.match(MULTI_MOVEMENT);
  if (form) fields.form = form[1].toLowerCase();
  const nickname = text.match(/["“„«]([^"”»]+)["”»]/);
  if (nickname) fields.nickname = clean(nickname[1]);
  const instrument = text.match(INSTRUMENT);
  if (instrument)
    fields.instrumentation = instrument[1]
      .toLowerCase()
      .split(/\s+and\s+/)
      .map((name) => name[0].toUpperCase() + name.slice(1));
  return fields;
}

// Fill a work's empty fields from its title. Fields with any value are kept.
export function deriveWorkFields(catalogue, work, metadata = new Metadata(catalogue)) {
  const title = resolvedName(catalogue, work, "title");
  if (typeof title !== "string") return 0;
  const known = catalogue.db.prepare("SELECT 1 FROM field_resolution WHERE target_id=? AND field=?");
  let filled = 0;
  for (const [field, value] of Object.entries(workFieldsFromTitle(title)))
    if (!known.get(work, field)) {
      metadata.derived(work, field, value);
      filled++;
    }
  return filled;
}

// Movement titles derived before stripWorkPrefix understood a title can
// still carry the work's name. Manual and provider titles are left alone.
// A movement inside a movement ("I. Inferno: 1. Lento") keeps its whole
// path. When one name is the other's end, the longer one says more.
function fullerTitle(fromTitle, shorter) {
  if (!shorter) return fromTitle;
  const long = words(fromTitle);
  const short = words(shorter);
  return short && long !== short && long.endsWith(` ${short}`) ? fromTitle : shorter;
}

export function repairMovementTitles(catalogue, { albumId = null } = {}) {
  const metadata = new Metadata(catalogue);
  // One album's match repairs only the works that album realizes.
  const rows = catalogue.db
    .prepare(
      `SELECT r.source_id AS work,r.target_id AS movement,a.value,a.source
       FROM relation r JOIN field_resolution f ON f.target_id=r.target_id AND f.field='title'
       JOIN assertion a ON a.id=f.assertion_id
       WHERE r.kind='movement' AND a.source='derived'
       ${
         albumId == null
           ? ""
           : `AND r.source_id IN (SELECT re.work_id FROM realization re JOIN realization_item i ON i.realization_id=re.id
              JOIN segment s ON s.id=i.segment_id JOIN track_link t ON t.id=s.track_link_id
              WHERE CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=?)`
       }`,
    )
    .all(...(albumId == null ? [] : [String(albumId)]));
  const titles = new Map();
  let repaired = 0;
  for (const row of rows) {
    if (!titles.has(row.work)) titles.set(row.work, resolvedName(catalogue, row.work, "title"));
    const workTitle = titles.get(row.work);
    const current = JSON.parse(row.value);
    if (typeof workTitle !== "string" || typeof current !== "string") continue;
    // Only a title that still spells out its work ("Rachmaninoff: Piano
    // Concerto No. 1…: I. Vivace"); "IV. Menuet I - V. Menuet II" is
    // already the movement.
    if (!words(current).includes(words(workTitle))) continue;
    const stripped = stripWorkPrefix(current, workTitle);
    if (stripped && stripped !== current) {
      metadata.derived(row.movement, "title", stripped);
      repaired++;
    }
  }
  // Earlier repairs cut "I. Inferno: 1. Lento" to "1. Lento". Where the
  // album's track still spells out the longer path, it comes back.
  if (albumId != null)
    for (const row of catalogue.db
      .prepare(
        `SELECT DISTINCT i.movement_id AS movement,re.work_id AS work,t.evidence,a.value FROM realization_item i
         JOIN realization re ON re.id=i.realization_id JOIN segment s ON s.id=i.segment_id
         JOIN track_link t ON t.id=s.track_link_id
         JOIN field_resolution f ON f.target_id=i.movement_id AND f.field='title'
         JOIN assertion a ON a.id=f.assertion_id AND a.source='derived'
         WHERE CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=?`,
      )
      .all(String(albumId))) {
      const workTitle = resolvedName(catalogue, row.work, "title");
      const current = JSON.parse(row.value);
      if (typeof workTitle !== "string" || typeof current !== "string") continue;
      const hints = JSON.parse(row.evidence).hints || {};
      const fromTitle = movementTitle({ title: withoutComposer(hints.title, hints.composer), work: hints.work }, workTitle);
      const better = fullerTitle(fromTitle, current);
      if (better !== current) {
        metadata.derived(row.movement, "title", better);
        repaired++;
      }
    }
  return repaired;
}

// Work titles taken from MusicBrainz before the tags' own title won: when
// every track of a work agrees on a title naming the same catalogue number,
// use it. Manual and provider titles are left alone.
export function repairWorkTitles(catalogue) {
  const metadata = new Metadata(catalogue);
  const works = catalogue.db
    .prepare(
      `SELECT DISTINCT r.work_id AS id,a.value FROM realization r
       JOIN field_resolution f ON f.target_id=r.work_id AND f.field='title'
       JOIN assertion a ON a.id=f.assertion_id WHERE a.source='derived'`,
    )
    .all();
  const tracks = catalogue.db.prepare(
    `SELECT t.evidence FROM realization r JOIN realization_item i ON i.realization_id=r.id
     JOIN segment s ON s.id=i.segment_id JOIN track_link t ON t.id=s.track_link_id
     WHERE r.work_id=?`,
  );
  let repaired = 0;
  for (const work of works) {
    const current = JSON.parse(work.value);
    const heads = new Set(
      tracks.all(work.id).map((row) => {
        const hints = JSON.parse(row.evidence).hints || {};
        return proposedWork(hints, true)?.title || "";
      }),
    );
    const [head] = heads;
    if (heads.size === 1 && head && head !== current && sameCatalogue(head, current)) {
      metadata.derived(work.id, "title", head);
      repaired++;
    }
  }
  return repaired;
}

// An Auto-match review whose tracks are all in a work now asks nothing:
// a later match (a fuller album, MusicBrainz, a corrected rule) settled it.
// It is closed, with an audit record; open ones with a track still out stay.
function resolveSettledReviews(catalogue, albumId, actor) {
  const db = catalogue.db;
  const attached = db.prepare("SELECT 1 FROM segment s JOIN realization_item i ON i.segment_id=s.id WHERE s.track_link_id=? LIMIT 1");
  let resolved = 0;
  for (const review of db
    .prepare(
      `SELECT id,target_id,evidence FROM review_item WHERE kind='auto_match' AND status='open'
       ${albumId == null ? "" : "AND CAST(json_extract(evidence,'$.albumId') AS TEXT)=?"}`,
    )
    .all(...(albumId == null ? [] : [String(albumId)]))) {
    const evidence = JSON.parse(review.evidence);
    const tracks = Array.isArray(evidence.tracks) && evidence.tracks.length ? evidence.tracks : [review.target_id];
    if (!tracks.every((track) => attached.get(track))) continue;
    db.prepare("UPDATE review_item SET status='resolved' WHERE id=?").run(review.id);
    catalogue.audit("review.auto_resolve", review.target_id, { review: review.id, reason: evidence.reason || null }, actor);
    resolved++;
  }
  return resolved;
}

export function autoMatchTaggedWorks(
  catalogue,
  {
    albumId = null,
    actor = null,
    allowStructuredTitles = false,
    providerMatches = new Map(),
  } = {},
) {
  repairCompletionSplits(catalogue, albumId, actor);
  repairSiblingJoins(catalogue, albumId, actor);
  const groups = candidates(
    catalogue,
    albumId,
    allowStructuredTitles,
    providerMatches,
  );
  repairMergedIdentities(catalogue);
  mergeDuplicateAutoWorks(catalogue, { actor });
  // Titles stored before composer prefixes were read past ("Rachmaninoff:
  // …: I. Vivace") read as the movement again.
  if (albumId != null) repairMovementTitles(catalogue, { albumId });
  // Catalogue-wide repairs belong to the library pass, not to each album.
  if (albumId == null) {
    repairWorkTitles(catalogue);
    repairMovementTitles(catalogue);
    const metadata = new Metadata(catalogue);
    for (const { id } of catalogue.db
      .prepare("SELECT id FROM entity WHERE kind='work' AND deleted_at IS NULL")
      .all())
      deriveWorkFields(catalogue, id, metadata);
  }
  const index = catalogueIndex(catalogue);
  let created = 0;
  for (const group of groups)
    if (createGroup(catalogue, group, actor, index)) created++;
  resolveSettledReviews(catalogue, albumId, actor);
  return { created, candidates: groups.length };
}

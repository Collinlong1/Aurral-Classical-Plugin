// What a track's own tags say about whether it is classical, and the
// automatic decision that follows. Pure: no database, no network. classify()
// in reconcile.js stores the decision; the read-only classification report
// and the test corpora use the same function, so they always agree.
//
// Signals are either strong (a classical genre, a catalogue number, an
// explicit movement tag or composer relation) or supporting (a WORK tag,
// tempo or form words, a composer who isn't the performer). Supporting
// signals need corroboration, and genres such as hip-hop, rock or pop count
// against a track: a song never becomes classical from its credits or title.
import {
  DEFAULT_CLASSICAL_GENRES,
  DEFAULT_NON_CLASSICAL_GENRES,
  HARD_NON_CLASSICAL_GENRES,
  normGenre,
} from "../resolver.js";
import { artistCredits } from "./credits.js";

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordList = (terms) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${[...new Set(terms.map(normGenre))]
      .sort((a, b) => b.length - a.length)
      .map(escape)
      .join("|")})(?![\\p{L}\\p{N}_])`,
    "u",
  );

// Ordinary popular-music genres, matched as whole words anywhere in a genre
// name ("baroque pop", "rock opera", "hip-hop/rap", "progressive metal").
const ORDINARY = wordList([
  ...DEFAULT_NON_CLASSICAL_GENRES,
  "new romantic", "new wave", "synthpop", "electronica", "alternative", "k pop",
]);
// Genres of records that may hold real classical recordings but usually
// don't: soundtracks, game music, crossover. Verified classical works within
// them are still allowed.
const CONTEXT = wordList([...HARD_NON_CLASSICAL_GENRES, "score", "game", "anime"]);
// Classical genres are whole genre names ("Classical", "Chamber Music",
// "Baroque"), or names with the word classical in them.
const CLASSICAL_NAMES = new Set(
  [...DEFAULT_CLASSICAL_GENRES, "romantic", "classical period", "early romantic", "late romantic", "contemporary", "modern composition", "avant garde"].map(normGenre),
);
const CLASSICAL_WORD = /(^|\s)classical(\s|$)/;
// An album titled as a film, television or game soundtrack is that context
// whatever its genre tags say ("Interstellar: Original Motion Picture
// Soundtrack" tagged Classical).
const SOUNDTRACK_ALBUM =
  /(?<!\p{L})(?:(?:original\s+)?(?:motion\s+picture|film|movie|television|tv|series|game|video\s+game)\s+(?:soundtrack|score)|original\s+(?:soundtrack|score)|music\s+from\s+(?:and\s+inspired\s+by\s+)?the\s+(?:motion\s+picture|film|movie|series)|soundtrack|o\.?s\.?t\.?)(?!\p{L})/iu;

export function genreKinds(genres = []) {
  const kinds = { classical: [], ordinary: [], context: [] };
  for (const raw of genres) {
    const genre = normGenre(raw);
    if (!genre) continue;
    if (ORDINARY.test(genre)) kinds.ordinary.push(raw);
    else if (CONTEXT.test(genre)) kinds.context.push(raw);
    else if (CLASSICAL_NAMES.has(genre) || CLASSICAL_WORD.test(genre)) kinds.classical.push(raw);
  }
  return kinds;
}

const TEMPO =
  /\b(allegr(?:o|etto)|adagi(?:o|etto)|andant(?:e|ino)|larghetto|largo|lento|grave|prestissimo|presto|vivace|moderato|scherzo|menuetto|minuet|menuet|rondo|finale|maestoso|sostenuto|cantabile)\b/i;
// "II. Adagio sostenuto", "Spring - I. Allegro": a movement numbered with a
// Roman numeral and marked with a tempo, rather than a song called "Finale".
const NUMBERED_TEMPO = new RegExp(`(?:^|[:;\\-–—]\\s*)[IVXL]{1,6}\\.\\s*${TEMPO.source.replace(/^\\b/, "")}`, "i");
// Single-letter systems (Debussy's L., Ravel's M., Liszt's S.) only after a
// comma, as in "La Mer, L. 109", so ordinary words and initials never count.
const CATALOGUE_NUMBER =
  /\b(op(?:us)?\.?|bwv|buxwv|swv|wwv|kv?\.?|d\.|hob\.?|rv|woo|hwv|sz\.?|twv|trv)\s*\d|,\s*(?:L\.|M\.|S\.|FP)\s*\d/i;
const FORM =
  /\b(symphon(?:y|ie)|sinfonia|sonata|concerto|suite|partita|string quartet|piano trio|quintet|nocturne|mazurka|polonaise|etude|prelude|fugue|toccata|cantata|oratorio|requiem|mass in|missa|motet|madrigal|lieder|impromptu|ballade|rhapsody|overture)(?:s|es)?\b/i;
// "Bach: The Goldberg Variations", "Ravel: Boléro": an album named after a
// composer. Supporting evidence only: never enough on its own.
const NAME_WORD = "\\p{Lu}[\\p{L}'’.\\-]+";
const COMPOSER_ALBUM = new RegExp(`^(?!The\\s)${NAME_WORD}(?:\\s+(?:van|von|de|da|di|du|del|der|le|la|${NAME_WORD})){0,3}:\\s`, "u");

const plain = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const clean = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");

export const STRONG = new Set(["classical genre", "catalogue number", "movement tag", "classical composer relation"]);

// Returns { signals, score, kinds, decision, reason }. `decision` is the
// automatic state before pins and inheritance.
export function classificationEvidence(hints = {}) {
  const title = clean(hints.title);
  const work = clean(hints.work);
  const album = clean(hints.album);
  const ownText = [title, work].filter(Boolean).join(" \n ");
  const kinds = genreKinds(hints.genres);
  const soundtrackAlbum = album.match(SOUNDTRACK_ALBUM)?.[0];
  if (soundtrackAlbum && !kinds.context.length) kinds.context.push(`album: ${soundtrackAlbum}`);
  const signals = [];
  const add = (points, signal, value) => signals.push({ points, signal, kind: STRONG.has(signal) ? "strong" : "supporting", ...(value != null && { value: String(value) }) });

  if (kinds.classical.length) add(4, "classical genre", kinds.classical.join("; "));
  if (hints.movement) add(4, "movement tag", hints.movement);
  if (hints.classicalComposerRelation) add(4, "classical composer relation");
  const catalogue = hints.catalogueNumber || (ownText + " \n " + album).match(CATALOGUE_NUMBER)?.[0];
  if (catalogue) add(3, "catalogue number", catalogue);
  // A WORK tag naming the song itself (Picard's track relationships on any
  // recording) says nothing about classical music.
  if (work && plain(work) !== plain(title)) add(3, "WORK tag", hints.work);
  const tempo = ownText.match(TEMPO)?.[0];
  if (!hints.movement && tempo) add(2, "tempo word in title", tempo);
  const numbered = !hints.movement && ownText.match(NUMBERED_TEMPO)?.[0];
  if (numbered) add(2, "numbered movement", numbered.replace(/^[:;\-–—]\s*/, ""));
  const form = ownText.match(FORM)?.[0];
  if (form) add(2, "form word in title", form);
  else {
    // The album's title counts once, weakly: "Eldorado – A Symphony …"
    // shouldn't make every song on it a movement.
    const albumForm = album.match(FORM)?.[0] || album.match(TEMPO)?.[0];
    if (albumForm) add(1, "form word in album title", albumForm);
  }
  const albumComposer = album.trim().match(COMPOSER_ALBUM)?.[0];
  if (albumComposer) add(2, "album named after a composer", albumComposer.replace(/:\s*$/, ""));
  if (hints.composerDistinct) add(1, "composer differs from artist", (hints.composer || []).join("; "));
  // No composer tag, but the artist field names one beside the performers
  // ("Bedřich Smetana; Vienna Philharmonic"). Corroborated by the album or
  // track title or the catalogue system, it counts as a credited composer;
  // alone it only keeps the track out of "not classical".
  const credit = artistCredits(hints);
  if (credit?.confidence === "high") add(2, "composer named in artist field", `${credit.composers.join("; ")} (${credit.evidence.join(", ")})`);
  else if (credit) add(1, "possible composer in artist field", credit.composers.join("; "));

  const score = signals.reduce((sum, s) => sum + s.points, 0);
  const strong = signals.filter((s) => s.kind === "strong");
  const verified = strong.filter((s) => s.signal !== "classical genre");
  const supporting = signals.filter((s) => s.kind === "supporting" && s.points > 1);
  const hasComposer = (Array.isArray(hints.composer) && hints.composer.length > 0) || !!credit;
  const credited = !!hints.composerDistinct || credit?.confidence === "high";

  let decision;
  let reason;
  if (kinds.ordinary.length) {
    // Popular genres outweigh titles and credits. A track only stays in
    // review when something verifiable (a catalogue number, a movement or
    // composer relation, or also a classical genre) says otherwise.
    if (strong.length) {
      decision = "unsure";
      reason = `${kinds.ordinary.join("; ")} genre conflicts with ${strong.map((s) => s.signal).join(", ")}`;
    } else {
      decision = "not_classical";
      reason = `${kinds.ordinary.join("; ")} genre and no verifiable classical evidence`;
    }
  } else if (kinds.context.length) {
    // Soundtracks, game music, crossover: a verified classical work (a
    // catalogue number, movement or composer relation, credited to a composer
    // who isn't the performer), or a recording with three kinds of classical
    // evidence, is classical; any other evidence leaves it for review. A
    // "Classical" genre tag is no such evidence here: taggers file film
    // scores under it. A score its own composer is credited for, with nothing
    // verifiable, is not classical.
    const supportingNonGenre = supporting.length;
    if (credited && (verified.length || supportingNonGenre >= 2) && score - (kinds.classical.length ? 4 : 0) >= 4) {
      decision = "classical";
      reason = `verified classical work in a ${kinds.context.join("; ")} release`;
    } else if (!verified.length && !credited && hasComposer) {
      decision = "not_classical";
      reason = `${kinds.context.join("; ")}: nothing verifiably classical, credited to its own composer`;
    } else if (credited || score > 1) {
      decision = "unsure";
      reason = `${kinds.context.join("; ")} genre with some classical evidence`;
    } else {
      decision = "not_classical";
      reason = `${kinds.context.join("; ")} genre and no classical evidence`;
    }
  } else if (kinds.classical.length) {
    decision = "classical";
    reason = "classical genre";
  } else if (score >= 4 && (strong.length || supporting.length >= 2)) {
    // Without a genre: something verifiable, or two independent signals from
    // the titles themselves. A composer credit adds weight but never counts
    // as corroboration.
    decision = "classical";
    reason = "corroborated classical evidence";
  } else if (score > 0 || hasComposer) {
    decision = "unsure";
    reason = score > 0 ? "uncorroborated classical evidence" : "composer credit only";
  } else {
    decision = "not_classical";
    reason = "no classical evidence";
  }
  return { signals, score, kinds, decision, reason };
}

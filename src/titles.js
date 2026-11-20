// Movement titles for album headings, taken unchanged from the
// aurral-classical branch (src/model/auto-match.js): "Symphony No. 5, op. 67:
// I. Allegro con brio" under "Symphony No. 5" reads "I. Allegro con brio".
import { catalogueNumber } from "./works.js";

const MULTI_MOVEMENT =
  /\b(symphon(?:y|ie)|sinfonia|sonata|sonatina|concerto|suite|partita|quartet|quintet|sextet|septet|octet|nonet|trio|serenade|divertimento|cassation|mass|missa|requiem|stabat mater|magnificat|te deum|vespers|cantata|oratorio|passion|variations?|ballet)\b/i;

const MOVEMENT_PREFIX = /^(?:[IVXLCDM]+|\d+)[.)\s:-]/i;

const clean = (value) => String(value || "").trim().replace(/\s+/g, " ");

const normalized = (value) =>
  clean(value)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

// Sets named in the plural whose pieces are numbered, not Field's single
// "Nocturne no. 10", which is a piece of its own.
export const NUMBERED_SET =
  /(?<!\p{L})(pr[eé]ludes|[eé]tudes|nocturnes|mazurkas|waltzes|valses|impromptus|ballades|polonaises|bagatelles|intermezzi|consolations|po[eè]mes|morceaux|songs without words|lieder ohne worte)(?!\p{L})/iu;

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

// Identity keys shared across albums. Album placement never changes which
// work a performance realizes, so two albums of the same work share it.
const words = (value) =>
  normalized(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

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

// The colon inside a catalogue number such as "Hob. XVI:52" (a roman
// numeral, a colon, a digit) separates nothing (review L9).
const insideNumber = (text, match) => match[0] === ":" && /\b[IVXLCDM]+$/i.test(text.slice(0, match.index)) && /^\d/.test(text.slice(match.index + 1));

function stripWorkPrefixOnce(title, workTitle) {
  const text = clean(title);
  const separators = [...text.matchAll(SEPARATOR)].filter((match) => !insideNumber(text, match));
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

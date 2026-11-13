// Helpers for classical metadata: catalogue numbers, parent works, names.

// A number's own suffix is part of it: Liszt's S172, S172a and S172b, or
// S504i and S504ii, are different pieces, as are S543 and S543bis. Only
// letters written straight after the digits count ("S. 161 no" is S161).
const SUFFIX = "(?:[a-z]{1,3}(?![a-z]))?";
// "op. 67", "BWV 1007", "K. 550", "D 960", "Hob. XVI:52", "RV 269"...
const CATALOGUES = [
  [/\bBWV\s*(\d+[a-z]?)/i, "BWV"],
  [/\bHWV\s*(\d+[a-z]?)/i, "HWV"],
  [/\bRV\s*(\d+[a-z]?)/i, "RV"],
  [/\bK(?:V|\.)?\s*(\d+[a-z]?)\b/, "K"],
  [/\bD\.?\s*(\d+[a-z]?)\b/, "D"],
  [/\bHob\.?\s*([IVXL]+[a-z]?:\s*\d+[a-z]?)/i, "Hob"],
  [new RegExp(`\\bWoO\\s*(\\d+${SUFFIX})`, "i"), "WoO"],
  // "S. 161", and Hyperion's "S161", "S166r" or "S534ii/bis". Searle's own
  // sub-numbers after a slash name a piece too ("S. 534/2b", "S. 385/3").
  [new RegExp(`\\bS(?:\\.\\s*|(?=\\d))(\\d+${SUFFIX}(?:\\/(?:bis|\\d+${SUFFIX}))?)`), "S"],
  [new RegExp(`\\bSz\\.?\\s*(\\d+${SUFFIX})`, "i"), "Sz"],
  [new RegExp(`\\bBB\\s*(\\d+${SUFFIX})`), "BB"],
  [new RegExp(`\\bTrV\\s*(\\d+${SUFFIX})`, "i"), "TrV"],
  [new RegExp(`\\bL\\.\\s*(\\d+${SUFFIX})`), "L"],
  [new RegExp(`\\bFP\\s*(\\d+${SUFFIX})`), "FP"],
];
const OPUS = /\bop(?:us|\.)?\s*(\d+[a-z]?)(?:\s*,?\s*(?:no\.?|nr\.?|n°)\s*(\d+))?/i;
// A number within the catalogue number that follows it: "S164e No. 2",
// "S160 No. 4bis".
const PIECE = /^\s*,?\s*(?:no\.?|nr\.?|n°)\s*(\d+[a-z]{0,3})(?![a-z\d])/i;

function catalogueMatch(title) {
  const text = String(title || "");
  for (const [pattern, prefix] of CATALOGUES) {
    const match = text.match(pattern);
    if (match) return { prefix, number: match[1].replace(/\s+/g, ""), end: match.index + match[0].length, text };
  }
  return null;
}

// The catalogue number as search words: "op 67", "op 10 no 3", "BWV 1007".
export function catalogueNumber(title) {
  const match = catalogueMatch(title);
  if (match) return `${match.prefix} ${match.number}`;
  const opus = String(title || "").match(OPUS);
  if (opus) return `op ${opus[1]}${opus[2] ? ` no ${opus[2]}` : ""}`;
  return "";
}

// The number of the piece within that catalogue number, as "S164e No. 2"
// names, or "" without one. Opus numbers carry theirs already.
export function cataloguePiece(title) {
  const match = catalogueMatch(title);
  return match ? match.text.slice(match.end).match(PIECE)?.[1]?.toLowerCase() || "" : "";
}

// "Symphony no. 5 in C minor, op. 67: I. Allegro con brio" -> "Symphony 5".
export function shortWorkTitle(title) {
  let text = String(title || "").split(":")[0];
  text = text.replace(OPUS, " ");
  for (const [pattern] of CATALOGUES) text = text.replace(pattern, " ");
  text = text
    .replace(/\bin\s+[A-G](?:[- ]?(?:flat|sharp|♭|♯|b|#))?\s*(?:major|minor|maj|min|dur|moll)\b/gi, " ")
    .replace(/\b(?:no|nr|n°)\.?\s*(?=\d)/gi, " ")
    .replace(/[“”"'’,;()[\]]/g, " ");
  return searchWords(text);
}

// Words Soulseek can match: letters and digits only.
export function searchWords(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

// "Beethoven, Ludwig van" -> "Beethoven"; "Berlin Philharmonic" stays whole.
export function surname(person) {
  if (!person) return "";
  const sort = String(person.sortName || "");
  if (sort.includes(",")) return searchWords(sort.split(",")[0]);
  return searchWords(person.name);
}

export function creditString(credit) {
  return (credit || []).map((entry) => `${entry.name ?? entry.artist?.name ?? ""}${entry.joinphrase ?? ""}`).join("").trim();
}

// The Work a movement belongs to, or the work itself.
export async function topWork(mb, work, depth = 0, inc = "artist-rels+work-rels", { stop = () => false } = {}) {
  if (!work || depth >= 3) return work;
  const parent = (work.relations || []).find((rel) => rel.type === "parts" && rel.direction === "backward" && rel.work?.id);
  if (!parent) return work;
  const data = await mb.get("work", parent.work.id, inc);
  return data && !stop(data, work) ? topWork(mb, data, depth + 1, inc, { stop }) : work;
}

export const RELEASE_INC = "recordings+artist-credits+release-groups+media";

export function releaseYear(date) {
  const year = Number(String(date || "").slice(0, 4));
  return Number.isInteger(year) && year > 0 ? year : null;
}

// Helpers for classical metadata: catalogue numbers, parent works, names.

// "op. 67", "BWV 1007", "K. 550", "D 960", "Hob. XVI:52", "RV 269"...
const CATALOGUES = [
  [/\bBWV\s*(\d+[a-z]?)/i, "BWV"],
  [/\bHWV\s*(\d+[a-z]?)/i, "HWV"],
  [/\bRV\s*(\d+[a-z]?)/i, "RV"],
  [/\bK(?:V|\.)?\s*(\d+[a-z]?)\b/, "K"],
  [/\bD\.?\s*(\d+[a-z]?)\b/, "D"],
  [/\bHob\.?\s*([IVXL]+[a-z]?:\s*\d+[a-z]?)/i, "Hob"],
  [/\bWoO\s*(\d+)/i, "WoO"],
  [/\bS\.\s*(\d+)/, "S"],
  [/\bSz\.?\s*(\d+)/i, "Sz"],
  [/\bBB\s*(\d+)/, "BB"],
  [/\bTrV\s*(\d+)/i, "TrV"],
  [/\bL\.\s*(\d+)/, "L"],
  [/\bFP\s*(\d+)/, "FP"],
];
const OPUS = /\bop(?:us|\.)?\s*(\d+[a-z]?)(?:\s*,?\s*(?:no\.?|nr\.?|n°)\s*(\d+))?/i;

// The catalogue number as search words: "op 67", "op 10 no 3", "BWV 1007".
export function catalogueNumber(title) {
  const text = String(title || "");
  for (const [pattern, prefix] of CATALOGUES) {
    const match = text.match(pattern);
    if (match) return `${prefix} ${match[1].replace(/\s+/g, "")}`;
  }
  const opus = text.match(OPUS);
  if (opus) return `op ${opus[1]}${opus[2] ? ` no ${opus[2]}` : ""}`;
  return "";
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

// Text keys for classical search: accent-free words, a spelling skeleton for
// transliterated names, and one key per catalogue number however it is
// written ("Op 27 no 2", "Op.27/2", "op. 27, No. 2" are all "op:27:2").

const LETTERS = { ø: "o", æ: "ae", œ: "oe", ß: "ss", ł: "l", đ: "d", ð: "d", þ: "th", ı: "i", ħ: "h", ŋ: "n" };
// Russian, Ukrainian, Czech and similar names in Cyrillic, read as the
// common English spellings do.
const CYRILLIC = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "i", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya", і: "i", ї: "i", є: "e", ґ: "g",
};

// Lower case, no accents, letters and digits only, single spaces.
export function fold(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\u0000-\u007f]/g, (ch) => LETTERS[ch] ?? CYRILLIC[ch] ?? ch)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export const words = (value) => fold(value).split(" ").filter(Boolean);

// One spelling for the ways a name is transliterated: Tchaikovsky,
// Tschaikowsky and Chaikovskii; Prokofiev and Prokofjew; Rachmaninoff and
// Rakhmaninov. Only for words of four letters or more, and only to widen a
// match: an exact word always ranks above its skeleton.
export function skeleton(word) {
  if (word.length < 4 || /\d/.test(word)) return "";
  return word
    .replace(/t?sch|tch|kh|ch|zh|sh/g, "h")
    .replace(/ph/g, "f")
    .replace(/w/g, "v")
    .replace(/v/g, "f")
    .replace(/ck|c|q/g, "k")
    .replace(/x/g, "ks")
    .replace(/[yj]/g, "i")
    .replace(/(.)\1+/g, "$1")
    .replace(/ii$/, "i");
}

// Catalogue systems, by the prefixes people write. Longer prefixes first.
const SYSTEMS = [
  ["bwv", "bwv"], ["buxwv", "buxwv"], ["swv", "swv"], ["hwv", "hwv"], ["fp", "fp"], ["jb", "jb"], ["cd", "cd"], ["z", "z"], ["twv", "twv"], ["wwv", "wwv"], ["rv", "rv"], ["hob", "hob"], ["wab", "wab"],
  ["woo", "woo"], ["kv", "k"], ["k", "k"], ["d", "d"], ["s", "s"], ["sz", "sz"], ["bb", "bb"], ["trv", "trv"],
  ["fs", "fs"], ["l", "l"], ["kk", "kk"], ["jw", "jw"], ["op", "op"], ["opus", "op"], ["opp", "op"],
];
const PREFIX = SYSTEMS.map(([written]) => written).sort((a, b) => b.length - a.length).join("|");
const ROMAN = "(?:x{0,3})(?:ix|iv|v?i{0,3})";
// Hob. XVI:52, Hob.XVI/52, Hob XVI 52.
const HOBOKEN = new RegExp(`\\bhob\\.?\\s*(${ROMAN}[a-z]?)\\s*[:/.\\s]\\s*(\\d+[a-z]?)`, "giu");
// Op. 27 No. 2, Op.27/2, op. 27, No. 2, BWV 1007, K. 331, D 960, S.244/2.
const NUMBERED = new RegExp(
  `(?<![\\p{L}\\p{N}])(${PREFIX})\\.?\\s*(\\d+[a-z]?)(?:\\s*(?:,\\s*|\\/|\\s+)(?:(?:no|nr|n°|num|number|#)\\.?\\s*)?(\\d+[a-z]?)(?![\\p{L}\\p{N}]))?`,
  "giu",
);
const SYSTEM = new Map(SYSTEMS);
// A bare second number counts only after a system that has them: "Op. 27 2"
// is op. 27 no. 2, but "BWV 1007 2" is not a piece of BWV 1007.
const SUBNUMBERED = new Set(["op", "hob", "woo", "s", "d", "k"]);
const NO_BEFORE = /(?:no|nr|n°|num|number|#)\.?\s*$|\/\s*$/i;

// Every catalogue number in `text`: [{ key, system, start, end }], keys like
// "op:27:2", "bwv:1007", "hob:xvi:52".
export function catalogueKeys(text) {
  const source = String(text ?? "").normalize("NFC");
  const found = [];
  for (const match of source.matchAll(HOBOKEN)) {
    if (!match[1]) continue;
    found.push({ key: `hob:${match[1].toLowerCase()}:${match[2].toLowerCase()}`, system: "hob", start: match.index, end: match.index + match[0].length });
  }
  for (const match of source.matchAll(NUMBERED)) {
    const written = match[1].toLowerCase();
    if (written === "hob") continue;
    const system = SYSTEM.get(written);
    // A one-letter catalogue needs its dot or a space and a number of more
    // than one digit, so "D major" or "S 1" in a title never reads as one.
    if (written.length === 1 && !/^[a-z]\.\s*\d|^[a-z]\s*\d{2}/i.test(match[0])) continue;
    if (found.some((item) => match.index < item.end && match.index + match[0].length > item.start)) continue;
    let sub = match[3]?.toLowerCase() || "";
    if (sub && !SUBNUMBERED.has(system)) {
      const between = match[0].slice(match[0].indexOf(match[2]) + match[2].length, match[0].lastIndexOf(match[3]));
      if (!NO_BEFORE.test(between)) sub = "";
    }
    const end = sub ? match.index + match[0].length : match.index + match[0].indexOf(match[2]) + match[2].length;
    found.push({ key: [system, match[2].toLowerCase(), sub].filter(Boolean).join(":"), system, start: match.index, end });
  }
  return found.sort((a, b) => a.start - b.start);
}

// A query key matches its own key and every piece under it: "op:27" matches
// "op:27:1" and "op:27:2"; "op:27:2" matches only itself.
export const keyMatches = (query, key) => key === query || key.startsWith(`${query}:`);

const STOP = new Set(["no", "nr", "num", "number", "in", "the", "a", "an", "of", "and", "de", "la", "le", "der", "die", "das", "von", "van", "op", "opus"]);

// A query: its catalogue keys, and the remaining words to match (stop words
// match when present but are not required).
export function parseQuery(text) {
  let rest = String(text ?? "");
  const keys = catalogueKeys(rest);
  for (const item of [...keys].reverse()) rest = `${rest.slice(0, item.start)} ${rest.slice(item.end)}`;
  const all = words(rest);
  return {
    keys: [...new Set(keys.map((item) => item.key))],
    words: [...new Set(all.filter((word) => !STOP.has(word)))],
    optional: [...new Set(all.filter((word) => STOP.has(word)))],
  };
}

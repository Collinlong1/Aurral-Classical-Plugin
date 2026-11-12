// Who composed a track when its tags never say so, read from an artist field
// that lists the composer beside the performers: "Bedřich Smetana; Vienna
// Philharmonic & James Levine". Pure: no database, no network, no tag writes.
// Classification, matching and the album page all ask this one function, so
// they always agree.
//
// Only a field split into named parts (";", " / ", or a spaced dash) is read.
// Every part but one must look like performers: an ensemble, a list of
// names, or the album's own artist. The remaining part is the composer
// candidate. It is
//   high    when something independent names the same person: the album or
//           track title, the catalogue system in the title (BWV is Bach), or
//           a composer the library already knows;
//   medium  otherwise. Medium credits may make a track reviewable, but never
//           make a work on their own.
// Anything else (no parts, two candidates, a candidate that isn't a name)
// infers nothing.

const plain = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const clean = (value) => String(value || "").trim().replace(/\s+/g, " ");

const PARTS = /\s*;\s*|\s+\/\s+|\s+[—–-]\s+/;
const ENSEMBLE =
  /\b(orchestr\w*|orchester|orkest\w*|philharmoni\w*|symphon\w*|sinfoni\w*|ensemble\w*|quartet\w*|quartett\w*|quatuor|quintet\w*|trio|choir\w*|chor\w*|coro|chorus|consort\w*|singers|players|soloists|camerata|academy|academie|akademie|band|cappella|capella|kammer\w*|virtuos\w*|musici|baroque|collegium|concerto|concert|staatskapelle|gewandhaus\w*|opera|operas|oper|cellists|brass|strings|voices)\b/i;
const LIST = /,|&|\s(?:and|und|et|e|y|with|feat\.?|featuring)\s/i;
const NAME = /^[\p{Lu}][\p{L}'’.-]*(?:\s+(?:[\p{Lu}][\p{L}'’.-]*|van|von|der|den|de|des|da|di|du|del|della|la|le|y|zu|ten|ter|af))*$/u;

// Catalogue systems tied to one composer, as the title shows them.
const CATALOGUE_OWNERS = [
  [/\bBWV\s*\d/i, "bach"],
  [/\bBuxWV\s*\d/i, "buxtehude"],
  [/\bSWV\s*\d/i, "schutz"],
  [/\bTWV\s*\d/i, "telemann"],
  [/\bHWV\s*\d/i, "handel"],
  [/\bRV\s*\d/, "vivaldi"],
  [/\bK(?:V|\.)?\s*\d+[a-z]?\b/, "mozart"],
  [/\bHob\.?\s*[IVXL]+/i, "haydn"],
  [/\bWoO\s*\d/i, "beethoven"],
  [/\bD\.?\s*\d{2,3}[a-z]?\b/, "schubert"],
  [/\bS\.\s*\d/, "liszt"],
  [/\b(?:Sz\.?|BB)\s*\d/, "bartok"],
  [/,\s*(?:L\.|CD)\s*\d/, "debussy"],
  [/,\s*M\.\s*\d/, "ravel"],
  [/\bWWV\s*\d/, "wagner"],
  [/\bFP\s*\d/, "poulenc"],
  [/\bTrV\s*\d/i, "strauss"],
  [/\bJB\s*\d/, "smetana"],
  [/\bTh\.?\s*\d/, "tchaikovsky"],
  [/,\s*Z\.?\s*\d/, "purcell"],
];

// "Wolfgang Amadeus Mozart" -> "mozart"; "Bedřich Smetana" -> "smetana";
// "Josquin des Prez" -> "prez" (the last word is enough to look for).
export const surnameOf = (name) => plain(name).split(" ").filter(Boolean).at(-1) || "";
const hasWord = (text, word) => word.length >= 3 && ` ${plain(text)} `.includes(` ${word} `);

function performerLike(part, albumArtists) {
  const words = plain(part);
  if (!words) return true;
  if (ENSEMBLE.test(part) || LIST.test(part)) return true;
  return albumArtists.some((artist) => artist === words || ` ${artist} `.includes(` ${words} `) || ` ${words} `.includes(` ${artist} `));
}

// Returns null, or { composers: [name], performers: [parts], confidence,
// evidence: [what corroborated it] }. `knownComposers` holds plain() names
// of people the library already credits as composers.
export function artistCredits(hints = {}, { knownComposers = null } = {}) {
  if (Array.isArray(hints.composer) && hints.composer.length) return null;
  const parts = clean(hints.artist).split(PARTS).map(clean).filter(Boolean);
  if (parts.length < 2) return null;
  const albumArtists = clean(hints.albumArtist)
    .split(/\s*(?:;|,|&|\/|\s+(?:and|und|with)\s+)\s*/i)
    .map(plain)
    .filter((name) => name.length >= 3);
  const candidates = parts
    .filter((part) => !performerLike(part, albumArtists))
    .filter((name) => {
      const words = name.split(/\s+/);
      // The same name twice ("Moriz Rosenthal; Moriz Rosenthal") is a performer.
      return words.length <= 5 && !/\d|:/.test(name) && NAME.test(name) && parts.filter((part) => plain(part) === plain(name)).length === 1;
    })
    .map((name) => ({ name, evidence: corroboration(name, hints, knownComposers) }));
  // One name left is the candidate. Several (a composer beside a soloist):
  // the one thing else names is the composer, and the rest perform.
  const backed = candidates.filter((candidate) => candidate.evidence.length);
  const chosen = candidates.length === 1 ? candidates[0] : backed.length === 1 ? backed[0] : null;
  if (!chosen) return null;
  return {
    composers: [chosen.name],
    performers: parts.filter((part) => part !== chosen.name),
    confidence: chosen.evidence.length ? "high" : "medium",
    evidence: chosen.evidence,
  };
}

function corroboration(name, hints, knownComposers) {
  const surname = surnameOf(name);
  const evidence = [];
  if (hasWord(hints.album, surname)) evidence.push("album title");
  if (hasWord(hints.title, surname) || hasWord(hints.work, surname)) evidence.push("track title");
  const titled = `${hints.title || ""} ${hints.work || ""}`;
  if (CATALOGUE_OWNERS.some(([pattern, owner]) => owner === surname && pattern.test(titled))) evidence.push("catalogue number");
  if (knownComposers?.has(plain(name))) evidence.push("known composer");
  return evidence;
}

// The composers a track's evidence names, tagged or credibly inferred.
export function composersOf(hints = {}, options) {
  if (Array.isArray(hints.composer) && hints.composer.length) return hints.composer;
  const credit = artistCredits(hints, options);
  return credit?.confidence === "high" ? credit.composers : [];
}

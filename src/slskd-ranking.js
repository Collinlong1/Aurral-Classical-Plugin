// What to search Soulseek for, and how to rank and reject what it answers,
// for classical requests. Pure: no network, no files. The ladder and the
// thresholds are fixed (Deployment Spec v3.2: never configurable).
import { fold, words as foldedWords } from "./search/normalize.js";
import { catalogueNumber, searchWords, shortWorkTitle, surname } from "./works.js";

// A search stops climbing the ladder once a folder lines up with the release
// and scores at least this; below it, the next step may find a better one.
export const GOOD_SCORE = 60;
// Below this a candidate is ambiguous: offered in a person's manual search,
// never taken automatically.
export const REVIEW_SCORE = 45;

// Search texts, in the order of the v0.2 ladder. Each step names who plays;
// only the last, a broad work search, does not, and anything it finds must
// still name a performer to be kept. The composer never stands in for the
// performer.
export function searchLadder(info, { albumTitle = "" } = {}) {
  if (!info?.performer) return [];
  const performer = surname(info.performer);
  const conductor = info.conductor && info.conductor !== info.performer ? surname(info.conductor) : "";
  const ensemble = info.ensemble && info.ensemble !== info.performer ? surname(info.ensemble) : "";
  const composer = surname(info.composer);
  const work = shortWorkTitle(info.workTitle);
  const catalogue = catalogueNumber(info.workTitle) || catalogueNumber(info.movementTitle);
  const album = searchWords(albumTitle);
  const steps = [
    { step: 1, label: "Performer + album", parts: [performer, album] },
    { step: 2, label: "Performer + work", parts: [performer, work, catalogue] },
    { step: 3, label: "Conductor or orchestra + album", parts: [conductor || ensemble, album], skip: !(conductor || ensemble) },
    { step: 4, label: "Performer + composer + work", parts: [performer, composer, work] },
    { step: 5, label: "Broad work search", parts: [composer, work, catalogue] },
  ];
  const seen = new Set();
  const ladder = [];
  for (const { step, label, parts, skip } of steps) {
    if (skip) continue;
    const query = searchWords(parts.filter(Boolean).join(" "));
    if (query.split(" ").length < 2 || seen.has(query.toLowerCase())) continue;
    seen.add(query.toLowerCase());
    ladder.push({ step, label, query });
  }
  return ladder;
}

const haystackOf = (folder) => ` ${foldedWords([folder.directory, ...folder.files.map((f) => f.filename)].join(" ")).join(" ")} `;
const has = (haystack, name) => {
  const wanted = foldedWords(name);
  return wanted.length > 0 && wanted.every((word) => haystack.includes(` ${word} `));
};
const coverage = (haystack, text) => {
  const wanted = foldedWords(text).filter((word) => word.length > 1);
  return wanted.length ? wanted.filter((word) => haystack.includes(` ${word} `)).length / wanted.length : 0;
};

// One folder's score against the request, with the reasons for it. A folder
// naming none of the people who play is rejected: a composer's name alone
// never qualifies a recording.
export function scoreFolder(folder, info, { albumTitle = "", movements = [] } = {}) {
  const haystack = haystackOf(folder);
  const reasons = [];
  let score = 0;
  const performer = surname(info.performer);
  const conductor = info.conductor && info.conductor !== info.performer ? surname(info.conductor) : "";
  const ensemble = info.ensemble && info.ensemble !== info.performer ? surname(info.ensemble) : "";
  const hasPerformer = has(haystack, performer);
  const hasConductor = Boolean(conductor) && has(haystack, conductor);
  const hasEnsemble = Boolean(ensemble) && has(haystack, ensemble);
  if (!hasPerformer && !hasConductor && !hasEnsemble)
    return {
      score: 0,
      rejected: info.composer && has(haystack, surname(info.composer)) ? "names the composer but none of the performers" : "names none of the performers",
      reasons,
    };
  if (hasPerformer) (score += 30), reasons.push(`performer ${performer}`);
  if (hasConductor) (score += 12), reasons.push(`conductor ${conductor}`);
  if (hasEnsemble) (score += 12), reasons.push(`ensemble ${ensemble}`);
  const album = coverage(haystack, albumTitle);
  if (album > 0) (score += Math.round(album * 20)), reasons.push(`release title ${Math.round(album * 100)}%`);
  const work = coverage(haystack, shortWorkTitle(info.workTitle));
  if (work > 0) (score += Math.round(work * 10)), reasons.push(`work ${Math.round(work * 100)}%`);
  const catalogue = catalogueNumber(info.workTitle) || catalogueNumber(info.movementTitle);
  if (catalogue && coverage(haystack, catalogue) === 1) (score += 10), reasons.push(`catalogue ${catalogue}`);
  if (movements.length) {
    const named = movements.filter((title) => coverage(haystack, title) >= 0.5).length / movements.length;
    if (named > 0) (score += Math.round(named * 8)), reasons.push(`movements ${Math.round(named * 100)}%`);
  }
  if (folder.format === "flac") (score += 5), reasons.push("lossless");
  return { score: Math.min(score, 100), rejected: null, reasons };
}

const folderKey = (folder) => `${fold(folder.directory.split(/[\\/]/).pop())}|${folder.files.map((f) => f.size).join(",")}`;

// Ranks candidates (each { folders, score }) and marks the copies of one
// folder shared by several users: the best placed stays first, its copies
// follow it as fallbacks.
export function rankCandidates(candidates) {
  const sorted = [...candidates].sort((a, b) => b.match.score - a.match.score || a.availability - b.availability);
  const firstOf = new Map();
  for (const candidate of sorted) {
    const key = candidate.folders.map(folderKey).join("||");
    if (firstOf.has(key)) candidate.duplicateOf = firstOf.get(key);
    else firstOf.set(key, `${candidate.username}:${candidate.folders[0].directory}`);
  }
  const unique = sorted.filter((c) => !c.duplicateOf);
  return unique.flatMap((c) => [c, ...sorted.filter((d) => d.duplicateOf === `${c.username}:${c.folders[0].directory}`)]);
}

export const isAmbiguous = (candidate) => candidate.match.score < REVIEW_SCORE;

// A candidate exists only when its files line up with the release (every
// track there, every length within 2 seconds): the strongest evidence a
// folder is this recording. A whole release counts more than one disc or
// one track taken from another edition.
export function withLineUp(match, { whole }) {
  return {
    ...match,
    score: Math.min(100, match.score + (whole ? 25 : 20)),
    reasons: [...match.reasons, whole ? "every track lines up with the release" : "the track lines up with an edition of the release"],
  };
}

import { DEFAULT_ORDER, ROLES } from "./resolver.js";

export const DEFAULT_SEPARATOR = " — ";
export const DEFAULT_COMPARE_COUNT = 10;
const ROLE_ALIASES = {
  composer: "composers", composers: "composers",
  arranger: "arrangers", arrangers: "arrangers",
  soloist: "soloists", soloists: "soloists",
  ensemble: "ensembles", ensembles: "ensembles", orchestra: "ensembles", orchestras: "ensembles",
  conductor: "conductors", conductors: "conductors",
  credited: "credited",
};

// "composers, soloists, conductors" -> roles. People credited on the
// recording but not placed in a role ("credited") come last unless listed.
export function parseOrder(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return [...DEFAULT_ORDER];
  const roles = [];
  for (const word of raw.toLowerCase().split(/[\s,;>|/]+/).filter(Boolean)) {
    const role = ROLE_ALIASES[word];
    if (!role) throw new Error(`Name order: "${word}" isn't a role. Use ${ROLES.slice(0, 5).join(", ")}.`);
    if (!roles.includes(role)) roles.push(role);
  }
  if (!roles.includes("credited")) roles.push("credited");
  return roles;
}

// Kept as typed when it has spaces around it; a bare "—" or "/" gets them.
export function parseSeparator(value) {
  const raw = String(value ?? "");
  if (!raw.trim()) return DEFAULT_SEPARATOR;
  if (raw !== raw.trim()) return raw;
  return /^[,;]$/.test(raw) ? `${raw} ` : ` ${raw} `;
}

export function compareCount(settings) {
  const n = Math.round(Number(settings.compareCount));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 25) : DEFAULT_COMPARE_COUNT;
}

export function slskdSettings(settings) {
  const url = String(settings.slskdUrl || "").trim().replace(/\/+$/, "");
  const apiKey = String(settings.slskdApiKey || "").trim();
  const downloadFolder = String(settings.slskdDownloadFolder || "").trim();
  return { url, apiKey, downloadFolder, configured: Boolean(url && apiKey) };
}

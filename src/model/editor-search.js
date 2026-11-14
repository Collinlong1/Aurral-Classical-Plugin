import path from "node:path";

// Basic editor filtering, shared by catalogue results and the owned-file chooser.
// This does not perform provider identification or introduce the later classical search index.
export const searchText = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export const matchesSearch = (value, query) => {
  const haystack = searchText(value);
  return searchText(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
};
// Every owned track, or one album's (through the track_album index).
export function ownedTracks(catalogue, { albumId = null } = {}) {
  return catalogue.db
    .prepare(
      `SELECT t.*,c.state AS classification FROM track_link t
    LEFT JOIN classification c ON c.target_id=t.id WHERE t.state='active'
    ${albumId === null ? "" : "AND CAST(json_extract(t.evidence,'$.albumId') AS TEXT)=?"}
    ORDER BY t.created_at,t.id`,
    )
    .all(...(albumId === null ? [] : [String(albumId)]))
    .map((row) => {
      const evidence = JSON.parse(row.evidence),
        hints = evidence.hints || {};
      const title =
        hints.title || evidence.title || path.basename(evidence.path);
      const album = hints.album || "",
        artist = hints.artist || hints.albumArtist || evidence.artist || "";
      return {
        ...row,
        evidence,
        title,
        album,
        artist,
        label: [title, artist, album].filter(Boolean).join(" — "),
        search: [
          title,
          album,
          artist,
          hints.albumArtist,
          ...(hints.composer || []),
          hints.work,
          evidence.path,
          evidence.albumId,
        ]
          .filter(Boolean)
          .join(" "),
      };
    });
}

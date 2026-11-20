import fs from "node:fs/promises";
import path from "node:path";

// No new DB is created by legacy tagging. An established model decision is authoritative.
export async function modelAllowsTagging(ctx, realPath) {
  const filename = path.join(ctx.dataFolder, "model", "classical.sqlite");
  try {
    await fs.access(filename);
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
  let db;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(filename, { readOnly: true });
    const rows = db
      .prepare(
        `SELECT t.state AS link_state,c.state FROM track_link t
      LEFT JOIN classification c ON c.target_id=t.id
      WHERE json_extract(t.evidence,'$.observedRealPath')=? OR json_extract(t.evidence,'$.path')=? OR json_extract(t.evidence,'$.readPath')=?`,
      )
      .all(realPath, realPath, realPath);
    return (
      !rows.length ||
      rows.every(
        (row) => row.link_state === "active" && row.state === "classical",
      )
    );
  } catch (error) {
    ctx.log?.(`Classical model cannot authorize tagging: ${error.message}`);
    return false;
  } finally {
    db?.close();
  }
}

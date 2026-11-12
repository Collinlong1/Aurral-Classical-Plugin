// Offline/local catalogue maintenance. Never connects to the Aurral server.
import path from "node:path";
import { openCatalogue } from "../src/model/catalogue.js";
import { restoreDatabase } from "../src/model/database.js";
import { classificationReport, formatReport, openModelReadOnly } from "../src/model/classification-report.js";

const [command, folder, file, flag] = process.argv.slice(2);
if (command === "classification" && folder) {
  // Read-only dry run: opens the model database read-only, writes nothing.
  const args = process.argv.slice(4);
  const albumAt = args.indexOf("--album");
  const db = await openModelReadOnly(path.resolve(folder));
  try {
    const report = classificationReport(db, {
      albumId: albumAt >= 0 ? args[albumAt + 1] : null,
      all: args.includes("--all"),
    });
    console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : formatReport(report));
  } finally {
    db.close();
  }
} else if (
  !folder ||
  !["status", "backup", "restore"].includes(command) ||
  (command !== "status" && !file)
) {
  console.error(
    "Usage: node scripts/model-admin.mjs status MODEL_FOLDER | backup MODEL_FOLDER DESTINATION | restore MODEL_FOLDER BACKUP --offline | classification MODEL_FOLDER [--album ID] [--all] [--json]",
  );
  process.exitCode = 1;
} else if (command === "restore") {
  await restoreDatabase(
    path.resolve(file),
    path.resolve(folder, "classical.sqlite"),
    { offline: flag === "--offline" },
  );
  console.log(
    "Compatible catalogue backup restored. Restart the matching plugin version.",
  );
} else {
  const c = await openCatalogue(path.resolve(folder));
  try {
    if (command === "status")
      console.log(JSON.stringify(c.diagnostics(), null, 2));
    else {
      await c.backup(path.resolve(file));
      console.log("Verified catalogue backup created.");
    }
  } finally {
    c.close();
  }
}

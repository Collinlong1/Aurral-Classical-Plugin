import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const load = (file) => import(pathToFileURL(path.join("/app",file)));
const { userOps, dbOps } = await load("backend/db/helpers/index.ts");
const { hashPassword } = await load("backend/middleware/passwordHash.ts");
const { scanMusicRoot } = await load("backend/services/libraryFileScanner.ts");
const { refreshInstalledPlugins, updatePlugin } = await load("backend/services/plugins/pluginService.ts");
for (const [name,role] of [["fixture-admin","admin"],["fixture-one","user"],["fixture-two","user"]]) {
  let user = userOps.getAllUsers().find((u) => u.username === name);
  if (!user) user = userOps.createUser(name,await hashPassword("fixture-password-only"),role,{accessPlaylists:true,addAlbum:false});
  userOps.setApiKey(user.id, `${name}-synthetic-key-0000000000000000`);
}
await fs.cp("/fixtures", "/library", { recursive:true });
await fs.mkdir("/config/plugins/aurral-classical", {recursive:true});
for (const file of ["manifest.json","index.js"]) await fs.copyFile(`/plugin/${file}`,`/config/plugins/aurral-classical/${file}`);
if (!(await fs.stat("/config/fixture-seeded").catch(() => null))) {
  dbOps.updateSettings({ integrations: {}, flows: [], staticPlaylists: [] });
  await fs.writeFile("/config/fixture-seeded", "synthetic-only\n");
}
await refreshInstalledPlugins();
dbOps.updateSettings({ onboardingComplete: true });
updatePlugin("aurral-classical",{enabled:true,settings:{enableFileWrites:false,mbMirror:"http://providers:5030",slskdUrl:"http://providers:5030",slskdApiKey:"fixture-only"}});
await scanMusicRoot({rootPath:"/library",source:"aurral"});
console.log("Disposable fixture users, library and plugin ready");

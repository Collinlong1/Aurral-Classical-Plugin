// Test-only relay for the disposable Compose fixture; not a plugin service.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import readline from "node:readline";
const inner = `import fs from 'node:fs/promises';await fs.access('/config/fixture-seeded');import http from 'node:http';import readline from 'node:readline';readline.createInterface({input:process.stdin}).on('line',line=>{const p=JSON.parse(line);const r=http.request({hostname:'127.0.0.1',port:3001,path:p.url,method:p.method,headers:p.headers},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>console.log(JSON.stringify({id:p.id,status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('base64')})));});r.setTimeout(30000,()=>r.destroy());r.on('error',e=>console.log(JSON.stringify({id:p.id,status:502,headers:{},body:Buffer.from(e.message).toString('base64')})));r.end(Buffer.from(p.body,'base64'));});`;
const child = spawn(
  "docker",
  [
    "exec",
    "-i",
    process.env.EDITOR_TEST_CONTAINER || "aurral-classical-phase1-aurral-1",
    "node",
    "--input-type=module",
    "-e",
    inner,
  ],
  { stdio: ["pipe", "pipe", "inherit"] },
);
let next = 0;
const pending = new Map();
readline.createInterface({ input: child.stdout }).on("line", (line) => {
  const r = JSON.parse(line),
    res = pending.get(r.id);
  if (!res) return;
  pending.delete(r.id);
  const headers = { ...r.headers };
  delete headers.connection;
  delete headers["transfer-encoding"];
  res.writeHead(r.status, headers);
  res.end(Buffer.from(r.body, "base64"));
});
const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (b) => chunks.push(b));
  req.on("end", () => {
    const id = ++next;
    pending.set(id, res);
    child.stdin.write(
      JSON.stringify({
        id,
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("base64"),
      }) + "\n",
    );
  });
});
server.on("upgrade", (_req, socket) =>
  socket.end("HTTP/1.1 426 Upgrade Required\r\n\r\n"),
);
server.listen(Number(process.env.EDITOR_RELAY_PORT || 3305), "127.0.0.1", () =>
  console.log("Fixture-only HTTP relay ready"),
);
process.on("SIGTERM", () => {
  child.kill();
  server.close();
});

import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import worker from '../backend/worker.mjs';
import { openDB } from './sqlite.mjs';
await mkdir('work', { recursive: true });
const db = openDB('work/local.sqlite');
db.exec(await readFile('backend/schema.sql', 'utf8'));
const root = resolve('public');
const port = Number(process.env.PORT || 8787);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
const env = { DB: db, LOCAL_DEV: true, ALLOWED_ORIGINS: `http://127.0.0.1:${port},http://localhost:${port}` };
const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 4096) { res.writeHead(413); res.end('Request too large'); return; } chunks.push(chunk); }
      const request = new Request(url, { method: req.method, headers: req.headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
      const result = await worker.fetch(request, env);
      res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(Buffer.from(await result.arrayBuffer())); return;
    }
    const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(path); res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}\nCreate a local admin with: powershell -File scripts/Setup-Admin.ps1 -Local`));
function stop() { server.close(() => { db.close(); process.exit(0); }); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);

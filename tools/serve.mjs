import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, relative } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const allowed = new Set(['index.html', 'policy/index.html', 'guide/index.html', 'info-pages.css', 'status.js', 'toss-support-qr.png', 'app.js', 'config.js', 'radar-core.js', 'performance-core.js', 'performance.js', 'ranking.js', 'live.js', 'data/price-history-2026.js', 'data/performance-2026-h1.js', 'data/performance-2026-07.js', 'data/performance-2026-08.js', 'data/performance-2026-09.js', 'styles.css', 'workspace.css', 'chat.css', 'chat-settings.js', 'board.js', 'news.js', 'paper.js', 'paper.css', 'asset.js', 'asset.css', 'news.css', 'small-lot.css', 'calendar-embed.css']);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
const port = Number(process.env.PORT || 4173);
http.createServer(async (req, res) => {
  let pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (pathname === '/policy' || pathname === '/policy/') pathname = '/policy/index.html';
  if (pathname === '/guide' || pathname === '/guide/') pathname = '/guide/index.html';
  const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  const name = relative(root, path).replaceAll('\\', '/');
  if (!allowed.has(name)) { res.writeHead(404); res.end('Not found'); return; }
  try { const data = await readFile(path); res.writeHead(200, { 'Content-Type': mime[extname(path)], 'Cache-Control': 'no-store' }); res.end(data); }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`공모주 레이더: http://127.0.0.1:${port}`));

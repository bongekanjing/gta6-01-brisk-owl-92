// Probe: does each shot scene actually frame the player's car? Development tool only.
const { createServer } = require('node:http');
const { readFile, writeFile, unlink } = require('node:fs/promises');
const { join, resolve, extname } = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = resolve(__dirname, '../game');
const PORT = 8136;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const scene = process.argv[2] || 'city';

const PAGE = `<!doctype html><meta charset=utf-8><body style="margin:0">
<iframe id="f" src="/index.html?shot=${scene}&seed=20261119" style="width:1280px;height:720px;border:0"></iframe>
<script>
setTimeout(() => {
  let out = {};
  try {
    const w = document.getElementById('f').contentWindow;
    out = { frame: w.__carFrame ? w.__carFrame() : 'no hook' };
  } catch (e) { out.fatal = String(e); }
  document.title = 'R ' + JSON.stringify(out);
}, 14000);
</script>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = join(ROOT, url.pathname === '/' ? '/index.html' : url.pathname);
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('nf'); }
});

server.listen(PORT, async () => {
  await writeFile(join(ROOT, '__ndc.html'), PAGE);
  const p = spawn('/root/.hermes/tools/chromium-1208/chrome-linux64/chrome', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720', '--virtual-time-budget=40000', '--dump-dom',
    `http://127.0.0.1:${PORT}/__ndc.html`,
  ]);
  let o = '';
  p.stdout.on('data', (d) => { o += d; });
  p.on('exit', async () => {
    const m = o.match(/<title>R (.*?)<\/title>/s);
    console.log(scene, m ? m[1] : o.slice(-600));
    try { await unlink(join(ROOT, '__ndc.html')); } catch {}
    server.close();
  });
});

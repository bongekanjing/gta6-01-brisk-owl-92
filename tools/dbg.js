// Probe: does syncMeshes() actually build cop meshes for the chase scene? Development tool only.
const { createServer } = require('node:http');
const { readFile, writeFile, unlink } = require('node:fs/promises');
const { join, resolve, extname } = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = resolve(__dirname, '../game');
const PORT = 8133;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

const PAGE = `<!doctype html><meta charset=utf-8><body style="margin:0">
<iframe id="f" src="/index.html?shot=chase&seed=20261119" style="width:1280px;height:720px;border:0"></iframe>
<script>
setTimeout(() => {
  const out = {};
  try {
    const w = document.getElementById('f').contentWindow;
    out.dbg = w.__dbg ? w.__dbg() : 'no dbg';
  } catch (e) { out.fatal = String(e); }
  document.title = 'R ' + JSON.stringify(out);
}, 12000);
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
  await writeFile(join(ROOT, '__dbg.html'), PAGE);
  const p = spawn('/root/.hermes/tools/chromium-1208/chrome-linux64/chrome', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720', '--virtual-time-budget=35000', '--dump-dom',
    `http://127.0.0.1:${PORT}/__dbg.html`,
  ]);
  let o = '';
  p.stdout.on('data', (d) => { o += d; });
  p.on('exit', async () => {
    const m = o.match(/<title>R (.*?)<\/title>/s);
    console.log(m ? m[1] : o.slice(-800));
    try { await unlink(join(ROOT, '__dbg.html')); } catch {}
    server.close();
  });
});

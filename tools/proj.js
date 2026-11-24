// Probe: where does the player's car land in screen space for each shot scene? Development tool only.
const { createServer } = require('node:http');
const { readFile, writeFile, unlink } = require('node:fs/promises');
const { join, resolve, extname } = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = resolve(__dirname, '../game');
const PORT = 8134;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

const PAGE = `<!doctype html><meta charset=utf-8><body style="margin:0">
<iframe id="f" src="/index.html?shot=city&seed=20261119" style="width:1280px;height:720px;border:0"></iframe>
<script>
setTimeout(() => {
  const out = {};
  try {
    const w = document.getElementById('f').contentWindow;
    const W = w.__world;
    const p = W.state.player;
    out.mode = p.mode;
    out.player = [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10, Math.round(p.angle * 1000) / 1000];
    const car = W.state.cars[p.car];
    out.car = car ? [Math.round(car.x * 10) / 10, Math.round(car.z * 10) / 10, Math.round(car.angle * 1000) / 1000] : null;
    out.dbgCam = w.__dbg().cam;
  } catch (e) { out.fatal = String(e); }
  document.title = 'R ' + JSON.stringify(out);
}, 13000);
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
  await writeFile(join(ROOT, '__proj.html'), PAGE);
  const p = spawn('/root/.hermes/tools/chromium-1208/chrome-linux64/chrome', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720', '--virtual-time-budget=38000', '--dump-dom',
    `http://127.0.0.1:${PORT}/__proj.html`,
  ]);
  let o = '';
  p.stdout.on('data', (d) => { o += d; });
  p.on('exit', async () => {
    const m = o.match(/<title>R (.*?)<\/title>/s);
    console.log(m ? m[1] : o.slice(-600));
    try { await unlink(join(ROOT, '__proj.html')); } catch {}
    server.close();
  });
});

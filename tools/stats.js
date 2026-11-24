// Report what the scene actually contains for one shot scene: mesh counts by group, and whether
// the traffic pool produced any visible meshes near the camera. Development tool only.
const { createServer } = require('node:http');
const { readFileSync, writeFileSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const { join, resolve, extname } = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = resolve(__dirname, '../game');
const PORT = 8127;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };

const PROBE = `<!doctype html><meta charset=utf-8><body style="margin:0">
<iframe id="f" src="/index.html?shot=${process.argv[2] || 'city'}&seed=20261119" style="width:1280px;height:720px;border:0"></iframe>
<script>
setTimeout(() => {
  const w = document.getElementById('f').contentWindow;
  const out = { ready: w.__shotReady, frames: w.__shotFrames };
  const st = w.__dbg;
  if (st) out.stats = st();
  document.title = 'PROBE' + JSON.stringify(out);
}, 9000);
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

server.listen(PORT, () => {
  writeFileSync(join(ROOT, '__probe.html'), PROBE);
  const p = spawn('/root/.hermes/tools/chromium-1208/chrome-linux64/chrome', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--virtual-time-budget=25000', '--dump-dom',
    `http://127.0.0.1:${PORT}/__probe.html`,
  ]);
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.on('exit', () => {
    const m = out.match(/<title>PROBE(.*?)<\/title>/s);
    console.log(m ? JSON.stringify(JSON.parse(m[1]), null, 1) : out.slice(0, 600));
    server.close();
  });
});

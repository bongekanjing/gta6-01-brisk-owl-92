// Is the directional light's shadow map actually covering the city? Reads the shadow camera's
// projection and samples the rendered frame under cars vs. clear road. Development tool only.
const { createServer } = require('node:http');
const { readFile, writeFile, unlink } = require('node:fs/promises');
const { join, resolve, extname } = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = resolve(__dirname, '../game');
const PORT = 8131;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

const PAGE = `<!doctype html><meta charset=utf-8><body style="margin:0;background:#000">
<canvas id="c" width="1280" height="720"></canvas>
<script type="module">
const out = {};
try {
  const THREE = await import('/vendor/three.min.js');
  const mod = await import('/src/render.js');
  const plan = await import('/src/city.js');
  const rnd = await import('/src/random.js');
  const canvas = document.getElementById('c');
  const view = mod.createRenderer(canvas);
  view.resize(1280, 720);
  const p = plan.createRandomPlan(rnd.createRandom(20261119));
  view.build(p);
  view.follow(0, 30);

  // render.js exports the sun directly.
  const sun = view.sun;
  out.sawSun = !!sun;
  if (sun) {
    const c = sun.shadow.camera;
    out.shadowEnabled = sun.castShadow;
    out.frustum = { l: c.left, r: c.right, t: c.top, b: c.bottom, n: c.near, f: c.far };
    out.projElements = c.projectionMatrix.elements.slice(0, 6).map((v) => Math.round(v * 1000) / 1000);
    out.lightPos = sun.position.toArray().map((v) => Math.round(v));
  }
  out.info = { calls: view.renderer.info.render.calls, tris: view.renderer.info.render.triangles };
  if (sun && sun.shadow.map) out.mapSize = [sun.shadow.map.width, sun.shadow.map.height];

  // Render, then measure a horizontal band of the road well in front of the camera and count how
  // many pixels are markedly darker than the band's median — a cast shadow population.
  view.render();
  const gl = view.renderer.getContext();
  const px = new Uint8Array(1280 * 720 * 4);
  gl.readPixels(0, 0, 1280, 720, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const lum = [];
  for (let y = 40; y < 260; y += 1) {          // low rows = near the camera = the roadway
    for (let x = 200; x < 1080; x += 1) {
      const i = ((720 - 1 - y) * 1280 + x) * 4;
      lum.push(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    }
  }
  lum.sort((a, b) => a - b);
  const median = lum[(lum.length / 2) | 0];
  const p05 = lum[(lum.length * 0.02) | 0];
  out.lumMedian = Math.round(median);
  out.lumP02 = Math.round(p05);
  out.spread = Math.round(median - p05);
  document.title = 'R ' + JSON.stringify(out);
} catch (e) { document.title = 'R ' + JSON.stringify({ fatal: String(e && e.stack || e) }); }
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
  await writeFile(join(ROOT, '__shadow.html'), PAGE);
  const p = spawn('/root/.hermes/tools/chromium-1208/chrome-linux64/chrome', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--virtual-time-budget=30000', '--dump-dom',
    `http://127.0.0.1:${PORT}/__shadow.html`,
  ]);
  let o = '';
  p.stdout.on('data', (d) => { o += d; });
  p.on('exit', async () => {
    const m = o.match(/<title>R (.*?)<\/title>/s);
    console.log(m ? m[1] : o.slice(-800));
    try { await unlink(join(ROOT, '__shadow.html')); } catch {}
    server.close();
  });
});

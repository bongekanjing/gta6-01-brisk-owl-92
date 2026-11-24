// Probe: after staging the chase scene, how many cops exist and where do their meshes actually sit?
// Development tool only.
const { createServer } = require('node:http');
const { readFile, writeFile, unlink } = require('node:fs/promises');
const { join, resolve, extname } = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = resolve(__dirname, '../game');
const PORT = 8132;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

const PAGE = `<!doctype html><meta charset=utf-8><body style="margin:0">
<iframe id="f" src="/index.html?shot=chase&seed=20261119" style="width:1280px;height:720px;border:0"></iframe>
<script>
setTimeout(() => {
  const out = {};
  try {
    const w = document.getElementById('f').contentWindow;
    const W = w.__world;
    out.hasWorld = !!W;
    out.ready = w.__shotReady === true;
    out.cops = W.state.cops.length;
    out.copSamples = W.state.cops.slice(0, 5).map((c) => [Math.round(c.x), Math.round(c.z), c.alive]);
    out.player = [Math.round(W.state.player.x), Math.round(W.state.player.z), Math.round(W.state.player.angle * 100) / 100];
    out.wanted = W.state.player.wanted;
    // Count police groups that are visible and inside the camera frustum.
    const THREE = W.__three;
    const cam = W.__camera;
    const scene = W.__scene;
    let groups = 0, visible = 0, inFrustum = 0;
    const boxes = [];
    if (scene) {
      scene.traverse((o) => {
        if (o.isGroup && o.children.length === 6) { // body + cabin + 4 wheels = car maker output
          groups += 1;
          if (o.visible) visible += 1;
        }
      });
    }
    out.carGroups = groups;
    out.carGroupsVisible = visible;
    out.camAt = cam ? cam.position.toArray().map((v) => Math.round(v)) : null;
  } catch (e) { out.fatal = String(e); }
  document.title = 'R ' + JSON.stringify(out);
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

server.listen(PORT, async () => {
  await writeFile(join(ROOT, '__cops.html'), PAGE);
  const p = spawn('/root/.hermes/tools/chromium-1208/chrome-linux64/chrome', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720', '--virtual-time-budget=30000', '--dump-dom',
    `http://127.0.0.1:${PORT}/__cops.html`,
  ]);
  let o = '';
  p.stdout.on('data', (d) => { o += d; });
  p.on('exit', async () => {
    const m = o.match(/<title>R (.*?)<\/title>/s);
    console.log(m ? m[1] : o.slice(-800));
    try { await unlink(join(ROOT, '__cops.html')); } catch {}
    server.close();
  });
});

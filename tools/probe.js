// Diagnose the render: open a scene, read back the framebuffer and report what the GPU actually
// produced, plus the resolved light and material state. Development tool only.
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { join, resolve, extname } = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = resolve(__dirname, '../game');
const PORT = 8126;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = join(ROOT, url.pathname === '/' ? '/index.html' : url.pathname);
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('nf');
  }
});

// A page that runs after the game boots and reports the GPU state.
const PROBE = `<!doctype html><meta charset=utf-8><body style="margin:0;background:#000">
<iframe id="f" src="/index.html?shot=${process.argv[2] || 'city'}&seed=20261119" style="width:1280px;height:720px;border:0"></iframe>
<script>
setTimeout(() => {
  const w = document.getElementById('f').contentWindow;
  const d = w.document;
  const canvas = d.getElementById('view');
  const out = { ready: w.__shotReady, size: [canvas.width, canvas.height], client: [canvas.clientWidth, canvas.clientHeight] };
  let gl = null;
  try { gl = canvas.getContext('webgl2') || canvas.getContext('webgl'); } catch (e) { out.glErr = String(e); }
  if (gl) {
    out.renderer = gl.getParameter(gl.VERSION);
    const px = new Uint8Array(4 * 16);
    // Sample a vertical strip down the middle of the framebuffer.
    const samples = [];
    for (const y of [10, 100, 200, 300, 400, 500, 600, 700]) {
      const b = new Uint8Array(4);
      gl.readPixels(640, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b);
      samples.push(y + ':' + Array.from(b).join(','));
    }
    out.samples = samples;
    out.lost = gl.isContextLost();
  }
  document.title = 'PROBE' + JSON.stringify(out);
}, 6000);
</script>`;

server.listen(PORT, () => {
  const CHROME = '/root/.hermes/tools/chromium-1208/chrome-linux64/chrome';
  const probePath = join(ROOT, '__probe.html');
  require('node:fs').writeFileSync(probePath, PROBE);
  const p = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--virtual-time-budget=20000', '--dump-dom',
    `http://127.0.0.1:${PORT}/__probe.html`,
  ]);
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.on('exit', () => {
    const m = out.match(/<title>PROBE(.*?)<\/title>/s);
    console.log(m ? JSON.stringify(JSON.parse(m[1]), null, 1) : out.slice(0, 800));
    server.close();
  });
});

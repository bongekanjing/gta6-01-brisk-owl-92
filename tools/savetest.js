// Verify the save system round-trips in a real browser: play, save, mutate, reload, confirm restore,
// and confirm a corrupt save is rejected rather than crashing the game. Development tool only.
const { createServer } = require('node:http');
const { readFile, writeFile } = require('node:fs/promises');
const { join, resolve, extname } = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = resolve(__dirname, '../game');
const PORT = 8129;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };

const PAGE = `<!doctype html><meta charset=utf-8><body>
<iframe id="f" src="/index.html" style="width:1000px;height:600px;border:0"></iframe>
<script>
const out = {};
function probe() {
  const w = document.getElementById('f').contentWindow;
  return w;
}
setTimeout(() => {
  try {
    const w = probe();
    const dbg = w.__dbg ? w.__dbg() : null;
    out.booted = !!w.__dbg;

    // Reach into the game the way a player would: press a key, then check the save.
    const W = w.__world;
    if (!W) { out.error = 'no __world handle'; document.title = 'R ' + JSON.stringify(out); return; }

    // Start a game.
    w.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyN' }));
    W.state.player.money = 7321;
    W.state.player.armour = 40;
    W.state.player.x = 88;
    W.state.player.z = -55;
    W.state.mission.index = 2;
    out.saved = W.save();
    out.raw = (w.localStorage.getItem('vice-verano-save-v1') || '').slice(0, 120);

    // Mutate everything, then load it back.
    W.state.player.money = 0;
    W.state.player.armour = 0;
    W.state.player.x = 0;
    W.state.mission.index = 0;
    out.hadSave = W.hasSave();
    out.loaded = W.load();
    out.restored = {
      money: W.state.player.money,
      armour: W.state.player.armour,
      x: Math.round(W.state.player.x),
      z: Math.round(W.state.player.z),
      mission: W.state.mission.index,
    };

    // A corrupt save must be refused, not thrown.
    w.localStorage.setItem('vice-verano-save-v1', '{{{not json');
    out.corruptHasSave = W.hasSave();
    out.corruptLoad = W.load();
    document.title = 'R ' + JSON.stringify(out);
  } catch (e) {
    document.title = 'R ' + JSON.stringify({ fatal: String(e) });
  }
}, 7000);
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
  await writeFile(join(ROOT, '__save.html'), PAGE);
  const p = spawn('/root/.hermes/tools/chromium-1208/chrome-linux64/chrome', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--virtual-time-budget=22000', '--dump-dom',
    `http://127.0.0.1:${PORT}/__save.html`,
  ]);
  let o = '';
  p.stdout.on('data', (d) => { o += d; });
  p.on('exit', async () => {
    const m = o.match(/<title>R (.*?)<\/title>/s);
    console.log(m ? m[1] : o.slice(-500));
    try { await require('node:fs/promises').unlink(join(ROOT, '__save.html')); } catch {}
    server.close();
  });
});

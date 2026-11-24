// Take the game's screenshots: serve game/ over HTTP, drive headless Chrome over the DevTools
// protocol so the viewport is exactly the size we ask for (a plain --screenshot with
// --window-size gives a shorter viewport, which leaves an unpainted band at the bottom), wait for
// window.__shotReady, and save a PNG per scene. Development tool only: not part of the hand-in.
const { createServer } = require('node:http');
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const { join, resolve, extname } = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = resolve(__dirname, '../game');
const OUT = resolve(__dirname, '../screenshots');
const PORT = 8123;
const W = 1280;
const H = 720;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = join(ROOT, url.pathname === '/' ? '/index.html' : url.pathname);
  if (!path.startsWith(ROOT)) {
    res.writeHead(403).end('no');
    return;
  }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

// The gate takes the first screenshot by name as the cover, so the key-art frame has to sort first.
const SCENES = [
  ['1-cover.jpg', 'cover'],
  ['2-city.jpg', 'city'],
  ['3-chase.jpg', 'chase'],
  ['4-mission.jpg', 'mission'],
];

const CHROME = process.env.CHROME || '/root/.hermes/tools/chromium-1208/chrome-linux64/chrome';
const DEBUG_PORT = 9333;

async function connect() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      const v = await r.json();
      return v.webSocketDebuggerUrl;
    } catch {
      await new Promise((d) => setTimeout(d, 200));
    }
  }
  throw new Error('chrome did not expose a debugger');
}

// Minimal CDP client over the built-in WebSocket.
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: ok, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else ok(msg.result);
    } else if (msg.method && events.has(msg.method)) {
      for (const fn of events.get(msg.method)) fn(msg.params);
    }
  });
  const ready = new Promise((ok, no) => {
    ws.addEventListener('open', ok, { once: true });
    ws.addEventListener('error', no, { once: true });
  });
  return {
    ready,
    send(method, params = {}, sessionId) {
      id += 1;
      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      ws.send(JSON.stringify(msg));
      return new Promise((ok, no) => pending.set(id, { resolve: ok, reject: no }));
    },
    on(method, fn) {
      if (!events.has(method)) events.set(method, []);
      events.get(method).push(fn);
    },
    close: () => ws.close(),
  };
}

async function shoot(client, name, scene) {
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => client.send(m, p, sessionId);

  await s('Page.enable');
  await s('Runtime.enable');
  // Pin the viewport so the image and the canvas agree exactly.
  await s('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: 1, mobile: false,
  });
  await s('Emulation.setVisibleSize', { width: W, height: H }).catch(() => {});

  // The cover is shot on a longer lens so the towers do not splay.
  const fov = scene === 'cover' ? '&fov=42' : '';
  await s('Page.navigate', { url: `http://127.0.0.1:${PORT}/?shot=${scene}&seed=20261119${fov}` });

  const t0 = Date.now();
  // Poll for the scene's own ready flag rather than guessing a settle time.
  for (let i = 0; i < 240; i += 1) {
    const r = await s('Runtime.evaluate', {
      expression: 'window.__shotReady === true && window.__shotFrames > 4',
      returnByValue: true,
    });
    if (r.result && r.result.value === true) break;
    await new Promise((d) => setTimeout(d, 100));
  }
  // Two more frames so the last state is definitely on screen.
  await s('Runtime.evaluate', {
    expression: 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))',
    awaitPromise: true, returnByValue: true,
  });

  // The gate caps each screenshot at 256 KiB (262,144 bytes), so encode straight to JPEG and step
  // quality down until the file fits. A cover with a title gradient and a vignette is the one that
  // overruns; the gameplay frames fit at high quality.
  const LIMIT = 256 * 1024 - 1024;
  let quality = 92;
  let data = null;
  for (; quality >= 60; quality -= 6) {
    const shot = await s('Page.captureScreenshot', { format: 'jpeg', quality, captureBeyondViewport: false });
    data = Buffer.from(shot.data, 'base64');
    if (data.length <= LIMIT) break;
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, name), data);
  const info = await s('Runtime.evaluate', {
    expression: 'JSON.stringify({w: innerWidth, h: innerHeight, cw: document.getElementById("view").width, ch: document.getElementById("view").height})',
    returnByValue: true,
  });
  console.log(`${name} (${scene}): ${Date.now() - t0} ms ${info.result.value}`);
  await client.send('Target.closeTarget', { targetId });
}

server.listen(PORT, async () => {
  console.log(`serving ${ROOT} on http://127.0.0.1:${PORT}`);
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--force-device-scale-factor=1',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--user-data-dir=' + join(OUT, '..', '.chrome-profile'),
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    const wsUrl = await connect();
    const client = cdp(wsUrl);
    await client.ready;
    for (const [name, scene] of SCENES) await shoot(client, name, scene);
    client.close();
  } catch (err) {
    console.error('capture failed:', err.message);
    process.exitCode = 1;
  } finally {
    chrome.kill('SIGTERM');
    server.close();
    console.log('done');
  }
});

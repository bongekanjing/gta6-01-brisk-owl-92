// Open one scene in headless Chrome and print every console message and page error.
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { join, resolve, extname } = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = resolve(__dirname, '../game');
const PORT = 8124;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = join(ROOT, url.pathname === '/' ? '/index.html' : url.pathname);
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    console.error('404', url.pathname);
    res.writeHead(404).end('not found');
  }
});

server.listen(PORT, () => {
  const CHROME = '/root/.hermes/tools/chromium-1208/chrome-linux64/chrome';
  const scene = process.argv[2] || 'city';
  const p = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--enable-logging=stderr', '--v=1',
    '--virtual-time-budget=15000',
    '--dump-dom',
    `http://127.0.0.1:${PORT}/?shot=${scene}&seed=20261119`,
  ]);
  let out = '';
  let err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('exit', () => {
    const lines = err.split('\n').filter((l) =>
      /CONSOLE|ERROR|Uncaught|SyntaxError|TypeError|ReferenceError|Failed to (load|fetch)|net::/i.test(l));
    console.log('=== console/errors');
    console.log(lines.slice(0, 40).join('\n') || '(none)');
    console.log('=== overlay content');
    const m = out.match(/<div id="overlay"[^>]*>([\s\S]{0,400})/);
    console.log(m ? m[0].slice(0, 400) : '(no overlay)');
    server.close();
  });
});

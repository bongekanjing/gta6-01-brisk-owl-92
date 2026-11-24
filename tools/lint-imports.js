// Check every static import in game/src resolves to a file that exists and actually exports the
// name. Development tool only: catches the "does not provide an export named" class of error that
// otherwise only shows up as a blank canvas in a screenshot.
const { readFile, readdir } = require('node:fs/promises');
const { join, resolve, dirname } = require('node:path');

const ROOT = resolve(__dirname, '../game/src');
const GAME = resolve(__dirname, '../game');

async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path)));
    else if (entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

function exportsOf(src) {
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const bits = part.trim().split(/\s+as\s+/);
      if (bits.length === 2) names.add(bits[1].trim());
      else if (bits[0].trim()) names.add(bits[0].trim());
    }
  }
  return names;
}

(async () => {
  const all = await files(ROOT);
  const cache = new Map();
  // Vendored libraries are outside src: index them so their imports resolve, without linting them.
  const vendor = await readFile(join(GAME, 'vendor/three.min.js'), 'utf8');
  cache.set(join(GAME, 'vendor/three.min.js'), exportsOf(vendor));
  for (const f of all) cache.set(f, exportsOf(await readFile(f, 'utf8')));
  let bad = 0;
  for (const f of all) {
    const src = await readFile(f, 'utf8');
    for (const m of src.matchAll(/import\s+([^'"]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
      const clause = m[1];
      const spec = m[2];
      if (!spec.startsWith('.')) continue;
      const target = resolve(dirname(f), spec);
      const have = cache.get(target);
      if (!have) {
        console.log(`MISSING FILE  ${f.replace(ROOT, '')} -> ${spec}`);
        bad += 1;
        continue;
      }
      const braces = clause.match(/\{([^}]*)\}/);
      if (!braces) continue;
      for (const part of braces[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        if (!have.has(name)) {
          console.log(`MISSING EXPORT ${f.replace(ROOT, '')} -> ${spec} :: ${name}`);
          bad += 1;
        }
      }
    }
  }
  console.log(bad === 0 ? 'imports ok' : `${bad} problem(s)`);
  process.exit(bad === 0 ? 0 : 1);
})();

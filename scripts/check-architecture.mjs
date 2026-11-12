#!/usr/bin/env node
// Enforces the brick rules for the TypeScript parts (see ARCHITECTURE.md):
//   * shared/ (baseplate) never imports a brick or the base;
//   * a brick reaches another brick only through its index (modules/<brick> or modules/<brick>/index);
//   * a brick never imports the base;
//   * the base uses bricks only through their index.
// Usage: node scripts/check-architecture.mjs [srcDir ...]   (defaults: worker/src web/src)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['worker/src', 'web/src'];
const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}

/** 'shared' | 'brick:<name>' | 'base' for a path inside a source root. */
function zone(root, path) {
  const parts = relative(root, path).split(sep);
  if (parts[0] === 'shared') return 'shared';
  if (parts[0] === 'modules' && parts.length > 1) return `brick:${parts[1]}`;
  return 'base';
}

/** True when `target` is a brick's public entry: modules/<brick> or modules/<brick>/index. */
function isBrickEntry(root, target) {
  const parts = relative(root, target).split(sep);
  return parts[0] === 'modules' && (parts.length === 2 || (parts.length === 3 && /^index(\.tsx?)?$/.test(parts[2])));
}

const problems = [];
for (const rootArg of roots) {
  const root = resolve(rootArg);
  for (const file of files(root)) {
    const from = zone(root, file);
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (!spec.startsWith('.')) continue; // packages are fine
      const target = resolve(dirname(file), spec);
      if (!target.startsWith(root)) continue;
      const to = zone(root, target);
      const where = `${relative(process.cwd(), file)} imports '${spec}'`;
      if (from === 'shared' && to !== 'shared') problems.push(`${where}: the baseplate must not depend on ${to}`);
      else if (from.startsWith('brick:') && to === 'base') problems.push(`${where}: a brick must not import the base`);
      else if (to.startsWith('brick:') && to !== from && !isBrickEntry(root, target))
        problems.push(`${where}: reaches inside ${to}; import its index instead`);
    }
  }
}

if (problems.length) {
  console.error(`Architecture check failed (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`Architecture check passed for ${roots.join(', ')}.`);

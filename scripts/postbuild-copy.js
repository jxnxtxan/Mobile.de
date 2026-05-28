import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const built = join(root, 'dist', 'mobile-ausstattungssuche.user.js');
const target = join(root, 'mobile-ausstattungssuche.js');

if (!existsSync(built)) {
  console.error('Build-Artefakt fehlt:', built);
  process.exit(1);
}

copyFileSync(built, target);
console.log('Kopiert nach', target);

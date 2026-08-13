import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** tsc only emits .js — the renderer's html/css need copying alongside it. */
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(root, 'src', 'renderer', 'sticky');
const to = join(root, 'dist', 'renderer', 'sticky');

mkdirSync(to, { recursive: true });
for (const file of ['index.html', 'sticky.css']) {
  cpSync(join(from, file), join(to, file));
}

console.log('copied renderer assets -> dist/renderer/sticky');

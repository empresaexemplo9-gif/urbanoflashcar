// Generates the PWA / app / desktop icons from the brand source image
// (assets/brand/taxi.webp): trims the surrounding whitespace, then centers the
// taxi on square tiles over a white background. The maskable icon uses a
// smaller content fraction so the subject stays inside the maskable safe area.
//
// Requires ImageMagick (`convert`) on PATH. The generated PNGs are committed,
// so this only needs to run when the source image changes:  npm run icons

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'assets', 'brand', 'taxi.webp');
const OUT = join(ROOT, 'public', 'icons');
const TRIM = join(tmpdir(), 'ufc-taxi-trim.png');

if (!existsSync(SOURCE)) {
  console.error(`Fonte não encontrada: ${SOURCE}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

// 1) Trim the white border down to the taxi's bounding box.
run(['convert', SOURCE, '-fuzz', '6%', '-trim', '+repage', TRIM]);

// 2) size, content-fraction, output filename
const targets = [
  [512, 0.86, 'icon-512.png'],
  [192, 0.86, 'icon-192.png'],
  [512, 0.66, 'maskable-512.png'],
  [180, 0.86, 'apple-touch-icon.png'],
  [32, 0.92, 'favicon-32.png'],
];

for (const [size, fraction, name] of targets) {
  const width = Math.round(size * fraction);
  run([
    'convert', TRIM,
    '-resize', `${width}x`,
    '-background', 'white',
    '-gravity', 'center',
    '-extent', `${size}x${size}`,
    join(OUT, name),
  ]);
  console.log('wrote', name);
}

rmSync(TRIM, { force: true });

function run(args) {
  execFileSync(args[0], args.slice(1), { stdio: 'inherit' });
}

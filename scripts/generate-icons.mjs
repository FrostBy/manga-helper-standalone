/**
 * Generate optimized icons for browser extension
 * Run: node scripts/generate-icons.mjs
 */
import sharp from 'sharp';
import { mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SOURCE = join(ROOT, 'icon.png');
const OUTPUT = join(ROOT, 'public');

const SIZES = [16, 32, 48, 128];

async function generate() {
  await mkdir(OUTPUT, { recursive: true });

  for (const size of SIZES) {
    const output = join(OUTPUT, `icon-${size}.png`);

    await sharp(SOURCE)
      .resize(size, size, { fit: 'contain' })
      .png({ quality: 90, compressionLevel: 9 })
      .toFile(output);

    console.log(`✓ Generated ${output}`);
  }

  console.log('\nDone! Update wxt.config.ts icons:');
  console.log(`
icons: {
  16: 'icon-16.png',
  32: 'icon-32.png',
  48: 'icon-48.png',
  128: 'icon-128.png',
},
`);
}

generate().catch(console.error);

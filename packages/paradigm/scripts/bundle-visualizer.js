/**
 * Bundle the visualizer dist into the CLI package
 * This runs as postbuild to include visualizer assets in npm package
 */

import { cpSync, rmSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const visualizerSrc = resolve(__dirname, '../../prism/dist');
const visualizerDest = resolve(__dirname, '../visualizer-dist');

// Check if visualizer is built
if (!existsSync(visualizerSrc)) {
  console.warn('⚠️  Visualizer dist not found at:', visualizerSrc);
  console.warn('   Run "npm run build" from monorepo root first.');
  console.warn('   Skipping visualizer bundling...');
  process.exit(0);
}

// Clean existing bundle
if (existsSync(visualizerDest)) {
  rmSync(visualizerDest, { recursive: true });
}

// Copy visualizer dist
try {
  cpSync(visualizerSrc, visualizerDest, { recursive: true });
  console.log('✅ Bundled visualizer into CLI package');
  console.log(`   From: ${visualizerSrc}`);
  console.log(`   To:   ${visualizerDest}`);
} catch (error) {
  console.error('❌ Failed to bundle visualizer:', error.message);
  process.exit(1);
}

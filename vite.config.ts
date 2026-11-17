import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

export default defineConfig({
  base: './',
  // the build names itself: playtest records carry it, so a record can be matched to the code that made it
  define: { __BUILD__: JSON.stringify(version) },
  build: { target: 'es2022', outDir: 'dist', assetsInlineLimit: 0 },
  server: { host: '127.0.0.1' },
});

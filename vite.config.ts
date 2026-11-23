import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

// ponytail: file:// blocks module scripts and fetch. The build is one classic script with the catalog inlined. `npm run dev` still fetches articles.json.
function fileOpen(): Plugin {
  return {
    name: 'file-open',
    apply: 'build',
    transformIndexHtml(html) {
      const json = readFileSync('public/articles.json', 'utf8').replace(/</g, '\\u003c');
      return html
        .replaceAll(' type="module"', '')
        .replaceAll(' crossorigin', '')
        .replace(/<link rel="modulepreload"[^>]*>/g, '')
        .replace(/<script src="\.\/assets\//, '<script defer src="./assets/')
        .replace('</body>', `<script type="application/json" id="articles-data">${json}</script></body>`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [preact(), fileOpen()],
  build: {
    modulePreload: false,
    rollupOptions: { output: { format: 'iife', name: 'EngShorts', inlineDynamicImports: true } },
  },
});

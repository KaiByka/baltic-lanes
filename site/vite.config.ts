import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

// Inlines the (small) basemap GeoJSON into index.html so the early-paint
// script needs no network fetch before the map visual appears.
function inlineBasemap(): Plugin {
  const dir = fileURLToPath(new URL('./public/data/basemap/', import.meta.url));
  return {
    name: 'inline-basemap',
    transformIndexHtml(html) {
      const land = readFileSync(dir + 'land.geojson', 'utf8');
      const grat = readFileSync(dir + 'graticule.geojson', 'utf8');
      const payload = `window.__BASEMAP__={land:${land},grat:${grat}};`;
      return html.replace('<!-- BASEMAP_INLINE -->', `<script>${payload}</script>`);
    },
  };
}

// Inlines all emitted CSS into the HTML files at build time: fewer
// render-blocking roundtrips on slow 4G (the CSS is small).
function inlineCss(): Plugin {
  return {
    name: 'inline-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const htmlFiles = Object.values(bundle).filter(
        (f): f is typeof f & { type: 'asset' } => f.type === 'asset' && f.fileName.endsWith('.html'),
      );
      const inlined = new Set<string>();
      for (const file of htmlFiles) {
        const css: string[] = [];
        file.source = file.source.replace(/<link rel="stylesheet"[^>]*>/g, (tag: string) => {
          const m = tag.match(/href="([^"]+)"/);
          const cssFile = m && bundle[m[1].replace(/^\.\//, '')];
          if (cssFile && cssFile.type === 'asset' && cssFile.fileName.endsWith('.css')) {
            css.push(String(cssFile.source));
            inlined.add(cssFile.fileName);
            return '';
          }
          return tag;
        });
        if (css.length) {
          file.source = file.source.replace('</head>', `<style>${css.join('')}</style></head>`);
        }
      }
      for (const name of inlined) delete bundle[name];
    },
  };
}

export default defineConfig({
  plugins: [inlineBasemap(), inlineCss()],
  // Relative base so the same build works at baltic.marespot.com/ and at
  // <user>.github.io/<repo>/ (see README "Custom domain setup").
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        about: fileURLToPath(new URL('./about.html', import.meta.url)),
      },
    },
  },
});

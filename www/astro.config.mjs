// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  site: 'https://getgridline.app',
  compressHTML: true,
  trailingSlash: 'ignore',
  integrations: [
    sitemap({
      lastmod: new Date(),
    }),
    react(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});

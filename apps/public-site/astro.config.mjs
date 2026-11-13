import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import postBuild from './integrations/post-build.mjs';

const site = (process.env.SITE_URL || 'https://www.ari-pst.example').replace(/\/$/, '');

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'never' },
  // Strict CSP (script-src 'self'): never inline scripts or styles.
  vite: { build: { assetsInlineLimit: 0 } },
  i18n: {
    locales: ['he', 'en'],
    defaultLocale: 'he',
    routing: { prefixDefaultLocale: true, redirectToDefaultLocale: false },
  },
  integrations: [
    sitemap({
      i18n: { defaultLocale: 'he', locales: { he: 'he-IL', en: 'en-US' } },
      filter: (url) => !/\/404\/?$/.test(url),
    }),
    postBuild(),
  ],
});

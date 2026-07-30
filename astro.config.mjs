// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { SITE_URL, IS_STAGING } from './src/lib/site-env.mjs';

// Story 1-2. `site` and the indexing polarity BOTH come from src/lib/site-env.mjs
// so a build can never emit production canonicals with staging's noindex, or
// the reverse. One source, imported twice.
export default defineConfig({
  site: SITE_URL,

  // Hostinger serves the built files from a document root, so the site is
  // served at the root path.
  base: '/',

  // G-1. WordPress serves every URL with a trailing slash and the existing
  // canonicals say so. Without this, every URL on the rebuilt site becomes a
  // redirect hop — site-wide, silent, and invisible in review because each
  // individual page still loads fine. It only shows up as diluted link equity
  // and an extra round trip on every navigation.
  //
  // `format: 'directory'` emits /about/index.html so the server resolves
  // /about/ natively; `trailingSlash: 'always'` makes Astro's own canonicals
  // and sitemap agree with that. Both are needed — the first shapes the files,
  // the second shapes the URLs that point at them.
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },

  integrations: [
    // @astrojs/sitemap writes sitemap-index.xml + sitemap-0.xml. The canonical
    // path the SEO brief requires is /sitemap.xml, which public/.htaccess
    // rewrites onto the index. Rewriting is preferred over hand-rolling a
    // sitemap: the integration keeps itself correct as pages are added in 1-6,
    // where a hand-rolled one would silently go stale.
    sitemap({
      // Staging is disallowed wholesale in robots.txt, but emit the sitemap
      // anyway so the artifact is identical in shape to production's and gets
      // exercised on every staging deploy rather than first appearing at
      // cutover.
      filter: (page) => !page.includes('/404'),
    }),
  ],

  // Surfaced for the polarity check and for humans reading a build log.
  vite: {
    define: {
      __SITE_IS_STAGING__: JSON.stringify(IS_STAGING),
    },
  },
});

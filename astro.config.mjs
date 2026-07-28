// @ts-check
import { defineConfig } from 'astro/config';

// Story 1-1 spike config. Deliberately minimal: static output (the default),
// no integrations, no styling. Phase 1 adds the real config once the deploy
// chain in this spike is proven.
export default defineConfig({
  // Hostinger git-deploy serves the built files from a subdomain document
  // root, so the site is served at the root path.
  base: '/',
});

// Story 1-2. robots.txt is GENERATED, not a static file in public/, because it
// has to differ between staging and production. Same single source as the
// layout's noindex, so the two cannot disagree.
//
// ⚠️ A robots.txt mistake here is SILENT (Vigil, VG-3): you never see the
// traffic you did not get. A typo'd or over-broad Disallow costs crawler
// access with no error anywhere. Hence the post-deploy assertion in the deploy
// workflow, which checks the SERVED file rather than trusting this source.
import type { APIRoute } from 'astro';
import { IS_STAGING, SITE_URL } from '../lib/site-env.mjs';

/**
 * AI crawlers we explicitly welcome (UD-18 — Keegan chose permissive).
 *
 * Listing them by name rather than relying on `User-agent: *` is deliberate:
 * it makes the policy READABLE and greppable, so a future "block the scrapers"
 * change is a visible edit to a named list rather than a silent side effect of
 * a wildcard rule.
 *
 * Note Google-Extended is a content-usage control, not a crawler: allowing it
 * lets Google use the content in its AI surfaces, which is exactly what the
 * Business-Profile corroboration work wants.
 */
const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'PerplexityBot',
  'ClaudeBot',
  'Claude-User',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
];

const staging = () =>
  `# Staging. Not the real site — see https://keegansmovementlab.com
# Disallow everything: this host serves a full duplicate of production.
User-agent: *
Disallow: /
`;

const production = () =>
  [
    '# https://keegansmovementlab.com',
    '',
    'User-agent: *',
    'Allow: /',
    '',
    '# AI crawlers explicitly welcomed (UD-18).',
    ...AI_CRAWLERS.flatMap((ua) => [`User-agent: ${ua}`, 'Allow: /', '']),
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  ].join('\n');

export const GET: APIRoute = () =>
  new Response(IS_STAGING ? staging() : production(), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });

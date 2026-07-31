#!/usr/bin/env node
// The build gate. Runs over the WHOLE of dist/, on every page, after every build.
//
// It replaces the inline bash gate that used to live in .github/workflows/deploy.yml.
// That gate had two structural problems, found independently by two agents in the
// same session, and they turned out to be the same problem seen from two sides:
//
//   AG-3 F2 (Argus)  the gate read dist/index.html alone, while six invariants
//                    were stated site-wide ("NAP on every page", "no Review node
//                    on ANY surface"). True only because both pages happened to
//                    share a layout. Nothing enforced it.
//   LN-2 F3 (Lens)   every assertion was HTML-level, and the HTML was perfect,
//                    while the defect ("thePrivacy Act 1988") lived in the
//                    rendered TEXT RUN. A layer the gate never looked at.
//
// Same cause: the assertion surface was narrower than the claim. So this file
// widens both axes at once — every page, and the text as well as the markup.
//
// ⚠️ AG-3 F1, and it is the reason this file takes its polarity from an import
// rather than writing it out. The old gate asserted `noindex` as a LITERAL. A
// production cutover workflow born by copying deploy.yml and keeping
// `SITE_ENV: staging` would have published noindex + staging canonicals +
// `Disallow: /` on the real domain with all seven assertions reporting PASS.
// Argus built that artifact and ran the old assertions against it: 7/7 green.
//
// The fix is that nothing here states what the answer should be. It derives the
// expected polarity from the same module the build derived it from, then
// cross-checks that module against the deploy destination — two independent
// declarations of where this build is going, compared. Today the workflow had
// both and compared neither.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SITE_ENV, INDEXABLE, SITE_URL, GSC_TOKEN } from '../src/lib/site-env.mjs';
import business from '../src/data/business.json' with { type: 'json' };

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = process.argv.find((a) => a.startsWith('--dist='))?.slice('--dist='.length) ?? 'dist';
// resolve, not join — an absolute --dist (a throwaway build in /tmp, which is
// how the falsification tests run) must not be pasted onto the repo root.
const DIST_ABS = resolve(ROOT, DIST);

// The destination this build is actually being published to, declared separately
// by the workflow. Absent locally, which is fine — the cross-check below is the
// one assertion that only makes sense when a deploy is really happening.
const DEPLOY_URL = (process.env.DEPLOY_URL ?? '').trim();

// CI-only artifacts. A local `npm run build` does not produce a build id.
const IN_CI = process.env.CI === 'true';

const SYDNEY = 'Australia/Sydney';
const TODAY_SYDNEY = new Date().toLocaleDateString('en-CA', { timeZone: SYDNEY });

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`::error::${msg}`);
  console.log(`  FAIL  ${msg}`);
};
const pass = (msg) => console.log(`  PASS  ${msg}`);

// ---------------------------------------------------------------------------
// 1. Declaration agreement — the AG-3 F1 fix
// ---------------------------------------------------------------------------
// Neither declaration can be trusted alone. SITE_ENV says which polarity the
// build used; DEPLOY_URL says which domain it is about to land on. A cutover
// that edits one and forgets the other is the exact mistake, and it is invisible
// to every other check in this file because every other check is self-consistent
// with whichever polarity was chosen.

console.log(`Gate: SITE_ENV=${SITE_ENV}, canonical origin ${SITE_URL}, dist=${DIST}\n`);

// AG-4 residual 1 (MEDIUM). The cross-check used to run only `if (DEPLOY_URL)`,
// print SKIP when it was absent, and pass. That is a silent opt-out on the one
// assertion that closes F1 — and the whole premise of F1 is "what happens when
// someone copies this workflow", where the cutover edit touches exactly the
// lines that carry DEPLOY_URL through. Argus probed it: staging artifact, no
// DEPLOY_URL, CI=true -> PASS. Every other check is self-consistent with
// whichever SITE_ENV was chosen, so nothing else would have caught it.
//
// Locally, absent DEPLOY_URL still means "not a deploy" and skipping is right.
// In CI it means the pass-through was dropped, and that is a hard failure.
if (IN_CI && !DEPLOY_URL) {
  fail(
    'DEPLOY_URL is not set in CI. It is the second of the two declarations this gate ' +
      'cross-checks, and without it the environment/destination assertion cannot run — ' +
      'which is exactly how a copied cutover workflow re-opens the noindex-on-production trap.',
  );
}

if (DEPLOY_URL) {
  let origin;
  try {
    origin = new URL(DEPLOY_URL).origin;
  } catch {
    fail(`DEPLOY_URL is not a URL: "${DEPLOY_URL}"`);
  }
  if (origin && origin !== SITE_URL) {
    fail(
      `SITE_ENV=${SITE_ENV} builds for ${SITE_URL} but this deploy is going to ${origin}. ` +
        `One of the two is wrong, and shipping either way publishes the wrong canonicals.`,
    );
  } else if (origin) {
    pass(`environment and destination agree (SITE_ENV=${SITE_ENV} -> ${origin})`);
  }
} else {
  console.log('  SKIP  destination cross-check (no DEPLOY_URL — not a deploy)\n');
}

// Everything below derives from INDEXABLE. Nothing states a literal.
const WANT_ROBOTS_META = INDEXABLE ? 'index, follow' : 'noindex, nofollow';

// ---------------------------------------------------------------------------
// 2. Per-page invariants — the AG-3 F2 fix
// ---------------------------------------------------------------------------

function htmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (entry.endsWith('.html')) out.push(full);
  }
  return out;
}

if (!existsSync(DIST_ABS)) {
  fail(`${DIST}/ does not exist — the build produced nothing`);
  process.exit(1);
}

const pages = htmlFiles(DIST_ABS);
if (!pages.length) fail(`${DIST}/ contains no HTML at all`);

/**
 * Strip everything that is not prose a visitor reads: script and style bodies,
 * then comments. Needed for the text-run checks below, where `if (a<b)` inside a
 * script would otherwise read as a jammed tag.
 */
const prose = (html) =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

/**
 * LN-2 F3. JSX drops the whitespace when a newline sits between a word and an
 * inline tag, so `the` + newline + `<em>` emits `the<em>` and renders as
 * "thePrivacy Act 1988". Live on staging when Lens found it.
 *
 * The markup is structurally perfect in that state, which is why every existing
 * gate passed it. This is the only check in the file that looks at the rendered
 * text run rather than the tags.
 */
const INLINE_TAGS = 'a|em|strong|b|i|code|small|abbr|span|sup|sub|time';
const JAMMED_OPEN = new RegExp(`[A-Za-z0-9,.!?)"'’”]<(?:${INLINE_TAGS})[\\s>]`, 'g');
const JAMMED_CLOSE = new RegExp(`</(?:${INLINE_TAGS})>[A-Za-z0-9(]`, 'g');

const context = (text, index) =>
  JSON.stringify(text.slice(Math.max(0, index - 30), index + 30)).replace(/\\n/g, ' ');

for (const file of pages) {
  const rel = relative(DIST_ABS, file).split(sep).join('/');
  const html = readFileSync(file, 'utf8');
  const body = prose(html);
  const at = (msg) => `${rel}: ${msg}`;

  // -- indexing polarity, derived ------------------------------------------
  const robots = html.match(/<meta\s+name="robots"\s+content="([^"]*)"/i)?.[1];
  if (robots !== WANT_ROBOTS_META) {
    fail(
      at(
        `robots meta is "${robots ?? '<absent>'}" but SITE_ENV=${SITE_ENV} requires "${WANT_ROBOTS_META}"`,
      ),
    );
  }

  // -- canonical must be on this build's own origin -------------------------
  const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]*)"/i)?.[1];
  if (!canonical || !canonical.startsWith(SITE_URL)) {
    fail(at(`canonical is "${canonical ?? '<absent>'}", expected an ${SITE_URL} URL`));
  }

  // -- Search Console ownership must survive every build --------------------
  if (!html.includes(GSC_TOKEN)) {
    fail(at('no Search Console verification token — the only tool that would show the migration hurt'));
  }

  // -- structured data ------------------------------------------------------
  // AG-4 residual 2 (LOW, but the worst kind of miss). This regex used to demand
  // a BARE `<script type="application/ld+json">`. Any extra attribute made that
  // block invisible to the scanner, and because it fails PARTIALLY — some blocks
  // still match — `!blocks.length` never fires and nothing reports a problem.
  // The AHPRA check is the one that rides on this, and a silent miss there is a
  // criminal-liability question rather than a ranking one.
  //
  // Latent rather than live when Argus found it: all 15 blocks across the 8
  // pages were visible, because Astro strips `slot` and `set:html` from the
  // rendered tag. That is a property of the current Astro version, not a
  // guarantee, which is precisely why it should not be load-bearing.
  const blocks = [
    ...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g),
  ].map((m) => m[1]);
  if (!blocks.length) fail(at('no JSON-LD at all'));

  let biz;
  for (const raw of blocks) {
    let node;
    try {
      node = JSON.parse(raw);
    } catch {
      fail(at('a JSON-LD block does not parse'));
      continue;
    }
    // AHPRA s133 — a criminal offence, not a ranking penalty, and there is no
    // answer-engine exception. Asserted on every page because the ban is stated
    // over "any surface Keegan controls", and 1-6 adds page-level schema nodes
    // built from page content, which check-data.mjs cannot see.
    const walk = (v) => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === 'object') {
        // Checked ONCE per object, not once per key. It used to sit inside the
        // key loop, so a single banned node reported itself as many times as it
        // had properties — and a critical check that triple-prints reads as
        // unreliable exactly when it matters most.
        if (v['@type'] === 'Review' || v['@type'] === 'AggregateRating') {
          fail(at(`a ${v['@type']} node reached the page — AHPRA s133 forbids it on any surface`));
        }
        for (const [k, child] of Object.entries(v)) {
          if (/^(review|aggregateRating|reviews|ratingValue)$/i.test(k)) {
            fail(at(`a "${k}" node reached the page — AHPRA s133 forbids it on any surface`));
          }
          walk(child);
        }
      }
    };
    walk(node);
    if (node['@type'] === 'MedicalBusiness') biz = node;
  }

  if (!biz) {
    fail(at('no MedicalBusiness node — the profile corroboration has to hold wherever Google lands'));
  } else {
    const n = biz.openingHoursSpecification?.length ?? 0;
    if (n !== 9) {
      fail(
        at(
          `openingHoursSpecification has ${n} entries, expected 9 ` +
            `(Tuesday and Thursday each split around the 14:00-16:30 break)`,
        ),
      );
    }
    if (biz.name !== business.name) {
      fail(at(`schema name is "${biz.name}", expected "${business.name}" from business.json`));
    }
    if (!biz.telephone) fail(at('MedicalBusiness has no telephone'));
    if (!biz.address?.streetAddress) fail(at('MedicalBusiness has no street address'));
  }

  // -- the visible half. Schema is not what a human reads, and Google asked for
  //    the details to be ON the page.
  if (!body.includes(business.address.streetAddress)) {
    fail(at(`the street address (${business.address.streetAddress}) is not visible on the page`));
  }
  if (!body.includes(business.phone)) {
    fail(at(`the phone number (${business.phone}) is not visible on the page`));
  }

  // -- AG-3 F10. The standing directive says the name is spelled identically
  //    "across all areas ... website copy, <title> tags, schema name". Nothing
  //    asserted a PAGE uses it, so 1-6 could hand-type an apostrophe into eight
  //    titles and every check in this repo would pass.
  //
  //    PAGE-level, not TITLE-level, and that distinction matters. An earlier
  //    version of this check demanded the exact name inside every <title>, and
  //    it immediately failed the About page — whose title is "About Keegan
  //    Baldwin, Chiropractor | Northern Beaches", a LOCKED copy decision
  //    (MN-48 decision 2, revision 2). The check was wrong, not the title.
  //    The actual risk F10 names is a MISSPELLING of the name, and the
  //    apostrophe assertion below is what catches that, on every page, in copy
  //    and titles and schema alike.
  if (!html.includes(business.name)) {
    fail(at(`the business name "${business.name}" appears nowhere on the page`));
  }
  if (/Keegan['’]s Movement Lab/.test(html)) {
    fail(
      at(
        `found an apostrophe form of the business name. It is "${business.name}" everywhere — ` +
          `cross-source spelling is the mechanism Google uses to connect the profile to the site.`,
      ),
    );
  }

  // -- AG-3 F5. A well-formed date that is not in the future, and whose machine
  //    and human forms agree.
  //
  //    This deliberately no longer asserts "is today". The old gate did, which
  //    meant the pipeline REQUIRED every page to claim it was updated today, and
  //    would have failed the honest fix. It still catches the bug it was written
  //    for — a UTC runner stamping datetime="yesterday" next to today's visible
  //    text — because that makes the two forms disagree.
  // The `[^>]*` is load-bearing: Astro appends its own scope attribute inside
  // the tag (`<time datetime="..." data-astro-cid-z4jru4n3>`), so a regex that
  // demands `"` immediately followed by `>` reports "no date element" on a page
  // that plainly has one. Caught by asking whether the failure was physically
  // plausible before believing it.
  const time = html.match(/<time datetime="([^"]*)"[^>]*>([^<]*)<\/time>/);
  if (!time) {
    fail(at('no <time datetime> last-updated element'));
  } else {
    const [, iso, human] = time;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      fail(at(`last-updated datetime "${iso}" is not a YYYY-MM-DD date`));
    } else {
      if (iso > TODAY_SYDNEY) {
        fail(at(`last-updated datetime "${iso}" is in the future (today in Sydney is ${TODAY_SYDNEY})`));
      }
      const expected = new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-AU', {
        timeZone: SYDNEY,
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      if (human.trim() !== expected) {
        fail(
          at(
            `last-updated text "${human.trim()}" does not match datetime="${iso}" (expected "${expected}") ` +
              `— this is the UTC/Sydney drift the check exists for`,
          ),
        );
      }
    }
  }

  // -- exactly one h1 (G-7) --------------------------------------------------
  const h1s = (html.match(/<h1[\s>]/gi) ?? []).length;
  if (h1s !== 1) fail(at(`${h1s} <h1> elements, expected exactly 1`));

  // -- LN-2 F3, the text run -------------------------------------------------
  for (const m of body.matchAll(JAMMED_OPEN)) {
    fail(at(`a word runs straight into an inline tag with no space: ...${context(body, m.index)}...`));
  }
  for (const m of body.matchAll(JAMMED_CLOSE)) {
    fail(at(`an inline tag runs straight into the next word with no space: ...${context(body, m.index)}...`));
  }
}

// Deliberately not a PASS line: this reports COVERAGE (how many pages were
// examined), which is true whether or not they were clean. A "PASS" printed
// beside its own failures is how a reader learns to skim the output.
if (pages.length) console.log(`  ----  ${pages.length} page(s) examined: ${pages.map((p) => relative(DIST_ABS, p).split(sep).join('/')).join(', ')}`);

// ---------------------------------------------------------------------------
// 3. Site-level artifacts
// ---------------------------------------------------------------------------

const distFile = (f) => join(DIST_ABS, f);
const need = (f, why) => {
  if (!existsSync(distFile(f)) || statSync(distFile(f)).size === 0) fail(`${f} missing or empty — ${why}`);
};

need('robots.txt', 'crawler policy fails silently, so its absence must fail loudly');
need('sitemap-index.xml', '@astrojs/sitemap did not run');
need(
  '.htaccess',
  'it carries the /sitemap.xml rewrite; rsync --delete would remove it from the server if the build stopped emitting it',
);
need('privacy/index.html', 'the privacy policy is a standing APP 1 obligation, not optional');
if (IN_CI) need('build-id.txt', 'the live check has nothing to compare against without it');

if (existsSync(distFile('robots.txt'))) {
  const robots = readFileSync(distFile('robots.txt'), 'utf8');
  const blanketDisallow = /^\s*Disallow:\s*\/\s*$/m.test(robots);
  if (INDEXABLE && blanketDisallow) {
    fail('robots.txt has a blanket "Disallow: /" on an INDEXABLE build — this hides the real site');
  } else if (!INDEXABLE && !blanketDisallow) {
    fail('robots.txt does not disallow crawling on a staging build — it can be indexed as a duplicate');
  } else {
    pass(`robots.txt matches SITE_ENV=${SITE_ENV}`);
  }
}

// Story 1-8. The policy and the beacon read one flag, so they cannot disagree.
// This is defence in depth on a legal document, where being wrong is the one
// thing it cannot afford.
if (existsSync(distFile('privacy/index.html'))) {
  const policy = readFileSync(distFile('privacy/index.html'), 'utf8');
  const beacon = (policy.match(/cloudflareinsights/g) ?? []).length;
  const claims = (policy.match(/data-analytics-claim="running"/g) ?? []).length;
  if ((beacon > 0) !== (claims > 0)) {
    fail(
      `the privacy policy and the analytics beacon disagree (beacon=${beacon}, policy claims=${claims}) — ` +
        `a policy describing collection that is not happening is the document being wrong about its own subject`,
    );
  } else {
    pass(`privacy policy consistent with the analytics state (beacon=${beacon})`);
  }
}

console.log();
if (failures) {
  console.error(`BUILD GATE FAILED — ${failures} problem(s).`);
  process.exit(1);
}
console.log(`Build gate passed (${pages.length} page(s), SITE_ENV=${SITE_ENV}).`);

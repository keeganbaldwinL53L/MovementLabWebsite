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
 * SM-14. Read one attribute's VALUE off a start tag.
 *
 * Every attribute read in this file used to be its own `/\sname="([^"]*)"/`, and
 * that shape is a trap: HTML lets an attribute be written four ways, and a
 * regex demanding `="..."` reads three of them as ABSENT.
 *
 *     alt="x"   alt='x'   alt=x   alt
 *
 * The last is a bare boolean, whose value is the empty string. It is not an
 * edge case here — it is what astro:assets emits for `<Image alt="" />`, which
 * is the correct, paved-road way to write a decorative image. Measured on this
 * build: `<Image alt="" aria-hidden="true" />` serialises to `<img ... alt
 * aria-hidden="true" ...>`, and the old regex reported that as "no alt
 * attribute at all". The markup was right and the gate could not see it.
 *
 * Two consequences, and the second is why this is a real defect rather than a
 * cosmetic one: the message named the wrong problem, AND the decorative
 * allowance below was UNREACHABLE through <Image> — the only way past the gate
 * was to hand-write a raw <img>, which bypasses astro:assets entirely. That is
 * the exact thing the width/height check exists to keep people using, so the
 * gate was pushing authors off the paved road to satisfy it. Story 1-10 places
 * 38 more images through <Image>; this had to be fixed before that lands.
 *
 * Returns undefined ONLY when the attribute is genuinely not written, so a
 * caller can still tell "absent" from "present but empty" — the distinction the
 * alt check turns on. The `(?![-\w])` stops `altitude="3"` reading as a bare
 * `alt`.
 */
const attr = (tag, name) => {
  const m = tag.match(
    new RegExp(`\\s${name}(?![-\\w])(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'\`=<>]+)))?`, 'i'),
  );
  if (!m) return undefined;
  return m[1] ?? m[2] ?? m[3] ?? '';
};

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

  // -- images (story 1-10 / spec G-5) ----------------------------------------
  // Two properties, both of which fail silently without a check.
  //
  // ALT: the old WordPress site technically had alt text on 46 of 57 images, and
  // it was worthless — WordPress auto-fills the filename, so a screen reader
  // announced "img 1570" and "VideoCapture_20250623-164557". That counts as
  // present in an audit and describes nothing to the one person who needs it.
  // So this asserts alt is non-empty AND not merely the filename.
  //
  // DIMENSIONS: an <img> without width/height is the single most common cause
  // of layout shift on a rebuild — the page reflows as each image arrives.
  // astro:assets emits both automatically, so a failure here means someone
  // hand-wrote a raw <img> and bypassed it.
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const alt = attr(tag, 'alt');
    const src = attr(tag, 'src') ?? '';
    const file = src.split('/').pop()?.split('.')[0] ?? '';
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

    // LN-6 / story 1-15 — SAYING SO, exactly as the note below asked.
    // The brand mark in the site header is the first genuinely decorative image
    // on this site. It carries no information: the business name sits beside it
    // as real text, so describing the mark would make a screen reader announce
    // the name twice.
    //
    // The allowance is deliberately NARROW. An empty alt passes only when the
    // tag ALSO carries aria-hidden="true". That pair is the unambiguous W3C
    // marker for decorative, it cannot be reached by forgetting to write alt
    // text, and it takes two intentional attributes to opt out of this check.
    // A bare empty alt on its own still fails, which is what keeps the original
    // tripwire intact for the 38 content images story 1-10 is still placing.
    const decorative = attr(tag, 'aria-hidden') === 'true';

    if (alt === undefined) {
      fail(at(`an <img> has no alt attribute at all (${src})`));
    } else if (!alt.trim() && !decorative) {
      fail(
        at(
          `an <img> has an empty alt (${src}) — if it is genuinely decorative, add ` +
            `aria-hidden="true" alongside the empty alt; otherwise write real alt text`,
        ),
      );
    } else if (alt.trim() && file && norm(alt) === norm(file)) {
      fail(
        at(
          `the alt text for ${src} is just the filename ("${alt}") — that is what the old ` +
            `WordPress site did, and it describes nothing to a screen reader`,
        ),
      );
    }

    const sized = (name) => /^\d+$/.test(attr(tag, name) ?? '');
    if (!sized('width') || !sized('height')) {
      fail(at(`an <img> is missing width/height (${src}) — unsized images cause layout shift`));
    }
  }

  // -- exactly one h1 (G-7) --------------------------------------------------
  const h1s = (html.match(/<h1[\s>]/gi) ?? []).length;
  if (h1s !== 1) fail(at(`${h1s} <h1> elements, expected exactly 1`));

  // -- FD-23 / LN-13: the HOME h1 carries the SERVICE, not the brand line -----
  //
  // MN-48 decision 3, confirmed by Keegan 2026-07-31. It regressed anyway and
  // stayed wrong for ELEVEN commits, through four gates and two 40-combination
  // sweeps. Two written controls were in place and both failed: story 1-16
  // carried the carve-out in bold, and index.astro's own header has said "the
  // h1 carries the SERVICE" since 1-6. The code contradicted its own
  // documentation and nothing noticed.
  //
  // WHY NO EXISTING CHECK COULD SEE IT: every gate here and every Lens sweep
  // tests STRUCTURE — one h1, contrast, no overflow, heading order. All of
  // those were correct the whole time. The defect was CONTENT, and content is
  // the layer none of them look at. A decision that lives only in prose is not
  // a control; this is the smallest thing that makes it one.
  //
  // DELIBERATELY NARROW, per Foundry: the point is to catch a silent REVERT,
  // not to freeze the copy. So it asserts the SHAPE of the decision, not the
  // sentence — reword the h1 freely as long as it still names the service.
  //
  // Home only, and that is load-bearing: no other page's h1 contains the
  // specialty ("About Keegan Baldwin", "Group classes"), so applying this
  // site-wide would fail seven pages that are correct.
  if (rel === 'index.html') {
    const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '')
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .trim();
    const flat = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

    if (!h1) {
      fail(at('the home page has no readable <h1> text'));
    } else {
      // POSITIVE — derived from the data layer, not written out here, so a
      // change of specialty updates the check with the site (the AG-3 F1
      // lesson: a literal in a gate quietly describes the wrong thing later).
      if (!flat(h1).includes(flat(business.medicalSpecialty))) {
        fail(
          at(
            `the home <h1> does not name the service — expected it to contain ` +
              `"${business.medicalSpecialty}" (business.json medicalSpecialty), got "${h1}". ` +
              `MN-48 decision 3: the h1 carries the SERVICE, the brand line sits above it ` +
              `as styled text. If this fired after a rewrite, reword the h1 to keep the ` +
              `service in it — do NOT relax this check.`,
          ),
        );
      }
      // NEGATIVE — a brand-line h1 is the exact regression. The business name
      // in the h1 is that shape.
      if (flat(h1).includes(flat(business.name))) {
        fail(
          at(
            `the home <h1> contains the business name ("${business.name}") — that is the ` +
              `brand-line shape MN-48 decision 3 rules out. The name belongs in the kicker above.`,
          ),
        );
      }
      // NEGATIVE — the tagline drifting back INTO the h1 (Foundry's second
      // line). Sourced from the page rather than hardcoded: the tagline lives
      // in the first kicker, after the separator. If it is not derivable the
      // check says so out loud rather than skipping silently.
      const kicker = html.match(/<p class="kicker"[^>]*>([\s\S]*?)<\/p>/i)?.[1]
        ?.replace(/<[^>]*>/g, '')
        .trim();
      const tagline = kicker?.includes('·') ? kicker.split('·').pop().trim() : '';
      if (!tagline) {
        console.log(
          '  ----  home tagline not derivable from the first kicker; the h1/tagline overlap check did not run',
        );
      } else {
        // ⚠️ SUBSTRING MATCHING IS NOT ENOUGH HERE, and the mutation run is how
        // I know. The locked tagline is "Live Better, Longer" but the brand
        // line that actually regressed into the h1 was "Move Better, Live
        // Longer" — different strings, same idea, so an exact-substring test
        // passed the hybrid "Move Better, Live Longer — Chiropractic on the
        // Northern Beaches". That variant satisfies the service check and still
        // puts the tagline in the h1, which is what MN-48 rules out.
        //
        // So match on the tagline's DISTINCTIVE words instead (>=5 letters, so
        // "live"/"move" drop out and "better"/"longer" remain), still derived
        // from the kicker rather than written here. Requiring ALL of them keeps
        // it narrow — a reword has to reproduce the whole idea to trip it.
        const marks = flat(tagline)
          .replace(/[^a-z\s]/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length >= 5);
        if (marks.length && marks.every((w) => flat(h1).includes(w))) {
          fail(
            at(
              `the home <h1> reproduces the brand tagline ("${tagline}") — it belongs in the ` +
                `kicker above the h1, not in it (MN-48 decision 3). Matched on: ${marks.join(' + ')}.`,
            ),
          );
        }
      }
    }
  }

  // -- LN-2 F3, the text run -------------------------------------------------
  for (const m of body.matchAll(JAMMED_OPEN)) {
    fail(at(`a word runs straight into an inline tag with no space: ...${context(body, m.index)}...`));
  }
  for (const m of body.matchAll(JAMMED_CLOSE)) {
    fail(at(`an inline tag runs straight into the next word with no space: ...${context(body, m.index)}...`));
  }

  // -- AG-5 F2: every root-relative thing this page REFERENCES must exist ----
  //
  // THE HOLE THIS CLOSES, and it is the reason F1 shipped through four green
  // gates: nothing derived the required-asset set from the markup. `need()`
  // below is a hand-written list of five site-level files, so a reference to a
  // file that was never created — `/og-default.png`, live on every page and
  // 404 on the real server — was invisible to every check. Argus proved it:
  // delete a referenced .webp from dist, leave the HTML pointing at it, and the
  // gate still printed "Build gate passed".
  //
  // A missing asset is the quietest class of defect on a static site. Nothing
  // errors, the build is green, the page renders, and the only symptom is a
  // hole where an image should be — or, for og:image, a symptom NOBODY sees
  // from inside the site at all, because it only surfaces when someone pastes
  // a link into WhatsApp.
  //
  // Scope is deliberately ROOT-RELATIVE ONLY. External URLs are somebody
  // else's uptime and this gate must not fail because Cliniko is slow; hashes,
  // mailto:, tel: and data: are not files.
  const refs = new Map(); // path -> what referenced it (for the message)
  const noteRef = (url, kind) => {
    if (!url) return;
    const u = url.trim();
    if (!u.startsWith('/') || u.startsWith('//')) return; // external or protocol-relative
    const clean = u.split('#')[0].split('?')[0];
    if (clean && !refs.has(clean)) refs.set(clean, kind);
  };

  for (const m of html.matchAll(/<(?:img|script|source|iframe)\b[^>]*>/gi)) {
    noteRef(attr(m[0], 'src'), 'src');
    // srcset carries multiple candidates, each "url descriptor" — every one of
    // them is a file the browser may choose, so every one has to exist.
    const ss = attr(m[0], 'srcset');
    if (ss) for (const cand of ss.split(',')) noteRef(cand.trim().split(/\s+/)[0], 'srcset');
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) noteRef(attr(m[0], 'href'), 'link href');
  for (const m of html.matchAll(/<a\b[^>]*>/gi)) noteRef(attr(m[0], 'href'), 'link');
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const p = attr(m[0], 'property') ?? attr(m[0], 'name') ?? '';
    if (/^(og:image|twitter:image)$/i.test(p)) {
      // og:image is absolute in the markup (crawlers require it), so compare on
      // the path and only when it is on our own origin.
      const c = attr(m[0], 'content') ?? '';
      try {
        const url = new URL(c, SITE_URL);
        if (url.origin === new URL(SITE_URL).origin) noteRef(url.pathname, p);
      } catch {
        /* not a URL — other checks own that */
      }
    }
  }

  for (const [path, kind] of refs) {
    // trailingSlash: 'always', so an internal page reference resolves to that
    // directory's index.html. Accept either shape rather than assuming, so a
    // legitimate extensionless file is not reported as missing.
    //
    // ⚠️ AG-6 (Argus). THIS USED TO ASK `existsSync(asFile)` AND NOTHING MORE,
    // and a DIRECTORY satisfies existsSync. So deleting `about/index.html`
    // while leaving the empty `about/` directory passed the gate on a build
    // whose primary nav link 404s — the resolution was satisfied by the folder
    // rather than by the document inside it, which is not what a browser does.
    // Removing the whole directory failed correctly, which is exactly why the
    // gap was easy to miss: the obvious test passes.
    //
    // A path only counts if it resolves to a FILE. Argus was straight about the
    // severity — he could not construct a realistic build that reaches this
    // state, because Astro cleans dist, so it needs something unusual like a
    // same-named folder in public/. Reproduced defect, no reproduced trigger.
    // Fixed anyway: it is one predicate, and the message this gate prints
    // ("it will 404") was untrue in exactly this case.
    const isFile = (p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false; // absent, or a broken symlink — either way not a document
      }
    };
    if (!isFile(join(DIST_ABS, path)) && !isFile(join(DIST_ABS, path, 'index.html'))) {
      fail(at(`${kind} points at ${path}, which does not exist in ${DIST} — it will 404`));
    }
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

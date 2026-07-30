#!/usr/bin/env node
// Story 1-2. Proves the indexing gate works in BOTH directions.
//
// WHY BOTH. The story's whole risk is polarity. Asserting only that staging is
// noindexed proves nothing about whether production would be indexable — a
// layout with a hardcoded `noindex` passes that test perfectly and silently
// de-indexes the real site the day it ships. Proving one direction is not
// proving the gate.
//
// So this builds the site TWICE, once per environment, and asserts each output
// is correct AND that it is different from the other. If someone hardcodes the
// robots meta, the two builds become identical and this fails.
//
// Runs in CI before the deploy build. Cheap: the site is tiny.

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = { production: 'dist-check-prod', staging: 'dist-check-staging' };

let failures = 0;
const results = [];

function check(label, ok, detail) {
  results.push({ label, ok, detail });
  if (!ok) failures++;
}

function build(env) {
  const outDir = OUT[env];
  rmSync(outDir, { recursive: true, force: true });
  execFileSync('npx', ['astro', 'build', '--outDir', outDir], {
    stdio: 'pipe',
    env: { ...process.env, SITE_ENV: env },
  });
  const read = (f) => {
    const p = join(outDir, f);
    if (!existsSync(p)) throw new Error(`${env} build did not emit ${f}`);
    return readFileSync(p, 'utf8');
  };
  return { html: read('index.html'), robots: read('robots.txt') };
}

console.log('Building both environments to compare indexing polarity...\n');

const prod = build('production');
const stag = build('staging');

// ---- production must be INDEXABLE -------------------------------------------
check(
  'production: robots meta says index',
  /<meta\s+name="robots"\s+content="index,\s*follow"/i.test(prod.html),
  'expected <meta name="robots" content="index, follow">',
);
check(
  'production: robots meta does NOT say noindex',
  !/noindex/i.test(prod.html),
  'found "noindex" in a production build — this would de-index the live site',
);
check(
  'production: robots.txt does not disallow everything',
  !/^\s*Disallow:\s*\/\s*$/m.test(prod.robots),
  'production robots.txt contains a blanket "Disallow: /"',
);
check(
  'production: canonical points at the production origin',
  /rel="canonical"\s+href="https:\/\/keegansmovementlab\.com/.test(prod.html),
  'canonical is not on https://keegansmovementlab.com',
);

// AI crawlers are a SILENT failure class: you never see traffic you did not
// get. Assert the named agents are present and not disallowed (Vigil VG-3).
for (const ua of ['GPTBot', 'OAI-SearchBot', 'PerplexityBot', 'ClaudeBot']) {
  const block = prod.robots.split(/\n\s*\n/).find((b) => b.includes(`User-agent: ${ua}`));
  check(
    `production: ${ua} is present and allowed`,
    Boolean(block) && /Allow:\s*\//.test(block) && !/Disallow:\s*\//.test(block),
    `robots.txt block for ${ua} is missing or disallows /`,
  );
}

// ---- staging must be HIDDEN --------------------------------------------------
check(
  'staging: robots meta says noindex',
  /<meta\s+name="robots"\s+content="noindex,\s*nofollow"/i.test(stag.html),
  'expected <meta name="robots" content="noindex, nofollow">',
);
check(
  'staging: robots.txt disallows everything',
  /^\s*Disallow:\s*\/\s*$/m.test(stag.robots),
  'staging robots.txt does not contain a blanket "Disallow: /"',
);
check(
  'staging: canonical points at the staging origin',
  /rel="canonical"\s+href="https:\/\/staging\.keegansmovementlab\.com/.test(stag.html),
  'canonical is not on https://staging.keegansmovementlab.com',
);

// ---- anti-tautology ----------------------------------------------------------
// If the robots meta were hardcoded, both builds would agree and every check
// above could still pass on a half-broken implementation. Difference is the
// property that actually proves the value is driven by the environment.
check(
  'the two builds actually DIFFER on the robots meta',
  /noindex/i.test(stag.html) !== /noindex/i.test(prod.html),
  'both builds emit the same robots meta — the value is not env-driven',
);
check(
  'the two robots.txt files actually DIFFER',
  stag.robots !== prod.robots,
  'both builds emit an identical robots.txt — the value is not env-driven',
);

// ---- the GSC token must survive every build ----------------------------------
for (const [env, out] of [
  ['production', prod],
  ['staging', stag],
]) {
  check(
    `${env}: Search Console token present`,
    out.html.includes('IeAle3a1ZmuhHs5D7gx5ZsShoQPZ4ZHxb-K3oByz8b4'),
    'losing this token costs the only tool that would show the migration hurt',
  );
}

// ---- report ------------------------------------------------------------------
console.log();
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.label}`);
  if (!r.ok) console.log(`        ${r.detail}`);
}

for (const dir of Object.values(OUT)) rmSync(dir, { recursive: true, force: true });

console.log();
if (failures) {
  console.error(`INDEXING POLARITY CHECK FAILED — ${failures} of ${results.length} checks failed.`);
  process.exit(1);
}
console.log(`Indexing polarity proven in both directions (${results.length} checks).`);

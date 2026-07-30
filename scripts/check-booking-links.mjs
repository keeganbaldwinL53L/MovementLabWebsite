#!/usr/bin/env node
// Story 1-4. Fetches every booking URL the site will emit and checks what
// Cliniko ACTUALLY renders.
//
// The story says a code-read cannot close this, and it is right: the failure
// mode is silent. If an appointment type is deleted and recreated in Cliniko it
// gets a NEW id, and a stale deep link does not error — it falls back to a
// WIDER list. The link keeps working, it just quietly offers the wrong thing.
// Nothing in the repo can detect that; only asking Cliniko can.
//
// DELIBERATELY NOT A DEPLOY GATE. This talks to a third party, so wiring it
// into deploy.yml would let a Cliniko outage block shipping a text change. Run
// it on launch day, and any time a booking link misbehaves:
//
//     npm run check:booking
//
// Method is Vigil's (VG-1): parse the data-appointment-type-name attributes out
// of the rendered page rather than trusting the URL we asked for.

import { SERVICES, buildBookingUrl, bookingUrlForSlug } from '../src/lib/cliniko.mjs';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && detail) console.log(`        ${detail}`);
  if (!ok) failures++;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Attribute values arrive HTML-ENCODED. "Mobility & Flexibility Group Class"
// comes back as "Mobility &amp; Flexibility Group Class", which made this probe
// report a name mismatch on a service that was perfectly correct — the
// extractor was the bug, not the data. Decode before comparing.
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&'); // last, so &amp;lt; does not become <
}

async function typesRenderedAt(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'movement-lab-website-link-check' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();
  const names = [...html.matchAll(/data-appointment-type-name=(["'])(.*?)\1/g)].map((m) =>
    decodeEntities(m[2]).trim(),
  );
  return { names: [...new Set(names)], html };
}

console.log('Fetching live booking pages from Cliniko...\n');

// ---- 1. every deep link resolves to exactly its own type ---------------------
for (const svc of SERVICES) {
  const url = bookingUrlForSlug(svc.slug);
  try {
    const { names } = await typesRenderedAt(url);
    check(
      `${svc.slug}: renders exactly one type`,
      names.length === 1,
      `rendered ${names.length}: ${names.join(' | ') || '(none — the id may no longer exist)'}`,
    );
    if (names.length === 1) {
      check(
        `${svc.slug}: and it is "${svc.clinikoName}"`,
        names[0] === svc.clinikoName,
        `rendered "${names[0]}" — the appointment type id may have been recreated in Cliniko`,
      );
    }
  } catch (err) {
    check(`${svc.slug}: page fetched`, false, String(err.message));
  }
  await sleep(400); // be polite; do not look like a burst
}

// ---- 2. the floor: no page can ever offer the whole clinic -------------------
let scopedNames = [];
try {
  const { names } = await typesRenderedAt(buildBookingUrl());
  scopedNames = names;
  check(
    'floor: the unrestricted URL still only offers Keegan',
    names.length > 0 && names.length <= SERVICES.length,
    `rendered ${names.length} types: ${names.join(' | ')}`,
  );
  const foreign = names.filter((n) => !SERVICES.some((s) => s.clinikoName === n));
  check(
    'floor: no other practitioner or service leaks in',
    foreign.length === 0,
    `unexpected types offered: ${foreign.join(' | ')}`,
  );
} catch (err) {
  check('floor: page fetched', false, String(err.message));
}

// ---- 3. ANTI-TAUTOLOGY -------------------------------------------------------
// If the scoping parameters were silently ignored, every check above would
// still pass while the site offered the whole clinic. So prove the scope is
// doing work: the same endpoint with NO parameters must offer strictly MORE.
await sleep(400);
try {
  const base = buildBookingUrl().split('?')[0];
  const { names: unscoped } = await typesRenderedAt(base);
  check(
    'anti-tautology: an UNSCOPED url offers strictly more types',
    unscoped.length > scopedNames.length,
    `unscoped rendered ${unscoped.length}, scoped rendered ${scopedNames.length} — ` +
      `if these are equal the scoping parameters are being ignored and every check above is meaningless`,
  );
  console.log(`        (unscoped = ${unscoped.length} types across the whole clinic, scoped = ${scopedNames.length})`);
} catch (err) {
  check('anti-tautology: unscoped page fetched', false, String(err.message));
}

console.log();
if (failures) {
  console.error(`BOOKING LINK CHECK FAILED — ${failures} check(s) failed.`);
  console.error('If an id changed in Cliniko, fix src/data/services.json — never inline an id in a page.');
  process.exit(1);
}
console.log('All booking links resolve to their correct scoped type.');

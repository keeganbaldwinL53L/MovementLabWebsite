#!/usr/bin/env node
// Story 1-3. Guards the shared data layer.
//
// Every one of these assertions exists because the value is published to a
// public page AND to a Google Business Profile, where being wrong sends a real
// person to a locked door or to another practitioner's booking.
//
// The nine-ranges check in particular is a named review criterion in the story
// ("seven entries means the break was silently dropped and MUST fail review").
// A criterion a human has to remember is one a human eventually forgets, so it
// is asserted here instead.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');

let failures = 0;
const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  if (!ok) failures++;
};

const load = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

// ---------------------------------------------------------------- hours.json
const hours = load('hours.json');
const oh = hours.openingHours;

check('hours: exactly NINE ranges', oh.length === 9, `got ${oh.length} — seven means the Tue/Thu break was dropped`);

for (const day of ['Tuesday', 'Thursday']) {
  const n = oh.filter((r) => r.day === day).length;
  check(`hours: ${day} emits TWO ranges (the 14:00-16:30 break)`, n === 2, `got ${n}`);
}
for (const day of ['Monday', 'Wednesday', 'Friday', 'Saturday', 'Sunday']) {
  const n = oh.filter((r) => r.day === day).length;
  check(`hours: ${day} emits one range`, n === 1, `got ${n}`);
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
check(
  'hours: every time is a valid 24-hour HH:MM',
  oh.every((r) => TIME.test(r.opens) && TIME.test(r.closes)),
  'a malformed time silently breaks openingHoursSpecification',
);
check(
  'hours: every range opens before it closes',
  oh.every((r) => r.opens < r.closes),
  'a reversed range publishes nonsense hours',
);
// Split days must not overlap, or the break is not really a break.
for (const day of ['Tuesday', 'Thursday']) {
  const [a, b] = oh.filter((r) => r.day === day).sort((x, y) => x.opens.localeCompare(y.opens));
  check(`hours: ${day}'s two ranges do not overlap`, Boolean(a && b) && a.closes < b.opens, 'the break must be a real gap');
}
check('hours: timezone is Australia/Sydney', hours.timezone === 'Australia/Sydney');

// ------------------------------------------------------------- services.json
const svc = load('services.json');
const s = svc.services;

check('services: exactly five bookable types', s.length === 5, `got ${s.length}`);
check(
  'services: business_id present (scoping hard floor)',
  svc.cliniko?.businessId === '80066',
  'without it an embed offers all four practitioners',
);
check(
  'services: practitioner_id present (scoping hard floor)',
  svc.cliniko?.practitionerId === '1317763537279387367',
  'without it a visitor can book another practitioner',
);
check(
  'services: every appointment type id is a non-empty numeric string',
  s.every((x) => typeof x.appointmentTypeId === 'string' && /^\d+$/.test(x.appointmentTypeId)),
);
check('services: appointment type ids are unique', new Set(s.map((x) => x.appointmentTypeId)).size === s.length);
check('services: slugs are unique', new Set(s.map((x) => x.slug)).size === s.length);

// Prices are cross-checked against decision D1 by VALUE, so a fat-finger in
// this file fails rather than quietly republishing a wrong price.
const EXPECTED_PRICES = { 'new-patient': 120, 'existing-patient': 95, 'movement-plan-analysis': 160 };
for (const [slug, price] of Object.entries(EXPECTED_PRICES)) {
  const found = s.find((x) => x.slug === slug);
  check(`services: ${slug} is $${price} (matches D1)`, found?.price === price, `got ${found?.price}`);
}
for (const slug of ['group-class', 'handstand-class']) {
  const found = s.find((x) => x.slug === slug);
  check(
    `services: ${slug} price is null (Cliniko has no billable item)`,
    found?.price === null,
    'inventing a price here would publish a number Cliniko cannot honour; schema must OMIT offers',
  );
}
check(
  'services: the Movement Plan Analysis is present',
  s.some((x) => x.slug === 'movement-plan-analysis'),
  'it is missing from the current live site entirely (D1) and must not be missing again',
);

// ------------------------------------------------------------- business.json
// BLOCKING until the name question is answered. Deliberately a hard failure
// rather than a skip: an absent NAP file is the exact condition that made
// Google reject Keegan's profile edits, so it must not be possible to ship
// Phase 1 without noticing.
if (!existsSync(join(DATA, 'business.json'))) {
  check(
    'business.json exists',
    false,
    'BLOCKED on spec E-1 — the business name apostrophe is UNCONFIRMED. ' +
      'One character decides whether Google connects the profile to the site, ' +
      'and the site must match whatever the profile carries. Awaiting Keegan.',
  );
} else {
  const biz = load('business.json');
  check('business: name present', Boolean(biz.name));
  check('business: phone is the profile number', biz.phone === '0403 887 360', `got ${biz.phone}`);
  check('business: phone has an E.164 form for schema', biz.phoneE164 === '+61403887360');
  check('business: full street address present', biz.address?.streetAddress?.includes('Lantana'));
  check('business: postcode 2097', biz.address?.postalCode === '2097');
  check('business: ABN present', biz.abn === '58 560 412 976');
  check('business: AHPRA registration present', biz.ahpra === 'CHI0002779763');
  // The invariant is "no such FIELD exists", so walk the keys rather than
  // grepping the serialised blob. The blob version had a false positive on its
  // own explanatory comment — the probe was measuring prose, not structure.
  const keysOf = (v, acc = []) => {
    if (Array.isArray(v)) v.forEach((x) => keysOf(x, acc));
    else if (v && typeof v === 'object')
      for (const [k, val] of Object.entries(v)) {
        acc.push(k);
        keysOf(val, acc);
      }
    return acc;
  };
  const banned = keysOf(biz).filter((k) => /review|rating|testimonial/i.test(k));
  check(
    'business: no review/rating/testimonial FIELD exists (AHPRA s133)',
    banned.length === 0,
    `found field(s): ${banned.join(', ')} — a criminal offence, not a ranking penalty; the field must not exist to be filled in`,
  );
}

// ------------------------------------------------------------------- report
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.label}`);
  if (!r.ok && r.detail) console.log(`        ${r.detail}`);
}
console.log();
if (failures) {
  console.error(`DATA LAYER CHECK FAILED — ${failures} of ${results.length} checks failed.`);
  process.exit(1);
}
console.log(`Data layer verified (${results.length} checks).`);

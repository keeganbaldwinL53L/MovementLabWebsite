// Story 1-5. Builds the JSON-LD the site emits.
//
// WHY THIS STORY IS A PREREQUISITE RATHER THAN RANKING POLISH:
// Google REJECTED Keegan's Business Profile name and category edits because the
// website corroborates nothing — his phone appears on zero pages, his address
// on zero pages, and there is no LocalBusiness schema at all. Google's stated
// policy is that it rejects edits it cannot confirm against the website. So the
// site is the UNLOCK for a fix he cannot otherwise make.
//
// ⚠️ JUSTIFY THIS BY: Google rich results, Google's own AI surfaces, and
// corroborating the profile. NEVER by "AI assistants read schema" — that claim
// was FALSIFIED under controlled study (Ahrefs: 1,885 pages added JSON-LD and
// citations FELL 4.6% against matched controls), and Vigil banner-corrected his
// own brief over it. Most LLM pipelines strip markup before the model sees text.
//
// ⚠️ AHPRA s133: NO Review, NO AggregateRating, NO testimonial node, on any
// surface Keegan controls. That is a criminal offence, not a ranking penalty,
// and there is no answer-engine exception. No builder here can emit one, and
// check-schema.mjs asserts the absence over the RENDERED output.
//
// Every value comes from src/data/*.json. Nothing is hand-typed here — the
// point of story 1-3 was one source, and a second copy in this file would be
// exactly the divergence it existed to prevent.

import business from '../data/business.json' with { type: 'json' };
import hours from '../data/hours.json' with { type: 'json' };
import { SERVICES } from './cliniko.mjs';

/** Drop keys whose value is null/undefined/empty-array, recursively. */
function compact(obj) {
  if (Array.isArray(obj)) return obj.map(compact).filter((v) => v !== undefined);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const c = compact(v);
      const empty = c === null || c === undefined || (Array.isArray(c) && c.length === 0);
      if (!empty) out[k] = c;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return obj;
}

const postalAddress = () => ({
  '@type': 'PostalAddress',
  streetAddress: business.address.streetAddress,
  addressLocality: business.address.addressLocality,
  addressRegion: business.address.addressRegion,
  postalCode: business.address.postalCode,
  addressCountry: business.address.addressCountry,
});

/**
 * The nine opening-hours ranges, straight from the data file.
 *
 * Tuesday and Thursday each emit TWO entries around a 14:00-16:30 break, which
 * is exactly what openingHoursSpecification is for. Emitting seven would
 * publish those days as continuous and send someone to a locked door at 3pm.
 */
const openingHours = () =>
  hours.openingHours.map((r) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: r.day,
    opens: r.opens,
    closes: r.closes,
  }));

/** priceRange derived from the real prices, never a guessed "$$". */
function priceRange() {
  const prices = SERVICES.map((s) => s.price).filter((p) => typeof p === 'number');
  if (!prices.length) return undefined;
  return `$${Math.min(...prices)}-$${Math.max(...prices)}`;
}

const SITE_ID = (siteUrl) => `${siteUrl}/#business`;

/** Site-wide MedicalBusiness. Emitted on every page by BaseLayout. */
export function medicalBusiness(siteUrl) {
  return compact({
    '@context': 'https://schema.org',
    '@type': 'MedicalBusiness',
    '@id': SITE_ID(siteUrl),
    name: business.name,
    url: siteUrl,
    telephone: business.phoneE164,
    email: business.email,
    address: postalAddress(),
    // geo is null until a real lookup happens. compact() drops it rather than
    // shipping invented coordinates for a physical address people drive to.
    geo: business.geo,
    openingHoursSpecification: openingHours(),
    priceRange: priceRange(),
    areaServed: business.areaServed,
    medicalSpecialty: business.medicalSpecialty,
    // Empty until the Google profile + Instagram URLs are supplied. sameAs is
    // the strongest entity signal available and the profile link is what ties
    // the two records together, so this is a real gap, not decoration.
    sameAs: business.sameAs,
  });
}

/** Physician node for /about/. AHPRA registration as an identifier. */
export function physician(siteUrl) {
  return compact({
    '@context': 'https://schema.org',
    '@type': 'Physician',
    '@id': `${siteUrl}/about/#physician`,
    name: 'Keegan Baldwin',
    medicalSpecialty: business.medicalSpecialty,
    worksFor: { '@id': SITE_ID(siteUrl) },
    address: postalAddress(),
    telephone: business.phoneE164,
    identifier: {
      '@type': 'PropertyValue',
      name: 'AHPRA registration',
      value: business.ahpra,
    },
  });
}

/**
 * Service node for one bookable service.
 *
 * A service with `price: null` has NO billable item in Cliniko, so the offers
 * node is OMITTED rather than invented (spec G-8). Publishing a price Cliniko
 * cannot honour is worse than publishing none.
 */
export function service(siteUrl, slug) {
  const s = SERVICES.find((x) => x.slug === slug);
  if (!s) throw new Error(`Unknown service slug "${slug}" — slugs come from src/data/services.json`);

  return compact({
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${siteUrl}/#service-${s.slug}`,
    name: s.label,
    serviceType: business.medicalSpecialty,
    provider: { '@id': SITE_ID(siteUrl) },
    areaServed: business.areaServed,
    offers:
      s.price === null
        ? undefined
        : {
            '@type': 'Offer',
            price: String(s.price),
            priceCurrency: 'AUD',
          },
  });
}

/**
 * FAQPage — ONLY where the questions genuinely appear in the page body
 * (spec G-8). Marking up questions a visitor cannot see is exactly the
 * mismatch Google penalises.
 */
export function faqPage(entries) {
  if (!entries?.length) return undefined;
  return compact({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((e) => ({
      '@type': 'Question',
      name: e.question,
      acceptedAnswer: { '@type': 'Answer', text: e.answer },
    })),
  });
}

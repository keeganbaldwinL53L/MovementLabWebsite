// Story 1-4. Builds every Cliniko booking URL the site emits.
//
// ⚠️ SCOPING IS CORRECTNESS, NOT POLISH.
// The Cliniko account is the SHARED Restore Health Clinic account. Unscoped it
// offers 13 appointment types across 4 practitioners, so an unscoped booking
// URL on Keegan's own site lets a visitor book Adrian Tomiak, Jake Williams or
// a naturopath — proven live by Vigil (VG-1, test 4).
//
// The floor is enforced STRUCTURALLY rather than by convention: this module
// reads business_id and practitioner_id from the data file itself and there is
// no parameter to pass them, override them or omit them. A caller cannot build
// an unscoped URL through this API because the API does not expose one. That
// is the difference between a rule people follow and a rule people cannot
// break.
//
// Pure on purpose (drift anchor: PURE/RUNNER SPLIT) — no Astro imports, no DOM,
// no network. It is unit-testable and it is what the live link check exercises.

import services from '../data/services.json' with { type: 'json' };

const { bookingsBaseUrl, businessId, practitionerId } = services.cliniko;

/** Every bookable service, in data order. */
export const SERVICES = services.services;

/** Look a service up by its slug. Throws rather than returning undefined. */
export function serviceBySlug(slug) {
  const found = SERVICES.find((s) => s.slug === slug);
  if (!found) {
    throw new Error(
      `Unknown service slug "${slug}". Known slugs: ${SERVICES.map((s) => s.slug).join(', ')}. ` +
        `Slugs come from src/data/services.json — do not inline an appointment type id in a page.`,
    );
  }
  return found;
}

/**
 * Build a booking URL.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.appointmentTypeIds]
 *   Restrict to these types. Omit for "all of Keegan's types", which the
 *   business+practitioner floor already produces. NEVER produces the whole
 *   clinic.
 * @param {boolean} [opts.embedded] true for the iframe form.
 */
export function buildBookingUrl({ appointmentTypeIds = [], embedded = false } = {}) {
  // Order matters only for readability and for a stable string in tests.
  const params = new URLSearchParams();
  params.set('business_id', businessId);
  params.set('practitioner_id', practitionerId);

  if (appointmentTypeIds.length > 0) {
    // Cliniko takes these comma-separated. Proven live against the real
    // account, not taken from the docs (VG-1, tests 2 and 3).
    params.set('appointment_type_id', appointmentTypeIds.join(','));
  }
  if (embedded) params.set('embedded', 'true');

  return `${bookingsBaseUrl}?${params.toString()}`;
}

/** Deep link to exactly ONE service, by slug. */
export function bookingUrlForSlug(slug) {
  return buildBookingUrl({ appointmentTypeIds: [serviceBySlug(slug).appointmentTypeId] });
}

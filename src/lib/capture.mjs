// Story 1-19. Email capture through Kit — the single source for whether it is
// configured, whether it is PUBLISHED, and who the provider is.
//
// Same shape as analytics.mjs and for the same reason: ONE flag, several
// consumers. The embed component, the privacy policy's overseas-providers table
// and the build gate all read from here, so the site cannot capture addresses
// while the policy stays silent about the processor, and cannot claim a
// processor it is not using.
//
// ⚠️ NO API KEY, ANYWHERE, AND THAT IS DELIBERATE (Foundry, SM-26).
// Kit issues an embed snippet per form. The site captures addresses with no
// credential in the repo and none in Actions secrets, which keeps this clear of
// the blast-radius question that closed the Hostinger API route — and it means
// KIT owns the double opt-in and the one-click unsubscribe the Spam Act 2003
// requires, rather than us reimplementing compliance and the liability with it.
// If the embed ever looks like it cannot do the job, come back and say so
// BEFORE reaching for an API key. A credential is not the easy path here.
//
// ── THE TWO GATES, AND WHY THERE ARE TWO ────────────────────────────────────
//
// KIT_FORM_ID     does a form exist to post to?
// DELIVERABLE     is there something to actually send the person?
//
// Both must hold. The second is the one that is easy to skip and the one that
// matters most: 🔴 A FORM THAT TAKES AN ADDRESS AND DELIVERS NOTHING IS WORSE
// THAN NO FORM. It burns the single first impression, and on a health
// practitioner's list it opens the relationship with a broken promise.
//
// So this is not a note asking someone to remember. `scripts/check-build.mjs`
// refuses a build where the embed is present without both gates satisfied, and
// refuses a build that declares itself published while the deliverable route is
// missing from dist. Structural, not advisory.

/**
 * The Kit form's public ID, from the embed snippet Kit generates per form.
 * NOT a secret — it appears in the page source of every site using it, which is
 * exactly why this integration needs no credential.
 *
 * SUPPLIED 2026-08-03 (UD-32). Keegan created and published the form; Foundry
 * verified it live rather than trusting the paste, and so did I — see the
 * URL measurements below.
 */
export const KIT_FORM_ID = '26d1041fdf';

/**
 * The Kit account subdomain. The embed is served from the ACCOUNT host, not
 * from kit.com — and that distinction is not cosmetic.
 *
 * ⚠️ I GOT THIS WRONG IN SM-26 AND IT WOULD HAVE SHIPPED BROKEN. I wrote the
 * src as `https://kit.com/forms/<id>/index.js` from memory rather than from
 * Keegan's actual snippet. Measured once the real form existed:
 *
 *     https://kit.com/forms/26d1041fdf/index.js              404
 *     https://keegansmovementlab.kit.com/26d1041fdf/index.js 200, 34,091b
 *
 * The failure would have been silent in the worst way: the page renders, the
 * script 404s, no form appears, and nothing in the build errors. Both halves
 * live here now so the component cannot reconstruct a URL from a guess.
 */
export const KIT_ACCOUNT = 'keegansmovementlab';

/** The exact script src, assembled in one place from the two values above. */
export const KIT_EMBED_SRC = `https://${KIT_ACCOUNT}.kit.com/${KIT_FORM_ID}/index.js`;

/**
 * The route that fulfils the promise — the page or download the subscriber is
 * signing up to receive. Story 1-21 (the Movement Screen) is the first one.
 *
 * Declared rather than assumed so the build gate can CHECK it exists in dist
 * rather than trusting that someone remembered to ship it.
 */
export const DELIVERABLE_ROUTE = '/screen/';

/**
 * The publish switch. Flipping this alone is not enough and cannot be — the
 * gate cross-checks it against KIT_FORM_ID and against DELIVERABLE_ROUTE really
 * being in the build.
 *
 * STAYS FALSE UNTIL 1-21 SHIPS. Foundry's hard constraint, SM-26.
 */
export const CAPTURE_PUBLISHED = false;

/** The only thing a consumer should branch on. */
export const IS_CAPTURE_LIVE = CAPTURE_PUBLISHED && KIT_FORM_ID !== '';

/**
 * The overseas-providers row for the privacy policy. Derived here so the policy
 * names Kit on exactly the builds where Kit is receiving addresses.
 *
 * Kit (formerly ConvertKit) is US-based. `where` is deliberately hedged the same
 * way the Cloudflare row is — confirm against their DPA at signup rather than
 * asserting a country list we have not read.
 */
export const CAPTURE_PROVIDER = {
  name: 'Kit',
  handles: 'Email subscriptions and the emails sent to subscribers',
  where: 'United States — confirm from their data processing agreement at signup',
};

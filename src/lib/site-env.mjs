// Story 1-2. THE single source for "which site is this build for".
//
// Read this before changing anything here. The indexing polarity is the
// sharpest edge in Phase 1 (spec § 1.2):
//
//   staging indexed        -> Google sees a duplicate of the whole site. Bad,
//                             and recoverable in days.
//   production noindexed   -> the real site drops out of Google. Far worse,
//                             and recovery takes weeks.
//
// So the two failure modes are NOT symmetric, and the default is chosen by
// what it DOES on a miss rather than by which value is more common:
//
//   SITE_ENV unset  ->  PRODUCTION  ->  indexable
//
// A build that forgets to declare itself is therefore indexable, which is the
// survivable mistake. Staging must OPT IN to being hidden, and CI asserts it
// did (see scripts/check-indexing-polarity.mjs and the deploy workflow).
//
// It is deliberately a .mjs and not a .ts so astro.config.mjs and .astro
// frontmatter can both import the SAME module. Two copies of this decision is
// how the two halves drift apart.

/** @typedef {'production' | 'staging'} SiteEnv */

const RAW = (process.env.SITE_ENV ?? '').trim().toLowerCase();

/**
 * An unrecognised value is a HARD ERROR, not a silent fallback to the default.
 * `SITE_ENV=stagng` must not quietly produce an indexable staging site; a typo
 * in a workflow should fail the build with a sentence, not ship the wrong
 * polarity. Empty/unset is the only accepted "I did not say", and that is what
 * the production default is for.
 */
if (RAW !== '' && RAW !== 'production' && RAW !== 'staging') {
  throw new Error(
    `SITE_ENV must be "production", "staging", or unset — got "${process.env.SITE_ENV}". ` +
      `Refusing to guess: guessing wrong here either de-indexes production or publishes a duplicate.`,
  );
}

/** @type {SiteEnv} */
export const SITE_ENV = RAW === 'staging' ? 'staging' : 'production';

export const IS_STAGING = SITE_ENV === 'staging';

/** The one predicate everything else derives from. */
export const INDEXABLE = !IS_STAGING;

/** Canonical origin for this build. No trailing slash. */
export const SITE_URL = IS_STAGING
  ? 'https://staging.keegansmovementlab.com'
  : 'https://keegansmovementlab.com';

/**
 * Google Search Console verification token (story 1-2 / SEO brief landmine 2).
 * Carried on every build: losing it costs Keegan the only tool that would tell
 * him the migration hurt.
 */
export const GSC_TOKEN = 'IeAle3a1ZmuhHs5D7gx5ZsShoQPZ4ZHxb-K3oByz8b4';

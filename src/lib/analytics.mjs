// Story 1-8. Cloudflare Web Analytics — free, cookieless, no consent banner,
// and no DNS change (Cloudflare's own docs say it is designed for sites NOT
// proxied through Cloudflare, which is what cleared it for this site).
//
// ⚠️ ONE FLAG, TWO CONSUMERS, AND THAT IS THE POINT.
// Both the beacon (components/Analytics.astro) and the privacy policy's
// "what we collect" section read IS_ANALYTICS_ENABLED from here. If the policy
// said "we use Cloudflare Web Analytics" while no beacon was configured, the
// page would be describing collection that is not happening — a privacy policy
// that overstates is not a harmless inaccuracy, it is the document being wrong
// about the exact thing it exists to be right about.
//
// So: no token means no beacon AND the policy says so. They cannot disagree.
//
// The token is NOT a secret — Cloudflare's beacon token is public by design and
// visible in the page source of every site using it. It lives in an env var
// only so it can differ between staging and production, and so staging traffic
// does not pollute Keegan's real numbers.

const RAW = (process.env.CLOUDFLARE_ANALYTICS_TOKEN ?? '').trim();

/** Cloudflare beacon tokens are 32 hex characters. */
const LOOKS_VALID = /^[a-f0-9]{32}$/i.test(RAW);

if (RAW !== '' && !LOOKS_VALID) {
  throw new Error(
    `CLOUDFLARE_ANALYTICS_TOKEN is set but does not look like a Cloudflare beacon token ` +
      `(expected 32 hex characters, got ${RAW.length}). Refusing to emit a broken beacon ` +
      `while the privacy policy claims analytics are running.`,
  );
}

export const ANALYTICS_TOKEN = LOOKS_VALID ? RAW : null;
export const IS_ANALYTICS_ENABLED = ANALYTICS_TOKEN !== null;

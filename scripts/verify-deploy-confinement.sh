#!/usr/bin/env bash
# Story 1-11 (a) / AG-7 F3 — is the deploy key still confined?
#
# Compares the live server state against deploy/confinement.expected. Two things
# are checked, because either one going missing silently un-confines the key:
#   1. the forced command on the deploy key's authorized_keys line
#   2. the SHA-256 of ~/bin/rrsync (a rewritten rrsync is a bypass wearing the
#      right filename)
#
# ⚠️ THIS CANNOT RUN IN CI, and that is the mechanism working. The deploy key is
# restricted to rsync, so it cannot read authorized_keys or checksum a file —
# asking it to returns "rrsync error: SSH_ORIGINAL_COMMAND does not run rsync".
# Verification needs a SEPARATE unrestricted credential, so this is an operator
# step. Run it after any hPanel change, any support ticket touching SSH, and as
# a cutover precondition.
#
# Usage:
#   ADMIN_KEY=~/.ssh/your_admin_key H_USER=... H_HOST=... H_PORT=65002 \
#     ./scripts/verify-deploy-confinement.sh

set -uo pipefail

: "${ADMIN_KEY:?ADMIN_KEY not set — the UNRESTRICTED key, not the deploy key}"
: "${H_USER:?H_USER not set}" "${H_HOST:?H_HOST not set}"
PORT="${H_PORT:-65002}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
EXPECTED="$HERE/deploy/confinement.expected"
[ -f "$EXPECTED" ] || { echo "missing $EXPECTED"; exit 1; }

want_prefix=$(sed -n 's/^authorized_keys_prefix: //p' "$EXPECTED")
want_sha=$(sed -n 's/^rrsync_sha256: //p' "$EXPECTED")
[ -n "$want_prefix" ] && [ -n "$want_sha" ] || { echo "could not parse $EXPECTED"; exit 1; }

adm() {
  ssh -i "$ADMIN_KEY" -p "$PORT" -o StrictHostKeyChecking=yes -o BatchMode=yes \
      -o IdentitiesOnly=yes -o ConnectTimeout=20 "${H_USER}@${H_HOST}" "$@" 2>/dev/null
}

fail=0
ok()  { echo "  ok    $1"; }
bad() { echo "  FAIL  $1"; fail=$((fail+1)); }

echo "=== deploy-key confinement ==="

# Reachability first, so a dropped connection (UD-27) is never read as a verdict
# about the confinement — the same fail-open shape AG-7 F1 found in the Guard.
if ! adm true >/dev/null; then
  echo "  UNVERIFIED — could not reach the host with the admin key."
  echo "  This says nothing about the confinement. Re-run; if attempts hang for"
  echo "  the full timeout it is the UD-27 dropped-connection fault."
  exit 2
fi

line=$(adm 'grep github-actions-deploy ~/.ssh/authorized_keys')
if [ -z "$line" ]; then
  bad "no deploy-key line found in authorized_keys"
else
  got_prefix=$(printf '%s' "$line" | sed 's/ ssh-ed25519.*//' | sed "s|/home/${H_USER}|~|g")
  if [ "$got_prefix" = "$want_prefix" ]; then
    ok "forced command matches the pinned expectation"
  else
    bad "forced command DIFFERS from the pinned expectation"
    echo "        want: $want_prefix"
    echo "        got : $got_prefix"
  fi
fi

got_sha=$(adm 'sha256sum ~/bin/rrsync 2>/dev/null | cut -d" " -f1')
if [ -z "$got_sha" ]; then
  bad "~/bin/rrsync is MISSING — the forced command points at nothing"
elif [ "$got_sha" = "$want_sha" ]; then
  ok "~/bin/rrsync checksum matches ($got_sha)"
else
  bad "~/bin/rrsync has CHANGED"
  echo "        want: $want_sha"
  echo "        got : $got_sha"
fi

echo ""
if [ "$fail" -eq 0 ]; then
  echo "CONFINEMENT INTACT"
else
  echo "CONFINEMENT NOT INTACT — $fail check(s) failed."
  echo "Until this is resolved the deploy key may be able to reach the live"
  echo "WordPress files. deploy/confinement.expected documents the intended state."
fi
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)

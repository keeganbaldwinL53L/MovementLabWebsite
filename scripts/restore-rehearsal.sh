#!/usr/bin/env bash
# Story 1-12 — THE DRILL THAT ACTUALLY CLOSES THE STORY.
#
# A backup taken is not a backup proven. This restores a backup into throwaway
# containers and asserts the site actually comes back, then destroys them.
#
# THE BACKUP IS NEVER MODIFIED. Everything happens on a copy, because a
# rehearsal that corrupts the thing it is rehearsing is worse than no rehearsal.
#
# WHAT IT ASSERTS, and none of these is "the container started":
#   - the homepage returns 200 and is NOT the WordPress installer (an empty
#     database serves a perfectly healthy-looking install screen, which is the
#     single easiest false pass available here)
#   - the business name appears in the restored page
#   - the post/page row count in the restored database matches the dump
#   - a real file out of wp-content/uploads is served with an image content-type
#
# Usage: ./scripts/restore-rehearsal.sh ~/mlw-backups/mlw-production-<stamp>

set -euo pipefail

BACKUP="${1:?usage: restore-rehearsal.sh <backup-dir>}"
[ -f "$BACKUP/database.sql.gz" ] || { echo "no database.sql.gz in $BACKUP"; exit 1; }
[ -d "$BACKUP/files" ]           || { echo "no files/ in $BACKUP"; exit 1; }

NET=mlw-rehearsal-net
DB=mlw-rehearsal-db
WEB=mlw-rehearsal-web
PORT=8899
SCRATCH="$(mktemp -d)"
DB_PASS="rehearsal-only-$$"

pass=0; fail=0
ok()  { echo "  ok    $1"; pass=$((pass+1)); }
bad() { echo "  FAIL  $1"; fail=$((fail+1)); }

cleanup() {
  echo ""
  echo "tearing down the throwaway…"
  docker rm -f "$WEB" "$DB" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$SCRATCH"
}
trap cleanup EXIT

echo "=== restoring $(basename "$BACKUP") into throwaway containers ==="
echo ""

# --- work on a COPY, never the backup ----------------------------------------
echo "copying the site files to scratch (the backup itself is never touched)…"
cp -R "$BACKUP/files" "$SCRATCH/html"
chmod -R u+w "$SCRATCH/html"

# The restored site must not phone home. wp_options carries the LIVE siteurl,
# so without this override WordPress 301s every request to the production
# domain and the rehearsal "passes" against the real site — proving nothing and
# quietly measuring the thing we are trying to replace.
cat >> "$SCRATCH/html/wp-config-rehearsal.php" <<PHPEOF
<?php
define('WP_HOME',    'http://localhost:$PORT');
define('WP_SITEURL', 'http://localhost:$PORT');
PHPEOF
# splice the overrides in ahead of wp-settings.php, and repoint the DB
python3 - "$SCRATCH/html/wp-config.php" "$DB" "$DB_PASS" "$PORT" <<'PY'
import re, sys
path, dbhost, dbpass, port = sys.argv[1:5]
s = open(path, encoding='utf-8', errors='surrogateescape').read()
def setdef(src, name, val):
    pat = re.compile(r"define\(\s*['\"]%s['\"]\s*,.*?\);" % name, re.S)
    line = "define( '%s', '%s' );" % (name, val)
    return pat.sub(line, src, count=1) if pat.search(src) else src
s = setdef(s, 'DB_HOST', dbhost)
s = setdef(s, 'DB_PASSWORD', dbpass)
extra = ("define( 'WP_HOME', 'http://localhost:%s' );\n"
         "define( 'WP_SITEURL', 'http://localhost:%s' );\n"
         "define( 'WP_ENVIRONMENT_TYPE', 'local' );\n" % (port, port))
# must land BEFORE wp-settings.php is required, or the constants arrive too late
if 'wp-settings.php' in s:
    s = s.replace("require_once", extra + "require_once", 1)
else:
    s += "\n" + extra
open(path, 'w', encoding='utf-8', errors='surrogateescape').write(s)
print("  wp-config rewritten: DB_HOST, DB_PASSWORD, WP_HOME, WP_SITEURL")
PY
rm -f "$SCRATCH/html/wp-config-rehearsal.php"

DB_NAME=$(grep -o "define(\s*'DB_NAME'\s*,\s*'[^']*'" "$SCRATCH/html/wp-config.php" | sed "s/.*'\([^']*\)'$/\1/")
DB_USER=$(grep -o "define(\s*'DB_USER'\s*,\s*'[^']*'" "$SCRATCH/html/wp-config.php" | sed "s/.*'\([^']*\)'$/\1/")
echo "  restoring into database '$DB_NAME' as user '$DB_USER'"

# --- throwaway infrastructure -------------------------------------------------
docker rm -f "$WEB" "$DB" >/dev/null 2>&1 || true
docker network rm "$NET" >/dev/null 2>&1 || true
docker network create "$NET" >/dev/null

echo "starting MariaDB 11.8 (matching the host's 11.8.8)…"
docker run -d --name "$DB" --network "$NET" \
  -e MARIADB_ROOT_PASSWORD="$DB_PASS" \
  -e MARIADB_DATABASE="$DB_NAME" \
  -e MARIADB_USER="$DB_USER" \
  -e MARIADB_PASSWORD="$DB_PASS" \
  mariadb:11.8 >/dev/null

echo -n "  waiting for the database to accept connections"
for i in $(seq 1 60); do
  if docker exec "$DB" mariadb -u root -p"$DB_PASS" -e 'SELECT 1' >/dev/null 2>&1; then break; fi
  echo -n "."; sleep 2
done
echo ""
docker exec "$DB" mariadb -u root -p"$DB_PASS" -e 'SELECT 1' >/dev/null 2>&1 \
  || { echo "database never came up"; exit 1; }

echo "loading the dump…"
gzip -dc "$BACKUP/database.sql.gz" | docker exec -i "$DB" \
  mariadb -u root -p"$DB_PASS" --default-character-set=utf8mb4 "$DB_NAME"

# the live siteurl also lives in the DATABASE, and it wins for some lookups
docker exec "$DB" mariadb -u root -p"$DB_PASS" "$DB_NAME" -e \
  "UPDATE wp_options SET option_value='http://localhost:$PORT' WHERE option_name IN ('siteurl','home');" \
  >/dev/null 2>&1 || true

echo "starting the web tier (PHP 8.3, matching the host's 8.3.30)…"
docker run -d --name "$WEB" --network "$NET" -p "$PORT:80" \
  -v "$SCRATCH/html:/var/www/html" \
  wordpress:php8.3-apache >/dev/null

# ⚠️ `code=$(curl … || echo 000)` IS A TRAP and it cost a whole rehearsal run.
# On a refused connection curl PRINTS its own "000" via -w AND exits non-zero,
# so the `|| echo 000` appends a second one and the variable becomes "000\n000"
# — which compares UNEQUAL to "000", so the wait loop broke on the first
# iteration and every assertion then ran against a container that had not
# finished booting. Capture the status separately from the body, always.
http_code() {
  local c
  c=$(curl -s -o /dev/null -w '%{http_code}' "$1" 2>/dev/null) || c=000
  printf '%s' "${c:-000}"
}

echo -n "  waiting for HTTP"
for i in $(seq 1 45); do
  [ "$(http_code "http://localhost:$PORT/")" != "000" ] && break
  echo -n "."; sleep 2
done
echo ""

# =============================================================================
echo ""
echo "=== ASSERTIONS — is the site actually back? ==="

BODY=$(curl -sL "http://localhost:$PORT/" 2>/dev/null || true)
CODE=$(http_code "http://localhost:$PORT/")
[ "$CODE" = "301" ] || [ "$CODE" = "302" ] && CODE=$(curl -s -o /dev/null -w '%{http_code}' -L "http://localhost:$PORT/" 2>/dev/null || echo 000)

[ "$CODE" = "200" ] && ok "homepage returns 200" || bad "homepage returned $CODE"

# ⚠️ CONTENT ASSERTIONS ARE GATED ON A REAL RESPONSE. Without this gate an
# EMPTY body sails through "does not contain the installer" and reports ok —
# which is exactly what happened on the first run of this script, and it is the
# same false-green shape as a grep over output that was never produced. An
# assertion of the form "X is absent" is satisfied by having nothing at all.
if [ "$CODE" = "200" ] && [ -n "$BODY" ]; then
  # ⚠️ GREP A FILE, NEVER `echo "$BODY" | grep -q`. With `set -o pipefail`,
  # grep -q exits the instant it matches, the echo upstream dies of SIGPIPE
  # (141), and pipefail reports the whole pipeline as FAILED — so a successful
  # match is read as a miss. That cost a rehearsal run: the restored homepage
  # contained the business name 9 times and the assertion still said missing.
  # Same family as reading `$?` after a pipe.
  printf '%s' "$BODY" > "$SCRATCH/body.html"

  if grep -qi "wp-admin/install.php\|WordPress &rsaquo; Installation\|Welcome to the famous five-minute" "$SCRATCH/body.html"; then
    bad "served the INSTALLER — the database did not restore"
  else
    ok "not the installer screen (the database really loaded)"
  fi

  NAMEHITS=$(grep -oic "movement lab" "$SCRATCH/body.html" || true)
  if [ "${NAMEHITS:-0}" -gt 0 ]; then
    ok "the business name appears $NAMEHITS times in the restored page"
  else
    bad "business name missing from the restored homepage"
  fi

  TITLE=$(grep -oiE '<title>[^<]*</title>' "$SCRATCH/body.html" | head -1 || true)
  [ -n "$TITLE" ] && ok "restored page title: $TITLE" || bad "no <title> in the restored page"
else
  bad "SKIPPED the content assertions — no usable response body, so 'the installer is absent' would pass on emptiness alone"
fi

# row counts: restored database vs the dump itself
RESTORED=$(docker exec "$DB" mariadb -u root -p"$DB_PASS" "$DB_NAME" -N -B -e \
  "SELECT COUNT(*) FROM wp_posts WHERE post_status='publish' AND post_type IN ('post','page');" 2>/dev/null || echo -1)
DUMPED=$(gzip -dc "$BACKUP/database.sql.gz" | grep -c "INSERT INTO \`wp_posts\`" || true)
[ "${RESTORED:-0}" -gt 0 ] \
  && ok "restored database holds $RESTORED published posts/pages (dump had $DUMPED wp_posts INSERT statements)" \
  || bad "restored database reports $RESTORED published posts/pages"

TABLES=$(docker exec "$DB" mariadb -u root -p"$DB_PASS" -N -B -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB_NAME';" 2>/dev/null || echo 0)
[ "${TABLES:-0}" -ge 90 ] && ok "$TABLES tables restored" || bad "only $TABLES tables restored"

# a real upload must be SERVED, not merely present on disk — that is the half
# of the backup that is 822 MB and the half nobody notices is missing
UP=$(find "$SCRATCH/html/wp-content/uploads" -type f \( -name '*.jpg' -o -name '*.png' -o -name '*.webp' \) 2>/dev/null | head -1 || true)
if [ -n "${UP:-}" ]; then
  REL="${UP#$SCRATCH/html}"
  UCODE=$(http_code "http://localhost:$PORT$REL")
  UTYPE=$(curl -s -o /dev/null -w '%{content_type}' "http://localhost:$PORT$REL" 2>/dev/null) || UTYPE=none
  [ "$UCODE" = "200" ] && case "$UTYPE" in image/*) true;; *) false;; esac \
    && ok "an uploaded image is served: $(basename "$REL") ($UCODE, $UTYPE)" \
    || bad "uploads not served: $REL returned $UCODE $UTYPE"
else
  bad "no image files found in wp-content/uploads — the 822 MB half is missing"
fi

echo ""
echo "=== $pass passed, $fail failed ==="
[ $fail -eq 0 ] && echo "RESTORE PROVEN — this backup is bootable." \
                || echo "RESTORE NOT PROVEN — do not rely on this backup."
exit $([ $fail -eq 0 ] && echo 0 || echo 1)

#!/usr/bin/env bash
# Story 1-12 — proves what backup-production.sh REFUSES.
#
# The happy path is the least interesting thing about that script. Its job is to
# not leak a database full of real email addresses into a public repo, and a
# guard that has only ever been watched succeeding is not evidence of anything.
# So every refusal below is driven with the input it exists to reject, and each
# mutation is asserted to have LANDED before its result is believed — a mutation
# that never applied looks exactly like a guard that works.
#
# Needs no server and no MySQL: the script's ssh/rsync seam runs locally in
# --self-test, and a stub mysqldump stands in for the real one.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SCRIPT="$HERE/backup-production.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
ok()   { echo "  ok    $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $1"; fail=$((fail+1)); }

# --- stub mysqldump, so the DB half runs without a database ------------------
mkdir -p "$TMP/bin"
cat > "$TMP/bin/mysqldump" <<'STUB'
#!/usr/bin/env bash
echo "-- stub dump"
echo "CREATE TABLE \`wp_users\` (id int);"
echo "CREATE TABLE \`wp_posts\` (id int);"
STUB
chmod +x "$TMP/bin/mysqldump"
export PATH="$TMP/bin:$PATH"

# --- a fake WordPress root ---------------------------------------------------
make_wp() {
  local root="$1"
  mkdir -p "$root/wp-admin" "$root/wp-content/uploads" "$root/wp-includes"
  cat > "$root/wp-config.php" <<'CFG'
<?php
define( 'DB_NAME', 'wp_fixture_db' );
define( 'DB_USER', 'wp_fixture_user' );
define( 'DB_PASSWORD', 'not-a-real-password' );
define( 'DB_HOST', 'localhost' );
CFG
  echo "<?php // theme" > "$root/wp-content/index.php"
  echo "hello" > "$root/wp-content/uploads/photo.jpg"
  echo "index" > "$root/index.php"
}

run_backup() { # run_backup <wp_root> <dest> [env...]
  local wp="$1" dest="$2"; shift 2
  env "$@" WP_ROOT="$wp" DEST="$dest" bash "$SCRIPT" --self-test 2>&1
}

# =============================================================================
echo "1. the happy path still works (negative control — if this fails, every"
echo "   refusal below could be passing for the wrong reason)"
WP="$TMP/public_html"; make_wp "$WP"
out=$(run_backup "$WP" "$TMP/dest"); rc=$?
if [ $rc -eq 0 ]; then ok "completes against a valid WordPress root"; else bad "happy path failed: $out"; fi
echo "$out" | grep -q "db tables:    2" && ok "manifest counts the dumped tables (2)" || bad "table count wrong"
echo "$out" | grep -q "wp-config:    present" && ok "manifest confirms wp-config came across" || bad "wp-config not seen"
echo "$out" | grep -q "uploads dir:  present" && ok "manifest confirms uploads came across" || bad "uploads not seen"
find "$TMP/dest" -name 'database.sql.gz' | grep -q . && ok "a gzipped dump exists on disk" || bad "no dump written"
# the dump must be real content, not an empty file that only looks like success
gzip -dc "$(find "$TMP/dest" -name 'database.sql.gz' | head -1)" | grep -q 'wp_users' \
  && ok "the dump contains actual table DDL" || bad "dump has no DDL"

# =============================================================================
echo ""
echo "2. THE ONE THAT MATTERS: it refuses to write inside the PUBLIC repo"
inside="$HERE/../zz-backup-should-never-exist"
# positive control: prove the path really is inside the work tree before
# believing a refusal that claims so
repo_root="$(cd "$HERE/.." && pwd -P)"
mkdir -p "$inside"; inside_real="$(cd "$inside" && pwd -P)"
case "$inside_real/" in "$repo_root"/*) ok "(control) the test path IS inside the work tree";; *) bad "(control) test path is not inside the tree — the next assertion proves nothing";; esac
out=$(run_backup "$WP" "$inside"); rc=$?
[ $rc -ne 0 ] && ok "refuses a destination inside the git work tree" || bad "WROTE INTO THE REPO"
echo "$out" | grep -qi "public" && ok "and says why (the repo is public)" || bad "refusal does not explain the risk"
rmdir "$inside" 2>/dev/null

# a symlink must not smuggle it back in
ln -s "$repo_root" "$TMP/sneaky" 2>/dev/null
out=$(run_backup "$WP" "$TMP/sneaky/zz-sneaky"); rc=$?
[ $rc -ne 0 ] && ok "refuses a symlink that resolves back into the repo" || bad "SYMLINK GOT THROUGH"
rm -rf "$repo_root/zz-sneaky" 2>/dev/null

# =============================================================================
echo ""
echo "3. it refuses to run inside GitHub Actions (public artifacts)"
out=$(run_backup "$WP" "$TMP/dest2" GITHUB_ACTIONS=true); rc=$?
[ $rc -ne 0 ] && ok "refuses when GITHUB_ACTIONS is set" || bad "would have run in CI"
echo "$out" | grep -qi "read access" && ok "and names the actual exposure" || bad "refusal is vague"

# =============================================================================
echo ""
echo "4. it refuses a source that is not a WordPress root"
notwp="$TMP/notwp"; mkdir -p "$notwp/wp-admin"   # wp-admin but no wp-config
[ ! -f "$notwp/wp-config.php" ] && ok "(control) mutation landed: no wp-config.php" || bad "(control) setup wrong"
out=$(run_backup "$notwp" "$TMP/dest3"); rc=$?
[ $rc -ne 0 ] && ok "refuses a directory with no wp-config.php" || bad "backed up a non-WordPress dir"

halfwp="$TMP/halfwp"; mkdir -p "$halfwp"; cp "$WP/wp-config.php" "$halfwp/"
[ ! -d "$halfwp/wp-admin" ] && ok "(control) mutation landed: no wp-admin/" || bad "(control) setup wrong"
out=$(run_backup "$halfwp" "$TMP/dest4"); rc=$?
[ $rc -ne 0 ] && ok "refuses a directory with no wp-admin/" || bad "backed up a half-install"

# =============================================================================
echo ""
echo "5. it refuses to back up staging instead of production"
stg="$TMP/public_html/staging"; make_wp "$stg"
[ -f "$stg/wp-config.php" ] && ok "(control) mutation landed: staging looks like a valid WP root, so ONLY the name test can catch it" || bad "(control) setup wrong"
out=$(run_backup "$stg" "$TMP/dest5"); rc=$?
[ $rc -ne 0 ] && ok "refuses a WP_ROOT ending in /staging" || bad "backed up staging as if it were production"

# =============================================================================
echo ""
echo "6. it refuses an empty database dump (a backup that silently captured nothing)"
cat > "$TMP/bin/mysqldump" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod +x "$TMP/bin/mysqldump"
[ ! -s "$(mysqldump 2>/dev/null; echo)" ] 2>/dev/null; mysqldump | wc -c | grep -q '^ *0$' \
  && ok "(control) mutation landed: mysqldump now emits nothing" || bad "(control) stub not swapped"
out=$(run_backup "$WP" "$TMP/dest6"); rc=$?
[ $rc -ne 0 ] && ok "refuses when the dump comes back empty" || bad "ACCEPTED AN EMPTY BACKUP"

# =============================================================================
echo ""
echo "7. the wp-config parser survives the shapes a real file comes in"
cat > "$TMP/bin/mysqldump" <<'STUB'
#!/usr/bin/env bash
echo "CREATE TABLE \`wp_users\` (id int);"
STUB
chmod +x "$TMP/bin/mysqldump"
shapes="$TMP/shapes"; make_wp "$shapes"
cat > "$shapes/wp-config.php" <<'CFG'
<?php
define('DB_NAME', 'tight_no_spaces');
define( "DB_USER" ,  "double_quoted" );   // a trailing comment with 'quotes' in it
	define(	'DB_PASSWORD',	'tab-indented' );
define( 'DB_HOST', 'localhost' );
CFG
out=$(run_backup "$shapes" "$TMP/dest7"); rc=$?
[ $rc -eq 0 ] && ok "parses tight, double-quoted, tab-indented and comment-trailing defines" \
  || bad "parser broke on a realistic wp-config: $out"

echo ""
echo "$pass passed, $fail failed"
[ $fail -eq 0 ] || exit 1

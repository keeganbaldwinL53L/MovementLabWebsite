#!/usr/bin/env bash
# Story 1-12 — full production backup, files AND database.
#
# READ-ONLY ON THE SERVER. This script never writes to, moves or deletes
# anything on the host. It reads, and it pulls. That is the whole contract.
#
# THREE THINGS THAT WOULD GO WRONG IF NOBODY THOUGHT ABOUT THEM, all made
# structurally impossible here rather than warned about in a comment:
#
#   1. THE DUMP MUST NEVER LAND IN THE REPO. `keeganbaldwinL53L/movementlabwebsite`
#      is PUBLIC by Keegan's choice (standing directive 2026-07-29). A WordPress
#      database carries wp_users — real email addresses and password hashes — plus
#      whatever any contact-form plugin has stored. GitHub's own docs are explicit
#      that "read access to the repository is required" to download workflow
#      artifacts, and on a public repo the whole internet has read access. So this
#      refuses to write anywhere inside the git work tree, and it must never be
#      run from a GitHub Actions job on this repo. See REFUSING checks below.
#
#   2. THE DUMP MUST NEVER LAND IN public_html. On shared hosting the document
#      root is web-served, so a .sql file written there is downloadable by anyone
#      who guesses the name — the same exposure as (1) with a different door.
#      This never creates a server-side dump file at all: mysqldump is STREAMED
#      over the SSH connection straight to local disk.
#
#   3. A BACKUP OF THE WRONG DIRECTORY IS A USELESS BACKUP, and you find out at
#      the worst possible moment. The deploy workflow's guard REFUSES a WordPress
#      root because it is about to write; this one is the inverse and REQUIRES
#      one, because it is about to read.
#
# Closure for story 1-12 is the RESTORE, never this script finishing. See
# the restore rehearsal runbook (in the workbench at
# _projects/movement-lab-website/px-output/restore-rehearsal-2026-08-02.md)
# for the drill this produces the input for.
#
# Usage (real):
#   H_HOST=... H_USER=... H_PORT=... H_KEY=~/.ssh/id_x \
#   WP_ROOT=/home/u356448338/domains/keegansmovementlab.com/public_html \
#   DEST=~/mlw-backups ./scripts/backup-production.sh
#
# Usage (self-test, no host required — exercises every guard and the manifest
# against a fake WordPress tree on this machine):
#   ./scripts/backup-production.sh --self-test

set -euo pipefail

# --- the seam -----------------------------------------------------------------
# Everything that touches "the server" goes through RUN and PULL. Against the
# real host they are ssh and rsync; in --self-test they are local equivalents.
# Same code path either way, so the self-test is not testing a parallel copy.
SELF_TEST=0
[ "${1:-}" = "--self-test" ] && SELF_TEST=1

die() { echo "REFUSING: $*" >&2; exit 1; }
note() { echo "  $*"; }

if [ "$SELF_TEST" = "1" ]; then
  RUN() { bash -c "$1"; }
  PULL() { mkdir -p "$2" && cp -R "$1/." "$2/"; }
else
  : "${H_HOST:?H_HOST not set}" "${H_USER:?H_USER not set}" "${H_PORT:?H_PORT not set}"
  : "${H_KEY:?H_KEY not set}"
  SSH_OPTS=(-i "$H_KEY" -p "$H_PORT" -o StrictHostKeyChecking=yes
            -o BatchMode=yes -o IdentitiesOnly=yes)
  RUN() { ssh "${SSH_OPTS[@]}" "${H_USER}@${H_HOST}" "$1"; }
  # --partial matters here specifically: this host drops SSH connections
  # intermittently (UD-27, unresolved), and the document root measured 1.3 GB
  # across 18,612 files. Without it a drop at 90% restarts from zero; with it a
  # re-run resumes.
  #
  # ⚠️ FLAGS ARE DELIBERATELY OLD-RSYNC-SAFE. macOS ships openrsync, which
  # reports itself as "rsync version 2.6.9 compatible" and REJECTS --info=
  # outright (tried it, the run died with a usage dump). This script's whole
  # point is to run from a trusted local machine, and on this project that
  # machine is a Mac. Anything newer than the 2.6.9 flag set has to be checked
  # against `rsync --version` locally before it goes in here.
  PULL() { rsync -az --numeric-ids --partial \
             -e "ssh ${SSH_OPTS[*]}" \
             "${H_USER}@${H_HOST}:$1/" "$2/"; }
fi

: "${WP_ROOT:?WP_ROOT not set}"
: "${DEST:?DEST not set}"

STAMP="$(date -u '+%Y-%m-%dT%H%M%SZ')"
OUT="$DEST/mlw-production-$STAMP"

# --- guard 1: the destination must be outside this git work tree --------------
# Structural, not advisory. Resolving both sides first means a symlink or a
# ../.. cannot smuggle the dump back inside the repo.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
mkdir -p "$DEST"
DEST_REAL="$(cd "$DEST" && pwd -P)"
case "$DEST_REAL/" in
  "$REPO_ROOT"/*) die "DEST ($DEST_REAL) is inside the git work tree ($REPO_ROOT).
             The repo is PUBLIC. A database dump committed or uploaded from
             there is a disclosure of real people's email addresses." ;;
esac
[ -n "${GITHUB_ACTIONS:-}" ] && die "running inside GitHub Actions. Artifacts on a
             PUBLIC repo are downloadable by anyone with read access, which is
             everyone. Run this from a trusted machine instead."
note "destination ok: $DEST_REAL (outside $REPO_ROOT)"

# --- guard 2: the source must actually be a WordPress root -------------------
RUN "test -f '$WP_ROOT/wp-config.php'" \
  || die "$WP_ROOT has no wp-config.php — that is not the WordPress root, and a
             backup of the wrong directory is the kind of mistake you discover
             while trying to restore."
RUN "test -d '$WP_ROOT/wp-admin'" \
  || die "$WP_ROOT has no wp-admin/ — not a WordPress install."
note "source ok: $WP_ROOT is a WordPress root"

# --- guard 3: refuse to back up the staging dir by mistake -------------------
# staging lives INSIDE public_html on this host, so a mistyped path is easy and
# would produce a backup of the new site instead of the one being replaced.
case "$WP_ROOT" in
  */staging|*/staging/) die "WP_ROOT points at the staging directory. Back up
             PRODUCTION — staging is the thing replacing it, and it is already
             reproducible from git." ;;
esac

mkdir -p "$OUT/files"

# --- database: streamed, never written to the server -------------------------
# Credentials are read on the server and used on the server. They are never
# printed, never stored locally, and never travel as shell arguments (which are
# visible in the remote process list to any other user on a shared host) —
# mysqldump reads them from a --defaults-file written to the server's own
# private temp dir and deleted in a trap.
note "dumping database (streamed, no dump file is created on the server)…"
DB_CMD=$(cat <<'REMOTE'
set -eu
CFG=$(mktemp); trap 'rm -f "$CFG"' EXIT
# POSIX bracket classes, NOT \s and NOT a greedy \(.*\): BSD sed (macOS, where
# the self-test runs) has no \s, and a greedy group runs past the closing quote
# on any line with a trailing comment. Value class excludes quotes instead.
php_get() {
  sed -n "s/^[[:space:]]*define([[:space:]]*['\"]$1['\"][[:space:]]*,[[:space:]]*['\"]\([^'\"]*\)['\"].*/\1/p" \
    "$WP_ROOT/wp-config.php" | head -1
}
DB_NAME=$(php_get DB_NAME); DB_USER=$(php_get DB_USER)
DB_PASS=$(php_get DB_PASSWORD); DB_HOST=$(php_get DB_HOST)
[ -n "$DB_NAME" ] || { echo "could not parse DB_NAME from wp-config.php" >&2; exit 1; }
printf '[client]\nuser=%s\npassword=%s\nhost=%s\n' "$DB_USER" "$DB_PASS" "${DB_HOST:-localhost}" > "$CFG"
chmod 600 "$CFG"
mysqldump --defaults-file="$CFG" --single-transaction --quick \
          --default-character-set=utf8mb4 --routines --triggers --events \
          "$DB_NAME"
REMOTE
)
RUN "WP_ROOT='$WP_ROOT'; $DB_CMD" | gzip > "$OUT/database.sql.gz"
# NOT `test -s`: gzip of zero bytes still writes a ~20-byte header, so a file
# test reads a completely empty dump as a healthy one. Caught by the test
# suite's empty-mysqldump case, which is the whole reason that case exists.
# The dump has to be checked by its CONTENT.
TABLES=$(gzip -dc "$OUT/database.sql.gz" 2>/dev/null | grep -c '^CREATE TABLE' || true)
[ "${TABLES:-0}" -ge 1 ] || die "the database dump contains no CREATE TABLE statements
             — the dump is empty or truncated. A backup that captured nothing is
             worse than no backup, because the cutover decision would rest on it."
note "database captured: $(du -h "$OUT/database.sql.gz" | cut -f1)"

# --- files -------------------------------------------------------------------
note "pulling files…"
PULL "$WP_ROOT" "$OUT/files"

# --- manifest: what makes the restore CHECKABLE rather than hopeful ----------
{
  echo "# Movement Lab — production backup manifest"
  echo "taken:        $STAMP"
  echo "source:       ${H_USER:-local}@${H_HOST:-self-test}:$WP_ROOT"
  echo "file count:   $(find "$OUT/files" -type f | wc -l | tr -d ' ')"
  echo "files bytes:  $(du -sk "$OUT/files" | cut -f1) KB"
  echo "db gz bytes:  $(wc -c < "$OUT/database.sql.gz" | tr -d ' ')"
  echo "db tables:    $TABLES"
  echo "wp-config:    $([ -f "$OUT/files/wp-config.php" ] && echo present || echo MISSING)"
  echo "uploads dir:  $([ -d "$OUT/files/wp-content/uploads" ] && echo present || echo MISSING)"
  echo ""
  echo "## restore is NOT proven until restore-rehearsal.md has been run against this."
} > "$OUT/MANIFEST.txt"

cat "$OUT/MANIFEST.txt"
echo ""
echo "Backup written to: $OUT"
echo "A backup taken is not a backup proven — run the restore rehearsal next."

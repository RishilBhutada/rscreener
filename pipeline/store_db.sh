#!/usr/bin/env bash
# Store a database on the data-db release without ever leaving it with no copy.
#
#   bash pipeline/store_db.sh FILE.gz
#
# `gh release upload --clobber` DELETES the stored file first and then uploads
# the new one. A run that dies mid-upload (a 30-minute job limit, three failed
# attempts) left the release with no database at all, and every later night
# restored nothing (review alerts-workflows #2, 7-Nov-2026). Now:
#
#   1. upload as FILE.gz.new           - the stored FILE.gz is untouched
#   2. FILE.gz      -> FILE.gz.prev    - last night's copy, kept as a backup
#   3. FILE.gz.new  -> FILE.gz         - renames, one API call each
#
# A GitHub asset appears only once its upload has finished, so FILE.gz.new is
# never half a file. Between steps 2 and 3 (about a second) FILE.gz is absent;
# readers retry, and the nightly falls back to FILE.gz.prev.
#
# Exit 0 when stored, 1 when not (the caller retries or reports).
set -u
file=$1
name=$(basename "$file")
repo=${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}
api="repos/$repo/releases"

asset_id() {  # the id of a release asset by name, or nothing
  gh api "$api/tags/data-db" --jq ".assets[] | select(.name == \"$1\") | .id" 2>/dev/null | head -1
}

if ! gh release view data-db -R "$repo" >/dev/null 2>&1; then
  gh release create data-db "$file" -R "$repo" --title 'Data DB' \
    --notes 'SQLite data snapshot used and refreshed by the nightly workflow.' && exit 0
  exit 1
fi

# 1. The new copy beside the stored one. A leftover .new from an earlier run
#    that died between steps is replaced (only the .new is clobbered).
cp "$file" "$name.new" || exit 1
gh release upload data-db "$name.new" -R "$repo" --clobber || { rm -f "$name.new"; exit 1; }
rm -f "$name.new"
new_id=$(asset_id "$name.new")
[ -n "$new_id" ] || { echo "::warning::$name.new not found after upload"; exit 1; }

# 2. The stored copy becomes the backup (replacing the older backup).
old_id=$(asset_id "$name")
if [ -n "$old_id" ]; then
  prev_id=$(asset_id "$name.prev")
  [ -n "$prev_id" ] && gh api -X DELETE "$api/assets/$prev_id" >/dev/null
  gh api -X PATCH "$api/assets/$old_id" -f name="$name.prev" >/dev/null \
    || { echo "::warning::could not keep $name as $name.prev - leaving it; the new copy stays as $name.new"; exit 1; }
fi

# 3. The new copy takes the stored name.
gh api -X PATCH "$api/assets/$new_id" -f name="$name" >/dev/null || {
  # Put the old copy back rather than leave no FILE.gz at all.
  [ -n "$old_id" ] && gh api -X PATCH "$api/assets/$old_id" -f name="$name" >/dev/null
  echo "::warning::could not rename $name.new to $name"; exit 1
}
echo "stored $name ($(du -h "$file" | cut -f1)); the previous copy is kept as $name.prev"

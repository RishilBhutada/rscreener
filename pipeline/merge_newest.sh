#!/usr/bin/env bash
# Before storing a database on the data-db release, take in whatever another
# run stored there since this one downloaded it (pipeline/merge_stored_db.py).
#
#   bash pipeline/merge_newest.sh ASSET OURS BASE_GZ
#     ASSET    the release file, e.g. rscreener.db.gz or news.db.gz
#     OURS     this run's database, changed in place, e.g. data/rscreener.db
#     BASE_GZ  the .gz exactly as this run downloaded it at the start
#
# Every upload of these files is `--clobber`: the whole file replaces the
# stored one. Two overlapping runs (the nightly and "Publish new results", the
# nightly and the news watcher) used to throw away whichever stored first.
#
# Always exits 0. If the stored copy cannot be read again or the merge fails,
# this run's copy is stored as it is - the old behaviour - because refusing to
# store would throw away this run's own work, which is the bigger loss.
set -u
asset=$1; ours=$2; base_gz=$3
repo=()
[ -n "${GITHUB_REPOSITORY:-}" ] && repo=(-R "$GITHUB_REPOSITORY")

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
# An upload with --clobber deletes the old file a moment before the new one is
# up, so a download in that gap finds nothing: try again before giving up.
for attempt in 1 2 3; do
  gh release download data-db --pattern "$asset" --dir "$dir" --clobber "${repo[@]}" 2>/dev/null && break
  [ "$attempt" = 3 ] || sleep 20
done
if [ ! -f "$dir/$asset" ]; then
  if [ -f "$base_gz" ]; then
    echo "::warning::could not read the stored $asset again - storing this run's copy without checking for another run's work"
  else
    echo "$asset: nothing stored yet - nothing to merge"
  fi
  exit 0
fi
if [ -f "$base_gz" ] && cmp -s "$dir/$asset" "$base_gz"; then
  echo "$asset: unchanged since this run started - nothing to merge"
  exit 0
fi

echo "$asset: another run stored a newer copy while this one worked - taking in its changes"
if [ -f "$base_gz" ]; then
  gunzip -c "$base_gz" > "$dir/base.db" || { echo "::warning::could not unpack this run's starting copy of $asset - storing without merging"; exit 0; }
else
  # This run started with nothing stored: everything in the newest copy is
  # the other run's.
  python -c "import sqlite3, sys; sqlite3.connect(sys.argv[1]).close()" "$dir/base.db"
fi
if gunzip -c "$dir/$asset" > "$dir/newest.db" \
   && python pipeline/merge_stored_db.py --base "$dir/base.db" --newest "$dir/newest.db" --into "$ours"; then
  exit 0
fi
echo "::warning::could not merge the other run's changes into $ours - storing this run's copy as it is, so what the other run stored meanwhile is lost"
exit 0

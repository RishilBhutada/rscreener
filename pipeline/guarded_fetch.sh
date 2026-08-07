#!/usr/bin/env bash
# Run a fetcher, tolerating a bad night on the network but never a bad command.
#
# Every fetch step used to carry `continue-on-error: true`, which treats those
# two things as the same. They are not. NSE timing out is weather; a script that
# rejects its own arguments is a broken build, and hiding it costs weeks.
#
# fetch_prices.py was invoked with `--limit 600`, an option it never accepted.
# Every run since the workflow was written died instantly with argparse exit 2,
# reported a green tick, and refreshed no price history at all. It surfaced only
# on 4-Aug-2026, and then only indirectly - the price-freshness metric read 100%
# throughout, because it measures each symbol against the newest bar in the
# table and every symbol was equally out of date.
#
# Exit codes, per Python convention:
#   0  fine
#   2  argparse rejected the command line - the workflow and the script disagree
#   1  uncaught exception - a real crash, distinct from a handled fetch failure
# Fetchers handle their own per-symbol network errors and still exit 0, so a
# non-zero code here always means something structural.
set -u

"$@"
code=$?

case $code in
  0)
    exit 0
    ;;
  2)
    echo "::error title=Fetcher invoked wrongly::$* exited 2 - it rejected its own arguments. This is a mismatch between the workflow and the script, not a network problem, and it will repeat every night until fixed."
    exit 1
    ;;
  *)
    # Tolerated, but said out loud and attached to the run summary rather than
    # buried mid-log. A source that keeps warning is a source going stale.
    echo "::warning title=Fetch step failed::$* exited $code. Continuing; data from this source may be stale tonight."
    exit 0
    ;;
esac

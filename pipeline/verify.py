"""Rscreener - one command that answers "is this better or worse than before?".

Why this exists: the checks that decide whether a change helped were four
separate scripts, and the comparison against the previous numbers was done by
eye. That is a ritual, and rituals get skipped under time pressure - which is
exactly when a regression ships.

The deeper lesson it encodes: on 2-Aug-2026 three changes were BUILT before being
measured, and all three turned out to be worse. Interpolated book value took
Price/Book from 7.9% to 13.9% median error. A median-based outlier filter threw
away Reliance's real 2008-2012 history. Eight fetch workers instead of four ran
no faster, because NSE was the limit, not concurrency. Each would have cost
minutes to test and instead cost an implementation. Measure first.

Usage:
  python verify.py            # run every guard, compare against the last accepted run
  python verify.py --accept   # store this run as the new comparison point
"""
import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HERE = Path(__file__).resolve().parent
BASELINE = HERE / "verify_baseline.json"
STATUS = ROOT / "web" / "public" / "status.json"

COVERAGE_DROP_ALLOWED = 5  # percentage points; companies report on their own schedule


def run(script: str) -> tuple[bool, str]:
    r = subprocess.run([sys.executable, str(HERE / script)], capture_output=True, text=True)
    return r.returncode == 0, (r.stdout + r.stderr).strip()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--accept", action="store_true", help="store this run as the comparison point")
    ap.add_argument("--reason", help="required with --accept when something went backwards")
    args = ap.parse_args()

    print("running guards ...\n")
    failed: list[str] = []
    for label, script in (("prices", "check_prices.py"), ("chart depth", "check_depth.py"),
                          ("figures trace to filings", "check_sources.py")):
        ok, out = run(script)
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
        if not ok:
            failed.append(label)
            print("\n".join("        " + ln for ln in out.splitlines()[-10:]))

    run("export_status.py")
    coverage: dict[str, int] = {}
    if STATUS.exists():
        for s in json.loads(STATUS.read_text(encoding="utf-8")).get("sources", []):
            coverage[s["name"]] = s["pct"]

    prev_cov = (json.loads(BASELINE.read_text(encoding="utf-8")) if BASELINE.exists() else {}).get("coverage", {})

    print(f"\n  {'source':32} {'now':>6} {'was':>6}   change")
    regressions: list[str] = []
    for name, pct in coverage.items():
        was = prev_cov.get(name)
        if was is None:
            mark = "new"
        elif pct > was:
            mark = f"+{pct - was}"
        elif pct < was:
            mark = str(pct - was)
            if was - pct >= COVERAGE_DROP_ALLOWED:
                regressions.append(f"{name}: {was}% -> {pct}%")
        else:
            mark = "="
        shown_was = "-" if was is None else f"{was}%"   # ASCII: the Windows console is cp1252
        print(f"  {name:32} {pct:>5}% {shown_was:>6}   {mark}")

    # A source that VANISHES is the regression this loop could not see, because
    # it walks what exists now and a disappeared source is not in that. Deleting
    # a fetcher, renaming a key, or an exporter that stops emitting a section all
    # produced the same output as a healthy run: no row, no change, ship it. The
    # worst regression a coverage table can have is a line that is no longer
    # there, and it was the one case that read as silence.
    for name, was in prev_cov.items():
        if name not in coverage:
            print(f"  {name:32} {'GONE':>6} {str(was) + '%':>6}   missing")
            regressions.append(f"{name}: {was}% -> the source is no longer reported at all")

    if failed or regressions:
        print("\nNOT READY TO SHIP")
        for f in failed:
            print(f"  ! guard failed: {f}")
        for r in regressions:
            print(f"  ! went backwards: {r}")
        # A failed guard is never acceptable. A coverage drop sometimes is - a
        # source can legitimately shrink, or a backfill can still be running -
        # but only with the reason written into the baseline, because an
        # unexplained reset is indistinguishable from the regression it hides.
        if failed or not args.accept:
            raise SystemExit(1)
        if not args.reason:
            raise SystemExit("\n--accept over a regression needs --reason '<why>'.")
    else:
        print("\nall guards pass, nothing went backwards")

    if args.accept:
        record: dict = {
            "at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "coverage": coverage,
        }
        if regressions:
            record["accepted_regressions"] = regressions
            record["reason"] = args.reason
        BASELINE.write_text(json.dumps(record, indent=1), encoding="utf-8")
        print(f"stored as the comparison point -> {BASELINE.name}")


if __name__ == "__main__":
    main()

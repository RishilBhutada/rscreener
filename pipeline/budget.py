"""One deadline, shared by every fetcher in a run.

A nightly run is not "fetch everything, then publish". It is "publish, having
fetched as much as the time allowed" - and the difference between those two is
the whole system.

On 13-Aug-2026 the universe doubled to 5,069 companies and nobody re-measured
how long a run takes. It takes 5h30m of fetching. The job's own backstop killed
it at 5h30m, at step 16 of 31, so the database save at step 20 and the publish
at step 31 never ran. Every night for two weeks the run fetched for five and a
half hours and then threw all of it away. Nothing failed loudly - the runs were
merely "cancelled", the site kept serving old data, and the only visible symptom
was that nothing ever got better.

Per-step limits cannot fix that, because they cannot see each other: a step that
finishes early hands its unused time to nobody, and a step that overruns eats
the publish. A single wall-clock deadline for the whole run can. Each fetcher
stops when it is reached and says what it deferred; whatever was fetched is
saved and published, and the rotation picks up the rest tomorrow.

Partial data published beats complete data discarded. That is not a compromise,
it is the only version of this that converges.

Set RSCREENER_DEADLINE to a unix timestamp. Unset, nothing is limited, so a
hand-run command behaves exactly as it always did.
"""
import os
import time


def deadline() -> float | None:
    """The run's deadline as a unix timestamp, or None if unbounded."""
    raw = os.environ.get("RSCREENER_DEADLINE", "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        # A malformed deadline must not silently mean "no limit" in the cloud,
        # but it must also not stop a fetch dead. Say so and carry on unbounded.
        print(f"  RSCREENER_DEADLINE is not a number ({raw!r}) - running unbounded", flush=True)
        return None


def expired() -> bool:
    d = deadline()
    return d is not None and time.time() >= d


def remaining_minutes() -> float | None:
    d = deadline()
    return None if d is None else max(0.0, (d - time.time()) / 60)


def stop(done: int, total: int, what: str = "symbols") -> bool:
    """True when the run is out of time. Prints what was deferred.

    Call at the top of a per-symbol loop; `done` is how many are finished.
    """
    if not expired():
        return False
    print(f"  out of time for this run - stopped after {done} of {total} {what}; "
          f"the remaining {max(0, total - done)} come up on the next run", flush=True)
    return True


def announce(label: str) -> None:
    """Record how long this step believes it has, so the log can be read after."""
    left = remaining_minutes()
    if left is not None:
        print(f"  {label}: {left:.0f} minutes left in this run's budget", flush=True)

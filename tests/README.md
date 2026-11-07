# Tests

Small hand-built inputs only: no network, no real database. Where a function
needs a database connection, the test builds a tiny SQLite file in a temporary
folder holding just the rows it is about.

Run from the repository root:

    pip install pytest pandas numpy requests
    python -m pytest tests -q

The web TTM rule (`web/src/lib/ttm.ts`) is tested with Node's own runner:

    cd web && npm test

`.github/workflows/tests.yml` runs both, plus `npx tsc --noEmit` in `web/`, on
every push and pull request to `main`.

A test describes what the code is MEANT to do today. If one exposes a real bug,
production code is not changed alongside it: the test is marked
`@pytest.mark.xfail(reason=...)` until the fix lands.

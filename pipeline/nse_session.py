"""One place for talking to NSE without mistaking a refusal for an answer.

NSE hands out a cookie on the first visit and rejects API calls that arrive
without a live one. It also throttles a burst of requests by dropping the
connection outright rather than returning a status code. Both look identical to
a caller that makes one attempt: an exception, recorded as that symbol's result,
and the loop moves on.

The consequence was measurable. 301 of 2,357 companies had no shareholding
pattern, every one of them logged as
`HTTPSConnectionPool(host='www.nseindia.com', port=443): Max retries exceeded`.
They were not companies without a shareholding pattern. They were companies
whose turn came after NSE stopped answering, and the next night the same thing
happened from a different starting point. The site reported 81% coverage and
attributed the gap to data that did not exist.

A dropped connection is a statement about the connection. Retrying, and
re-priming the session between attempts, turns most of them back into data.
"""
import time

import requests

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}
HOME = "https://www.nseindia.com"
# 429 is an explicit "slow down"; 5xx is NSE having a moment. Both are worth a
# second ask. A 404 is an answer - that symbol has no page - and is not retried.
RETRY_STATUS = {429, 500, 502, 503, 504}


def new_session() -> requests.Session:
    s = requests.Session()
    s.headers.update(HEADERS)
    prime(s)
    return s


def prime(s: requests.Session) -> None:
    """Fetch the home page so the session carries a valid cookie."""
    try:
        s.get(HOME, timeout=20)
    except Exception:  # noqa: BLE001 - priming is best-effort by design
        pass


def get(s: requests.Session, url: str, *, tries: int = 3, timeout: int = 25,
        base_wait: float = 3.0) -> requests.Response:
    """GET with backoff, re-priming the session between attempts.

    Raises the last exception if every attempt fails, so a symbol that genuinely
    has no page still records an error and is not retried forever.
    """
    last: Exception | None = None
    for attempt in range(tries):
        try:
            r = s.get(url, timeout=timeout)
            if r.status_code in RETRY_STATUS:
                raise requests.HTTPError(f"HTTP {r.status_code} from NSE", response=r)
            r.raise_for_status()
            return r
        except Exception as e:  # noqa: BLE001
            last = e
            if attempt == tries - 1:
                break
            # A refused or dropped connection almost always means the session is
            # dead rather than the symbol being absent, so wait and start a fresh
            # handshake before asking again.
            time.sleep(base_wait * (2 ** attempt))
            prime(s)
    raise last if last else RuntimeError("request failed with no exception")

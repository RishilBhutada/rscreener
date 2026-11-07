"""Sending to the owner's phone through ntfy.sh, shared by every alert script.

post()       sends one push. The title is sent as UTF-8 bytes, because a plain
             str header is encoded as Latin-1 and an NSE subject with a curly
             quote or a dash would crash the run. Never raises: returns True
             only when ntfy accepted the message, so a caller records an alert
             as sent only once it really was.
sent_tags()  the tags on the topic's recent messages, for "never send one
             twice". Returns None when the topic could not be read - the
             caller then sends nothing this run rather than repeating every
             alert. ntfy.sh keeps messages about twelve hours, so a caller
             must only consider events younger than that (see WINDOW_H).

Usage: from ntfy_lib import post, sent_tags
"""
import json
import os

import requests

TOPIC = os.environ.get("NTFY_TOPIC", "")
# ntfy.sh's message cache is twelve hours; events older than this cannot be
# checked against what was sent, so the scripts leave them alone.
WINDOW_H = 10


def post(title: str, body: str, tags: str = "", click: str = "", priority: str = "default") -> bool:
    if not TOPIC:
        print(f"(no NTFY_TOPIC) would push: {title} | {body}")
        return True
    headers = {"Title": title.encode("utf-8"), "Priority": priority}
    if tags:
        headers["Tags"] = tags
    if click:
        headers["Click"] = click
    try:
        r = requests.post(f"https://ntfy.sh/{TOPIC}", data=body.encode("utf-8"), headers=headers, timeout=15)
    except requests.RequestException as e:
        print(f"push failed ({type(e).__name__}): {title[:60]}")
        return False
    if not r.ok:
        print(f"push refused (HTTP {r.status_code}): {title[:60]}")
    return r.ok


def sent_tags(prefix: str, since: str = "12h") -> set[str] | None:
    if not TOPIC:
        return set()
    try:
        r = requests.get(f"https://ntfy.sh/{TOPIC}/json", params={"poll": "1", "since": since}, timeout=30)
    except requests.RequestException:
        return None
    if not r.ok:
        return None
    tags: set[str] = set()
    for line in r.text.splitlines():
        try:
            tags.update(t for t in json.loads(line).get("tags") or [] if t.startswith(prefix))
        except (ValueError, AttributeError):
            return None             # not ntfy's line-per-message JSON: an error page
    return tags

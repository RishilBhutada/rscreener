"""Which run's site is live: the run behind the latest successful Pages deployment.

results.yml republishes the LIVE site with a few files swapped in, so it has to
start from exactly what is deployed. Not the newest "github-pages" artifact:
that can belong to a nightly run still checking its data, or to one whose
deployment failed.

Usage:  GH_TOKEN=... python live_site.py      prints the run id
"""
import os
import re
import sys

import requests

REPO = os.environ.get("GITHUB_REPOSITORY", "RishilBhutada/rscreener")


def main() -> None:
    h = {"Authorization": f"Bearer {os.environ['GH_TOKEN']}", "Accept": "application/vnd.github+json"}
    deployments = requests.get(f"https://api.github.com/repos/{REPO}/deployments",
                               params={"environment": "github-pages", "per_page": 10}, headers=h, timeout=30)
    deployments.raise_for_status()
    for d in deployments.json():
        statuses = requests.get(d["statuses_url"], params={"per_page": 5}, headers=h, timeout=30)
        statuses.raise_for_status()
        # Newest status first. One still in progress is not live yet; one that
        # failed never was.
        st = statuses.json()
        if st and st[0]["state"] == "success":
            m = re.search(r"/actions/runs/(\d+)", st[0].get("log_url") or st[0].get("target_url") or "")
            if m:
                print(m.group(1))
                return
    sys.exit("no successful Pages deployment among the last ten")


if __name__ == "__main__":
    main()

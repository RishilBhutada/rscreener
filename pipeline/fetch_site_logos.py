"""Logos for the Others page (web/public/sites/<id>.png), by the same rules as company
logos in fetch_logos.py: the site's own declared icon first (robots.txt respected),
else DuckDuckGo's icon service, else Google's gstatic one; raster only. Each is saved
as a 64x64 PNG. Run by hand when the Others list changes; not part of the nightly."""
import io
from pathlib import Path

import requests
from PIL import Image

import fetch_logos as fl

OUT = Path(__file__).resolve().parent.parent / "web" / "public" / "sites"
SITES = {
    "moneycontrol": "https://www.moneycontrol.com", "sovrenn": "https://www.sovrenn.com", "investing": "https://in.investing.com",
    "tickertape": "https://www.tickertape.in", "screener": "https://www.screener.in", "smallcase": "https://www.smallcase.com",
    "investorgain": "https://www.investorgain.com", "ipopremium": "https://ipopremium.in", "forexfactory": "https://www.forexfactory.com",
    "trendlyne": "https://trendlyne.com", "finology": "https://ticker.finology.in", "research360": "https://www.research360.in",
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    s = requests.Session()
    s.headers.update({"User-Agent": fl.UA, "Accept": "text/html,image/*;q=0.9,*/*;q=0.5"})
    for sid, site in SITES.items():
        got = fl.fetch_icon(s, site)
        how = "own site"
        if isinstance(got, str):
            got = fl.from_service(s, site)
            how = "service"
        if not got or isinstance(got, str):
            print(f"{sid}: no icon ({got}) - initials will show")
            continue
        _mime, data, url = got
        try:
            im = Image.open(io.BytesIO(data))
            if getattr(im, "n_frames", 1) > 1:
                im.seek(0)
            im = im.convert("RGBA")
            # Fit 64x64 either way: a 32px icon is scaled up rather than left small.
            k = 64 / max(im.width, im.height)
            im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
            canvas = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
            canvas.paste(im, ((64 - im.width) // 2, (64 - im.height) // 2))
            canvas.save(OUT / f"{sid}.png", optimize=True)
            print(f"{sid}: {how} {url[:70]} -> {im.width}x{im.height}")
        except Exception as e:  # an image PIL cannot read stays out
            print(f"{sid}: unreadable ({e})")


if __name__ == "__main__":
    main()

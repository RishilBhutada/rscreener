"""Generates the Rscreener PWA icons (three rising emerald bars on dark slate)."""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "web" / "public"

BG = (15, 23, 42)        # slate-900
BAR = (16, 185, 129)     # emerald-500


def make(size: int, name: str) -> None:
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)
    u = size / 512
    bars = [  # (x, top) in 512-space; bottoms share a baseline
        (96, 288),
        (216, 192),
        (336, 96),
    ]
    w, bottom, r = 80 * u, 416 * u, 12 * u
    for x, top in bars:
        d.rounded_rectangle([x * u, top * u, x * u + w, bottom], radius=r, fill=BAR)
    img.save(OUT / name)
    print(f"{name}: {size}x{size}")


if __name__ == "__main__":
    make(512, "icon-512.png")
    make(192, "icon-192.png")

#!/usr/bin/env python3
"""Generate the gradient placeholder images in img/placeholder/.

    python tools/make_placeholders.py

The client has not sent the photo sets for Visuals or In the Making yet, so
these stand in: soft two- and three-colour gradients, each at the exact shape
its slot on the page uses, so the layout reads the way it will with real
photographs. Replace them from the admin as the real ones arrive; nothing on
the site depends on these files existing once they are swapped out.

Needs Pillow. The site build itself does not - this is a one-off asset step.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "img" / "placeholder"

# Colours drawn from the site's own palette and the album artwork around it.
PALETTES = {
    "magenta": ["#FA279F", "#7A1CAC", "#1D0C16"],
    "sunset":  ["#FFB347", "#FA279F", "#3B0A45"],
    "ember":   ["#B25A16", "#E8A33D", "#2A1208"],
    "lagoon":  ["#00C2C7", "#2B59C3", "#0B0A2A"],
    "acid":    ["#05F93B", "#0E7C66", "#06201A"],
    "violet":  ["#B388FF", "#5B2A86", "#140A24"],
    "peach":   ["#FFD1BA", "#F2789F", "#5C2A4A"],
    "ocean":   ["#7FDBFF", "#0074D9", "#001F3F"],
    "rose":    ["#FF5E78", "#8E2DE2", "#1A0B2E"],
    "citrus":  ["#F9F871", "#FF9671", "#6A2C70"],
    "mint":    ["#B8F2E6", "#5E8C9A", "#1B2A38"],
    "night":   ["#4E54C8", "#8F94FB", "#0F0C29"],
}

# name, width, height, palette, angle (degrees)
# Gallery shapes are the column:row spans of their slot in build.py's grid.
GALLERY = [
    ("photo-01", 6, 8, "magenta", 35),
    ("photo-02", 6, 4, "lagoon", 120),
    ("photo-03", 3, 4, "ember", 70),
    ("photo-04", 3, 4, "violet", 200),
    ("photo-05", 8, 4, "sunset", 15),
    ("photo-06", 4, 4, "acid", 250),
    ("photo-07", 4, 6, "peach", 160),
    ("photo-08", 6, 6, "ocean", 300),
    ("photo-09", 2, 3, "rose", 90),
    ("photo-10", 2, 3, "citrus", 20),
    ("photo-11", 9, 3, "night", 180),
    ("photo-12", 3, 3, "mint", 45),
    ("photo-13", 4, 2, "magenta", 210),
    ("photo-14", 4, 2, "lagoon", 330),
    ("photo-15", 4, 2, "ember", 140),
]

# The In the Making ring: deliberately every kind of shape.
RING = [
    ("ring-01", 1, 1, "sunset", 40),
    ("ring-02", 4, 5, "lagoon", 110),
    ("ring-03", 2, 3, "violet", 200),
    ("ring-04", 3, 2, "acid", 300),
    ("ring-05", 16, 9, "peach", 60),
    ("ring-06", 3, 1, "night", 150),
    ("ring-07", 9, 16, "rose", 250),
    ("ring-08", 5, 4, "citrus", 330),
    ("ring-09", 1, 1, "ocean", 20),
]
CENTRE = ("ring-centre", 1, 1, "magenta", 135)


def rgb(hex_: str) -> tuple[int, int, int]:
    h = hex_.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(w: int, h: int, stops: list[str], angle: float) -> Image.Image:
    """A linear gradient through the stops, plus a soft light off one corner
    so it reads as a lit surface rather than a flat swatch."""
    cols = [rgb(s) for s in stops]
    rad = math.radians(angle)
    dx, dy = math.cos(rad), math.sin(rad)
    # project every corner to find the gradient's span along its direction
    proj = [x * dx + y * dy for x in (0, w) for y in (0, h)]
    lo, hi = min(proj), max(proj)
    img = Image.new("RGB", (w, h))
    px = img.load()
    gx, gy = w * 0.28, h * 0.22        # the light
    reach = math.hypot(w, h) * 0.55
    for y in range(h):
        for x in range(w):
            t = ((x * dx + y * dy) - lo) / (hi - lo)
            seg = t * (len(cols) - 1)
            i = min(int(seg), len(cols) - 2)
            c = lerp(cols[i], cols[i + 1], seg - i)
            glow = max(0.0, 1 - math.hypot(x - gx, y - gy) / reach) ** 2 * 0.35
            px[x, y] = lerp(c, (255, 255, 255), glow)
    return img


def make(name: str, rw: int, rh: int, palette: str, angle: float, long_edge: int) -> None:
    if rw >= rh:
        w, h = long_edge, round(long_edge * rh / rw)
    else:
        w, h = round(long_edge * rw / rh), long_edge
    # drawn small and scaled up: smooth gradients lose nothing, and the
    # per-pixel loop stays quick
    small = gradient(max(2, w // 4), max(2, h // 4), PALETTES[palette], angle)
    img = small.resize((w, h), Image.BICUBIC)
    path = OUT / f"{name}.webp"
    img.save(path, "WEBP", quality=82, method=6)
    print(f"  {path.relative_to(ROOT)}  {w}x{h}  {path.stat().st_size:,} bytes")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for spec in GALLERY:
        make(*spec, long_edge=1000)
    for spec in RING:
        make(*spec, long_edge=640)
    make(*CENTRE, long_edge=800)


if __name__ == "__main__":
    main()

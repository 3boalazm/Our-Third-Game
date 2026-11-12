"""Generates the app icons (PNG) with plain Python, no extra packages.

Run:  python scripts/make-icons.py
Writes public/icons/icon-192.png, icon-512.png, icon-maskable-512.png and
apple-touch-icon.png: a blue kart racing along a road.
"""
import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
os.makedirs(OUT, exist_ok=True)


def png(path, size, pixels):
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        raw.extend(pixels[y * size * 4:(y + 1) * size * 4])

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        f.write(chunk(b"IEND", b""))


def box(px, py, cx, cy, hw, hh, r):
    """Signed distance to a rounded box (negative inside)."""
    dx = abs(px - cx) - hw + r
    dy = abs(py - cy) - hh + r
    ox = max(dx, 0.0)
    oy = max(dy, 0.0)
    return math.hypot(ox, oy) + min(max(dx, dy), 0.0) - r


def rot(px, py, cx, cy, angle):
    c, s = math.cos(-angle), math.sin(-angle)
    x, y = px - cx, py - cy
    return cx + x * c - y * s, cy + x * s + y * c


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def over(base, color, cover):
    """Paint `color` over `base` with 0..1 coverage."""
    if cover <= 0:
        return base
    cover = min(1.0, cover)
    return tuple(base[i] + (color[i] - base[i]) * cover for i in range(3))


def edge(d, soft):
    """Coverage from a signed distance with a soft edge of width `soft`."""
    return max(0.0, min(1.0, 0.5 - d / soft))


ANGLE = math.radians(-32)  # the kart and the road both run up to the right


def scene(x, y, soft):
    # background: deep blue gradient with grass-green corners
    col = mix((38, 46, 82), (16, 22, 40), y)
    glow = max(0.0, 1.0 - math.hypot(x - 0.5, y - 0.5) * 1.6)
    col = mix(col, (60, 74, 130), glow * 0.45)

    # the road: a wide diagonal band
    rx, ry = rot(x, y, 0.5, 0.5, ANGLE)
    band = abs(ry - 0.5) - 0.2
    col = over(col, (236, 236, 240), edge(band, soft))            # white kerb
    col = over(col, (70, 76, 96), edge(band + 0.028, soft))       # asphalt
    dash = (rx * 9.0) % 1.0 < 0.55
    if dash:
        col = over(col, (150, 156, 176), edge(abs(ry - 0.5) - 0.012, soft))

    # nitro flame behind the kart
    fx, fy = rot(x, y, 0.5, 0.5, ANGLE)
    t = (0.5 - fx) / 0.26  # 0 at the kart's tail, 1 at the flame tip
    if 0.0 <= t <= 1.0:
        half = 0.06 * (1.0 - t)
        d = abs(fy - 0.5) - half
        flame = mix((255, 215, 110), (255, 110, 40), t)
        col = over(col, flame, edge(d, soft) * (1.0 - 0.15 * t))

    # shadow
    sx, sy = rot(x - 0.012, y - 0.016, 0.5, 0.5, ANGLE)
    col = over(col, (10, 12, 22), edge(box(sx, sy, 0.5, 0.5, 0.19, 0.105, 0.045), soft * 2) * 0.35)

    # wheels
    for wx, wy in ((0.4, 0.385), (0.575, 0.385), (0.4, 0.615), (0.575, 0.615)):
        kx, ky = rot(x, y, 0.5, 0.5, ANGLE)
        col = over(col, (18, 20, 28), edge(box(kx, ky, wx, wy, 0.045, 0.026, 0.01), soft))

    # body with a white outline
    kx, ky = rot(x, y, 0.5, 0.5, ANGLE)
    d = box(kx, ky, 0.5, 0.5, 0.185, 0.1, 0.045)
    col = over(col, (255, 255, 255), edge(d, soft))
    col = over(col, (79, 107, 255), edge(d + 0.014, soft))
    # nose stripe and cockpit
    col = over(col, (255, 255, 255), edge(box(kx, ky, 0.63, 0.5, 0.045, 0.02, 0.01), soft))
    col = over(col, (22, 26, 40), edge(box(kx, ky, 0.5, 0.5, 0.062, 0.06, 0.02), soft))
    return col


def render(size, scale=1.0, rounded=False, samples=3):
    pixels = bytearray(size * size * 4)
    soft = 1.4 / size
    sub = [(i + 0.5) / samples for i in range(samples)]
    for py in range(size):
        for px in range(size):
            r = g = b = a = 0.0
            for sy in sub:
                for sx in sub:
                    x = (px + sx) / size
                    y = (py + sy) / size
                    cover = 1.0
                    if rounded:
                        cover = edge(box(x, y, 0.5, 0.5, 0.5, 0.5, 0.19), soft)
                        if cover <= 0:
                            continue
                    # zoom out around the centre (keeps the art inside the maskable safe zone)
                    sxn = 0.5 + (x - 0.5) / scale
                    syn = 0.5 + (y - 0.5) / scale
                    c = scene(sxn, syn, soft / scale)
                    r += c[0] * cover
                    g += c[1] * cover
                    b += c[2] * cover
                    a += cover
            n = samples * samples
            i = (py * size + px) * 4
            if a > 0:
                pixels[i] = int(r / a)
                pixels[i + 1] = int(g / a)
                pixels[i + 2] = int(b / a)
                pixels[i + 3] = int(255 * a / n)
    return pixels


jobs = [
    ("icon-512.png", 512, 1.0, True),
    ("icon-192.png", 192, 1.0, True),
    ("icon-maskable-512.png", 512, 0.74, False),  # full bleed, art inside the safe zone
    ("apple-touch-icon.png", 180, 0.9, False),
]
for name, size, scale, rounded in jobs:
    png(os.path.join(OUT, name), size, render(size, scale, rounded, 3 if size > 200 else 4))
    print("wrote", name)

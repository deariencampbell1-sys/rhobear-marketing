"""Generate public/favicon.ico — a 32x32 ICO wrapping a PNG, drawn from the
same original rhobear monogram as favicon.svg. No third-party art: the shapes
are computed here (rounded square + R monogram on a 32x32 grid).

Run: python scripts/make-favicon.py
"""
import struct
import zlib
from pathlib import Path

SIZE = 32
BG = (0x10, 0x14, 0x18, 255)      # #101418
FG = (0xF4, 0xF1, 0xEA, 255)      # #f4f1ea


def rounded_square_alpha(x: int, y: int) -> bool:
    """True inside a rounded square with corner radius 7 on a 32x32 grid."""
    r = 7
    in_x = 0 <= x < SIZE
    in_y = 0 <= y < SIZE
    if not (in_x and in_y):
        return False
    cx = min(max(x, r), SIZE - 1 - r)
    cy = min(max(y, r), SIZE - 1 - r)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= r * r


def monogram(x: int, y: int) -> bool:
    """The R monogram: a stem, a bowl and a leg, on the 32x32 grid."""
    # stem
    if 9 <= x <= 12 and 7 <= y <= 25:
        return True
    # bowl (upper right half ring)
    if 12 <= x <= 20 and 7 <= y <= 18:
        # outer radius 8, inner radius 3, ring centred at (12, 11)
        dx, dy = x - 12, y - 11
        d2 = dx * dx + dy * dy
        if dx >= 0 and 9 <= d2 <= 64:
            return True
    # leg
    if 13 <= x <= 19 and 12 <= y <= 25:
        # diagonal from (13,12) down to (19,25)
        t = (y - 12) / 13.0
        leg_x = 13 + t * 6
        if abs(x - leg_x) <= 2.2:
            return True
    return False


def pixel(x: int, y: int):
    if not rounded_square_alpha(x, y):
        return (0, 0, 0, 0)
    if monogram(x, y):
        return FG
    return BG


def png_bytes() -> bytes:
    raw = bytearray()
    for y in range(SIZE):
        raw.append(0)  # filter type 0
        for x in range(SIZE):
            raw.extend(pixel(x, y))

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0)  # 8-bit RGBA
    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', header)
        + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        + chunk(b'IEND', b'')
    )


def ico_bytes() -> bytes:
    png = png_bytes()
    header = struct.pack('<HHH', 0, 1, 1)
    entry = struct.pack(
        '<BBBBHHII',
        SIZE if SIZE < 256 else 0,
        SIZE if SIZE < 256 else 0,
        0, 0, 1, 32,
        len(png),
        6 + 16,
    )
    return header + entry + png


if __name__ == '__main__':
    out = Path(__file__).resolve().parent.parent / 'public' / 'favicon.ico'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(ico_bytes())
    print(f'wrote {out} ({out.stat().st_size} bytes)')

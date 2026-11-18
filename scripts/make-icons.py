"""Generate Glovebox Goods PWA icons (brand: dark #1d232b, orange #e8590c, white pickup glyph)."""
from PIL import Image, ImageDraw
import os
DARK, ORANGE, WHITE = (29, 35, 43, 255), (232, 89, 12, 255), (255, 255, 255, 255)
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')

def truck(d, cx, cy, s, color, wheel_hole):
    # Pickup truck silhouette centered at (cx, cy), width ~ s
    u = s / 100.0
    X = lambda v: cx + (v - 50) * u
    Y = lambda v: cy + (v - 50) * u
    # bed + body
    d.rounded_rectangle([X(4), Y(44), X(96), Y(68)], radius=5 * u, fill=color)
    # cab
    d.polygon([(X(46), Y(44)), (X(52), Y(24)), (X(74), Y(24)), (X(86), Y(44))], fill=color)
    d.rounded_rectangle([X(50), Y(22), X(76), Y(30)], radius=3 * u, fill=color)
    # window
    d.polygon([(X(55), Y(42)), (X(58), Y(29)), (X(72), Y(29)), (X(80), Y(42))], fill=wheel_hole)
    # wheels
    for wx in (24, 76):
        r = 12 * u
        d.ellipse([X(wx) - r, Y(68) - r, X(wx) + r, Y(68) + r], fill=wheel_hole)
        r2 = 8.5 * u
        d.ellipse([X(wx) - r2, Y(68) - r2, X(wx) + r2, Y(68) + r2], fill=color)
        r3 = 3.5 * u
        d.ellipse([X(wx) - r3, Y(68) - r3, X(wx) + r3, Y(68) + r3], fill=wheel_hole)

def standard(size=1024):
    # "any" purpose: dark rounded background, orange tile, white truck
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=size * 0.22, fill=DARK)
    m = size * 0.14
    d.rounded_rectangle([m, m, size - m, size - m], radius=size * 0.16, fill=ORANGE)
    truck(d, size / 2, size / 2 + size * 0.02, size * 0.62, WHITE, ORANGE)
    return im

def maskable(size=1024):
    # full-bleed, glyph inside the 80% safe zone
    im = Image.new('RGBA', (size, size), ORANGE)
    d = ImageDraw.Draw(im)
    truck(d, size / 2, size / 2 + size * 0.02, size * 0.6, WHITE, ORANGE)
    return im

def apple(size=1024):
    # iOS rounds corners itself and dislikes transparency: full-bleed dark with orange tile
    im = Image.new('RGBA', (size, size), DARK)
    d = ImageDraw.Draw(im)
    m = size * 0.12
    d.rounded_rectangle([m, m, size - m, size - m], radius=size * 0.18, fill=ORANGE)
    truck(d, size / 2, size / 2 + size * 0.02, size * 0.6, WHITE, ORANGE)
    return im.convert('RGB')

def save(im, name, px):
    im.resize((px, px), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)

s, mk, ap = standard(), maskable(), apple()
save(s, 'icon-192.png', 192); save(s, 'icon-512.png', 512)
save(mk, 'icon-maskable-512.png', 512); save(mk, 'icon-maskable-192.png', 192)
save(ap, 'apple-touch-icon.png', 180)
save(s, 'favicon-32.png', 32)
print('icons written to', os.path.abspath(OUT))

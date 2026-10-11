"""Generate FunPro's original icon (rounded square, violet→teal gradient, stylised 'F' + spark).
Run: python3 scripts/generate-icons.py  (requires Pillow). Output: public/icon/{16,32,48,96,128}.png
"""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icon')
os.makedirs(OUT, exist_ok=True)

def render(size: int) -> Image.Image:
    s = 512
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    grad = Image.new('RGBA', (s, s))
    top, bottom = (109, 74, 255), (14, 159, 143)
    px = grad.load()
    for y in range(s):
        for x in range(s):
            t = (x + y) / (2 * s)
            px[x, y] = tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(3)) + (255,)
    mask = Image.new('L', (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([16, 16, s - 16, s - 16], radius=120, fill=255)
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    white = (255, 255, 255, 255)
    # Stylised "F"
    d.rounded_rectangle([140, 120, 210, 392], radius=24, fill=white)
    d.rounded_rectangle([140, 120, 372, 184], radius=24, fill=white)
    d.rounded_rectangle([140, 232, 320, 292], radius=24, fill=white)
    # Spark (productivity)
    cx, cy, r = 372, 348, 46
    d.polygon([(cx, cy - r), (cx + 14, cy - 14), (cx + r, cy), (cx + 14, cy + 14), (cx, cy + r), (cx - 14, cy + 14), (cx - r, cy), (cx - 14, cy - 14)], fill=white)
    return img.resize((size, size), Image.LANCZOS)

for size in (16, 32, 48, 96, 128):
    render(size).save(os.path.join(OUT, f'{size}.png'))
print('icons written to', os.path.abspath(OUT))

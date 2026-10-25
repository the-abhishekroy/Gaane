"""Generates the DMG window background (build/dmg-background.png and @2x). Run: python3 build/make-dmg-background.py"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import math, os

W, H = 1320, 740   # drawn at 2x; window is 660x370
here = os.path.dirname(os.path.abspath(__file__))

def font(path, size, index=0):
    try: return ImageFont.truetype(path, size, index=index)
    except Exception: return ImageFont.load_default()

BOLD = '/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf'
REG = '/System/Library/Fonts/Supplemental/Arial.ttf'

img = Image.new('RGB', (W, H), (8, 8, 12))
px = img.load()
for y in range(H):
    t = y / H
    for x in range(W):
        px[x, y] = (int(8 + 12 * t), int(8 + 5 * t), int(12 + 22 * t))

def glow(cx, cy, r, color, strength):
    layer = Image.new('RGB', (W, H), (0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=tuple(int(c * strength) for c in color))
    layer = layer.filter(ImageFilter.GaussianBlur(r * 0.55))
    return layer

from PIL import ImageChops
for cx, cy, r, col, s in [(180, 760, 360, (255, 45, 120), 0.55), (1180, 80, 340, (90, 70, 255), 0.5), (1100, 760, 260, (255, 140, 60), 0.28)]:
    img = ImageChops.add(img, glow(cx, cy, r, col, s))

# running neon arc around the window edge, like the in-app ambient light
arc = Image.new('RGBA', (W, H), (0, 0, 0, 0))
mask = Image.new('L', (W, H), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle((6, 6, W - 7, H - 7), radius=36, outline=255, width=6)
grad = Image.new('RGB', (W, H))
gp = grad.load()
for y in range(H):
    for x in range(W):
        ang = (math.degrees(math.atan2(y - H / 2, x - W / 2)) + 360) % 360
        t = max(0.0, 1 - abs(((ang - 200) + 180) % 360 - 180) / 95)
        gp[x, y] = (int(255 * t), int(60 * t + 40 * t * t), int(130 * t + 120 * (1 - t) * t))
rim = Image.composite(grad, Image.new('RGB', (W, H), (0, 0, 0)), mask)
img = ImageChops.add(img, rim.filter(ImageFilter.GaussianBlur(10)))
img = ImageChops.add(img, rim)

# glass cards behind the two icons (Finder always draws dark labels, so give them a light surface)
cards = Image.new('RGBA', (W, H), (0, 0, 0, 0))
cd = ImageDraw.Draw(cards)
for cx in (340, 980):
    cd.rounded_rectangle((cx - 120, 244, cx + 120, 468), radius=36, fill=(236, 236, 246, 232))
img = Image.alpha_composite(img.convert('RGBA'), cards).convert('RGB')

d = ImageDraw.Draw(img)
d.text((W / 2, 92), 'Gaane', font=font(BOLD, 112), fill=(255, 255, 255), anchor='mm')
d.text((W / 2, 170), 'music, the way you like it', font=font(REG, 32), fill=(200, 200, 220), anchor='mm')

# arrow between the app icon and Applications
ax0, ax1, ay = 540, 780, 336
for i in range(ax0, ax1 - 30, 36):
    d.rounded_rectangle((i, ay - 4, i + 20, ay + 4), radius=4, fill=(255, 255, 255))
d.polygon([(ax1 - 34, ay - 24), (ax1 + 8, ay), (ax1 - 34, ay + 24)], fill=(255, 255, 255))
d.text((W / 2, ay + 66), 'Drag Gaane into Applications', font=font(REG, 28), fill=(225, 225, 240), anchor='mm')

# footer: Made with <heart> by Abhishek Roy
f = font(BOLD, 30)
left, right = 'Made with', 'by Abhishek Roy'
lw = d.textlength(left, font=f); rw = d.textlength(right, font=f)
hw = 34
total = lw + 14 + hw + 14 + rw
x0 = W / 2 - total / 2
fy = 556
d.text((x0, fy), left, font=f, fill=(255, 255, 255), anchor='lm')
hx, hy = x0 + lw + 14 + hw / 2, fy
pts = []
for i in range(0, 360, 4):
    t = math.radians(i)
    px_ = 16 * math.sin(t) ** 3
    py_ = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
    pts.append((hx + px_ * 1.2, hy - py_ * 1.2 - 2))
d.polygon(pts, fill=(255, 70, 110))
d.text((x0 + lw + 14 + hw + 14, fy), right, font=f, fill=(255, 255, 255), anchor='lm')

img.save(os.path.join(here, 'dmg-background@2x.png'))
img.resize((W // 2, H // 2), Image.LANCZOS).save(os.path.join(here, 'dmg-background.png'))
print('ok')

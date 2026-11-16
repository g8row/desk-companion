# Renders the "Ridge" boot screens for the TB-7304X desk tablet.
#   out/logo.png              1024x600 desk view, used for logo images 0 and 39
#   out/anim/desc.txt, part0/ (intro, plays once), part1/ (8 s seamless loop)  frames already rotated to the panel
#   out/preview-*.png         landscape contact sheets for checking
# Ridge maths: pocketjs/apps/desk/ridges.tsx, with wave speeds snapped to whole cycles per LOOP seconds.
# usage: uv run --no-project --with pillow --with fonttools --with brotli python -I render.py <repo-root>
import io, math, os, sys
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont

ROOT = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
W, H, FPS, INTRO, LOOP = 1024, 600, 30, 2.6, 8.0
BG, FG, MUTE, DOT, RIDGE, ACCENT = (0, 0, 0), (237, 237, 237), (138, 138, 138), (46, 46, 46), (143, 143, 143), (168, 199, 250)
TAU = 2 * math.pi
SPEED = [TAU * 1 / LOOP, -TAU * 2 / LOOP, TAU * 3 / LOOP]
K = [5.2, 11.7, 23.0]

def font_file(name):
    bundled = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fonts', name + '.ttf')
    if os.path.exists(bundled): return bundled
    dst = os.path.join(OUT, name + '.ttf')
    if not os.path.exists(dst):
        f = TTFont(os.path.join(ROOT, '.site-preview/assets/fonts', name + '.woff2')); f.flavor = None; f.save(dst)
    return dst

def mono(size, weight=400):
    f = ImageFont.truetype(font_file('geist-mono-latin'), size)
    f.set_variation_by_axes([weight]); return f

def field(C, R, t, rise=1.0, L=14):
    ch = [[' '] * C for _ in range(R)]; hot = [[False] * C for _ in range(R)]
    if rise > 0.02:
        for y in range(1, R, 4):
            for x in range(2, C, 6): ch[y][x] = '.'
    top = [R] * C
    us = [(x / (C - 1)) * 2 - 1 for x in range(C)]
    env = [math.exp(-u * u * 2.6) for u in us]
    for i in range(L - 1, -1, -1):
        depth = i / (L - 1)
        r = min(1, max(0, (rise - depth * 0.55) / 0.45))
        if r <= 0: continue
        er = 1 - (1 - r) ** 3
        base = R * 0.42 + i * (R * 0.04) + (1 - er) * R * 0.7
        amp = R * (0.16 + depth * 0.28) * er
        p = [t * SPEED[0] + i * 0.45, t * SPEED[1] + i * 0.8, t * SPEED[2] + i * 1.7]
        ok = [e > 0.14 for e in env]
        hs = [env[x] * (0.55 * math.sin(us[x] * K[0] + p[0]) + 0.3 * math.sin(us[x] * K[1] + p[1]) + 0.15 * math.sin(us[x] * K[2] + p[2])) for x in range(C)]
        ys = [round(base - max(h, -0.2) * amp) for h in hs]
        nxt = top[:]
        for x in range(C):
            if not ok[x]: continue
            y = ys[x]
            if y < 0 or y >= R or y >= top[x]: continue
            prev = ys[x - 1] if x > 0 and ok[x - 1] else y
            after = ys[x + 1] if x < C - 1 else y
            dy = after - prev
            c = '/' if dy <= -2 else '\\' if dy >= 2 else '.' if depth < 0.45 else '-'
            ch[y][x] = c; hot[y][x] = hs[x] > 0.42 and depth > 0.3
            for yy in range(y + 1, min(top[x], R)):
                if ch[yy][x] == '.': ch[yy][x] = ' '
            nxt[x] = y
        top = [min(a, b) for a, b in zip(top, nxt)]
    return ch, hot

_glyphs = {}
def glyph(c, color, size):
    key = (c, color, size)
    if key not in _glyphs:
        f = mono(size); box = size * 2
        m = Image.new('L', (box, box), 0); ImageDraw.Draw(m).text((box / 2, box / 2), c, font=f, fill=255, anchor='mm')
        _glyphs[key] = (Image.new('RGB', (box, box), color), m, box)
    return _glyphs[key]

def draw_field(img, x0, y0, w, h, C, R, t, rise=1.0):
    ch, hot = field(C, R, t, rise)
    cw, chh = w / C, h / R; size = max(6, round(chh * 0.92))
    for y in range(R):
        for x in range(C):
            c = ch[y][x]
            if c == ' ': continue
            color = ACCENT if hot[y][x] else DOT if c == '.' else RIDGE
            tile, mask, box = glyph(c, color, size)
            img.paste(tile, (round(x0 + (x + 0.5) * cw - box / 2), round(y0 + (y + 0.5) * chh - box / 2)), mask)

def logo():
    img = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(img)
    d.text((W / 2, 268), 'desk', font=mono(64, 500), fill=FG, anchor='ms')
    draw_field(img, W / 2 - 220, 290, 440, 150, 58, 15, 0.9)
    return img

def frame(t, rise):
    img = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(img)
    draw_field(img, 0, 110, W, 450, 104, 26, t, rise)
    f = mono(16)
    d.text((40, 58), 'desk companion', font=f, fill=MUTE, anchor='ls')
    d.text((W - 40, 58), 'android · pocketjs', font=f, fill=MUTE, anchor='rs')
    dots = '.' * (1 + int(t * 18 / LOOP) % 3)                    # 6 whole cycles per loop
    d.text((40, H - 32), 'starting' + dots, font=mono(14), fill=MUTE, anchor='ls')
    return img

def to_panel(img):
    return img.transpose(Image.Transpose.ROTATE_270)            # same mapping as logo_pack.py (checked there)

def sheet(frames, path, cols=4):
    th = [f.resize((256, 150)) for f in frames]
    rows = math.ceil(len(th) / cols); s = Image.new('RGB', (cols * 262, rows * 156), (40, 40, 40))
    for i, f in enumerate(th): s.paste(f, ((i % cols) * 262 + 3, (i // cols) * 156 + 3))
    s.save(path)

if __name__ == '__main__':
    os.makedirs(os.path.join(OUT, 'anim', 'part0'), exist_ok=True); os.makedirs(os.path.join(OUT, 'anim', 'part1'), exist_ok=True)
    lg = logo(); lg.save(os.path.join(OUT, 'logo.png'))
    n0, n1 = round(INTRO * FPS), round(LOOP * FPS)
    keep = []
    for k in range(n0):
        t = k / FPS; f = frame(t, min(1, t / INTRO))
        to_panel(f).save(os.path.join(OUT, 'anim', 'part0', '%05d.png' % k), optimize=True)
        if k % 13 == 0: keep.append(f)
    for k in range(n1):
        t = INTRO + k / FPS; f = frame(t, 1)
        to_panel(f).save(os.path.join(OUT, 'anim', 'part1', '%05d.png' % k), optimize=True)
        if k % 60 == 0: keep.append(f)
    # seam check: the frame after the last loop frame must equal the first loop frame
    a = frame(INTRO, 1).tobytes(); b = frame(INTRO + LOOP, 1).tobytes()
    print('loop seamless:', a == b)
    with open(os.path.join(OUT, 'anim', 'desc.txt'), 'w') as fh:
        fh.write('600 1024 %d\np 1 0 part0\np 0 0 part1\n' % FPS)
    sheet([lg] + keep, os.path.join(OUT, 'preview.png'))
    print('frames:', n0, '+', n1)

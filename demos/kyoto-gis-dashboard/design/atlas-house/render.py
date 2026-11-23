# Renders the sample: an animated GIF of the whole interaction and a storyboard PNG.
#   python render.py <out folder>
import math, sys
from PIL import Image, ImageDraw, ImageFont
from draw import girl, house

S = 2                      # screen pixels per art pixel
W, Hh = 300, 200           # low-res scene
U = 2                      # the house is drawn twice as large as the first draft, so the girl fits its door
FONT = 'C:/Windows/Fonts/YuGothB.ttc'          # English and Japanese
FONT_ZH = 'C:/Windows/Fonts/msyhbd.ttc'        # captions in simplified Chinese
f_ui = ImageFont.truetype(FONT, 15)
f_small = ImageFont.truetype(FONT, 12)
f_cap = ImageFont.truetype(FONT_ZH, 16)
f_knock = ImageFont.truetype(FONT, 22)

HOUSE_AT = (8, 64)         # where the house stands (bottom-left of the page)
DOOR_X = HOUSE_AT[0] + 36 * U          # the middle of the doorway
STEP_Y = HOUSE_AT[1] + 57 * U          # the stone step
STAND = (DOOR_X - 20, STEP_Y - 56)     # the girl (40 x 58) standing on the step

def backdrop():
    """a light page with a faint map, so the house reads as sitting at the bottom-left of the dashboard"""
    im = Image.new('RGBA', (W, Hh), (244, 239, 230, 255))
    d = ImageDraw.Draw(im)
    for y in range(0, Hh, 22):
        d.line([(0, y), (W, y + 10)], fill=(233, 225, 211, 255))
    for x in range(0, W, 31):
        d.line([(x, 0), (x + 18, Hh)], fill=(235, 228, 215, 255))
    d.line([(70, 0), (190, 120), (300, 136)], fill=(214, 200, 176, 255), width=3)
    d.ellipse((196, 38, 210, 52), fill=(180, 84, 58, 140))
    return im

def up(im):
    return im.resize((im.width * S, im.height * S), Image.NEAREST)

def cursor(d, x, y, kind='arrow'):
    if kind == 'arrow':
        pts = [(0, 0), (0, 22), (6, 17), (10, 26), (14, 24), (10, 15), (17, 15)]
    else:   # an open hand (grab / stroke)
        pts = [(4, 10), (4, 2), (7, 2), (7, 9), (8, 0), (11, 0), (11, 9), (12, 1), (15, 1), (15, 10), (16, 4), (19, 4), (19, 16), (15, 24), (7, 24), (2, 16), (0, 12), (3, 10)]
    d.polygon([(x + a, y + b) for a, b in pts], fill=(255, 255, 255), outline=(30, 30, 30))

def bubble(d, x, y, text):
    w = d.textlength(text, font=f_ui) + 26
    d.rounded_rectangle((x, y, x + w, y + 36), 12, fill=(255, 255, 255), outline=(207, 53, 70), width=2)
    d.polygon([(x + 14, y + 35), (x + 24, y + 35), (x + 4, y + 50)], fill=(255, 255, 255))
    d.line([(x + 14, y + 35), (x + 4, y + 50), (x + 24, y + 35)], fill=(207, 53, 70), width=2)
    d.text((x + 13, y + 8), text, font=f_ui, fill=(47, 41, 36))

def chat(d, t):
    """the chat panel sliding in beside the girl (t 0..1)"""
    x0 = int(640 - 340 * t)
    d.rounded_rectangle((x0, 24, x0 + 280, 330), 16, fill=(251, 247, 239, 240), outline=(214, 200, 176), width=1)
    d.rounded_rectangle((x0 + 14, 38, x0 + 42, 66), 14, fill=(255, 122, 69))
    d.text((x0 + 21, 41), '問', font=f_ui, fill=(255, 255, 255))
    d.text((x0 + 52, 38), 'Atlas assistant', font=f_ui, fill=(42, 36, 32))
    d.text((x0 + 52, 58), 'Gemini · standard', font=f_small, fill=(133, 120, 107))
    for i, s in enumerate(['Walking routes from Kiyomizu-dera', 'Add Fushimi Inari to Day 1', 'What will the weather be in Uji?']):
        d.rounded_rectangle((x0 + 16, 88 + i * 36, x0 + 264, 116 + i * 36), 10, fill=(255, 253, 248), outline=(226, 216, 198))
        d.text((x0 + 26, 94 + i * 36), s, font=f_small, fill=(70, 62, 55))
    d.rounded_rectangle((x0 + 14, 274, x0 + 266, 312), 14, fill=(255, 255, 255), outline=(214, 200, 176))
    d.text((x0 + 28, 285), 'Ask about Kyoto…', font=f_small, fill=(160, 150, 140))

def caption(d, text):
    d.rectangle((0, Hh * S - 34, W * S, Hh * S), fill=(36, 31, 46, 235))
    d.text((14, Hh * S - 29), text, font=f_cap, fill=(255, 244, 230))

frames, durs, caps = [], [], []
def frame(scene, overlay=None, cap='', ms=90):
    im = up(scene)
    d = ImageDraw.Draw(im, 'RGBA')
    if overlay:
        overlay(d)
    if cap:
        caption(d, cap)
    frames.append(im.convert('RGB')); durs.append(ms); caps.append(cap)

def scene(door=0.0, shake=0, glow=0.0, g=None, gpos=None, extra=None):
    bg = backdrop()
    bg.alpha_composite(house(door, shake, glow, U), HOUSE_AT)
    if g is not None:
        bg.alpha_composite(g, gpos)
    if extra:
        extra(bg)
    return bg

sx = lambda x: x * S        # art to screen
C1 = '1  小屋固定在页面左下角；鼠标移上去会提示 “Double-click to knock”'
for i in range(10):
    frame(scene(glow=i % 4 < 2), lambda d: (cursor(d, sx(DOOR_X + 30), sx(STEP_Y - 40)), d.text((sx(DOOR_X - 40), sx(HOUSE_AT[1] - 16)), 'Double-click to knock', font=f_small, fill=(120, 100, 85))), C1)
for i in range(6):
    def ov(d, i=i):
        x, y = sx(DOOR_X), sx(STEP_Y - 30)
        cursor(d, x, y)
        r = 8 + i * 6
        d.ellipse((x - r, y - r, x + r, y + r), outline=(207, 53, 70, max(0, 220 - i * 36)), width=3)
    frame(scene(), ov, '2  双击小屋', 70)
for i in range(12):
    sh = [1, -1, 1, 0, 0, 0][i % 6]
    def ov(d, i=i):
        if i % 6 < 3:
            d.text((sx(DOOR_X + 26 + (i // 6) * 24), sx(STEP_Y - 58) - (i % 6) * 5), 'コン', font=f_knock, fill=(140, 70, 40))
    frame(scene(shake=sh), ov, '3  敲门：门抖两下，有「コンコン」的声音（跟网站的音量）', 80)
for i in range(8):
    frame(scene(door=(i + 1) / 8, glow=1), None, '4  拉门打开，屋里透出暖光', 80)
for i in range(6):
    frame(scene(door=1, glow=1, g=girl('idle'), gpos=(STAND[0], STAND[1] - (5 - i))), None, '5  穿和服的小人走出来', 80)
for i in range(8):
    frame(scene(door=1, glow=1, g=girl('bow' if 1 < i < 6 else 'idle'), gpos=STAND), None, '5  鞠躬', 110)
for i in range(10):
    frame(scene(door=1, glow=1, g=girl('wave_a' if i % 2 else 'wave_b'), gpos=STAND), lambda d: bubble(d, sx(STAND[0] + 44), sx(STAND[1] - 16), 'How can I help?'), '6  挥挥手：“How can I help?”', 140)
for i in range(8):
    t = (i + 1) / 8
    frame(scene(door=1, glow=1, g=girl('idle', blink=i == 5), gpos=STAND), lambda d, t=t: (bubble(d, sx(STAND[0] + 44), sx(STAND[1] - 16), 'How can I help?'), chat(d, 1 - (1 - t) ** 3)), '7  对话框在她旁边打开', 70)
for i in range(6):
    frame(scene(door=1, glow=1, g=girl('idle', blink=i == 3), gpos=STAND), lambda d: chat(d, 1), '7  对话框在她旁边打开', 120)
DX = 70
path = [(STAND[0] + int(DX * t), STAND[1] - int(40 * math.sin(math.pi * t) + 4 * t)) for t in [k / 11 for k in range(12)]]
for x, y in path:
    frame(scene(door=1, glow=1, g=girl('held'), gpos=(x, y)), lambda d, x=x, y=y: cursor(d, sx(x + 18), sx(y - 4), 'hand'), '8  可以用鼠标抓起来拖到别的地方（被提起来的样子，脚会晃）', 70)
DROP = (STAND[0] + DX, STAND[1] - 4)
for i, dy in enumerate([0, 3, 0, 1, 0, 0]):
    def dust(bg, i=i):
        dd = ImageDraw.Draw(bg)
        if i < 3:
            for k in (-1, 1):
                x = DROP[0] + 20 + k * (16 + i * 4)
                dd.ellipse((x - 3, DROP[1] + 54 - i, x + 3, DROP[1] + 58 - i), fill=(210, 198, 176, 220))
    frame(scene(door=1, glow=1, g=girl('idle'), gpos=(DROP[0], DROP[1] + dy), extra=dust), None, '8  放下来：小跳一下落地', 90)
for i in range(16):
    k = i % 8
    hxp = sx(DROP[0] + 10 + (k if k < 4 else 8 - k) * 4)
    def ov(d, i=i, hxp=hxp):
        cursor(d, hxp, sx(DROP[1] - 4), 'hand')
        for n in range(min(3, i // 3)):
            yy = sx(DROP[1] + 10) - (i - n * 3) * 9
            xx = sx(DROP[0] + 42 + n * 7)
            d.text((xx, yy), '♥', font=f_ui, fill=(255, 111, 146))
    frame(scene(door=1, glow=1, g=girl('happy'), gpos=DROP), ov, '9  摸摸头：开心、脸红、冒出爱心', 100)
for i in range(8):
    x = DROP[0] - int(DX * (i + 1) / 8)
    frame(scene(door=1, glow=1, g=girl('idle'), gpos=(x, DROP[1] + int(4 * (i + 1) / 8))), None, '10  关掉对话框后，她走回小屋', 90)
for i in range(8):
    frame(scene(door=1 - (i + 1) / 8, glow=1), None, '10  门关上', 80)
for i in range(6):
    frame(scene(glow=i % 4 < 2), None, C1, 120)

out = sys.argv[1]
frames[0].save(f'{out}/atlas-house-sample.gif', save_all=True, append_images=frames[1:], duration=durs, loop=0, optimize=True)
# storyboard: the first frame of each step's best moment
def first(prefix, offset=0):
    return frames[[i for i, c in enumerate(caps) if c.startswith(prefix)][0] + offset]
picks = [first('1 ', 4), first('3 ', 0), first('4 ', 7), first('6 ', 1), first('7 ', 9), first('8  可以', 6), first('9 ', 12), first('10  关', 3)]
sb = Image.new('RGB', (W * S * 2 + 30, (Hh * S + 10) * 4 + 10), (36, 31, 46))
for n, im in enumerate(picks):
    sb.paste(im, (10 + (n % 2) * (W * S + 10), 10 + (n // 2) * (Hh * S + 10)))
sb.save(f'{out}/atlas-house-storyboard.png')
print(len(frames), 'frames,', sum(durs) / 1000, 's')

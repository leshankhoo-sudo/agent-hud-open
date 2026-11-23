# The "Atlas house" sample: an original pixel character (a girl in a furisode kimono) and a small Japanese
# house, drawn with shapes on a low-resolution canvas and scaled up without smoothing (the same idea as the
# site's pixel tree). Each pose is a function that returns a small RGBA image.
from PIL import Image, ImageDraw

def hx(c, a=255):
    c = c.lstrip('#')
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4)) + (a,)

C = {k: hx(v) for k, v in {
    'hair': '#221c30', 'hair2': '#3b3252', 'hairhi': '#5d5380',
    'skin': '#f8dcc6', 'skin2': '#ecbfa3', 'blush': '#f3a2a8',
    'eye': '#26182a', 'iris': '#7a3d55', 'white': '#ffffff', 'mouth': '#c4515f',
    'kim': '#cf3546', 'kim2': '#a4243a', 'kim3': '#7d1a2c', 'saku': '#ffd5de', 'saku2': '#ff9fb6',
    'collar': '#f7f2e8', 'collar2': '#d8cfbf',
    'obi': '#e8b54a', 'obi2': '#b9852a', 'cord': '#2f8f8a', 'obiage': '#ff9fb6',
    'flower': '#ff6f92', 'flower2': '#ffe08a', 'gold': '#e8c15a',
    'tabi': '#f1ede4', 'geta': '#7a4e30',
}.items()}

def girl(pose='idle', blink=False):
    """40 x 58 sprite. pose: idle, bow, wave_a, wave_b, held, happy"""
    im = Image.new('RGBA', (40, 58), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    hy = 3 if pose == 'bow' else 0          # the head dips when bowing
    # --- body (drawn first, the head overlaps it) ---
    by = 33
    held = pose == 'held'
    # sleeves (furisode): long, rounded at the bottom
    if pose in ('wave_a', 'wave_b'):
        d.rounded_rectangle((5, by + 1, 13, by + 17), 3, fill=C['kim2'])
        # the raised arm: the sleeve hangs from the forearm
        hxp = 33 if pose == 'wave_a' else 31
        d.polygon([(26, by + 1), (30, by - 1), (hxp + 1, by - 13), (hxp - 3, by - 13), (27, by + 6)], fill=C['kim'])
        d.rounded_rectangle((hxp - 1, by - 8, hxp + 5, by + 6), 3, fill=C['kim2'])
    else:
        sw = 2 if held else 0
        d.rounded_rectangle((5 - sw, by + 1, 13 - sw, by + 17 + sw), 3, fill=C['kim2'])
        d.rounded_rectangle((27 + sw, by + 1, 35 + sw, by + 17 + sw), 3, fill=C['kim2'])
    # kimono body: shoulders to hem, a little narrower at the ankles
    d.polygon([(12, by), (28, by), (28, by + 7), (27, by + 19), (13, by + 19), (12, by + 7)], fill=C['kim'])
    d.rectangle((13, by + 16, 27, by + 19), fill=C['kim3'])          # hem band
    # collar: left over right
    d.line([(17, by), (20, by + 6)], fill=C['collar'], width=2)
    d.line([(23, by), (20, by + 6)], fill=C['collar2'], width=2)
    # obi with obiage and obijime
    d.rectangle((12, by + 6, 28, by + 11), fill=C['obi'])
    d.line([(12, by + 6), (28, by + 6)], fill=C['obiage'])
    d.line([(12, by + 9), (28, by + 9)], fill=C['cord'])
    d.line([(12, by + 11), (28, by + 11)], fill=C['obi2'])
    d.point((20, by + 9), fill=C['flower2'])
    # hands together in front of the obi (not when waving or held)
    if pose in ('idle', 'bow', 'happy'):
        d.ellipse((16, by + 10, 20, by + 13), fill=C['skin'])
        d.ellipse((20, by + 10, 24, by + 13), fill=C['skin'])
        d.point((20, by + 12), fill=C['skin2'])
    # sakura on the kimono and sleeves
    for x, y in [(15, by + 3), (25, by + 14), (16, by + 15), (8, by + 6), (10, by + 13), (31, by + 5), (30, by + 13), (22, by + 2)]:
        if pose in ('wave_a', 'wave_b') and x > 26:
            continue
        d.point([(x, y), (x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)], fill=C['saku'])
        d.point((x, y), fill=C['saku2'])
    # feet: tabi and geta (dangling apart when held)
    if held:
        d.rectangle((14, by + 20, 17, by + 22), fill=C['tabi']); d.rectangle((23, by + 21, 26, by + 23), fill=C['tabi'])
        d.rectangle((14, by + 23, 17, by + 23), fill=C['geta']); d.rectangle((23, by + 24, 26, by + 24), fill=C['geta'])
    else:
        d.rectangle((15, by + 20, 18, by + 21), fill=C['tabi']); d.rectangle((22, by + 20, 25, by + 21), fill=C['tabi'])
        d.rectangle((14, by + 22, 19, by + 23), fill=C['geta']); d.rectangle((21, by + 22, 26, by + 23), fill=C['geta'])
    # --- head ---
    d.rectangle((18, 29 + hy, 22, 33), fill=C['skin2'])                 # neck
    d.ellipse((8, 4 + hy, 32, 30 + hy), fill=C['hair'])                 # hair behind
    d.ellipse((14, -1 + hy, 26, 9 + hy), fill=C['hair'])                # bun
    d.arc((15, 0 + hy, 25, 8 + hy), 200, 300, fill=C['hairhi'])
    d.ellipse((11, 10 + hy, 29, 31 + hy), fill=C['skin'])               # face
    # straight-cut fringe and side locks (hime cut)
    d.chord((10, 5 + hy, 30, 27 + hy), 180, 360, fill=C['hair'])
    d.rectangle((11, 14 + hy, 29, 16 + hy), fill=C['hair'])
    for x in (13, 17, 21, 25):
        d.point((x, 17 + hy), fill=C['hair'])
    d.rectangle((8, 16 + hy, 11, 33 + hy), fill=C['hair'])
    d.rectangle((29, 16 + hy, 32, 33 + hy), fill=C['hair'])
    d.line([(12, 8 + hy), (17, 6 + hy)], fill=C['hair2'])
    d.line([(18, 7 + hy), (24, 6 + hy)], fill=C['hairhi'])
    # kanzashi: a flower with hanging gold strands
    d.ellipse((24, 1 + hy, 30, 7 + hy), fill=C['flower'])
    d.point((27, 4 + hy), fill=C['flower2'])
    for i, x in enumerate((26, 28, 30)):
        d.line([(x, 7 + hy), (x, 10 + hy + i)], fill=C['gold'])
    # face
    ey = 20 + hy
    if pose == 'bow' or blink:
        d.line([(14, ey + 2), (17, ey + 2)], fill=C['eye']); d.line([(23, ey + 2), (26, ey + 2)], fill=C['eye'])
    elif pose == 'happy':
        d.arc((13, ey, 18, ey + 5), 200, 340, fill=C['eye']); d.arc((22, ey, 27, ey + 5), 200, 340, fill=C['eye'])
    elif held:
        d.rectangle((15, ey + 1, 17, ey + 3), fill=C['eye']); d.rectangle((23, ey + 1, 25, ey + 3), fill=C['eye'])
        d.point((15, ey + 1), fill=C['white']); d.point((23, ey + 1), fill=C['white'])
    else:
        for x in (14, 23):
            d.rectangle((x, ey, x + 3, ey + 4), fill=C['eye'])
            d.rectangle((x, ey + 3, x + 3, ey + 4), fill=C['iris'])
            d.point((x + 1, ey + 1), fill=C['white']); d.point((x + 2, ey + 1), fill=C['white'])
            d.line([(x - 1, ey - 1), (x + 3, ey - 1)], fill=C['eye'])       # lashes
    blush = C['blush']
    d.rectangle((12, ey + 6, 14, ey + 6), fill=blush); d.rectangle((26, ey + 6, 28, ey + 6), fill=blush)
    if pose == 'happy':
        d.rectangle((12, ey + 5, 15, ey + 7), fill=blush); d.rectangle((25, ey + 5, 28, ey + 7), fill=blush)
    if held:
        d.ellipse((19, ey + 7, 21, ey + 9), fill=C['mouth'])
    elif pose in ('wave_a', 'wave_b', 'happy'):
        d.arc((17, ey + 5, 23, ey + 9), 20, 160, fill=C['mouth'])
    else:
        d.line([(19, ey + 8), (20, ey + 8)], fill=C['mouth'])
    if pose in ('wave_a', 'wave_b'):
        hxp = 33 if pose == 'wave_a' else 31
        d.rounded_rectangle((hxp - 1, by - 12, hxp + 3, by - 6), 1, fill=C['kim'])   # sleeve end at the wrist
        d.ellipse((hxp - 2, by - 17, hxp + 2, by - 12), fill=C['skin'])            # hand
        d.line([(hxp - 1, by - 17), (hxp - 1, by - 15)], fill=C['skin2'])
    if held:
        im = im.rotate(-10, resample=Image.NEAREST, center=(20, 2), expand=False)
    return im

H = {k: hx(v) for k, v in {
    'tile': '#3d4b5e', 'tile2': '#2a3443', 'tilehi': '#6b7f98', 'ridge': '#202833',
    'wall': '#f0e7d3', 'wall2': '#d9cdb2', 'wood': '#6b4a32', 'wood2': '#4a3222', 'board': '#8a6446',
    'paper': '#fbf6e6', 'lattice': '#b89e74', 'inside': '#3a2a22', 'light': '#ffd27a', 'light2': '#ffb44a',
    'noren': '#2b3f78', 'noren2': '#20305e', 'mon': '#eef1fa',
    'lantern': '#e2553a', 'lantern2': '#ffcf75', 'lanternk': '#2a1a14',
    'stone': '#8f8b80', 'stone2': '#6f6b62', 'pine': '#4f8a45', 'pine2': '#356a33', 'pot': '#a0522d',
    'snowless': '#000000',
}.items()}

class Scaled:
    """ImageDraw with every coordinate multiplied by u"""
    def __init__(self, d, u):
        self.d, self.u = d, u
    def _p(self, xy):
        if isinstance(xy[0], (tuple, list)):
            return [(round(x * self.u), round(y * self.u)) for x, y in xy]
        return [round(v * self.u) for v in xy]
    def __getattr__(self, name):
        f = getattr(self.d, name)
        def g(xy, *a, **k):
            if name in ('rounded_rectangle',) and a:
                a = (round(a[0] * self.u),) + a[1:]
            if name == 'point' and isinstance(xy, list):
                return f(self._p(xy), *a, **k)
            return f(self._p(xy), *a, **k)
        return g

def house(door=0.0, shake=0, glow=0.0, u=1):
    """72 x 62 times u. door: 0 closed .. 1 open; shake: px offset of the doors (knocking); glow: lantern flicker 0..1"""
    im = Image.new('RGBA', (round(72 * u), round(62 * u)), (0, 0, 0, 0))
    d = Scaled(ImageDraw.Draw(im), u)
    # walls and posts
    d.rectangle((10, 26, 61, 54), fill=H['wall'])
    d.rectangle((10, 46, 61, 54), fill=H['board'])                       # lower boards
    for x in range(12, 61, 4):
        d.line([(x, 46), (x, 54)], fill=H['wood2'])
    d.rectangle((8, 24, 63, 26), fill=H['wood'])                          # beam
    for x in (9, 26, 45, 61):
        d.rectangle((x, 24, x + 1, 55), fill=H['wood'])
    # a round window on the right
    d.ellipse((49, 31, 57, 39), fill=H['wood'])
    d.ellipse((50, 32, 56, 38), fill=H['paper'])
    d.line([(53, 32), (53, 38)], fill=H['lattice']); d.line([(50, 35), (56, 35)], fill=H['lattice'])
    # doorway: dark warm inside, two shoji panels that slide apart
    dx0, dx1, dy0, dy1 = 28, 44, 30, 55
    d.rectangle((dx0, dy0, dx1, dy1), fill=H['inside'])
    if door > 0:
        g = int(140 * door)
        d.rectangle((dx0 + 2, dy0 + 2, dx1 - 2, dy1), fill=H['light2'][:3] + (g,))
    w = (dx1 - dx0 + 1) // 2
    off = int(round(door * (w - 1)))
    for side in (0, 1):
        x0 = dx0 + side * w + (-off if side == 0 else off) + shake * (1 if side else -1) * 0 + shake
        x1 = x0 + w - 1
        cx0, cx1 = max(x0, dx0 - 0), min(x1, dx1)
        if side == 0:
            x0c, x1c = x0, x1
        else:
            x0c, x1c = x0, x1
        d.rectangle((x0c, dy0, x1c, dy1), fill=H['paper'], outline=H['wood'])
        for y in range(dy0 + 4, dy1, 4):
            d.line([(x0c + 1, y), (x1c - 1, y)], fill=H['lattice'])
        d.line([((x0c + x1c) // 2, dy0 + 1), ((x0c + x1c) // 2, dy1 - 1)], fill=H['lattice'])
    # the doors slide behind the walls: redraw the walls on either side of the doorway
    d.rectangle((10, 26, dx0 - 1, 45), fill=H['wall']); d.rectangle((dx1 + 1, 26, 61, 45), fill=H['wall'])
    d.rectangle((10, 46, dx0 - 1, 54), fill=H['board']); d.rectangle((dx1 + 1, 46, 61, 54), fill=H['board'])
    for x in range(12, dx0 - 1, 4):
        d.line([(x, 46), (x, 54)], fill=H['wood2'])
    for x in range(dx1 + 3, 61, 4):
        d.line([(x, 46), (x, 54)], fill=H['wood2'])
    for x in (9, 26, 45, 61):
        d.rectangle((x, 24, x + 1, 55), fill=H['wood'])
    d.ellipse((49, 31, 57, 39), fill=H['wood']); d.ellipse((50, 32, 56, 38), fill=H['paper'])
    d.line([(53, 32), (53, 38)], fill=H['lattice']); d.line([(50, 35), (56, 35)], fill=H['lattice'])
    # noren over the door: indigo, split in the middle, a white round crest
    d.rectangle((27, 27, 45, 35), fill=H['noren'])
    d.line([(36, 29), (36, 35)], fill=H['noren2'])
    d.ellipse((33, 29, 39, 34), fill=H['mon']); d.ellipse((35, 30, 37, 33), fill=H['noren'])
    # roof: wide tiled hip roof with turned-up eaves
    d.polygon([(2, 24), (8, 21), (16, 10), (56, 10), (64, 21), (70, 24), (70, 25), (2, 25)], fill=H['tile'])
    for x in range(10, 64, 3):
        d.line([(x, 12), (x - (1 if x < 36 else -1) * 2, 22)], fill=H['tile2'])
    d.line([(2, 24), (70, 24)], fill=H['tilehi'])
    d.line([(3, 25), (69, 25)], fill=H['tile2'])
    d.polygon([(0, 22), (4, 24), (2, 25)], fill=H['tile']); d.polygon([(71, 22), (67, 24), (69, 25)], fill=H['tile'])
    d.rectangle((16, 8, 56, 10), fill=H['ridge'])
    d.rectangle((14, 7, 17, 10), fill=H['ridge']); d.rectangle((55, 7, 58, 10), fill=H['ridge'])
    d.line([(17, 12), (55, 12)], fill=H['tilehi'])
    # lantern hanging from the eave
    g = H['lantern2'] if glow > 0.5 else (255, 190, 100, 255)
    d.line([(16, 25), (16, 28)], fill=H['lanternk'])
    d.rectangle((14, 28, 18, 29), fill=H['lanternk'])
    d.ellipse((12, 29, 20, 39), fill=H['lantern'])
    d.line([(13, 32), (19, 32)], fill=g); d.line([(13, 35), (19, 35)], fill=g)
    d.rectangle((14, 39, 18, 40), fill=H['lanternk'])
    # stone step and a potted pine
    d.rectangle((26, 56, 46, 58), fill=H['stone']); d.line([(26, 58), (46, 58)], fill=H['stone2'])
    d.rectangle((62, 52, 68, 58), fill=H['pot'])
    d.ellipse((59, 43, 69, 51), fill=H['pine']); d.ellipse((61, 40, 69, 47), fill=H['pine2']); d.ellipse((63, 45, 71, 52), fill=H['pine'])
    return im

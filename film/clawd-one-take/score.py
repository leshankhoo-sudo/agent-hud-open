"""The soundtrack for the one-take: 64 s, 120 BPM, 32 bars, numpy only.

Every sound effect sits on a cue from timeline.json, so picture and sound
come from one clock. Note tails and the reverb wrap around the end of the
buffer, which makes the last sample run straight into the first: the track
loops without a seam, like the picture.

Writes:
  out/score.wav    16-bit stereo, 44.1 kHz
  out/score.json   the notes, the waveform peaks and the beat onsets the
                   film draws (all read back from the mixed audio, not
                   from the score)
"""

import json
import math
import os
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
TL = json.load(open(os.path.join(HERE, "timeline.json"), encoding="utf-8"))
CUE = TL["cues"]

SR = 44100
DUR = TL["duration"]
N = SR * DUR
BEAT = 60 / TL["bpm"]
BAR = 4 * BEAT
rng = np.random.default_rng(64)

L = np.zeros(N)
R = np.zeros(N)
notes = []  # what the score window and the editor draw


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def put(sig, t0, pan=0.0, gain=1.0):
    """Mix a mono signal in at t0 seconds, wrapping past the end."""
    start = int(round(t0 * SR)) % N
    sig = sig * gain
    lg = math.cos((pan + 1) * math.pi / 4)
    rg = math.sin((pan + 1) * math.pi / 4)
    idx = (start + np.arange(len(sig))) % N
    np.add.at(L, idx, sig * lg)
    np.add.at(R, idx, sig * rg)


def env(n, a, d, s, r, sustain_n):
    """ADSR in samples; sustain_n is how long the key is held."""
    a, d, r = max(1, int(a * SR)), max(1, int(d * SR)), max(1, int(r * SR))
    e = np.zeros(n)
    hold = max(sustain_n, a + d)
    e[:a] = np.linspace(0, 1, a, endpoint=False)
    e[a : a + d] = np.linspace(1, s, d, endpoint=False)
    e[a + d : hold] = s
    tail = min(r, n - hold)
    if tail > 0:
        e[hold : hold + tail] = np.linspace(s, 0, tail)
    return e


def tvec(sec):
    return np.arange(int(sec * SR)) / SR


def osc_additive(f, t, harmonics, slope=1.0, odd=False, detune=0.0):
    out = np.zeros_like(t)
    for h in range(1, harmonics + 1):
        if odd and h % 2 == 0:
            continue
        if f * h > 12000:
            break
        out += np.sin(2 * np.pi * f * h * (1 + detune) * t) / h**slope
    return out


# --- instruments -------------------------------------------------------------


def pad(chord, t0, dur, gain=0.11):
    t = tvec(dur + 1.6)
    sig = np.zeros_like(t)
    for m in chord:
        f = midi(m)
        for dt in (-0.004, 0.004):
            sig += osc_additive(f, t, 7, slope=1.25, detune=dt)
    e = env(len(t), 0.5, 0.4, 0.8, 1.5, int(dur * SR))
    put(sig * e / len(chord), t0, pan=0, gain=gain)


def bell(m, t0, gain=0.1, pan=0.0):
    f = midi(m)
    t = tvec(1.8)
    sig = np.sin(2 * np.pi * f * t) * np.exp(-t * 3.2)
    sig += 0.35 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 7)
    sig += 0.15 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t * 12)
    sig *= np.minimum(1, t * 400)
    put(sig, t0, pan, gain)
    notes.append({"t": t0, "d": 0.35, "m": m, "i": "bell"})


def bass(m, t0, dur, gain=0.2):
    f = midi(m)
    t = tvec(dur + 0.1)
    sig = osc_additive(f, t, 9, slope=1.0, odd=True) * 0.8
    sig += 0.5 * np.sin(2 * np.pi * f * t)
    e = env(len(t), 0.004, 0.12, 0.6, 0.08, int(dur * SR))
    put(sig * e, t0, -0.05, gain)
    notes.append({"t": t0, "d": dur, "m": m, "i": "bass"})


def lead(m, t0, dur, gain=0.085, pan=0.18):
    f = midi(m)
    t = tvec(dur + 0.25)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * t) * np.minimum(1, t * 3)
    phase = np.cumsum(f * vib) / SR
    duty = 0.25
    sig = np.zeros_like(t)
    for h in range(1, 14):
        if f * h > 12000:
            break
        sig += np.sin(np.pi * h * duty) / h * np.cos(2 * np.pi * h * phase)
    e = env(len(t), 0.01, 0.1, 0.7, 0.2, int(dur * SR))
    put(sig * e, t0, pan, gain)
    notes.append({"t": t0, "d": dur, "m": m, "i": "lead"})


def arp(m, t0, gain=0.045, pan=-0.3):
    f = midi(m)
    t = tvec(0.16)
    sig = np.sign(np.sin(2 * np.pi * f * t)) * 0.6 + np.sin(2 * np.pi * f * t)
    sig *= np.exp(-t * 26)
    put(sig, t0, pan, gain)
    notes.append({"t": t0, "d": 0.12, "m": m, "i": "arp"})


def kick(t0, gain=0.55):
    t = tvec(0.45)
    f = 45 + 110 * np.exp(-t * 28)
    sig = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7.5)
    sig += 0.25 * rng.standard_normal(len(t)) * np.exp(-t * 300)
    put(np.tanh(sig * 1.4), t0, 0, gain)


def snare(t0, gain=0.22):
    t = tvec(0.3)
    noise = rng.standard_normal(len(t))
    noise = noise - np.concatenate([[0], noise[:-1]]) * 0.6
    sig = noise * np.exp(-t * 18) * 0.6
    sig += np.sin(2 * np.pi * 190 * t) * np.exp(-t * 25)
    put(sig, t0, 0.05, gain)


def hat(t0, gain=0.05, open_=False):
    t = tvec(0.25 if open_ else 0.06)
    noise = rng.standard_normal(len(t))
    noise = np.diff(np.diff(noise, prepend=0), prepend=0)
    sig = noise * np.exp(-t * (14 if open_ else 70))
    put(sig, t0, 0.25, gain)


# --- sound effects -----------------------------------------------------------


def sweep(f0, f1, dur, t0, gain, shape="sine", decay=6.0, pan=0.0):
    t = tvec(dur)
    f = f0 * (f1 / f0) ** (t / dur)
    ph = 2 * np.pi * np.cumsum(f) / SR
    sig = np.sin(ph) if shape == "sine" else np.sign(np.sin(ph)) * 0.5
    sig *= np.exp(-t * decay) * np.minimum(1, t * 300)
    put(sig, t0, pan, gain)


def click(t0, gain=0.25, f=2400):
    t = tvec(0.04)
    sig = np.sin(2 * np.pi * f * t) * np.exp(-t * 160)
    put(sig, t0, 0.1, gain)


def thunk(t0, gain=0.35):
    sweep(220, 70, 0.22, t0, gain, decay=14)
    click(t0, gain * 0.5, 900)


def noise_swell(t0, dur, gain, up=True, bright=1.0, pan=0.0):
    """Filtered noise that swells; brightness rises with time when `up`."""
    t = tvec(dur)
    noise = rng.standard_normal(len(t))
    spec = np.fft.rfft(noise)
    freqs = np.fft.rfftfreq(len(noise), 1 / SR)
    # Two bands blended over time: dark at the start, bright at the end.
    dark = np.fft.irfft(spec * (freqs < 900 * bright), len(noise))
    light = np.fft.irfft(spec * ((freqs > 900) & (freqs < 9000 * bright)), len(noise))
    x = t / dur
    mix = x if up else 1 - x
    sig = dark * (1 - mix) + light * mix
    shape = np.sin(np.pi * np.clip(x, 0, 1)) ** 1.5 if not up else x**2
    put(sig * shape, t0, pan, gain)


def hit(t0, gain=0.5):
    kick(t0, 0.7)
    noise_swell(t0, 1.6, gain * 0.5, up=False, bright=1.2)
    for m in (36, 48, 55, 60, 64):
        t = tvec(1.8)
        sig = osc_additive(midi(m), t, 6) * np.exp(-t * 2.2)
        put(sig, t0, 0, gain * 0.05)


def chime(t0, gain=0.12, root=84):
    for k, m in enumerate((root, root + 4, root + 7, root + 12)):
        bell(m, t0 + k * 0.05, gain, pan=-0.4 + 0.27 * k)
        notes.pop()


def crackle(t0, dur, gain=0.08):
    for _ in range(int(dur * 40)):
        click(t0 + rng.random() * dur, gain * rng.random(), 2000 + 4000 * rng.random())


# --- the score ---------------------------------------------------------------

CHORDS = [  # (bass, pad voicing) per bar, cycling C - Am - Fmaj7 - G6
    (36, [60, 64, 67, 71]),
    (33, [57, 60, 64, 67]),
    (29, [53, 57, 60, 64]),
    (31, [55, 59, 62, 69]),
]
THEME = [  # 4 bars of (midi, beats); None is a rest
    [(76, 1), (79, 0.5), (81, 0.5), (79, 1), (76, 0.5), (74, 0.5)],
    [(72, 1), (76, 0.5), (79, 0.5), (81, 1.5), (None, 0.5)],
    [(81, 1), (84, 0.5), (81, 0.5), (79, 1), (76, 1)],
    [(74, 0.5), (76, 0.5), (79, 1), (74, 1), (71, 1)],
]
THEME_END = [(74, 0.5), (76, 0.5), (79, 0.5), (81, 0.5), (84, 2)]


def play_theme_bar(b, bar_notes, shift=0, gain=0.085):
    t = b * BAR
    for m, beats in bar_notes:
        if m is not None:
            lead(m + shift, t, beats * BEAT * 0.92, gain)
        t += beats * BEAT


def section(b):
    t = b * BAR
    if b <= 2 or b >= 29:
        return "morning"
    if b <= 4:
        return "typing"
    if b == 5:
        return "build"
    if b <= 11:
        return "agents"
    if b <= 15:
        return "beats"
    if b <= 21:
        return "coaster"
    if b == 22:
        return "break"
    if b <= 26:
        return "droste"
    return "finale"


for b in range(32):
    t = b * BAR
    root, voicing = CHORDS[b % 4]
    sec = section(b)
    pad(voicing, t, BAR, gain=0.12 if sec in ("morning", "break", "droste") else 0.08)

    if sec in ("morning", "typing", "break"):
        for k in range(4):
            bell(voicing[(k * 2 + b) % 4] + 12, t + k * BEAT, 0.07, pan=0.5 - 0.33 * k)
    if sec in ("typing", "build", "break"):
        bass(root + 12, t, BAR * 0.48, 0.16)
        bass(root + 12, t + BAR / 2, BAR * 0.48, 0.16)
    if sec == "typing":
        for k in range(8):
            hat(t + k * BEAT / 2, 0.025)
    if sec == "build":
        for k in range(16):
            snare(t + k * BEAT / 4, 0.03 + 0.012 * k)
        noise_swell(t, BAR, 0.18, up=True)

    if sec in ("agents", "coaster", "finale"):
        for k in range(4):
            kick(t + k * BEAT)
        kick(t + 3.5 * BEAT, 0.35)
        snare(t + BEAT)
        snare(t + 3 * BEAT)
        for k in range(8):
            hat(t + k * BEAT / 2, 0.05 if k % 2 else 0.03, open_=(k == 7))
        pattern = [0, 0, 12, 0, 7, 0, 12, 7]
        for k, step in enumerate(pattern):
            bass(root + 12 + step, t + k * BEAT / 2, BEAT / 2 * 0.85, 0.17)
    if sec == "agents":
        if b >= 7:
            play_theme_bar(b, THEME[(b - 7) % 4] if b < 11 else THEME_END)
        for k in range(16):
            arp(voicing[k % 4] + 12 * (k // 8), t + k * BEAT / 4, 0.03)
    if sec == "beats":
        # Four on the floor and little else on the low end: these kicks are
        # the beats the editor finds in the waveform.
        for k in range(4):
            kick(t + k * BEAT, 0.65)
            hat(t + k * BEAT + BEAT / 2, 0.06, open_=True)
        snare(t + BEAT, 0.12)
        snare(t + 3 * BEAT, 0.12)
        for k in range(4):
            bass(root + 24, t + k * BEAT + BEAT / 2, BEAT / 2 * 0.8, 0.1)
        for k in range(16):
            arp(voicing[(k * 3) % 4] + 12, t + k * BEAT / 4, 0.035)
    if sec == "coaster":
        for k in range(16):
            arp(voicing[k % 4] + 12 + 12 * ((k // 4) % 2), t + k * BEAT / 4, 0.05)
        play_theme_bar(b, THEME[(b - 16) % 4], shift=12 if b >= 18 else 0, gain=0.07)
    if sec == "droste":
        for k in range(16):
            bell(voicing[k % 4] + 24 - 12 * (k % 2), t + k * BEAT / 4, 0.03 + 0.008 * (b - 23), pan=0.6 * math.sin(k))
        kick(t, 0.4)
        kick(t + 2 * BEAT, 0.4)
        if b >= 24:
            for k in range(8):
                hat(t + k * BEAT / 2, 0.03)
        bass(root + 12, t, BAR * 0.95, 0.14)
    if sec == "finale":
        play_theme_bar(b, THEME[0] if b == 27 else THEME_END, gain=0.1)
        for k in range(16):
            arp(voicing[k % 4] + 24, t + k * BEAT / 4, 0.035)

# Cues -> sound effects
sweep(180, 900, 0.35, CUE["kick"], 0.3, decay=4)  # boing
thunk(CUE["kick"], 0.25)
noise_swell(CUE["kick"] + 0.05, CUE["stick"] - CUE["kick"], 0.12, up=True, bright=0.8, pan=0.5)
thunk(CUE["stick"], 0.3)
click(CUE["stick"] + 0.02, 0.2, 3200)
for k in range(5):
    bell(96 + (0, 4, 7, 12, 16)[k], CUE["cursor"] + k * 0.04, 0.04)
    notes.pop()
click(CUE["termClick"], 0.35)
thunk(CUE["termClick"], 0.18)
sweep(300, 1200, 0.18, CUE["termOpen"], 0.15, decay=10)
prompt = TL["prompt"]
for k in range(len(prompt)):
    click(CUE["typeStart"] + k * CUE["typeStep"], 0.22, 1800 + 300 * (k % 3))
    thunk(CUE["typeStart"] + k * CUE["typeStep"], 0.07)
thunk(CUE["enter"], 0.4)
click(CUE["enter"], 0.35, 1400)
crackle(CUE["spark"], 1.0, 0.12)
for k in range(4):
    sweep(400 + 150 * k, 1600 + 300 * k, 0.15, CUE["split"] + k * 0.05, 0.14, shape="square", decay=12, pan=-0.6 + 0.4 * k)
for k, d in enumerate(CUE["done"]):
    chime(d, 0.05, 79 + 2 * k)
noise_swell(CUE["editor"] - 0.3, 1.2, 0.14, up=False, bright=1.0)
for d in CUE["drops"]:
    click(d, 0.3, 3000)
    click(d + 0.03, 0.2, 2200)
noise_swell(CUE["render"] - 1.0, 1.0, 0.12, up=True)
hit(CUE["render"], 0.6)
for k in range(10):  # chain lift
    click(CUE["coasterStart"] + 0.2 * k, 0.14, 1300)
noise_swell(CUE["loopTop"] - 1.6, 3.2, 0.2, up=False, bright=0.9, pan=-0.2)
noise_swell(CUE["coasterEnd"] - 0.2, 0.9, 0.12, up=False, bright=1.4)
chime(CUE["fileDrop"], 0.09, 72)
noise_swell(CUE["pushStart"], CUE["pushEnd"] - CUE["pushStart"], 0.16, up=True, bright=1.1)
hit(CUE["merge"], 0.5)
for k in range(len(TL["title"])):
    thunk(CUE["titleStart"] + k * CUE["titleStep"], 0.3)
noise_swell(CUE["close"], 0.8, 0.1, up=False)
bell(100, CUE["grab"], 0.08)
notes.pop()
click(CUE["place"], 0.3, 2000)
thunk(CUE["place"], 0.15)

# --- reverb and mastering (circular, so the loop stays seamless) -------------

ir_t = tvec(1.9)
ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t * 3.4)
ir[0] = 0
ir /= np.sqrt(np.sum(ir**2))
IR = np.fft.rfft(np.concatenate([ir, np.zeros(N - len(ir))]))


def verb(x, wet):
    return x + wet * np.fft.irfft(np.fft.rfft(x) * IR, N)


L, R = verb(L, 0.22), verb(R, 0.22)
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = np.tanh(1.2 * L / peak) / np.tanh(1.2), np.tanh(1.2 * R / peak) / np.tanh(1.2)
L *= 0.89
R *= 0.89

os.makedirs(OUT, exist_ok=True)
pcm = (np.stack([L, R], axis=1) * 32767).astype("<i2")
with wave.open(os.path.join(OUT, "score.wav"), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())

# --- what the picture reads back from the mixed audio ------------------------

mono = (L + R) / 2
PEAK_RATE = 200  # columns per second
hop = SR // PEAK_RATE
frames = mono[: (N // hop) * hop].reshape(-1, hop)
peaks = np.round(np.stack([frames.min(1), frames.max(1)], 1) * 127).astype(int)

# Onsets: rises in the low band's energy, 10 ms hops, local maxima only.
spec_hop = SR // 100
low = np.fft.irfft(np.fft.rfft(mono) * (np.fft.rfftfreq(N, 1 / SR) < 110), N)
energy = np.sqrt((low[: (N // spec_hop) * spec_hop].reshape(-1, spec_hop) ** 2).mean(1))
flux = np.maximum(0, np.diff(energy, prepend=energy[-1]))
thr = flux.mean() + 2.2 * flux.std()
onsets = []
for i in range(len(flux)):
    window = flux[max(0, i - 15) : i + 16]
    if flux[i] > thr and flux[i] == window.max():
        # The rise peaks a hop or two after the attack; report the attack.
        j = i
        while j > 0 and flux[j - 1] > flux[i] * 0.2 and i - j < 4:
            j -= 1
        onsets.append(round(j / 100, 2))

notes.sort(key=lambda n: n["t"])
json.dump(
    {
        "sampleRate": SR,
        "samples": N,
        "bpm": TL["bpm"],
        "peakRate": PEAK_RATE,
        "peaks": peaks.flatten().tolist(),
        "onsets": onsets,
        "notes": [{**n, "t": round(n["t"], 4), "d": round(n["d"], 4)} for n in notes],
    },
    open(os.path.join(OUT, "score.json"), "w"),
    separators=(",", ":"),
)
print(f"score.wav {DUR}s, {len(notes)} notes, {len(onsets)} onsets", file=sys.stderr)

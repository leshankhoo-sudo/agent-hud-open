#!/usr/bin/env python3
"""Original background piece for the dashboard: "Kyoto, Slowly" (piano, soft strings, warm pad).

Written note by note below; nothing is sampled or transcribed from an existing recording or score.
G major, 80 BPM, 48 bars (about 2 min 26 s), six 8-bar sections: A (piano alone) - A' (+ strings)
- B - A'' - C - A (thinning out), so the end hands back to the beginning and the file loops.

Rendering: MIDI -> FluidSynth with the FluidR3_GM SoundFont (sampled grand piano and strings, MIT
licence) -> numpy: the reverb/release tail after the last bar is folded onto the start, so the loop
point has no cut. Needs: fluidsynth, FluidR3_GM.sf2, ffmpeg, mido, numpy, scipy.

Usage: python3 scripts/compose_music.py [out_dir]   (WAV master + MP3; MP3 also to public/media)
"""
import os
import random
import subprocess
import sys

import mido
import numpy as np
from scipy.io import wavfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'music-master')
SF2 = '/usr/share/sounds/sf2/FluidR3_GM.sf2'
BPM, SR, PAD = 80, 48000, 1.0
random.seed(7)

NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
def n(name):
    acc = 1 if '#' in name else 0
    return 12 * (int(name[-1]) + 1) + NOTE[name[0]] + acc

# chords: bass note, then the tones the left hand and the strings draw from
CH = {
    'G': ('G2', ['G2', 'D3', 'G3', 'B3', 'D4']), 'D/F#': ('F#2', ['F#2', 'D3', 'A3', 'D4', 'F#4']),
    'Em7': ('E2', ['E2', 'B2', 'G3', 'B3', 'D4']), 'Cmaj7': ('C3', ['C3', 'G3', 'B3', 'E4', 'G4']),
    'G/B': ('B2', ['B2', 'G3', 'B3', 'D4', 'G4']), 'Am7': ('A2', ['A2', 'E3', 'G3', 'C4', 'E4']),
    'Cadd9': ('C3', ['C3', 'G3', 'D4', 'E4', 'G4']), 'Dsus': ('D3', ['D3', 'A3', 'D4', 'G4', 'A4']),
    'D': ('D3', ['D3', 'A3', 'D4', 'F#4', 'A4']), 'Em': ('E2', ['E2', 'B2', 'E3', 'G3', 'B3']),
    'Bm7': ('B2', ['B2', 'F#3', 'A3', 'D4', 'F#4']),
}
PROG_A = ['G', 'D/F#', 'Em7', 'Cmaj7', 'G/B', 'Am7', 'Cadd9', 'Dsus']
PROG_B = ['Em', 'Bm7', 'Cmaj7', 'G/B', 'Am7', 'Em7', 'Cmaj7', 'Dsus']
PROG_C = ['Cmaj7', 'D', 'Bm7', 'Em', 'Am7', 'G/B', 'Cadd9', 'D']

R = None  # rest
# melodies: one list per bar of (note, beats); each bar adds up to 4 beats
MEL_A = [
    [(R, 1), ('B4', 1), ('D5', 1), ('E5', 1)], [('D5', 2), ('A4', 1), ('B4', 1)], [('G4', 3), ('A4', .5), ('B4', .5)], [('E5', 2), ('D5', 1), ('B4', 1)],
    [('D5', 1.5), ('E5', .5), ('G5', 2)], [('E5', 2), ('D5', 1), ('C5', 1)], [('D5', 1.5), ('B4', .5), ('A4', 1), ('G4', 1)], [('A4', 3), (R, 1)],
]
MEL_A2 = MEL_A[:7] + [[('A4', 2), ('B4', 1), ('D5', 1)]]
MEL_B = [
    [('G5', 2), ('F#5', 1), ('E5', 1)], [('D5', 3), ('B4', 1)], [('E5', 1.5), ('D5', .5), ('C5', 1), ('E5', 1)], [('D5', 3), (R, 1)],
    [('C5', 1), ('E5', 1), ('A5', 2)], [('G5', 2), ('E5', 1), ('D5', 1)], [('E5', 1.5), ('G5', .5), ('B5', 2)], [('A5', 2), ('F#5', 1), ('D5', 1)],
]
MEL_A3 = [  # the first theme again, a little fuller, with small turns
    [('G4', .5), ('A4', .5), ('B4', 1), ('D5', 1), ('E5', 1)], [('D5', 2), ('A4', 1), ('B4', 1)], [('G4', 2), ('B4', 1), ('A4', .5), ('B4', .5)], [('E5', 2), ('D5', 1), ('B4', 1)],
    [('D5', 1.5), ('E5', .5), ('G5', 1.5), ('A5', .5)], [('G5', 1), ('E5', 1), ('D5', 1), ('C5', 1)], [('D5', 1.5), ('B4', .5), ('A4', 1), ('G4', 1)], [('A4', 3), (R, 1)],
]
MEL_C = [
    [('E4', 1), ('G4', 1), ('B4', 2)], [('A4', 2), ('F#4', 1), ('A4', 1)], [('D5', 2), ('B4', 1), ('A4', 1)], [('G4', 3), ('B4', 1)],
    [('C5', 1.5), ('B4', .5), ('A4', 1), ('E5', 1)], [('D5', 2), ('B4', 2)], [('E5', 1), ('D5', 1), ('G4', 2)], [('A4', 4)],
]
MEL_OUT = [
    [(R, 1), ('B4', 1), ('D5', 2)], [('D5', 2), ('A4', 2)], [('G4', 4)], [('E5', 2), ('D5', 2)],
    [('D5', 2), ('G5', 2)], [('E5', 3), ('C5', 1)], [('D5', 2), ('A4', 2)], [('A4', 4)],
]
# section: progression, melody, melody loudness, left-hand density, strings level, octave doubling
SECTIONS = [
    (PROG_A, MEL_A, 0.74, 'sparse', 0.0, False), (PROG_A, MEL_A2, 0.82, 'flow', 0.55, False), (PROG_B, MEL_B, 0.9, 'flow', 0.75, False),
    (PROG_A, MEL_A3, 0.96, 'full', 0.9, True), (PROG_C, MEL_C, 0.8, 'flow', 0.7, False), (PROG_A, MEL_OUT, 0.68, 'sparse', 0.3, False),
]
BARS = 8 * len(SECTIONS)

# gentle rubato: each 8-bar phrase eases slightly into its last bar
def beat_len(beat):
    bar = int(beat // 4) % 8
    pos = (beat % 4) / 4
    slow = 0.035 * pos if bar == 7 else 0.012 * np.sin(np.pi * ((bar + pos) / 8))
    return 60 / BPM * (1 + slow)
GRID = 96
TIMES = np.concatenate([[0], np.cumsum([beat_len(i / GRID) / GRID for i in range(BARS * 4 * GRID)])])
def t(beat):
    return float(TIMES[min(len(TIMES) - 1, int(round(beat * GRID)))])
LENGTH = t(BARS * 4)

events = []  # (seconds, message)
def note(ch, pitch, beat, dur, vel, late=0.0):
    on = t(beat) + late + random.uniform(-0.008, 0.010)
    off = t(beat + dur) + random.uniform(-0.01, 0.02)
    v = int(max(1, min(127, vel + random.uniform(-3, 3))))
    events.append((max(0, on), mido.Message('note_on', channel=ch, note=pitch, velocity=v)))
    events.append((max(on + 0.05, off), mido.Message('note_off', channel=ch, note=pitch)))

for s, (prog, mel, loud, lh, strings, double) in enumerate(SECTIONS):
    for b in range(8):
        bar0 = (s * 8 + b) * 4
        bass, tones = CH[prog[b]]
        tn = [n(x) for x in tones]
        arc = 0.85 + 0.15 * np.sin(np.pi * (b + 0.5) / 8)          # each phrase swells and settles
        # sustain pedal: lift and press again just after each bar line
        events.append((max(0, t(bar0) - 0.03), mido.Message('control_change', channel=0, control=64, value=0)))
        events.append((t(bar0) + 0.06, mido.Message('control_change', channel=0, control=64, value=127)))
        # left hand: broken chords, never the same weight twice
        pat = {'sparse': [(0, 0), (1, 1), (2, 2), (3, 3)], 'flow': [(0, 0), (.5, 1), (1, 2), (1.5, 3), (2, 4), (2.5, 3), (3, 2), (3.5, 1)],
               'full': [(0, 0), (.5, 1), (1, 2), (1.5, 3), (2, 4), (2.5, 3), (3, 2), (3.5, 3)]}[lh]
        for pos, idx in pat:
            if prog[b] == 'Dsus' and pos >= 2 and idx == 3:
                tn[3] = n('F#4')                                    # the suspension resolves on beat 3
            w = 46 if pos == 0 else 36 if pos in (2,) else 31
            note(0, tn[idx], bar0 + pos, 4 - pos if lh == 'sparse' else 1.5, w * arc * (0.9 + 0.25 * loud), late=0.004 * idx)
        if lh == 'full':
            note(0, n(bass) - 12, bar0, 3.5, 40 * arc)
        # right hand melody: the first note of a bar a touch stronger, long notes sing
        beat = bar0
        for i, (p, d) in enumerate(mel[b]):
            if p is not None:
                v = (62 + (6 if i == 0 else 0) + (5 if d >= 2 else 0) + (n(p) - 71) * 0.5) * loud * arc
                note(0, n(p), beat, d * 0.98, v, late=0.012)        # melody sits a hair behind the bass
                if double:
                    note(0, n(p) + 12, beat, d * 0.98, v * 0.62, late=0.02)
            beat += d
        # strings and pad: held chord tones, entering softly
        if strings > 0:
            for k, idx in enumerate((2, 3, 4)):
                note(1, tn[idx] + (12 if k == 2 and s in (2, 3) else 0), bar0, 4.05, (30 + 5 * k) * strings * arc, late=0.03 * k)
            note(1, n(bass) + 12, bar0, 4.05, 30 * strings)
        note(2, tn[2], bar0, 4.1, 34 * (0.5 + 0.5 * max(strings, 0.3)))
        note(2, tn[4], bar0, 4.1, 28 * (0.5 + 0.5 * max(strings, 0.3)))

os.makedirs(OUT, exist_ok=True)
mid = mido.MidiFile(ticks_per_beat=480)
tr = mido.MidiTrack()
mid.tracks.append(tr)
tr.append(mido.MetaMessage('set_tempo', tempo=500000))             # 120 BPM clock: 1 beat = 0.5 s = 480 ticks
for ch, prog, vol, pan in ((0, 0, 110, 64), (1, 48, 74, 52), (2, 89, 58, 76)):   # grand piano, string ensemble, warm pad
    tr.append(mido.Message('program_change', channel=ch, program=prog))
    tr.append(mido.Message('control_change', channel=ch, control=7, value=vol))
    tr.append(mido.Message('control_change', channel=ch, control=10, value=pan))
    tr.append(mido.Message('control_change', channel=ch, control=91, value=90 if ch else 70))
last = 0
for sec, msg in sorted(events, key=lambda e: e[0]):
    tick = int(round(sec * 960))
    tr.append(msg.copy(time=tick - last))
    last = tick
tr.append(mido.MetaMessage('end_of_track', time=int((LENGTH + 9) * 960) - last))
mid_path = os.path.join(OUT, 'kyoto-slowly.mid')
mid.save(mid_path)

raw = os.path.join(OUT, 'raw.wav')
subprocess.run(['fluidsynth', '-ni', '-q', '-g', '0.7', '-r', str(SR), '-o', 'synth.reverb.active=1', '-o', 'synth.reverb.room-size=0.82', '-o', 'synth.reverb.damp=0.35',
                '-o', 'synth.reverb.width=0.9', '-o', 'synth.reverb.level=0.55', '-o', 'synth.chorus.active=0', '-o', 'synth.polyphony=512', '-F', raw, SF2, mid_path], check=True)
sr, a = wavfile.read(raw)
a = a.astype(np.float64) / 32768
L = int(round(LENGTH * sr))
loop = a[:L].copy()
tail = a[L:L + sr * 8]
loop[:len(tail)] += tail                                            # what rings on after the last bar now rings under the first
loop /= np.max(np.abs(loop)) / 10 ** (-3 / 20)                      # peak at -3 dBFS, no limiter needed
pad = int(PAD * sr)
ext = np.concatenate([loop[-pad:], loop, loop[:pad]])               # periodic lead-in / lead-out for players that loop inside the file

def save(path, x):
    wavfile.write(path, sr, np.round(x * 32767).astype(np.int16))
wav = os.path.join(OUT, 'kyoto-slowly-master.wav')
save(wav, loop)
ext_wav = os.path.join(OUT, 'ext.wav')
save(ext_wav, ext)
mp3 = os.path.join(OUT, 'kyoto-slowly.mp3')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', ext_wav, '-codec:a', 'libmp3lame', '-b:a', '160k', mp3], check=True)
os.remove(raw)
os.remove(ext_wav)
site = os.path.join(ROOT, 'public', 'media', 'kyoto-slowly.mp3')
subprocess.run(['cp', mp3, site], check=True)

rms = 20 * np.log10(np.sqrt(np.mean(loop ** 2)))
seam = np.abs(loop[0] - loop[-1]).max()
step = np.abs(np.diff(loop, axis=0)).max(axis=1)
print(f'length {LENGTH:.3f} s ({BARS} bars) | peak {20 * np.log10(np.abs(loop).max()):.1f} dBFS | rms {rms:.1f} dBFS | clipped samples {(np.abs(loop) >= 0.999).sum()}')
print(f'loop seam step {seam:.4f} vs largest step inside the piece {step.max():.4f} (99.9th percentile {np.percentile(step, 99.9):.4f})')
print(f'loop: start {PAD:.3f} s, end {PAD + L / sr:.6f} s | wav {os.path.getsize(wav) / 1e6:.1f} MB | mp3 {os.path.getsize(mp3) / 1e6:.2f} MB')
import json
json.dump({'title': 'Kyoto, Slowly', 'src': 'media/kyoto-slowly.mp3', 'loop_start': PAD, 'loop_end': PAD + L / sr, 'bpm': BPM, 'bars': BARS, 'key': 'G major',
           'credit': 'Original piece written for this dashboard; rendered with FluidSynth and the FluidR3_GM SoundFont (MIT licence).'},
          open(os.path.join(ROOT, 'public', 'data', 'music.json'), 'w'), indent=1)

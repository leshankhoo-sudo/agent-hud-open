# 主角是我自己 · Clawd's one-take

A 64-second, single-shot film made entirely from code. Its lead is Clawd, the
orange pixel character from Claude Code, drawn with the sprite table in
`src/packages/hud/src/assets/clawd-sprites.json`. Clawd also plays the mouse.

| Time | What happens |
| --- | --- |
| 0–5 s | Dawn. Clawd kicks the mouse pointer into the menu bar and takes over as the cursor. |
| 5–12 s | It stomps the terminal open and types 「做一条视频，主角是你自己」, one character per stomp. |
| 12–24 s | It splits into four agents for modeling, code, score and edit, and all four windows open at once. The voxel model is built from the sprite, the code window types `film.js` itself, and the piano roll plays the real score. |
| 24–32 s | In the editor, Clawd hops along the real waveform and lands on each detected beat. The other three drag their clips onto the timeline. Clawd stomps 「渲染」. |
| 32–44 s | The rendered frames link into a film-strip roller coaster with a loop, and all four ride it. Each cell shows an earlier frame of this same film. |
| 44–54 s | They drag the finished film into the player. The screen shows the current frame, and the camera pushes four levels into it. |
| 54–59 s | The four merge back into one Clawd, who stomps out the title and the real production numbers. |
| 59–64 s | Clawd gets the pointer back and puts it where it was. It is dawn again, so the film loops without a seam. |

## What is real

- **Waveform and beats.** Both come from the mixed `score.wav`. `score.py` reads peaks and low-band onsets back from the audio, not from the score.
- **Piano roll.** It shows the notes the score actually plays.
- **Code window.** It types `film.js`, the file that draws the film.
- **Film-strip cells and editor preview.** They are earlier moments of the film, drawn small by the same `drawScene`.
- **Player screen.** The same `drawScene` at the same `t`, drawn into itself, until a level is under 2 px.
- **Title-card numbers.** Line count, notes, onsets and sprite frames are counted by `build.mjs`. The nesting depth is computed in the frame. The render time is the wall clock when that frame was drawn.
- **Sound effects.** Every effect sits on a cue in `timeline.json`, and the picture uses the same cues.

## Run it

Needs Python 3 with numpy, Node 22, Playwright with Chromium, and ffmpeg with libx264.

```sh
node render.mjs                         # score + data + every frame -> out/clawd-one-take.mp4
node render.mjs --stills 3,33,49        # single frames -> out/stills/
node render.mjs --from 44 --to 54 --out out/droste.mp4
```

To watch it live with sound, run `python3 score.py && node build.mjs` once. Then serve this folder (for example `python3 -m http.server`) and open `film.html`. Click to play, space pauses, and the arrow keys jump 2 s.

## Files

- `timeline.json`: the cue sheet the picture and sound share.
- `score.py`: the soundtrack (120 BPM, 32 bars) plus the notes, peaks and onsets as JSON. Note tails and the reverb wrap around the end, so the audio loops too.
- `build.mjs`: bundles the sprites, score data, source and stats into `out/data.js`.
- `film.js`: the film. `drawScene(t)` is a pure function of time, and the camera and the push into the screen are applied on top of it.
- `film.html`: the player and the render target.
- `render.mjs`: runs headless Chromium, pipes PNG frames to ffmpeg, and muxes the score.

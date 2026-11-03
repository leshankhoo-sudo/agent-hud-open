// Gathers everything the film draws into out/data.js: the Clawd sprite table
// from the HUD package, the soundtrack's notes, peaks and onsets from
// score.py, the cue sheet, this folder's own source (the code window types
// it) and the production numbers the title card prints.
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const read = (path) => readFileSync(join(here, path), "utf8");

const sprites = JSON.parse(
  readFileSync(
    join(repo, "src/packages/hud/src/assets/clawd-sprites.json"),
    "utf8",
  ),
).sprites;
const timeline = JSON.parse(read("timeline.json"));
const score = JSON.parse(read("out/score.json"));

const sources = ["film.js", "score.py", "build.mjs", "render.mjs", "film.html"];
const lineCount = (text) => text.split("\n").filter((l) => l.trim()).length;
const code = Object.fromEntries(sources.map((f) => [f, read(f)]));
const spriteFrames = Object.values(sprites).reduce(
  (n, s) => n + s.deltas.length + 1,
  0,
);

const stats = {
  frames: timeline.duration * timeline.fps,
  fps: timeline.fps,
  codeLines: Object.values(code).reduce((n, t) => n + lineCount(t), 0),
  codeFiles: sources.length,
  notes: score.notes.length,
  onsets: score.onsets.length,
  samples: score.samples,
  sampleRate: score.sampleRate,
  wavBytes: statSync(join(here, "out/score.wav")).size,
  spriteSets: Object.keys(sprites).length,
  spriteFrames,
};

mkdirSync(join(here, "out"), { recursive: true });
writeFileSync(
  join(here, "out/data.js"),
  "window.FILM_DATA = " +
    JSON.stringify({ sprites, timeline, score, code: code["film.js"], stats }) +
    ";\n",
);
console.log("out/data.js", stats);

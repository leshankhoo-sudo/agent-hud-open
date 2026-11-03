// Renders the film: synthesizes the score, gathers the data, then draws every
// frame of film.html in headless Chromium and pipes them to ffmpeg.
//
//   node render.mjs                 full film -> out/clawd-one-take.mp4
//   node render.mjs --stills 3,12.5 single frames -> out/stills/*.png
//   node render.mjs --from 30 --to 34 --out out/part.mp4
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
// Playwright is resolved like require() does, so a global install works too.
const { chromium } = createRequire(import.meta.url)("playwright");
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .split("--")
    .filter(Boolean)
    .map((a) => a.trim().split(/\s+/))
    .map(([k, v]) => [k, v ?? true]),
);

if (!args["skip-build"]) {
  execFileSync("python3", [join(here, "score.py")], { stdio: "inherit" });
  execFileSync("node", [join(here, "build.mjs")], { stdio: "inherit" });
}

const W = 1920;
const H = 1080;
const FPS = 30;
const DUR = 64;
const workers = Number(args.workers ?? 4);
const browser = await chromium.launch({
  args: ["--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const url = pathToFileURL(join(here, "film.html")).href + "?render";

async function openPage() {
  const page = await browser.newPage({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(url);
  await page.evaluate(() => window.renderFrame(0, 0));
  return page;
}
async function shoot(page, t, elapsed) {
  await page.evaluate(([t, e]) => window.renderFrame(t, e), [t, elapsed]);
  return page.screenshot({ type: "png", clip: { x: 0, y: 0, width: W, height: H } });
}

const started = Date.now();
const elapsed = () => (Date.now() - started) / 1000;

if (args.stills) {
  mkdirSync(join(here, "out/stills"), { recursive: true });
  const page = await openPage();
  for (const t of String(args.stills).split(",").map(Number)) {
    const png = await shoot(page, t, elapsed());
    writeFileSync(join(here, `out/stills/t${t.toFixed(2).padStart(5, "0")}.png`), png);
    console.log("still", t);
  }
  await browser.close();
  process.exit(0);
}

const from = Number(args.from ?? 0);
const to = Number(args.to ?? DUR);
const first = Math.round(from * FPS);
const last = Math.round(to * FPS);
const output = join(here, args.out ?? "out/clawd-one-take.mp4");
mkdirSync(dirname(output), { recursive: true });

const ffmpeg = spawn(
  "ffmpeg",
  [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
    "-ss", String(from), "-t", String(to - from), "-i", join(here, "out/score.wav"),
    "-map", "0:v", "-map", "1:a",
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-tune", "animation",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    "-c:a", "aac", "-b:a", "192k", "-shortest",
    output,
  ],
  { stdio: ["pipe", "inherit", "inherit"] },
);

const pages = await Promise.all(Array.from({ length: workers }, openPage));
const done = new Map();
let next = first;
let written = first;
const write = (buf) =>
  new Promise((ok) => (ffmpeg.stdin.write(buf) ? ok() : ffmpeg.stdin.once("drain", ok)));

async function worker(page) {
  while (next < last) {
    const f = next++;
    done.set(f, await shoot(page, f / FPS, elapsed()));
    while (done.has(written)) {
      const buf = done.get(written);
      done.delete(written);
      written++;
      await write(buf);
      if (written % 60 === 0)
        console.log(`frame ${written}/${last} · ${elapsed().toFixed(0)} s`);
    }
  }
}
await Promise.all(pages.map(worker));
ffmpeg.stdin.end();
await new Promise((ok) => ffmpeg.on("close", ok));
await browser.close();
console.log(`${output} · ${last - first} frames in ${elapsed().toFixed(1)} s`);

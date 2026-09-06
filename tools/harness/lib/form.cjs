// Synthetic SCARED pages: real form geometry, drawn marks, realistic degradation.
//
// The reference templates in src/assets/reference are the ground truth for both
// geometry and appearance, so every fixture is derived from them rather than
// checked in as a binary.

const fs = require("fs");
const path = require("path");
const { readPNG } = require("./png.cjs");

const REPO = path.resolve(__dirname, "../../..");
const CANON = 2; // box coords are 612x792; the templates are 2x that

function refPath(page) {
  return path.join(REPO, `src/assets/reference/blank_p${page}.png`);
}

// The 41x3 answer-cell boxes, straight from the app's own data file.
function questions() {
  const src = fs.readFileSync(path.join(REPO, "src/data/childQuestionnaireMap.js"), "utf8");
  return eval(src.slice(src.indexOf("["), src.lastIndexOf("]") + 1));
}

function loadGray(page) {
  const img = readPNG(fs.readFileSync(refPath(page)));
  const g = new Uint8Array(img.width * img.height);
  for (let i = 0; i < g.length; i++) {
    g[i] = Math.round(0.299 * img.rgb[i * 3] + 0.587 * img.rgb[i * 3 + 1] + 0.114 * img.rgb[i * 3 + 2]);
  }
  return { w: img.width, h: img.height, g };
}

// ---------------------------------------------------------------- drawing ----
const put = (im, x, y, v) => {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= im.w || y >= im.h) return;
  const i = y * im.w + x;
  im.g[i] = Math.min(im.g[i], v);
};
function dot(im, x, y, v, r) {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= r * r) put(im, x + dx, y + dy, v);
}
function line(im, x1, y1, x2, y2, v, t) {
  const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2);
  for (let i = 0; i <= n; i++) dot(im, x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n, v, t);
}
function ring(im, cx, cy, rad, v, t, jitter = 1.2) {
  for (let a = 0; a < Math.PI * 2; a += 0.02) {
    const rr = rad + (Math.random() - 0.5) * jitter;
    dot(im, cx + Math.cos(a) * rr * 1.15, cy + Math.sin(a) * rr, v, t);
  }
}
const ink = () => 40 + Math.random() * 40;

// People do not fill this form consistently -- it is not a scantron. Every one
// of these must keep reading correctly; several of them broke earlier designs.
const STYLES = {
  circle:    (im, cx, cy) => ring(im, cx, cy, 11, ink(), 1.2),
  fill:      (im, cx, cy) => dot(im, cx, cy, 30 + Math.random() * 30, 7),
  x:         (im, cx, cy) => { for (let t = -8; t <= 8; t += 0.5) { dot(im, cx + t, cy + t, ink(), 1.1); dot(im, cx + t, cy - t, ink(), 1.1); } },
  tick:      (im, cx, cy) => { for (let t = 0; t <= 7; t += 0.5) dot(im, cx - 3.5 + t * 0.5, cy + t * 0.5, 90 + Math.random() * 50, 1);
                               for (let t = 0; t <= 10; t += 0.5) dot(im, cx - 1.75 + t * 0.7, cy + 3.5 - t * 0.8, 90 + Math.random() * 50, 1); },
  strike:    (im, cx, cy) => line(im, cx - 12, cy + 7, cx + 12, cy - 7, ink(), 1.2),
  longline:  (im, cx, cy) => line(im, cx - 40, cy + 2, cx + 40, cy - 2, ink(), 1.3),
  underline: (im, cx, cy) => line(im, cx - 16, cy + 12, cx + 16, cy + 12, ink(), 1.2),
  bigcircle: (im, cx, cy) => ring(im, cx, cy, 19, ink(), 1.3, 2.5),
  scribble:  (im, cx, cy) => { for (let i = 0; i < 14; i++) line(im, cx - 9 + Math.random() * 4, cy - 8 + i, cx + 9 - Math.random() * 4, cy - 7 + i, ink(), 1.3); },
  offcheck:  (im, cx, cy) => STYLES.tick(im, cx + 20, cy + 3),   // beside the target
  farleft:   (im, cx, cy) => STYLES.tick(im, cx - 30, cy),       // hard against the cell edge
};
const STYLE_NAMES = Object.keys(STYLES);

// answers: { question: 0|1|2|null }. style "mixed" rotates through the styles.
function fill(page, answers, style = "circle") {
  const base = loadGray(page);
  const im = { w: base.w, h: base.h, g: Uint8Array.from(base.g) };
  for (const q of questions().filter((q) => q.page === page)) {
    const a = answers[q.question];
    if (a == null) continue;
    const b = q.boxes[a];
    const st = style === "mixed" ? STYLE_NAMES[q.question % STYLE_NAMES.length] : style;
    STYLES[st](im, (b.x + b.width / 2) * CANON, (b.y + b.height / 2) * CANON);
  }
  return im;
}

// ----------------------------------------------------------- degradation ----
const greyCast = (im, k) => ({ ...im, g: im.g.map((v) => Math.round(v * k)) });
function gradient(im, lo, hi) {
  const o = Uint8Array.from(im.g);
  for (let y = 0; y < im.h; y++)
    for (let x = 0; x < im.w; x++) {
      const t = (x / im.w) * 0.6 + (y / im.h) * 0.4;
      o[y * im.w + x] = Math.min(255, Math.round(o[y * im.w + x] * (lo + (hi - lo) * t)));
    }
  return { ...im, g: o };
}
function noise(im, sd) {
  const o = Uint8Array.from(im.g);
  for (let i = 0; i < o.length; i++) {
    const n = (Math.random() + Math.random() + Math.random() - 1.5) * 2 * sd;
    o[i] = Math.max(0, Math.min(255, Math.round(o[i] + n)));
  }
  return { ...im, g: o };
}
function shift(im, dx, dy) {
  const o = new Uint8Array(im.w * im.h).fill(255);
  for (let y = 0; y < im.h; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= im.h) continue;
    for (let x = 0; x < im.w; x++) {
      const sx = x - dx;
      if (sx >= 0 && sx < im.w) o[y * im.w + x] = im.g[sy * im.w + sx];
    }
  }
  return { ...im, g: o };
}
function toRGBA(im) {
  const o = new Uint8ClampedArray(im.w * im.h * 4);
  for (let i = 0; i < im.w * im.h; i++) { o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = im.g[i]; o[i * 4 + 3] = 255; }
  return o;
}
function toRGB(im) {
  const b = Buffer.alloc(im.w * im.h * 3);
  for (let i = 0; i < im.w * im.h; i++) { b[i * 3] = b[i * 3 + 1] = b[i * 3 + 2] = im.g[i]; }
  return b;
}

// Deterministic answer key, so runs are comparable.
function makeTruth(page, seed = 7, blankRate = 0) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const t = {};
  for (const q of questions().filter((q) => q.page === page)) {
    t[q.question] = rnd() < blankRate ? null : Math.floor(rnd() * 3);
  }
  return t;
}

module.exports = { REPO, CANON, refPath, questions, loadGray, fill, STYLES, STYLE_NAMES,
                   greyCast, gradient, noise, shift, toRGBA, toRGB, makeTruth };

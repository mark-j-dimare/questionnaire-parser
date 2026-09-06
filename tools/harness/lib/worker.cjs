// Run the REAL public/cvWorker.js in Node.
//
// The worker is a plain classic worker that expects `importScripts`, `self` and
// `postMessage`; stubbing those in a vm context lets us exercise the shipped file
// (not a copy of its logic) against hundreds of synthetic pages in seconds.
//
// The vendored OpenCV build is CommonJS while the repo is "type": "module", so it
// is copied to a local .cjs on first use.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { REPO, questions, loadGray, toRGBA } = require("./form.cjs");

const OPENCV_CJS = path.join(__dirname, "..", ".opencv.cjs");

// Refresh the local CommonJS copy if the vendored build changed, then load it at
// MODULE scope. Requiring this emscripten bundle lazily from inside an async
// function wedges its runtime at 100% CPU; loading it here is the pattern that
// works.
const OPENCV_SRC = path.join(REPO, "public/opencv.js");
if (!fs.existsSync(OPENCV_CJS) || fs.statSync(OPENCV_SRC).mtimeMs > fs.statSync(OPENCV_CJS).mtimeMs) {
  fs.copyFileSync(OPENCV_SRC, OPENCV_CJS);
}
const cvModule = require(OPENCV_CJS);

// Poll for cv.Mat rather than trusting onRuntimeInitialized -- same reason the
// app itself does (the one-shot callback races).
//
// CRITICAL: resolve with NO VALUE. An emscripten Module is *thenable* (it has a
// .then), so `resolve(cv)` makes the Promise machinery adopt it as a thenable and
// spin forever at 100% CPU -- the await simply never returns. public/cvWorker.js
// gets this right (`resolve()`); anything polling for OpenCV must do the same.
function ready(cv) {
  return new Promise((resolve) => {
    const check = () => {
      if (cv && typeof cv.Mat === "function") resolve();
      else setTimeout(check, 30);
    };
    check();
  });
}

// Mirror src/utils/cvClient.js CONFIG so the harness always tests the values the
// app actually ships, rather than a drifting copy.
function config() {
  const src = fs.readFileSync(path.join(REPO, "src/utils/cvClient.js"), "utf8");
  const block = src.slice(src.indexOf("detect: {"), src.indexOf("boxesByPage"));
  const detect = {};
  for (const m of block.matchAll(/^\s*(\w+):\s*([0-9.]+),/gm)) detect[m[1]] = parseFloat(m[2]);
  const num = (k, d) => {
    const m = src.match(new RegExp(`${k}:\\s*([0-9.]+)`));
    return m ? parseFloat(m[1]) : d;
  };
  const boxesByPage = questions().reduce((a, q) => {
    (a[q.page] = a[q.page] || []).push({ question: q.question, boxes: q.boxes });
    return a;
  }, {});
  return {
    orbFeatures: num("orbFeatures", 1500), ratio: num("ratio", 0.75),
    ransac: num("ransac", 5.0), minInliers: num("minInliers", 18),
    canonScale: 2, detect, boxesByPage,
  };
}

// Returns { cv, post, cfg }. `post(msg)` resolves with the worker's reply.
async function start() {
  await ready(cvModule);
  const cv = cvModule;
  const listener = {};
  const sandbox = {
    self: null, cv, console, setTimeout, clearTimeout,
    ImageData: class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } },
    importScripts: () => {}, // opencv is injected directly
    postMessage: (m) => { if (!(m && m.log)) listener.reply && listener.reply(m); },
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(REPO, "public/cvWorker.js"), "utf8"), sandbox, {
    filename: "cvWorker.js",
  });
  let id = 0;
  const post = (msg) =>
    new Promise((resolve, reject) => {
      listener.reply = resolve;
      Promise.resolve(sandbox.onmessage({ data: { id: ++id, ...msg } })).catch(reject);
    });

  const cfg = config();
  const refs = [0, 1].map((p) => {
    const im = loadGray(p);
    return { width: im.w, height: im.h, buffer: toRGBA(im).buffer };
  });
  const init = await post({ type: "init", refs, cfg });
  if (!init.ok) throw new Error("worker init failed: " + init.error);
  return { cv, post, cfg };
}

// Feed a synthetic page straight through the manual-align path (identity corners),
// which is what the grid overlay uses.
const identityCorners = (im) => [
  { x: 0, y: 0 }, { x: im.w, y: 0 }, { x: im.w, y: im.h }, { x: 0, y: im.h },
];

async function readPage(post, im, pageIndex, corners, dest) {
  return post({
    type: "warp",
    pageIndex,
    corners: corners || identityCorners(im),
    dest,
    page: { width: im.w, height: im.h, buffer: toRGBA(im).buffer },
  });
}

// Compare a worker reply against an answer key.
function grade(detection, truth) {
  let correct = 0, wrong = 0, missed = 0, spurious = 0;
  for (const d of detection) {
    const t = truth[d.question] ?? null;
    if (d.selectedIndex === null && t === null) continue;
    if (d.selectedIndex === null) missed++;
    else if (t === null) spurious++;
    else if (d.selectedIndex === t) correct++;
    else wrong++;
  }
  return { correct, wrong, missed, spurious };
}

module.exports = { start, readPage, grade, identityCorners };

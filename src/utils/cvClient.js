// Main-thread client for the OpenCV worker (public/cvWorker.js). All heavy image
// processing runs in the worker so the UI never freezes. This module manages a
// single worker, a request/response protocol, and the one-time init that ships
// the reference templates + form geometry into the worker.

import { urlToCanvas } from "./imaging";
import { QUESTIONS, REFERENCE_PAGES, CANON_SCALE } from "../data/scaredForm";

const CONFIG = {
  orbFeatures: 1500,
  ratio: 0.75,
  ransac: 5.0,
  minInliers: 18,
  canonScale: CANON_SCALE,
  detect: {
    // Marks are found by DIFFERENCING the aligned page against the blank
    // template, scored inside a small window centred on each printed target.
    // See public/cvWorker.js — these must stay in sync with it (that file is
    // deliberately not bundled, so it cannot import this one).
    inkDelta: 40,        // residual grey (of 255) that counts as new ink
    padPx: 8,            // normalisation area = printed target's bbox grown by this
    cellInsetPx: 3,      // shrink the scored cell by this to clear the table rules
                         // (the bottom rule is immediately adjacent to the cell)
    minBlob: 12,         // ignore new-ink blobs smaller than this (residual speckle)
    tolerancePx: 1,      // template ink dilation; misregistration tolerance.
                         // NB: >1 fills the printed "o" ring into a solid disc
                         // and blinds us to filled-in marks. Do not raise.
    minInk: 0.010,       // absolute floor: fraction of the window that is new ink
    minRatio: 2.5,       // winner must beat the runner-up by this factor
    minMargin: 0.006,    // ...and by this absolute margin
    multiRatio: 0.45,    // runner-up above this fraction of the winner => two marks
    strongInk: 0.030,    // score at which a mark is "unambiguously present"
    searchPx: 8,         // per-row local registration search radius
    minRowQuality: 0.45, // min NCC for a row's local offset to be trusted
    blankMargin: 2.0,    // floor must also exceed p95 of the known-blank cells
                         // (the 2nd/3rd ranked cell of each row) by this factor
    maxStrayBlanks: 3,   // this many known-blank cells carrying ink => the page
                         // is too grainy/misaligned to trust
    maxPageResidual: 0.010, // whole-page unexplained-ink fraction above this =>
                            // the image is too grainy to trust (calibrated below)
    noisyPage: 0.020,    // residual median above this => alignment/scan too poor
  },
  // Answer-cell geometry grouped by page (the worker stays data-agnostic).
  boxesByPage: QUESTIONS.reduce((acc, q) => {
    (acc[q.page] = acc[q.page] || []).push({ question: q.question, boxes: q.boxes });
    return acc;
  }, {}),
};

let worker = null;
let seq = 0;
const waiters = new Map();
let initPromise = null;

function getWorker() {
  if (!worker) {
    const url = (import.meta.env.BASE_URL || "/") + "cvWorker.js";
    worker = new Worker(url);
    worker.onmessage = (e) => {
      if (e.data && e.data.log) {
        console.log("[worker]", e.data.log);
        return;
      }
      const { id } = e.data;
      const w = waiters.get(id);
      if (w) {
        waiters.delete(id);
        w(e.data);
      }
    };
    worker.onerror = (e) => {
      // Fail any in-flight requests so callers don't hang.
      const err = { ok: false, error: e.message || "worker error" };
      waiters.forEach((w) => w(err));
      waiters.clear();
    };
  }
  return worker;
}

function request(payload, transfer = []) {
  const id = ++seq;
  return new Promise((resolve) => {
    waiters.set(id, resolve);
    getWorker().postMessage({ ...payload, id }, transfer);
  });
}

function canvasToImageData(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

// Load reference templates and hand them (plus form geometry) to the worker once.
export function initCv() {
  if (!initPromise) {
    initPromise = (async () => {
      const canvases = await Promise.all(REFERENCE_PAGES.map(urlToCanvas));
      const refs = canvases.map((c) => {
        const img = canvasToImageData(c);
        return { width: img.width, height: img.height, buffer: img.data.buffer };
      });
      const res = await request(
        { type: "init", refs, cfg: CONFIG },
        refs.map((r) => r.buffer)
      );
      if (!res.ok) throw new Error(res.error || "OpenCV worker failed to initialize");
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

// Build a canvas from an aligned-image transfer payload.
function alignedToCanvas(aligned) {
  const canvas = document.createElement("canvas");
  canvas.width = aligned.width;
  canvas.height = aligned.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(aligned.buffer), aligned.width, aligned.height),
    0,
    0
  );
  return canvas;
}

// Auto-align + read one uploaded page (a canvas). Returns a normalized result.
export async function processCanvas(canvas) {
  await initCv();
  const img = canvasToImageData(canvas);
  const res = await request(
    { type: "process", page: { width: img.width, height: img.height, buffer: img.data.buffer } },
    [img.data.buffer]
  );
  return normalize(res);
}

// Manually align one page from 4 corner points, then read it.
// `dest` (optional) is the canonical-space quad the four corners map onto --
// the grid overlay passes the answer-table quad. Omit it for whole-page corners.
export async function warpCanvas(canvas, corners, pageIndex, dest) {
  await initCv();
  const img = canvasToImageData(canvas);
  const res = await request(
    {
      type: "warp",
      pageIndex,
      corners,
      dest,
      page: { width: img.width, height: img.height, buffer: img.data.buffer },
    },
    [img.data.buffer]
  );
  return normalize(res);
}

function normalize(res) {
  if (res.error) throw new Error(res.error);
  return {
    pageIndex: res.pageIndex ?? 0,
    inliers: res.inliers,
    matches: res.matches,
    // photo -> canonical, when auto-alignment produced one. Inverting it gives
    // the photo-space position of the table corners, so the overlay can start
    // from the automatic result instead of a blind default rectangle.
    homography: res.homography || null,
    aligned: res.aligned ? res.aligned : null,
    alignedCanvas: res.aligned ? alignedToCanvas(res.aligned) : null,
    detection: res.detection || [],
    // Page-level read quality from the differencing pass. `noisy` means the
    // blank template did not cancel, i.e. the page is misaligned or too poor to
    // read -- surface that instead of trusting the answers.
    quality: res.quality || null,
    ok: res.ok,
  };
}

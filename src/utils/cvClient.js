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
    darkThreshold: 128,
    minFill: 0.028,
    minRatio: 1.4,
    minMargin: 0.012,
    saturated: 0.5,
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
export async function warpCanvas(canvas, corners, pageIndex) {
  await initCv();
  const img = canvasToImageData(canvas);
  const res = await request(
    {
      type: "warp",
      pageIndex,
      corners,
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
    aligned: res.aligned ? res.aligned : null,
    alignedCanvas: res.aligned ? alignedToCanvas(res.aligned) : null,
    detection: res.detection || [],
    ok: res.ok,
  };
}

// Turn uploaded files (phone photos, scans, or PDFs) into canvases we can align.

import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.js?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Large phone photos are downscaled before alignment. The form is straightened
// to a 1224x1584 canvas regardless, so detail much beyond that doesn't help
// accuracy — but it does make feature detection slower, so we cap it.
const MAX_DIMENSION = 1600;

function fitCanvas(width, height) {
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  return canvas;
}

async function imageFileToCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not decode image"));
      el.src = url;
    });
    const canvas = fitCanvas(img.naturalWidth, img.naturalHeight);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return [canvas];
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function pdfFileToCanvases(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const canvases = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    // ENABLE renders annotations (e.g. stamped marks on digitally-filled forms)
    // onto the canvas, so this same pipeline also reads digital PDFs.
    await page.render({
      canvasContext: ctx,
      viewport,
      annotationMode: pdfjsLib.AnnotationMode.ENABLE,
    }).promise;
    canvases.push(canvas);
  }
  return canvases;
}

// Returns an array of canvases (one per page/photo) for a single uploaded file.
export async function fileToCanvases(file) {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return pdfFileToCanvases(file);
  }
  if (file.type.startsWith("image/")) {
    return imageFileToCanvas(file);
  }
  throw new Error(`Unsupported file type: ${file.type || file.name}`);
}

// Load one of the bundled reference (blank-form) images into a canvas.
export async function urlToCanvas(url) {
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not load reference image"));
    el.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return canvas;
}

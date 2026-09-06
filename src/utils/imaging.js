// Turn uploaded files (phone photos, scans, or PDFs) into canvases we can align.

import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.js?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Large phone photos are downscaled before alignment. The form is straightened
// to a 1224x1584 canvas, so there is no point keeping much more detail than
// that -- but there IS a point keeping a little more: a page photographed in
// landscape fills only part of the frame, so at the old 1600 cap the form
// itself landed around 1000px tall and had to be UPSAMPLED into the canonical
// size, smearing 2px pen strokes. 2200 keeps the worst case near 1:1.
const MAX_DIMENSION = 2200;

const PDF_EXT = /\.pdf$/i;
const HEIC_EXT = /\.(heic|heif)$/i;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|avif|tiff?|heic|heif)$/i;

const extOf = (name = "") => (name.match(/\.([a-z0-9]+)$/i)?.[1] || "").toUpperCase();

function looksLikePdf(file) {
  return file.type === "application/pdf" || PDF_EXT.test(file.name || "");
}

function looksLikeHeic(file) {
  const t = (file.type || "").toLowerCase();
  return t === "image/heic" || t === "image/heif" || HEIC_EXT.test(file.name || "");
}

// Mail clients routinely strip or mangle the MIME type and sometimes the
// extension too (an iPhone photo can arrive as application/octet-stream, or
// even named .jpg while still being HEIC). Sniff the ISO-BMFF brand so those
// files are still read instead of being rejected as undecodable.
async function sniffHeic(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (head.length < 12) return false;
    const tag = String.fromCharCode(head[4], head[5], head[6], head[7]);
    if (tag !== "ftyp") return false;
    const brand = String.fromCharCode(head[8], head[9], head[10], head[11]);
    return ["heic", "heix", "heim", "heis", "hevc", "hevm", "hevs", "mif1", "msf1"].includes(brand);
  } catch {
    return false;
  }
}

// The HEIC decoder is a wasm bundle, so it is only fetched if a HEIC actually
// turns up -- everyone else keeps the smaller main bundle.
let heicModule = null;
async function decodeHeic(file) {
  if (!heicModule) heicModule = import("heic-to");
  const { heicTo } = await heicModule;
  return heicTo({ blob: file, type: "bitmap" });
}

function fitCanvas(width, height) {
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  return canvas;
}

// createImageBitmap decodes off the main thread and, with imageOrientation
// "from-image", applies the EXIF rotation explicitly rather than leaving us at
// the mercy of per-browser <img> defaults. The <img> path stays as a fallback.
async function decodeImage(blob) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      // fall through to the <img> path
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

const sizeOf = (src) => ({
  width: src.width || src.naturalWidth,
  height: src.height || src.naturalHeight,
});

async function imageFileToCanvas(file) {
  let source;
  if (looksLikeHeic(file) || (await sniffHeic(file))) {
    try {
      source = await decodeHeic(file);
    } catch (e) {
      throw new Error(
        `"${file.name}" is a HEIC photo and it couldn't be converted (${e.message}). ` +
          `On an iPhone you can switch to Settings → Camera → Formats → "Most Compatible" ` +
          `and re-send the photo as a JPEG.`
      );
    }
  } else {
    try {
      source = await decodeImage(file);
    } catch {
      const ext = extOf(file.name);
      throw new Error(
        `"${file.name}" couldn't be opened${ext ? ` — this browser doesn't read ${ext} images` : ""}. ` +
          `Try re-saving it as a JPEG or PNG.`
      );
    }
  }

  const { width, height } = sizeOf(source);
  if (!width || !height) throw new Error(`"${file.name}" decoded to an empty image.`);
  const canvas = fitCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close?.(); // ImageBitmaps hold memory until released
  return [canvas];
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
  if (looksLikePdf(file)) return pdfFileToCanvases(file);
  // Route on the extension as well as the MIME type: emailed photos often
  // arrive with an empty or generic type, which the old check rejected outright.
  if ((file.type || "").startsWith("image/") || IMAGE_EXT.test(file.name || "")) {
    return imageFileToCanvas(file);
  }
  if (await sniffHeic(file)) return imageFileToCanvas(file);
  throw new Error(
    `"${file.name}" isn't a photo, scan or PDF this app can read` +
      `${file.type ? ` (it looks like ${file.type})` : ""}.`
  );
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

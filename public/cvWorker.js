/* eslint-disable */
/*
 * OpenCV alignment + mark detection, run OFF the main thread so the UI never
 * freezes during the heavy WASM work.
 *
 * Protocol (postMessage):
 *   { type:'init', id, refs:[{width,height,buffer}], cfg }       -> { id, ok }
 *   { type:'process', id, page:{width,height,buffer} }           -> { id, ok, pageIndex, inliers, matches, aligned, detection }
 *   { type:'warp', id, pageIndex, page:{...}, corners:[{x,y}*4]} -> { id, ok, ... }
 * Progress: { progress:'...' } messages may be sent for diagnostics.
 */

let cv = null;
let cfg = null;
// Cached reference templates with precomputed ORB features (per form page).
let refs = [];

try {
  importScripts("/opencv.js");
} catch (e) {
  self.postMessage({ log: "Failed to load opencv.js in worker: " + (e && e.message) });
}

function whenCvReady() {
  return new Promise((resolve) => {
    const check = () => {
      if (self.cv && typeof self.cv.Mat === "function") {
        cv = self.cv;
        resolve();
      } else {
        setTimeout(check, 30);
      }
    };
    check();
  });
}

function matFromBuf(buffer, width, height) {
  const img = new ImageData(new Uint8ClampedArray(buffer), width, height);
  return cv.matFromImageData(img); // CV_8UC4 RGBA
}

function toGray(mat) {
  const g = new cv.Mat();
  cv.cvtColor(mat, g, cv.COLOR_RGBA2GRAY);
  return g;
}

function orbFeatures(gray) {
  const orb = new cv.ORB(cfg.orbFeatures);
  const kp = new cv.KeyPointVector();
  const des = new cv.Mat();
  orb.detectAndCompute(gray, new cv.Mat(), kp, des);
  orb.delete();
  return { kp, des };
}

function doInit(msg) {
  cfg = msg.cfg;
  refs.forEach((r) => {
    r.gray.delete();
    r.kp.delete();
    r.des.delete();
  });
  refs = msg.refs.map((r) => {
    const mat = matFromBuf(r.buffer, r.width, r.height);
    const gray = toGray(mat);
    mat.delete();
    const { kp, des } = orbFeatures(gray);
    return { gray, kp, des, width: r.width, height: r.height };
  });
}

// Align `photo` (RGBA Mat) to reference `r` using cached ref features.
// Returns { inliers, matches, alignedMat|null }.
function alignToRef(photo, photoKp, photoDes, r) {
  if (photoDes.rows < 4 || r.des.rows < 4) return { inliers: 0, matches: 0, alignedMat: null };
  const bf = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const knn = new cv.DMatchVectorVector();
  bf.knnMatch(photoDes, r.des, knn, 2);
  const src = [];
  const dst = [];
  for (let i = 0; i < knn.size(); i++) {
    const pair = knn.get(i);
    if (pair.size() < 2) continue;
    const m = pair.get(0);
    const n = pair.get(1);
    if (m.distance < cfg.ratio * n.distance) {
      const p = photoKp.get(m.queryIdx).pt;
      const q = r.kp.get(m.trainIdx).pt;
      src.push(p.x, p.y);
      dst.push(q.x, q.y);
    }
  }
  knn.delete();
  bf.delete();
  const matches = src.length / 2;
  if (matches < 4) return { inliers: 0, matches, alignedMat: null };

  const srcM = cv.matFromArray(matches, 1, cv.CV_32FC2, src);
  const dstM = cv.matFromArray(matches, 1, cv.CV_32FC2, dst);
  const mask = new cv.Mat();
  const H = cv.findHomography(srcM, dstM, cv.RANSAC, cfg.ransac, mask);
  srcM.delete();
  dstM.delete();
  let inliers = 0;
  if (H && H.rows === 3 && H.cols === 3) {
    for (let i = 0; i < mask.rows; i++) inliers += mask.data[i];
  }
  mask.delete();
  if (!inliers) {
    if (H) H.delete();
    return { inliers: 0, matches, alignedMat: null };
  }
  const aligned = new cv.Mat();
  cv.warpPerspective(
    photo,
    aligned,
    H,
    new cv.Size(r.width, r.height),
    cv.INTER_LINEAR,
    cv.BORDER_CONSTANT,
    new cv.Scalar(255, 255, 255, 255)
  );
  H.delete();
  return { inliers, matches, alignedMat: aligned };
}

function warpFromCorners(photo, corners, pageIndex) {
  const r = refs[pageIndex];
  const from = cv.matFromArray(
    4,
    1,
    cv.CV_32FC2,
    corners.flatMap((c) => [c.x, c.y])
  );
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0, r.width, 0, r.width, r.height, 0, r.height,
  ]);
  const H = cv.getPerspectiveTransform(from, to);
  const aligned = new cv.Mat();
  cv.warpPerspective(
    photo,
    aligned,
    H,
    new cv.Size(r.width, r.height),
    cv.INTER_LINEAR,
    cv.BORDER_CONSTANT,
    new cv.Scalar(255, 255, 255, 255)
  );
  from.delete();
  to.delete();
  H.delete();
  return aligned;
}

function darkFraction(grayData, W, box, scale) {
  const x = Math.round(box.x * scale);
  const y = Math.round(box.y * scale);
  const w = Math.round(box.width * scale);
  const h = Math.round(box.height * scale);
  let dark = 0;
  let total = 0;
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      total++;
      if (grayData[yy * W + xx] < cfg.detect.darkThreshold) dark++;
    }
  }
  return total ? dark / total : 0;
}

function detectAnswers(alignedMat, pageIndex) {
  const gray = toGray(alignedMat);
  const W = gray.cols;
  const data = gray.data; // Uint8, length W*H
  const P = cfg.detect;
  const out = cfg.boxesByPage[pageIndex].map((q) => {
    const scores = q.boxes.map((b) => darkFraction(data, W, b, cfg.canonScale));
    const ranked = scores.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
    const top = ranked[0];
    const sec = ranked[1];
    const win =
      top.v >= P.minFill &&
      top.v >= sec.v * P.minRatio &&
      top.v - sec.v >= P.minMargin &&
      sec.v < P.saturated;
    const selectedIndex = win ? top.i : null;
    const confidence = top.v > 0 ? Math.max(0, (top.v - sec.v) / top.v) : 0;
    return { question: q.question, scores, selectedIndex, confidence };
  });
  gray.delete();
  return out;
}

function alignedToTransfer(alignedMat) {
  // alignedMat is already RGBA (CV_8UC4) from warpPerspective of the RGBA photo.
  // Copy its bytes out of the WASM heap into an owned, transferable buffer.
  const buffer = new Uint8ClampedArray(alignedMat.data).buffer;
  return { width: alignedMat.cols, height: alignedMat.rows, buffer };
}

function doProcess(msg) {
  const photo = matFromBuf(msg.page.buffer, msg.page.width, msg.page.height);
  const pgray = toGray(photo);
  const { kp, des } = orbFeatures(pgray);

  let best = null;
  for (let i = 0; i < refs.length; i++) {
    const a = alignToRef(photo, kp, des, refs[i]);
    if (!best || a.inliers > best.inliers) {
      if (best && best.alignedMat) best.alignedMat.delete();
      best = { i, ...a };
    } else if (a.alignedMat) {
      a.alignedMat.delete();
    }
  }
  kp.delete();
  des.delete();
  pgray.delete();
  photo.delete();

  if (!best || !best.alignedMat) {
    return { ok: false, pageIndex: best ? best.i : 0, inliers: 0, matches: best ? best.matches : 0 };
  }
  const detection = detectAnswers(best.alignedMat, best.i);
  const aligned = alignedToTransfer(best.alignedMat);
  best.alignedMat.delete();
  return {
    ok: best.inliers >= cfg.minInliers,
    pageIndex: best.i,
    inliers: best.inliers,
    matches: best.matches,
    aligned,
    detection,
  };
}

function doWarp(msg) {
  const photo = matFromBuf(msg.page.buffer, msg.page.width, msg.page.height);
  const alignedMat = warpFromCorners(photo, msg.corners, msg.pageIndex);
  photo.delete();
  const detection = detectAnswers(alignedMat, msg.pageIndex);
  const aligned = alignedToTransfer(alignedMat);
  alignedMat.delete();
  return { ok: true, pageIndex: msg.pageIndex, inliers: null, matches: null, aligned, detection };
}

let ready = false;
self.onmessage = async (e) => {
  const msg = e.data;
  if (!ready) {
    await whenCvReady();
    ready = true;
  }
  try {
    let result;
    if (msg.type === "init") result = (doInit(msg), { ok: true });
    else if (msg.type === "process") result = doProcess(msg);
    else if (msg.type === "warp") result = doWarp(msg);
    else result = { ok: false, error: "unknown message type" };

    const transfer = result.aligned ? [result.aligned.buffer] : [];
    self.postMessage({ id: msg.id, ...result }, transfer);
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String((err && err.message) || err) });
  }
};

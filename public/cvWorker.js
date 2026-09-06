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
  const noMask = new cv.Mat();
  orb.detectAndCompute(gray, noMask, kp, des);
  noMask.delete(); // leaked in the original: one wasm-heap Mat per call
  orb.delete();
  return { kp, des };
}

/* ---------------------------------------------------------------------------
 * Mark detection by TEMPLATE DIFFERENCING.
 *
 * The old approach counted pixels darker than a fixed grey inside each answer
 * cell. That cannot work on this form: the printed target is the letter "o", so
 * a *blank* cell already scores 0.0144-0.0181 against a 0.028 gate, the blank
 * baseline varies 26% between columns of one row, and the table rules sit 0-4px
 * outside the cell, so a few px of misregistration adds up to +0.057 -- twice
 * the entire threshold budget.
 *
 * Instead: flat-field the page (removes shadow/exposure), subtract the blank
 * template's ink (removes the printed "o", the rules and the text), and measure
 * what is left inside a small window centred on each printed target. A blank
 * cell then scores ~0.000 and a mark scores 0.02-0.27.
 *
 * IMPORTANT opencv.js gotchas relied on below:
 *   - Mat.clone() ALIASES the source data in this build. Use copyTo(new Mat).
 *   - srcRoi.copyTo(dstRoi) is a no-op; write sub-rects via data.set().
 * ------------------------------------------------------------------------- */

// Divide out the illumination field so paper reads ~250 whatever the lighting.
function flatField(gray) {
  const small = new cv.Mat();
  cv.resize(gray, small, new cv.Size(gray.cols >> 2, gray.rows >> 2), 0, 0, cv.INTER_AREA);
  const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(9, 9));
  const bgS = new cv.Mat();
  // MORPH_CLOSE at 1/4 scale removes every dark structure narrower than ~36px
  // full-scale (text, rules, pen marks), leaving only the lighting.
  cv.morphologyEx(small, bgS, cv.MORPH_CLOSE, k);
  const bg = new cv.Mat();
  cv.resize(bgS, bg, new cv.Size(gray.cols, gray.rows), 0, 0, cv.INTER_CUBIC);
  const flat = new cv.Mat();
  cv.divide(gray, bg, flat, 250);
  small.delete(); k.delete(); bgS.delete(); bg.delete();
  return flat;
}

// Ink map: high where the page is darker than its local paper level.
// The 3x3 median kills sensor/JPEG speckle while leaving thin pen strokes
// intact -- unlike a morphological opening, which erases them. Applied to the
// template too, so both sides of the subtraction are filtered identically.
function inkOf(gray) {
  const flat = flatField(gray);
  const ink = new cv.Mat();
  cv.bitwise_not(flat, ink);
  cv.medianBlur(ink, ink, 3);
  flat.delete();
  return ink;
}

// The template's ink, dilated by `tol` px so small misregistration still cancels.
function refInkDilated(refGray, tol) {
  const ink = inkOf(refGray);
  if (tol <= 0) return ink;
  const d = 2 * tol + 1;
  const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(d, d));
  const dil = new cv.Mat();
  cv.dilate(ink, dil, k);
  ink.delete(); k.delete();
  return dil;
}

// Per answer cell, work out (a) the region we COUNT new ink in -- the whole
// cell, inset to clear the table rules -- and (b) the area we NORMALISE by,
// derived from the printed target's bbox grown by `pad`.
//
// Counting over the whole cell matters because people do not mark consistently:
// checks land beside the target, lines get drawn through or under it, circles
// are drawn far larger than it. Scoring only a window around the printed "o"
// missed all of those. Normalising by the small window area (rather than the
// ~3x larger cell) keeps the dynamic range wide, so a faint mark anywhere in
// the cell still scores well clear of the noise floor.
function cellRegions(refGray, boxes, pad, inset, canon) {
  const ink = inkOf(refGray);
  const W = ink.cols, D = ink.data;
  const out = boxes.map((q) => ({
    question: q.question,
    cells: q.boxes.map((b) => {
      const x0 = Math.round(b.x * canon), y0 = Math.round(b.y * canon);
      const w0 = Math.round(b.width * canon), h0 = Math.round(b.height * canon);
      let minx = Infinity, miny = Infinity, maxx = -1, maxy = -1;
      for (let y = y0 + 2; y < y0 + h0 - 2; y++) {
        for (let x = x0 + 2; x < x0 + w0 - 2; x++) {
          if (D[y * W + x] > 60) {
            if (x < minx) minx = x;
            if (x > maxx) maxx = x;
            if (y < miny) miny = y;
            if (y > maxy) maxy = y;
          }
        }
      }
      if (maxx < 0) { const cx = x0 + w0 / 2, cy = y0 + h0 / 2; minx = cx - 6; maxx = cx + 6; miny = cy - 6; maxy = cy + 6; }
      const normArea = Math.max(1,
        (Math.round(maxx - minx) + 1 + 2 * pad) * (Math.round(maxy - miny) + 1 + 2 * pad));
      return {
        x: x0 + inset, y: y0 + inset,
        width: Math.max(1, w0 - 2 * inset), height: Math.max(1, h0 - 2 * inset),
        normArea,
      };
    }),
  }));
  ink.delete();
  return out;
}

// One template strip per question row, used for local re-registration.
function rowStrips(refFlat, boxes, canon, searchPx) {
  return boxes.map((q) => {
    const ys = q.boxes.map((b) => Math.round(b.y * canon));
    const hs = q.boxes.map((b) => Math.round(b.height * canon));
    const y0 = Math.min.apply(null, ys);
    const y1 = Math.max.apply(null, ys.map((v, i) => v + hs[i]));
    const y = Math.max(searchPx, y0);
    const rect = new cv.Rect(260, y, 880, Math.min(y1 - y0, refFlat.rows - y - searchPx));
    const view = refFlat.roi(rect);
    const strip = new cv.Mat();
    view.copyTo(strip); // clone() would alias refFlat
    view.delete();
    // The question-text half of the band: template content only, never a mark,
    // and it IS row-registered -- so leftover ink here is pure image noise.
    const firstCellX = Math.min.apply(null, q.boxes.map((b) => Math.round(b.x * canon)));
    const noiseRect = new cv.Rect(rect.x, rect.y, Math.max(1, firstCellX - 10 - rect.x), rect.height);
    return { question: q.question, rect, noiseRect, strip };
  });
}

// Locate each row strip in the page over +/- searchPx. Absorbs page curl and
// residual perspective that one global homography cannot.
function rowOffsets(pageFlat, strips, searchPx, minQuality) {
  const raw = strips.map(({ rect, strip }) => {
    const hx = rect.x - searchPx, hy = rect.y - searchPx;
    const hw = rect.width + 2 * searchPx, hh = rect.height + 2 * searchPx;
    if (hx < 0 || hy < 0 || hx + hw > pageFlat.cols || hy + hh > pageFlat.rows) {
      return { dx: 0, dy: 0, q: 0 };
    }
    const hay = pageFlat.roi(new cv.Rect(hx, hy, hw, hh));
    const res = new cv.Mat();
    cv.matchTemplate(hay, strip, res, cv.TM_CCOEFF_NORMED);
    const mm = cv.minMaxLoc(res);
    const o = { dx: mm.maxLoc.x - searchPx, dy: mm.maxLoc.y - searchPx, q: mm.maxVal };
    hay.delete(); res.delete();
    return o;
  });
  const good = raw.filter((r) => r.q >= minQuality);
  const mdx = medianOf(good.map((r) => r.dx));
  const mdy = medianOf(good.map((r) => r.dy));
  return raw.map((r) => {
    const ok = r.q >= minQuality &&
      Math.abs(r.dx) <= searchPx && Math.abs(r.dy) <= searchPx &&
      Math.abs(r.dx - mdx) <= 5 && Math.abs(r.dy - mdy) <= 5;
    return ok ? r : { dx: mdx, dy: mdy, q: r.q, filled: true };
  });
}

function medianOf(a) {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s[s.length >> 1];
}

// Rebuild the page with each row band shifted into template registration.
function applyRowOffsets(gray, strips, offs) {
  const fixed = new cv.Mat();
  gray.copyTo(fixed); // NB: gray.clone() would alias gray in this build
  const src = gray.data, dst = fixed.data, W = gray.cols;
  strips.forEach((s, i) => {
    const dx = offs[i].dx, dy = offs[i].dy;
    if (!dx && !dy) return;
    const r = s.rect;
    const sx = r.x + dx, sy = r.y + dy;
    if (sx < 0 || sy < 0 || sx + r.width > gray.cols || sy + r.height > gray.rows) return;
    for (let yy = 0; yy < r.height; yy++) {
      const so = (sy + yy) * W + sx;
      dst.set(src.subarray(so, so + r.width), (r.y + yy) * W + r.x);
    }
  });
  return fixed;
}

// Binary map of ink the blank form does not explain.
function residualMask(gray, inkRefDil, inkDelta) {
  const ink = inkOf(gray);
  const resid = new cv.Mat();
  cv.subtract(ink, inkRefDil, resid); // 8U saturating: >0 only where page ink is new
  const mask = new cv.Mat();
  cv.threshold(resid, mask, inkDelta, 255, cv.THRESH_BINARY);
  ink.delete(); resid.delete();
  // NB: a MORPH_OPEN here looks like the obvious despeckle, but it destroys the
  // very marks we need -- a drawn underline lost 100% of its pixels and a line
  // through the target lost 86%. Speckle is removed by blob area instead (see
  // countInk), which keeps thin strokes intact.
  return mask;
}

// New-ink pixels inside `rect`, ignoring blobs smaller than `minBlob` so sensor
// and JPEG speckle does not register while real strokes survive.
function countInk(mask, rect, minBlob) {
  const roi = mask.roi(rect);
  const labels = new cv.Mat(), stats = new cv.Mat(), cent = new cv.Mat();
  let px = 0;
  const n = cv.connectedComponentsWithStats(roi, labels, stats, cent, 8, cv.CV_32S);
  for (let i = 1; i < n; i++) {
    const a = stats.intAt(i, cv.CC_STAT_AREA);
    if (a >= minBlob) px += a;
  }
  roi.delete(); labels.delete(); stats.delete(); cent.delete();
  return px;
}

function doInit(msg) {
  cfg = msg.cfg;
  refs.forEach((r) => {
    r.gray.delete();
    r.kp.delete();
    r.des.delete();
    if (r.inkDil) r.inkDil.delete();
    if (r.strips) r.strips.forEach((st) => st.strip.delete());
  });
  refs = msg.refs.map((r, i) => {
    const mat = matFromBuf(r.buffer, r.width, r.height);
    const gray = toGray(mat);
    mat.delete();
    const { kp, des } = orbFeatures(gray);
    const P = cfg.detect;
    const boxes = cfg.boxesByPage[i] || [];
    const flat = flatField(gray);
    const strips = rowStrips(flat, boxes, cfg.canonScale, P.searchPx);
    flat.delete(); // strips own copies; nothing else needs the flat reference
    return {
      gray, kp, des, width: r.width, height: r.height,
      inkDil: refInkDilated(gray, P.tolerancePx),
      cells: cellRegions(gray, boxes, P.padPx, P.cellInsetPx, cfg.canonScale),
      strips,
    };
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

function detectAnswers(alignedMat, pageIndex) {
  const r = refs[pageIndex];
  const P = cfg.detect;
  const gray = toGray(alignedMat);

  // 1. Re-register each answer row locally (absorbs curl / residual perspective).
  const pageFlat = flatField(gray);
  const offsets = rowOffsets(pageFlat, r.strips, P.searchPx, P.minRowQuality);
  pageFlat.delete();
  const fixed = applyRowOffsets(gray, r.strips, offsets);
  gray.delete();

  // 2. Difference against the blank template.
  const mask = residualMask(fixed, r.inkDil, P.inkDelta);
  fixed.delete();

  // 3a. Graininess: unexplained ink in the QUESTION-TEXT part of each answer
  //     row. That area is row-registered like the cells, and it can never hold
  //     a mark -- so anything left there is image noise. This is the one signal
  //     that separates "a faint mark" from "a grainy image that happens to put
  //     a blob in a cell"; per-cell statistics cannot, because the two have the
  //     same magnitude. Measuring the whole page instead would false-alarm on
  //     any shifted page, since only the row bands get re-registered.
  let noisePx = 0, noiseArea = 0;
  r.strips.forEach((st) => {
    const nr = st.noiseRect;
    if (nr.width <= 0 || nr.height <= 0) return;
    const roi = mask.roi(nr);
    noisePx += cv.countNonZero(roi);
    noiseArea += nr.width * nr.height;
    roi.delete();
  });
  const pageResidual = noiseArea ? noisePx / noiseArea : 0;

  // 3b. Score every cell.
  const scored = r.cells.map((q) => ({
    question: q.question,
    scores: q.cells.map((c) => {
      if (c.width <= 0 || c.height <= 0) return 0;
      const px = countInk(mask, new cv.Rect(c.x, c.y, c.width, c.height), P.minBlob);
      return Math.min(1, px / c.normArea);
    }),
  }));
  mask.delete();

  // 4. Page-wide noise floor. Only one cell per row can be the answer, so the
  //    2nd- and 3rd-ranked cells of every row are GUARANTEED blank -- 82 known
  //    blank samples per page. Their upper tail is a direct measurement of what
  //    "unmarked" scores on this particular image, which a median/MAD over all
  //    123 cells cannot give (on a clean page both collapse to zero, leaving no
  //    headroom, and a very noisy page then produces phantom answers).
  const all = [];
  scored.forEach((q) => q.scores.forEach((v) => all.push(v)));
  const blanks = [];
  scored.forEach((q) => {
    const r = q.scores.slice().sort((a, b) => b - a);
    for (let i = 1; i < r.length; i++) blanks.push(r[i]);
  });
  blanks.sort((a, b) => a - b);
  const blankP95 = blanks.length ? blanks[Math.min(blanks.length - 1, Math.floor(blanks.length * 0.95))] : 0;
  const med = medianOf(all);
  const mad = medianOf(all.map((v) => Math.abs(v - med)));
  const floor = Math.max(
    P.minInk,
    med + 6 * (1.4826 * mad + 1e-6),
    blankP95 * P.blankMargin
  );

  const detection = scored.map(({ question, scores }) => {
    const ranked = scores.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
    const top = ranked[0], sec = ranked[1];
    const multi = sec.v >= floor && sec.v >= P.multiRatio * top.v;
    const win =
      top.v >= floor &&
      top.v >= P.minRatio * sec.v &&
      top.v - sec.v >= P.minMargin &&
      !multi;
    // Confidence folds in absolute strength, not just separation: the old
    // (top-sec)/top returned 1.0 for a barely-there mark with a clean runner-up,
    // so marginal reads were never flagged for review.
    const separation = top.v > 0 ? (top.v - sec.v) / top.v : 0;
    const strength = Math.min(1, top.v / P.strongInk);
    return {
      question,
      scores,
      selectedIndex: win ? top.i : null,
      confidence: separation * strength,
      reason: win ? null : multi ? "multiple-marks" : top.v < floor ? "no-mark" : "ambiguous",
    };
  });

  // How many GUARANTEED-blank cells still carry ink? On a clean page this is 0.
  // A couple means the respondent left stray marks or corrected an answer; a
  // handful means the image is too grainy (or too misaligned) to trust, which
  // the median residual alone does not catch when the grain lands in only a few
  // cells.
  const blanksAboveFloor = blanks.filter((v) => v >= floor).length;

  const rowQuality = offsets.map((o) => o.q);
  return {
    detection,
    quality: {
      residualMedian: med,
      residualMad: mad,
      floor,
      blankP95,
      // The single most useful derived signal: if the template is not
      // cancelling, the page is misaligned or too poor to read -- say so
      // instead of silently reporting 41 answers.
      blanksAboveFloor,
      pageResidual,
      noisy:
        med > P.noisyPage ||
        blanksAboveFloor >= P.maxStrayBlanks ||
        pageResidual > P.maxPageResidual,
      rowQualityMin: Math.min.apply(null, rowQuality),
      rowQualityMedian: medianOf(rowQuality),
      rowsFilled: offsets.filter((o) => o.filled).length,
      marksFound: detection.filter((d) => d.selectedIndex !== null).length,
    },
  };
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
  const det = detectAnswers(best.alignedMat, best.i);
  const aligned = alignedToTransfer(best.alignedMat);
  best.alignedMat.delete();
  return {
    ok: best.inliers >= cfg.minInliers,
    pageIndex: best.i,
    inliers: best.inliers,
    matches: best.matches,
    aligned,
    detection: det.detection,
    quality: det.quality,
  };
}

function doWarp(msg) {
  const photo = matFromBuf(msg.page.buffer, msg.page.width, msg.page.height);
  const alignedMat = warpFromCorners(photo, msg.corners, msg.pageIndex);
  photo.delete();
  const det = detectAnswers(alignedMat, msg.pageIndex);
  const aligned = alignedToTransfer(alignedMat);
  alignedMat.delete();
  return {
    ok: true, pageIndex: msg.pageIndex, inliers: null, matches: null,
    aligned, detection: det.detection, quality: det.quality,
  };
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

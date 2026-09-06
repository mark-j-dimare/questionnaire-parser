// 4-point perspective transform + image warp, in plain JS.
//
// Used to synthesise "photographed at an angle" fixtures without pulling OpenCV
// into fixture generation. Mirrors src/utils/homography.js (which the app uses on
// the main thread) so the two stay conceptually in step.

function homography(from, to) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i], { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const n = 8, m = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-10) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      if (f) for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  const h = m.map((r, i) => r[n] / m[i][i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

const apply = (H, p) => {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
};

// Warp `im` so its four corners land on `quad`, on a `bg`-coloured canvas of the
// same size. Returns { image, mapPoint } — mapPoint takes a source-image point to
// where it ended up, which is how the table corners are recorded for the drag test.
function warpToQuad(im, quad, bg = 225) {
  const src = [{ x: 0, y: 0 }, { x: im.w, y: 0 }, { x: im.w, y: im.h }, { x: 0, y: im.h }];
  const H = homography(src, quad);
  const Hinv = homography(quad, src); // inverse map, for pulling each output pixel
  const g = new Uint8Array(im.w * im.h).fill(bg);
  for (let y = 0; y < im.h; y++) {
    for (let x = 0; x < im.w; x++) {
      const s = apply(Hinv, { x: x + 0.5, y: y + 0.5 });
      const sx = Math.round(s.x - 0.5), sy = Math.round(s.y - 0.5);
      if (sx >= 0 && sy >= 0 && sx < im.w && sy < im.h) g[y * im.w + x] = im.g[sy * im.w + sx];
    }
  }
  return { image: { w: im.w, h: im.h, g }, mapPoint: (p) => apply(H, p) };
}

module.exports = { homography, apply, warpToQuad };

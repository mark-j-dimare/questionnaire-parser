// Pure-JS 4-point perspective transform.
//
// The grid overlay draws the answer cells on top of the user's own photo, which
// happens on the main thread where OpenCV is not available (it lives in the
// worker). That only needs a 4-point homography and a point projection, so it
// is done here rather than paying a round-trip to the worker on every drag.

// Solve for H mapping the four `from` points onto the four `to` points.
// Returns a 9-element row-major matrix, or null if the quad is degenerate.
export function homographyFromQuads(from, to) {
  // Each correspondence gives two rows of A·h = b, with h33 fixed at 1.
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve8(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

// Gaussian elimination with partial pivoting on the 8x8 system.
function solve8(A, b) {
  const n = 8;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    }
    if (Math.abs(m[piv][col]) < 1e-10) return null; // degenerate
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      if (!f) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / m[i][i]);
}

export function applyH(H, pt) {
  const { x, y } = pt;
  const w = H[6] * x + H[7] * y + H[8];
  if (!w) return { x: 0, y: 0 };
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
}

// Project a canonical-space rect to a photo-space polygon (it is a quadrilateral
// once perspective is applied, not a rect).
export function projectRect(H, r) {
  return [
    applyH(H, { x: r.x, y: r.y }),
    applyH(H, { x: r.x + r.width, y: r.y }),
    applyH(H, { x: r.x + r.width, y: r.y + r.height }),
    applyH(H, { x: r.x, y: r.y + r.height }),
  ];
}

export function invertH(H) {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!det) return null;
  const inv = [
    A, c * h - b * i, b * f - c * e,
    B, a * i - c * g, c * d - a * f,
    C, b * g - a * h, a * e - b * d,
  ].map((v) => v / det);
  return inv.map((v) => v / inv[8]);
}

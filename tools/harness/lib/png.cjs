// Minimal PNG reader/writer for 8-bit RGB, non-interlaced. No deps.
const zlib = require("zlib");

function readPNG(buf) {
  let o = 8, idat = [], ihdr = null;
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString("ascii", o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), bd: data[8], ct: data[9], il: data[12] };
    if (type === "IDAT") idat.push(data);
    o += 12 + len;
  }
  if (!ihdr || ihdr.bd !== 8 || ihdr.ct !== 2 || ihdr.il !== 0) throw new Error("only 8-bit RGB non-interlaced: " + JSON.stringify(ihdr));
  const { w, h } = ihdr;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 3, stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = (prev && x >= bpp) ? prev[x - bpp] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
  }
  return { width: w, height: h, rgb: out };
}

function writePNG(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

let T = null;
function crc32(buf) {
  if (!T) { T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c; } }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = T[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

// RGB -> RGBA (what cv.matFromImageData wants)
function toRGBA(width, height, rgb) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += 3) {
    out[i * 4] = rgb[j]; out[i * 4 + 1] = rgb[j + 1]; out[i * 4 + 2] = rgb[j + 2]; out[i * 4 + 3] = 255;
  }
  return out;
}
module.exports = { readPNG, writePNG, toRGBA };

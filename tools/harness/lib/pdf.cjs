// Minimal PDF writers for test fixtures. No dependencies -- these build the
// exact shapes that broke the app, which is hard to get from a generic library:
//
//  - a scanned page (JPEG in a PDF), at Letter or A4
//  - a multi-page file, in any page order, including the same page twice
//  - an AcroForm with checkbox widgets over the answer cells, WITH and WITHOUT
//    /AP appearance streams. The "without" case renders completely blank while
//    still carrying every answer -- that is the case pdfExtract.js exists for.

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PT_W = 612, PT_H = 792;

function jpegSize(j) {
  let i = 2;
  while (i < j.length) {
    if (j[i] !== 0xff) { i++; continue; }
    const m = j[i + 1];
    if (m >= 0xc0 && m <= 0xc2) return { w: j.readUInt16BE(i + 7), h: j.readUInt16BE(i + 5) };
    if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7)) i += 2;
    else i += 2 + j.readUInt16BE(i + 2);
  }
  throw new Error("not a JPEG");
}

// macOS ships `sips`, so fixtures need no image-encoding dependency.
function pngToJpeg(pngBuffer, quality = 88) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scared-"));
  const inp = path.join(dir, "in.png"), out = path.join(dir, "out.jpg");
  fs.writeFileSync(inp, pngBuffer);
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", String(quality), inp, "--out", out], { stdio: "ignore" });
  const j = fs.readFileSync(out);
  fs.rmSync(dir, { recursive: true, force: true });
  return j;
}

function serialize(objects, rootId) {
  const ids = Object.keys(objects).map(Number).sort((a, b) => a - b);
  const remap = {}; ids.forEach((k, i) => (remap[k] = i + 1));
  let out = Buffer.from("%PDF-1.6\n");
  const offsets = {};
  for (const k of ids) {
    const body = objects[k].replace(/(\d+) 0 R/g, (m, n) =>
      remap[+n] ? `${remap[+n]} 0 R` : m
    );
    offsets[remap[k]] = out.length;
    out = Buffer.concat([out, Buffer.from(`${remap[k]} 0 obj\n`), Buffer.from(body, "binary"), Buffer.from("\nendobj\n")]);
  }
  const xref = out.length, n = ids.length + 1;
  let tail = `xref\n0 ${n}\n0000000000 65535 f \n`;
  for (let i = 1; i < n; i++) tail += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  tail += `trailer\n<< /Size ${n} /Root ${remap[rootId]} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.concat([out, Buffer.from(tail, "binary")]);
}

// pages: [{ jpeg, widgets? }]. widgets: [{rect:[x0,y0,x1,y1] (y-up), on, name}]
function buildPdf(pages, { pageSize = [PT_W, PT_H], withAppearance = true } = {}) {
  const [W, H] = pageSize;
  const objs = {}; let next = 10;
  const add = (body) => { objs[next] = body; return next++; };
  const kids = [], fields = [];
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  for (const pg of pages) {
    const { w, h } = jpegSize(pg.jpeg);
    const im = add(
      `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB ` +
      `/BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n` +
      pg.jpeg.toString("binary") + "\nendstream"
    );
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    const ct = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const annots = [];
    for (const wdg of pg.widgets || []) {
      let ap = "";
      if (withAppearance) {
        const strm = "q 0 0 0 rg BT /Helv 12 Tf 1 0 0 1 6 3 Tm (X) Tj ET Q";
        const apn = add(
          `<< /Type /XObject /Subtype /Form /BBox [0 0 ${Math.round(wdg.rect[2] - wdg.rect[0])} ` +
          `${Math.round(wdg.rect[3] - wdg.rect[1])}] /Resources << /Font << /Helv ${font} 0 R >> >> ` +
          `/Length ${strm.length} >>\nstream\n${strm}\nendstream`
        );
        ap = `/AP << /N << /Yes ${apn} 0 R >> >> `;
      }
      const st = wdg.on ? "Yes" : "Off";
      annots.push(add(
        `<< /Type /Annot /Subtype /Widget /FT /Btn /T (${wdg.name}) /Rect ` +
        `[${wdg.rect.map((v) => v.toFixed(1)).join(" ")}] ${ap}/V /${st} /AS /${st} >>`
      ));
    }
    fields.push(...annots);
    const annotStr = annots.length ? " /Annots [" + annots.map((a) => `${a} 0 R`).join(" ") + "]" : "";
    kids.push(add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${im} 0 R >> ` +
      `/Font << /Helv ${font} 0 R >> >> /Contents ${ct} 0 R${annotStr} >>`
    ));
  }

  objs[2] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  objs[1] = fields.length
    ? `<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [${fields.map((f) => `${f} 0 R`).join(" ")}] ` +
      `/DA (/Helv 0 Tf 0 g) /DR << /Font << /Helv ${font} 0 R >> >> >> >>`
    : "<< /Type /Catalog /Pages 2 0 R >>";
  return serialize(objs, 1);
}

// Turn the app's answer boxes into checkbox widgets in PDF (y-up) space.
function widgetsFor(questions, truth) {
  const out = [];
  for (const q of questions) {
    q.boxes.forEach((b, ci) => {
      out.push({
        name: `q${q.question}c${ci}`,
        on: truth[q.question] === ci,
        rect: [b.x, PT_H - b.y - b.height, b.x + b.width, PT_H - b.y],
      });
    });
  }
  return out;
}

module.exports = { buildPdf, widgetsFor, pngToJpeg, jpegSize, PT_W, PT_H };

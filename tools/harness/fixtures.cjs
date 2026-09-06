#!/usr/bin/env node
// Generate every upload fixture the browser suite needs, into fixtures/.
// Nothing here is committed: all of it derives from the reference templates.
//
//   node tools/harness/fixtures.cjs

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const F = require("./lib/form.cjs");
const P = require("./lib/pdf.cjs");
const { writePNG } = require("./lib/png.cjs");
const G = require("./lib/geom.cjs");

const DIR = path.join(__dirname, "fixtures");
fs.mkdirSync(DIR, { recursive: true });
const out = (name, buf) => {
  fs.writeFileSync(path.join(DIR, name), buf);
  console.log(`  ${name.padEnd(24)} ${(buf.length / 1024).toFixed(0)} KB`);
};
const png = (im) => writePNG(im.w, im.h, F.toRGB(im));
let angledCorners = null;

// One answer key across both pages, so the expected total is known.
const truth = { ...F.makeTruth(0, 7), ...F.makeTruth(1, 7) };
const total = Object.values(truth).reduce((a, b) => a + (b || 0), 0);

console.log("writing fixtures:");
// --- images -----------------------------------------------------------------
const p0 = F.noise(F.gradient(F.greyCast(F.fill(0, truth, "mixed"), 0.82), 1, 0.62), 8);
const p1 = F.noise(F.gradient(F.greyCast(F.fill(1, truth, "mixed"), 0.82), 1, 0.62), 8);
out("page0.png", png(p0));
out("page1.png", png(p1));

// A landscape phone photo: portrait page inset in a 4032x3024 frame on a dark desk.
{
  const W = 4032, H = 3024, ph = Math.round(H * 0.88), pw = Math.round((ph * p0.w) / p0.h);
  const ox = ((W - pw) / 2) | 0, oy = ((H - ph) / 2) | 0;
  const rgb = Buffer.alloc(W * H * 3, 90);
  for (let y = 0; y < ph; y++) {
    const sy = ((y * p0.h) / ph) | 0;
    for (let x = 0; x < pw; x++) {
      const v = p0.g[sy * p0.w + (((x * p0.w) / pw) | 0)];
      const i = ((y + oy) * W + x + ox) * 3;
      rgb[i] = rgb[i + 1] = rgb[i + 2] = v;
    }
  }
  const tmp = path.join(DIR, ".landscape.png");
  fs.writeFileSync(tmp, writePNG(W, H, rgb));
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "82", tmp, "--out", path.join(DIR, "landscape.jpg")], { stdio: "ignore" });
  fs.unlinkSync(tmp);
  console.log(`  ${"landscape.jpg".padEnd(24)} ${(fs.statSync(path.join(DIR, "landscape.jpg")).size / 1024).toFixed(0)} KB`);
}

// HEIC, plus the two ways mail clients mangle it.
{
  const src = path.join(DIR, "page0.png"), heic = path.join(DIR, "form.heic");
  try {
    execFileSync("sips", ["-s", "format", "heic", src, "--out", heic], { stdio: "ignore" });
    const b = fs.readFileSync(heic);
    console.log(`  ${"form.heic".padEnd(24)} ${(b.length / 1024).toFixed(0)} KB`);
    out("form_mislabeled.jpg", b); // HEIC bytes, .jpg name
    out("form_noext", b);          // HEIC bytes, no extension
  } catch {
    console.log("  (skipped HEIC — `sips` could not encode it on this machine)");
  }
}

// A page photographed at a steep angle, plus where its answer-table corners
// ended up -- the browser suite drags the overlay handles onto them.
{
  const W = p0.w, H = p0.h;
  const quad = [{ x: 210, y: 130 }, { x: W - 52, y: 26 }, { x: W - 96, y: H - 44 }, { x: 74, y: H - 160 }];
  const { image, mapPoint } = G.warpToQuad(p0, quad);
  const tmp = path.join(DIR, ".warped.png");
  fs.writeFileSync(tmp, png(image));
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "88", tmp, "--out", path.join(DIR, "angled.jpg")], { stdio: "ignore" });
  fs.unlinkSync(tmp);
  // TABLE_QUADS[0] from src/data/scaredForm.js, in canonical (1224x1584) pixels.
  const tq = eval(
    fs.readFileSync(path.join(F.REPO, "src/data/scaredForm.js"), "utf8")
      .match(/export const TABLE_QUADS = (\[[\s\S]*?\n\];)/)[1].replace(/;$/, "")
  )[0];
  angledCorners = tq.map(mapPoint).map((p) => ({ x: +p.x.toFixed(1), y: +p.y.toFixed(1) }));
  console.log(`  ${"angled.jpg".padEnd(24)} ${(fs.statSync(path.join(DIR, "angled.jpg")).size / 1024).toFixed(0)} KB`);
}

// Not a form at all, and not an image at all.
{
  const W = 800, H = 600, rgb = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    rgb[i] = (x * 7 + y * 3) % 255; rgb[i + 1] = (x * 3 + y * 11) % 255; rgb[i + 2] = (x * 13 + y * 5) % 255;
  }
  out("notaform.png", writePNG(W, H, rgb));
  out("notes.txt", Buffer.from("just some notes\n"));
}

// --- PDFs -------------------------------------------------------------------
const j0 = P.pngToJpeg(png(p0)), j1 = P.pngToJpeg(png(p1));
const blank0 = P.pngToJpeg(fs.readFileSync(F.refPath(0)));
const blank1 = P.pngToJpeg(fs.readFileSync(F.refPath(1)));
const q0 = F.questions().filter((q) => q.page === 0);
const q1 = F.questions().filter((q) => q.page === 1);

out("scan.pdf", P.buildPdf([{ jpeg: j0 }]));
out("scan_a4.pdf", P.buildPdf([{ jpeg: j0 }], { pageSize: [595, 842] }));
out("both_pages.pdf", P.buildPdf([{ jpeg: j0 }, { jpeg: j1 }]));
out("both_reversed.pdf", P.buildPdf([{ jpeg: j1 }, { jpeg: j0 }]));
out("duplicate_pages.pdf", P.buildPdf([{ jpeg: j0 }, { jpeg: j0 }]));

// Digitally filled. `no_ap` renders blank but still carries every answer --
// this pair is what exposed the need for pdfExtract.js.
const w0 = P.widgetsFor(q0, truth), w1 = P.widgetsFor(q1, truth);
out("with_ap.pdf", P.buildPdf([{ jpeg: blank0, widgets: w0 }], { withAppearance: true }));
out("no_ap.pdf", P.buildPdf([{ jpeg: blank0, widgets: w0 }], { withAppearance: false }));
out("form_2page.pdf", P.buildPdf([{ jpeg: blank0, widgets: w0 }, { jpeg: blank1, widgets: w1 }]));

// A different fillable PDF: buttons scattered off the answer cells. Must NOT be
// read as a SCARED form.
{
  let s = 4; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const other = Array.from({ length: 20 }, (_, i) => ({
    question: i + 1,
    boxes: Array.from({ length: 3 }, () => ({
      x: 40 + rnd() * 480, y: 40 + rnd() * 660, width: 40, height: 14,
    })),
  }));
  out("other_form.pdf", P.buildPdf([{ jpeg: blank0, widgets: P.widgetsFor(other, { 1: 1 }) }]));
}

fs.writeFileSync(path.join(DIR, "truth.json"), JSON.stringify({ truth, total, angledCorners }, null, 2));
console.log(`\nanswer key: ${Object.keys(truth).length} items, expected total score ${total}`);
console.log(`fixtures in ${DIR}\n`);

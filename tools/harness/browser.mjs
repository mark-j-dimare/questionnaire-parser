#!/usr/bin/env node
// End-to-end suite: drives the real app in headless Chrome over the generated
// fixtures. Run `node tools/harness/fixtures.cjs` first (or `npm run harness:e2e`,
// which does both).
//
//   node tools/harness/browser.mjs           # everything
//   node tools/harness/browser.mjs pdf       # one group: images | photos | pdf | pages
//
// Starts the dev server itself if nothing is listening on 5173, and exits
// non-zero if any expectation fails.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const FIX = path.join(HERE, "fixtures");
const URL_ = "http://localhost:5173/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

if (!fs.existsSync(path.join(FIX, "truth.json"))) {
  console.error("No fixtures. Run: node tools/harness/fixtures.cjs");
  process.exit(1);
}
const { truth, total, angledCorners } = JSON.parse(fs.readFileSync(path.join(FIX, "truth.json"), "utf8"));
const page0Questions = Object.keys(truth).map(Number).filter((q) => q <= 20);
const only = process.argv[2];
const want = (g) => !only || only === g;

let failures = [];
const check = (cond, msg) => { if (!cond) { failures.push(msg); console.log("      FAIL: " + msg); } };

const up = async () => { try { const r = await fetch(URL_); return r.ok; } catch { return false; } };

let vite = null;
async function ensureServer() {
  if (await up()) return;
  console.log("starting dev server…");
  vite = spawn("npm", ["run", "dev"], { cwd: REPO, stdio: "ignore", detached: true });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await up()) return;
  }
  throw new Error("dev server did not come up on 5173");
}

// ---------------------------------------------------------------- helpers ----
const settle = async (page) => {
  await page.waitForFunction(
    () => !document.body.innerText.match(/Reading page|Preparing the scanner|Re-aligning/),
    { timeout: 180000 }
  );
  await new Promise((r) => setTimeout(r, 1200));
};
const clear = async (page) => {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Clear all");
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 500));
};

// Read answers off the page. Question numbers come from the aria-labels, not from
// DOM order, so duplicate or out-of-order pages cannot skew the mapping.
const readState = (page) =>
  page.evaluate(() => {
    const answers = {};
    for (const el of document.querySelectorAll("[aria-pressed]")) {
      const m = (el.getAttribute("aria-label") || "").match(/^Q(\d+)\b.*\((\d)\)/);
      if (m && el.getAttribute("aria-pressed") === "true") answers[+m[1]] = +m[2];
    }
    const t = document.body.innerText;
    return {
      answers,
      cells: document.querySelectorAll("[aria-pressed]").length,
      handles: document.querySelectorAll('button[aria-label*="corner of the answer table"]').length,
      total: (t.match(/(\d+)\s*\ntotal SCARED score/) || [])[1],
      scored: (t.match(/(\d+) of 41 items scored/) || [])[1],
      fieldBadges: (t.match(/Read from the PDF's form fields/g) || []).length,
      autoBadges: (t.match(/Auto-aligned/g) || []).length,
      unrecognized: /couldn.t be lined up automatically/.test(t),
      notice: (t.match(/Page \d+ (?:not uploaded|was uploaded)[^\n]*|Two uploads matched[^\n]*/gi) || []).join(" | "),
      error: (t.match(/Could not read[^\n]*|isn.t a photo[^\n]*/g) || []).join(" | "),
    };
  });

const grade = (answers, qs) => {
  let correct = 0, wrong = 0, missing = 0;
  for (const q of qs) {
    if (answers[q] === undefined) missing++;
    else if (answers[q] === truth[q]) correct++;
    else wrong++;
  }
  return { correct, wrong, missing };
};

async function upload(page, ...files) {
  await clear(page);
  const input = await page.$('input[type="file"]');
  await input.uploadFile(...files.map((f) => path.join(FIX, f)));
  await settle(page);
  return readState(page);
}

// ------------------------------------------------------------------ suites ----
async function images(page) {
  console.log("\n## images");
  let s = await upload(page, "page0.png", "page1.png");
  let g = grade(s.answers, Object.keys(truth).map(Number));
  console.log(`   both pages          ${g.correct}/41 correct, ${g.wrong} wrong · total ${s.total} (want ${total}) · ${s.handles} handles`);
  check(g.correct === 41 && g.wrong === 0, `both pages: ${g.correct}/41, ${g.wrong} wrong`);
  check(+s.total === total, `both pages: total ${s.total} != ${total}`);
  check(s.handles === 8, `both pages: ${s.handles} corner handles, want 8`);

  s = await upload(page, "notaform.png");
  console.log(`   non-form image      grid offered=${s.handles === 4} unrecognized-notice=${s.unrecognized}`);
  check(s.handles === 4, "non-form image: alignment grid not offered (dead end)");

  s = await upload(page, "notes.txt");
  console.log(`   unsupported .txt    message: ${s.error.slice(0, 60)}…`);
  check(/isn.t a photo/.test(s.error), "unsupported file: no friendly message");
}

async function photos(page) {
  console.log("\n## photos & HEIC");
  for (const [label, file] of [
    ["real .heic", "form.heic"],
    ["HEIC named .jpg", "form_mislabeled.jpg"],
    ["HEIC, no extension", "form_noext"],
    ["4032x3024 landscape", "landscape.jpg"],
  ]) {
    const s = await upload(page, file);
    const g = grade(s.answers, page0Questions);
    console.log(`   ${label.padEnd(20)}${g.correct}/${page0Questions.length} correct, ${g.wrong} wrong`);
    check(g.wrong === 0 && g.correct >= page0Questions.length - 1, `${label}: ${g.correct} correct / ${g.wrong} wrong`);
  }

  // The overlay's core interaction: drag the four handles onto the answer table.
  const s0 = await upload(page, "angled.jpg");

  // Bring the overlay fully into view first: a drag target below the fold gets
  // clamped by the viewport and the handle lands somewhere else entirely.
  const imgBox = async () => {
    await page.evaluate(() => {
      const img = document.querySelector('img[alt="Uploaded form"]');
      if (img) img.scrollIntoView({ block: "center" });
    });
    await new Promise((r) => setTimeout(r, 200));
    return page.evaluate(() => {
      const img = document.querySelector('img[alt="Uploaded form"]');
      if (!img) return null;
      const r = img.getBoundingClientRect();
      return { left: r.left, top: r.top, w: r.width, h: r.height };
    });
  };

  const first = await imgBox();
  check(!!first, "angled photo: grid overlay not shown");
  if (first) {
    for (let i = 0; i < 4; i++) {
      const box = await imgBox(); // the layout shifts as answers appear/disappear
      const scale = box.w / 1224; // the fixture is canonical width
      const hs = await page.$$('button[aria-label*="corner of the answer table"]');
      const hb = await hs[i].boundingBox();
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.left + angledCorners[i].x * scale, box.top + angledCorners[i].y * scale, { steps: 8 });
      await page.mouse.up();
      await settle(page);
    }
    const s1 = await readState(page);
    const g = grade(s1.answers, page0Questions);
    console.log(`   angled + drag       ${g.correct}/${page0Questions.length} correct, ${g.wrong} wrong (was ${grade(s0.answers, page0Questions).correct} before dragging)`);
    check(g.wrong === 0 && g.correct >= page0Questions.length - 1, `angled+drag: ${g.correct} correct / ${g.wrong} wrong`);
  }
}

async function pdf(page) {
  console.log("\n## PDFs");
  for (const [label, file, expect] of [
    ["scanned image", "scan.pdf", { fields: 0, page0: true }],
    ["scanned, A4 page size", "scan_a4.pdf", { fields: 0, page0: true }],
    ["fillable, with /AP", "with_ap.pdf", { fields: 1, page0: true }],
    ["fillable, NO /AP", "no_ap.pdf", { fields: 1, page0: true }],
    ["fillable, both pages", "form_2page.pdf", { fields: 2, all: true }],
    ["a DIFFERENT fillable", "other_form.pdf", { fields: 0, none: true }],
  ]) {
    const s = await upload(page, file);
    const qs = expect.all ? Object.keys(truth).map(Number) : page0Questions;
    const g = grade(s.answers, qs);
    console.log(`   ${label.padEnd(22)}fieldBadges=${s.fieldBadges}  ${g.correct}/${qs.length} correct, ${g.wrong} wrong`);
    check(s.fieldBadges === expect.fields, `${label}: ${s.fieldBadges} field badges, want ${expect.fields}`);
    if (expect.none) check(g.correct === 0 && g.wrong === 0, `${label}: read ${g.correct} answers from a non-SCARED form`);
    else check(g.wrong === 0 && g.correct >= qs.length - 1, `${label}: ${g.correct}/${qs.length}, ${g.wrong} wrong`);
  }
}

async function pages(page) {
  console.log("\n## page assembly");
  const all = Object.keys(truth).map(Number);
  for (const [label, files, expect] of [
    ["one file, both pages", ["both_pages.pdf"], { correct: 41 }],
    ["same file, reversed", ["both_reversed.pdf"], { correct: 41 }],
    ["two uploads", ["page0.png", "page1.png"], { correct: 41 }],
    ["two uploads, page 2 first", ["page1.png", "page0.png"], { correct: 41 }],
    ["page 1 only", ["page0.png"], { correct: page0Questions.length, notice: /not uploaded/ }],
    ["same page twice", ["duplicate_pages.pdf"], { notice: /uploaded twice/ }],
  ]) {
    const s = await upload(page, ...files);
    const g = grade(s.answers, all);
    console.log(`   ${label.padEnd(26)}${g.correct}/41 correct, ${g.wrong} wrong · ${s.notice || "no notice"}`);
    check(g.wrong === 0, `${label}: ${g.wrong} wrong answers`);
    if (expect.correct) check(g.correct === expect.correct, `${label}: ${g.correct} correct, want ${expect.correct}`);
    if (expect.notice) check(expect.notice.test(s.notice), `${label}: notice was "${s.notice}"`);
  }
}

// -------------------------------------------------------------------- run ----
// puppeteer-core ships ESM; import it dynamically so a missing install fails
// with a useful message rather than a module-resolution stack trace.
let puppeteer;
try {
  puppeteer = (await import("puppeteer-core")).default;
} catch {
  console.error("puppeteer-core is not installed. Run: npm install --no-save puppeteer-core");
  process.exit(1);
}
await ensureServer();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1600 }); // tall enough for a whole page card
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
await page.goto(URL_, { waitUntil: "networkidle0" });

try {
  if (want("images")) await images(page);
  if (want("photos")) await photos(page);
  if (want("pdf")) await pdf(page);
  if (want("pages")) await pages(page);
} finally {
  await browser.close();
  if (vite) process.kill(-vite.pid, "SIGTERM");
}

check(consoleErrors.length === 0, `console errors: ${consoleErrors.join(" | ")}`);
if (failures.length) {
  console.log(`\nFAILED (${failures.length}):`);
  failures.forEach((f) => console.log("   - " + f));
  process.exit(1);
}
console.log("\nAll end-to-end expectations hold.\n");
process.exit(0);

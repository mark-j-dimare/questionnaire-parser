#!/usr/bin/env node
// Detection suite: runs the real public/cvWorker.js against synthetic pages.
//
//   node tools/harness/detect.cjs            # everything
//   node tools/harness/detect.cjs styles     # one section
//
// Sections: matrix | styles | edges | noise
// Exits non-zero if any invariant is violated, so it can gate a change.

const F = require("./lib/form.cjs");
const W = require("./lib/worker.cjs");

const only = process.argv[2];
const want = (name) => !only || only === name;
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(2) : "0.00") + "%";
let failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

// A page-0 answer key with ~15% of items deliberately left blank.
const DEGRADATIONS = [
  ["clean", (i) => i],
  ["grey 0.7", (i) => F.greyCast(i, 0.7)],
  ["gradient", (i) => F.gradient(i, 1, 0.55)],
  ["noise sd12", (i) => F.noise(i, 12)],
  ["shift +3,-3", (i) => F.shift(i, 3, -3)],
  ["shift -6,+5", (i) => F.shift(i, -6, 5)],
  ["all combined", (i) => F.shift(F.noise(F.gradient(F.greyCast(i, 0.75), 1, 0.55), 10), 4, -4)],
];

async function matrix(post) {
  console.log("\n## matrix — both pages x 5 mark styles x 7 degradations, ~15% items left blank\n");
  const tot = { correct: 0, wrong: 0, missed: 0, spurious: 0 };
  let runs = 0;
  for (const page of [0, 1]) {
    const truth = F.makeTruth(page, 7, 0.15);
    for (const style of ["circle", "fill", "x", "tick", "mixed"]) {
      for (const [dname, df] of DEGRADATIONS) {
        const im = df(F.fill(page, truth, style));
        const r = await W.readPage(post, im, page);
        const g = W.grade(r.detection, truth);
        Object.keys(tot).forEach((k) => (tot[k] += g[k]));
        runs++;
        if (g.wrong || g.spurious) {
          console.log(`   p${page} ${style}/${dname}: ${g.wrong} wrong, ${g.spurious} spurious`);
        }
      }
    }
  }
  const graded = tot.correct + tot.wrong + tot.missed;
  console.log(`   ${runs} runs — ${tot.correct} correct, ${tot.wrong} wrong, ${tot.missed} missed, ${tot.spurious} spurious`);
  console.log(`   accuracy ${pct(tot.correct, graded)}`);
  // A wrong answer is far worse than a missed one: a missed answer is flagged
  // for review, a wrong one is silently scored.
  check(tot.wrong === 0, `matrix: ${tot.wrong} WRONG answers (must be 0)`);
  check(tot.spurious === 0, `matrix: ${tot.spurious} spurious answers (must be 0)`);
  check(tot.correct / graded > 0.98, `matrix: accuracy ${pct(tot.correct, graded)} below 98%`);
}

async function styles(post) {
  console.log("\n## styles — people do not mark consistently; all of these must read\n");
  const page = 0;
  const truth = F.makeTruth(page, 11);
  const n = Object.keys(truth).length;
  const cols = [["clean", (i) => i],
                ["grey/grad/noise", (i) => F.noise(F.gradient(F.greyCast(i, 0.8), 1, 0.6), 9)],
                ["+shift 4px", (i) => F.shift(F.noise(F.gradient(F.greyCast(i, 0.8), 1, 0.6), 9), 4, -4)]];
  console.log("   " + "style".padEnd(11) + cols.map((c) => c[0].padEnd(20)).join(""));
  for (const style of F.STYLE_NAMES) {
    const cells = [];
    for (const [, df] of cols) {
      const r = await W.readPage(post, df(F.fill(page, truth, style)), page);
      const g = W.grade(r.detection, truth);
      cells.push(`${String(g.correct).padStart(2)}/${n} ok ${g.wrong}wr ${g.missed}miss`.padEnd(20));
      check(g.wrong === 0, `styles: ${style} produced ${g.wrong} wrong`);
      check(g.correct >= n - 2, `styles: ${style} only read ${g.correct}/${n}`);
    }
    console.log("   " + style.padEnd(11) + cells.join(""));
  }
}

async function edges(post) {
  console.log("\n## edges — blank page, double marks, broken alignment\n");
  const page = 0;
  const blank = F.loadGray(page);
  let r = await W.readPage(post, blank, page);
  let marks = r.detection.filter((d) => d.selectedIndex !== null).length;
  console.log(`   blank page                 marks=${marks} (want 0)  noisy=${r.quality.noisy}`);
  check(marks === 0, `edges: blank page produced ${marks} answers`);

  const truth = F.makeTruth(page, 3);
  const one = F.fill(page, truth, "circle");
  const q1 = Object.keys(truth)[0];
  const extra = F.fill(page, { [q1]: (truth[q1] + 1) % 3 }, "circle");
  const both = { ...one, g: one.g.map((v, i) => Math.min(v, extra.g[i])) };
  r = await W.readPage(post, both, page);
  const multi = r.detection.filter((d) => d.reason === "multiple-marks").length;
  console.log(`   two marks in one row       multiple-marks=${multi} (want >=1)`);
  check(multi >= 1, "edges: two marks in a row were not flagged");

  const im = F.fill(page, truth, "circle");
  const bad = [{ x: 40, y: 25 }, { x: im.w - 10, y: -30 }, { x: im.w - 45, y: im.h - 20 }, { x: 15, y: im.h + 35 }];
  r = await W.readPage(post, im, page, bad);
  marks = r.detection.filter((d) => d.selectedIndex !== null).length;
  console.log(`   corners 40px off           marks=${marks} (want 0)  noisy=${r.quality.noisy} (want true)`);
  check(marks === 0 && r.quality.noisy, "edges: broken alignment was not rejected");
}

async function noise(post) {
  console.log("\n## noise — a BLANK page must never invent answers\n");
  const page = 0;
  for (const sd of [10, 15, 20, 25, 30]) {
    let worst = 0, flagged = 0;
    for (let t = 0; t < 3; t++) {
      const im = F.noise(F.greyCast(F.loadGray(page), 0.85), sd);
      const r = await W.readPage(post, im, page);
      worst = Math.max(worst, r.detection.filter((d) => d.selectedIndex !== null).length);
      if (r.quality.noisy) flagged++;
    }
    console.log(`   sd=${String(sd).padStart(2)}  worst spurious=${worst}  pages flagged noisy=${flagged}/3`);
    // Up to sd=25 there must be no phantom answers at all; beyond that the page
    // must at least be flagged as untrustworthy.
    if (sd <= 25) check(worst === 0, `noise sd=${sd}: ${worst} phantom answers on a blank page`);
    else check(worst === 0 || flagged > 0, `noise sd=${sd}: phantom answers and no noisy flag`);
  }
}

(async () => {
  const { post } = await W.start();
  if (want("matrix")) await matrix(post);
  if (want("styles")) await styles(post);
  if (want("edges")) await edges(post);
  if (want("noise")) await noise(post);
  if (failures.length) {
    console.log(`\nFAILED (${failures.length}):`);
    failures.forEach((f) => console.log("   - " + f));
    process.exit(1);
  }
  console.log("\nAll detection invariants hold.\n");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

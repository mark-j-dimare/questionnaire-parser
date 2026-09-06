# Verification harness

This repo has no test framework, and the CV pipeline is the kind of code where a
change can look fine and be quietly wrong — the old mark detector returned
*confident, incorrect* answers on degraded scans. These scripts exist so a change
can be checked in seconds instead of by eye.

Nothing here ships with the app. `src/` never imports it.

## Running it

```bash
npm run harness            # detection suites against the real cvWorker.js (~30s)
npm run harness:fixtures   # (re)generate the upload fixtures
npm run harness:e2e        # fixtures + full end-to-end run in headless Chrome
```

Both suites **exit non-zero** when an invariant breaks, so they can gate a change.

`harness:e2e` needs `puppeteer-core`, which is deliberately not a dependency:

```bash
npm install --no-save puppeteer-core
```

Note that a plain `npm install` will prune it again. Chrome is assumed at
`/Applications/Google Chrome.app`. The e2e script starts the dev server itself if
nothing is listening on 5173.

## What is checked

`detect.cjs` drives the real `public/cvWorker.js` in Node against synthetic pages:

| section | what it asserts |
|---|---|
| `matrix` | both pages × 5 mark styles × 7 degradations, ~15% items blank: **zero wrong, zero spurious**, ≥98% accuracy |
| `styles` | all 11 mark styles read correctly (see below) |
| `edges` | a blank page yields no answers; two marks in a row flag `multiple-marks`; a broken alignment is rejected *and* flagged noisy |
| `noise` | a **blank** page never invents answers up to sd=25, and beyond that is at least flagged |

Run one section with `node tools/harness/detect.cjs styles`.

The distinction the matrix section enforces is the important one: a *missed*
answer is flagged for the clinician, a *wrong* answer is silently scored. Missing
a faint mark is acceptable; inventing one is not.

**The 11 mark styles** exist because people do not fill this form consistently —
it is not a scantron. Circle round the target, filled-in target, X, faint tick,
slash through it, long line through it, underline beneath it, oversized circle,
scribble, check drawn *beside* it, check hard against the cell edge. Several of
these broke earlier designs: a window-based scorer missed every off-centre mark,
and a `MORPH_OPEN` despeckle erased 100% of a drawn underline.

`browser.mjs` drives the real app in headless Chrome:

| group | what it covers |
|---|---|
| `images` | two pages → 41/41 and the expected total; a non-form image offers the alignment grid rather than dead-ending; an unsupported file gets a readable message |
| `photos` | HEIC, HEIC mislabelled `.jpg`, HEIC with no extension, a 4032×3024 landscape photo, and **dragging the four overlay handles** onto a steeply angled page |
| `pdf` | scanned (Letter and A4), fillable with `/AP`, fillable **without** `/AP` (renders blank — must still read), a two-page fillable form, and an unrelated fillable PDF that must *not* be read as SCARED |
| `pages` | one file with both pages, reversed order, two separate uploads, either order, one page only, and the same page twice (duplicate + missing reported together) |

Run one group with `node tools/harness/browser.mjs pdf`.

## Fixtures

`fixtures.cjs` generates everything into `fixtures/` (gitignored) from the
reference templates, so no binaries are committed. It writes `truth.json` with the
answer key, the expected total, and the answer-table corners of the angled photo.

HEIC and JPEG encoding use macOS `sips`; on another platform those fixtures are
skipped and the rest still work.

The PDF writers in `lib/pdf.cjs` are hand-rolled because the shapes that actually
broke the app are hard to get from a generic library — in particular an AcroForm
whose widgets carry `/V` but **no `/AP` appearance stream**. That PDF renders
completely blank while still containing every answer, which is precisely why
`src/utils/pdfExtract.js` exists.

## Gotchas baked in here

- **An emscripten `Module` is *thenable*.** Resolving a readiness promise *with*
  the `cv` object makes the Promise machinery adopt it and spin forever at 100%
  CPU — the `await` never returns and nothing errors. Resolve with **no value**
  (`public/cvWorker.js` gets this right). See `lib/worker.cjs`.
- `lib/worker.cjs` reads `CONFIG` out of `src/utils/cvClient.js` rather than
  keeping its own copy, so the harness always tests the values the app ships.
- `.opencv.cjs` is a local CommonJS copy of `public/opencv.js`, refreshed
  automatically when the vendored build changes (the repo is `"type": "module"`).

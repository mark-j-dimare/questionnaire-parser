# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A fully client-side React + Vite app that reads a **SCARED** questionnaire (child anxiety screening; 41 items across 2 pages) from photos/scans, auto-aligns each page, detects which answer circle is marked, and computes the total + 5 subscale scores. There is **no backend** — all image processing happens in the browser, by design (patient data must never leave the device). The product model is **auto-detect + human review**, not blind trust: answers are detected, low-confidence/missing ones are flagged, and the clinician confirms or fixes before using the score.

## Commands

```bash
npm run dev          # Vite dev server (default http://localhost:5173)
npm run build        # production build -> dist/
npm run preview      # serve the production build locally
npm run lint         # eslint
npm run sync-opencv  # re-vendor public/opencv.js from node_modules after bumping @techstark/opencv-js
```

There is **no test framework**. Verification is done by running the app (manually, or by driving headless Chrome with `puppeteer-core` against the dev server — Chrome is the only browser assumed installed). When changing the CV pipeline, validate against real form photos, not just the synthetic ones.

## Pipeline architecture (the big picture)

Upload → decode → **align to a known template** → detect marks → score. The order matters: detection only works because each page is first warped to a canonical, fixed geometry. Data flows main-thread → worker as transferable `ImageData` buffers and back.

- **`src/utils/imaging.js`** — turns an uploaded file into canvases. PDFs render via `pdfjs-dist` (worker bundled locally as `pdfjs-dist/build/pdf.worker.min.js?url`, rendered with `annotationMode: ENABLE` so digitally-stamped PDFs are read); images load via `Image`. Inputs are downscaled (`MAX_DIMENSION`) since alignment normalizes scale anyway.
- **`src/utils/cvClient.js`** — main-thread owner of the single OpenCV Web Worker. Manages an id-based request/response protocol, ships the reference templates + form geometry into the worker once via `initCv()`, and exposes `processCanvas()` (auto-align) and `warpCanvas()` (manual 4-corner align). Rebuilds aligned canvases from the worker's transferred pixel buffers.
- **`public/cvWorker.js`** — the actual OpenCV work, off the main thread. ORB feature-match each page to the cached blank-form templates → `findHomography` (RANSAC) → `warpPerspective` to canonical size → per-cell dark-pixel fraction with a within-row margin rule. Returns per-question `{selectedIndex, confidence}` + the aligned image.
- **`src/data/scaredForm.js`** — the form definition. Reuses `childQuestionnaireMap.js` (the 41×3 answer-cell boxes), adds question text, `CANON_SCALE`, the reference template images, and the scoring config (subscale labels + cutoffs, total cutoff).
- **`src/utils/score.js`** — total + subscale tally from a `{question: 0|1|2|null}` map.
- **`src/utils/flags.js`** — shared "needs review" logic (`flaggedForPage`, `flagStats`, `LOW_CONFIDENCE`). Used by both the per-page banner and the global status bar so they always agree.
- **`src/components/ManualEntry.jsx` + `ReferenceImages.jsx`** — the **manual-entry mode**, a second path that bypasses the CV pipeline entirely. Real-world uploads are inconsistent, so the app has a "Scan a form" / "Enter by hand" toggle: the hand mode renders all 41 items as a blank on-screen form (three targets per row, `0`/`1`/`2` keys answer and advance) scored by the same `computeScore`, with an optional side-by-side viewer for the user's own photo/scan/PDF (decoded via `fileToCanvases`, **no OpenCV, no alignment**). Scanned answers can be copied into it as a starting point.
- **`src/App.jsx`** — orchestration + UI state: recognition gating, completeness/duplicate detection, the sticky status bar, per-page state (answers, user-confirmations, alignment mode), and the manual-align modal.

## Non-obvious constraints (read before changing these areas)

- **OpenCV is loaded as a static `<script src="/opencv.js">`, NOT imported.** `@techstark/opencv-js` is a ~10 MB eval-laden emscripten bundle; importing it through Vite's module/dep pipeline **hangs the page during evaluation**. It's vendored to `public/opencv.js` and loaded via `importScripts` in the worker / a script tag pattern. The npm dependency exists only as the source for that vendored copy — run `npm run sync-opencv` after upgrading it. `cvClient`/the worker detect readiness by **polling `cv.Mat`**, not the one-shot `onRuntimeInitialized` callback (which races and can leave the promise pending forever).
- **`public/cvWorker.js` is a plain classic worker in `public/` (not bundled by Vite)** so it can use `importScripts` and stay self-contained. Its align/detect logic is **intentionally duplicated** from the data model rather than imported; if you change detection thresholds or the algorithm, update the worker and keep `cvClient.js`'s `CONFIG` in sync.
- **Tailwind v4** (`@tailwindcss/postcss`). The `content` array in `tailwind.config.js` is **ignored** by v4 — sources are declared in `src/index.css` via `@import "tailwindcss"` + `@source`. If newly added utility classes silently don't apply, that's why (and a dev-server restart forces a rescan). `index.css` also pins `color-scheme: light`.
- **Coordinate system:** answer-cell boxes are in the form's **612×792 PDF space**; multiply by `CANON_SCALE` (2) to index pixels on the aligned **1224×1584** canvas. The reference templates (`src/assets/reference/blank_p0.png`, `blank_p1.png`) are the blank form rendered at 2× and serve as both the alignment templates and the canonical geometry.
- **Recognition is inlier-gated.** Alignment points (RANSAC inliers) separate a real SCARED page (hundreds) from a different document (single digits): `RECOGNIZE_MIN` (accept as a SCARED page) and `STRONG_INLIERS` (confident auto-align) in `App.jsx`. Unrecognized uploads are shown as a warning card and **excluded from scoring**; missing and duplicate pages are detected and surfaced. Uploads **append** to existing pages, so a 2-page form can be uploaded one photo at a time.
- **Review/scoring is live and local.** A user click on a cell counts as confirmation (clears its flag, shown in a distinct "confirmed by you" style); scoring updates immediately; nothing is persisted or exported.

## Deploy

Vite outputs to `dist/` (not `build/`). `vercel.json` sets `framework: vite` + `outputDirectory: dist`. The vendored `public/opencv.js` and `public/cvWorker.js` are copied to the dist root and served at `/opencv.js` and `/cvWorker.js`, which is where the runtime loads them from (`import.meta.env.BASE_URL`-prefixed).

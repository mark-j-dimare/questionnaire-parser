import { useMemo, useRef, useState } from "react";
import Uploader from "./components/Uploader";
import PageReview from "./components/PageReview";
import ScorePanel from "./components/ScorePanel";
import GridOverlay from "./components/GridOverlay";
import ManualEntry from "./components/ManualEntry";
import ReferenceImages from "./components/ReferenceImages";
import { QUESTIONS, TABLE_QUADS } from "./data/scaredForm";
import { fileToCanvases, looksLikePdf } from "./utils/imaging";
import { extractPdfAnswers } from "./utils/pdfExtract";
import { initCv, processCanvas, warpCanvas } from "./utils/cvClient";
import { computeScore } from "./utils/score";
import { flagStats } from "./utils/flags";
import { invertH, applyH } from "./utils/homography";

const ClipboardIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
    <rect x="9" y="3" width="6" height="4" rx="1" />
    <path d="m9 14 2 2 4-4" />
  </svg>
);
const AlertIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const CheckCircleIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);
const ScanIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    <line x1="7" y1="12" x2="17" y2="12" />
  </svg>
);

// Alignment-point thresholds. A real SCARED page matches with hundreds of points;
// a different document matches with only a handful.
const RECOGNIZE_MIN = 25; // below this we don't accept it as a SCARED page at all
const STRONG_INLIERS = 60; // above this, auto-alignment is confident
const FORM_PAGES = [0, 1];

function makeThumb(canvas, targetW = 100) {
  const scale = targetW / canvas.width;
  const c = document.createElement("canvas");
  c.width = targetW;
  c.height = Math.max(1, Math.round(canvas.height * scale));
  c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

// The worker returns the photo -> canonical homography; inverting it and pushing
// the canonical answer-table quad back through gives the four points the overlay
// should put its handles on.
// Missing and duplicate pages are reported together, because they almost always
// occur together: photographing page 1 twice leaves page 2 missing. Reporting
// only the missing page (which is what a plain if/else chain does) tells the
// user to add a page while saying nothing about the duplicate they need to
// remove -- and two identical "Page 1" cards look like a rendering glitch.
// Turn extracted PDF form-field values into the same per-question shape the CV
// detector emits, so scoring, flagging and the overlay treat both identically.
// confidence 1 because a field value is not a guess -- but the answers still go
// through the normal human review, per the product model.
function detectionFromFields(fields) {
  return QUESTIONS.filter((q) => q.page === fields.pageIndex).map((q) => {
    const conflicted = fields.conflicts.includes(q.question);
    const value = fields.answers[q.question];
    return {
      question: q.question,
      scores: [],
      selectedIndex: conflicted || value == null ? null : value,
      confidence: conflicted || value == null ? 0 : 1,
      reason: conflicted ? "multiple-marks" : value == null ? "no-mark" : null,
      source: "pdf-field",
    };
  });
}

function pageProblemText(missing, duplicate) {
  const list = (a) => a.map((i) => i + 1).join(" & ");
  if (duplicate.length && missing.length) {
    return `Page ${list(duplicate)} was uploaded twice and page ${list(missing)} is missing — remove the duplicate and add the missing page.`;
  }
  if (duplicate.length) {
    return `Two uploads matched page ${list(duplicate)} — remove the one you don't want; only the last is scored.`;
  }
  return `Page ${list(missing)} not uploaded yet — the score is incomplete.`;
}

function cornersFromHomography(H, pageIndex) {
  const quad = TABLE_QUADS[pageIndex];
  if (!H || H.length !== 9 || !quad) return null;
  const inv = invertH(H);
  if (!inv) return null;
  const pts = quad.map((p) => applyH(inv, p));
  return pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ? pts : null;
}

const MissingPageCard = ({ pageIndex, onAdd }) => (
  <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white p-8 text-center">
    <ScanIcon className="mb-2 h-8 w-8 text-slate-300" />
    <p className="text-sm font-medium text-slate-700">
      Page {pageIndex + 1} not added yet
    </p>
    <p className="mb-3 mt-1 text-xs text-slate-500">
      This form has two pages. Add the photo or scan of page {pageIndex + 1} to
      complete the score.
    </p>
    <button
      onClick={onAdd}
      className="rounded-lg bg-teal-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
    >
      Add page {pageIndex + 1}
    </button>
  </div>
);

// Headline total + cutoff verdict. Shared by the scan and manual-entry views.
const ResultsHeader = ({ score }) => (
  <section
    aria-live="polite"
    className="mb-6 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200"
  >
    <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-baseline gap-3">
        <span className="text-4xl font-bold tabular-nums tracking-tight text-slate-900">
          {score.total}
        </span>
        <span className="text-sm text-slate-500">total SCARED score</span>
      </div>
      <span
        className={
          score.totalElevated
            ? "inline-flex items-center gap-2 rounded-full bg-amber-100 px-3.5 py-1.5 text-sm font-semibold text-amber-900 ring-1 ring-amber-200"
            : "inline-flex items-center gap-2 rounded-full bg-green-100 px-3.5 py-1.5 text-sm font-semibold text-green-800 ring-1 ring-green-200"
        }
      >
        <span
          className={`h-2 w-2 rounded-full ${score.totalElevated ? "bg-amber-600" : "bg-green-600"}`}
          aria-hidden="true"
        />
        {score.totalElevated
          ? `At or above screening cutoff (≥ ${score.totalCutoff})`
          : `Below screening cutoff (< ${score.totalCutoff})`}
      </span>
    </div>
    <div className="px-5 pb-5">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-teal-500 transition-all motion-reduce:transition-none"
          style={{ width: `${(score.answered / score.totalQuestions) * 100}%` }}
        />
      </div>
    </div>
  </section>
);

function App() {
  const [pages, setPages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState(null);
  // Every page is reviewed on the user's own photo with the answer grid drawn
  // over it -- that shows the detected answers AND lets the alignment be fixed
  // in the same place. These are the pages the user has flipped to the
  // straightened (rectified) view instead.
  const [straightenedIds, setStraightenedIds] = useState(() => new Set());
  const [aligningId, setAligningId] = useState(null);

  // "scan" = read the form from a photo/PDF; "manual" = blank on-screen form the
  // user fills in by eye (for uploads too messy for the scanner to read).
  const [mode, setMode] = useState("scan");
  const [manualAnswers, setManualAnswers] = useState({});
  const [refImages, setRefImages] = useState([]);
  const [refBusy, setRefBusy] = useState(false);

  const idRef = useRef(0);
  const fileInputRef = useRef(null);
  const openFilePicker = () => fileInputRef.current?.click();

  const pageFromResult = (result, canvas, fileName, fields) => {
    // A digitally-filled PDF carries its answers as form-field values. When we
    // have those, they ARE the answers -- exact, and independent of whether the
    // marks rendered at all. Alignment still comes from the CV pass so the grid
    // overlay works, but the reading does not depend on it.
    const detection = fields
      ? detectionFromFields(fields)
      : result.detection;
    const answers = {};
    detection.forEach((d) => {
      answers[d.question] = d.selectedIndex;
    });
    const inliers = result.inliers || 0;
    const recognized = fields ? true : !!result.alignedCanvas && inliers >= RECOGNIZE_MIN;
    const strong = inliers >= STRONG_INLIERS;
    const pageIndex = fields ? fields.pageIndex : result.pageIndex;
    // Where the answer table's corners landed in the ORIGINAL photo, so the grid
    // overlay can start from the automatic alignment rather than a blind guess.
    const corners = cornersFromHomography(result.homography, result.pageIndex);
    return {
      id: ++idRef.current,
      pageIndex,
      label: `Page ${pageIndex + 1}`,
      fileName,
      sourceCanvas: canvas,
      thumbUrl: makeThumb(canvas),
      alignedUrl: result.alignedCanvas
        ? result.alignedCanvas.toDataURL("image/png")
        : null,
      inliers: result.inliers,
      matches: result.matches,
      recognized,
      aligned: recognized && strong,
      alignMode: fields
        ? "pdf-fields"
        : !recognized
        ? "unrecognized"
        : strong
        ? "auto"
        : "auto-weak",
      answers,
      detection,
      quality: result.quality || null,
      corners,
      confirmed: new Set(), // questions the user has set/confirmed by hand
    };
  };

  const handleFiles = async (files) => {
    // Capture the FileList synchronously: the uploader resets the <input> right
    // after this returns, which empties the live FileList before our awaits resume.
    const fileList = Array.from(files);
    setError(null);
    setBusy(true);
    setStage("Preparing the scanner (first time only)…");
    await new Promise((r) => setTimeout(r, 30));
    try {
      await initCv();

      const incoming = [];
      for (const file of fileList) {
        try {
          const canvases = await fileToCanvases(file);
          const fields = looksLikePdf(file) ? await extractPdfAnswers(file) : null;
          canvases.forEach((canvas, i) =>
            incoming.push({ canvas, name: file.name, fields: (fields && fields[i]) || null })
          );
        } catch (e) {
          setError(`Could not read "${file.name}": ${e.message}`);
        }
      }

      const created = [];
      for (let i = 0; i < incoming.length; i++) {
        setStage(`Reading page ${i + 1} of ${incoming.length}…`);
        const result = await processCanvas(incoming[i].canvas);
        created.push(
          pageFromResult(result, incoming[i].canvas, incoming[i].name, incoming[i].fields)
        );
      }
      setPages((prev) =>
        [...prev, ...created].sort((a, b) => a.pageIndex - b.pageIndex)
      );
    } catch (e) {
      setError(`Processing failed: ${e.message}`);
    } finally {
      setBusy(false);
      setStage("");
    }
  };

  // `confirmed` marks the answer as set/confirmed by the user (clears its review
  // flag). Clearing an answer (value === null) un-confirms it.
  const changeAnswer = (pageId, question, value, confirmed) => {
    setPages((prev) =>
      prev.map((p) => {
        if (p.id !== pageId) return p;
        const nextConfirmed = new Set(p.confirmed);
        if (confirmed && value != null) nextConfirmed.add(question);
        else nextConfirmed.delete(question);
        return {
          ...p,
          answers: { ...p.answers, [question]: value },
          confirmed: nextConfirmed,
        };
      })
    );
  };

  const toggleStraightened = (id, on) =>
    setStraightenedIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const removePage = (id) => setPages((prev) => prev.filter((p) => p.id !== id));

  // Re-read a page from four user-placed corners of the answer table. Called on
  // every handle release, so the grid and the answers update as the user drags.
  const alignFromCorners = async (pageId, corners, pageIndexOverride) => {
    const page = pages.find((p) => p.id === pageId);
    if (!page) return;
    const pageIndex = pageIndexOverride ?? page.pageIndex;
    // Aligning marks the page recognized, which would otherwise swap the grid
    // out for the review view mid-drag. Keep the user in the grid until they
    // say they're done with it.
    setAligningId(pageId);
    try {
      const result = await warpCanvas(
        page.sourceCanvas,
        corners,
        pageIndex,
        TABLE_QUADS[pageIndex]
      );
      const answers = {};
      result.detection.forEach((d) => {
        answers[d.question] = d.selectedIndex;
      });
      setPages((prev) =>
        prev
          .map((p) =>
            p.id === pageId
              ? {
                  ...p,
                  pageIndex,
                  label: `Page ${pageIndex + 1}`,
                  alignedUrl: result.alignedCanvas
                    ? result.alignedCanvas.toDataURL("image/png")
                    : p.alignedUrl,
                  detection: result.detection,
                  quality: result.quality || null,
                  answers,
                  corners,
                  confirmed: new Set(),
                  recognized: true,
                  aligned: true,
                  alignMode: "manual",
                }
              : p
          )
          .sort((a, b) => a.pageIndex - b.pageIndex)
      );
    } catch (e) {
      setError(`Could not read that alignment: ${e.message}`);
    } finally {
      setAligningId(null);
    }
  };

  const reset = () => {
    if (mode === "manual") {
      setManualAnswers({});
      setRefImages([]);
    } else {
      setPages([]);
    }
    setError(null);
  };

  // --- Manual entry -------------------------------------------------------
  const setManualAnswer = (question, value) =>
    setManualAnswers((prev) => ({ ...prev, [question]: value }));

  // Decode reference photos/PDFs for side-by-side viewing only — no OpenCV.
  const addReferenceImages = async (files) => {
    const fileList = Array.from(files);
    if (!fileList.length) return;
    setRefBusy(true);
    try {
      const added = [];
      for (const file of fileList) {
        try {
          const canvases = await fileToCanvases(file);
          canvases.forEach((canvas, i) =>
            added.push({
              id: ++idRef.current,
              name: canvases.length > 1 ? `${file.name} (p${i + 1})` : file.name,
              url: canvas.toDataURL("image/png"),
            })
          );
        } catch (e) {
          setError(`Could not read "${file.name}": ${e.message}`);
        }
      }
      setRefImages((prev) => [...prev, ...added]);
    } finally {
      setRefBusy(false);
    }
  };

  const recognizedPages = useMemo(() => pages.filter((p) => p.recognized), [pages]);

  const scannedAnswers = useMemo(() => {
    const merged = {};
    recognizedPages.forEach((p) => {
      Object.entries(p.answers).forEach(([q, v]) => {
        merged[q] = v;
      });
    });
    return merged;
  }, [recognizedPages]);

  const copyScanIntoManual = () => setManualAnswers({ ...scannedAnswers });

  const manualAnsweredCount = useMemo(
    () => QUESTIONS.filter((q) => manualAnswers[q.question] != null).length,
    [manualAnswers]
  );

  const score = useMemo(
    () => computeScore(mode === "manual" ? manualAnswers : scannedAnswers),
    [mode, manualAnswers, scannedAnswers]
  );

  const flags = useMemo(() => flagStats(recognizedPages), [recognizedPages]);

  // Completeness / duplicate checks across the recognized pages.
  const presentPages = new Set(recognizedPages.map((p) => p.pageIndex));
  const missingPages = recognizedPages.length
    ? FORM_PAGES.filter((i) => !presentPages.has(i))
    : [];
  const duplicatePages = FORM_PAGES.filter(
    (i) => recognizedPages.filter((p) => p.pageIndex === i).length > 1
  );


  const hasPages = pages.length > 0;
  const hasRecognized = recognizedPages.length > 0;
  const manualMode = mode === "manual";
  const canClear = manualMode
    ? manualAnsweredCount > 0 || refImages.length > 0
    : hasPages;

  // Single source of truth for the sticky status bar.
  const status = !hasRecognized
    ? {
        tone: "warn",
        text: "Couldn't recognize a SCARED form in your upload. Make sure you're uploading the child SCARED questionnaire.",
      }
    : missingPages.length || duplicatePages.length
    ? { tone: "warn", text: pageProblemText(missingPages, duplicatePages) }
    : flags.total > 0
    ? { tone: "warn", review: true }
    : { tone: "ok" };

  return (
    <div className="min-h-screen w-full bg-canvas text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/75">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-50 text-teal-700">
              <ClipboardIcon className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-lg font-semibold leading-none tracking-tight text-slate-900">
                SCARED Form Scanner
              </h1>
              <p className="mt-0.5 text-xs text-slate-500">
                Child anxiety screening · automated scoring
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700 sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-500" aria-hidden="true" />
              Runs locally — nothing leaves this device
            </span>
            {canClear && (
              <button
                onClick={reset}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
              >
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* Sticky status row — stays visible while scrolling both pages. */}
        {hasPages && !manualMode && (
          <div
            aria-live="polite"
            className={`border-t ${
              status.tone === "ok"
                ? "border-green-100 bg-green-50"
                : "border-amber-100 bg-amber-50"
            }`}
          >
            <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 text-sm sm:px-6 lg:px-8">
              {status.tone === "ok" ? (
                <>
                  <CheckCircleIcon className="h-4 w-4 shrink-0 text-green-700" />
                  <span className="font-medium text-green-800">
                    All items answered — nothing flagged for review.
                  </span>
                </>
              ) : status.review ? (
                <>
                  <AlertIcon className="h-4 w-4 shrink-0 text-amber-700" />
                  <span className="font-semibold text-amber-900">
                    {flags.total} answer{flags.total > 1 ? "s" : ""} need review
                  </span>
                  <span className="truncate text-amber-800">
                    across {flags.pagesWithFlags} page
                    {flags.pagesWithFlags > 1 ? "s" : ""} — tap the highlighted circles
                    to confirm or fix.
                  </span>
                </>
              ) : (
                <>
                  <AlertIcon className="h-4 w-4 shrink-0 text-amber-700" />
                  <span className="truncate font-medium text-amber-900">
                    {status.text}
                  </span>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Scan vs. type-it-in. Manual entry is the fallback when a photo or PDF
            is too inconsistent for the scanner to read reliably. */}
        <div
          role="tablist"
          aria-label="How to enter answers"
          className="mb-5 inline-flex rounded-lg bg-slate-100 p-1"
        >
          {[
            { key: "scan", label: "Scan a form" },
            { key: "manual", label: "Enter by hand" },
          ].map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={mode === t.key}
              onClick={() => setMode(t.key)}
              className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 ${
                mode === t.key
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mb-6 max-w-2xl">
          <h2 className="text-sm font-semibold text-slate-900">
            {manualMode
              ? "Fill in a child SCARED questionnaire by hand"
              : "Scan & score a child SCARED questionnaire"}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            {manualMode
              ? "A blank form to type into when the photo or PDF is too messy to scan. Copy the marked answers off the paper and the score updates as you go."
              : "Add photos or scans of both form pages. Answers are detected and scored automatically — review the highlighted circles and correct any the scanner flagged."}
          </p>
        </div>

        {!manualMode && (
          <div className="mb-4">
            <Uploader onFiles={handleFiles} busy={busy} />
          </div>
        )}

        {busy && stage && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 flex items-center gap-3 rounded-lg border border-teal-200 bg-teal-50 px-4 py-2.5 text-sm font-medium text-teal-800"
          >
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-teal-300 border-t-teal-700" aria-hidden="true" />
            {stage}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-800"
          >
            <AlertIcon className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {manualMode ? (
          <>
            {hasRecognized && <ResultsHeader score={score} />}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
              <ManualEntry
                answers={manualAnswers}
                onChange={setManualAnswer}
                onClear={() => setManualAnswers({})}
                onCopyFromScan={hasRecognized ? copyScanIntoManual : null}
                answeredCount={manualAnsweredCount}
              />
              <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
                <ReferenceImages
                  images={refImages}
                  onAdd={addReferenceImages}
                  onClear={() => setRefImages([])}
                  busy={refBusy}
                />
                <ScorePanel score={score} />
              </div>
            </div>
          </>
        ) : !hasPages ? (
          <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white py-16 text-center">
            <ScanIcon className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="text-sm font-medium text-slate-700">No forms loaded yet</p>
            <p className="mt-1 text-xs text-slate-500">
              Upload both pages of the child SCARED questionnaire to read and score the
              answers automatically.
            </p>
          </div>
        ) : (
          <>
            {hasRecognized && <ResultsHeader score={score} />}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
              <div className="space-y-6">
                {/* One list, no dead ends: a page the scanner could not place
                    shows the alignment grid instead of an error card, and any
                    page can be switched to the grid to adjust it. */}
                {pages.map((page) =>
                  straightenedIds.has(page.id) ? (
                    <PageReview
                      key={page.id}
                      page={page}
                      onChangeAnswer={(q, v, confirmed) =>
                        changeAnswer(page.id, q, v, confirmed)
                      }
                      onManualRealign={() => toggleStraightened(page.id, false)}
                      onRemove={() => removePage(page.id)}
                    />
                  ) : (
                    <div key={page.id} className="space-y-2">
                      {!page.recognized && (
                        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
                          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                          <p>
                            <span className="font-medium">{page.fileName}</span>{" "}
                            couldn&apos;t be lined up automatically
                            {typeof page.inliers === "number"
                              ? ` (only ${page.inliers} alignment points)`
                              : ""}
                            . Drag the four handles onto the answer table below and it
                            will be read and scored — or remove it if it isn&apos;t a
                            SCARED page.
                          </p>
                        </div>
                      )}
                      <GridOverlay
                        page={page}
                        sourceCanvas={page.sourceCanvas}
                        pageIndex={page.pageIndex}
                        initialCorners={page.corners}
                        detection={page.detection}
                        answers={page.answers}
                        confirmed={page.confirmed}
                        quality={page.quality}
                        busy={aligningId === page.id}
                        onAlign={(corners) => alignFromCorners(page.id, corners)}
                        onPageIndexChange={(idx, cs) =>
                          alignFromCorners(page.id, cs, idx)
                        }
                        onChangeAnswer={(q, v, confirmed) =>
                          changeAnswer(page.id, q, v, confirmed)
                        }
                        onShowStraightened={
                          page.alignedUrl ? () => toggleStraightened(page.id, true) : null
                        }
                        onRemove={() => removePage(page.id)}
                      />
                    </div>
                  )
                )}
                {missingPages.map((idx) => (
                  <MissingPageCard
                    key={`missing-${idx}`}
                    pageIndex={idx}
                    onAdd={openFilePicker}
                  />
                ))}
              </div>
              <div className="space-y-4 lg:sticky lg:top-28 lg:self-start">
                <ScorePanel score={score} />
              </div>
            </div>
          </>
        )}
      </main>

      {/* Shared hidden picker for the "Add page" placeholder buttons. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.heic,.heif,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

    </div>
  );
}

export default App;

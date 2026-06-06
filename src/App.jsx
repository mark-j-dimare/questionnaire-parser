import { useMemo, useRef, useState } from "react";
import Uploader from "./components/Uploader";
import PageReview from "./components/PageReview";
import ScorePanel from "./components/ScorePanel";
import ManualAlign from "./components/ManualAlign";
import { fileToCanvases } from "./utils/imaging";
import { initCv, processCanvas, warpCanvas } from "./utils/cvClient";
import { computeScore } from "./utils/score";
import { flagStats } from "./utils/flags";

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

const amberBtn =
  "rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2";

const UnrecognizedCard = ({ page, onRealign, onRemove }) => (
  <div className="flex items-start gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
    <img
      src={page.thumbUrl}
      alt=""
      className="h-20 w-auto shrink-0 rounded ring-1 ring-amber-200"
    />
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <AlertIcon className="h-4 w-4 shrink-0 text-amber-700" />
        <h3 className="text-sm font-semibold text-amber-900">
          Not recognized as a SCARED form page
        </h3>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-amber-800">
        <span className="font-medium">{page.fileName}</span> didn't match the SCARED
        questionnaire
        {typeof page.inliers === "number" ? ` (only ${page.inliers} alignment points)` : ""}
        , so it isn't included in the score. If it really is a SCARED page that was hard
        to read, align it manually — otherwise remove it.
      </p>
      <div className="mt-3 flex gap-2">
        <button onClick={onRealign} className={amberBtn}>
          Align manually
        </button>
        <button onClick={onRemove} className={amberBtn}>
          Remove
        </button>
      </div>
    </div>
  </div>
);

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

function App() {
  const [pages, setPages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState(null);
  const [manualPageId, setManualPageId] = useState(null);

  const idRef = useRef(0);
  const fileInputRef = useRef(null);
  const openFilePicker = () => fileInputRef.current?.click();

  const pageFromResult = (result, canvas, fileName) => {
    const answers = {};
    result.detection.forEach((d) => {
      answers[d.question] = d.selectedIndex;
    });
    const inliers = result.inliers || 0;
    const recognized = !!result.alignedCanvas && inliers >= RECOGNIZE_MIN;
    const strong = inliers >= STRONG_INLIERS;
    return {
      id: ++idRef.current,
      pageIndex: result.pageIndex,
      label: `Page ${result.pageIndex + 1}`,
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
      alignMode: !recognized ? "unrecognized" : strong ? "auto" : "auto-weak",
      answers,
      detection: result.detection,
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
          canvases.forEach((canvas) => incoming.push({ canvas, name: file.name }));
        } catch (e) {
          setError(`Could not read "${file.name}": ${e.message}`);
        }
      }

      const created = [];
      for (let i = 0; i < incoming.length; i++) {
        setStage(`Reading page ${i + 1} of ${incoming.length}…`);
        const result = await processCanvas(incoming[i].canvas);
        created.push(pageFromResult(result, incoming[i].canvas, incoming[i].name));
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

  const removePage = (id) => setPages((prev) => prev.filter((p) => p.id !== id));

  const applyManual = async (corners) => {
    const page = pages.find((p) => p.id === manualPageId);
    if (!page) return setManualPageId(null);
    setBusy(true);
    setStage("Re-aligning…");
    try {
      const result = await warpCanvas(page.sourceCanvas, corners, page.pageIndex);
      const answers = {};
      result.detection.forEach((d) => {
        answers[d.question] = d.selectedIndex;
      });
      setPages((prev) =>
        prev.map((p) =>
          p.id === manualPageId
            ? {
                ...p,
                alignedUrl: result.alignedCanvas.toDataURL("image/png"),
                detection: result.detection,
                answers,
                confirmed: new Set(),
                recognized: true,
                aligned: true,
                alignMode: "manual",
              }
            : p
        )
      );
    } catch (e) {
      setError(`Manual alignment failed: ${e.message}`);
    } finally {
      setBusy(false);
      setStage("");
      setManualPageId(null);
    }
  };

  const reset = () => {
    setPages([]);
    setError(null);
  };

  const recognizedPages = useMemo(() => pages.filter((p) => p.recognized), [pages]);
  const unrecognizedPages = useMemo(
    () => pages.filter((p) => !p.recognized),
    [pages]
  );

  const score = useMemo(() => {
    const merged = {};
    recognizedPages.forEach((p) => {
      Object.entries(p.answers).forEach(([q, v]) => {
        merged[q] = v;
      });
    });
    return computeScore(merged);
  }, [recognizedPages]);

  const flags = useMemo(() => flagStats(recognizedPages), [recognizedPages]);

  // Completeness / duplicate checks across the recognized pages.
  const presentPages = new Set(recognizedPages.map((p) => p.pageIndex));
  const missingPages = recognizedPages.length
    ? FORM_PAGES.filter((i) => !presentPages.has(i))
    : [];
  const duplicatePages = FORM_PAGES.filter(
    (i) => recognizedPages.filter((p) => p.pageIndex === i).length > 1
  );

  const manualPage = pages.find((p) => p.id === manualPageId);
  const hasPages = pages.length > 0;
  const hasRecognized = recognizedPages.length > 0;

  // Single source of truth for the sticky status bar.
  const status = !hasRecognized
    ? {
        tone: "warn",
        text: "Couldn't recognize a SCARED form in your upload. Make sure you're uploading the child SCARED questionnaire.",
      }
    : missingPages.length
    ? {
        tone: "warn",
        text: `Page ${missingPages
          .map((i) => i + 1)
          .join(" & ")} not uploaded yet — the score is incomplete.`,
      }
    : duplicatePages.length
    ? {
        tone: "warn",
        text: `Two uploads matched Page ${duplicatePages
          .map((i) => i + 1)
          .join(", ")} — remove the duplicate or add the missing page.`,
      }
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
            {hasPages && (
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
        {hasPages && (
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
        <div className="mb-6 max-w-2xl">
          <h2 className="text-sm font-semibold text-slate-900">
            Scan &amp; score a child SCARED questionnaire
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Add photos or scans of both form pages. Answers are detected and scored
            automatically — review the highlighted circles and correct any the scanner
            flagged.
          </p>
        </div>

        <div className="mb-4">
          <Uploader onFiles={handleFiles} busy={busy} />
        </div>

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

        {!hasPages ? (
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
            {unrecognizedPages.length > 0 && (
              <div className="mb-6 space-y-3">
                {unrecognizedPages.map((page) => (
                  <UnrecognizedCard
                    key={page.id}
                    page={page}
                    onRealign={() => setManualPageId(page.id)}
                    onRemove={() => removePage(page.id)}
                  />
                ))}
              </div>
            )}

            {!hasRecognized ? (
              <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white py-12 text-center">
                <p className="text-sm font-medium text-slate-700">
                  No SCARED form recognized yet
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Upload clear photos or scans of both pages of the child SCARED
                  questionnaire to read and score it.
                </p>
              </div>
            ) : (
              <>
                {/* Confident results header */}
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
                    style={{
                      width: `${(score.answered / score.totalQuestions) * 100}%`,
                    }}
                  />
                </div>
              </div>
            </section>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
                  <div className="space-y-6">
                    {recognizedPages.map((page) => (
                      <PageReview
                        key={page.id}
                        page={page}
                        onChangeAnswer={(q, v, confirmed) =>
                          changeAnswer(page.id, q, v, confirmed)
                        }
                        onManualRealign={() => setManualPageId(page.id)}
                        onRemove={() => removePage(page.id)}
                      />
                    ))}
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
          </>
        )}
      </main>

      {/* Shared hidden picker for the "Add page" placeholder buttons. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {manualPage && (
        <ManualAlign
          sourceCanvas={manualPage.sourceCanvas}
          onApply={applyManual}
          onCancel={() => setManualPageId(null)}
        />
      )}
    </div>
  );
}

export default App;

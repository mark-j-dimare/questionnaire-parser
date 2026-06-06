// Shows one aligned page with the detected answers overlaid on the actual form.
// Each answer cell is clickable, so reviewing/correcting is just tapping a circle.

import { QUESTIONS, CANON_WIDTH, CANON_HEIGHT, COLUMN_LABELS } from "../data/scaredForm";
import { flaggedForPage, LOW_CONFIDENCE } from "../utils/flags";

const DISPLAY_WIDTH = 560;
const SCALE = DISPLAY_WIDTH / 612; // box coords are in the 612-wide form space
const DISPLAY_HEIGHT = DISPLAY_WIDTH * (CANON_HEIGHT / CANON_WIDTH);

const CrosshairIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="2" x2="12" y2="6" />
    <line x1="12" y1="18" x2="12" y2="22" />
    <line x1="2" y1="12" x2="6" y2="12" />
    <line x1="18" y1="12" x2="22" y2="12" />
  </svg>
);
const CheckIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

// Small "confirmed by you" badge shown on cells the user has set/confirmed.
const ConfirmBadge = () => (
  <span className="pointer-events-none absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-600 text-white ring-1 ring-white">
    <CheckIcon className="h-2.5 w-2.5" />
  </span>
);

const BASE_CELL =
  "absolute rounded-md p-0 transition-all duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-1 focus-visible:ring-offset-white";

const PageReview = ({ page, onChangeAnswer, onManualRealign }) => {
  const questions = QUESTIONS.filter((q) => q.page === page.pageIndex);
  const detById = new Map(page.detection.map((d) => [d.question, d]));
  const flagged = flaggedForPage(page);

  const isConfirmed = (q) => page.confirmed?.has(q.question);

  const cellClass = (q, i) => {
    const sel = page.answers[q.question];
    const det = detById.get(q.question);
    const lowConf = det && det.confidence < LOW_CONFIDENCE;
    if (sel === i && isConfirmed(q)) {
      // Confirmed by the user — distinct emerald + check badge.
      return "ring-2 ring-emerald-600 bg-emerald-500/45";
    }
    if (sel === i && lowConf) {
      return "ring-2 ring-amber-600 bg-amber-400/40 shadow-[0_0_0_2px_rgba(180,83,9,0.25)]";
    }
    if (sel === i) {
      return "ring-2 ring-green-600 bg-green-500/25";
    }
    if (sel == null) {
      return "border-2 border-dashed border-red-500 bg-red-500/15 hover:bg-red-500/25 motion-safe:animate-pulse";
    }
    return "border border-slate-300/70 hover:border-slate-500 hover:bg-slate-300/40";
  };

  // Click logic: choose an answer (and confirm it); clicking an unconfirmed
  // selection confirms it in place; clicking a confirmed selection clears it.
  const handleCellClick = (q, i) => {
    const sel = page.answers[q.question];
    if (sel === i) {
      if (isConfirmed(q)) onChangeAnswer(q.question, null, false);
      else onChangeAnswer(q.question, i, true);
    } else {
      onChangeAnswer(q.question, i, true);
    }
  };

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <h3 className="text-base font-semibold text-slate-900">{page.label}</h3>
          {page.alignMode === "manual" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-medium text-teal-700 ring-1 ring-teal-200">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-500" aria-hidden="true" />
              Aligned manually
            </span>
          ) : page.aligned ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-800 ring-1 ring-green-200">
              <span className="h-1.5 w-1.5 rounded-full bg-green-600" aria-hidden="true" />
              Auto-aligned · {page.inliers} pts
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-600" aria-hidden="true" />
              Weak alignment — check overlay
            </span>
          )}
        </div>
        <button
          onClick={onManualRealign}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        >
          <CrosshairIcon className="h-3.5 w-3.5" />
          Re-align
        </button>
      </div>

      {flagged.length > 0 && (
        <div
          role="status"
          className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900"
        >
          <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-200 text-[10px] font-bold text-amber-900">
            {flagged.length}
          </span>
          <p>
            <span className="font-semibold">
              {flagged.length} item{flagged.length > 1 ? "s" : ""} need review:
            </span>{" "}
            {flagged.map((q) => `Q${q}`).join(", ")}. Tap the correct circle on the form
            to set or fix.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-4">
        <div className="max-w-full overflow-x-auto">
          <div
            className="relative shrink-0 overflow-hidden rounded-lg ring-1 ring-slate-200"
            style={{ width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT }}
          >
            <img
              src={page.alignedUrl}
              alt={`${page.label} aligned`}
              width={DISPLAY_WIDTH}
              height={DISPLAY_HEIGHT}
              draggable={false}
              className="block"
            />
            {questions.map((q) =>
              q.boxes.map((box, i) => {
                const sel = page.answers[q.question];
                const showBadge = sel === i && isConfirmed(q);
                return (
                  <button
                    key={`${q.question}-${i}`}
                    onClick={() => handleCellClick(q, i)}
                    aria-pressed={sel === i}
                    aria-label={`Q${q.question} — set answer to ${COLUMN_LABELS[i]} (${i})${showBadge ? ", confirmed by you" : ""}`}
                    title={`Q${q.question}. ${q.text} — ${COLUMN_LABELS[i]} (${i})`}
                    className={`${BASE_CELL} ${cellClass(q, i)}`}
                    style={{
                      left: box.x * SCALE,
                      top: box.y * SCALE,
                      width: box.width * SCALE,
                      height: box.height * SCALE,
                    }}
                  >
                    {showBadge && <ConfirmBadge />}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="min-w-[180px] flex-1">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Legend
          </p>
          <ul className="space-y-2 text-xs text-slate-600">
            <li className="flex items-center gap-2">
              <span className="inline-block h-3.5 w-6 rounded-sm bg-green-500/25 ring-2 ring-green-600" />
              Detected — confident
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-3.5 w-6 rounded-sm bg-amber-400/40 ring-2 ring-amber-600" />
              Detected — low confidence, verify
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-3.5 w-6 rounded-sm border-2 border-dashed border-red-500 bg-red-500/15" />
              No answer detected
            </li>
            <li className="flex items-center gap-2">
              <span className="relative inline-block h-3.5 w-6 rounded-sm bg-emerald-500/45 ring-2 ring-emerald-600">
                <span className="absolute -right-1 -top-1 flex h-3 w-3 items-center justify-center rounded-full bg-emerald-600 text-white ring-1 ring-white">
                  <CheckIcon className="h-2 w-2" />
                </span>
              </span>
              Confirmed by you
            </li>
          </ul>
          <p className="mt-3 border-t border-slate-200 pt-3 text-xs leading-relaxed text-slate-500">
            Columns left→right are <strong className="text-slate-700">0</strong>,{" "}
            <strong className="text-slate-700">1</strong>,{" "}
            <strong className="text-slate-700">2</strong>. Click a circle to set or
            confirm it; click a confirmed circle again to clear.
          </p>
        </div>
      </div>
    </div>
  );
};

export default PageReview;

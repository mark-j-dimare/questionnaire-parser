// Manual entry: the whole 41-item SCARED as a blank on-screen form the user
// fills in by eye from the paper/photo. No image processing involved — this is
// the fallback for uploads the scanner can't read, and it scores live.
//
// Built for speed: one row per item, three big targets, and keyboard entry
// (0/1/2 sets an answer and jumps to the next item; arrows move around).

import { QUESTIONS, COLUMN_LABELS } from "../data/scaredForm";

const COL_SHORT = ["Not True / Hardly Ever", "Somewhat / Sometimes", "Very True / Often"];

const cellId = (question, i) => `manual-q${question}-${i}`;

const focusCell = (question, i) => {
  const el = document.getElementById(cellId(question, i));
  if (el) el.focus();
};

const ManualEntry = ({ answers, onChange, onClear, onCopyFromScan, answeredCount }) => {
  const total = QUESTIONS.length;

  const select = (question, i, advance) => {
    // Clicking the already-selected answer clears it.
    onChange(question, answers[question] === i ? null : i);
    if (advance && question < total) focusCell(question + 1, i);
  };

  const handleKeyDown = (e, question, i) => {
    if (e.key >= "0" && e.key <= "2") {
      e.preventDefault();
      select(question, Number(e.key), true);
      return;
    }
    const moves = {
      ArrowLeft: () => focusCell(question, Math.max(0, i - 1)),
      ArrowRight: () => focusCell(question, Math.min(2, i + 1)),
      ArrowUp: () => question > 1 && focusCell(question - 1, i),
      ArrowDown: () => question < total && focusCell(question + 1, i),
    };
    if (moves[e.key]) {
      e.preventDefault();
      moves[e.key]();
    }
  };

  const jumpToFirstUnanswered = () => {
    const next = QUESTIONS.find((q) => answers[q.question] == null);
    if (!next) return;
    focusCell(next.question, 0);
    document
      .getElementById(cellId(next.question, 0))
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const cellClass = (selected) =>
    selected
      ? "border-emerald-600 bg-emerald-500/20 text-emerald-900 font-semibold"
      : "border-slate-300 bg-white text-slate-500 hover:border-slate-500 hover:bg-slate-50";

  return (
    // No `overflow-hidden` here: it would turn this card into a scroll container
    // and break the sticky column header below.
    <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Enter answers by hand
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Read the marked circles off the paper form and tap the matching column.
            Keyboard: press <kbd className="rounded border border-slate-300 bg-slate-50 px-1">0</kbd>{" "}
            <kbd className="rounded border border-slate-300 bg-slate-50 px-1">1</kbd>{" "}
            <kbd className="rounded border border-slate-300 bg-slate-50 px-1">2</kbd> to
            answer and jump to the next item.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onCopyFromScan && (
            <button
              onClick={onCopyFromScan}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              Start from scanned answers
            </button>
          )}
          <button
            onClick={onClear}
            disabled={answeredCount === 0}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
          >
            Clear all
          </button>
        </div>
      </div>

      {/* Progress + sticky column headers */}
      {/* Offsets clear the app header, which wraps to two lines on small screens. */}
      <div className="sticky top-[88px] z-20 sm:top-[61px] border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-3 px-4 pt-2.5 sm:px-5">
          <p className="text-xs text-slate-600" aria-live="polite">
            <span className="font-semibold tabular-nums text-slate-900">
              {answeredCount}
            </span>{" "}
            of <span className="tabular-nums">{total}</span> entered
          </p>
          {answeredCount < total && (
            <button
              onClick={jumpToFirstUnanswered}
              className="text-xs font-medium text-teal-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              Go to next blank
            </button>
          )}
        </div>
        <div className="px-4 pb-2 pt-1.5 sm:px-5">
          <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-teal-500 transition-all motion-reduce:transition-none"
              style={{ width: `${(answeredCount / total) * 100}%` }}
            />
          </div>
        </div>
        <div className="hidden grid-cols-[2.25rem_1fr_repeat(3,6.5rem)] gap-2 px-4 pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid sm:px-5">
          <span />
          <span />
          {COL_SHORT.map((label, i) => (
            <span key={i} className="text-center leading-tight">
              {i} · {label}
            </span>
          ))}
        </div>
      </div>

      <ul className="divide-y divide-slate-100">
        {QUESTIONS.map((q) => {
          const sel = answers[q.question];
          const blank = sel == null;
          return (
            <li
              key={q.question}
              className={`grid grid-cols-[2.25rem_1fr] items-center gap-x-2 gap-y-2 px-4 py-2.5 sm:grid-cols-[2.25rem_1fr_repeat(3,6.5rem)] sm:px-5 ${
                blank ? "bg-amber-50/40" : ""
              }`}
            >
              <span
                className={`text-xs font-semibold tabular-nums ${
                  blank ? "text-amber-700" : "text-slate-400"
                }`}
              >
                {q.question}
              </span>
              <label
                className="text-sm leading-snug text-slate-800"
                id={`manual-label-${q.question}`}
              >
                {q.text}
              </label>
              <div
                role="radiogroup"
                aria-labelledby={`manual-label-${q.question}`}
                className="col-span-2 grid grid-cols-3 gap-2 sm:col-span-3 sm:contents"
              >
                {[0, 1, 2].map((i) => (
                  <button
                    key={i}
                    id={cellId(q.question, i)}
                    role="radio"
                    aria-checked={sel === i}
                    aria-label={`Q${q.question}: ${COLUMN_LABELS[i]} (${i})`}
                    title={`${COLUMN_LABELS[i]} (${i})`}
                    onClick={() => select(q.question, i, true)}
                    onKeyDown={(e) => handleKeyDown(e, q.question, i)}
                    className={`rounded-lg border-2 px-2 py-2 text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-1 ${cellClass(
                      sel === i
                    )}`}
                  >
                    <span className="sm:hidden">
                      {i} · {COL_SHORT[i]}
                    </span>
                    <span className="hidden sm:inline">{i}</span>
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default ManualEntry;

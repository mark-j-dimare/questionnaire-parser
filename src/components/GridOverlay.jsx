// The answer grid drawn ON TOP of the user's own photo, with four draggable
// corner handles.
//
// Why this exists: automatically locating a photographed form is the least
// reliable step in the pipeline, while dragging four corners onto a ruled table
// takes a person about five seconds and essentially never goes wrong. Reading
// 123 cells is the opposite. So the human aligns and the computer reads, which
// means alignment can no longer fail outright -- a page that the scanner cannot
// place is a page the user can place by hand, not a dead end.
//
// The photo itself is never warped for display: the grid is projected onto it
// instead, so the clinician reviews the actual pen strokes rather than an
// interpolated copy. (Detection still works on the rectified image internally.)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QUESTIONS, TABLE_QUADS, CANON_SCALE, COLUMN_LABELS, PAGE_COUNT } from "../data/scaredForm";
import { homographyFromQuads, projectRect } from "../utils/homography";
import { flaggedForPage, LOW_CONFIDENCE } from "../utils/flags";

const DISPLAY_WIDTH = 560;
const HANDLE_LABELS = ["Top-left", "Top-right", "Bottom-right", "Bottom-left"];
const NUDGE = 2; // px per arrow-key press, in display space

// Corners to start from when we have no alignment to inherit: a rectangle
// roughly where the answer table sits on a typical upright photo.
function defaultCorners(w, h) {
  return [
    { x: w * 0.1, y: h * 0.28 },
    { x: w * 0.9, y: h * 0.28 },
    { x: w * 0.9, y: h * 0.93 },
    { x: w * 0.1, y: h * 0.93 },
  ];
}

const GridOverlay = ({
  page,
  sourceCanvas,
  pageIndex,
  initialCorners,
  detection = [],
  answers = {},
  confirmed,
  quality,
  busy,
  onAlign,
  onChangeAnswer,
  onPageIndexChange,
  onShowStraightened,
  onRemove,
}) => {
  const imgUrl = useMemo(() => sourceCanvas.toDataURL("image/png"), [sourceCanvas]);
  const scale = DISPLAY_WIDTH / sourceCanvas.width;
  const displayHeight = sourceCanvas.height * scale;

  const containerRef = useRef(null);
  const dragIndex = useRef(-1);
  const movedRef = useRef(false);

  const [corners, setCorners] = useState(() =>
    initialCorners && initialCorners.length === 4
      ? initialCorners.map((c) => ({ x: c.x * scale, y: c.y * scale }))
      : defaultCorners(DISPLAY_WIDTH, displayHeight)
  );

  // Adopt new corners when the parent re-aligns this page (e.g. a fresh upload).
  useEffect(() => {
    if (initialCorners && initialCorners.length === 4) {
      setCorners(initialCorners.map((c) => ({ x: c.x * scale, y: c.y * scale })));
    }
  }, [initialCorners, scale]);

  const commit = useCallback(
    (next) => onAlign(next.map((c) => ({ x: c.x / scale, y: c.y / scale }))),
    [onAlign, scale]
  );

  const moveActive = (clientX, clientY) => {
    if (dragIndex.current < 0 || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(DISPLAY_WIDTH, clientX - rect.left));
    const y = Math.max(0, Math.min(displayHeight, clientY - rect.top));
    movedRef.current = true;
    setCorners((prev) => prev.map((c, i) => (i === dragIndex.current ? { x, y } : c)));
  };

  const endDrag = () => {
    if (dragIndex.current >= 0 && movedRef.current) commit(corners);
    dragIndex.current = -1;
    movedRef.current = false;
  };

  const nudge = (i, dx, dy) => {
    setCorners((prev) => {
      const next = prev.map((c, j) =>
        j === i
          ? {
              x: Math.max(0, Math.min(DISPLAY_WIDTH, c.x + dx)),
              y: Math.max(0, Math.min(displayHeight, c.y + dy)),
            }
          : c
      );
      commit(next);
      return next;
    });
  };

  // Canonical answer-table quad -> the quad the user has dragged. Everything
  // drawn on the photo goes through this.
  const H = useMemo(
    () => homographyFromQuads(TABLE_QUADS[pageIndex], corners),
    [pageIndex, corners]
  );

  const questions = useMemo(
    () => QUESTIONS.filter((q) => q.page === pageIndex),
    [pageIndex]
  );
  const detById = useMemo(
    () => new Map(detection.map((d) => [d.question, d])),
    [detection]
  );

  const cellStyle = (q, i) => {
    const sel = answers[q.question];
    const det = detById.get(q.question);
    const isConfirmed = confirmed?.has(q.question);
    if (sel === i && isConfirmed) return { fill: "rgba(16,185,129,0.42)", stroke: "#047857" };
    if (sel === i && det && det.confidence < LOW_CONFIDENCE)
      return { fill: "rgba(251,191,36,0.42)", stroke: "#b45309" };
    if (sel === i) return { fill: "rgba(34,197,94,0.30)", stroke: "#15803d" };
    if (sel == null) return { fill: "rgba(239,68,68,0.16)", stroke: "#ef4444", dashed: true };
    return { fill: "transparent", stroke: "rgba(100,116,139,0.45)" };
  };

  // Same click semantics as the aligned review: set/confirm, click again to clear.
  const handleCellClick = (q, i) => {
    const sel = answers[q.question];
    if (sel === i) {
      if (confirmed?.has(q.question)) onChangeAnswer(q.question, null, false);
      else onChangeAnswer(q.question, i, true);
    } else {
      onChangeAnswer(q.question, i, true);
    }
  };

  const quad = corners.map((c) => `${c.x},${c.y}`).join(" ");
  const flagged = page ? flaggedForPage(page) : [];
  const answered = questions.filter((q) => answers[q.question] != null).length;

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="text-base font-semibold text-slate-900">
            {page?.label || `Page ${pageIndex + 1}`}
          </h3>
          {page?.alignMode === "manual" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-medium text-teal-700 ring-1 ring-teal-200">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-500" aria-hidden="true" />
              Aligned by you
            </span>
          ) : page?.aligned ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-800 ring-1 ring-green-200">
              <span className="h-1.5 w-1.5 rounded-full bg-green-600" aria-hidden="true" />
              Auto-aligned · {page.inliers} pts
            </span>
          ) : page?.recognized ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-600" aria-hidden="true" />
              Weak alignment — check the grid
            </span>
          ) : null}
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
            {answered} of {questions.length} read
          </span>
        </div>
        <div className="flex items-center gap-2">
          {PAGE_COUNT > 1 && (
            <div className="flex items-center gap-1 text-xs text-slate-600">
              <span>This is</span>
              <select
                value={pageIndex}
                onChange={(e) =>
                  onPageIndexChange(
                    Number(e.target.value),
                    corners.map((c) => ({ x: c.x / scale, y: c.y / scale }))
                  )
                }
                aria-label="Which page of the form this is"
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              >
                {Array.from({ length: PAGE_COUNT }, (_, i) => (
                  <option key={i} value={i}>
                    Page {i + 1}
                  </option>
                ))}
              </select>
            </div>
          )}
          {onShowStraightened && (
            <button
              onClick={onShowStraightened}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              Straightened view
            </button>
          )}
          {onRemove && (
            <button
              onClick={onRemove}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      <p className="mb-3 text-xs leading-relaxed text-slate-600">
        The detected answers are highlighted on your photo. If any box has drifted
        off its circle, drag the four handles onto the corners of the answer table
        and everything is re-read; a handle can also be nudged with the arrow keys.
      </p>

      {flagged.length > 0 && (
        <div
          role="status"
          className="mb-3 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900"
        >
          <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-200 text-[10px] font-bold text-amber-900">
            {flagged.length}
          </span>
          <p>
            <span className="font-semibold">
              {flagged.length} item{flagged.length > 1 ? "s" : ""} need review:
            </span>{" "}
            {flagged.map((q) => `Q${q}`).join(", ")}. Tap the correct circle on the
            photo to set or fix it.
          </p>
        </div>
      )}

      {quality?.noisy && (
        <div
          role="status"
          className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
        >
          <span className="font-semibold">This page isn&apos;t reading cleanly.</span>{" "}
          The grid may not be lined up yet, or the photo may be too dark, blurry or
          grainy. Answers here shouldn&apos;t be trusted until the boxes sit on the
          circles.
        </div>
      )}

      <div className="flex flex-wrap gap-4">
        <div className="max-w-full overflow-x-auto">
          <div
            ref={containerRef}
            className="relative shrink-0 touch-none select-none overflow-hidden rounded-lg ring-1 ring-slate-200"
            style={{ width: DISPLAY_WIDTH, height: displayHeight }}
            onPointerMove={(e) => moveActive(e.clientX, e.clientY)}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
          >
            <img
              src={imgUrl}
              alt="Uploaded form"
              width={DISPLAY_WIDTH}
              height={displayHeight}
              draggable={false}
              className="block"
            />

            <svg
              className="absolute inset-0"
              width={DISPLAY_WIDTH}
              height={displayHeight}
              role="group"
              aria-label="Answer grid overlay"
            >
              <polygon
                points={quad}
                fill="none"
                stroke="#0d9488"
                strokeWidth="1.5"
                strokeDasharray="6 4"
                pointerEvents="none"
              />
              {H &&
                questions.map((q) =>
                  q.boxes.map((box, i) => {
                    const pts = projectRect(H, {
                      x: box.x * CANON_SCALE,
                      y: box.y * CANON_SCALE,
                      width: box.width * CANON_SCALE,
                      height: box.height * CANON_SCALE,
                    })
                      .map((p) => `${p.x},${p.y}`)
                      .join(" ");
                    const st = cellStyle(q, i);
                    const sel = answers[q.question];
                    return (
                      <polygon
                        key={`${q.question}-${i}`}
                        points={pts}
                        fill={st.fill}
                        stroke={st.stroke}
                        strokeWidth={sel === i ? 2 : 1}
                        strokeDasharray={st.dashed ? "3 2" : undefined}
                        role="button"
                        tabIndex={0}
                        aria-pressed={sel === i}
                        aria-label={`Q${q.question} — set answer to ${COLUMN_LABELS[i]} (${i})`}
                        onClick={() => handleCellClick(q, i)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleCellClick(q, i);
                          }
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <title>{`Q${q.question}. ${q.text} — ${COLUMN_LABELS[i]} (${i})`}</title>
                      </polygon>
                    );
                  })
                )}
            </svg>

            {corners.map((c, i) => (
              <button
                key={i}
                type="button"
                aria-label={`${HANDLE_LABELS[i]} corner of the answer table`}
                title={HANDLE_LABELS[i]}
                onPointerDown={(e) => {
                  e.preventDefault();
                  dragIndex.current = i;
                  movedRef.current = false;
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                }}
                onPointerUp={endDrag}
                onKeyDown={(e) => {
                  const d = { ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0], ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE] }[e.key];
                  if (!d) return;
                  e.preventDefault();
                  nudge(i, d[0], d[1]);
                }}
                className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-[3px] border-white bg-teal-600 shadow-md ring-1 ring-teal-700/40 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                style={{ left: c.x, top: c.y }}
              />
            ))}

            {busy && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/40">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-teal-300 border-t-teal-700" />
              </div>
            )}
          </div>
        </div>

        <div className="min-w-[180px] flex-1">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Legend
          </p>
          <ul className="space-y-2 text-xs text-slate-600">
            <li className="flex items-center gap-2">
              <span className="inline-block h-3.5 w-6 rounded-sm bg-green-500/30 ring-2 ring-green-700" />
              Detected — confident
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-3.5 w-6 rounded-sm bg-amber-400/40 ring-2 ring-amber-700" />
              Detected — low confidence, verify
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-3.5 w-6 rounded-sm border-2 border-dashed border-red-500 bg-red-500/15" />
              No answer detected
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-3.5 w-6 rounded-sm bg-emerald-500/45 ring-2 ring-emerald-700" />
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

export default GridOverlay;

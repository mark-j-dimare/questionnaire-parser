// Fallback alignment: show the original photo and let the user drag four handles
// onto the form's corners. Returns those corners in source-image pixel coords so
// the page can be perspective-warped straight. (Order: TL, TR, BR, BL.)

import { useEffect, useMemo, useRef, useState } from "react";

const DISPLAY_WIDTH = 520;
const HANDLE_LABELS = ["Top-left", "Top-right", "Bottom-right", "Bottom-left"];

const ManualAlign = ({ sourceCanvas, onApply, onCancel }) => {
  const imgUrl = useMemo(() => sourceCanvas.toDataURL("image/png"), [sourceCanvas]);
  const scale = DISPLAY_WIDTH / sourceCanvas.width;
  const displayHeight = sourceCanvas.height * scale;
  const containerRef = useRef(null);
  const dialogRef = useRef(null);
  const dragIndex = useRef(-1);

  // Corners in display coordinates, initialised just inside each corner.
  const [corners, setCorners] = useState(() => {
    const mx = DISPLAY_WIDTH * 0.08;
    const my = displayHeight * 0.08;
    return [
      { x: mx, y: my },
      { x: DISPLAY_WIDTH - mx, y: my },
      { x: DISPLAY_WIDTH - mx, y: displayHeight - my },
      { x: mx, y: displayHeight - my },
    ];
  });

  // Focus the dialog on mount and close on Escape.
  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const moveActive = (clientX, clientY) => {
    if (dragIndex.current < 0 || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(DISPLAY_WIDTH, clientX - rect.left));
    const y = Math.max(0, Math.min(displayHeight, clientY - rect.top));
    setCorners((prev) =>
      prev.map((c, i) => (i === dragIndex.current ? { x, y } : c))
    );
  };

  const handlePointerMove = (e) => moveActive(e.clientX, e.clientY);
  const endDrag = () => {
    dragIndex.current = -1;
  };

  const apply = () => {
    onApply(corners.map((c) => ({ x: c.x / scale, y: c.y / scale })));
  };

  const polygon = corners.map((c) => `${c.x},${c.y}`).join(" ");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="align-title"
        tabIndex={-1}
        className="max-h-[92vh] w-full max-w-[600px] overflow-auto rounded-xl bg-white p-5 shadow-2xl focus:outline-none sm:p-6"
      >
        <h3 id="align-title" className="mb-1 text-base font-semibold text-slate-900">
          Line up the form's corners
        </h3>
        <p className="mb-4 max-w-[520px] text-sm leading-relaxed text-slate-600">
          Drag each handle onto the matching corner of the form (the outer border of the
          answer table works best), then press “Straighten &amp; read”.
        </p>

        <div
          ref={containerRef}
          className="relative touch-none select-none"
          style={{ width: DISPLAY_WIDTH, height: displayHeight }}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
        >
          <img
            src={imgUrl}
            alt="Uploaded form"
            width={DISPLAY_WIDTH}
            height={displayHeight}
            draggable={false}
            className="block rounded-lg ring-1 ring-slate-200"
          />
          <svg
            className="pointer-events-none absolute inset-0"
            width={DISPLAY_WIDTH}
            height={displayHeight}
          >
            <polygon
              points={polygon}
              fill="rgba(13,148,136,0.12)"
              stroke="#0d9488"
              strokeWidth="2"
            />
          </svg>
          {corners.map((c, i) => (
            <div
              key={i}
              role="button"
              tabIndex={0}
              aria-label={`${HANDLE_LABELS[i]} corner`}
              onPointerDown={(e) => {
                e.preventDefault();
                dragIndex.current = i;
                e.currentTarget.setPointerCapture?.(e.pointerId);
              }}
              title={HANDLE_LABELS[i]}
              className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-[3px] border-white bg-teal-600 shadow-md ring-1 ring-teal-700/40 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
              style={{ left: c.x, top: c.y }}
            />
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2 border-t border-slate-200 pt-4">
          <button
            onClick={onCancel}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
          >
            Cancel
          </button>
          <button
            onClick={apply}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
          >
            Straighten &amp; read
          </button>
        </div>
      </div>
    </div>
  );
};

export default ManualAlign;

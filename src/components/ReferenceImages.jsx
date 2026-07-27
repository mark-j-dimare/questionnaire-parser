// Optional side-by-side reference for manual entry: the user's own photo/scan/PDF
// shown next to the blank form so they can read the marked circles off it without
// leaving the page. Purely a viewer — no alignment, no detection, nothing leaves
// the device (the images are decoded to canvases in memory, same as the scanner).

import { useEffect, useRef, useState } from "react";

const ExpandIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);
const CloseIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const ReferenceImages = ({ images, onAdd, onClear, busy }) => {
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef(null);

  const index = Math.min(active, Math.max(0, images.length - 1));

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e) => e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const picker = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*,application/pdf"
      multiple
      className="hidden"
      onChange={(e) => {
        onAdd(e.target.files);
        e.target.value = "";
      }}
    />
  );

  if (!images.length) {
    return (
      <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-4 text-center">
        <p className="text-xs leading-relaxed text-slate-500">
          Optional: add the photo, scan, or PDF of the filled form to read it
          side-by-side while you type.
        </p>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        >
          {busy ? "Loading…" : "Add reference image"}
        </button>
        {picker}
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Reference {images.length > 1 ? `${index + 1} / ${images.length}` : ""}
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setExpanded(true)}
            aria-label="View reference full size"
            title="View full size"
            className="rounded-md border border-slate-300 p-1 text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
          >
            <ExpandIcon className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
          >
            Add
          </button>
          <button
            onClick={onClear}
            className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
          >
            Clear
          </button>
        </div>
      </div>

      <button
        onClick={() => setExpanded(true)}
        className="block w-full cursor-zoom-in overflow-hidden rounded-lg ring-1 ring-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
      >
        <img src={images[index].url} alt={images[index].name} className="block w-full" />
      </button>

      {images.length > 1 && (
        <div className="mt-2 flex gap-1.5 overflow-x-auto">
          {images.map((img, i) => (
            <button
              key={img.id}
              onClick={() => setActive(i)}
              aria-label={`Show reference ${i + 1}`}
              className={`h-12 shrink-0 overflow-hidden rounded ring-1 transition-all ${
                i === index ? "ring-2 ring-teal-600" : "ring-slate-200 hover:ring-slate-400"
              }`}
            >
              <img src={img.url} alt="" className="h-full w-auto" />
            </button>
          ))}
        </div>
      )}
      {picker}

      {expanded && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Reference image, full size"
          className="fixed inset-0 z-50 flex flex-col bg-slate-900/90 p-4"
          onClick={() => setExpanded(false)}
        >
          <div className="mb-2 flex justify-end">
            <button
              onClick={() => setExpanded(false)}
              aria-label="Close full-size view"
              className="rounded-lg bg-white/90 p-2 text-slate-800 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto" onClick={(e) => e.stopPropagation()}>
            <img
              src={images[index].url}
              alt={images[index].name}
              className="mx-auto max-w-none"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ReferenceImages;

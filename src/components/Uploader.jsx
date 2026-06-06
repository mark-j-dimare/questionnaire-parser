// Drag-and-drop / file-picker for form photos, scans, or PDFs.

import { useRef, useState } from "react";

const UploadIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const Uploader = ({ onFiles, busy }) => {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const pick = (files) => {
    if (files && files.length) onFiles(files);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload SCARED form pages"
      aria-busy={busy}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        pick(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      className={`group flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 ${
        dragOver
          ? "border-teal-500 bg-teal-50 shadow-sm"
          : "border-slate-300 bg-white hover:border-teal-400 hover:bg-slate-50"
      } ${busy ? "pointer-events-none opacity-60" : ""}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        aria-label="Upload form images or PDF"
        className="hidden"
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = "";
        }}
      />
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 text-teal-700">
        {busy ? (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-teal-300 border-t-teal-700" aria-hidden="true" />
        ) : (
          <UploadIcon className="h-5 w-5" />
        )}
      </span>
      <p className="text-sm font-medium text-slate-700">
        {busy
          ? "Reading forms…"
          : "Drag form photos or scans here, or click to browse"}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Both pages of the child SCARED form · JPG, PNG, HEIC, or PDF
      </p>
    </div>
  );
};

export default Uploader;

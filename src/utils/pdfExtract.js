// Read answers straight out of a digitally-filled PDF, without any computer vision.
//
// A fillable SCARED PDF already contains the answers as AcroForm field values.
// Rasterising it and then trying to *see* those marks is a lossy detour, and for
// one common export it fails outright: when a generator writes /V on a widget but
// omits its /AP appearance stream, the page renders completely blank. The values
// are still in the file — pdf.js hands them over — so the pixels were never
// needed.
//
// Fields are matched to questions BY GEOMETRY, not by field name. Names vary
// between form editions and vendors ("q1c1", "Check Box 3", "SCARED.item1"...),
// while the widget's rectangle is pinned to the printed cell it sits on, and we
// already have those cells in the same coordinate system.

import * as pdfjsLib from "pdfjs-dist";
import { QUESTIONS, PAGE_COUNT } from "../data/scaredForm";

// Answer-cell boxes are in the form's 612x792 PDF-point space.
const FORM_W = 612;
const FORM_H = 792;

const boxesByPage = QUESTIONS.reduce((acc, q) => {
  (acc[q.page] = acc[q.page] || []).push(q);
  return acc;
}, {});

function findCell(pageBoxes, x, y) {
  for (const q of pageBoxes) {
    for (let i = 0; i < q.boxes.length; i++) {
      const b = q.boxes[i];
      if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
        return { question: q.question, choice: i };
      }
    }
  }
  return null;
}

// Is this button widget switched on? Checkboxes carry their own value; a radio
// kid is on when the group's value equals that kid's export value.
function isOn(a) {
  const v = a.fieldValue;
  if (v == null || v === "" || v === "Off") return false;
  const own = a.buttonValue ?? a.exportValue;
  if (a.radioButton && own != null) return v === own;
  return true;
}

/**
 * @returns one entry per PDF page, in file order:
 *   { pageIndex, answers: {q: 0|1|2}, conflicts: [q], widgets, placed } | null
 * `null` means that page carries no usable form fields and should go through
 * the normal image pipeline.
 */
export async function extractPdfAnswers(file) {
  let pdf;
  try {
    const buffer = await file.arrayBuffer();
    pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  } catch {
    return null; // not readable as a PDF; the caller falls back to pixels
  }

  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      out.push(await extractPage(pdf, i));
    } catch {
      out.push(null);
    }
  }
  return out;
}

async function extractPage(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const annotations = await page.getAnnotations({ intent: "display" });
  const widgets = annotations.filter(
    (a) => a.subtype === "Widget" && a.fieldType === "Btn" && Array.isArray(a.rect)
  );
  if (widgets.length < 3) return null;

  // convertToViewportPoint handles the y-flip AND any /Rotate on the page, which
  // hand-rolled arithmetic on rect[] would get wrong for a rotated scan.
  const viewport = page.getViewport({ scale: 1 });
  const sx = FORM_W / viewport.width;
  const sy = FORM_H / viewport.height;
  const centres = widgets.map((a) => {
    const [x1, y1, x2, y2] = a.rect;
    const [vx, vy] = viewport.convertToViewportPoint((x1 + x2) / 2, (y1 + y2) / 2);
    return { x: vx * sx, y: vy * sy, on: isOn(a) };
  });

  // Which of the form's pages is this? Whichever page's cells the widgets
  // actually land in. Using every widget (not just the ticked ones) makes this
  // a strong signal: a real page puts ~60 widgets on ~60 known cells.
  let best = null;
  for (let p = 0; p < PAGE_COUNT; p++) {
    const pageBoxes = boxesByPage[p] || [];
    let placed = 0;
    const answers = {};
    const seen = {};
    for (const c of centres) {
      const hit = findCell(pageBoxes, c.x, c.y);
      if (!hit) continue;
      placed++;
      if (!c.on) continue;
      seen[hit.question] = (seen[hit.question] || 0) + 1;
      answers[hit.question] = hit.choice;
    }
    // More than one ticked box in a row is a correction or a stray -- surface it
    // for review rather than silently taking the last one.
    const conflicts = Object.keys(seen)
      .filter((q) => seen[q] > 1)
      .map(Number);
    conflicts.forEach((q) => delete answers[q]);
    if (!best || placed > best.placed) {
      best = { pageIndex: p, answers, conflicts, widgets: widgets.length, placed };
    }
  }

  // Require most widgets to sit on known cells; otherwise this is some other
  // fillable PDF that happens to have buttons on it.
  if (!best || best.placed < Math.max(3, widgets.length * 0.5)) return null;
  return best;
}

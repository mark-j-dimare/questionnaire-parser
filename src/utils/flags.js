// Shared "needs review" logic so the per-page banner (PageReview) and the global
// results header (App) always agree on what counts as flagged.

export const LOW_CONFIDENCE = 0.4;

// Returns the question numbers on a page that need human review: either no answer
// is set, or the auto-detected answer was low-confidence AND the user hasn't yet
// confirmed it. A user-confirmed answer is never flagged.
export function flaggedForPage(page, low = LOW_CONFIDENCE) {
  const confirmed = page.confirmed || new Set();
  return page.detection
    .filter((d) => {
      const sel = page.answers[d.question];
      if (sel == null) return true; // no answer → needs review
      if (confirmed.has(d.question)) return false; // user confirmed → cleared
      return d.confidence < low; // auto answer, low confidence → needs review
    })
    .map((d) => d.question);
}

// Aggregate flag stats across all pages, for the results header.
export function flagStats(pages, low = LOW_CONFIDENCE) {
  let total = 0;
  let pagesWithFlags = 0;
  pages.forEach((p) => {
    const n = flaggedForPage(p, low).length;
    if (n > 0) {
      total += n;
      pagesWithFlags += 1;
    }
  });
  return { total, pagesWithFlags };
}

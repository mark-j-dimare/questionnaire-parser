// Tally SCARED total + subscale scores from the (reviewed) answers.

import { SUBSCALES, TOTAL_CUTOFF, QUESTIONS } from "../data/scaredForm";

// `answers` is a map of question number -> selectedIndex (0/1/2) or null.
export function computeScore(answers) {
  const byCategory = {};
  let total = 0;
  let answered = 0;
  let unanswered = 0;

  for (const q of QUESTIONS) {
    const value = answers[q.question];
    if (value === 0 || value === 1 || value === 2) {
      total += value;
      byCategory[q.category] = (byCategory[q.category] || 0) + value;
      answered++;
    } else {
      unanswered++;
    }
  }

  const subscales = SUBSCALES.map((s) => {
    const score = byCategory[s.key] || 0;
    return { ...s, score, elevated: score >= s.cutoff };
  });

  return {
    total,
    totalCutoff: TOTAL_CUTOFF,
    totalElevated: total >= TOTAL_CUTOFF,
    subscales,
    answered,
    unanswered,
    totalQuestions: QUESTIONS.length,
  };
}

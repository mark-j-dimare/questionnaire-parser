import { childQuestionnaireMap } from "../data/childQuestionnaireMap";

// Helper to determine which box (0/1/2) was checked for a given question
export function getSelectedAnswerForQuestion(questionEntry, imageData) {
  const { boxes } = questionEntry;

  // Simulate detection logic (replace this with actual pixel analysis)
  const selectedIndex = boxes.findIndex((box) => {
    // placeholder: you’ll replace this with actual checkbox detection
    return box.checked === true;
  });

  return selectedIndex >= 0 ? selectedIndex : null;
}

export function analyzeAnswers(checkedBoxes) {
  const categoryScores = {};
  let totalScore = 0;

  childQuestionnaireMap.forEach((question) => {
    const selected = checkedBoxes.find(
      (box) => box.question === question.question
    );

    if (selected && selected.selectedIndex != null) {
      const value = selected.selectedIndex; // 0, 1, or 2
      totalScore += value;

      if (!categoryScores[question.category]) {
        categoryScores[question.category] = 0;
      }

      categoryScores[question.category] += value;
    }
  });

  return {
    categoryScores,
    totalScore,
  };
}



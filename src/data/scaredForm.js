// SCARED (Child version, 41 items) form definition + scoring config.
//
// The answer-cell coordinates live in childQuestionnaireMap.js in the form's
// canonical PDF coordinate space (612 x 792, i.e. scale 1). We render/align
// every page to CANON_SCALE x that size, so multiply box coords by CANON_SCALE
// when reading pixels from an aligned page.

import { childQuestionnaireMap } from "./childQuestionnaireMap";
import blankP0 from "../assets/reference/blank_p0.png";
import blankP1 from "../assets/reference/blank_p1.png";

// Reference (blank-form) images used as the alignment templates. These were
// rendered from SCARED-form-child.pdf at 2x → 1224 x 1584.
export const CANON_SCALE = 2;
export const CANON_WIDTH = 612 * CANON_SCALE; // 1224
export const CANON_HEIGHT = 792 * CANON_SCALE; // 1584
export const REFERENCE_PAGES = [blankP0, blankP1];
export const PAGE_COUNT = REFERENCE_PAGES.length;

// Column 0/1/2 maps directly to the SCARED item score 0/1/2.
export const COLUMN_LABELS = [
  "Not True / Hardly Ever",
  "Somewhat / Sometimes",
  "Very True / Often",
];

// Faithful text of each item (1-indexed → array index = question - 1).
const QUESTION_TEXT = [
  "When I feel frightened, it is hard for me to breathe",
  "I get headaches when I am at school",
  "I don't like to be with people I don't know well",
  "I get scared if I sleep away from home",
  "I worry about other people liking me",
  "When I get frightened, I feel like passing out",
  "I am nervous",
  "I follow my mother or father wherever they go",
  "People tell me that I look nervous",
  "I feel nervous with people I don't know well",
  "I get stomachaches at school",
  "When I get frightened, I feel like I am going crazy",
  "I worry about sleeping alone",
  "I worry about being as good as other kids",
  "When I get frightened, I feel like things are not real",
  "I have nightmares about something bad happening to my parents",
  "I worry about going to school",
  "When I get frightened, my heart beats fast",
  "I get shaky",
  "I have nightmares about something bad happening to me",
  "I worry about things working out for me",
  "When I get frightened, I sweat a lot",
  "I am a worrier",
  "I get really frightened for no reason at all",
  "I am afraid to be alone in the house",
  "It is hard for me to talk with people I don't know well",
  "When I get frightened, I feel like I am choking",
  "People tell me that I worry too much",
  "I don't like to be away from my family",
  "I am afraid of having anxiety (or panic) attacks",
  "I worry that something bad might happen to my parents",
  "I feel shy with people I don't know well",
  "I worry about what is going to happen in the future",
  "When I get frightened, I feel like throwing up",
  "I worry about how well I do things",
  "I am scared to go to school",
  "I worry about things that have already happened",
  "When I get frightened, I feel dizzy",
  "I feel nervous when I am with other children or adults and I have to do something while they watch me (for example: read aloud, speak, play a game, play a sport)",
  "I feel nervous when I am going to parties, dances, or any place where there will be people that I don't know well",
  "I am shy",
];

// Each question: { question, category, page, boxes, text }
export const QUESTIONS = childQuestionnaireMap.map((q) => ({
  ...q,
  text: QUESTION_TEXT[q.question - 1] || `Question ${q.question}`,
}));

// Official SCARED scoring thresholds.
export const TOTAL_CUTOFF = 25; // total >= 25 may indicate an anxiety disorder
export const SUBSCALES = [
  {
    key: "panic-somatic",
    label: "Panic / Somatic",
    cutoff: 7,
    note: "may indicate Panic Disorder or significant somatic symptoms",
  },
  {
    key: "generalized-anxiety",
    label: "Generalized Anxiety",
    cutoff: 9,
    note: "may indicate Generalized Anxiety Disorder",
  },
  {
    key: "separation",
    label: "Separation Anxiety",
    cutoff: 5,
    note: "may indicate Separation Anxiety Disorder",
  },
  {
    key: "social",
    label: "Social Anxiety",
    cutoff: 8,
    note: "may indicate Social Anxiety Disorder",
  },
  {
    key: "school-avoidance",
    label: "School Avoidance",
    cutoff: 3,
    note: "may indicate significant school avoidance",
  },
];

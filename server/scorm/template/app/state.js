// app/state.js

// App state
var state = {
  phase: 'start',
  currentIndex: 0,
  currentPageIndex: 0,
  answers: {},
  variant: null,
  flatQuestions: [],
  pageSequence: [],
  templateManifest: null,
  templateShell: null,
  templateLayouts: {},
  shuffleMappings: {},
  matchingPools: {},
  timerInterval: null,
  remainingSeconds: null,
  timeExpired: false,
  submitted: false,
  answerConfirmed: false,
  feedbackShown: false,
  attemptSavedForThisSession: false,
  
  // Adaptive mode state
  adaptiveState: null, // Will be initialized for adaptive tests

  // PRD-4 v1.1 §4.4: per-section results, frozen when the learner enters the
  // first `after_topic` content page for that section. Map of topicId -> the
  // same shape topicResults entries carry in `calculateResults()` output.
  // Templates bind via `TEST_DATA.section.current.result.*`.
  sectionResults: {},
};

// SCORM finish guard
var scormFinished = false;

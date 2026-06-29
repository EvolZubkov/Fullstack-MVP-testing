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

  // PRD-19 (Block B): per-question navigation status, keyed by question.id.
  // 'unanswered' (initial) | 'answered' (explicit fixation via confirmAnswer)
  // | 'skipped' (learner used «Пропустить»). Drives the progress pills and the
  // обзор screen; seeded in generateVariant(), persisted inside suspend_data.
  questionStatuses: {},
  // PRD-19 (Block B): per-section answer-commit freeze, keyed by topicId. Set
  // true on section exit when answerCommitScope === 'section' (sectional modes),
  // locking that section's answers against further edits even if allowAnswerChange.
  sectionCommitted: {},

  // Adaptive mode state
  adaptiveState: null, // Will be initialized for adaptive tests

  // PRD-4 v1.1 §4.4: per-section results, frozen when the learner enters the
  // first `after_topic` content page for that section. Map of topicId -> the
  // same shape topicResults entries carry in `calculateResults()` output.
  // Templates bind via `TEST_DATA.section.current.result.*`.
  sectionResults: {},

  // PRD-4 v1.1 §4.7 router_by_topics: state machine for router navigation.
  // - routerTopicStates: per-topic completion status. 'notStarted' before
  //   the learner picks the topic from the router; 'inProgress' after pick;
  //   'completed' after the topic chunk finishes (sectionResult frozen).
  // - currentRouterTopic: the topicId currently being traversed (null while
  //   the router itself is on screen).
  // - routerFinished: true when the learner triggers the «Завершить» action
  //   from the router (completionPolicy is satisfied). Switches the page
  //   sequence to the post-router test-after content + results.
  routerTopicStates: {},
  currentRouterTopic: null,
  routerFinished: false,

  // PRD-4 v1.1 §3.2 / Phase 4e: per-section timer. Active when the learner
  // is inside a section with a non-null section.timeLimitMinutes. Started
  // by contentFlow / routerFlow at section entry; stopped on section exit
  // or expiry. Shape: { topicId, limitMinutes, remainingSeconds, expired,
  // onExpire, intervalId } or null.
  sectionTimer: null,
};

// SCORM finish guard
var scormFinished = false;

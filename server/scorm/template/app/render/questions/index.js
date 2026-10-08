function renderQuestionInput(q) {
  var answer = state.answers[q.id];
  // Answer-review highlighting (correct/wrong/partial) is shown ONLY when the test
  // enables «показывать правильность ответа» (showCorrectAnswers) — NEVER on the mere
  // fact that an answer is committed/frozen, which would leak the key with the setting
  // off (web parity: take-test gates reviewMode on showCorrectAnswers). Interaction is
  // guarded separately by the delegated handlers (isAnswerLocked), so read-only after
  // commit still holds without this flag.
  var fqCur = (state.flatQuestions || [])[state.currentIndex];
  var showReview = TEST_DATA.showCorrectAnswers &&
    (state.feedbackShown || (typeof isAnswerLocked === 'function' && isAnswerLocked(fqCur)));
  var correct = q.correct || {};
  var shuffleMapping = state.shuffleMappings[q.id];

  // «Сценарий в ИС» в обычном разделе (техдолг №5): на месте ответа — обложка из общего
  // `shared/sim/cover` (та же разметка, что у веба); прогон открывает «Пройти» → окно правил.
  if (typeof TBQType !== 'undefined' && TBQType.isSimulation(q.type)) {
    var TBs = (typeof window !== 'undefined') ? window.TBTemplate : null;
    if (!TBs || !TBs.renderSimCover) return '';
    var scenario = (q.data && q.data.scenario) || null;
    return TBs.renderSimCover({
      state: TBs.simCoverState(answer),
      shotUrl: TBs.simCoverShot(scenario),
      retake: !!TEST_DATA.allowAnswerChange,
      readonly: typeof isAnswerLocked === 'function' && fqCur ? isAnswerLocked(fqCur) : false,
    });
  }

  // The type hint is the question subtitle (state.questionHint in the layout, both
  // hosts) — not prepended here, so the package matches the web exactly.
  if (q.type === 'single')   return renderSingleQuestionInput(q, answer, showReview, correct, shuffleMapping);
  // The scale takes no shuffle mapping: its graduation order is content (PRD-26 FR-04).
  if (q.type === 'scale')    return renderScaleQuestionInput(q, answer, showReview, correct);
  if (q.type === 'multiple') return renderMultipleQuestionInput(q, answer, showReview, correct, shuffleMapping);
  if (q.type === 'matching') return renderMatchingQuestionInput(q, answer, showReview, correct, shuffleMapping);
  if (q.type === 'ranking')  return renderRankingQuestionInput(q, answer, showReview, correct, shuffleMapping);
  // PRD-44: у распределения нет эталона, поэтому showReview означает «только чтение».
  if (typeof TBQType !== 'undefined' && TBQType.distributesBudget(q.type)) {
    // Предзаполнение минимумом (FR-30) — зеркало веб-хоста. Без него учащийся с
    // ненулевым минимумом распределит бюджет и застрянет с утверждением, которое
    // уже нечем поднять.
    var TBa = (typeof window !== 'undefined') ? window.TBTemplate : null;
    if (TBa && TBa.seedAllocation && (answer === undefined || answer === null)) {
      var seed = TBa.seedAllocation(TBa.allocationSpec(q.data));
      if (Object.keys(seed).length > 0) {
        state.answers[q.id] = seed;
        answer = seed;
      }
    }
    return renderAllocationQuestionInput(q, answer, showReview, shuffleMapping);
  }
  // PRD-57 §6.5: текстовый ввод — ветка по ПРИЗНАКУ, чтобы пропуски (Э8) вошли сюда же.
  if (typeof TBQType !== 'undefined' && TBQType.isTextEntry(q.type)) {
    return renderShortQuestionInput(q, answer, showReview);
  }
  // PRD-57 §5: развёрнутый ответ. Своя ветка, а не общая с коротким: у пакета СВОЙ
  // распределитель, и тип, забытый здесь, уезжает в LMS «неизвестным» при живом вебе.
  if (typeof TBQType !== 'undefined' && TBQType.isOpenText(q.type)) {
    var TBl = (typeof window !== 'undefined') ? window.TBTemplate : null;
    if (!TBl || !TBl.renderLongAnswer) return '';
    return TBl.renderLongAnswer({ type: q.type, dataJson: q.data }, answer, { readonly: !!showReview });
  }
  return '<div>Неизвестный тип вопроса</div>';
}

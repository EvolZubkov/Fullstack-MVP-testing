/**
 * @module scorm/template/app/render/simulation
 *
 * «Сценарий в ИС» в пакете (этап Э4, docs/specs/sim-scenario/plan-tests.md). Вопрос-сценарий
 * играется НА МЕСТЕ экрана вопроса: плеер `shared/sim/player` (`TBTemplate.mountPlayer`, тот же
 * код, что у веба) монтируется слоем на всё окно, а после окна результата пакет идёт дальше сам —
 * в роутере обратно в хаб, в тесте «Сценарий» к итогам.
 *
 * Что пишется в попытку. В `state.answers` — КОМПАКТНЫЙ прогон: исход, доля цели и счётчики.
 * Ровно это читает оценка (`TBTemplate.simulationRatio`), и только это помещается в
 * `cmi.suspend_data` (кодек `TBRunState`, бюджет PRD-36). Протокол действий в `suspend_data` не
 * идёт: он уезжает телеметрией вместе с полным результатом, а в отчёт LMS — сжатым кодеком
 * `shared/sim/protocol-codec` (поле `protocol` ответа живёт одну сессию SCO).
 *
 * Перерисовки. `render()` пакета вызывается на каждом переходе, в том числе таймером. Плеер,
 * однажды смонтированный, держится, пока текущий экран — тот же вопрос-сценарий: перерисовка не
 * перезапускает прогон. Ушёл экран (истекло время теста, итоги) — слой снимается
 * (`TBSimRun.beginRender` / `endRender` обрамляют каждую отрисовку).
 */
var TBSimRun = (function () {
  /** Слой плеера, его плеер и вопрос, для которого он смонтирован. */
  var mounted = null;
  /** Глубина вложенных `render()` и признак, что текущая отрисовка — экран сценария. */
  var depth = 0;
  var claimed = false;

  /** Попросить у браузера полный экран — ТОЛЬКО из обработчика щелчка, иначе откажет. */
  function requestFullscreen() {
    try {
      var el = document.documentElement;
      if (el && el.requestFullscreen) {
        var p = el.requestFullscreen();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
    } catch (e) { /* браузер отказал — плеер всё равно ляжет на всё окно */ }
  }

  function exitFullscreen() {
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        var p = document.exitFullscreen();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
    } catch (e) { /* нечего выходить */ }
  }

  function unmount() {
    if (!mounted) return;
    try { mounted.player.destroy(); } catch (e) { /* уже разобран */ }
    if (mounted.host.parentNode) mounted.host.parentNode.removeChild(mounted.host);
    mounted = null;
    exitFullscreen();
  }

  /** Компактный прогон: то, что читает оценка, и ничего больше. */
  function compact(result) {
    var c = (result && result.counts) || {};
    return {
      outcome: result.outcome,
      goal: result.goal ? { share: result.goal.share } : null,
      counts: {
        misses: c.misses || 0,
        blocked: c.blocked || 0,
        wrongValues: c.wrongValues || 0,
        detours: c.detours || 0,
        traps: c.traps || 0,
        hints: c.hints || 0,
      },
      durationMs: result.durationMs || 0,
    };
  }

  /** Сценарий вопроса, ограниченный остатком времени теста (как на вебе). */
  function playedScenario(scenario) {
    var left = (state.sectionTimer && typeof state.sectionTimer.remainingSeconds === 'number')
      ? state.sectionTimer.remainingSeconds
      : state.remainingSeconds;
    var own = scenario.settings && typeof scenario.settings.limitSeconds === 'number'
      ? scenario.settings.limitSeconds
      : null;
    if (typeof left !== 'number' || left <= 0 || (own !== null && own <= left)) return scenario;
    var settings = {};
    for (var k in (scenario.settings || {})) settings[k] = scenario.settings[k];
    settings.limitSeconds = Math.floor(left);
    var copy = {};
    for (var key in scenario) copy[key] = scenario[key];
    copy.settings = settings;
    return copy;
  }

  /** Куда идти после прогона: роутер — в хаб, иначе следующий экран или итоги. */
  function continueAfter() {
    if (typeof RouterFlow !== 'undefined' && RouterFlow.isRouterMode && RouterFlow.isRouterMode()) {
      RouterFlow.returnFromTopic();
      return;
    }
    if (state.currentIndex >= state.flatQuestions.length - 1) {
      submit(true);
      return;
    }
    advanceAfterCommit();
  }

  /** Записать прогон в попытку: компактный ответ, статус, телеметрия, сохранение. */
  function record(fq, result) {
    var q = fq.question;
    var answer = compact(result);
    // Протокол для отчёта LMS (`sim_<id>_<n>`, `resultsPage.js`) — только в памяти: кодек
    // `suspend_data` его не пишет. Поэтому ответ лучшей попытки, восстановленный из
    // `suspend_data`, протокола не несёт, и чужой протокол к нему не приклеится.
    try {
      var encoded = TBTemplate.encodeSimProtocol(result && result.events, result && result.durationMs);
      if (encoded) answer.protocol = encoded;
    } catch (e) { /* без протокола уедут исход и счётчики */ }
    state.answers[q.id] = answer;
    state.questionStatuses[q.id] = 'answered';
    if (typeof TBQuestionTime !== 'undefined') TBQuestionTime.leave();
    // Полный результат — с протоколом — только телеметрии: в попытку он не помещается.
    if (typeof reportAnswerTelemetry === 'function') reportAnswerTelemetry(fq, result);
    if (typeof saveSessionState === 'function') saveSessionState();
  }

  /**
   * Экран вопроса-сценария. Уже отвеченный сценарий (возврат после перезагрузки) повторно не
   * играется — пакет идёт дальше, как после окна результата.
   */
  function render(fq) {
    claimed = true;
    var q = fq.question;
    if (state.questionStatuses[q.id] === 'answered') {
      unmount();
      continueAfter();
      return;
    }
    if (mounted && mounted.questionId === q.id) return;
    unmount();

    var app = document.getElementById('app');
    if (app) app.innerHTML = '';
    var host = document.createElement('div');
    host.className = 'tb-sim-host';
    host.setAttribute('data-testid', 'scenario-player');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#fff';
    document.body.appendChild(host);

    var router = typeof RouterFlow !== 'undefined' && RouterFlow.isRouterMode && RouterFlow.isRouterMode();
    var finished = null;
    var player = TBTemplate.mountPlayer(host, {
      scenario: playedScenario((q.data && q.data.scenario) || {}),
      // Адреса медиа уже переписаны упаковщиком на файлы внутри пакета.
      mediaUrl: function (file) { return file; },
      showDetails: true,
      caption: TEST_DATA.title || '',
      closeLabel: router ? 'Вернуться к разделам' : 'Перейти к итогам',
      onFinish: function (result) {
        finished = result;
        record(fq, result);
      },
      onClose: function (result) {
        if (!finished && result) record(fq, result);
        unmount();
        continueAfter();
      },
    });
    mounted = { host: host, player: player, questionId: q.id };
  }

  /** Начало отрисовки экрана: пока экран не объявил себя сценарием, слой подлежит снятию. */
  function beginRender() {
    if (depth === 0) claimed = false;
    depth += 1;
  }

  /** Конец отрисовки: экран оказался не сценарием — слой снимается. */
  function endRender() {
    depth -= 1;
    if (depth === 0 && !claimed) unmount();
  }

  return {
    render: render,
    beginRender: beginRender,
    endRender: endRender,
    requestFullscreen: requestFullscreen,
    compact: compact,
  };
}());

if (typeof window !== 'undefined') window.TBSimRun = TBSimRun;

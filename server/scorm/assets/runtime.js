// SCORM 2004 API Wrapper
var SCORM = (function() {
  var API = null;
  var initialized = false;

  function findAPI(win) {
    var attempts = 0;
    while (win && attempts < 500) {
      if (win.API_1484_11) return win.API_1484_11;
      if (win.parent === win) break;
      win = win.parent;
      attempts++;
    }
    return null;
  }

  function getAPI() {
    if (API) return API;
    API = findAPI(window);
    if (!API && window.opener) {
      API = findAPI(window.opener);
    }
    return API;
  }

  function log(msg) {
    if (console && console.log) console.log('[SCORM] ' + msg);
  }

  return {
    init: function() {
      var api = getAPI();
      if (!api) {
        log('API not found - running in standalone mode');
        return true;
      }
      // PRD-31: the retake gate now opens the session itself (it must read
      // suspend_data to tell a new assignment from a re-entry), and runCourse calls
      // init again on the allowed path. A second Initialize is an error state in the
      // SCORM 2004 API — error 103, "already initialized" — so the wrapper makes the
      // repeat a no-op rather than letting the LMS log a spurious failure.
      if (initialized) {
        log('Initialize: already initialized, skipped');
        return true;
      }
      var result = api.Initialize("");
      initialized = (result === "true" || result === true);
      log('Initialize: ' + result);
      return initialized;
    },

    getValue: function(key) {
      var api = getAPI();
      if (!api) return "";
      return api.GetValue(key);
    },

    setValue: function(key, value) {
      var api = getAPI();
      if (!api) {
        log('setValue (standalone): ' + key + ' = ' + value);
        return true;
      }
      var result = api.SetValue(key, String(value));
      log('SetValue ' + key + ' = ' + value + ' -> ' + result);
      return result === "true" || result === true;
    },

    commit: function() {
      var api = getAPI();
      if (!api) return true;
      var result = api.Commit("");
      log('Commit: ' + result);
      return result === "true" || result === true;
    },

    terminate: function() {
      var api = getAPI();
      if (!api) return true;
      var result = api.Terminate("");
      log('Terminate: ' + result);
      initialized = false;
      return result === "true" || result === true;
    },

    setScore: function(raw, min, max, scaled) {
      this.setValue('cmi.score.raw', raw);
      this.setValue('cmi.score.min', min);
      this.setValue('cmi.score.max', max);
      this.setValue('cmi.score.scaled', scaled);
    },

    setCompletion: function(status) {
      this.setValue('cmi.completion_status', status);
    },

    setSuccess: function(status) {
      this.setValue('cmi.success_status', status);
    },

    /**
     * Write ONE objective, built by `buildTopicObjective`.
     *
     * The id goes first: until it is set the objective does not exist for the LMS, and
     * writing any other element of it is an error. Absent parts are SKIPPED rather than
     * written empty — a measurement topic must report «no score», which is not the same
     * as a score of zero.
     *
     * @param {number} index position in `cmi.objectives`
     * @param {{id: string, description: string, score: ?{raw: number, min: number, max: number, scaled: number}, success: string, completion: string}} objective
     */
    setObjective: function(index, objective) {
      var base = 'cmi.objectives.' + index + '.';
      this.setValue(base + 'id', objective.id);

      // description is a localized_string_type — SPM 250 characters.
      if (objective.description) {
        this.setValue(base + 'description', String(objective.description).slice(0, 250));
      }

      if (objective.score) {
        this.setValue(base + 'score.raw', objective.score.raw);
        this.setValue(base + 'score.min', objective.score.min);
        this.setValue(base + 'score.max', objective.score.max);
        this.setValue(base + 'score.scaled', objective.score.scaled);
      }

      this.setValue(base + 'success_status', objective.success);
      this.setValue(base + 'completion_status', objective.completion || 'completed');
    },

    /**
     * Write ONE interaction.
     *
     * `latency` is the time the learner spent on the question, an ISO 8601 duration. Absent
     * (empty) means «not measured» — a question that was never shown, or a package resumed
     * mid-run — and is then SKIPPED rather than written as a zero, the same rule description
     * and correct pattern already follow: «PT0S» would claim an instant answer.
     */
    setInteraction: function(index, id, type, result, learnerResponse, correctPattern, description, latency) {
      this.setValue('cmi.interactions.' + index + '.id', id);
      this.setValue('cmi.interactions.' + index + '.type', type);
      this.setValue('cmi.interactions.' + index + '.result', result);
      this.setValue('cmi.interactions.' + index + '.learner_response', learnerResponse);

      log('Interaction ' + index + ' correctPattern=' + correctPattern);
      log('Interaction ' + index + ' description=' + description);

      // ✅ "Верный ответ" в WebSoft
      if (correctPattern !== undefined && correctPattern !== null && String(correctPattern) !== '') {
        this.setValue('cmi.interactions.' + index + '.correct_responses.0.pattern', correctPattern);
      }

      // ✅ "Описание" (можно положить текст вопроса)
      if (description) {
        this.setValue('cmi.interactions.' + index + '.description', description);
      }

      // Время на задании — колонка «Продолжительность (сек.)» отчёта LMS.
      if (latency) {
        this.setValue('cmi.interactions.' + index + '.latency', latency);
      }
    },


    /**
     * Neutralize ONE interaction left over from an earlier report of this SCO session.
     *
     * SCORM 2004 has no way to delete an interaction: the collection only grows, and
     * `_count` is read-only. A retry whose report is shorter than the previous one would
     * leave that report's tail in the record, read by the LMS report and by the PRD-54
     * import as answers of the CURRENT attempt. The row is therefore rewritten as a
     * `void_<n>` marker the import skips. If the LMS refuses to rename or retype a row it
     * already holds, the old id and type stay and only the answer, outcome and description
     * are cleared — the row then no longer claims an answer the learner gave.
     *
     * @param {number} index position in `cmi.interactions`
     */
    voidInteraction: function(index) {
      var base = 'cmi.interactions.' + index + '.';
      var renamed = this.setValue(base + 'id', 'void_' + index);
      var retyped = renamed && this.setValue(base + 'type', 'other');
      if (retyped) this.setValue(base + 'correct_responses.0.pattern', '');
      this.setValue(base + 'result', 'neutral');
      this.setValue(base + 'learner_response', '');
      this.setValue(base + 'description', 'Не относится к попытке');
    },

    /**
     * Close the attempt: score, verdict, objectives, interactions.
     *
     * `earnedPoints === null` means the run had NOTHING to grade (a questionnaire, an
     * allocation of points), and then no `cmi.score` is written at all — SCORM 2004 allows
     * the element to be absent, whereas `raw = 0 / max = 100` would claim the learner scored
     * nothing under a threshold that was never applied. The verdict is unaffected: such a run
     * passes by construction. This is the same rule `setObjective` already follows one level
     * down, for the objective of a measurement topic.
     */
    /**
     * @param {boolean|null} passed `null` — оценка ещё не выставлена (PRD-57 FR-40):
     *   в попытке есть ответ, который никто не проверял. SCORM 2004 предусматривает
     *   `unknown` ровно для этого случая, и писать туда `failed` нельзя: «не сдал» в
     *   отчёте LMS по непроверенной работе — это претензия участника, а не неточность.
     */
    finish: function(earnedPoints, possiblePoints, passed, objectives, interactions) {
      // Rows already in the record: a retry inside the same SCO session reports again, and
      // whatever the previous report wrote beyond the new set must be neutralized below.
      var previousCount = parseInt(this.getValue('cmi.interactions._count'), 10) || 0;

      // Report earned points as raw score, possible points as max, scaled as ratio
      if (earnedPoints !== null && earnedPoints !== undefined) {
        var scaled = possiblePoints > 0 ? earnedPoints / possiblePoints : 0;
        this.setScore(earnedPoints, 0, possiblePoints, scaled);
      }
      this.setCompletion('completed');
      this.setSuccess(passed === null ? 'unknown' : (passed ? 'passed' : 'failed'));
      if (passed) this.setValue('cmi.progress_measure', '1');
      this.setValue('cmi.exit', 'normal');
      this.setValue('cmi.location', '');


      for (var i = 0; i < objectives.length; i++) {
        this.setObjective(i, objectives[i]);
      }

      for (var j = 0; j < interactions.length; j++) {
        var int = interactions[j];
        this.setInteraction(
          j,
          int.id,
          int.type,
          int.result,
          int.response,
          int.correct,      // ✅ новое поле
          int.description,  // ✅ новое поле
          int.latency       // время на задании, пусто = не измерялось
        );
      }

      for (var k = interactions.length; k < previousCount; k++) {
        this.voidInteraction(k);
      }

      this.commit();
      // this.terminate();
    }
  };
})();

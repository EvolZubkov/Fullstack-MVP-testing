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

    setObjective: function(index, id, scoreRaw, successStatus) {
      this.setValue('cmi.objectives.' + index + '.id', id);
      this.setValue('cmi.objectives.' + index + '.score.raw', scoreRaw);
      this.setValue('cmi.objectives.' + index + '.success_status', successStatus);
      this.setValue('cmi.objectives.' + index + '.completion_status', 'completed');
    },

    setInteraction: function(index, id, type, result, learnerResponse, correctPattern, description) {
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
    },


    finish: function(earnedPoints, possiblePoints, passed, objectives, interactions) {
      // Report earned points as raw score, possible points as max, scaled as ratio
      var scaled = possiblePoints > 0 ? earnedPoints / possiblePoints : 0;
      this.setScore(earnedPoints, 0, possiblePoints, scaled);
      this.setCompletion('completed');
      this.setSuccess(passed ? 'passed' : 'failed');
      if (passed) this.setValue('cmi.progress_measure', '1');
      this.setValue('cmi.exit', 'normal');
      this.setValue('cmi.location', '');


      for (var i = 0; i < objectives.length; i++) {
        var obj = objectives[i];
        this.setObjective(i, obj.id, obj.score, obj.status);
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
          int.description   // ✅ новое поле
        );
      }

      this.commit();
      // this.terminate();
    }
  };
})();

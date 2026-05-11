(function () {
  var api = window.TestBuilder;
  var answerGroupSelector = ".rtk-question-interaction";
  var answerOptionSelector = "label, button, [role='button'], .choice, .answer, .option";
  var fitFrame = 0;

  function getAnswerOptions(group) {
    var nodes = Array.prototype.slice.call(group.querySelectorAll(answerOptionSelector));

    return nodes.filter(function (node) {
      return !nodes.some(function (other) {
        return other !== node && node.contains(other);
      });
    });
  }

  function isVisible(element) {
    return !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
  }

  function isOverflowing(element) {
    return element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1;
  }

  function fitAnswerGroup(group) {
    if (!isVisible(group)) {
      return;
    }

    var options = getAnswerOptions(group).filter(isVisible);
    if (!options.length) {
      return;
    }

    options.forEach(function (option) {
      option.style.fontSize = "";
    });

    var computed = window.getComputedStyle(options[0]);
    var baseSize = parseFloat(computed.fontSize);
    if (!baseSize) {
      return;
    }

    var minSize = baseSize * 0.68;
    var size = baseSize;

    function applySize(value) {
      options.forEach(function (option) {
        option.style.fontSize = value.toFixed(2) + "px";
      });
    }

    applySize(size);

    while (size > minSize && options.some(isOverflowing)) {
      size -= 0.5;
      applySize(size);
    }
  }

  function fitAnswerOptions(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var groups = Array.prototype.slice.call(scope.querySelectorAll(answerGroupSelector));
    groups.forEach(fitAnswerGroup);
  }

  function scheduleFitAnswerOptions(root) {
    if (fitFrame) {
      window.cancelAnimationFrame(fitFrame);
    }

    fitFrame = window.requestAnimationFrame(function () {
      fitFrame = window.requestAnimationFrame(function () {
        fitFrame = 0;
        fitAnswerOptions(root || document);
      });
    });
  }

  window.RtkStorylineFitAnswers = scheduleFitAnswerOptions;

  function readPositiveInt(value, fallback) {
    var parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  function buildProgressDots(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var progressBlocks = Array.prototype.slice.call(scope.querySelectorAll(".rtk-progress"));

    progressBlocks.forEach(function (block) {
      var dots = block.querySelector(".rtk-progress-dots");
      if (!dots) {
        return;
      }

      var current = readPositiveInt(block.getAttribute("data-progress-current"), 1);
      var total = readPositiveInt(block.getAttribute("data-progress-total"), current);
      total = Math.max(total, current);

      if (dots.getAttribute("data-built-total") === String(total) && dots.getAttribute("data-built-current") === String(current)) {
        return;
      }

      dots.textContent = "";
      for (var index = 1; index <= total; index += 1) {
        var dot = document.createElement("span");
        if (index < current) {
          dot.className = "is-complete";
        } else if (index === current) {
          dot.className = "is-active";
        }
        dots.appendChild(dot);
      }

      dots.setAttribute("data-built-total", String(total));
      dots.setAttribute("data-built-current", String(current));
    });
  }

  function getParam(name, fallback) {
    try {
      var ctx = api.context.get();
      if (ctx && ctx.params && Object.prototype.hasOwnProperty.call(ctx.params, name)) {
        return ctx.params[name];
      }
    } catch (error) {
      console.warn("[rtk-storyline] Failed to read param", name, error);
    }
    return fallback;
  }

  function commitProgress() {
    if (!getParam("behavior.commitOnPageEnter", true) || !api.scorm || !api.scorm.commit) {
      return;
    }

    try {
      api.scorm.commit();
    } catch (error) {
      console.warn("[rtk-storyline] SCORM commit failed", error);
    }
  }

  function showDuplicateTabWarning() {
    var message = "Сертификационный тест был открыт в нескольких вкладках. Это может привести к частичной потере прогресса. Закройте лишние вкладки и продолжайте тест только в одной вкладке.";

    if (api.ui && api.ui.modal) {
      api.ui.modal({
        title: "Тест открыт в нескольких вкладках",
        message: message,
        tone: "warning"
      });
      return;
    }

    if (api.ui && api.ui.toast) {
      api.ui.toast(message, { tone: "warning", persistent: true });
    }
  }

  function setupDuplicateTabWarning() {
    if (!getParam("behavior.duplicateTabWarning", true) || !("BroadcastChannel" in window)) {
      return;
    }

    if (window.__rtkStorylineTabMonitor) {
      return;
    }

    window.__rtkStorylineTabMonitor = true;

    var channelName = "rtk_storyline_tabs";
    var channel = new BroadcastChannel(channelName);
    var tabId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    var activeTabs = {};
    var warningShown = false;

    function markActive(id) {
      activeTabs[id] = Date.now();
    }

    function pruneStaleTabs() {
      var now = Date.now();
      Object.keys(activeTabs).forEach(function (id) {
        if (now - activeTabs[id] > 5000) {
          delete activeTabs[id];
        }
      });
    }

    function checkTabs() {
      pruneStaleTabs();
      if (!warningShown && Object.keys(activeTabs).length > 1) {
        warningShown = true;
        showDuplicateTabWarning();
      }
    }

    markActive(tabId);
    channel.postMessage({ type: "rtk:tab-opened", id: tabId });

    channel.onmessage = function (event) {
      var data = event.data || {};
      if (!data.id || data.id === tabId) {
        return;
      }

      if (data.type === "rtk:tab-opened") {
        markActive(data.id);
        channel.postMessage({ type: "rtk:tab-active", id: tabId });
        checkTabs();
      }

      if (data.type === "rtk:tab-active") {
        markActive(data.id);
        checkTabs();
      }

      if (data.type === "rtk:tab-closed") {
        delete activeTabs[data.id];
      }
    };

    var heartbeat = window.setInterval(function () {
      channel.postMessage({ type: "rtk:tab-active", id: tabId });
      checkTabs();
    }, 1500);

    window.addEventListener("beforeunload", function () {
      window.clearInterval(heartbeat);
      channel.postMessage({ type: "rtk:tab-closed", id: tabId });
      channel.close();
    });
  }

  function setupAnswerFitter() {
    buildProgressDots(document);
    scheduleFitAnswerOptions(document);
    window.addEventListener("resize", function () {
      scheduleFitAnswerOptions(document);
    });

    if ("MutationObserver" in window && document.body) {
      new MutationObserver(function () {
        buildProgressDots(document);
        scheduleFitAnswerOptions(document);
      }).observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupAnswerFitter);
  } else {
    setupAnswerFitter();
  }

  if (api && api.template && api.context) {
    api.template.on("course:start", setupDuplicateTabWarning);
    api.template.on("course:resume", setupDuplicateTabWarning);
    api.template.on("page:enter", function () {
      commitProgress();
      buildProgressDots(document);
      scheduleFitAnswerOptions(document);
    });
    api.template.on("question:submitted", function () {
      commitProgress();
      buildProgressDots(document);
      scheduleFitAnswerOptions(document);
    });
  }
})();

/**
 * @module scripts/scorm/fullscreen-probe/fs-probe
 * @description Общий модуль зонда «полноэкранный сценарий» (задание-сценарий в ИС, черновик
 * docs/specs/sim-scenario/user-journey.md, раздел «Риски»). Plain ES5, без импортов:
 * файл кладётся в SCO как есть и подключается двумя страницами пакета — страницей SCO
 * (`index.html`) и страницей отдельного окна (`sim.html`).
 *
 * Модуль рисует учебный сценарий из трёх шагов и даёт обёртки над Fullscreen API с
 * префиксами. Решений о продукте он не принимает: его дело — показать сценарий одинаково в
 * любом из трёх способов открытия и сообщить, что ответил браузер.
 */
var TBFS = (function () {
  "use strict";

  /** Текст задания учебного сценария. */
  var TASK = "Создайте новый входящий документ и сохраните карточку.";

  /**
   * Шаги сценария. Цель — прямоугольник в процентах от размера экрана системы, как в модели
   * задания-сценария: окно масштабируется, а зоны остаются на месте.
   */
  var STEPS = [
    { name: "Открыть «Входящие»", screen: "home", target: { l: 0, t: 28, w: 18, h: 6 } },
    { name: "Создать документ", screen: "list", target: { l: 20, t: 12, w: 12, h: 6 } },
    { name: "Сохранить карточку", screen: "form", target: { l: 2, t: 12, w: 18, h: 6 } },
  ];

  var CSS = [
    ".tbfs{position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483000;display:flex;flex-direction:column;background:#eef0f3;font:14px/1.4 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#16181d}",
    ".tbfs[hidden]{display:none}",
    ".tbfs__bar{display:flex;align-items:center;gap:16px;padding:12px 24px;background:#fff;border-bottom:1px solid #dfe3e8}",
    ".tbfs__task{flex:1;min-width:0}",
    ".tbfs__cap{display:block;font-size:12px;color:#5b6270}",
    ".tbfs__step{color:#5b6270;white-space:nowrap}",
    ".tbfs__btn{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #16181d;background:#fff;color:#16181d;cursor:pointer;white-space:nowrap}",
    ".tbfs__btn--primary{background:#6b2bd9;border-color:#6b2bd9;color:#fff}",
    ".tbfs__stagewrap{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:24px}",
    ".tbfs__shot{position:relative;width:min(100%,calc((100vh - 140px) * 1.6));aspect-ratio:16/10;background:#fff;border:1px solid #c9ced6;border-radius:6px;overflow:hidden;font-size:12px;user-select:none}",
    ".tbfs__shot>*{position:absolute;box-sizing:border-box}",
    ".tbfs__title{left:0;right:0;top:0;height:6%;background:#1e2430;color:#fff;display:flex;align-items:center;padding-left:1.5%;font-weight:600}",
    ".tbfs__nav{left:0;width:18%;height:6%;display:flex;align-items:center;padding-left:3%}",
    ".tbfs__nav.is-on{background:#efe7fd;font-weight:600}",
    ".tbfs__panel{left:0;top:20%;width:18%;bottom:0;background:#f6f7f9;border-right:1px solid #e3e6ea}",
    ".tbfs__b{display:flex;align-items:center;justify-content:center;border:1px solid #c9ced6;border-radius:4px;background:#fff}",
    ".tbfs__b--p{background:#efe7fd;border-color:#6b2bd9}",
    ".tbfs__row{left:20%;width:78%;height:7%;display:flex;align-items:center;padding-left:1%;border-bottom:1px solid #eceff3;color:#5b6270}",
    ".tbfs__lbl{left:2%;width:18%;height:6%;display:flex;align-items:center;justify-content:flex-end;padding-right:1%;color:#5b6270}",
    ".tbfs__box{left:21%;width:45%;height:6%;border:1px solid #c9ced6;border-radius:4px}",
    ".tbfs__miss{width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;border:2px solid #b3261e;background:rgba(179,38,30,.18);pointer-events:none;animation:tbfs-miss .6s ease-out forwards}",
    "@keyframes tbfs-miss{from{opacity:1;transform:scale(.6)}to{opacity:0;transform:scale(1.4)}}",
    ".tbfs__done{left:30%;top:40%;width:40%;height:16%;display:flex;align-items:center;justify-content:center;border-radius:6px;background:#e3f4ea;border:1px solid #1d7a41;color:#1d7a41;font-weight:600}",
  ].join("\n");

  /** Подключает стили один раз на документ. */
  function ensureStyles(doc) {
    if (doc.getElementById("tbfs-css")) return;
    var style = doc.createElement("style");
    style.id = "tbfs-css";
    style.textContent = CSS;
    doc.head.appendChild(style);
  }

  function navItems(active) {
    var items = ["Рабочий стол", "Входящие", "Исходящие", "Поручения"];
    var out = "";
    for (var i = 0; i < items.length; i += 1) {
      out += '<div class="tbfs__nav' + (items[i] === active ? " is-on" : "") + '" style="top:' + (22 + 6 * i) + '%">' + items[i] + "</div>";
    }
    return out;
  }

  /** Разметка «скриншота» экрана системы. В продукте это изображение. */
  function screenHtml(name) {
    if (name === "home") {
      return '<div class="tbfs__title">СЭД · Рабочий стол</div><div class="tbfs__panel"></div>' + navItems("Рабочий стол")
        + '<div class="tbfs__b" style="left:22%;top:22%;width:24%;height:18%">Мои задачи · 3</div>'
        + '<div class="tbfs__b" style="left:49%;top:22%;width:24%;height:18%">На контроле · 5</div>';
    }
    if (name === "list") {
      return '<div class="tbfs__title">СЭД · Входящие документы</div><div class="tbfs__panel"></div>' + navItems("Входящие")
        + '<div class="tbfs__b tbfs__b--p" style="left:20%;top:12%;width:12%;height:6%">+ Создать</div>'
        + '<div class="tbfs__b" style="left:33%;top:12%;width:10%;height:6%">Открыть</div>'
        + '<div class="tbfs__row" style="top:22%">ВХ-1182 · АО «Север» · О продлении договора</div>'
        + '<div class="tbfs__row" style="top:29%">ВХ-1181 · ООО «Вектор» · Счёт на оплату</div>'
        + '<div class="tbfs__row" style="top:36%">ВХ-1180 · Минфин региона · Запрос сведений</div>';
    }
    if (name === "form") {
      return '<div class="tbfs__title">СЭД · Входящий документ (новый)</div>'
        + '<div class="tbfs__b tbfs__b--p" style="left:2%;top:12%;width:18%;height:6%">Сохранить и закрыть</div>'
        + '<div class="tbfs__b" style="left:21%;top:12%;width:9%;height:6%">Отмена</div>'
        + '<div class="tbfs__lbl" style="top:26%">Корреспондент</div><div class="tbfs__box" style="top:26%"></div>'
        + '<div class="tbfs__lbl" style="top:35%">Тема</div><div class="tbfs__box" style="top:35%"></div>';
    }
    return '<div class="tbfs__title">СЭД · Входящие документы</div><div class="tbfs__done">Документ зарегистрирован</div>';
  }

  function inside(r, x, y) { return x >= r.l && x <= r.l + r.w && y >= r.t && y <= r.t + r.h; }

  /**
   * Рисует окно сценария в контейнер и ведёт прогресс в общем хранилище.
   *
   * @param host Контейнер окна сценария (элемент `.tbfs`).
   * @param store Прогресс: `{ step, misses, done }`. В отдельном окне это объект окна SCO,
   *   поэтому прогресс переживает закрытие окна.
   * @param ui Колбэки: `collapse()`, `finish()`, `log(text)`; необязательные кнопки
   *   `extra: [{ label, onClick }]` для панели.
   */
  function render(host, store, ui) {
    var doc = host.ownerDocument;
    ensureStyles(doc);
    var step = STEPS[Math.min(store.step, STEPS.length - 1)];
    var bar = '<div class="tbfs__bar"><div class="tbfs__task"><span class="tbfs__cap">Задание</span>' + TASK + "</div>"
      + '<span class="tbfs__step">' + (store.done ? "Сценарий выполнен" : "Шаг " + (store.step + 1) + " из " + STEPS.length) + "</span>";
    var extra = ui.extra || [];
    for (var i = 0; i < extra.length; i += 1) bar += '<button type="button" class="tbfs__btn" data-extra="' + i + '">' + extra[i].label + "</button>";
    bar += store.done
      ? '<button type="button" class="tbfs__btn tbfs__btn--primary" data-act="finish">Вернуться к вопросу</button>'
      : '<button type="button" class="tbfs__btn" data-act="collapse">Свернуть</button>';
    bar += "</div>";
    host.innerHTML = bar + '<div class="tbfs__stagewrap"><div class="tbfs__shot">' + screenHtml(store.done ? "done" : step.screen) + "</div></div>";

    var buttons = host.querySelectorAll("button");
    for (var b = 0; b < buttons.length; b += 1) {
      buttons[b].onclick = (function (btn) {
        return function () {
          if (btn.getAttribute("data-act") === "collapse") ui.collapse();
          else if (btn.getAttribute("data-act") === "finish") ui.finish();
          else extra[Number(btn.getAttribute("data-extra"))].onClick(btn);
        };
      })(buttons[b]);
    }

    var shot = host.querySelector(".tbfs__shot");
    shot.onclick = function (e) {
      if (store.done) return;
      var box = shot.getBoundingClientRect();
      var x = (e.clientX - box.left) / box.width * 100;
      var y = (e.clientY - box.top) / box.height * 100;
      if (inside(STEPS[store.step].target, x, y)) {
        ui.log("шаг " + (store.step + 1) + " выполнен");
        store.step += 1;
        if (store.step >= STEPS.length) { store.done = true; ui.log("сценарий выполнен"); }
        render(host, store, ui);
        return;
      }
      store.misses += 1;
      var ring = doc.createElement("span");
      ring.className = "tbfs__miss";
      ring.style.left = x + "%";
      ring.style.top = y + "%";
      shot.appendChild(ring);
      setTimeout(function () { if (ring.parentNode) ring.parentNode.removeChild(ring); }, 700);
    };
  }

  /** Разрешён ли полноэкранный режим этому документу (учитывает политику iframe). */
  function fsEnabled(doc) {
    if (typeof doc.fullscreenEnabled === "boolean") return doc.fullscreenEnabled;
    if (typeof doc.webkitFullscreenEnabled === "boolean") return doc.webkitFullscreenEnabled;
    return false;
  }

  function fsElement(doc) { return doc.fullscreenElement || doc.webkitFullscreenElement || null; }

  /**
   * Запрос полного экрана. Всегда возвращает Promise: у старого webkit запрос синхронный и
   * об отказе сообщает только событием, поэтому исход тогда ждётся по событию с таймаутом.
   */
  function requestFs(el) {
    var doc = el.ownerDocument;
    if (el.requestFullscreen) {
      try { return Promise.resolve(el.requestFullscreen()); } catch (e) { return Promise.reject(e); }
    }
    if (el.webkitRequestFullscreen) {
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () { reject(new Error("нет ответа за 1,5 с")); }, 1500);
        doc.addEventListener("webkitfullscreenchange", function once() {
          doc.removeEventListener("webkitfullscreenchange", once);
          clearTimeout(timer);
          resolve();
        });
        doc.addEventListener("webkitfullscreenerror", function onceErr() {
          doc.removeEventListener("webkitfullscreenerror", onceErr);
          clearTimeout(timer);
          reject(new Error("webkitfullscreenerror"));
        });
        el.webkitRequestFullscreen();
      });
    }
    return Promise.reject(new Error("Fullscreen API отсутствует"));
  }

  function exitFs(doc) {
    if (!fsElement(doc)) return;
    if (doc.exitFullscreen) doc.exitFullscreen();
    else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
  }

  /** Подписка на смену полноэкранного состояния с префиксами. */
  function onFsChange(doc, handler) {
    doc.addEventListener("fullscreenchange", handler);
    doc.addEventListener("webkitfullscreenchange", handler);
  }

  /** Размеры окна и экрана: сколько площади LMS отдаёт пакету. */
  function sizeInfo(win) {
    return {
      viewport: win.innerWidth + " × " + win.innerHeight,
      screen: win.screen.width + " × " + win.screen.height,
      available: win.screen.availWidth + " × " + win.screen.availHeight,
      pixelRatio: win.devicePixelRatio,
      share: Math.round(win.innerWidth * win.innerHeight / (win.screen.width * win.screen.height) * 100) + " %",
    };
  }

  return {
    TASK: TASK,
    STEPS: STEPS,
    render: render,
    ensureStyles: ensureStyles,
    fsEnabled: fsEnabled,
    fsElement: fsElement,
    requestFs: requestFs,
    exitFs: exitFs,
    onFsChange: onFsChange,
    sizeInfo: sizeInfo,
  };
})();

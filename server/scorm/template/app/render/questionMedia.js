/**
 * PRD-38: печать разметки медиа и полноэкранный оверлей живут в общем коде
 * (`shared/template/question-media`), который приезжает в пакет глобалом `TBTemplate`.
 * Здесь остаются только имена, на которые ссылается остальной рантайм, и одна привязка
 * оверлея к документу.
 */
function renderQuestionMedia(q) {
  return TBTemplate.renderQuestionMedia(q);
}

/** Совместимость: внешние шаблоны могли ссылаться на этот глобал напрямую. */
window.qmOpenFromEl = function (el) {
  var url = el.getAttribute('data-media-url');
  var type = el.getAttribute('data-media-type');
  if (url && type) TBTemplate.openQuestionMediaOverlay(document, url, type);
};

TBTemplate.attachQuestionMediaFullscreen(document);

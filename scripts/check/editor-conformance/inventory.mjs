/**
 * @module scripts/check/editor-conformance/inventory
 * @description Structural inventory of one settings panel, taken identically on the wireframe
 * and on the live drawer.
 *
 * Why this exists. Comparing screenshots tells you that something changed but not what;
 * comparing DOM trees drowns in noise. The inventory keeps exactly the properties the
 * wireframe is a contract for — section headings, field labels, hints, control kinds, button
 * captions and variants, table columns, and the order of all of them — and drops everything
 * data-dependent. The result is short enough to read and specific enough to act on.
 *
 * Two normalisations are deliberate, and both exist because the wireframe is not perfect:
 *
 *   1. Hints are collected from `ou-formfield__desc` AND from `ou-formfield__hint` /
 *      `ou-field__hint`. The latter two do not exist in the design system — they are findings
 *      W-2 and W-3 — but until the owner rules on them the drawing still uses them, and a
 *      checker that refused to see them would report every hint in the wireframe as missing
 *      from the implementation.
 *   2. Only the VISIBLE drawer is read. The wireframe holds 34 states in one document and
 *      shows one at a time; taking all of them would compare a tab against the whole file.
 */

/**
 * Source of the browser-side extractor, kept as a string because it is injected into two
 * different pages through `Runtime.evaluate`. One copy guarantees the wireframe and the
 * implementation are measured by the same rules — the moment they diverge, the diff starts
 * reporting the measurement instead of the code.
 */
export const EXTRACT = `() => {
  const visible = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const drawer = [...document.querySelectorAll(".ou-drawer")].find(visible);
  if (!drawer) return null;
  const panel = drawer.querySelector(".tb-settings-content") || drawer.querySelector(".ou-drawer__body");
  if (!panel) return null;

  const norm = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const SKIP = ".wf-nav, .wf-sprite, .ou-tabs__list, .ou-drawer__rail";
  const items = [];

  const classOf = (el) => (typeof el.className === "string" ? el.className : "");

  const walk = (el) => {
    for (const child of el.children) {
      if (child.matches(SKIP) || child.closest(SKIP)) continue;
      const cls = classOf(child);
      const tag = child.tagName.toLowerCase();

      // Text roles do not descend: a label carries the required-field asterisk in a nested
      // span, and walking into it files that asterisk as a second, nameless label.
      // Только заголовок РАЗДЕЛА формы. Заголовок и подзаголовок карточки — это данные:
      // в списке шкал там «CEL — Целеустремленный», в списке показателей «число · порядок 1».
      // Сверять их значило бы сравнивать демо-данные эскиза с данными тестового теста и
      // тонуть в шуме, из-за которого настоящие находки перестанут быть видны.
      if (/ou-formsection__title/.test(cls)) {
        items.push({ role: "heading", text: norm(child.textContent) });
        continue;
      } else if (/ou-formfield__lbl|ou-field__lbl\\b|ou-textarea__lbl|ou-select__lbl|ou-number__lbl|ou-switch-field__label|ou-field__label/.test(cls)) {
        items.push({ role: "label", text: norm(child.textContent) });
        continue;
      } else if (/ou-formfield__desc|ou-formfield__hint|ou-field__hint|ou-field__desc|ou-switch-field__desc/.test(cls)) {
        items.push({ role: "hint", text: norm(child.textContent) });
        continue;
      } else if (/ou-empty__title/.test(cls)) {
        items.push({ role: "empty", text: norm(child.textContent) });
        continue;
      } else if (/ou-banner__desc/.test(cls)) {
        // Баннер ожидаемой экспозиции (PRD-55) — ДАННЫЕ целиком: и доля, и тон следуют из
        // банка темы и объёма её выдачи. Сверять его подпись значило бы сравнивать числа
        // эскиза с числами тестового теста, и тогда тема, у которой выдача выше порога,
        // читалась бы как лишний баннер, которого нет в эскизе. В опись он идёт структурой,
        // без подписи — по тому же правилу, что и заголовок свёртки ниже.
        const dataDriven = child.closest("[data-testid^='topic-exposure-banner']");
        items.push({ role: "banner", text: dataDriven ? "" : norm(child.textContent) });
        continue;
      } else if (tag === "table") {
        const columns = [...child.querySelectorAll("th")].map((th) => norm(th.textContent).split(" ")[0]);
        items.push({ role: "table", text: columns.join(" | ") });
        continue;
      } else if (tag === "button" && /ou-acc__trigger|tb-fold-trigger/.test(cls)) {
        // Заголовок свёртки — ДАННЫЕ: имя темы и её счётчики. Сама кнопка структурна и
        // одинакова у всех свёрток, поэтому в опись идёт без подписи; иначе каждая тема
        // тестового теста читалась бы как лишняя кнопка, которой нет в эскизе. Правило
        // одинаково для аккордеона дизайн-системы и для проектной свёртки tb-fold-sec:
        // разметка разная, роль одна. Обратные кавычки внутри этой строки-шаблона ставить
        // нельзя — они обрывают её, и модуль перестаёт разбираться.
        items.push({ role: "fold", text: "" });
        walk(child);
        continue;
      } else if (tag === "button") {
        const variant = (cls.match(/ou-btn--(primary|secondary|ghost|destructive)/) || [])[1] || "";
        items.push({ role: "button", text: norm(child.textContent), variant });
      } else if (tag === "input" || tag === "textarea" || tag === "select") {
        const kind = tag === "input" ? "input:" + child.type : tag;
        items.push({ role: "control", text: kind });
      }

      walk(child);
    }
  };

  walk(panel);
  return items;
}`;

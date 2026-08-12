/**
 * @module shared/template/palette-bridge
 * @description Мост палитры теста (PRD-7/PRD-23) в токены дизайн-системы.
 *
 * Разметка ученических экранов живёт на токенах DS (`--ou-*`), а брендирование
 * теста приходит прежними переменными шаблона (`--primary`, `--background`, … —
 * HSL-тройки, см. {@link module:shared/template/params-css}). Чтобы брендирование
 * сохранилось без изменения панели «Оформление» и `cssVars`, этот мост выводит
 * токены DS из палитры теста.
 *
 * Ключевой приём: вся акцентная рампа DS `--ou-purple-50..900` в самом ui-kit
 * выводится из ОДНОГО якоря (`#7700FF`) фиксированными долями `color-mix(in oklch)`,
 * а все токены акцента (`--ou-accent-*` в светлой и тёмной темах) ссылаются на эти
 * шаги. Поэтому достаточно переопределить рампу теми же долями, но с якорем
 * `hsl(var(--primary))` — и весь акцент ребрендится в обеих темах автоматически.
 * Доли ниже скопированы 1:1 из `vendor/ui-kit/css/university-rt.css`.
 *
 * Блок объявляется на классе `.ou` (его тема-провайдер ставит на корень), НЕ на
 * `:root`: семантические токены DS живут в `.ou`-скоупе, и переопределение должно
 * попасть в тот же каскад. Пусто, если тест не задал палитру, — тогда действует
 * штатная палитра DS.
 *
 * Чистая, без DOM и Node — бандлится в SCORM-пакет как есть.
 */

/** Палитра теста (HSL-тройки «H S% L%», как их отдаёт params-css). */
export interface TemplatePalette {
  /** Брендовый акцент — из него выводится вся рампа `--ou-purple-*`. */
  primary?: string;
  /** Фон страницы. */
  background?: string;
  /** Поверхность карточек/панелей. */
  card?: string;
  /** Цвет границ. */
  border?: string;
}

/** Доли осветления/затемнения шагов рампы — 1:1 с ui-kit (`#fff`/`#000` X%). */
const RAMP: Array<[step: number, mixWith: "#fff" | "#000", pct: number | null]> = [
  [50, "#fff", 92],
  [100, "#fff", 80],
  [200, "#fff", 60],
  [300, "#fff", 40],
  [400, "#fff", 18],
  [500, "#000", null], // якорь = сам primary
  [600, "#000", 16],
  [700, "#000", 32],
  [800, "#000", 50],
  [900, "#000", 68],
];

/**
 * CSS-блок моста для `.ou`: выводит токены DS из палитры теста.
 *
 * @param p Значения палитры теста (любое подмножество). Пустой ввод → пустая
 *   строка (действует штатная палитра DS).
 * @returns Строка вида `.ou{--ou-purple-500:hsl(var(--primary));…}` или `""`.
 */
export function buildPaletteBridge(p: TemplatePalette): string {
  const lines: string[] = [];

  if (p.primary) {
    // Акцентная рампа: якорь 500 = primary теста, остальные шаги — теми же долями
    // color-mix, что и в DS. Все --ou-accent-* ссылаются на эти шаги и следуют.
    const anchor = "hsl(var(--primary))";
    for (const [step, mixWith, pct] of RAMP) {
      const value = pct === null ? anchor : `color-mix(in oklch, ${mixWith} ${pct}%, ${anchor})`;
      lines.push(`--ou-purple-${step}:${value};`);
    }
  }
  // Поверхности и границы — прямой маппинг, когда тест их переопределил.
  if (p.background) lines.push("--ou-bg-page:hsl(var(--background));");
  if (p.card) lines.push("--ou-bg-elevated:hsl(var(--card));");
  if (p.border) lines.push("--ou-border-soft:hsl(var(--border));");

  return lines.length ? `.ou{${lines.join("")}}` : "";
}

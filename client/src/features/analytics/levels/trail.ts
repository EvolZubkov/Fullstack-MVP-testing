/**
 * @module features/analytics/levels/trail
 * @description Путь, которым пришли на экран, — для крошек и возврата (замечание владельца
 * 2026-10-05: «после ныряния вглубь нет возможности быстро вернуться назад»).
 *
 * Иерархия уровней аналитики не описывает, откуда человек пришёл: на страницу вопроса банка
 * попадают из дерева «Темы и вопросы», со страницы вопроса в тесте и из очереди дел. Поэтому при
 * переходе вглубь страница кладёт в состояние записи истории цепочку крошек пройденного пути, а
 * страница назначения строит крошки из неё: каждая крошка ведёт на свой шаг вместе с его
 * состоянием (условия, раскрытое дерево). «Назад» и «Вперёд» браузера состояние сохраняют, а
 * присланная ссылка — нет: по ней у страницы её обычные крошки.
 *
 * Модуль чистый: сборка и обрезка цепочки проверяются без DOM.
 */

/** Шаг пути: подпись, адрес и состояние записи истории, с которым на него вернуться. */
export interface TrailCrumb {
  label: string;
  href: string;
  state?: unknown;
}

/** Ключ цепочки в состоянии записи истории. */
const TRAIL_KEY = "trail";

/** Сколько шагов пути помнить: длиннее цепочка в крошках не читается. */
const MAX_STEPS = 5;

/** Путь из состояния записи истории; `null` — пришли не переходом вглубь (ссылка, меню). */
export function trailOf(state: unknown): TrailCrumb[] | null {
  const value = (state as Record<string, unknown> | null)?.[TRAIL_KEY];
  if (!Array.isArray(value) || value.length === 0) return null;
  const crumbs = value.filter((crumb): crumb is TrailCrumb =>
    !!crumb && typeof (crumb as TrailCrumb).label === "string" && typeof (crumb as TrailCrumb).href === "string");
  return crumbs.length > 0 ? crumbs : null;
}

/** Путь адреса без строки запроса — им шаги и сравниваются. */
function pathOf(href: string): string {
  const at = href.search(/[?#]/);
  return at === -1 ? href : href.slice(0, at);
}

/**
 * Состояние записи для перехода вглубь: пройденный путь плюс текущий экран.
 *
 * Если цель уже есть в пути (вернулись на пройденный шаг другой дорогой), путь обрезается до неё:
 * иначе «вопрос банка → вопрос в тесте → вопрос банка» рос бы без конца.
 *
 * @param trail путь, которым пришли на текущий экран (или `null`)
 * @param here текущий экран — шаг, на который вернёт крошка
 * @param targetHref куда переходят
 */
export function stateForDive(
  trail: readonly TrailCrumb[] | null,
  here: TrailCrumb,
  targetHref: string,
): { trail: TrailCrumb[] } {
  let full = [...(trail ?? []), here];
  const target = pathOf(targetHref);
  const at = full.findIndex(crumb => pathOf(crumb.href) === target);
  if (at !== -1) full = full.slice(0, at);
  return { [TRAIL_KEY]: full.slice(-MAX_STEPS) } as { trail: TrailCrumb[] };
}

/** Адрес текущей записи — шаг, на который вернёт крошка. */
export function currentHref(): string {
  return typeof window === "undefined" ? "" : window.location.pathname + window.location.search;
}

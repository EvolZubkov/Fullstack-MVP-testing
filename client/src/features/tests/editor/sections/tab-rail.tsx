/**
 * @module features/tests/editor/sections/tab-rail
 * @description Rail shell shared by the editor tabs (план «перестройка редактора», Э3.1).
 *
 * До перестройки рейл был у «Настроек» и у «Оформления», и каждый рисовал разметку сам.
 * Теперь рейл есть почти у каждой вкладки, поэтому разметка `ou-drawer__split` + пункты
 * живут в одном месте: вкладка объявляет ПУНКТЫ и рисует активную панель, а не повторяет
 * навигацию.
 *
 * Второй уровень (эскиз `docs/wireframes/ds-rail-nested.html`) нужен там, где пункт —
 * не один экран, а группа: «Шкалы» это «Список шкал» и «Вклады вопросов». Родитель у
 * такой группы — ПОДПИСЬ, а не кнопка: своего экрана у него нет, нажимать не на что,
 * дети видны всегда.
 *
 * Компонент намеренно ничего не знает о модели теста: пункты и точки состояния вкладка
 * считает сама — только она знает, что для неё ошибка, а что замечание.
 */
import { Fragment, useMemo, useState } from "react";
import type * as React from "react";

/** Состояние пункта рейла: точка справа от подписи. */
export type RailDot = "error" | "warning";

/** Один пункт рейла. */
export type RailItem<K extends string> = {
  key: K;
  label: string;
  /** Точка состояния; отсутствует — пункт чистый. */
  dot?: RailDot;
  /** Пункт виден, но недоступен (например, шаблон не прочитался). */
  disabled?: boolean;
  /**
   * Почему пункт недоступен. Печатается строкой под ним и озвучивается через
   * `aria-describedby`: причину надо прочитать, не наводя мышь.
   */
  disabledHint?: string;
};

/**
 * Группа пунктов под общей подписью — второй уровень рейла.
 *
 * Подпись не выбирается и не сворачивается: у группы нет своего экрана. Если он
 * появится, это будет уже другой примитив — родитель-кнопка, — и заводить его
 * заранее значит держать непроверенную разновидность.
 */
export type RailGroup<K extends string> = {
  /** Подпись группы. Служит и `aria-label` для вложенных пунктов. */
  label: string;
  items: RailItem<K>[];
};

/** Строка рейла: одиночный пункт или группа. */
export type RailEntry<K extends string> = RailItem<K> | RailGroup<K>;

function isGroup<K extends string>(entry: RailEntry<K>): entry is RailGroup<K> {
  return (entry as RailGroup<K>).items !== undefined;
}

/** Все пункты подряд, независимо от уровня: для выбора активного и отката. */
export function flattenRail<K extends string>(entries: RailEntry<K>[]): RailItem<K>[] {
  return entries.flatMap((entry) => (isGroup(entry) ? entry.items : [entry]));
}

export type TabRailProps<K extends string> = {
  /**
   * Строки рейла в порядке показа: пункт или группа. Пустой список рисует только
   * область содержимого.
   */
  items: RailEntry<K>[];
  /** Активный пункт; если его нет в списке, берётся первый ДОСТУПНЫЙ. */
  active: K;
  onChange: (key: K) => void;
  /** `aria-label` навигации: «Подразделы правил прохождения» и т. п. */
  ariaLabel: string;
  /**
   * Префикс `data-testid`: пункты получают `<prefix>-rail-<key>`, область содержимого —
   * `<prefix>-pane-<key>`. Прежние идентификаторы «Настроек» и «Оформления» так и
   * сохраняются, поэтому приёмочные проверки не переписываются вслед за переездом.
   */
  testIdPrefix: string;
  children: React.ReactNode;
};

/** Первый пункт, на который вообще можно встать. */
function firstEnabled<K extends string>(items: RailItem<K>[]): K | undefined {
  return items.find((i) => !i.disabled)?.key ?? items[0]?.key;
}

/**
 * Рейл вкладки: колонка пунктов слева, панель справа.
 */
export function TabRail<K extends string>({
  items,
  active,
  onChange,
  ariaLabel,
  testIdPrefix,
  children,
}: TabRailProps<K>): React.JSX.Element {
  const flat = flattenRail(items);
  // Активным считается пункт, который есть и доступен: заблокированный выбранным быть
  // не может — иначе панель показывала бы то, чего автору сейчас нельзя.
  const chosen = flat.find((i) => i.key === active);
  const effective = chosen && !chosen.disabled ? active : (firstEnabled(flat) ?? active);

  const renderItem = (item: RailItem<K>, child: boolean) => {
    const hintId = item.disabled && item.disabledHint
      ? `${testIdPrefix}-rail-${item.key}-hint`
      : undefined;
    return (
      <Fragment key={item.key}>
        <button
          type="button"
          className={
            "ou-drawer__rail-item" +
            (child ? " ou-drawer__rail-item--child" : "") +
            (effective === item.key ? " is-active" : "")
          }
          aria-current={effective === item.key ? "page" : undefined}
          aria-disabled={item.disabled ? "true" : undefined}
          aria-describedby={hintId}
          disabled={item.disabled}
          onClick={item.disabled ? undefined : () => onChange(item.key)}
          data-testid={`${testIdPrefix}-rail-${item.key}`}
        >
          {item.label}
          {item.dot === "error" && (
            <span className="tb-status-dot tb-status-dot--err" aria-label="Ошибка" />
          )}
          {item.dot === "warning" && (
            <span className="tb-status-dot tb-status-dot--warn" aria-label="Требует внимания" />
          )}
        </button>
        {hintId && (
          <span className="ou-drawer__rail-hint" id={hintId}>
            {item.disabledHint}
          </span>
        )}
      </Fragment>
    );
  };

  return (
    <div className="ou-drawer__split" data-testid={`${testIdPrefix}-split`}>
      <nav className="ou-drawer__rail" aria-label={ariaLabel}>
        {items.map((entry, index) =>
          isGroup(entry) ? (
            <Fragment key={`group-${entry.label}-${index}`}>
              <span
                className="ou-drawer__rail-grouplbl"
                id={`${testIdPrefix}-rail-group-${index}`}
              >
                {entry.label}
              </span>
              <div
                className="ou-drawer__rail-group"
                role="group"
                aria-labelledby={`${testIdPrefix}-rail-group-${index}`}
              >
                {entry.items.map((item) => renderItem(item, true))}
              </div>
            </Fragment>
          ) : (
            renderItem(entry, false)
          ),
        )}
      </nav>
      <div className="tb-settings-content" data-testid={`${testIdPrefix}-pane-${effective}`}>
        {children}
      </div>
    </div>
  );
}

/**
 * Активный пункт рейла с оглядкой на видимость: пункт мог исчезнуть (адаптивный режим
 * выключили) или стать недоступным (удалили последнюю шкалу — «Вклады вопросов» больше
 * не о чем). Тогда вкладка обязана вернуться на первый доступный, а не показать пустоту.
 */
export function useRailState<K extends string>(
  items: RailEntry<K>[],
  initial: K,
): [K, (key: K) => void] {
  const [active, setActive] = useState<K>(initial);
  const effective = useMemo(() => {
    const flat = flattenRail(items);
    const chosen = flat.find((i) => i.key === active);
    if (chosen && !chosen.disabled) return active;
    return firstEnabled(flat) ?? active;
  }, [items, active]);
  return [effective, setActive];
}

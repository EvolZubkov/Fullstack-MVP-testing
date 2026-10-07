/**
 * @module shared/test-items
 *
 * Пункт теста — тема или сценарий (docs/specs/sim-scenario/plan-tests.md, раздел 4).
 *
 * Сценарий — второй вид пункта рядом с разделом. Главная опасность второго вида — место, которое
 * знает только разделы и молча пропускает сценарий: хаб не покажет карточку, правило разблокировки
 * не сработает, снимок потеряет пункт. Этот модуль — одно определение того, что такое пункт, и
 * одна точка ветвления по его виду:
 *
 * - КЛЮЧ пункта: `topic:<id>` у темы и `scenario:<id>` у сценария. Голый идентификатор темы — то,
 *   чем ключуются разделы во всех попытках и правилах, написанных до сценариев, — читается как
 *   `topic:<id>`, поэтому старые тесты и попытки не мигрируют. В выдаче раздел темы так и несёт
 *   голый `topicId`, а синтезированный раздел сценария — ключ `scenario:<id>`: две записи с одной
 *   темой-банком не схлопываются;
 * - ПОРЯДОК пунктов роутера (`router.itemOrder`): ключи в порядке автора; без него — темы в
 *   своём порядке, затем сценарии;
 * - РАЗБОР по виду — только {@link matchTestItem}: обработчик для каждого вида обязателен, а
 *   проверка `never` не даст собрать код, если появится третий вид. Цепочка
 *   `if (key.startsWith("scenario:"))` без ветки для темы — тот же класс ошибок, что разобран в
 *   PRD-26 для типов вопроса.
 *
 * Чистый модуль, без фреймворка: им пользуются сервер, веб и рантайм пакета.
 */

/** Префикс ключа пункта-сценария. */
export const SCENARIO_KEY_PREFIX = "scenario:";
/** Префикс ключа темы. */
export const TOPIC_KEY_PREFIX = "topic:";

/** Вид пункта. */
export type TestItemKind = "topic" | "scenario";

/** Разобранный ключ пункта. */
export type TestItemRef = { kind: "topic"; topicId: string } | { kind: "scenario"; scenarioId: string };

/** Ключ пункта-сценария. */
export function scenarioItemKey(scenarioId: string): string {
  return `${SCENARIO_KEY_PREFIX}${scenarioId}`;
}

/** Ключ темы в общем порядке пунктов. */
export function topicItemKey(topicId: string): string {
  return `${TOPIC_KEY_PREFIX}${topicId}`;
}

/** Ключ раздела выдачи — пункт-сценарий? */
export function isScenarioItemKey(key: string): boolean {
  return key.startsWith(SCENARIO_KEY_PREFIX);
}

/**
 * Разобрать ключ пункта. Голый идентификатор — тема: так ключуются разделы, написанные до
 * сценариев.
 */
export function parseItemKey(key: string): TestItemRef {
  if (key.startsWith(SCENARIO_KEY_PREFIX)) return { kind: "scenario", scenarioId: key.slice(SCENARIO_KEY_PREFIX.length) };
  if (key.startsWith(TOPIC_KEY_PREFIX)) return { kind: "topic", topicId: key.slice(TOPIC_KEY_PREFIX.length) };
  return { kind: "topic", topicId: key };
}

/**
 * Ветвление по виду пункта. Обработчик для каждого вида обязателен; появление третьего вида
 * сломает сборку здесь, а не молча в одном из потребителей.
 */
export function matchTestItem<R>(
  ref: TestItemRef,
  handlers: { topic: (topicId: string) => R; scenario: (scenarioId: string) => R },
): R {
  switch (ref.kind) {
    case "topic":
      return handlers.topic(ref.topicId);
    case "scenario":
      return handlers.scenario(ref.scenarioId);
    default: {
      const unreachable: never = ref;
      throw new Error(`Неизвестный вид пункта теста: ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * Упорядочить пункты роутера по `router.itemOrder`.
 *
 * Ключ в порядке может быть и голым идентификатором темы. Пункты, которых в порядке нет, идут
 * после упомянутых в своём исходном порядке — новый пункт не теряется оттого, что автор ещё не
 * двигал список. Без порядка — исходный: темы, затем сценарии.
 *
 * @param items Пункты в исходном порядке; `key` — ключ раздела выдачи (голый `topicId` у темы).
 * @param itemOrder Ключи в порядке автора.
 */
export function orderTestItems<T extends { key: string }>(items: T[], itemOrder?: readonly string[] | null): T[] {
  if (!itemOrder || itemOrder.length === 0) return items;
  const canonical = (key: string) =>
    matchTestItem(parseItemKey(key), { topic: (id) => topicItemKey(id), scenario: (id) => scenarioItemKey(id) });
  const rank = new Map(itemOrder.map((key, i) => [canonical(key), i]));
  return items
    .map((item, index) => ({ item, index, rank: rank.get(canonical(item.key)) }))
    .sort((a, b) => {
      if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank;
      if (a.rank !== undefined) return -1;
      if (b.rank !== undefined) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

/**
 * Перенумеровать ПРЕФИКСНЫЙ ключ пункта (`topic:<id>` / `scenario:<id>`) по карте идентификаторов.
 *
 * Перенос теста между установками меняет идентификаторы точным совпадением строки, а ключ пункта —
 * составная строка: без этого шага порядок пунктов и правила разблокировки роутера после копии
 * указывали бы на идентификаторы, которых здесь нет. Голый идентификатор темы — не префиксный ключ:
 * его перенумерует обычная подстановка.
 *
 * @returns Новый ключ или `null`, если строка не префиксный ключ или её идентификатор не меняется.
 */
export function remapItemKey(key: string, idMap: ReadonlyMap<string, string>): string | null {
  for (const prefix of [TOPIC_KEY_PREFIX, SCENARIO_KEY_PREFIX]) {
    if (!key.startsWith(prefix)) continue;
    const next = idMap.get(key.slice(prefix.length));
    return next ? prefix + next : null;
  }
  return null;
}

/**
 * Перестроить общий порядок пунктов под НОВЫЙ порядок тем, сохранив места сценариев.
 *
 * Книга Excel задаёт порядок тем, но о пунктах-сценариях не знает. Старый `itemOrder` после неё
 * продолжал бы диктовать прежний порядок тем — перестановка из книги молча не действовала бы. Здесь
 * места тем в списке заполняются темами книги по порядку, сценарии остаются на своих местах, лишние
 * темы книги встают в конец, исчезнувшие — выпадают.
 *
 * @param itemOrder Текущий порядок пунктов.
 * @param topicIds Темы в новом порядке.
 */
export function reflowItemOrder(itemOrder: readonly string[], topicIds: readonly string[]): string[] {
  const queue = [...topicIds];
  const out: string[] = [];
  for (const key of itemOrder) {
    matchTestItem(parseItemKey(key), {
      topic: () => {
        const next = queue.shift();
        if (next) out.push(topicItemKey(next));
      },
      scenario: (id) => {
        out.push(scenarioItemKey(id));
      },
    });
  }
  for (const rest of queue) out.push(topicItemKey(rest));
  return out;
}

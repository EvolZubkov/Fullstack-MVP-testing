/**
 * @module shared/flow/unlock-rules
 *
 * Правила открытия пунктов роутера (`flowPolicyJson.router.sectionUnlockRules`) как ГРАФ — то, что
 * одинаково нужно редактору и серверу («Сценарий в ИС», техдолг №8,
 * `docs/wireframes/sim-scenario-test-editor.html`, состояния «роутер: …»).
 *
 * Правило пункта `X` — «открывается после пунктов A, B». Это ребро «X ждёт A». Кольцо (A ждёт B, B
 * ждёт A — или цепочка любой длины) значит, что ни один пункт кольца не откроется никогда: участник
 * застрянет, а при обязательных пунктах не сможет и завершить тест. Поэтому:
 *
 * - редактор НЕ ПРЕДЛАГАЕТ в «Каких пунктов» пункты, выбор которых замкнул бы кольцо
 *   ({@link unlockDependents});
 * - сервер при сохранении всё равно ищет кольцо ({@link findUnlockCycle}) — данные приходят и из API,
 *   и из книги Excel, мимо редактора.
 *
 * Ключ пункта — тот, которым ключуется раздел выдачи и состояние хаба: голый `topicId` у темы,
 * `scenario:<id>` у сценария (`shared/test-items`).
 *
 * Чистый модуль без фреймворка: им пользуются сервер, веб-редактор и (через `TBTemplate`) пакет.
 */

/** Режим правила открытия пункта. `always_available` — пишет редактор, `always` — синоним. */
export type UnlockRuleMode = "always_available" | "always" | "after_sections_completed" | "after_sections_passed";

/** Правило открытия пункта в том виде, в каком его хранит политика потока. */
export interface UnlockRuleLike {
  mode?: string;
  sectionIds?: readonly string[];
}

/** Карта правил: ключ пункта → правило. */
export type UnlockRuleMap = Readonly<Record<string, UnlockRuleLike | undefined>>;

/** Правило с условием — то есть пункт действительно чего-то ждёт. */
export function isConditionalUnlockMode(mode: string | undefined): mode is "after_sections_completed" | "after_sections_passed" {
  return mode === "after_sections_completed" || mode === "after_sections_passed";
}

/** Пункты, которых ждёт `key` по своему правилу; правило без условия — никого. */
export function unlockPrerequisites(rules: UnlockRuleMap, key: string): string[] {
  const rule = rules[key];
  if (!rule || !isConditionalUnlockMode(rule.mode)) return [];
  return [...(rule.sectionIds ?? [])];
}

/**
 * Пункты, которые (прямо или через цепочку) ждут `key`.
 *
 * Именно их нельзя предложить в «Каких пунктов» у `key`: если `key` начнёт ждать пункт, который уже
 * ждёт `key`, кольцо замкнётся. Сам `key` в ответ не входит — его исключает вызывающий.
 */
export function unlockDependents(rules: UnlockRuleMap, key: string): Set<string> {
  const waitsOn = new Map<string, string[]>();
  for (const from of Object.keys(rules)) {
    for (const to of unlockPrerequisites(rules, from)) {
      const list = waitsOn.get(to) ?? [];
      list.push(from);
      waitsOn.set(to, list);
    }
  }
  const out = new Set<string>();
  const queue = [key];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    for (const dependent of waitsOn.get(next) ?? []) {
      if (dependent === key || out.has(dependent)) continue;
      out.add(dependent);
      queue.push(dependent);
    }
  }
  return out;
}

/**
 * Первое найденное кольцо — ключи пунктов по порядку ожидания (`[A, B]` значит «A ждёт B, B ждёт A»).
 * `null` — колец нет. Пункт, который ждёт сам себя, — кольцо из одного ключа. Ключи, которых нет в
 * составе (`known`), в обход не берутся: правило на исчезнувший пункт кольца не образует.
 */
export function findUnlockCycle(rules: UnlockRuleMap, known?: ReadonlySet<string>): string[] | null {
  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];
  const visit = (key: string): string[] | null => {
    const mark = state.get(key);
    if (mark === "done") return null;
    if (mark === "visiting") return path.slice(path.indexOf(key));
    state.set(key, "visiting");
    path.push(key);
    for (const next of unlockPrerequisites(rules, key)) {
      if (known && !known.has(next)) continue;
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(key, "done");
    return null;
  };
  for (const key of Object.keys(rules)) {
    if (known && !known.has(key)) continue;
    const cycle = visit(key);
    if (cycle) return cycle;
  }
  return null;
}

/**
 * Убрать пункт из правил: его собственное правило и упоминания в чужих. Правило, у которого после
 * этого не осталось пунктов, снимается целиком — «после завершения ничего» значило бы «сразу», но
 * читалось бы как условие.
 */
export function pruneUnlockRules<R extends UnlockRuleLike>(
  rules: Readonly<Record<string, R>>,
  removedKey: string,
): Record<string, R> {
  const out: Record<string, R> = {};
  for (const [key, rule] of Object.entries(rules)) {
    if (key === removedKey) continue;
    if (!isConditionalUnlockMode(rule.mode)) {
      out[key] = rule;
      continue;
    }
    const ids = (rule.sectionIds ?? []).filter((id) => id !== removedKey);
    if (ids.length === 0) continue;
    out[key] = { ...rule, sectionIds: ids };
  }
  return out;
}

/**
 * Хвост подзаголовка свёрнутой карточки: «откроется после завершения 1, 2» / «откроется после
 * успешного прохождения 1, 2». Номера — места пунктов в составе; пункты, которых в составе нет,
 * пропускаются. Правила нет или не осталось ни одного номера — `null`.
 *
 * @param numberOf Номер пункта по его ключу.
 */
export function unlockSummary(rule: UnlockRuleLike | undefined, numberOf: (key: string) => number | undefined): string | null {
  if (!rule || !isConditionalUnlockMode(rule.mode)) return null;
  const numbers = (rule.sectionIds ?? [])
    .map(numberOf)
    .filter((n): n is number => typeof n === "number")
    .sort((a, b) => a - b);
  if (numbers.length === 0) return null;
  const what = rule.mode === "after_sections_passed" ? "успешного прохождения" : "завершения";
  return `откроется после ${what} ${numbers.join(", ")}`;
}

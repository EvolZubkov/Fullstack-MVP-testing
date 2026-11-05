# Сценарий в ИС, П1 «Модель v2»: план реализации

> **Для исполнителя:** обязательный навык — superpowers:subagent-driven-development (рекомендуется) или
> superpowers:executing-plans. Шаги отмечаются флажками `- [ ]`.

**Цель.** Перевести «Сценарий в ИС» на контракт версии 2 из
[v2-design.md](../specs/sim-scenario/v2-design.md) (разделы 1, 2, 4.2–4.3, шаг 1 раздела 6): вид сценария, варианты
по устройствам, финалы, этапы, маршруты, стоимость действий, оптимум, распознавание маршрута, оси оценки. Поведение
продукта для существующих сценариев не меняется.

**Архитектура.** Одна дверь в модель — `shared/sim/upgrade.ts`: любой вход (архив, вопрос, снимок публикации,
пакет) читается как v2, а v1 переводится при чтении. В базе ничего не переписывается: снимки неизменяемы и
навсегда хранят v1, а dev-БД общая для всех worktree. Пишется только v2: импорт архива и сохранение вопроса.
Движок, плеер, обложка и аналитика работают с плоским видом одного устройства — `PlayableScenario` из
`shared/sim/variant.ts`. У него те же имена полей, что у v1 (`start`, `scenes`, `settings.stage`), поэтому код,
обходящий граф, почти не меняется. Новые чистые модули: `costs.ts` (стоимость), `optimum.ts` (поиск самого
дешёвого пути по состояниям), `routes.ts` (маршруты), `analysis.ts` (метрики и оси).

**Технологии.** TypeScript, Vitest; новых зависимостей нет.

**Чего здесь НЕТ** (следующие шаги раздела 6): переключатель `model: axes` в тесте и запекание оптимума в пакет
(П4), кнопка «Я закончил» и тексты окна результата исследовательского сценария (эскизы П4), полный след (П2, П5),
редактор (Р1–Р5), телефонный плеер.

---

## Правила работы в этом worktree

- Worktree: `C:\Repositories\test-builder-sim-editor`, ветка `sim-editor`. `node_modules` — junction на главную
  копию. Все команды — из корня worktree.
- Тесты только точечные: `npm test -- <путь>`. Полный `npm test` и `npm run test:cov` — только с явного согласия
  владельца.
- Типы проверять без общего кэша: `npx tsc --noEmit --incremental false`. `tsc` не видит `tests/` — смену
  экспортируемой сигнатуры дополнительно искать `grep` по `tests/`, `client/src/**/__tests__`, `server/**/__tests__`.
- Коммиты без трейлера `Co-Authored-By`.
- Dev-БД общая: приёмка с импортом архива пишет v2 в общую БД, а код `main` в других worktree v2 не читает. Импорт
  для приёмки — только в приватную тему учётки приёмки.
- Тесты зелёные после каждой задачи: до задач 5 и 10 движок и проверки работают на временном псевдониме версии 1.
  Красным между волнами бывает только `tsc` в файлах, которые ещё ждут своей задачи.
- Приёмку задания делает не исполнитель, а скрипт `scripts/sim/v2/verify-task.ps1` по манифесту
  `scripts/sim/v2/tasks.json`: разрешённые файлы, тесты, допустимые правки старых тестов, эталон пакета SCORM. Файлы
  `scripts/sim/v2/*`, сам план, файл координации и `tests/sim-host-parity/known-divergences.ts` исполнителям трогать
  запрещено — скрипт это ловит.

## Карта файлов

| Файл | Что | Задача |
| --- | --- | --- |
| `tests/fixtures/sim/scenario-v1.json` | Создать: копия нынешнего примера v1, опора регрессии | 0 |
| `shared/sim/contract.ts` | Переписать: типы v2 | 1 |
| `shared/sim/contract-v1.ts` | Создать: типы v1, только для чтения | 1 |
| `shared/sim/upgrade.ts` | Создать: v1 в v2, `asScenario`, `scenarioOf`, `withCurrentScenario` | 2 |
| `shared/sim/variant.ts` | Создать: `PlayableScenario`, `playable` | 3 |
| `shared/sim/costs.ts` | Создать: стоимость действий | 4 |
| `shared/sim/engine.ts` | Изменить: v2, финалы, `declare`, стоимость | 5 |
| `shared/sim/protocol-codec.ts`, `shared/sim/replay.ts` | Изменить: `declare`, устройство | 6 |
| `shared/sim/optimum.ts` | Создать: поиск самого дешёвого пути | 7 |
| `shared/sim/routes.ts` | Создать: маршруты | 8 |
| `shared/sim/analysis.ts` | Создать: метрики прогона и оси | 9 |
| `shared/sim/validate.ts` | Переписать: проверки v2 | 10 |
| `shared/sim/cover.ts`, `shared/sim/player.ts`, `shared/sim/browser-entry.ts` | Изменить: вход через `playable` | 11 |
| `server/**` (места чтения сценария), `server/scorm/builders/test-json.ts` | Изменить: `scenarioOf`, запись v2 | 12 |
| `client/src/features/**` (места чтения сценария) | Изменить: `scenarioOf`, тип входа | 13 |
| `docs/specs/sim-scenario/*` | Пример v2, схемы, формат обмена и результата | 14 |
| `server/services/__tests__/lms-export-import.test.ts` | Фикстура сценария по контракту, прогон на v1 и v2 | 16 |

---

### Задача 0. Опорный сценарий v1 для тестов

Пример `docs/specs/sim-scenario/example/scenario.json` в задаче 14 станет v2. Нынешние тесты меняют его как v1
(`s.scenes[0].zones…`), поэтому они переезжают на неизменную копию v1 — и заодно доказывают, что вход v1 работает
как раньше.

**Файлы:** создать `tests/fixtures/sim/scenario-v1.json`; изменить тесты из списка ниже.

- [ ] **Шаг 1. Скопировать пример.**

```powershell
New-Item -ItemType Directory -Force tests\fixtures\sim | Out-Null
Copy-Item docs\specs\sim-scenario\example\scenario.json tests\fixtures\sim\scenario-v1.json
```

- [ ] **Шаг 2. Перевести чтение сценария в тестах на копию.** Изображения остаются в `docs/specs/sim-scenario/example/media`.

| Файл | Было | Стало |
| --- | --- | --- |
| `tests/helpers/sim-runs.ts:17` | `"docs/specs/sim-scenario/example/scenario.json"` | `"tests/fixtures/sim/scenario-v1.json"` |
| `tests/sim-replay-scoring.test.ts:18` | то же | то же |
| `tests/sim-host-parity/fixture.ts:42` | то же | то же |
| `tests/sim-field-stacking.test.ts:15` | то же | то же |
| `tests/sim-engine.test.ts:16` | то же | то же |
| `tests/sim-lms-protocol.test.ts:26` | `import example from "../docs/specs/sim-scenario/example/scenario.json"` | `import example from "./fixtures/sim/scenario-v1.json"` |
| `tests/sim-cover.test.ts:10` | то же | то же |
| `tests/sim-analytics-stats.test.ts:12` | то же | то же |
| `tests/sim-validate.test.ts:14` | `readFileSync(resolve(ROOT, "scenario.json"), "utf8")` | `readFileSync(resolve(process.cwd(), "tests/fixtures/sim/scenario-v1.json"), "utf8")` |
| `tests/sim-scenario-archive.test.ts:41` | то же | то же |

Импорт JSON из `tests/sim-host-parity/*.ts`, если он есть, — путь `../fixtures/sim/scenario-v1.json`.

- [ ] **Шаг 3. Прогнать затронутые наборы — до изменений кода они должны остаться зелёными.**

```powershell
npm test -- tests/sim-engine.test.ts tests/sim-validate.test.ts tests/sim-scenario-archive.test.ts tests/sim-replay-scoring.test.ts tests/sim-lms-protocol.test.ts tests/sim-cover.test.ts tests/sim-analytics-stats.test.ts tests/sim-field-stacking.test.ts tests/sim-host-parity
```

Ожидается: все PASS.

- [ ] **Шаг 4. Коммит.**

```powershell
git add tests/fixtures/sim/scenario-v1.json tests
git commit -m "test(sim): опорный сценарий v1 для регрессии перед переходом на контракт v2"
```

---

### Задача 1. Контракт v2

**Файлы:** переписать `shared/sim/contract.ts`; создать `shared/sim/contract-v1.ts`.

- [ ] **Шаг 1. Записать `shared/sim/contract.ts` целиком.**

```ts
/**
 * @module shared/sim/contract
 *
 * The contract of the «Сценарий в ИС» question type, version 2: what a scenario IS
 * (`scenario.json` of the exchange archive) and what the player RETURNS (the result).
 *
 * A scenario is a COMMON part — kind, task, media library, fields, goal checks, stages — and
 * VARIANTS by device (`docs/specs/sim-scenario/v2-design.md`, section 1). A variant is a graph of
 * SCENES. A scene is a stage of a fixed size with ordered image ELEMENTS from the library (the
 * last one is on top), field placements, action ZONES and key bindings. A zone's EFFECTS move the
 * run to another scene, show or hide an element of the current scene, or write a field. Entering a
 * scene with an END finishes the run: `success` is judged by the common goal checks, `fail` is a
 * dead end, `finale` closes a research scenario.
 *
 * Version 1 — one graph, goal checks on the scene — is `./contract-v1`; `./upgrade` turns it into
 * this version, and every entry point of `shared/sim` accepts both.
 *
 * These types mirror `docs/specs/sim-scenario/scenario.schema.json` and
 * `docs/specs/sim-scenario/result.schema.json` one to one: a field added here without the schema
 * (or the other way round) is the «silent erasure» class of bug — an editor writing what the
 * exchange format drops.
 *
 * Pure types, framework-free — safe to bundle into the SCORM runtime.
 */
import type { AnswerRuleSet } from "@shared/answer-check";
import type { ZoneShape } from "./geometry";

export type { Point, ZoneShape } from "./geometry";

/** `format` value of a scenario file. */
export const SCENARIO_FORMAT = "skillum.sim-scenario";
/** `format` value of a result document. */
export const RESULT_FORMAT = "skillum.sim-result";
/** Scenario contract version this module implements. */
export const CONTRACT_VERSION = 2;
/** Result document version the engine writes. */
export const RESULT_VERSION = 2;

/** A rectangle in stage pixels; `x`, `y` is the top-left corner. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pixel size of a stage or an image. */
export interface Size {
  w: number;
  h: number;
}

/** What a scenario is for: judging a skill, or studying behaviour without a verdict. */
export type ScenarioKind = "control" | "research";

/** The device a variant is laid out for. */
export type Device = "desktop" | "phone";

/** Mouse actions of a desktop variant. */
export type MouseAction = "click" | "dblclick" | "rightclick" | "hover" | "drag";

/** Gestures of a phone variant. */
export type Gesture = "tap" | "doubletap" | "longpress" | "swipe-left" | "swipe-right" | "swipe-up" | "swipe-down";

/** What a zone reacts to. */
export type ZoneAction = MouseAction | Gesture;

/** Kinds of action a cost is set for: zone actions, key bindings, field commits. */
export type ActionKind = ZoneAction | "key" | "field";

/** Cost of an action by its kind, in steps; absent kinds take the system default. */
export type ActionCosts = Partial<Record<ActionKind, number>>;

/** An image of the scenario's library. */
export interface MediaItem {
  id: string;
  title?: string;
  /** Path inside the exchange archive, `media/<name>`; a media-library address once stored. */
  file: string;
  w: number;
  h: number;
}

/** How an element appears when a scene introduces it. Only plain effects, by design. */
export interface Appear {
  mode?: "with-previous" | "after-previous";
  delayMs?: number;
  effect?: "none" | "fade";
  durationMs?: number;
}

/** An image placed on a scene. Array order is z-order: later is on top. */
export interface SceneElement {
  id: string;
  media: string;
  x: number;
  y: number;
  /** Defaults to the image's own width. */
  w?: number;
  h?: number;
  /** Hidden when the element first appears; shown by `show` or `toggle`. */
  hidden?: boolean;
  /** A shown element hides itself after this delay — system messages. */
  autoHideMs?: number;
  appear?: Appear;
  /** The element scrolls inside its own box; zones with `in` use image coordinates. */
  scroll?: { direction?: "vertical" | "horizontal" | "both" };
}

/** A value the participant types or chooses; values are global for the run. */
export interface FieldDef {
  id: string;
  title?: string;
  /** `keyboard` — typed by the participant; `effect` — written by a `set` effect. */
  fill: "keyboard" | "effect";
  initial?: string;
  check?: AnswerRuleSet;
  /** `input` — a wrong value is a miss as soon as it is committed; `goal` — judged only at the goal. */
  checkWhen?: "input" | "goal";
  tabIndex?: number;
  allowPaste?: boolean;
  hint?: string;
}

/** Where a field sits on a scene and whether it can be typed into there. */
export interface FieldPlacement extends Box {
  field: string;
  editable?: boolean;
}

/** One effect of an action, applied in order. */
export type Effect =
  | { goto: string }
  | { show: string }
  | { hide: string }
  | { toggle: string }
  | { set: string; value: string }
  | { clear: string };

/** A condition over field values and element visibility. */
export type Condition =
  | { filled: string[] }
  | { field: string; check: AnswerRuleSet }
  | { visible: string }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

/**
 * The role of an action — what doing it MEANS.
 *
 * `path` and `alt` lead to the goal; `detour` is a harmless extra move; `trap` is a plausible
 * mistake with consequences, named by `error`; `neutral` is neither an action nor a miss. A
 * control scenario sets a role on every action; in a research scenario an action without a role
 * is simply an action.
 */
export type Role = "path" | "alt" | "detour" | "trap" | "neutral";

/** What zones and key bindings share. */
export interface ActionBase {
  id: string;
  title?: string;
  /** Required in a control scenario, optional in a research one. */
  role?: Role;
  /** Only for `trap`: the name of the mistake, for the protocol and analytics. */
  error?: string;
  when?: Condition;
  effects?: Effect[];
  /** Applied when `when` does not hold; doing that is a miss («the system refused»). */
  otherwise?: Effect[];
  hint?: string;
  /** Cost of this action in steps; absent — the scenario's or the system's default for its kind. */
  cost?: number;
}

/** What a zone has besides its role, effects and shape. */
export interface ZoneExtras {
  /** Mouse actions on a desktop variant, gestures on a phone one; default `click`. */
  action?: ZoneAction;
  hoverMs?: number;
  drop?: Box;
  /** A scrolling element whose image coordinates the zone uses. */
  in?: string;
  /** Copyable text of a neutral zone. */
  copyText?: string;
}

/**
 * A place on a scene where an action does something.
 *
 * Shape (see `shared/sim/geometry`): a rectangle `x, y, w, h` by default, with optional rounded
 * corners `radius`; `shape: "ellipse"` — the ellipse inscribed in that rectangle (a circle when
 * `w === h`); `shape: "polygon"` — `points` in stage pixels, no rectangle stored.
 */
export type Zone = ActionBase & ZoneExtras & ZoneShape;

/** A keyboard shortcut working on a scene. */
export interface KeyBinding extends ActionBase {
  /** Normalised combination: `Ctrl+S`, `Shift+F10`, `Escape`. Letters are physical keys. */
  keys: string;
}

/** A field check of the goal. */
export interface GoalCheck {
  field: string;
  /** Defaults to the field's own check. */
  check?: AnswerRuleSet;
  /** Defaults to `true`: a failed critical check fails the goal whatever else passed. */
  critical?: boolean;
  /** Defaults to 1. */
  weight?: number;
}

/** The goal of a control scenario — common to every variant, so outcomes compare across devices. */
export interface Goal {
  checks: GoalCheck[];
}

/**
 * Entering a scene with an end finishes the run.
 *
 * `success` — judged by the scenario's goal checks (control only); `fail` — a dead end, usually
 * after a trap; `finale` — a named end of a research scenario, `target` marks the ones efficiency
 * is measured to.
 */
export type SceneEnd =
  | { outcome: "success"; message?: string }
  | { outcome: "fail"; message?: string }
  | { outcome: "finale"; title: string; message?: string; target?: boolean };

/** A stage of the task: a named group of scenes, the same across variants. */
export interface StageDef {
  id: string;
  title: string;
}

/** A key action of a route: the zone or key binding `action` of scene `scene`. */
export interface RouteKey {
  scene: string;
  action: string;
}

/** A declared way to the goal with the author's rating of how good it is. */
export interface Route {
  id: string;
  title: string;
  /** In (0; 1]: 1 — the best way. */
  rating: number;
  /** Key actions in order; other actions between them do not break the route. */
  keys: RouteKey[];
}

/** A node of the scenario graph. */
export interface Scene {
  id: string;
  title: string;
  /** Defaults to the variant's stage size. */
  size?: Size;
  elements: SceneElement[];
  fields?: FieldPlacement[];
  zones?: Zone[];
  keys?: KeyBinding[];
  /** A click past every zone is a miss AND moves here — this is how an open menu closes. */
  onMissGoto?: string;
  /** The stage of the task this scene belongs to. */
  stage?: string;
  end?: SceneEnd;
}

/** Scenario-wide settings, common to every variant. */
export interface Settings {
  normSeconds?: number;
  limitSeconds?: number | null;
  hints?: { enabled?: boolean; afterMisses?: number };
  counters?: { actions?: boolean; misses?: boolean; detours?: boolean };
  /** Research only: the participant may finish by «Я закончил»; default `true`. */
  finishButton?: boolean;
  /** Default costs by action kind. */
  costs?: ActionCosts;
  /** Rating of a run outside every declared route; absent — judged against the optimum. */
  otherRouteRating?: number;
}

/** One device's graph of the scenario. */
export interface Variant {
  device: Device;
  /** Default scene size. */
  stage?: Size;
  /** Narrowest participant window the variant plays in; default 1280 on desktop. */
  minViewportWidth?: number;
  start: string;
  scenes: Scene[];
  routes?: Route[];
}

/** The task text and the facts about a scenario. */
export interface ScenarioMeta {
  title: string;
  task: string;
  language?: string;
  system?: string;
  createdAt?: string;
  tool?: { name?: string; version?: string };
}

/** The whole `scenario.json`. */
export interface Scenario {
  format: typeof SCENARIO_FORMAT;
  version: typeof CONTRACT_VERSION;
  kind: ScenarioKind;
  meta: ScenarioMeta;
  settings?: Settings;
  media: MediaItem[];
  fields?: FieldDef[];
  /** Control only. */
  goal?: Goal;
  stages?: StageDef[];
  variants: Variant[];
}

// ── Result ──────────────────────────────────────────────────────────────────

/**
 * How the run ended.
 *
 * `success` — the goal with every check passed; `partial` — every critical check passed, some
 * others did not; `fail` — a fail end, or a critical check failed; `finale` — a research finale;
 * `declared` — the participant said «Я закончил»; `exited` — left early; `timeout` — the
 * scenario's own limit ran out.
 */
export type Outcome = "success" | "partial" | "fail" | "finale" | "declared" | "exited" | "timeout";

/** One entry of the protocol. `t` is milliseconds since the run started. */
export type SimEvent =
  | { t: number; type: "enter"; scene: string }
  | { t: number; type: "action"; scene: string; id: string; role?: Exclude<Role, "neutral">; error?: string }
  | { t: number; type: "blocked"; scene: string; id: string }
  | { t: number; type: "miss"; scene: string; x: number; y: number }
  | { t: number; type: "value"; scene: string; field: string; value: string; correct: boolean | null }
  | { t: number; type: "hint"; scene: string; target: string }
  | { t: number; type: "copy"; scene: string; id: string }
  | { t: number; type: "goal"; scene: string; outcome: Outcome; finale?: string }
  | { t: number; type: "declare" }
  | { t: number; type: "exit" }
  | { t: number; type: "timeout" };

/** One field check of the reached goal. */
export interface CheckResult {
  field: string;
  passed: boolean;
  critical: boolean;
  weight: number;
}

/** The result document the player returns. */
export interface SimResult {
  format: typeof RESULT_FORMAT;
  version: number;
  scenario: { title: string };
  /** The device variant that was played; absent in results of version 1 — desktop. */
  variant?: Device;
  startedAt: string;
  durationMs: number;
  outcome: Outcome;
  /** The success or fail end reached, if any. */
  goal: {
    scene: string;
    message?: string;
    checks: CheckResult[];
    /** Weight of passed checks over all checks; 1 when there are none. */
    share: number;
  } | null;
  /** The research finale reached, if any. */
  finale?: { scene: string; title: string; target: boolean } | null;
  counts: {
    actions: number;
    misses: number;
    blocked: number;
    wrongValues: number;
    detours: number;
    traps: number;
    hints: number;
  };
  /** Sum of the costs of accepted actions; absent in results of version 1. */
  cost?: number;
  /** Traps fallen into, in order. */
  traps: { id: string; error: string; t: number }[];
  /** Final field values. */
  fields: Record<string, string>;
  events: SimEvent[];
}
```

- [ ] **Шаг 2. Записать `shared/sim/contract-v1.ts`.**

```ts
/**
 * @module shared/sim/contract-v1
 *
 * Version 1 of the scenario contract, kept only to READ what was written in it: exchange archives
 * made before version 2, questions saved before it and — for good — publication snapshots, which
 * are immutable. `./upgrade` turns it into the current contract; nothing writes version 1.
 *
 * Only what differs from version 2 is declared here; the rest is shared with `./contract`.
 */
import type { FieldDef, GoalCheck, MediaItem, SCENARIO_FORMAT, Scene, ScenarioMeta, Settings, Size } from "./contract";

/** `version` of a version 1 scenario. */
export const CONTRACT_V1 = 1;

/** Version 1 kept the goal, checks included, on the scene. */
export interface GoalV1 {
  outcome: "success" | "fail";
  message?: string;
  checks?: GoalCheck[];
}

/** A version 1 scene: `goal` instead of `end`, no stage of the task, reserved `views`. */
export interface SceneV1 extends Omit<Scene, "end" | "stage"> {
  goal?: GoalV1;
  /** Reserved for a phone layout; never authored, dropped by the upgrade. */
  views?: unknown[];
}

/** Version 1 settings also held the stage size and the narrowest window. */
export interface SettingsV1 extends Settings {
  stage?: Size;
  minViewportWidth?: number;
}

/** The whole version 1 `scenario.json`. */
export interface ScenarioV1 {
  format: typeof SCENARIO_FORMAT;
  version: typeof CONTRACT_V1;
  meta: ScenarioMeta;
  settings?: SettingsV1;
  media: MediaItem[];
  fields?: FieldDef[];
  start: string;
  scenes: SceneV1[];
}
```

- [ ] **Шаг 2а. Временные псевдонимы версии 1 в движке и проверках.** Движок и проверки переходят на v2 только в
  задачах 5 и 10, а до тех пор обязаны вести себя как раньше: тесты между волнами остаются зелёными. В
  `shared/sim/engine.ts` и `shared/sim/validate.ts` убрать `CONTRACT_VERSION` из импорта `./contract` и добавить строку:

```ts
// Temporary until this module moves to version 2 (plan task 5 for the engine, task 10 for the checks).
import { CONTRACT_V1 as CONTRACT_VERSION } from "./contract-v1";
```

Больше в этих двух файлах в задаче 1 ничего не менять.

- [ ] **Шаг 3. Проверить типы — ожидаются ошибки потребителей, это карта для задач 5–13.**

```powershell
npx tsc --noEmit --incremental false 2>&1 | Select-String "error TS" | Out-File -Encoding utf8 $env:TEMP\sim-v2-tsc.txt; (Get-Content $env:TEMP\sim-v2-tsc.txt).Count
```

Ожидается: ошибки в `shared/sim/*`, `server/**`, `client/**` (обращения к `scenario.scenes`, `scene.goal`,
`Record<Outcome, …>`). Не исправлять здесь.

- [ ] **Шаг 3а. Тесты по-прежнему зелёные** — та же команда, что в шаге 3 задачи 0. Ожидается: все PASS.

- [ ] **Шаг 4. Коммит.**

```powershell
git add shared/sim/contract.ts shared/sim/contract-v1.ts shared/sim/engine.ts shared/sim/validate.ts
git commit -m "feat(sim): контракт v2 — вид сценария, варианты устройств, финалы, этапы, маршруты, стоимость"
```

---

### Задача 2. Одна дверь в модель: `upgrade.ts`

**Файлы:** создать `shared/sim/upgrade.ts`, `tests/sim-upgrade.test.ts`.

- [ ] **Шаг 1. Написать падающий тест `tests/sim-upgrade.test.ts`.**

```ts
/**
 * @module tests/sim-upgrade
 * @description Version 1 scenarios read as version 2 (`shared/sim/upgrade`, v2-design.md section 1,
 * «Перевод v1 в v2»): the move is mechanical and lossless, a version 2 scenario passes through
 * untouched, and question content is read through one helper.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { asScenario, liftV1, scenarioOf, upgradeScenario, withCurrentScenario, ScenarioUpgradeError } from "@shared/sim/upgrade";
import type { ScenarioV1 } from "@shared/sim/contract-v1";

const v1 = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/sim/scenario-v1.json"), "utf8")) as ScenarioV1;

describe("перевод v1 в v2", () => {
  it("сцены уходят в вариант desktop, проверки цели — в корень, вид — control", () => {
    const { scenario, notes } = upgradeScenario(v1);
    expect(scenario.version).toBe(2);
    expect(scenario.kind).toBe("control");
    expect(scenario.variants).toHaveLength(1);
    const variant = scenario.variants[0];
    expect(variant.device).toBe("desktop");
    expect(variant.start).toBe(v1.start);
    expect(variant.scenes.map((s) => s.id)).toEqual(v1.scenes.map((s) => s.id));
    const goalScene = v1.scenes.find((s) => s.goal?.outcome === "success")!;
    expect(scenario.goal?.checks).toEqual(goalScene.goal!.checks);
    expect(variant.scenes.find((s) => s.id === goalScene.id)!.end).toEqual({ outcome: "success", ...(goalScene.goal!.message ? { message: goalScene.goal!.message } : {}) });
    expect(variant.scenes.some((s) => "goal" in s)).toBe(false);
    expect(notes).toEqual([]);
  });

  it("размер сцены и минимальная ширина окна переезжают в вариант", () => {
    const { scenario } = upgradeScenario({ ...v1, settings: { ...v1.settings, stage: { w: 1600, h: 900 }, minViewportWidth: 1400 } });
    expect(scenario.variants[0].stage).toEqual({ w: 1600, h: 900 });
    expect(scenario.variants[0].minViewportWidth).toBe(1400);
    expect(scenario.settings).not.toHaveProperty("stage");
    expect(scenario.settings).not.toHaveProperty("minViewportWidth");
  });

  it("сцены-провалы становятся end: fail с тем же сообщением", () => {
    const failScene = v1.scenes.find((s) => s.goal?.outcome === "fail")!;
    const { scenario } = upgradeScenario(v1);
    expect(scenario.variants[0].scenes.find((s) => s.id === failScene.id)!.end).toEqual({ outcome: "fail", ...(failScene.goal!.message ? { message: failScene.goal!.message } : {}) });
  });

  it("разные проверки у двух сцен-целей — отказ с объяснением", () => {
    const twin = structuredClone(v1);
    const goal = twin.scenes.find((s) => s.goal?.outcome === "success")!;
    twin.scenes.push({ ...structuredClone(goal), id: "goal-2", title: "Вторая цель", goal: { outcome: "success", checks: [] } });
    expect(() => upgradeScenario(twin)).toThrow(ScenarioUpgradeError);
    expect(() => upgradeScenario(twin)).toThrow(/разные поля/);
  });

  it("views версии 1 не переносятся и называются в заметках", () => {
    const withViews = structuredClone(v1);
    withViews.scenes[0].views = [{ device: "phone" }];
    const { scenario, notes } = upgradeScenario(withViews);
    expect(scenario.variants[0].scenes[0]).not.toHaveProperty("views");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/views/);
  });

  it("v2 проходит без изменений, тем же объектом", () => {
    const v2 = asScenario(v1);
    expect(asScenario(v2)).toBe(v2);
  });

  it("перевод запоминается: тот же вход — тот же объект", () => {
    expect(asScenario(v1)).toBe(asScenario(v1));
  });

  it("неизвестная версия — отказ", () => {
    expect(() => upgradeScenario({ ...v1, version: 7 } as never)).toThrow(/Неизвестная версия/);
  });
});

describe("liftV1 — терпимый перевод для проверок", () => {
  it("не падает на сломанном v1 и сохраняет сломанное как есть", () => {
    const { doc, conflict } = liftV1({ format: "skillum.sim-scenario", version: 1, scenes: "oops", start: 5 });
    expect(conflict).toBeNull();
    expect((doc.variants as Array<Record<string, unknown>>)[0].scenes).toBe("oops");
    expect((doc.variants as Array<Record<string, unknown>>)[0].start).toBe(5);
  });
});

describe("содержимое вопроса", () => {
  it("scenarioOf читает v1 и v2, отдаёт null без сценария", () => {
    expect(scenarioOf({ scenario: v1 })?.version).toBe(2);
    expect(scenarioOf({ scenario: asScenario(v1) })?.version).toBe(2);
    expect(scenarioOf({})).toBeNull();
    expect(scenarioOf(null)).toBeNull();
    expect(scenarioOf({ scenario: { version: 9 } })).toBeNull();
  });

  it("withCurrentScenario подменяет сценарий на v2 и не трогает прочее", () => {
    const data = { scenario: v1, extra: 1 };
    const next = withCurrentScenario(data);
    expect(next.extra).toBe(1);
    expect((next.scenario as { version: number }).version).toBe(2);
    const plain = { options: ["a"] };
    expect(withCurrentScenario(plain)).toBe(plain);
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает.**

```powershell
npm test -- tests/sim-upgrade.test.ts
```

Ожидается: FAIL — `Failed to resolve import "@shared/sim/upgrade"`.

- [ ] **Шаг 3. Записать `shared/sim/upgrade.ts`.**

```ts
/**
 * @module shared/sim/upgrade
 *
 * One door into the scenario model: whatever version a scenario was written in, the code past
 * this module sees version 2 (`docs/specs/sim-scenario/v2-design.md`, section 1, «Перевод v1 в v2»).
 *
 * Why at READ time and not once in the database: publication snapshots are immutable and keep
 * version 1 for good, and the dev database is shared by every worktree — rewriting it would break
 * sessions still running version 1 code. New content is written as version 2 (archive import,
 * question save); old content is upgraded when read.
 *
 * The upgrade is mechanical and lossless for everything version 1 could express except `views`, a
 * phone layout that was reserved but never authored: it is dropped and named in the notes.
 *
 * Pure and framework-free: the SCORM runtime gets it through the `TBTemplate` bundle.
 */
import { CONTRACT_VERSION, SCENARIO_FORMAT, type Scenario } from "./contract";
import { CONTRACT_V1, type ScenarioV1 } from "./contract-v1";

/** A scenario of any version the module reads. */
export type ScenarioInput = Scenario | ScenarioV1;

/** A scenario that cannot be read as the current version. */
export class ScenarioUpgradeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioUpgradeError";
  }
}

/** What an upgrade produced. */
export interface UpgradeOutcome {
  scenario: Scenario;
  /** What was not carried over, in words for the author; empty for a clean upgrade. */
  notes: string[];
}

/** What {@link liftV1} produced from a document of unknown quality. */
export interface LiftedV1 {
  /** The version 2 shape; invalid parts are carried over as they were, for the checks to name. */
  doc: Record<string, unknown>;
  notes: string[];
  /** Why the upgrade is impossible; `null` — it is possible. */
  conflict: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const upgraded = new WeakMap<object, Scenario>();

/**
 * Move a version 1 document into the version 2 shape without trusting it.
 *
 * The import checks run on what this returns, so a broken version 1 archive is reported in the
 * same words as a broken version 2 one. Nothing is validated or dropped here except `views`.
 *
 * @param raw A parsed `scenario.json` whose `version` is 1.
 */
export function liftV1(raw: Obj): LiftedV1 {
  const notes: string[] = [];
  const sceneList = Array.isArray(raw.scenes) ? raw.scenes : null;
  const success = (sceneList ?? []).filter(
    (s): s is Obj => isObj(s) && isObj(s.goal) && s.goal.outcome === "success",
  );
  const checkSets = new Set(success.map((s) => JSON.stringify((s.goal as Obj).checks ?? [])));
  const conflict = checkSets.size > 1
    ? `Сцены-цели ${success.map((s) => `«${String(s.title || s.id)}»`).join(", ")} проверяют разные поля: в версии 2 у сценария одна цель — оставьте у них одинаковые проверки`
    : null;

  const scenes = sceneList
    ? sceneList.map((s) => {
      if (!isObj(s)) return s;
      const { goal, views, ...rest } = s;
      if (Array.isArray(views) && views.length > 0) {
        notes.push(`Сцена «${String(s.title || s.id)}»: раскладка views версии 1 не переносится — телефон задаётся отдельным вариантом`);
      }
      if (goal === undefined) return rest;
      const { checks: _checks, ...end } = isObj(goal) ? goal : {};
      return { ...rest, end };
    })
    : raw.scenes;

  const { version: _version, scenes: _scenes, start, settings, ...common } = raw;
  const variant: Obj = { device: "desktop", start, scenes };
  let commonSettings: Obj | undefined;
  if (isObj(settings)) {
    const { stage, minViewportWidth, ...rest } = settings;
    if (stage !== undefined) variant.stage = stage;
    if (minViewportWidth !== undefined) variant.minViewportWidth = minViewportWidth;
    commonSettings = rest;
  } else if (settings !== undefined) {
    commonSettings = settings as Obj;
  }
  const doc: Obj = {
    ...common,
    version: CONTRACT_VERSION,
    kind: "control",
    ...(commonSettings !== undefined ? { settings: commonSettings } : {}),
    ...(success.length ? { goal: { checks: (success[0].goal as Obj).checks ?? [] } } : {}),
    variants: [variant],
  };
  return { doc, notes, conflict };
}

/**
 * Upgrade a version 1 scenario.
 *
 * @throws ScenarioUpgradeError when success scenes carry different checks — version 2 has one goal.
 */
export function upgradeV1(v1: ScenarioV1): UpgradeOutcome {
  const { doc, notes, conflict } = liftV1(v1 as unknown as Obj);
  if (conflict) throw new ScenarioUpgradeError(conflict);
  return { scenario: doc as unknown as Scenario, notes };
}

/**
 * Upgrade a scenario of any known version to the current one.
 *
 * @throws ScenarioUpgradeError on an unknown version or an upgrade that cannot be done.
 */
export function upgradeScenario(input: ScenarioInput): UpgradeOutcome {
  if (input.version === CONTRACT_VERSION) return { scenario: input as Scenario, notes: [] };
  if (input.version === CONTRACT_V1) return upgradeV1(input as ScenarioV1);
  throw new ScenarioUpgradeError(`Неизвестная версия формата ${String((input as { version?: unknown }).version)}`);
}

/**
 * The scenario in the current version. The upgrade of a given input object is done once.
 *
 * @throws ScenarioUpgradeError as {@link upgradeScenario}.
 */
export function asScenario(input: ScenarioInput): Scenario {
  if (input.version === CONTRACT_VERSION) return input as Scenario;
  const known = upgraded.get(input);
  if (known) return known;
  const { scenario } = upgradeScenario(input);
  upgraded.set(input, scenario);
  return scenario;
}

/**
 * The scenario of a question's content (`questions.dataJson`), in the current version.
 *
 * @returns `null` when there is no scenario or it cannot be read — the caller treats the question
 *   as having no playable scenario, as it did before.
 */
export function scenarioOf(dataJson: unknown): Scenario | null {
  const raw = isObj(dataJson) ? dataJson.scenario : undefined;
  if (!isObj(raw) || raw.format !== SCENARIO_FORMAT) return null;
  try {
    return asScenario(raw as unknown as ScenarioInput);
  } catch {
    return null;
  }
}

/**
 * Question content with its scenario in the current version — what is written back. Content
 * without a readable scenario is returned as it is.
 */
export function withCurrentScenario<T>(dataJson: T): T {
  const scenario = scenarioOf(dataJson);
  if (!scenario || (dataJson as Obj).scenario === scenario) return dataJson;
  return { ...(dataJson as Obj), scenario } as T;
}
```

- [ ] **Шаг 4. Тест проходит.**

```powershell
npm test -- tests/sim-upgrade.test.ts
```

Ожидается: PASS (10 тестов).

- [ ] **Шаг 5. Коммит.**

```powershell
git add shared/sim/upgrade.ts tests/sim-upgrade.test.ts
git commit -m "feat(sim): одна дверь в модель — сценарий v1 читается как v2"
```

---

### Задача 3. Сценарий глазами одного устройства: `variant.ts`

**Файлы:** создать `shared/sim/variant.ts`, `tests/sim-variant.test.ts`.

- [ ] **Шаг 1. Падающий тест.**

```ts
/**
 * @module tests/sim-variant
 * @description The flat view of one device (`shared/sim/variant`): the common part merged with a
 * variant under the field names of version 1, built once per scenario and device.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { playable, isPlayable } from "@shared/sim/variant";
import { asScenario } from "@shared/sim/upgrade";

const v1 = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/sim/scenario-v1.json"), "utf8"));

describe("playable", () => {
  it("сводит общую часть и вариант desktop", () => {
    const play = playable(v1);
    const scenario = asScenario(v1);
    expect(play.device).toBe("desktop");
    expect(play.kind).toBe("control");
    expect(play.start).toBe(scenario.variants[0].start);
    expect(play.scenes).toBe(scenario.variants[0].scenes);
    expect(play.media).toBe(scenario.media);
    expect(play.goal).toEqual(scenario.goal);
    expect(play.settings.stage).toEqual(v1.settings?.stage);
    expect(play.routes).toEqual([]);
    expect(play.stages).toEqual([]);
  });

  it("строится один раз на сценарий и устройство", () => {
    expect(playable(v1)).toBe(playable(v1));
  });

  it("готовый вид возвращается как есть", () => {
    const play = playable(v1);
    expect(isPlayable(play)).toBe(true);
    expect(playable(play)).toBe(play);
    expect(isPlayable(v1)).toBe(false);
  });

  it("нет варианта для устройства — ошибка", () => {
    expect(() => playable(v1, "phone")).toThrow(/нет варианта/);
  });
});
```

- [ ] **Шаг 2. Убедиться, что падает.** `npm test -- tests/sim-variant.test.ts` — FAIL, модуля нет.

- [ ] **Шаг 3. Записать `shared/sim/variant.ts`.**

```ts
/**
 * @module shared/sim/variant
 *
 * The scenario as ONE device plays it: the common part merged with one variant into a flat view —
 * what the engine, the player, the cover and the analytics read.
 *
 * The view keeps the names the single-graph version 1 had (`start`, `scenes`, `settings.stage`,
 * `settings.minViewportWidth`), so code that walks a graph does not care that a scenario has
 * several. The view is derived, never stored and never sent anywhere.
 *
 * Pure and framework-free.
 */
import type {
  Device, FieldDef, Goal, MediaItem, Route, Scenario, ScenarioKind, ScenarioMeta, Scene, Settings, Size, StageDef,
} from "./contract";
import { asScenario, ScenarioUpgradeError, type ScenarioInput } from "./upgrade";

/** The device a scenario plays on when none is named. */
export const DEFAULT_DEVICE: Device = "desktop";

/** Common settings plus what the variant sets for its device. */
export interface PlayableSettings extends Settings {
  stage?: Size;
  minViewportWidth?: number;
}

/** One device's view of a scenario. */
export interface PlayableScenario {
  kind: ScenarioKind;
  device: Device;
  meta: ScenarioMeta;
  settings: PlayableSettings;
  media: MediaItem[];
  fields: FieldDef[];
  goal: Goal | null;
  stages: StageDef[];
  start: string;
  scenes: Scene[];
  routes: Route[];
}

const views = new WeakMap<Scenario, Map<Device, PlayableScenario>>();

/** Is the value already a device view? A stored scenario never is: it has no `device`. */
export function isPlayable(value: unknown): value is PlayableScenario {
  return typeof value === "object" && value !== null
    && typeof (value as { device?: unknown }).device === "string"
    && Array.isArray((value as { scenes?: unknown }).scenes);
}

/**
 * The view of a scenario for a device.
 *
 * @param input A scenario of any version, or a view already built (returned as it is).
 * @param device The device; desktop by default.
 * @throws ScenarioUpgradeError when the scenario cannot be read or has no variant for the device.
 */
export function playable(input: ScenarioInput | PlayableScenario, device: Device = DEFAULT_DEVICE): PlayableScenario {
  if (isPlayable(input)) return input;
  const scenario = asScenario(input);
  let byDevice = views.get(scenario);
  const known = byDevice?.get(device);
  if (known) return known;
  const variant = scenario.variants.find((v) => v.device === device);
  if (!variant) throw new ScenarioUpgradeError(`В сценарии нет варианта для устройства ${device}`);
  const view: PlayableScenario = {
    kind: scenario.kind,
    device,
    meta: scenario.meta,
    settings: {
      ...scenario.settings,
      ...(variant.stage ? { stage: variant.stage } : {}),
      ...(variant.minViewportWidth !== undefined ? { minViewportWidth: variant.minViewportWidth } : {}),
    },
    media: scenario.media,
    fields: scenario.fields ?? [],
    goal: scenario.goal ?? null,
    stages: scenario.stages ?? [],
    start: variant.start,
    scenes: variant.scenes,
    routes: variant.routes ?? [],
  };
  if (!byDevice) {
    byDevice = new Map();
    views.set(scenario, byDevice);
  }
  byDevice.set(device, view);
  return view;
}
```

- [ ] **Шаг 4.** `npm test -- tests/sim-variant.test.ts` — PASS.

- [ ] **Шаг 5. Коммит.**

```powershell
git add shared/sim/variant.ts tests/sim-variant.test.ts
git commit -m "feat(sim): вид сценария для одного устройства"
```

---

### Задача 4. Стоимость действий: `costs.ts`

**Файлы:** создать `shared/sim/costs.ts`, `tests/sim-costs.test.ts`.

- [ ] **Шаг 1. Падающий тест.**

```ts
/**
 * @module tests/sim-costs
 * @description Cost of an action (v2-design.md section 2.1): the action's own cost, else the
 * scenario's default for its kind, else the system default.
 */
import { describe, it, expect } from "vitest";
import { actionCost, fieldCost, DEFAULT_ACTION_COSTS } from "@shared/sim/costs";

describe("стоимость действия", () => {
  it("умолчания системы по виду", () => {
    expect(actionCost({ id: "a" })).toBe(1);
    expect(actionCost({ id: "a", action: "hover" })).toBe(0.5);
    expect(actionCost({ id: "a", action: "drag" })).toBe(1.5);
    expect(actionCost({ id: "k", keys: "Ctrl+S" })).toBe(0.5);
    expect(fieldCost()).toBe(1);
    expect(DEFAULT_ACTION_COSTS.tap).toBe(1);
  });

  it("умолчание сценария сильнее системного, своя стоимость сильнее обоих", () => {
    expect(actionCost({ id: "a" }, { click: 2 })).toBe(2);
    expect(actionCost({ id: "a", cost: 3 }, { click: 2 })).toBe(3);
    expect(actionCost({ id: "k", keys: "F2" }, { key: 0.25 })).toBe(0.25);
    expect(fieldCost({ field: 2 })).toBe(2);
  });

  it("негодные числа не принимаются", () => {
    expect(actionCost({ id: "a", cost: -1 })).toBe(1);
    expect(actionCost({ id: "a" }, { click: Number.NaN })).toBe(1);
  });
});
```

- [ ] **Шаг 2.** `npm test -- tests/sim-costs.test.ts` — FAIL.

- [ ] **Шаг 3. Записать `shared/sim/costs.ts`.**

```ts
/**
 * @module shared/sim/costs
 *
 * What an action costs, in steps (`docs/specs/sim-scenario/v2-design.md`, section 2.1). The run
 * cost and the optimum are sums of these: efficiency compares them.
 *
 * Resolution: the action's own `cost`, else the scenario's `settings.costs` for the action's kind,
 * else the system default. A negative or non-finite number is ignored at every level.
 *
 * Pure and framework-free.
 */
import type { ActionBase, ActionCosts, ActionKind, ZoneAction } from "./contract";

/** System defaults by kind. */
export const DEFAULT_ACTION_COSTS: Readonly<Record<ActionKind, number>> = Object.freeze({
  click: 1,
  dblclick: 1,
  rightclick: 1,
  hover: 0.5,
  drag: 1.5,
  tap: 1,
  doubletap: 1,
  longpress: 1,
  "swipe-left": 1,
  "swipe-right": 1,
  "swipe-up": 1,
  "swipe-down": 1,
  key: 0.5,
  field: 1,
});

const usable = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

/** An action as the cost reads it: a zone has `action`, a key binding has `keys`. */
export type CostedAction = ActionBase & { action?: ZoneAction; keys?: string };

/**
 * Cost of a zone or key binding.
 *
 * @param action The zone or key binding.
 * @param costs The scenario's defaults (`settings.costs`).
 */
export function actionCost(action: CostedAction, costs?: ActionCosts): number {
  if (usable(action.cost)) return action.cost;
  const kind: ActionKind = typeof action.keys === "string" ? "key" : (action.action ?? "click");
  const own = costs?.[kind];
  return usable(own) ? own : DEFAULT_ACTION_COSTS[kind];
}

/** Cost of committing a field value. */
export function fieldCost(costs?: ActionCosts): number {
  return usable(costs?.field) ? costs!.field! : DEFAULT_ACTION_COSTS.field;
}
```

- [ ] **Шаг 4.** `npm test -- tests/sim-costs.test.ts` — PASS.

- [ ] **Шаг 5. Коммит.**

```powershell
git add shared/sim/costs.ts tests/sim-costs.test.ts
git commit -m "feat(sim): стоимость действий по виду, умолчания сценария и системы"
```

---

### Задача 5. Движок на v2

**Файлы:** изменить `shared/sim/engine.ts`, `tests/sim-engine.test.ts`; создать `tests/sim-engine-v2.test.ts`.

- [ ] **Шаг 1. Падающий тест `tests/sim-engine-v2.test.ts`.**

```ts
/**
 * @module tests/sim-engine-v2
 * @description What version 2 adds to the engine: research scenarios (actions without a role,
 * finales, «Я закончил»), the cost of a run, the device of the result.
 */
import { describe, it, expect } from "vitest";
import { createRun } from "@shared/sim/engine";
import type { Scenario } from "@shared/sim/contract";

/** Two scenes: «home» with a zone to «found», a target finale, and a field on «home». */
function research(extra: Partial<Scenario> = {}): Scenario {
  return {
    format: "skillum.sim-scenario",
    version: 2,
    kind: "research",
    meta: { title: "Поиск функции", task: "Найдите экспорт" },
    media: [{ id: "bg", file: "media/bg.png", w: 100, h: 100 }],
    fields: [{ id: "q", fill: "keyboard" }],
    variants: [{
      device: "desktop",
      stage: { w: 100, h: 100 },
      start: "home",
      scenes: [
        {
          id: "home", title: "Главная", elements: [{ id: "bg", media: "bg", x: 0, y: 0 }],
          fields: [{ field: "q", x: 0, y: 80, w: 50, h: 10, editable: true }],
          zones: [
            { id: "menu", x: 0, y: 0, w: 10, h: 10, effects: [{ goto: "found" }] },
            { id: "logo", x: 50, y: 0, w: 10, h: 10, cost: 4, effects: [{ show: "bg" }] },
          ],
          keys: [{ id: "find", keys: "Ctrl+F", effects: [{ goto: "found" }] }],
        },
        { id: "found", title: "Экспорт", elements: [], end: { outcome: "finale", title: "Нашёл", target: true } },
      ],
    }],
    ...extra,
  };
}

describe("исследовательский сценарий", () => {
  it("действие без роли засчитывается и ведёт к финалу", () => {
    const run = createRun(research(), { now: () => 0 });
    run.click(5, 5);
    const r = run.result();
    expect(r.outcome).toBe("finale");
    expect(r.finale).toEqual({ scene: "found", title: "Нашёл", target: true });
    expect(r.counts.actions).toBe(1);
    const action = r.events.find((e) => e.type === "action");
    expect(action).toEqual({ t: 0, type: "action", scene: "home", id: "menu" });
    expect(r.events.at(-1)).toEqual({ t: 0, type: "goal", scene: "found", outcome: "finale", finale: "found" });
  });

  it("«Я закончил» завершает прогон исходом declared", () => {
    const run = createRun(research(), { now: () => 0 });
    expect(run.declare()).toEqual({ kind: "done", outcome: "declared" });
    expect(run.result().outcome).toBe("declared");
    expect(run.result().events.at(-1)).toEqual({ t: 0, type: "declare" });
  });

  it("«Я закончил» выключен настройкой — ничего не делает", () => {
    const run = createRun(research({ settings: { finishButton: false } }));
    expect(run.declare()).toEqual({ kind: "none" });
    expect(run.done()).toBe(false);
  });
});

describe("стоимость прогона", () => {
  it("складывается из принятых действий и фиксаций полей", () => {
    const run = createRun(research(), { now: () => 0 });
    run.commitField("q", "экспорт");   // field: 1
    run.click(55, 5);                  // own cost: 4
    run.click(90, 50);                 // miss — not a cost
    run.key("Ctrl+F");                 // key: 0.5, ends the run
    expect(run.result().cost).toBe(5.5);
  });

  it("результат несёт устройство и версию 2", () => {
    const r = createRun(research()).result();
    expect(r.variant).toBe("desktop");
    expect(r.version).toBe(2);
  });
});

describe("контрольный сценарий", () => {
  it("«Я закончил» у контрольного сценария не работает", () => {
    const run = createRun({ ...research(), kind: "control" });
    expect(run.declare()).toEqual({ kind: "none" });
  });
});
```

- [ ] **Шаг 2.** `npm test -- tests/sim-engine-v2.test.ts` — FAIL (`declare` нет, `version` 1, нет `finale`).

- [ ] **Шаг 3. Изменить `shared/sim/engine.ts`.**

Заголовок модуля: в список правил добавить три пункта.

```ts
 * - entering a scene with an end finishes the run: `success` is judged by the goal checks, `fail`
 *   is a dead end, `finale` closes a research scenario;
 * - an action without a role (research scenarios) counts as an action and nothing more;
 * - every accepted action and field commit adds its cost to the run (`./costs`); traps do not.
```

Импорты — удалить временную строку `import { CONTRACT_V1 as CONTRACT_VERSION } from "./contract-v1";` вместе с её
комментарием (задача 1, шаг 2а), заменить блок импорта из `./contract` и добавить новые:

```ts
import {
  RESULT_FORMAT,
  RESULT_VERSION,
  type ActionBase,
  type Box,
  type CheckResult,
  type Condition,
  type Device,
  type Effect,
  type FieldDef,
  type FieldPlacement,
  type Outcome,
  type Scene,
  type SceneElement,
  type SimEvent,
  type SimResult,
  type Size,
  type Zone,
} from "./contract";
import { boundsOf, contains, type ZoneShape } from "./geometry";
import { actionCost, fieldCost } from "./costs";
import type { ScenarioInput } from "./upgrade";
import { playable, type PlayableScenario } from "./variant";
```

`RunOptions` — добавить устройство:

```ts
export interface RunOptions {
  /** Clock, injectable for tests. */
  now?: () => number;
  /** The variant to play; desktop by default. */
  device?: Device;
}
```

`SimRun` — `readonly scenario: PlayableScenario;` вместо `Scenario`; после `exit(): Reaction;` добавить:

```ts
  /** «Я закончил» of a research scenario; does nothing in a control one or when switched off. */
  declare(): Reaction;
```

`createRun` — сигнатура и первые строки:

```ts
export function createRun(input: ScenarioInput | PlayableScenario, options: RunOptions = {}): SimRun {
  const scenario = playable(input, options.device);
  const now = options.now ?? (() => Date.now());
```

`hintsOn` и `hintAfter` — `scenario.settings.hints` (у вида `settings` есть всегда, `?.` после `settings` убрать).

Состояние прогона — рядом с `counts`:

```ts
  let cost = 0;
```

`finished` — тип с финалом:

```ts
  let finished: { outcome: Outcome; at: number; goal: SimResult["goal"]; finale: NonNullable<SimResult["finale"]> | null } | null = null;
```

`finish` — третий параметр:

```ts
  function finish(outcome: Outcome, goal: SimResult["goal"], finale: NonNullable<SimResult["finale"]> | null = null): void {
    if (finished) return;
    finished = { outcome, at: t(), goal, finale };
    hintOn = null;
  }
```

`judgeGoal` заменить на `judgeEnd`:

```ts
  function judgeEnd(scene: Scene): void {
    const end = scene.end!;
    if (end.outcome === "fail") {
      events.push({ t: t(), type: "goal", scene: scene.id, outcome: "fail" });
      finish("fail", { scene: scene.id, message: end.message, checks: [], share: 0 });
      return;
    }
    if (end.outcome === "finale") {
      events.push({ t: t(), type: "goal", scene: scene.id, outcome: "finale", finale: scene.id });
      finish("finale", null, { scene: scene.id, title: end.title, target: end.target === true });
      return;
    }
    const checks: CheckResult[] = (scenario.goal?.checks ?? []).map((c) => ({
      field: c.field,
      passed: passes(c.check ?? fieldDefs.get(c.field)?.check, values[c.field] ?? ""),
      critical: c.critical !== false,
      weight: c.weight ?? 1,
    }));
    const total = checks.reduce((s, c) => s + c.weight, 0);
    const got = checks.reduce((s, c) => s + (c.passed ? c.weight : 0), 0);
    const outcome: Outcome = checks.every((c) => c.passed)
      ? "success"
      : checks.some((c) => c.critical && !c.passed) ? "fail" : "partial";
    events.push({ t: t(), type: "goal", scene: scene.id, outcome });
    finish(outcome, { scene: scene.id, message: end.message, checks, share: total ? got / total : 1 });
  }
```

В `enter` и в конце `createRun`: `if (next.end) judgeEnd(next);` и `if (current.end) judgeEnd(current);`.

`act` — ветка принятого действия:

```ts
    if (a.role !== "neutral") {
      counts.actions += 1;
      if (a.role === "detour") counts.detours += 1;
      if (a.role === "trap") {
        counts.traps += 1;
        traps.push({ id: a.id, error: a.error ?? a.id, t: t() });
      } else {
        cost += actionCost(a, scenario.settings.costs);
      }
      events.push({
        t: t(), type: "action", scene: current.id, id: a.id,
        ...(a.role ? { role: a.role } : {}),
        ...(a.role === "trap" ? { error: a.error } : {}),
      });
      localErrors = 0;
      hintOn = null;
    }
```

`commitField` — после строки `if (!placement || !def) return { kind: "none" };`:

```ts
      cost += fieldCost(scenario.settings.costs);
```

`run.stage`:

```ts
    stage: () => current.size ?? scenario.settings.stage ?? { w: 1920, h: 1080 },
```

После метода `exit()` — метод `declare`:

```ts
    declare() {
      if (finished || scenario.kind !== "research" || scenario.settings.finishButton === false) return { kind: "none" };
      events.push({ t: t(), type: "declare" });
      finish("declared", null);
      return { kind: "done", outcome: "declared" };
    },
```

`result()`:

```ts
    result() {
      return {
        format: RESULT_FORMAT,
        version: RESULT_VERSION,
        scenario: { title: scenario.meta.title },
        variant: scenario.device,
        startedAt,
        durationMs: finished ? finished.at : t(),
        outcome: finished?.outcome ?? "exited",
        goal: finished?.goal ?? null,
        finale: finished?.finale ?? null,
        counts: { ...counts },
        cost,
        traps: traps.slice(),
        fields: { ...values },
        events: events.slice(),
      };
    },
```

- [ ] **Шаг 4. Поправить ожидание версии в `tests/sim-engine.test.ts:263`:** `expect(r.version).toBe(1)` →
  `expect(r.version).toBe(2)`.

- [ ] **Шаг 5. Прогнать оба набора движка.**

```powershell
npm test -- tests/sim-engine.test.ts tests/sim-engine-v2.test.ts tests/sim-field-stacking.test.ts
```

Ожидается: PASS. Старые наборы идут на сценарии v1 — это и есть проверка, что поведение не изменилось.

- [ ] **Шаг 6. Коммит.**

```powershell
git add shared/sim/engine.ts tests/sim-engine.test.ts tests/sim-engine-v2.test.ts
git commit -m "feat(sim): движок на v2 — финалы, «Я закончил», действия без роли, стоимость прогона"
```

---

### Задача 6. Протокол и переигрывание

**Файлы:** изменить `shared/sim/protocol-codec.ts`, `shared/sim/replay.ts`; создать `tests/sim-replay-v2.test.ts`.

- [ ] **Шаг 1. Падающий тест.**

```ts
/**
 * @module tests/sim-replay-v2
 * @description «Я закончил» survives the LMS protocol and the server replay; a protocol without it
 * is still written as version 1, so packages of control scenarios stay byte-identical.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRun } from "@shared/sim/engine";
import { replayRun } from "@shared/sim/replay";
import { decodeProtocol, encodeProtocol } from "@shared/sim/protocol-codec";
import type { Scenario } from "@shared/sim/contract";

const v1 = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/sim/scenario-v1.json"), "utf8"));

const research: Scenario = {
  format: "skillum.sim-scenario", version: 2, kind: "research",
  meta: { title: "R", task: "T" }, media: [],
  variants: [{ device: "desktop", stage: { w: 10, h: 10 }, start: "a", scenes: [
    { id: "a", title: "A", elements: [], zones: [{ id: "go", x: 0, y: 0, w: 5, h: 5, effects: [{ goto: "b" }] }] },
    { id: "b", title: "B", elements: [], zones: [{ id: "back", x: 0, y: 0, w: 5, h: 5, effects: [{ goto: "a" }] }] },
  ] }],
};

describe("«Я закончил» в протоколе", () => {
  it("кодируется буквой d версии 2 и читается обратно", () => {
    let clock = 0;
    const run = createRun(research, { now: () => clock });
    clock = 100; run.click(1, 1);
    clock = 250; run.declare();
    const r = run.result();
    const encoded = encodeProtocol(r.events, r.durationMs);
    expect(encoded.startsWith("2;")).toBe(true);
    const decoded = decodeProtocol(encoded)!;
    expect(decoded.events.map((e) => e.type)).toEqual(["action", "declare"]);
    expect(replayRun(research, { events: decoded.events }).result.outcome).toBe("declared");
  });

  it("протокол без d пишется версией 1, как раньше", () => {
    const run = createRun(v1, { now: () => 0 });
    run.exit();
    expect(encodeProtocol(run.result().events, 0).startsWith("1;")).toBe(true);
  });

  it("буква d в протоколе версии 1 — повреждение", () => {
    expect(decodeProtocol("1;d@0")).toBeNull();
  });
});

describe("переигрывание", () => {
  it("исход declared переигрывается и сходится с присланным", () => {
    const run = createRun(research, { now: () => 0 });
    run.declare();
    const verdict = replayRun(research, run.result());
    expect(verdict.consistent).toBe(true);
    expect(verdict.result.outcome).toBe("declared");
  });
});
```

- [ ] **Шаг 2.** `npm test -- tests/sim-replay-v2.test.ts` — FAIL.

- [ ] **Шаг 3. Изменить `shared/sim/protocol-codec.ts`.**

В JSDoc модуля список событий дополнить пунктом о букве `d` («Я закончил», только версия 2) и абзацем:

```ts
 * Versions. Version 2 adds `d`. A protocol without it is still written as version 1, so packages
 * of control scenarios stay byte-identical with those built before version 2; the decoder reads
 * both.
```

Константы и тип входа:

```ts
/** Newest format version, the first field of the encoded string. */
export const PROTOCOL_CODEC_VERSION = 2;
/** The version written when nothing of version 2 is in the protocol. */
const PLAIN_VERSION = 1;
```

```ts
export type ProtocolInput = Extract<SimEvent, { type: "action" | "blocked" | "miss" | "value" | "declare" | "exit" | "timeout" }>;
```

`encodeProtocol` — перед циклом `let newer = false;`, в `switch` новая ветка и итоговая строка:

```ts
      case "declare": body = "d"; newer = true; break;
```

```ts
  return `${newer ? PROTOCOL_CODEC_VERSION : PLAIN_VERSION};${parts.join(";")}`;
```

`decodeProtocol` — проверка версии и ветка `d`:

```ts
  if (version !== String(PLAIN_VERSION) && version !== String(PROTOCOL_CODEC_VERSION)) return null;
```

```ts
      case "d":
        if (body || version === String(PLAIN_VERSION)) return null;
        out.push({ t, type: "declare" });
        break;
```

Проверить, не завязан ли тест на значение константы: `Select-String -Path tests\*.ts -Pattern PROTOCOL_CODEC_VERSION`.
Если тест строит ожидаемую строку как `${PROTOCOL_CODEC_VERSION};…` для протокола без `d`, заменить в нём на `1;…`.

Версия 2 становится читаемой, поэтому один старый тест меняется — `tests/sim-lms-protocol.test.ts`, строка 90 (тест
«испорченная строка и чужая версия не читаются»). Он проверял, что чужая версия `2;` не читается. Чужой версией
становится явно несуществующая `9;`; больше в файле ничего не менять:

```ts
    expect(decodeProtocol("9;a1@0")).toBeNull();
```

Отступ — как у соседних строк 91–93. Приёмка разрешает в этом файле только эту строку.

- [ ] **Шаг 4. Изменить `shared/sim/replay.ts`.**

Импорты:

```ts
import { createRun } from "./engine";
import type { SimEvent, SimResult } from "./contract";
import type { ScenarioInput } from "./upgrade";
import type { PlayableScenario } from "./variant";
```

Сигнатура и начало `replayRun`:

```ts
export function replayRun(scenario: ScenarioInput | PlayableScenario, posted: unknown, observe?: ReplayObserver): ReplayVerdict {
  let clock = 0;
  const claimed = posted as Partial<SimResult> | null;
  // The posted device decides which variant is replayed; a result of version 1 is desktop.
  const device = claimed?.variant === "phone" ? "phone" : "desktop";
  const run = createRun(scenario, { now: () => clock, device });
```

Строку `const claimed = …` ниже удалить (она переехала выше). В `switch` после `case "exit"`:

```ts
      case "declare":
        run.declare();
        break;
```

В JSDoc модуля фразу про входные события дополнить: «…committed values, «Я закончил», exit and timeout».

- [ ] **Шаг 5. Прогнать.**

```powershell
npm test -- tests/sim-replay-v2.test.ts tests/sim-replay-scoring.test.ts tests/sim-lms-protocol.test.ts
```

Ожидается: PASS.

- [ ] **Шаг 6. Коммит.**

```powershell
git add shared/sim/protocol-codec.ts shared/sim/replay.ts tests/sim-replay-v2.test.ts tests
git commit -m "feat(sim): «Я закончил» в протоколе LMS и в переигрывании, вариант устройства при переигрывании"
```

---

### Задача 7. Самый дешёвый путь: `optimum.ts`

**Файлы:** создать `shared/sim/optimum.ts`, `tests/sim-optimum.test.ts`.

- [ ] **Шаг 1. Падающий тест.**

```ts
/**
 * @module tests/sim-optimum
 * @description The cheapest way through a scenario (v2-design.md section 2.2): Dijkstra over run
 * states, so conditions are honoured; traps never taken; a field typed by one action; a limit that
 * says «unknown» instead of guessing; route keys passed in order.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cheapestPath } from "@shared/sim/optimum";
import { playable } from "@shared/sim/variant";
import type { Scenario, Scene } from "@shared/sim/contract";

const v1 = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/sim/scenario-v1.json"), "utf8"));

function graph(scenes: Scene[], extra: Partial<Scenario> = {}): Scenario {
  return {
    format: "skillum.sim-scenario", version: 2, kind: "control",
    meta: { title: "G", task: "T" }, media: [],
    fields: [{ id: "f", fill: "keyboard" }],
    goal: { checks: [] },
    variants: [{ device: "desktop", stage: { w: 100, h: 100 }, start: scenes[0].id, scenes }],
    ...extra,
  };
}
const z = (id: string, effects: unknown[], more: Record<string, unknown> = {}) =>
  ({ id, role: "path", x: 0, y: 0, w: 1, h: 1, effects, ...more }) as never;

describe("оптимум", () => {
  it("эталонный сценарий: путь найден, его стоимость конечна", () => {
    const found = cheapestPath(playable(v1));
    expect(found.status).toBe("found");
    if (found.status === "found") {
      expect(found.cost).toBeGreaterThan(0);
      expect(found.scenes[0]).toBe(playable(v1).start);
    }
  });

  it("выбирает дешёвый путь из двух", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], zones: [z("long", [{ goto: "b" }]), z("short", [{ goto: "goal" }], { role: "alt", cost: 1.5 })] },
      { id: "b", title: "B", elements: [], zones: [z("b-go", [{ goto: "goal" }])] },
      { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
    ]);
    const found = cheapestPath(playable(s));
    expect(found).toMatchObject({ status: "found", cost: 1.5, steps: [{ scene: "a", action: "short" }] });
  });

  it("условие зоны учитывается: сначала заполнить поле", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], fields: [{ field: "f", x: 0, y: 0, w: 1, h: 1, editable: true }],
        zones: [z("save", [{ goto: "goal" }], { when: { filled: ["f"] }, otherwise: [] })] },
      { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
    ]);
    expect(cheapestPath(playable(s))).toMatchObject({ status: "found", cost: 2, steps: [{ scene: "a", action: "field:f" }, { scene: "a", action: "save" }] });
  });

  it("ловушки не берутся, шаги в сторону можно исключить", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], zones: [
        z("trap", [{ goto: "goal" }], { role: "trap", error: "E", cost: 0 }),
        z("side", [{ goto: "goal" }], { role: "detour" }),
        z("main", [{ goto: "b" }]),
      ] },
      { id: "b", title: "B", elements: [], zones: [z("b-go", [{ goto: "goal" }])] },
      { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
    ]);
    expect(cheapestPath(playable(s))).toMatchObject({ status: "found", cost: 1 });
    expect(cheapestPath(playable(s), { detours: false })).toMatchObject({ status: "found", cost: 2 });
  });

  it("цель с непрошедшей проверкой — не цель", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], zones: [z("go", [{ set: "g", value: "нет" }, { goto: "goal" }])] },
      { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
    ], { fields: [{ id: "g", fill: "effect", check: { rules: [{ kind: "equals", value: "да" }] } as never }], goal: { checks: [{ field: "g" }] } });
    expect(cheapestPath(playable(s)).status).toBe("none");
  });

  it("ключевые действия маршрута проходятся по порядку", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], zones: [z("short", [{ goto: "goal" }]), z("via", [{ goto: "b" }])] },
      { id: "b", title: "B", elements: [], zones: [z("b-go", [{ goto: "goal" }])] },
      { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
    ]);
    expect(cheapestPath(playable(s), { keys: [{ scene: "a", action: "via" }] })).toMatchObject({ status: "found", cost: 2 });
  });

  it("предел состояний — «неизвестно», а не догадка", () => {
    expect(cheapestPath(playable(v1), { maxStates: 2 }).status).toBe("limit");
  });

  it("исследовательский сценарий ищет путь до целевого финала", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], zones: [z("x", [{ goto: "other" }]), z("y", [{ goto: "b" }])] },
      { id: "b", title: "B", elements: [], zones: [z("b-go", [{ goto: "found" }])] },
      { id: "other", title: "Не то", elements: [], end: { outcome: "finale", title: "Сдался" } },
      { id: "found", title: "Нашёл", elements: [], end: { outcome: "finale", title: "Нашёл", target: true } },
    ], { kind: "research", goal: undefined });
    expect(cheapestPath(playable(s))).toMatchObject({ status: "found", cost: 2, scenes: ["a", "b", "found"] });
  });
});
```

Если форма правила `AnswerRuleSet` для «равно» отличается от `{ rules: [{ kind: "equals", value }] }`, взять
действующую форму из `shared/answer-check/rules.ts` (тест проверяет только, что значение `нет` не проходит).

- [ ] **Шаг 2.** `npm test -- tests/sim-optimum.test.ts` — FAIL.

- [ ] **Шаг 3. Записать `shared/sim/optimum.ts`.**

```ts
/**
 * @module shared/sim/optimum
 *
 * The cheapest way through a scenario (`docs/specs/sim-scenario/v2-design.md`, section 2.2): the
 * optimum `C*` efficiency is measured against, and the cost of a declared route.
 *
 * The search is Dijkstra over run STATES, not scenes: a state is the scene, the visibility of
 * elements, the values of fields and how many route keys are passed. So conditions of zones
 * («Сохранить» opens only with filled fields) are honoured. Assumptions:
 * - a keyboard field is filled correctly by one action, its commit cost;
 * - a field filled by effects gets only the values effects write;
 * - traps are never taken; detours are, unless excluded;
 * - misses and refusals are errors, never moves of a cheapest path.
 *
 * The target is a `success` end with every goal check passed (control) or a target finale
 * (research). The search stops after {@link MAX_STATES} expanded states and says so: the optimum
 * is then unknown, not guessed.
 *
 * Pure and framework-free.
 */
import { checkRuleSet, type AnswerRuleSet } from "@shared/answer-check";
import type { Condition, Effect, KeyBinding, RouteKey, Scene, Zone } from "./contract";
import { actionCost, fieldCost } from "./costs";
import type { PlayableScenario } from "./variant";

/** Most states a search expands before giving up. */
export const MAX_STATES = 100_000;

/** Prefix of a step that commits a field: `field:<id>`. */
export const FIELD_STEP = "field:";

/** The value of a keyboard field the search «typed»: correct by assumption. */
const TYPED = "\u0000typed";

/** One move of a path: an action of a scene, or `field:<id>` — committing that field. */
export interface PathStep {
  scene: string;
  action: string;
}

/** What a search found. */
export type PathSearch =
  | { status: "found"; cost: number; steps: PathStep[]; scenes: string[] }
  | { status: "none" }
  | { status: "limit" };

/** Options of {@link cheapestPath}. */
export interface PathOptions {
  /** Key actions to pass in order — a declared route. */
  keys?: RouteKey[];
  /** Allow detour actions; default `true`. */
  detours?: boolean;
  /** Most states to expand; default {@link MAX_STATES}. */
  maxStates?: number;
}

interface State {
  scene: string;
  key: number;
  visible: Map<string, boolean>;
  values: Map<string, string>;
}

type Verdict = "target" | "dead" | null;

/** A binary min-heap; equal costs leave in insertion order, so results are deterministic. */
class Heap<T> {
  private items: { cost: number; seq: number; value: T }[] = [];
  private seq = 0;

  get size(): number {
    return this.items.length;
  }

  push(cost: number, value: T): void {
    const items = this.items;
    items.push({ cost, seq: this.seq++, value });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      [items[i], items[parent]] = [items[parent], items[i]];
      i = parent;
    }
  }

  pop(): { cost: number; value: T } | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && this.less(l, m)) m = l;
        if (r < items.length && this.less(r, m)) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m], items[i]];
        i = m;
      }
    }
    return { cost: top.cost, value: top.value };
  }

  private less(a: number, b: number): boolean {
    const x = this.items[a];
    const y = this.items[b];
    return x.cost < y.cost || (x.cost === y.cost && x.seq < y.seq);
  }
}

const sorted = (m: Map<string, unknown>) => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

function keyOf(s: State): string {
  const vis = sorted(s.visible).map(([k, v]) => `${k}=${v ? 1 : 0}`).join(",");
  const val = sorted(s.values).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join(",");
  return `${s.scene}|${s.key}|${vis}|${val}`;
}

const clone = (s: State): State => ({ scene: s.scene, key: s.key, visible: new Map(s.visible), values: new Map(s.values) });

function passes(check: AnswerRuleSet | undefined, value: string): boolean {
  if (value === TYPED) return true;
  if (!check) return value.trim() !== "";
  return checkRuleSet(check, value).passed;
}

/**
 * The cheapest path from the start to the target.
 *
 * @param play The scenario as one device plays it.
 * @param options Route keys, detours, the state limit.
 */
export function cheapestPath(play: PlayableScenario, options: PathOptions = {}): PathSearch {
  const scenes = new Map(play.scenes.map((s) => [s.id, s]));
  const defs = new Map(play.fields.map((f) => [f.id, f]));
  const keys = options.keys ?? [];
  const detours = options.detours !== false;
  const limit = options.maxStates ?? MAX_STATES;

  const isVisible = (s: State, id: string): boolean => {
    const own = s.visible.get(id);
    if (own !== undefined) return own;
    return !(scenes.get(s.scene)?.elements.find((e) => e.id === id)?.hidden ?? false);
  };

  const holds = (c: Condition, s: State): boolean => {
    if ("filled" in c) return c.filled.every((f) => (s.values.get(f) ?? "").trim() !== "");
    if ("field" in c) return passes(c.check, s.values.get(c.field) ?? "");
    if ("visible" in c) return isVisible(s, c.visible);
    if ("all" in c) return c.all.every((x) => holds(x, s));
    if ("any" in c) return c.any.some((x) => holds(x, s));
    return !holds(c.not, s);
  };

  const verdictOf = (scene: Scene, s: State): Verdict => {
    const end = scene.end;
    if (!end) return null;
    if (s.key < keys.length) return "dead";
    if (end.outcome === "success") {
      if (play.kind !== "control") return "dead";
      const ok = (play.goal?.checks ?? []).every((c) =>
        passes(c.check ?? defs.get(c.field)?.check, s.values.get(c.field) ?? ""));
      return ok ? "target" : "dead";
    }
    if (end.outcome === "finale") return play.kind === "research" && end.target === true ? "target" : "dead";
    return "dead";
  };

  /** Apply effects like the engine does; answers the verdict of the scene entered last. */
  const apply = (effects: Effect[] | undefined, s: State): Verdict => {
    let verdict: Verdict = null;
    for (const e of effects ?? []) {
      if (verdict) break;
      if ("goto" in e) {
        s.scene = e.goto;
        const scene = scenes.get(e.goto);
        verdict = scene ? verdictOf(scene, s) : "dead";
      } else if ("show" in e) s.visible.set(e.show, true);
      else if ("hide" in e) s.visible.set(e.hide, false);
      else if ("toggle" in e) s.visible.set(e.toggle, !isVisible(s, e.toggle));
      else if ("set" in e) s.values.set(e.set, e.value);
      else if ("clear" in e) s.values.delete(e.clear);
    }
    return verdict;
  };

  const initial: State = {
    scene: play.start,
    key: 0,
    visible: new Map(),
    values: new Map(play.fields.filter((f) => f.initial).map((f) => [f.id, f.initial as string])),
  };
  const startScene = scenes.get(play.start);
  if (!startScene) return { status: "none" };
  const startVerdict = verdictOf(startScene, initial);
  if (startVerdict === "target") return { status: "found", cost: 0, steps: [], scenes: [play.start] };
  if (startVerdict === "dead") return { status: "none" };

  const best = new Map<string, number>();
  const parent = new Map<string, { prev: string; step: PathStep; scene: string } | null>();
  const targets = new Set<string>();
  const heap = new Heap<{ key: string; state: State }>();
  const startKey = keyOf(initial);
  best.set(startKey, 0);
  parent.set(startKey, null);
  heap.push(0, { key: startKey, state: initial });
  let expanded = 0;

  const relax = (from: string, cost: number, step: PathStep, next: State, verdict: Verdict): void => {
    if (verdict === "dead") return;
    const key = verdict === "target" ? `target|${keyOf(next)}` : keyOf(next);
    const known = best.get(key);
    if (known !== undefined && known <= cost) return;
    best.set(key, cost);
    parent.set(key, { prev: from, step, scene: next.scene });
    if (verdict === "target") targets.add(key);
    heap.push(cost, { key, state: next });
  };

  while (heap.size > 0) {
    const { cost, value } = heap.pop()!;
    if (cost > (best.get(value.key) ?? Infinity)) continue;
    if (targets.has(value.key)) return { status: "found", cost, ...trace(value.key, parent, play.start) };
    if (++expanded > limit) return { status: "limit" };
    const state = value.state;
    const scene = scenes.get(state.scene);
    if (!scene) continue;

    const actions: Array<Zone | KeyBinding> = [...(scene.zones ?? []), ...(scene.keys ?? [])];
    for (const a of actions) {
      if (a.role === "neutral" || a.role === "trap") continue;
      if (!detours && a.role === "detour") continue;
      if (a.when && !holds(a.when, state)) continue;
      const next = clone(state);
      const nextKey = keys[state.key];
      if (nextKey && nextKey.scene === state.scene && nextKey.action === a.id) next.key += 1;
      const verdict = apply(a.effects, next);
      relax(value.key, cost + actionCost(a, play.settings.costs), { scene: state.scene, action: a.id }, next, verdict);
    }
    for (const p of scene.fields ?? []) {
      const def = defs.get(p.field);
      if (!p.editable || def?.fill !== "keyboard" || state.values.get(p.field) === TYPED) continue;
      const next = clone(state);
      next.values.set(p.field, TYPED);
      relax(value.key, cost + fieldCost(play.settings.costs), { scene: state.scene, action: `${FIELD_STEP}${p.field}` }, next, null);
    }
  }
  return { status: "none" };
}

/** Steps and visited scenes from the start to a target, read back through the parent links. */
function trace(
  key: string,
  parent: Map<string, { prev: string; step: PathStep; scene: string } | null>,
  start: string,
): { steps: PathStep[]; scenes: string[] } {
  const steps: PathStep[] = [];
  const entered: string[] = [];
  let at: string | undefined = key;
  while (at !== undefined) {
    const link = parent.get(at);
    if (!link) break;
    steps.push(link.step);
    entered.push(link.scene);
    at = link.prev;
  }
  steps.reverse();
  entered.reverse();
  const scenes = [start];
  for (const s of entered) if (scenes[scenes.length - 1] !== s) scenes.push(s);
  return { steps, scenes };
}
```

- [ ] **Шаг 4.** `npm test -- tests/sim-optimum.test.ts` — PASS. Если тест «эталонный сценарий» упал на `limit`,
  это не повод поднимать предел: выписать число состояний и показать владельцу.

- [ ] **Шаг 4а. Тесты случаев спецификации 2.2–2.3** (дописано 2026-10-16 по ревью W1-optimum, подтверждено
  координатором). Восемь тестов выше не проверяют порядок двух ключей маршрута, сочетание клавиш как ключ, условия
  `visible`, `field`, `not`, `any`, `all` и эффекты `show`, `hide`, `toggle`, проверку цели по полю с клавиатуры, концы
  чужого вида, границу предела и выбор при равной цене. Импорт модуля в начале `tests/sim-optimum.test.ts` заменить
  на `import { cheapestPath, MAX_STATES } from "@shared/sim/optimum";`, а в конец файла дописать блок ниже. Прежние
  тесты не трогать. Итог — 20 тестов и 37 вызовов `expect(`: приёмка не пропустит меньше.

```ts
/** A text rule set the engine really evaluates: the value must be exactly `value`. */
const equals = (value: string) =>
  ({ answerKind: "text", join: "any", rules: [{ kind: "text", match: "wildcard", value }] }) as never;
const goalScene = (): Scene => ({ id: "goal", title: "Цель", elements: [], end: { outcome: "success" } });

describe("оптимум: случаи спецификации 2.2–2.3", () => {
  it("два ключа маршрута: по порядку и с лишним действием между ними", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], zones: [z("k1", [{ goto: "b" }]), z("direct", [{ goto: "goal" }])] },
      { id: "b", title: "B", elements: [], zones: [z("mid", [{ goto: "c" }])] },
      { id: "c", title: "C", elements: [], zones: [z("k2", [{ goto: "goal" }])] },
      goalScene(),
    ]);
    const play = playable(s);
    expect(cheapestPath(play)).toMatchObject({ status: "found", cost: 1, steps: [{ scene: "a", action: "direct" }] });
    expect(cheapestPath(play, { keys: [{ scene: "a", action: "k1" }, { scene: "c", action: "k2" }] })).toMatchObject({
      status: "found",
      cost: 3,
      steps: [{ scene: "a", action: "k1" }, { scene: "b", action: "mid" }, { scene: "c", action: "k2" }],
      scenes: ["a", "b", "c", "goal"],
    });
    expect(cheapestPath(play, { keys: [{ scene: "c", action: "k2" }, { scene: "a", action: "k1" }] }).status).toBe("none");
  });

  it("сочетание клавиш — действие пути и ключ маршрута, стоимость по виду key", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], zones: [z("btn", [{ goto: "goal" }])],
        keys: [{ id: "save", keys: "Ctrl+S", role: "path", effects: [{ goto: "goal" }] }] },
      goalScene(),
    ]);
    expect(cheapestPath(playable(s))).toMatchObject({ status: "found", cost: 0.5, steps: [{ scene: "a", action: "save" }] });
    expect(cheapestPath(playable(s), { keys: [{ scene: "a", action: "btn" }] })).toMatchObject({ status: "found", cost: 1 });
    expect(cheapestPath(playable(s), { keys: [{ scene: "a", action: "save" }] })).toMatchObject({ status: "found", cost: 0.5 });
    const dear = graph(s.variants[0].scenes, { settings: { costs: { key: 2 } } });
    expect(cheapestPath(playable(dear))).toMatchObject({ status: "found", cost: 1, steps: [{ scene: "a", action: "btn" }] });
  });

  it("toggle и visible: пункт меню доступен только после того, как меню открыто", () => {
    const s = graph([
      { id: "a", title: "A", elements: [{ id: "menu", media: "m", x: 0, y: 0, hidden: true }],
        zones: [z("open", [{ toggle: "menu" }]), z("item", [{ goto: "goal" }], { when: { visible: "menu" }, otherwise: [] })] },
      goalScene(),
    ]);
    expect(cheapestPath(playable(s))).toMatchObject({
      status: "found", cost: 2, steps: [{ scene: "a", action: "open" }, { scene: "a", action: "item" }],
    });
  });

  it("hide и not: переход открывается, когда баннер скрыт", () => {
    const s = graph([
      { id: "a", title: "A", elements: [{ id: "banner", media: "m", x: 0, y: 0 }],
        zones: [z("close", [{ hide: "banner" }]), z("go", [{ goto: "goal" }], { when: { not: { visible: "banner" } }, otherwise: [] })] },
      goalScene(),
    ]);
    expect(cheapestPath(playable(s))).toMatchObject({
      status: "found", cost: 2, steps: [{ scene: "a", action: "close" }, { scene: "a", action: "go" }],
    });
  });

  it("show и all: нужны и открытый диалог, и заполненное поле", () => {
    const s = graph([
      { id: "a", title: "A", elements: [{ id: "dlg", media: "m", x: 0, y: 0, hidden: true }],
        fields: [{ field: "f", x: 0, y: 0, w: 1, h: 1, editable: true }],
        zones: [z("show", [{ show: "dlg" }]), z("ok", [{ goto: "goal" }], { when: { all: [{ visible: "dlg" }, { filled: ["f"] }] }, otherwise: [] })] },
      goalScene(),
    ]);
    expect(cheapestPath(playable(s))).toMatchObject({
      status: "found", cost: 3,
      steps: [{ scene: "a", action: "show" }, { scene: "a", action: "field:f" }, { scene: "a", action: "ok" }],
    });
  });

  it("any: хватает одной ветки условия, если другую не выполнить", () => {
    const s = graph([
      { id: "a", title: "A", elements: [{ id: "x", media: "m", x: 0, y: 0, hidden: true }],
        fields: [{ field: "f", x: 0, y: 0, w: 1, h: 1, editable: true }],
        zones: [z("go", [{ goto: "goal" }], { when: { any: [{ visible: "x" }, { filled: ["f"] }] }, otherwise: [] })] },
      goalScene(),
    ]);
    expect(cheapestPath(playable(s))).toMatchObject({
      status: "found", cost: 2, steps: [{ scene: "a", action: "field:f" }, { scene: "a", action: "go" }],
    });
  });

  it("условие field с проверкой: дешёвое неверное значение путь не открывает", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], zones: [
        z("bad", [{ set: "code", value: "нет" }]),
        z("good", [{ set: "code", value: "да" }], { cost: 3 }),
        z("go", [{ goto: "goal" }], { when: { field: "code", check: equals("да") }, otherwise: [] }),
      ] },
      goalScene(),
    ], { fields: [{ id: "code", fill: "effect" }] });
    expect(cheapestPath(playable(s))).toMatchObject({
      status: "found", cost: 4, steps: [{ scene: "a", action: "good" }, { scene: "a", action: "go" }],
    });
  });

  it("проверка цели по полю с клавиатуры: фиксация поля плюс переход", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], fields: [{ field: "num", x: 0, y: 0, w: 1, h: 1, editable: true }],
        zones: [z("submit", [{ goto: "goal" }])] },
      goalScene(),
    ], { fields: [{ id: "num", fill: "keyboard", check: equals("42") }], goal: { checks: [{ field: "num" }] } });
    expect(cheapestPath(playable(s))).toMatchObject({
      status: "found", cost: 2, steps: [{ scene: "a", action: "field:num" }, { scene: "a", action: "submit" }],
    });
  });

  it("проверка цели по полю, заполняемому эффектом: годится только верное значение", () => {
    const scenes = (value: string): Scene[] => [
      { id: "a", title: "A", elements: [], zones: [z("go", [{ set: "g", value }, { goto: "goal" }])] },
      goalScene(),
    ];
    const extra = { fields: [{ id: "g", fill: "effect" as const, check: equals("да") }], goal: { checks: [{ field: "g" }] } };
    expect(cheapestPath(playable(graph(scenes("нет"), extra))).status).toBe("none");
    expect(cheapestPath(playable(graph(scenes("да"), extra)))).toMatchObject({ status: "found", cost: 1 });
  });

  it("концы: success в исследовательском и финал в контрольном — не цель; пустые проверки — цель", () => {
    const research = graph([
      { id: "a", title: "A", elements: [], zones: [z("go", [{ goto: "goal" }])] },
      goalScene(),
    ], { kind: "research", goal: undefined });
    expect(cheapestPath(playable(research)).status).toBe("none");

    const control = graph([
      { id: "a", title: "A", elements: [], zones: [z("fin", [{ goto: "f" }]), z("go", [{ goto: "b" }])] },
      { id: "b", title: "B", elements: [], zones: [z("b-go", [{ goto: "goal" }])] },
      { id: "f", title: "Финал", elements: [], end: { outcome: "finale", title: "Финал", target: true } },
      goalScene(),
    ]);
    expect(cheapestPath(playable(control))).toMatchObject({ status: "found", cost: 2, scenes: ["a", "b", "goal"] });

    const direct = [{ id: "a", title: "A", elements: [], zones: [z("go", [{ goto: "goal" }])] }, goalScene()];
    expect(cheapestPath(playable(graph(direct, { goal: { checks: [] } })))).toMatchObject({ status: "found", cost: 1 });
    expect(cheapestPath(playable(graph(direct, { goal: undefined })))).toMatchObject({ status: "found", cost: 1 });
  });

  it("предел: maxStates — число раскрытых состояний, граница включительно; умолчание 100 000", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], zones: [z("ab", [{ goto: "b" }])] },
      { id: "b", title: "B", elements: [], zones: [z("bc", [{ goto: "c" }])] },
      { id: "c", title: "C", elements: [], zones: [z("cg", [{ goto: "goal" }])] },
      goalScene(),
    ]);
    // Three states are expanded (a, b, c); the target is taken off the heap without expanding it.
    expect(cheapestPath(playable(s), { maxStates: 3 })).toMatchObject({ status: "found", cost: 3 });
    expect(cheapestPath(playable(s), { maxStates: 2 }).status).toBe("limit");
    expect(MAX_STATES).toBe(100_000);
    expect(cheapestPath(playable(s))).toMatchObject({ status: "found", cost: 3 });
  });

  it("равная цена: путь всегда один и тот же — через первую по порядку зону", () => {
    const scenes = (first: string, second: string): Scene[] => [
      { id: "a", title: "A", elements: [], zones: [z(first, [{ goto: first === "p1" ? "b" : "c" }]), z(second, [{ goto: second === "p1" ? "b" : "c" }])] },
      { id: "b", title: "B", elements: [], zones: [z("b-go", [{ goto: "goal" }])] },
      { id: "c", title: "C", elements: [], zones: [z("c-go", [{ goto: "goal" }])] },
      goalScene(),
    ];
    const once = cheapestPath(playable(graph(scenes("p1", "p2"))));
    const again = cheapestPath(playable(graph(scenes("p1", "p2"))));
    expect(once).toMatchObject({ status: "found", cost: 2, steps: [{ scene: "a", action: "p1" }, { scene: "b", action: "b-go" }] });
    expect(again).toEqual(once);
    expect(cheapestPath(playable(graph(scenes("p2", "p1"))))).toMatchObject({
      status: "found", cost: 2, steps: [{ scene: "a", action: "p2" }, { scene: "c", action: "c-go" }],
    });
  });
});
```

Проверено на коде задачи 7 (коммит `b3764f87`): 20 из 20 PASS. Блок ловит пять мутаций кода: видимость элементов
выпала из ключа состояния, предел через `>=` вместо `>`, условие `field` без проверки значения, ключи маршрута не по
порядку, финал засчитан целью контрольного сценария.

`npm test -- tests/sim-optimum.test.ts` — PASS, 20 тестов.

- [ ] **Шаг 5. Коммит.**

```powershell
git add shared/sim/optimum.ts tests/sim-optimum.test.ts
git commit -m "feat(sim): самый дешёвый путь по состояниям прогона — оптимум и стоимость маршрута"
```

---

### Задача 8. Маршруты: `routes.ts`

**Файлы:** создать `shared/sim/routes.ts`, `tests/sim-routes.test.ts`.

- [ ] **Шаг 1. Падающий тест.**

```ts
/**
 * @module tests/sim-routes
 * @description Declared routes (v2-design.md section 2.3): a run follows a route when it contains
 * the keys in order; the best rating wins, then the cheaper route; route checks name what is wrong.
 */
import { describe, it, expect } from "vitest";
import { createRun } from "@shared/sim/engine";
import { followsRoute, recognizeRoute, routeProblems, actedSteps } from "@shared/sim/routes";
import { playable } from "@shared/sim/variant";
import type { Route, Scenario } from "@shared/sim/contract";

const z = (id: string, x: number, effects: unknown[], role = "path") => ({ id, role, x, y: 0, w: 5, h: 5, effects }) as never;

function scenario(routes: Route[]): Scenario {
  return {
    format: "skillum.sim-scenario", version: 2, kind: "control",
    meta: { title: "R", task: "T" }, media: [], goal: { checks: [] },
    variants: [{ device: "desktop", stage: { w: 100, h: 10 }, start: "a", routes, scenes: [
      { id: "a", title: "A", elements: [], zones: [z("menu", 0, [{ goto: "m" }]), z("plus", 10, [{ goto: "card" }], "alt")] },
      { id: "m", title: "Меню", elements: [], zones: [z("new", 0, [{ goto: "card" }])] },
      { id: "card", title: "Карточка", elements: [], zones: [z("save", 0, [{ goto: "goal" }])] },
      { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
    ] }],
  };
}

const viaMenu: Route = { id: "menu", title: "Через меню", rating: 0.8, keys: [{ scene: "a", action: "menu" }, { scene: "m", action: "new" }] };
const viaPlus: Route = { id: "plus", title: "Кнопка «+»", rating: 1, keys: [{ scene: "a", action: "plus" }] };

describe("распознавание маршрута", () => {
  it("ключи по порядку, лишние действия между ними не мешают", () => {
    const steps = [{ scene: "a", action: "menu" }, { scene: "m", action: "x" }, { scene: "m", action: "new" }];
    expect(followsRoute(steps, viaMenu)).toBe(true);
    expect(followsRoute([steps[2], steps[0]], viaMenu)).toBe(false);
  });

  it("прогон через «+» распознаётся как маршрут «+»", () => {
    const s = scenario([viaMenu, viaPlus]);
    const run = createRun(s, { now: () => 0 });
    run.click(12, 2);
    run.click(2, 2);
    expect(actedSteps(run.result()).map((x) => x.action)).toEqual(["plus", "save"]);
    const costs = new Map([["menu", 3], ["plus", 2]]);
    expect(recognizeRoute(playable(s), run.result(), costs)?.route.id).toBe("plus");
  });

  it("при равной оценке выигрывает более дешёвый маршрут", () => {
    const a: Route = { ...viaMenu, id: "a", rating: 1, keys: [{ scene: "card", action: "save" }] };
    const b: Route = { ...viaPlus, id: "b", rating: 1, keys: [{ scene: "a", action: "plus" }] };
    const s = scenario([a]);
    const run = createRun(s, { now: () => 0 });
    run.click(12, 2); run.click(2, 2);
    expect(recognizeRoute({ ...playable(s), routes: [b, a] }, run.result(), new Map([["a", 2], ["b", 5]]))?.route.id).toBe("a");
  });
});

describe("проверки маршрутов", () => {
  it("правильные маршруты — без ошибок; нет оценки 1 — предупреждение", () => {
    expect(routeProblems(playable(scenario([viaMenu, viaPlus])))).toEqual({ errors: [], warnings: [] });
    expect(routeProblems(playable(scenario([viaMenu]))).warnings).toEqual(["Ни у одного маршрута нет оценки 1: максимум балла меньше 100%"]);
  });

  it("ссылка в никуда, негодная оценка, одинаковые ключи, недостижимая цель", () => {
    const broken: Route[] = [
      { id: "r1", title: "Р1", rating: 1, keys: [{ scene: "a", action: "ghost" }] },
      { id: "r2", title: "Р2", rating: 1.5, keys: [{ scene: "a", action: "plus" }] },
      { id: "r3", title: "Р3", rating: 1, keys: [{ scene: "a", action: "plus" }] },
      { id: "r4", title: "Р4", rating: 1, keys: [{ scene: "card", action: "save" }, { scene: "a", action: "menu" }] },
    ];
    const { errors } = routeProblems(playable(scenario(broken)));
    expect(errors).toContain("Маршрут «Р1»: на сцене «A» нет действия ghost");
    expect(errors).toContain("Маршрут «Р2»: оценка должна быть больше 0 и не больше 1");
    expect(errors).toContain("Маршруты «Р2» и «Р3»: одинаковые ключевые действия");
    expect(errors).toContain("Маршрут «Р4»: до цели нельзя дойти через его ключевые действия по порядку");
  });
});
```

- [ ] **Шаг 2.** `npm test -- tests/sim-routes.test.ts` — FAIL.

- [ ] **Шаг 3. Записать `shared/sim/routes.ts`.**

```ts
/**
 * @module shared/sim/routes
 *
 * Declared routes of a variant (`docs/specs/sim-scenario/v2-design.md`, section 2.3): which route a
 * run took, and what is wrong with the routes an author declared.
 *
 * A run follows a route when its accepted actions contain the route's key actions in order; other
 * actions between the keys do not break it. Of the routes a run follows, the best rating wins,
 * then the cheaper route, then the earlier one.
 *
 * Pure and framework-free.
 */
import type { Route, SimEvent, SimResult } from "./contract";
import { cheapestPath } from "./optimum";
import type { PlayableScenario } from "./variant";

/** An accepted action of a run: the action `action` of scene `scene`. */
export interface ActedStep {
  scene: string;
  action: string;
}

/** A route a run was recognized as, with the route's cost (`null` — unknown). */
export interface RecognizedRoute {
  route: Route;
  cost: number | null;
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Accepted actions of a run, in order. */
export function actedSteps(result: Pick<SimResult, "events">): ActedStep[] {
  return result.events
    .filter((e): e is Extract<SimEvent, { type: "action" }> => e.type === "action")
    .map((e) => ({ scene: e.scene, action: e.id }));
}

/** Does a run, given by its accepted actions, follow the route? */
export function followsRoute(steps: readonly ActedStep[], route: Route): boolean {
  let i = 0;
  for (const step of steps) {
    const key = route.keys[i];
    if (!key) break;
    if (key.scene === step.scene && key.action === step.action) i += 1;
  }
  return route.keys.length > 0 && i === route.keys.length;
}

/**
 * The route a run took.
 *
 * @param play The scenario as the run's device plays it.
 * @param result The run.
 * @param costs Cost of each route by id; a route of unknown cost loses ties.
 * @returns The route, or `null` when the run follows none.
 */
export function recognizeRoute(
  play: PlayableScenario,
  result: Pick<SimResult, "events">,
  costs: ReadonlyMap<string, number | null>,
): RecognizedRoute | null {
  const steps = actedSteps(result);
  let best: RecognizedRoute | null = null;
  for (const route of play.routes) {
    if (!followsRoute(steps, route)) continue;
    const cost = costs.get(route.id) ?? null;
    const better = !best
      || route.rating > best.route.rating
      || (route.rating === best.route.rating && (cost ?? Infinity) < (best.cost ?? Infinity));
    if (better) best = { route, cost };
  }
  return best;
}

/** Cost of each declared route: the cheapest path through its keys; `null` — none or unknown. */
export function routeCosts(play: PlayableScenario): Map<string, number | null> {
  return new Map(play.routes.map((r) => {
    const found = cheapestPath(play, { keys: r.keys });
    return [r.id, found.status === "found" ? found.cost : null];
  }));
}

/**
 * What is wrong with the declared routes (v2-design.md section 2.6).
 *
 * @param play A variant that passed the structural checks: scenes and actions exist.
 */
export function routeProblems(play: PlayableScenario): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const scenes = new Map(play.scenes.map((s) => [s.id, s]));
  const sceneName = (id: string) => `«${scenes.get(id)?.title || id}»`;
  const seenIds = new Set<string>();
  const seenKeys = new Map<string, string>();

  for (const route of play.routes) {
    const name = `«${route.title || route.id}»`;
    if (!ID.test(route.id)) errors.push(`Маршрут ${name}: недопустимый id`);
    if (seenIds.has(route.id)) errors.push(`Маршрут ${name}: id ${route.id} уже занят`);
    seenIds.add(route.id);
    if (!route.title?.trim()) errors.push(`Маршрут ${route.id}: нет названия`);
    if (!(typeof route.rating === "number" && route.rating > 0 && route.rating <= 1)) {
      errors.push(`Маршрут ${name}: оценка должна быть больше 0 и не больше 1`);
    }
    if (!Array.isArray(route.keys) || route.keys.length === 0) {
      errors.push(`Маршрут ${name}: нет ключевых действий`);
      continue;
    }
    let broken = false;
    for (const key of route.keys) {
      const scene = scenes.get(key.scene);
      if (!scene) { errors.push(`Маршрут ${name}: сцены ${key.scene} нет`); broken = true; continue; }
      const action = [...(scene.zones ?? []), ...(scene.keys ?? [])].find((a) => a.id === key.action);
      if (!action) { errors.push(`Маршрут ${name}: на сцене ${sceneName(key.scene)} нет действия ${key.action}`); broken = true; }
      else if (action.role === "neutral") { errors.push(`Маршрут ${name}: ${key.action} на сцене ${sceneName(key.scene)} — нейтральная зона`); broken = true; }
    }
    const signature = JSON.stringify(route.keys.map((k) => [k.scene, k.action]));
    const twin = seenKeys.get(signature);
    if (twin) errors.push(`Маршруты ${twin} и ${name}: одинаковые ключевые действия`);
    else seenKeys.set(signature, name);
    if (broken) continue;
    const found = cheapestPath(play, { keys: route.keys });
    if (found.status === "none") errors.push(`Маршрут ${name}: до цели нельзя дойти через его ключевые действия по порядку`);
    if (found.status === "limit") warnings.push(`Маршрут ${name}: сценарий слишком велик, стоимость маршрута не посчитана`);
  }
  if (play.routes.length > 0 && !play.routes.some((r) => r.rating === 1)) {
    warnings.push("Ни у одного маршрута нет оценки 1: максимум балла меньше 100%");
  }
  return { errors, warnings };
}
```

- [ ] **Шаг 4.** `npm test -- tests/sim-routes.test.ts` — PASS.

- [ ] **Шаг 5. Коммит.**

```powershell
git add shared/sim/routes.ts tests/sim-routes.test.ts
git commit -m "feat(sim): объявленные маршруты — распознавание прогона и проверки"
```

---

### Задача 9. Метрики прогона и оси: `analysis.ts`

**Файлы:** создать `shared/sim/analysis.ts`, `tests/sim-analysis.test.ts`.

- [ ] **Шаг 1. Падающий тест.**

```ts
/**
 * @module tests/sim-analysis
 * @description Efficiency, lostness and the four axes (v2-design.md sections 2.4, 2.5, 4.2).
 */
import { describe, it, expect } from "vitest";
import { analyzeRun, axesOf, axesRatio, efficiency, lostness, timeAxis } from "@shared/sim/analysis";
import { createRun } from "@shared/sim/engine";
import { DEFAULT_SIM_PENALTIES } from "@shared/sim/scoring";
import type { Scenario, SimResult } from "@shared/sim/contract";

describe("эффективность", () => {
  it("маршрут: оценка × чистота прохождения", () => {
    expect(efficiency(10, 6, { rating: 0.8, cost: 8 }, undefined)).toBeCloseTo(0.64);
    expect(efficiency(8, 6, { rating: 0.8, cost: 8 }, undefined)).toBeCloseTo(0.8);
  });
  it("без маршрута — по оптимуму; с «прочими путями» — их оценка × оптимум", () => {
    expect(efficiency(12, 6, null, undefined)).toBeCloseTo(0.5);
    expect(efficiency(12, 6, null, 0.5)).toBeCloseTo(0.25);
  });
  it("оптимум неизвестен и маршрута нет — ось не участвует", () => {
    expect(efficiency(12, null, null, undefined)).toBeNull();
  });
});

describe("потерянность и время", () => {
  it("индекс потерянности Смита: идеальный прогон — 0", () => {
    const run = { events: [{ t: 0, type: "enter", scene: "a" }, { t: 1, type: "enter", scene: "b" }] } as Pick<SimResult, "events">;
    expect(lostness(run, 2)).toBe(0);
  });
  it("ось времени — норма к факту, не больше 1", () => {
    expect(timeAxis(120_000, 60)).toBeCloseTo(0.5);
    expect(timeAxis(30_000, 60)).toBe(1);
    expect(timeAxis(30_000, undefined)).toBe(1);
  });
});

describe("оси и их произведение", () => {
  const s: Scenario = {
    format: "skillum.sim-scenario", version: 2, kind: "control",
    meta: { title: "A", task: "T" }, media: [], goal: { checks: [] },
    variants: [{ device: "desktop", stage: { w: 100, h: 10 }, start: "a", scenes: [
      { id: "a", title: "A", elements: [], zones: [
        { id: "side", role: "detour", x: 0, y: 0, w: 5, h: 5, effects: [{ goto: "b" }] },
        { id: "go", role: "path", x: 10, y: 0, w: 5, h: 5, effects: [{ goto: "goal" }] },
      ] },
      { id: "b", title: "B", elements: [], zones: [{ id: "back", role: "path", x: 0, y: 0, w: 5, h: 5, effects: [{ goto: "a" }] }] },
      { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
    ] }],
  };

  it("шаг в сторону снижает эффективность, но не точность", () => {
    const run = createRun(s, { now: () => 0 });
    run.click(2, 2); run.click(2, 2); run.click(12, 2);
    const result = run.result();
    const analysis = analyzeRun(s, result);
    expect(analysis).toMatchObject({ cost: 3, optimum: 1, route: null });
    expect(analysis.efficiency).toBeCloseTo(1 / 3);
    const axes = axesOf(result, analysis, { countPartial: true, penalties: DEFAULT_SIM_PENALTIES, efficiency: true, time: false });
    expect(axes).toEqual({ result: 1, efficiency: analysis.efficiency, accuracy: 1, time: 1 });
    expect(axesRatio(axes)).toBeCloseTo(1 / 3);
  });
});
```

- [ ] **Шаг 2.** `npm test -- tests/sim-analysis.test.ts` — FAIL.

- [ ] **Шаг 3. Записать `shared/sim/analysis.ts`.**

```ts
/**
 * @module shared/sim/analysis
 *
 * What a run says beyond its outcome (`docs/specs/sim-scenario/v2-design.md`, sections 2.4, 2.5,
 * 4.2): its cost against the optimum, the route taken, efficiency, lostness — and the four axes of
 * the `axes` scoring model.
 *
 * Two layers. {@link analyzeRun} depends on the scenario and the run only: the analytics of a
 * research scenario reads it as is. {@link axesOf} adds what the TEST decides — partial credit,
 * penalties, which axes take part. The axes multiply: a missed goal is 0, a flawless run on the best
 * route is 1.
 *
 * Pure and framework-free.
 */
import type { SimResult } from "./contract";
import { cheapestPath, type PathSearch } from "./optimum";
import { recognizeRoute, routeCosts } from "./routes";
import { goalShare, penaltyShare, type SimPenalties } from "./scoring";
import type { ScenarioInput } from "./upgrade";
import { playable, type PlayableScenario } from "./variant";

/** The scenario-and-run facts of one run. */
export interface RunAnalysis {
  /** Cost of the accepted actions. */
  cost: number;
  /** Cost of the cheapest way; `null` — none, or the scenario is too large to search. */
  optimum: number | null;
  route: { id: string; title: string; rating: number; cost: number | null } | null;
  /** In [0; 1]; `null` — cannot be judged: no optimum and no route. */
  efficiency: number | null;
  /** Smith's lostness; `null` — no optimum or no scenes entered. */
  lostness: number | null;
}

/** The four axes of the `axes` model, each in [0; 1]. */
export interface SimAxes {
  result: number;
  efficiency: number;
  accuracy: number;
  time: number;
}

/** What the test sets for the axes. */
export interface AxesSettings {
  countPartial: boolean;
  penalties: SimPenalties;
  efficiency: boolean;
  time: boolean;
}

interface Paths {
  best: PathSearch;
  routes: Map<string, number | null>;
}

const paths = new WeakMap<PlayableScenario, Paths>();

/** The searches of a scenario, done once per device view. */
function pathsOf(play: PlayableScenario): Paths {
  let known = paths.get(play);
  if (!known) {
    known = { best: cheapestPath(play), routes: routeCosts(play) };
    paths.set(play, known);
  }
  return known;
}

/**
 * Efficiency of a run (v2-design.md section 2.4).
 *
 * @param cost Cost of the run.
 * @param optimum Cost of the cheapest way; `null` — unknown.
 * @param route The route recognized: its rating and cost; `null` — none.
 * @param otherRouteRating Rating of a run outside the declared routes; absent — judged by the optimum.
 */
export function efficiency(
  cost: number,
  optimum: number | null,
  route: { rating: number; cost: number | null } | null,
  otherRouteRating: number | undefined,
): number | null {
  const cleanness = (best: number | null): number | null =>
    best === null ? null : cost <= 0 ? 1 : Math.min(1, best / cost);
  if (route) return route.rating * (cleanness(route.cost) ?? 1);
  const byOptimum = cleanness(optimum);
  if (otherRouteRating !== undefined) return otherRouteRating * (byOptimum ?? 1);
  return byOptimum;
}

/**
 * Smith's lostness `√((N/S − 1)² + (R/N − 1)²)`: S — scenes entered, N — distinct of them, R —
 * scenes on the optimal path. 0 — went straight, the larger the more lost.
 */
export function lostness(result: Pick<SimResult, "events">, optimalScenes: number | null): number | null {
  const entered = result.events.filter((e) => e.type === "enter").map((e) => (e as { scene: string }).scene);
  const s = entered.length;
  const n = new Set(entered).size;
  if (s === 0 || n === 0 || optimalScenes === null) return null;
  return Math.sqrt((n / s - 1) ** 2 + (optimalScenes / n - 1) ** 2);
}

/** The time axis: the norm over the duration, at most 1; no norm — 1. */
export function timeAxis(durationMs: number, normSeconds: number | undefined): number {
  if (!normSeconds || normSeconds <= 0 || durationMs <= 0) return 1;
  return Math.min(1, (normSeconds * 1000) / durationMs);
}

/**
 * The facts of a run.
 *
 * @param scenario The scenario of any version, or a device view.
 * @param result The run — a replayed one, so its events are the engine's.
 */
export function analyzeRun(scenario: ScenarioInput | PlayableScenario, result: SimResult): RunAnalysis {
  const play = playable(scenario, result.variant ?? "desktop");
  const { best, routes } = pathsOf(play);
  const optimum = best.status === "found" ? best.cost : null;
  const recognized = recognizeRoute(play, result, routes);
  const cost = typeof result.cost === "number" ? result.cost : 0;
  const route = recognized
    ? { id: recognized.route.id, title: recognized.route.title, rating: recognized.route.rating, cost: recognized.cost }
    : null;
  return {
    cost,
    optimum,
    route,
    efficiency: efficiency(cost, optimum, route, play.settings.otherRouteRating),
    lostness: lostness(result, best.status === "found" ? new Set(best.scenes).size : null),
  };
}

/**
 * The four axes of a run under the test's settings.
 *
 * Accuracy leaves the detour penalty out: a detour already made the run dearer, and the efficiency
 * axis counts it.
 */
export function axesOf(result: SimResult, analysis: RunAnalysis, settings: AxesSettings, normSeconds?: number): SimAxes {
  return {
    result: goalShare(result, settings.countPartial),
    efficiency: settings.efficiency ? (analysis.efficiency ?? 1) : 1,
    accuracy: Math.max(0, 1 - penaltyShare(result, { ...settings.penalties, detour: 0 })),
    time: settings.time ? timeAxis(result.durationMs, normSeconds) : 1,
  };
}

/** The share of the price the axes give: their product, in [0; 1]. */
export function axesRatio(axes: SimAxes): number {
  return Math.max(0, Math.min(1, axes.result * axes.efficiency * axes.accuracy * axes.time));
}
```

- [ ] **Шаг 4.** `npm test -- tests/sim-analysis.test.ts` — PASS.

- [ ] **Шаг 5. Коммит.**

```powershell
git add shared/sim/analysis.ts tests/sim-analysis.test.ts
git commit -m "feat(sim): метрики прогона — эффективность, потерянность — и оси оценки"
```

---

### Задача 10. Проверки v2: `validate.ts`

**Файлы:** изменить `shared/sim/validate.ts`, `tests/sim-validate.test.ts`; создать `tests/sim-validate-v2.test.ts`.

Принцип: v1 сначала переносится `liftV1` в форму v2, затем ВСЕ проверки идут по v2. Тексты ошибок у сцен, зон,
элементов и полей прежние; у сценария с одним вариантом префикса варианта нет, поэтому `tests/sim-validate.test.ts`
проходит без правки текстов.

- [ ] **Шаг 1. Падающий тест `tests/sim-validate-v2.test.ts`.**

```ts
/**
 * @module tests/sim-validate-v2
 * @description Checks version 2 adds (v2-design.md sections 1 and 2.6): kinds, ends, stages, routes,
 * costs, device actions; a version 1 scenario is checked as its upgrade.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateScenario } from "@shared/sim/validate";
import { asScenario } from "@shared/sim/upgrade";
import type { Scenario } from "@shared/sim/contract";

const v1 = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/sim/scenario-v1.json"), "utf8"));
const stored = (s: Scenario) => {
  const c = structuredClone(s);
  c.media.forEach((m, i) => { m.file = `/api/media/00000000-0000-0000-0000-00000000000${i % 10}`; });
  return validateScenario(c, { mode: "stored" });
};
const v2 = (): Scenario => structuredClone(asScenario(v1));

function research(): Scenario {
  return {
    format: "skillum.sim-scenario", version: 2, kind: "research",
    meta: { title: "R", task: "T" }, media: [],
    stages: [{ id: "find", title: "Поиск" }],
    variants: [{ device: "desktop", stage: { w: 10, h: 10 }, start: "a", scenes: [
      { id: "a", title: "A", elements: [], stage: "find", zones: [{ id: "go", x: 0, y: 0, w: 5, h: 5, effects: [{ goto: "b" }] }] },
      { id: "b", title: "B", elements: [], end: { outcome: "finale", title: "Нашёл", target: true } },
    ] }],
  };
}

describe("перевод и версии", () => {
  it("эталон v1 и его перевод в v2 проходят одинаково", () => {
    expect(stored(v2()).errors).toEqual([]);
    expect(stored(v1 as never).errors).toEqual([]);
  });
  it("версия новее 2 — «новее»", () => {
    expect(stored({ ...v2(), version: 3 } as never).errors[0]).toMatch(/новее/);
  });
});

describe("вид сценария", () => {
  it("исследовательский сценарий без ролей и цели проходит", () => {
    expect(validateScenario(research(), { mode: "stored" })).toEqual({ errors: [], warnings: [] });
  });
  it("у исследовательского сценария нет проверок цели и концов success", () => {
    const s = research();
    s.goal = { checks: [] };
    s.variants[0].scenes[1].end = { outcome: "success" };
    const { errors } = validateScenario(s, { mode: "stored" });
    expect(errors).toContain("У исследовательского сценария не бывает проверок цели");
    expect(errors).toContain("Сцена «B»: конец success бывает только у контрольного сценария");
  });
  it("у контрольного сценария роль обязательна, финалов нет", () => {
    const s = v2();
    delete s.variants[0].scenes[0].zones![0].role;
    s.variants[0].scenes[0].end = undefined;
    const tail = s.variants[0].scenes.at(-1)!;
    tail.end = { outcome: "finale", title: "Х" };
    const { errors } = stored(s);
    expect(errors.some((e) => /неизвестная роль undefined/.test(e))).toBe(true);
    expect(errors).toContain(`Сцена «${tail.title}»: финал бывает только у исследовательского сценария`);
  });
  it("неизвестный вид", () => {
    expect(validateScenario({ ...research(), kind: "quiz" }, { mode: "stored" }).errors).toContain("Вид сценария должен быть control или research");
  });
});

describe("этапы, стоимость, устройство", () => {
  it("сцена ссылается на необъявленный этап", () => {
    const s = research();
    s.variants[0].scenes[0].stage = "ghost";
    expect(validateScenario(s, { mode: "stored" }).errors).toContain("Сцена «A»: этап ghost не объявлен");
  });
  it("отрицательная стоимость и чужое устройству действие", () => {
    const s = research();
    Object.assign(s.variants[0].scenes[0].zones![0], { cost: -1, action: "tap" });
    const { errors } = validateScenario(s, { mode: "stored" });
    expect(errors).toContain("Сцена «A»: зона go — стоимость должна быть числом не меньше нуля");
    expect(errors).toContain("Сцена «A»: зона go: действие tap не бывает на устройстве «десктоп»");
  });
  it("два варианта одного устройства", () => {
    const s = research();
    s.variants.push(structuredClone(s.variants[0]));
    expect(validateScenario(s, { mode: "stored" }).errors).toContain("Вариант для устройства «десктоп» объявлен дважды");
  });
});

describe("маршруты в проверке", () => {
  it("ошибки маршрутов попадают в ошибки сценария", () => {
    const s = v2();
    s.variants[0].routes = [{ id: "r", title: "Р", rating: 2, keys: [{ scene: s.variants[0].start, action: "ghost" }] }];
    const { errors } = stored(s);
    expect(errors.some((e) => e.startsWith("Маршрут «Р»: оценка"))).toBe(true);
  });
});
```

- [ ] **Шаг 2. Поправить `tests/sim-validate.test.ts:55`:** `version: 2` → `version: 3`.

- [ ] **Шаг 3.** `npm test -- tests/sim-validate-v2.test.ts tests/sim-validate.test.ts` — FAIL.

- [ ] **Шаг 4. Переписать `shared/sim/validate.ts`.** Вспомогательные функции `sizeOf`, `num`, `outside`, `mb`,
  `checkShape`, `checkEffect`, `checkCondition`, `reach` и интерфейсы `ArchiveImage`, `ValidateOptions`,
  `ValidationResult`, константы `MAX_IMAGE_BYTES`, `MAX_IMAGE_SIDE`, `ID`, `KEYS`, `ARCHIVE_MEDIA`, `STORED_MEDIA`,
  `ROLES`, `SHAPES` и типы `Obj`, `isObj`, `isNum`, `isStr`, `arr` оставить как есть. Константу `ACTIONS` заменить, а
  `validateScenario` и `summarizeScenario` переписать так.

JSDoc модуля — дополнить вторым абзацем:

```ts
 * Version 1 is checked as its upgrade: `liftV1` moves it into the version 2 shape without trusting
 * it, and every rule below runs on that shape. Messages about scenes, elements, fields and zones
 * are the same in both versions; a scenario with several variants prefixes them with the device.
```

Импорты — временную строку `import { CONTRACT_V1 as CONTRACT_VERSION } from "./contract-v1";` с её комментарием
(задача 1, шаг 2а) удалить, остальное заменить на:

```ts
import { CONTRACT_VERSION, SCENARIO_FORMAT, type Condition, type Effect, type Scenario, type Size } from "./contract";
import { boundsOf, polygonProblem, type Point } from "./geometry";
import { cheapestPath } from "./optimum";
import { routeProblems } from "./routes";
import { liftV1 } from "./upgrade";
import { playable } from "./variant";
```

Константы действий:

```ts
const MOUSE = new Set(["click", "dblclick", "rightclick", "hover", "drag"]);
const GESTURES = new Set(["tap", "doubletap", "longpress", "swipe-left", "swipe-right", "swipe-up", "swipe-down"]);
const DEVICE_ACTIONS: Record<string, Set<string>> = { desktop: MOUSE, phone: GESTURES };
const DEVICE_TITLES: Record<string, string> = { desktop: "десктоп", phone: "телефон" };
const COST_KINDS = new Set([...MOUSE, ...GESTURES, "key", "field"]);
const isCost = (v: unknown): boolean => isNum(v) && v >= 0;
```

`validateScenario` целиком:

```ts
export function validateScenario(input: unknown, options: ValidateOptions): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObj(input)) return { errors: ["scenario.json — не объект JSON"], warnings };
  if (input.format !== SCENARIO_FORMAT) errors.push(`Поле format должно быть «${SCENARIO_FORMAT}»`);
  let doc: Obj = input;
  if (input.version === 1) {
    const lifted = liftV1(input);
    doc = lifted.doc;
    warnings.push(...lifted.notes);
    if (lifted.conflict) errors.push(lifted.conflict);
  } else if (input.version !== CONTRACT_VERSION) {
    errors.push(isNum(input.version) && input.version > CONTRACT_VERSION
      ? `Версия формата ${input.version} новее поддерживаемой (${CONTRACT_VERSION})`
      : `Поле version должно быть ${CONTRACT_VERSION}`);
  }
  const kind = doc.kind;
  if (kind !== "control" && kind !== "research") errors.push("Вид сценария должен быть control или research");
  const control = kind !== "research";
  const meta = isObj(doc.meta) ? doc.meta : null;
  if (!meta || !isStr(meta.title) || !meta.title.trim()) errors.push("Нет названия сценария (meta.title)");
  if (!meta || !isStr(meta.task) || !meta.task.trim()) errors.push("Нет текста задания (meta.task)");
  const variants = arr(doc.variants).filter(isObj);
  if (variants.length === 0) errors.push("В сценарии нет вариантов");
  if (variants.length === 1 && arr(variants[0].scenes).length === 0) errors.push("В сценарии нет сцен");
  if (!Array.isArray(doc.media)) errors.push("Нет библиотеки изображений (media)");
  if (errors.length) return { errors, warnings };

  const settings = isObj(doc.settings) ? doc.settings : {};

  // ── Library ──
  const media = new Map<string, Obj>();
  const files = options.files ?? new Map<string, ArchiveImage>();
  const maxBytes = options.maxImageBytes ?? MAX_IMAGE_BYTES;
  for (const raw of arr(doc.media)) {
    if (!isObj(raw) || !isStr(raw.id)) { errors.push("Изображение библиотеки без id"); continue; }
    const id = raw.id;
    if (!ID.test(id)) errors.push(`Изображение ${id}: недопустимый id`);
    if (media.has(id)) errors.push(`Изображение ${id} объявлено дважды`);
    media.set(id, raw);
    const file = isStr(raw.file) ? raw.file : "";
    if (options.mode === "stored") {
      if (!STORED_MEDIA.test(file)) errors.push(`Изображение ${id}: адрес ${file || "не задан"} не из медиатеки`);
      continue;
    }
    if (!ARCHIVE_MEDIA.test(file)) {
      errors.push(`Изображение ${id}: путь ${file || "не задан"} — ожидается media/<имя>.png, .jpg или .webp`);
      continue;
    }
    const found = files.get(file);
    if (!found) { errors.push(`Изображение ${id}: файла ${file} нет в архиве`); continue; }
    if (!found.format) { errors.push(`Изображение ${id}: ${file} — не PNG, JPEG или WebP`); continue; }
    if (found.byteSize > maxBytes) {
      errors.push(`Изображение ${id}: ${file} — ${mb(found.byteSize)}, больше допустимых ${mb(maxBytes)}`);
    }
    if ((found.width ?? 0) > MAX_IMAGE_SIDE || (found.height ?? 0) > MAX_IMAGE_SIDE) {
      errors.push(`Изображение ${id}: ${file} — ${found.width} × ${found.height}, сторона больше ${MAX_IMAGE_SIDE} px`);
    }
    if (isNum(raw.w) && isNum(raw.h) && found.width && found.height && (found.width !== raw.w || found.height !== raw.h)) {
      warnings.push(`Изображение ${id}: в файле ${found.width} × ${found.height}, в сценарии ${raw.w} × ${raw.h}`);
    }
  }
  if (options.mode === "archive") {
    const used = new Set([...media.values()].map((m) => m.file));
    for (const path of files.keys()) if (!used.has(path)) warnings.push(`Файл ${path} в архиве, но в сценарии не используется`);
  }

  // ── Fields ──
  const fields = new Map<string, Obj>();
  for (const raw of arr(doc.fields)) {
    if (!isObj(raw) || !isStr(raw.id)) { errors.push("Поле без id"); continue; }
    if (!ID.test(raw.id)) errors.push(`Поле ${raw.id}: недопустимый id`);
    if (fields.has(raw.id)) errors.push(`Поле ${raw.id} объявлено дважды`);
    fields.set(raw.id, raw);
    if (raw.fill !== "keyboard" && raw.fill !== "effect") errors.push(`Поле ${raw.id}: fill должно быть keyboard или effect`);
    if (raw.fill === "keyboard" && !raw.check) warnings.push(`Поле ${raw.id}: ввод без проверки`);
  }

  // ── Settings ──
  if (isObj(settings.costs)) {
    for (const [k, v] of Object.entries(settings.costs)) {
      if (!COST_KINDS.has(k)) errors.push(`Стоимость по умолчанию: неизвестный вид действия ${k}`);
      else if (!isCost(v)) errors.push(`Стоимость по умолчанию для ${k} должна быть числом не меньше нуля`);
    }
  }
  if (settings.otherRouteRating !== undefined && !(isNum(settings.otherRouteRating) && settings.otherRouteRating > 0 && settings.otherRouteRating <= 1)) {
    errors.push("Оценка прочих путей должна быть больше 0 и не больше 1");
  }

  // ── Stages ──
  const stages = new Set<string>();
  for (const raw of arr(doc.stages)) {
    if (!isObj(raw) || !isStr(raw.id)) { errors.push("Этап без id"); continue; }
    if (!ID.test(raw.id)) errors.push(`Этап ${raw.id}: недопустимый id`);
    if (stages.has(raw.id)) errors.push(`Этап ${raw.id} объявлен дважды`);
    if (!isStr(raw.title) || !raw.title.trim()) errors.push(`Этап ${raw.id}: нет названия`);
    stages.add(raw.id);
  }

  // ── Goal ──
  const goal = isObj(doc.goal) ? doc.goal : null;
  if (!control && doc.goal !== undefined) errors.push("У исследовательского сценария не бывает проверок цели");
  if (control && goal) {
    for (const check of arr(goal.checks)) {
      if (!isObj(check)) continue;
      const def = fields.get(String(check.field));
      if (!def) errors.push(`Проверка цели по необъявленному полю ${String(check.field)}`);
      else if (!check.check && !def.check) errors.push(`Проверка цели по полю ${String(check.field)}, у которого нет проверки`);
      if (check.weight !== undefined && !(isNum(check.weight) && check.weight > 0)) errors.push(`Вес проверки поля ${String(check.field)} должен быть больше нуля`);
    }
  }

  // ── Variants ──
  const devices = new Set<string>();
  for (const variant of variants) {
    const device = String(variant.device);
    const actions = DEVICE_ACTIONS[device];
    if (!actions) { errors.push(`Неизвестное устройство варианта ${device}`); continue; }
    if (devices.has(device)) errors.push(`Вариант для устройства «${DEVICE_TITLES[device]}» объявлен дважды`);
    devices.add(device);
    const prefix = variants.length > 1 ? `Вариант «${DEVICE_TITLES[device]}»: ` : "";
    checkVariant(variant, {
      prefix, device, actions, control, settings, media, fields, stages, errors, warnings,
      finishButton: settings.finishButton !== false,
    });
  }

  // ── Routes and the optimum — only on a structurally sound scenario ──
  if (errors.length === 0) {
    const scenario = doc as unknown as Scenario;
    for (const variant of scenario.variants) {
      const play = playable(scenario, variant.device);
      const prefix = scenario.variants.length > 1 ? `Вариант «${DEVICE_TITLES[variant.device]}»: ` : "";
      const routes = routeProblems(play);
      errors.push(...routes.errors.map((e) => prefix + e));
      warnings.push(...routes.warnings.map((w) => prefix + w));
      const best = cheapestPath(play);
      if (best.status === "limit") warnings.push(`${prefix}Сценарий слишком велик: оптимальный путь не посчитан, эффективность — только по маршрутам`);
      if (control && best.status === "found") {
        const strict = cheapestPath(play, { detours: false });
        if (strict.status !== "found" || strict.cost > best.cost) warnings.push(`${prefix}Шаг в сторону даёт путь дешевле основного: проверьте роли зон`);
      }
    }
  }

  return { errors, warnings };
}
```

`checkVariant` — новая функция, тело — прежний блок «Scenes» и «Graph» с правками, отмеченными комментариями:

```ts
interface VariantScope {
  prefix: string;
  device: string;
  actions: Set<string>;
  control: boolean;
  finishButton: boolean;
  settings: Obj;
  media: Map<string, Obj>;
  fields: Map<string, Obj>;
  stages: Set<string>;
  errors: string[];
  warnings: string[];
}

/** The checks of one device's graph: scenes, elements, fields, zones, ends and reachability. */
function checkVariant(variant: Obj, v: VariantScope): void {
  const { prefix, errors, warnings, media, fields } = v;
  const stage = sizeOf(variant.stage);
  const scenes = new Map<string, Obj>();
  for (const raw of arr(variant.scenes)) {
    if (!isObj(raw) || !isStr(raw.id)) { errors.push(`${prefix}Сцена без id`); continue; }
    if (!ID.test(raw.id)) errors.push(`${prefix}Сцена ${raw.id}: недопустимый id`);
    if (scenes.has(raw.id)) errors.push(`${prefix}Сцена ${raw.id} объявлена дважды`);
    scenes.set(raw.id, raw);
  }
  const start = isStr(variant.start) ? variant.start : "";
  if (!scenes.has(start)) errors.push(`${prefix}Стартовая сцена ${start || "не задана"} не найдена`);
  if (variant.minViewportWidth !== undefined && !(isNum(variant.minViewportWidth) && variant.minViewportWidth > 0)) {
    errors.push(`${prefix}Минимальная ширина окна должна быть больше нуля`);
  }

  const label = (scene: Obj) => `${prefix}Сцена «${isStr(scene.title) && scene.title.trim() ? scene.title : String(scene.id)}»`;
  const edges = new Map<string, Set<string>>();
  const pathEdges = new Map<string, Set<string>>();
  const actionIds = new Set<string>();

  for (const scene of scenes.values()) {
    const sid = String(scene.id);
    const where = label(scene);
    const size = sizeOf(scene.size) ?? stage;
    // Changed: the default size is the variant's stage, not settings.stage.
    if (!size) errors.push(`${where}: не задан размер — ни у сцены, ни у варианта`);
    edges.set(sid, new Set());
    pathEdges.set(sid, new Set());
    // New: the stage of the task.
    if (scene.stage !== undefined && !(isStr(scene.stage) && v.stages.has(scene.stage))) {
      errors.push(`${where}: этап ${String(scene.stage)} не объявлен`);
    }

    const elements = new Map<string, Obj>();
    for (const raw of arr(scene.elements)) {
      if (!isObj(raw) || !isStr(raw.id)) { errors.push(`${where}: элемент без id`); continue; }
      const eid = raw.id;
      if (!ID.test(eid)) errors.push(`${where}: элемент ${eid} — недопустимый id`);
      if (elements.has(eid)) errors.push(`${where}: элемент ${eid} повторяется`);
      elements.set(eid, raw);
      const m = isStr(raw.media) ? media.get(raw.media) : undefined;
      if (!m) { errors.push(`${where}: элемент ${eid} ссылается на изображение ${String(raw.media)}, которого нет в библиотеке`); continue; }
      const box = { x: num(raw.x), y: num(raw.y), w: isNum(raw.w) ? raw.w : num(m.w), h: isNum(raw.h) ? raw.h : num(m.h) };
      if (size && outside(box, size)) errors.push(`${where}: элемент ${eid} выходит за пределы сцены`);
      if (raw.autoHideMs !== undefined && !(isNum(raw.autoHideMs) && raw.autoHideMs > 0)) errors.push(`${where}: элемент ${eid} — autoHideMs должно быть больше нуля`);
    }

    for (const raw of arr(scene.fields)) {
      if (!isObj(raw)) continue;
      const fid = String(raw.field);
      const def = fields.get(fid);
      if (!def) { errors.push(`${where}: поле ${fid} не объявлено в fields`); continue; }
      const box = { x: num(raw.x), y: num(raw.y), w: num(raw.w), h: num(raw.h) };
      if (size && outside(box, size)) errors.push(`${where}: поле ${fid} выходит за пределы сцены`);
      if (raw.editable && def.fill !== "keyboard") errors.push(`${where}: поле ${fid} заполняется эффектом и не может быть доступно для ввода`);
    }

    const acts = [...arr(scene.zones).map((z) => ({ z, key: false })), ...arr(scene.keys).map((z) => ({ z, key: true }))];
    for (const { z: raw, key } of acts) {
      if (!isObj(raw) || !isStr(raw.id)) { errors.push(`${where}: ${key ? "сочетание клавиш" : "зона"} без id`); continue; }
      const zid = raw.id;
      const what = `${where}: ${key ? "сочетание" : "зона"} ${zid}`;
      if (!ID.test(zid)) errors.push(`${what} — недопустимый id`);
      if (actionIds.has(zid)) errors.push(`${what} — id уже занят другой зоной или сочетанием`);
      actionIds.add(zid);

      const role = raw.role;
      // Changed: a research scenario may leave the role out.
      if (role === undefined ? v.control : !(isStr(role) && ROLES.has(role))) { errors.push(`${what}: неизвестная роль ${String(role)}`); continue; }
      // New: the cost.
      if (raw.cost !== undefined && !isCost(raw.cost)) errors.push(`${what} — стоимость должна быть числом не меньше нуля`);
      if (key) {
        if (!isStr(raw.keys) || !KEYS.test(raw.keys)) errors.push(`${what}: запись «${String(raw.keys)}» не по шаблону (Ctrl+S, Shift+F10, Escape)`);
      } else {
        checkShape(raw, size, what, errors);
        // Changed: the action must be one of the variant's device.
        if (raw.action !== undefined) {
          if (!(isStr(raw.action) && (MOUSE.has(raw.action) || GESTURES.has(raw.action)))) errors.push(`${what}: неизвестное действие ${String(raw.action)}`);
          else if (!v.actions.has(raw.action)) errors.push(`${what}: действие ${raw.action} не бывает на устройстве «${DEVICE_TITLES[v.device]}»`);
        }
        if (raw.action === "drag" && !isObj(raw.drop)) errors.push(`${what}: перетаскивание без drop`);
        if (raw.in !== undefined && !(isStr(raw.in) && isObj(elements.get(raw.in)?.scroll))) errors.push(`${what}: in ${String(raw.in)} — нет такого прокручиваемого элемента на сцене`);
        if (raw.copyText !== undefined && role !== "neutral") errors.push(`${what}: копируемый текст бывает только у нейтральной зоны`);
      }

      const effects = arr(raw.effects);
      if (role === "neutral" && (raw.effects !== undefined || raw.when !== undefined)) errors.push(`${what}: у нейтральной зоны не бывает эффектов и условий`);
      if (role !== "neutral" && effects.length === 0) errors.push(`${what}: нет эффектов`);
      if (role === "trap" && !(isStr(raw.error) && raw.error.trim())) errors.push(`${what}: у ловушки не задано название ошибки`);
      if (raw.otherwise !== undefined && raw.when === undefined) errors.push(`${what}: otherwise без when`);

      for (const effect of [...effects, ...arr(raw.otherwise)]) {
        const target = checkEffect(effect, { scenes, elements, fields }, what, errors);
        if (target) {
          edges.get(sid)!.add(target);
          // Changed: in a research scenario every non-trap action leads somewhere legitimately.
          const leads = v.control ? role === "path" || role === "alt" : role !== "trap";
          if (leads) pathEdges.get(sid)!.add(target);
        }
      }
      if (raw.when !== undefined) checkCondition(raw.when, { elements, fields }, what, errors);
    }

    if (scene.onMissGoto !== undefined) {
      if (!isStr(scene.onMissGoto) || !scenes.has(scene.onMissGoto)) errors.push(`${where}: onMissGoto ведёт на несуществующую сцену ${String(scene.onMissGoto)}`);
      else edges.get(sid)!.add(scene.onMissGoto);
    }

    // Changed: `end` instead of `goal`; the checks themselves are the scenario's goal.
    if (scene.end !== undefined) {
      const end = isObj(scene.end) ? scene.end : {};
      if (end.outcome === "success" && !v.control) errors.push(`${where}: конец success бывает только у контрольного сценария`);
      else if (end.outcome === "finale") {
        if (v.control) errors.push(`${where}: финал бывает только у исследовательского сценария`);
        else if (!isStr(end.title) || !end.title.trim()) errors.push(`${where}: у финала нет названия`);
      } else if (end.outcome !== "success" && end.outcome !== "fail") {
        errors.push(v.control ? `${where}: исход цели должен быть success или fail` : `${where}: конец должен быть fail или finale`);
      }
    } else if (!acts.some(({ z }) => isObj(z) && z.role !== "neutral")) {
      errors.push(`${where}: тупик — ни цели, ни одного действия`);
    }
  }

  if (!scenes.has(start)) return;
  const all = reach(start, edges);
  const byPath = reach(start, pathEdges);
  for (const scene of scenes.values()) if (!all.has(String(scene.id))) warnings.push(`${label(scene)} недостижима от старта`);
  const endsOf = (outcome: string) => [...scenes.values()].filter((s) => isObj(s.end) && s.end.outcome === outcome);
  const names = (list: Obj[]) => list.map((s) => `«${isStr(s.title) ? s.title : String(s.id)}»`).join(", ");
  if (v.control) {
    const success = endsOf("success");
    if (success.length === 0) errors.push(`${prefix}В сценарии нет цели с исходом success`);
    else if (!success.some((s) => byPath.has(String(s.id)))) errors.push(`${prefix}К цели ${names(success)} нельзя дойти только по основному и другим верным путям`);
  } else {
    const finales = endsOf("finale");
    if (finales.length === 0 && !v.finishButton) errors.push(`${prefix}Исследовательскому сценарию нужен финал или кнопка «Я закончил»`);
    else if (finales.length > 0 && !finales.some((s) => byPath.has(String(s.id))) && !v.finishButton) {
      errors.push(`${prefix}До финалов ${names(finales)} нельзя дойти`);
    }
  }
}
```

`summarizeScenario` целиком:

```ts
/**
 * Summarize a scenario that passed {@link validateScenario}. Counts are of the desktop variant:
 * that is the one every scenario has until phone variants are authored.
 */
export function summarizeScenario(input: ScenarioInput): ScenarioSummary {
  const play = playable(input);
  const actions = play.scenes.flatMap((s) => [...(s.zones ?? []), ...(s.keys ?? [])]);
  return {
    title: play.meta.title,
    system: play.meta.system ?? null,
    task: play.meta.task,
    stage: play.settings.stage ?? null,
    scenes: play.scenes.length,
    images: play.media.length,
    fields: play.fields.length,
    traps: actions.filter((a) => a.role === "trap").length,
    checks: play.goal?.checks.length ?? 0,
    limitSeconds: play.settings.limitSeconds ?? null,
  };
}
```

Добавить импорт `import type { ScenarioInput } from "./upgrade";` (вместе с `liftV1`). Поле `checks` в
`ScenarioSummary` — JSDoc поправить на `Field checks of the goal.`.

- [ ] **Шаг 5. Прогнать.**

```powershell
npm test -- tests/sim-validate-v2.test.ts tests/sim-validate.test.ts tests/sim-scenario-archive.test.ts
```

Ожидается: PASS. Тест «проходит проверку архива без ошибок и предупреждений» эталона v1 обязан остаться зелёным:
появилось новое предупреждение (например, «Шаг в сторону даёт путь дешевле основного») — это находка о примере,
её показать владельцу, а не глушить.

- [ ] **Шаг 5а. Устройство варианта и случаи таблицы 2.6** (дописано 2026-10-17 по ревью W3-validate, подтверждено
  координатором). Спецификация, раздел 1: «Действие чужого устройства — ошибка проверки». Код выше проверяет только
  явно заданное `action` зоны: на варианте `phone` проходят сочетания клавиш и зона без `action` (по умолчанию
  `click`). Две правки в `checkVariant`.

Ветка сочетания клавиш — после проверки шаблона `KEYS`:

```ts
        if (!isStr(raw.keys) || !KEYS.test(raw.keys)) errors.push(`${what}: запись «${String(raw.keys)}» не по шаблону (Ctrl+S, Shift+F10, Escape)`);
        // A keyboard shortcut needs a keyboard: only the desktop variant has one.
        if (v.device !== "desktop") errors.push(`${what}: сочетаний клавиш не бывает на устройстве «${DEVICE_TITLES[v.device]}»`);
      } else {
```

Проверка действия зоны — ветка `else` к `if (raw.action !== undefined)`. Нейтральная зона действия не задаёт: движок
его у неё не читает.

```ts
          else if (!v.actions.has(raw.action)) errors.push(`${what}: действие ${raw.action} не бывает на устройстве «${DEVICE_TITLES[v.device]}»`);
        } else if (role !== "neutral" && !v.actions.has("click")) {
          // The default action is a click; a device without a mouse has to name its gesture.
          errors.push(`${what}: на устройстве «${DEVICE_TITLES[v.device]}» действие зоны задаётся явно — click по умолчанию здесь не бывает`);
        }
```

Тесты — дописать в конец `tests/sim-validate-v2.test.ts` блок ниже, прежние тесты не трогать. Итог — 21 тест и 38
вызовов `expect(`: приёмка не пропустит меньше. Тест предела перебирает больше 100 000 состояний и идёт несколько
секунд, поэтому у него таймаут 60 секунд.

```ts
/** A zone of the review scenarios: a 5 × 5 square at `x`. */
const zz = (id: string, x: number, effects: unknown[], more: Record<string, unknown> = {}) =>
  ({ id, role: "path", x, y: 0, w: 5, h: 5, effects, ...more }) as never;
const check = (s: unknown) => validateScenario(s, { mode: "stored" });

/** A clean control scenario: «+» to the card, or the menu and «Новый»; the card saves to the goal. */
function control(extra: Partial<Scenario> = {}): Scenario {
  return {
    format: "skillum.sim-scenario", version: 2, kind: "control",
    meta: { title: "C", task: "T" }, media: [], goal: { checks: [] },
    variants: [{ device: "desktop", stage: { w: 100, h: 10 }, start: "a", scenes: [
      { id: "a", title: "A", elements: [], zones: [zz("plus", 0, [{ goto: "card" }]), zz("menu", 10, [{ goto: "m" }], { role: "alt" })] },
      { id: "m", title: "Меню", elements: [], zones: [zz("new", 0, [{ goto: "card" }])] },
      { id: "card", title: "Карточка", elements: [], zones: [zz("save", 0, [{ goto: "goal" }])] },
      { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
    ] }],
    ...extra,
  };
}

/** A detour that is cheaper than the main path: «side» goes to the goal at once, the path takes two steps. */
function detourShortcut(): Scenario {
  const s = control();
  s.variants[0].scenes = [
    { id: "a", title: "A", elements: [], zones: [zz("long", 0, [{ goto: "b" }]), zz("side", 10, [{ goto: "goal" }], { role: "detour" })] },
    { id: "b", title: "B", elements: [], zones: [zz("b-go", 0, [{ goto: "goal" }])] },
    { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
  ];
  return s;
}

/** The scenario with a phone variant copied from the desktop one; zone actions set to `action`. */
function withPhone(s: Scenario, action?: string): Scenario {
  const phone = structuredClone(s.variants[0]);
  phone.device = "phone";
  for (const scene of phone.scenes) {
    for (const zone of scene.zones ?? []) if (action) (zone as { action?: string }).action = action;
  }
  s.variants.push(phone);
  return s;
}

describe("проверки v2: случаи ревью W3-validate", () => {
  it("эталон v1 и его перевод в v2 — без ошибок и без предупреждений", () => {
    expect(stored(v1 as never)).toEqual({ errors: [], warnings: [] });
    expect(stored(v2())).toEqual({ errors: [], warnings: [] });
  });

  it("две сцены-цели v1 с разными проверками — отказ перевода с объяснением", () => {
    const twin = structuredClone(v1);
    const goal = twin.scenes.find((s: { goal?: { outcome: string } }) => s.goal?.outcome === "success");
    twin.scenes.push({ ...structuredClone(goal), id: "goal-2", title: "Вторая цель", goal: { outcome: "success", checks: [] } });
    expect(validateScenario(twin, { mode: "archive", files: new Map() }).errors).toEqual([
      `Сцены-цели «${goal.title}», «Вторая цель» проверяют разные поля: в версии 2 у сценария одна цель — оставьте у них одинаковые проверки`,
    ]);
  });

  it("контрольный образец без маршрутов — без ошибок и предупреждений", () => {
    expect(check(control())).toEqual({ errors: [], warnings: [] });
  });

  it("маршруты: одинаковые ключи, сцены и действия нет, цель недостижима через ключи", () => {
    const s = control();
    s.variants[0].routes = [
      { id: "r1", title: "Р1", rating: 1, keys: [{ scene: "a", action: "plus" }] },
      { id: "r2", title: "Р2", rating: 1, keys: [{ scene: "a", action: "plus" }] },
      { id: "r3", title: "Р3", rating: 1, keys: [{ scene: "ghost", action: "x" }] },
      { id: "r4", title: "Р4", rating: 1, keys: [{ scene: "a", action: "ghost" }] },
      { id: "r5", title: "Р5", rating: 1, keys: [{ scene: "card", action: "save" }, { scene: "a", action: "menu" }] },
    ];
    expect(check(s)).toEqual({
      errors: [
        "Маршруты «Р1» и «Р2»: одинаковые ключевые действия",
        "Маршрут «Р3»: сцены ghost нет",
        "Маршрут «Р4»: на сцене «A» нет действия ghost",
        "Маршрут «Р5»: до цели нельзя дойти через его ключевые действия по порядку",
      ],
      warnings: [],
    });
  });

  it("маршруты без оценки 1 — предупреждение, не ошибка", () => {
    const s = control();
    s.variants[0].routes = [{ id: "r", title: "Через меню", rating: 0.5, keys: [{ scene: "a", action: "menu" }] }];
    expect(check(s)).toEqual({ errors: [], warnings: ["Ни у одного маршрута нет оценки 1: максимум балла меньше 100%"] });
  });

  it("шаг в сторону дешевле основного пути — предупреждение", () => {
    expect(check(detourShortcut())).toEqual({ errors: [], warnings: ["Шаг в сторону даёт путь дешевле основного: проверьте роли зон"] });
  });

  it("несколько вариантов — у сообщений префикс устройства", () => {
    expect(check(withPhone(detourShortcut(), "tap"))).toEqual({
      errors: [],
      warnings: [
        "Вариант «десктоп»: Шаг в сторону даёт путь дешевле основного: проверьте роли зон",
        "Вариант «телефон»: Шаг в сторону даёт путь дешевле основного: проверьте роли зон",
      ],
    });
  });

  it("предел поиска оптимума — предупреждение, сценарий принимается", () => {
    const n = 17;
    const ids = Array.from({ length: n }, (_, i) => `e${i + 1}`);
    const s = control({ media: [{ id: "m", file: "/api/media/00000000-0000-0000-0000-000000000001", w: 1, h: 1 }] });
    s.variants[0].scenes = [
      {
        id: "a", title: "A",
        elements: ids.map((id) => ({ id, media: "m", x: 0, y: 0, hidden: true })),
        zones: [
          ...ids.map((id, i) => zz(`t${i + 1}`, i * 5, [{ toggle: id }])),
          zz("go", 90, [{ goto: "goal" }], { when: { all: ids.map((id) => ({ visible: id })) }, otherwise: [] }),
        ],
      },
      { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
    ];
    expect(check(s)).toEqual({
      errors: [],
      warnings: ["Сценарий слишком велик: оптимальный путь не посчитан, эффективность — только по маршрутам"],
    });
  }, 60_000);

  it("исследовательский без «Я закончил»: нужен финал, и до него должен вести путь", () => {
    const loop = research();
    loop.settings = { finishButton: false };
    loop.variants[0].scenes = [
      { id: "a", title: "A", elements: [], zones: [zz("go", 0, [{ goto: "b" }], { role: undefined })] },
      { id: "b", title: "B", elements: [], zones: [zz("back", 0, [{ goto: "a" }], { role: undefined })] },
    ];
    expect(check(loop).errors).toEqual(["Исследовательскому сценарию нужен финал или кнопка «Я закончил»"]);

    const trapOnly = research();
    trapOnly.settings = { finishButton: false };
    trapOnly.variants[0].scenes = [
      { id: "a", title: "A", elements: [], zones: [zz("oops", 0, [{ goto: "b" }], { role: "trap", error: "Не туда" })] },
      { id: "b", title: "Нашёл", elements: [], end: { outcome: "finale", title: "Нашёл" } },
    ];
    expect(check(trapOnly).errors).toEqual(["До финалов «Нашёл» нельзя дойти"]);

    trapOnly.settings = {};
    expect(check(trapOnly).errors).toEqual([]);
  });

  it("настройки, этапы, устройства и ширина окна", () => {
    expect(check(control({ settings: { costs: { jump: 1, click: -1 } as never } })).errors).toEqual([
      "Стоимость по умолчанию: неизвестный вид действия jump",
      "Стоимость по умолчанию для click должна быть числом не меньше нуля",
    ]);
    expect(check(control({ settings: { otherRouteRating: 0 } })).errors).toEqual(["Оценка прочих путей должна быть больше 0 и не больше 1"]);
    expect(check(control({ settings: { otherRouteRating: 1.5 } })).errors).toEqual(["Оценка прочих путей должна быть больше 0 и не больше 1"]);
    expect(check(control({ settings: { otherRouteRating: 1 } })).errors).toEqual([]);
    expect(check(control({ stages: [{ id: "s", title: "Поиск" }, { id: "s", title: "Ещё раз" }, { id: "t", title: " " }] })).errors).toEqual([
      "Этап s объявлен дважды",
      "Этап t: нет названия",
    ]);
    const watch = control();
    watch.variants[0].device = "watch" as never;
    expect(check(watch).errors).toEqual(["Неизвестное устройство варианта watch"]);
    const narrow = control();
    narrow.variants[0].minViewportWidth = 0;
    expect(check(narrow).errors).toEqual(["Минимальная ширина окна должна быть больше нуля"]);
  });

  it("телефон: жесты проходят, сочетания клавиш и мышь — нет, действие зоны задаётся явно", () => {
    expect(check(withPhone(research(), "tap"))).toEqual({ errors: [], warnings: [] });

    expect(check(withPhone(research())).errors).toEqual([
      "Вариант «телефон»: Сцена «A»: зона go: на устройстве «телефон» действие зоны задаётся явно — click по умолчанию здесь не бывает",
    ]);

    expect(check(withPhone(research(), "dblclick")).errors).toEqual([
      "Вариант «телефон»: Сцена «A»: зона go: действие dblclick не бывает на устройстве «телефон»",
    ]);

    const keys = withPhone(research(), "tap");
    keys.variants[1].scenes[0].keys = [{ id: "find", keys: "Ctrl+F", effects: [{ goto: "b" }] }];
    expect(check(keys).errors).toEqual([
      "Вариант «телефон»: Сцена «A»: сочетание find: сочетаний клавиш не бывает на устройстве «телефон»",
    ]);

    const desktopKeys = research();
    desktopKeys.variants[0].scenes[0].keys = [{ id: "find", keys: "Ctrl+F", effects: [{ goto: "b" }] }];
    expect(check(desktopKeys)).toEqual({ errors: [], warnings: [] });
  });
});
```

Проверено на коде задачи 10 (коммит `79b9897d`): без двух правок выше падает ровно один тест — «телефон: жесты
проходят…»; с ними — 21 из 21, вместе с `tests/sim-validate.test.ts` и `tests/sim-scenario-archive.test.ts` — 44 из
44, `tsc` по `validate.ts` чист. Блок ловит четыре мутации кода: ошибки маршрутов не доходят до результата, отказ
перевода v1 потерян, нет предупреждения о пределе, `finishButton` игнорируется.

`npm test -- tests/sim-validate-v2.test.ts tests/sim-validate.test.ts tests/sim-scenario-archive.test.ts` — PASS.

- [ ] **Шаг 6. Коммит.**

```powershell
git add shared/sim/validate.ts tests/sim-validate.test.ts tests/sim-validate-v2.test.ts
git commit -m "feat(sim): проверки v2 — вид, концы, этапы, стоимость, устройство, маршруты, оптимум"
```

---

### Задача 11. Обложка, плеер, браузерный бандл

**Файлы:** изменить `shared/sim/cover.ts`, `shared/sim/player.ts`, `shared/sim/browser-entry.ts`,
`tests/sim-cover.test.ts`.

- [ ] **Шаг 1. Дописать в `tests/sim-cover.test.ts` падающие случаи.**

```ts
import { asScenario } from "@shared/sim/upgrade";

describe("обложка на v2", () => {
  it("снимок первой сцены берётся и из v2", () => {
    expect(simCoverShot(asScenario(example as never))).toBe(simCoverShot(example as never));
  });
  it("финал и «Я закончил» — задание завершено", () => {
    expect(simCoverState({ outcome: "finale" })).toBe("done");
    expect(simCoverState({ outcome: "declared" })).toBe("done");
  });
});
```

Если `simCoverShot`/`simCoverState` уже импортированы в файле, второй раз не импортировать.

- [ ] **Шаг 2.** `npm test -- tests/sim-cover.test.ts` — FAIL.

- [ ] **Шаг 3. `shared/sim/cover.ts`.**

Импорт: `import type { Scenario } from "./contract";` заменить на

```ts
import type { ScenarioInput } from "./upgrade";
import { playable, type PlayableScenario } from "./variant";
```

`simCoverState` — строка исхода «выполнено»:

```ts
  if (outcome === "success" || outcome === "partial" || outcome === "fail" || outcome === "finale" || outcome === "declared") return "done";
```

`simCoverShot`:

```ts
export function simCoverShot(scenario: ScenarioInput | PlayableScenario | null | undefined): string | null {
  if (!scenario) return null;
  let play: PlayableScenario;
  try {
    play = playable(scenario);
  } catch {
    return null;
  }
  const scene = play.scenes.find((s) => s.id === play.start) ?? play.scenes[0];
  const first = scene?.elements?.find((el) => !el.hidden) ?? scene?.elements?.[0];
  const media = first ? play.media.find((m) => m.id === first.media) : undefined;
  return media?.file ?? null;
}
```

`simRules` — первая строка тела и сигнатура:

```ts
export function simRules(scenario: ScenarioInput | PlayableScenario, penalties: SimPenalties | null): SimRules {
  const play = playable(scenario);
  const settings = play.settings;
```

В конце `simRules`: `description: play.meta?.title ?? ""`. Строку про штрафы показывать только контрольному:
`if (penalties && play.kind === "control") {`. Остальные тексты исследовательского сценария — эскизы П4, здесь не менять.

- [ ] **Шаг 4. `shared/sim/player.ts`.**

Найти `interface PlayerOptions` и заменить тип сценария, добавить устройство:

```ts
  /** The scenario of any version, or a device view. */
  scenario: ScenarioInput | PlayableScenario;
  /** The variant to play; desktop by default. */
  device?: Device;
```

Импорты: `Scenario` из `./contract` убрать (если больше не используется), добавить `type Device`,
`import type { ScenarioInput } from "./upgrade";`, `import { playable, type PlayableScenario } from "./variant";`.

В `mountPlayer`:

```ts
  const scenario = playable(options.scenario, options.device);
  const media = new Map<string, MediaItem>(scenario.media.map((m) => [m.id, m]));
  const fieldDefs = new Map(scenario.fields.map((f) => [f.id, f]));
  const run = createRun(scenario);
  const counters = scenario.settings.counters ?? {};
  const limitMs = scenario.settings.limitSeconds ? scenario.settings.limitSeconds * 1000 : null;
```

Найти объявление `TITLES` (запись по `Outcome`) и добавить два исхода:

```ts
  finale: "Задание завершено",
  declared: "Задание завершено",
```

В `showResult` перед веткой `timeout`:

```ts
    else if (result.outcome === "finale") text = result.finale ? result.finale.title + "." : "Задание завершено.";
    else if (result.outcome === "declared") text = "Вы завершили задание.";
```

Это временные тексты: окно результата исследовательского сценария рисуется в эскизах П4.

Остальные обращения `scenario.settings?.…` внутри `mountPlayer` заменить на `scenario.settings.…` по ошибкам `tsc`.

- [ ] **Шаг 5. `shared/sim/browser-entry.ts`:**

```ts
export { createRun } from "./engine";
export { mountPlayer, comboOf } from "./player";
export { diffScenes, appearSchedule } from "./diff";
export { asScenario } from "./upgrade";
export { SCENARIO_FORMAT, RESULT_FORMAT, CONTRACT_VERSION, RESULT_VERSION } from "./contract";
```

- [ ] **Шаг 6. Прогнать.**

```powershell
npm test -- tests/sim-cover.test.ts tests/sim-player-shadow-root.test.ts tests/sim-rules-dialog-theme.test.ts
```

Ожидается: PASS.

- [ ] **Шаг 7. Коммит.**

```powershell
git add shared/sim/cover.ts shared/sim/player.ts shared/sim/browser-entry.ts tests/sim-cover.test.ts
git commit -m "feat(sim): обложка и плеер читают сценарий любой версии через вид устройства"
```

---

### Задача 12. Сервер: чтение через `scenarioOf`, запись v2

**Файлы:** изменить перечисленные ниже; тест — `tests/sim-scenario-archive.test.ts`.

- [ ] **Шаг 1. Падающий тест в `tests/sim-scenario-archive.test.ts`** — в `describe` импорта архива:

```ts
  it("архив v1 сохраняется сценарием v2", async () => {
    const result = await importScenarioArchive(await referenceZip(), "owner", fakeRegistrar);
    expect(result.dataJson!.scenario.version).toBe(2);
    expect(result.dataJson!.scenario.variants[0].device).toBe("desktop");
  });
```

Имена `referenceZip` и регистратора медиа взять из соседних тестов файла (в файле они уже есть).

- [ ] **Шаг 2.** `npm test -- tests/sim-scenario-archive.test.ts` — FAIL (`version` 1).

- [ ] **Шаг 3. `server/services/sim/scenario-archive.ts`.**

Импорт: `import { asScenario } from "@shared/sim/upgrade";`. В `importScenarioArchive`:

```ts
  const scenario = structuredClone(asScenario(read.scenario as ScenarioInput)) as Scenario;
```

(и `import type { ScenarioInput } from "@shared/sim/upgrade";`). В `inspect`:
`summary: errors.length === 0 ? summarizeScenario(read.scenario as ScenarioInput) : null`.

В JSDoc модуля, после абзаца об импорте: «A version 1 archive is stored as version 2 (`shared/sim/upgrade`); the archive
offered for download is always version 2.»

- [ ] **Шаг 4. Места чтения сценария вопроса — заменить приведение типа на `scenarioOf`.** Везде добавить
  `import { scenarioOf } from "@shared/sim/upgrade";` и убрать ставший лишним импорт типа `Scenario`.

| Файл | Было | Стало |
| --- | --- | --- |
| `server/routes/attempts.ts:2138` | `const scenario = (q.dataJson as { scenario?: Scenario } \| null)?.scenario;` | `const scenario = scenarioOf(q.dataJson);` |
| `server/routes/questions.ts:261` | `const scenario = (q.dataJson as { scenario: Scenario }).scenario;` | `const scenario = scenarioOf(q.dataJson);` и сразу `if (!scenario) return null;`, а после `Promise.all` — `.filter(Boolean)` |
| `server/routes/questions.ts:514` | `const scenario = (question.dataJson as { scenario: Scenario }).scenario;` | `const scenario = scenarioOf(question.dataJson); if (!scenario) return res.status(422).json({ error: "Сценарий не читается" });` |
| `server/services/lms-export-import.ts:775` | `(q.dataJson as { scenario?: Scenario } \| null)?.scenario ?? null` | `scenarioOf(q.dataJson)` |
| `server/routes/analytics/question-answers.ts:190` | `(found.question.dataJson as { scenario?: Scenario } \| null)?.scenario` | `scenarioOf(found.question.dataJson)` |
| `server/routes/analytics/question-card.ts:96` | `(question.dataJson as { scenario?: Scenario } \| null)?.scenario` | `scenarioOf(question.dataJson)` |

Найти остальные места тем же поиском и поступить так же:

```powershell
Select-String -Path server\**\*.ts -Pattern "scenario\?*: Scenario" | Where-Object { $_.Path -notmatch "__tests__" }
```

- [ ] **Шаг 5. Сохранение вопроса пишет v2** — `server/routes/questions.ts`. Импорт
  `import { withCurrentScenario } from "@shared/sim/upgrade";`. После успешной проверки `scenarioError` (строки ~396 и ~594)
  нормализовать содержимое:

```ts
      const storedDataJson = isSimulation(type ?? "") ? withCurrentScenario(dataJson) : dataJson;
```

и в объекте, который уходит в хранилище (`questionInput` в POST, объект обновления в PUT), подставить `storedDataJson`
вместо `dataJson`. В PUT тип берётся как `type ?? existing.type`, а нормализуется только присланный `dataJson`
(`dataJson !== undefined`).

- [ ] **Шаг 6. Аналитика сценария — `server/services/analytics/simulation-stats.ts`.** Каждую экспортируемую функцию,
  принимающую `scenario: Scenario`, перевести на вход любой версии: параметр переименовать в `input: ScenarioInput` и
  первой строкой тела написать `const scenario = playable(input);`. Тело не меняется: у вида те же имена полей. Внутренние
  функции, которым передаётся `scenario`, получают тип `PlayableScenario`. Импорты:
  `import type { ScenarioInput } from "@shared/sim/upgrade";`, `import { playable, type PlayableScenario } from "@shared/sim/variant";`.
  Подсчёт исходов (`outcomes`), если он ключуется по `Outcome`, должен принять `finale` и `declared` — `tsc` укажет место;
  в разбивке исходов они идут отдельными ключами, их показ — П6.

  То же для `server/services/sim/imported-run.ts`: тип параметра `scenario: Scenario | null` → `ScenarioInput | null`.

- [ ] **Шаг 7. SCORM-пакет печёт v2** — `server/scorm/builders/test-json.ts`, строки 507 и 654:

```ts
            data: withCurrentScenario(withEffectiveMaxLength(q.type, q.dataJson, config.limits.shortAnswerMaxLength)),
```

Импорт `import { withCurrentScenario } from "@shared/sim/upgrade";`. Для не-сценариев функция возвращает содержимое тем
же объектом, поэтому их пакеты байт в байт прежние.

- [ ] **Шаг 8. Типы и тесты сервера.**

```powershell
npx tsc --noEmit --incremental false 2>&1 | Select-String "error TS" | Select-String "server"
npm test -- tests/sim-scenario-archive.test.ts tests/sim-analytics-stats.test.ts tests/sim-lms-protocol.test.ts server/services/__tests__/questions-import-simulation.test.ts
```

Ожидается: ошибок `tsc` в `server/` нет, тесты PASS. Найти серверные тесты сценария, которых нет в списке:
`Select-String -Path server\**\__tests__\*.ts,tests\*.ts -Pattern "simulation|scenario" -List | Select-Object Path` — и
прогнать их точечно.

- [ ] **Шаг 9. Коммит.**

```powershell
git add server tests/sim-scenario-archive.test.ts
git commit -m "feat(sim): сервер читает сценарий любой версии, пишет и печёт в пакет v2"
```

---

### Задача 13. Клиент

**Файлы:** изменить `client/src/features/tests/editor/sections/question-scoring-modal.tsx`,
`client/src/features/questions/scenario/scenario-run.tsx` и другие места, на которые укажет `tsc`.

- [ ] **Шаг 1. `question-scoring-modal.tsx`, `scenarioFacts`:**

```ts
function scenarioFacts(question: Question): string {
  const scenario = scenarioOf(question.dataJson);
  if (!scenario) return "";
  try {
    const s = summarizeScenario(scenario);
    return `Сценарий: ${plural(s.scenes, ["сцена", "сцены", "сцен"])}, ${plural(s.traps, ["ловушка", "ловушки", "ловушек"])}, ${plural(s.checks, ["проверка", "проверки", "проверок"])} цели. `;
  } catch {
    return "";
  }
}
```

Импорт `import { scenarioOf } from "@shared/sim/upgrade";`, лишний импорт `Scenario` убрать.

- [ ] **Шаг 2. `scenario-run.tsx`.** Тип пропа сценария — `ScenarioInput` (`import type { ScenarioInput } from "@shared/sim/upgrade";`).
  Строки 153–157 работают без изменений: `settings.limitSeconds` лежит в корне и у v1, и у v2. Тип `played` —
  `ScenarioInput`:

```ts
    const played: ScenarioInput =
      typeof limit === "number" && limit > 0 && (own === null || limit < own)
        ? ({ ...scenario, settings: { ...scenario.settings, limitSeconds: Math.floor(limit) } } as ScenarioInput)
        : scenario;
```

- [ ] **Шаг 3. Прочие места — по `tsc`.**

```powershell
npx tsc --noEmit --incremental false 2>&1 | Select-String "error TS"
```

Ожидается: ошибок нет. Каждое оставшееся место чтения `dataJson.scenario` на клиенте перевести на `scenarioOf`, тип
пропа `Scenario` у компонентов, получающих сценарий из вопроса, — на `ScenarioInput`.

- [ ] **Шаг 4. Коммит.**

```powershell
git add client
git commit -m "feat(sim): клиент читает сценарий любой версии"
```

---

### Задача 14. Пример, схемы и документы формата

**Файлы:** `docs/specs/sim-scenario/example/scenario.json`, `scenario.schema.json`, `result.schema.json`,
`exchange-format.md`, `result-format.md`; новый тест `tests/sim-example-v2.test.ts`.

- [ ] **Шаг 1. Перевести пример в v2 той же функцией, что и продукт.** Скрипт — в каталоге scratchpad, не в репозитории:

```ts
// <scratchpad>/upgrade-example.mts
import { readFileSync, writeFileSync } from "node:fs";
import { upgradeScenario } from "C:/Repositories/test-builder-sim-editor/shared/sim/upgrade.ts";

const path = "C:/Repositories/test-builder-sim-editor/docs/specs/sim-scenario/example/scenario.json";
const { scenario, notes } = upgradeScenario(JSON.parse(readFileSync(path, "utf8")));
if (notes.length) console.log(notes.join("\n"));
writeFileSync(path, JSON.stringify(scenario, null, 2) + "\n");
```

```powershell
npx tsx <scratchpad>\upgrade-example.mts
```

- [ ] **Шаг 2. Тест примера v2.**

```ts
/**
 * @module tests/sim-example-v2
 * @description The example of the exchange format is version 2 and passes the archive checks
 * clean, as its version 1 copy did.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { validateScenario, type ArchiveImage } from "@shared/sim/validate";

const ROOT = resolve(process.cwd(), "docs/specs/sim-scenario/example");

describe("пример формата обмена", () => {
  it("версия 2, проверка архива без ошибок и предупреждений", () => {
    const scenario = JSON.parse(readFileSync(resolve(ROOT, "scenario.json"), "utf8"));
    expect(scenario.version).toBe(2);
    const files = new Map<string, ArchiveImage>();
    for (const name of readdirSync(resolve(ROOT, "media"))) {
      const bytes = readFileSync(resolve(ROOT, "media", name));
      files.set(`media/${name}`, { path: `media/${name}`, byteSize: statSync(resolve(ROOT, "media", name)).size, format: "png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
    }
    expect(validateScenario(scenario, { mode: "archive", files })).toEqual({ errors: [], warnings: [] });
  });
});
```

`npm test -- tests/sim-example-v2.test.ts` — PASS.

- [ ] **Шаг 3. `scenario.schema.json` — версия 2.** Корень: `version` — `const: 2`; новое обязательное `kind`
  (`enum: ["control", "research"]`) и `variants` (массив `$defs/variant`, `minItems: 1`); из корня убрать `start` и
  `scenes`; добавить `goal` (`{ checks: [$defs/goalCheck] }`) и `stages` (массив `{ id, title }`). Новые `$defs`:
  `variant` (`device` enum `desktop`/`phone`, `stage` — `$defs/size`, `minViewportWidth`, `start`, `scenes`, `routes`),
  `route` (`id`, `title`, `rating` `exclusiveMinimum: 0`, `maximum: 1`, `keys` — массив `{ scene, action }`,
  `minItems: 1`), `sceneEnd` (`oneOf` трёх форм из `SceneEnd`), `actionCosts` (объект с ключами `ActionKind`, значения
  `minimum: 0`). У сцены `goal` и `views` заменить на `end` (`$defs/sceneEnd`) и `stage` (строка). У действия `role`
  убрать из `required`, добавить `cost` (`minimum: 0`); `action` — enum мыши и жестов. В `settings` убрать `stage` и
  `minViewportWidth`, добавить `finishButton`, `costs`, `otherRouteRating`. Каждое поле схемы сверить с
  `shared/sim/contract.ts` построчно: модуль обещает соответствие один к одному.

- [ ] **Шаг 4. `result.schema.json`.** `version` — `enum: [1, 2]`; `outcome` дополнить `finale`, `declared`; новые
  необязательные `variant`, `finale` (`{ scene, title, target }` или `null`), `cost` (`minimum: 0`); у события `action`
  `role` необязательна; события `goal` — необязательное `finale`; новое событие `{ t, type: "declare" }`.

- [ ] **Шаг 5. `exchange-format.md`.** Заголовок — «контракт сценария, версия 2»; раздел 4 переписать по разделу 1
  [v2-design.md](../specs/sim-scenario/v2-design.md): корень (таблица 4.1 с `kind`, `goal`, `stages`, `variants`),
  настройки (4.2 без `stage` и `minViewportWidth`, с `finishButton`, `costs`, `otherRouteRating`), новый подраздел
  «Вариант», сцена (`stage`, `end`), действие (`role` необязательна у `research`, `cost`, жесты), новый подраздел
  «Маршрут» с примером из v2-design §2.3, подраздел 4.10 «Телефон» — вариант `phone` вместо `views`. Раздел 5 — пункт
  про концы (`success`, `fail`, `finale`) и «Я закончил». Раздел 6 — проверки v2 (раздел 2.6 v2-design и новые ошибки
  задачи 10). Раздел 7 — версия 2 и правило чтения v1 (`shared/sim/upgrade`). Раздел 8 — строка решений 2026-10-16.

- [ ] **Шаг 6. `result-format.md`** — поля `variant`, `finale`, `cost`, исходы `finale`, `declared`, событие `declare`,
  буква `d` кодека и правило «версия 1, пока нет `d`».

- [ ] **Шаг 7. Проверить разметку.**

```powershell
node_modules\.bin\markdownlint-cli2.cmd docs/specs/sim-scenario/exchange-format.md docs/specs/sim-scenario/result-format.md docs/plans/PLAN_sim_v2_model.md
```

Ожидается: 0 замечаний.

- [ ] **Шаг 8. Коммит.**

```powershell
git add docs/specs/sim-scenario tests/sim-example-v2.test.ts
git commit -m "docs(sim): формат обмена и результата версии 2, пример переведён в v2"
```

---

### Задача 16. Фикстура сценария в тесте импорта выгрузки LMS

Дописано 2026-10-17 после волны 4 и выполняется до задачи 15. Регрессия П1, которую регрессионный набор не ловил:
`server/services/__tests__/lms-export-import.test.ts`, тест «доля цены — в баллы, прогон — повтором протокола», падает
на вершине волны 4 с «expected undefined to be 'exited'», а на `main` (`e524cf21`) зелёный.

**Причина — фикстура, а не код.** Сценарий в тесте записан без `format` и `version` — это не сценарий по контракту ни
одной версии. До П1 это никому не мешало: движок версию не смотрел. С П1 сценарий читается одной дверью
`scenarioOf` (задача 2), а она пускает только документ с `format: "skillum.sim-scenario"`. Импорт считает, что у
вопроса нет сценария, и сохраняет одни шаги `performance`. Дверь не ослабляется: в настоящих данных сценарий без
`format` не бывает — вопрос сохраняется только через `scenarioConfigError` (POST и PUT в `server/routes/questions.ts`),
а та без `format` и `version` не пропускает; перенос `.tbtest` везёт уже проверенное содержимое.

**Файл:** `server/services/__tests__/lms-export-import.test.ts`.

- [ ] **Шаг 1. Импорт** — после строки `import { buildImportPlan, runImport } from "../lms-export-import";`:

```ts
import { asScenario } from "@shared/sim/upgrade";
```

- [ ] **Шаг 2. Фикстура — настоящий сценарий версии 1**, такой, какие лежат в базе с прошлого выпуска. В блоке
  `describe("runImport — «Сценарий в ИС» (Э5б)", …)` заменить комментарий и первую строку объекта `scenario`:

```ts
  /**
   * Сценарий из одной сцены с одним шагом в сторону: щелчок по нему и выход. Версия 1 — так лежат вопросы,
   * сохранённые до версии 2, и импорт обязан читать их через перевод (`shared/sim/upgrade`).
   */
  const scenario = {
    format: "skillum.sim-scenario",
    version: 1,
    meta: { title: "Мини", task: "Задание" },
```

Остальные поля объекта (`settings`, `media`, `fields`, `start`, `scenes`) не менять.

- [ ] **Шаг 3. Два теста** — в конец того же `describe`, после теста «исход без доли цены — пробел, а не «неверно»»:

```ts
  it("вопрос, сохранённый версией 2, повторяется так же, как версии 1", async () => {
    const s = {
      ...storageStub(),
      getQuestionsByIds: async () => [{ id: "q1", type: "simulation", prompt: "Задание", topicId: "t1", dataJson: { scenario: asScenario(scenario as never) } }],
    };
    await runImport(simBook("0.75", "1;aside@3e8;x@3e8;z@0") as never, ON, ctx, s as never);
    const run = (s as unknown as { answers: Array<Array<Record<string, unknown>>> }).answers[0][0].userAnswerJson as { outcome: string; durationMs: number };
    expect(run.outcome).toBe("exited");
    expect(run.durationMs).toBe(2 * parseInt("3e8", 36));
  });

  it("сценарий не по контракту (без format) не читается: остаются шаги и предупреждение", async () => {
    const { format: _format, version: _version, ...broken } = scenario;
    const s = {
      ...storageStub(),
      getQuestionsByIds: async () => [{ id: "q1", type: "simulation", prompt: "Задание", topicId: "t1", dataJson: { scenario: broken } }],
    };
    const res = await runImport(simBook("0.75", "1;aside@3e8;x@3e8;z@0") as never, ON, ctx, s as never);
    expect((s as unknown as { answers: Array<Array<Record<string, unknown>>> }).answers[0][0]).toMatchObject({ userAnswerJson: steps });
    expect(res.warnings.join(" ")).toContain("Протоколов сценариев, не совпавших со сценарием вопроса: 1");
  });
```

- [ ] **Шаг 4. Прогнать.**

```powershell
npm test -- server/services/__tests__/lms-export-import.test.ts
```

Ожидается: PASS, 81 тест (было 79). Проверено 2026-10-17 на вершине волны 4 (`ef6fad84`): 81 из 81.

- [ ] **Шаг 5. Коммит.**

```powershell
git add server/services/__tests__/lms-export-import.test.ts
git commit -m "test(sim): фикстура импорта выгрузки LMS — настоящий сценарий версии 1, прогон и на версии 2"
```

Сверка за пределами регрессионного набора, 2026-10-17, на `ef6fad84`: все 99 тестовых файлов, где встречаются
`simulation`, `scenario` или `shared/sim/`, — 2105 из 2107. Второй красный —
`server/__tests__/test-transfer-completeness.test.ts` (таблица `test_public_links`): он красный и на `main`, к П1
не относится. Интеграционный `tests/it/sim-chain-roundtrip.it.test.ts` — зелёный. Файлы про сценарии, которые прошли
и не были в регрессионном наборе, добавлены в него (`scripts/sim/v2/tasks.json`, `regressionTests`).

### Задача 15. Сводная проверка

- [ ] **Шаг 1. Типы без общего кэша.** `npx tsc --noEmit --incremental false` — 0 ошибок.

- [ ] **Шаг 2. Все наборы сценария.**

```powershell
npm test -- tests/sim-upgrade.test.ts tests/sim-variant.test.ts tests/sim-costs.test.ts tests/sim-engine.test.ts tests/sim-engine-v2.test.ts tests/sim-replay-v2.test.ts tests/sim-optimum.test.ts tests/sim-routes.test.ts tests/sim-analysis.test.ts tests/sim-validate.test.ts tests/sim-validate-v2.test.ts tests/sim-cover.test.ts tests/sim-example-v2.test.ts tests/sim-scenario-archive.test.ts tests/sim-replay-scoring.test.ts tests/sim-lms-protocol.test.ts tests/sim-analytics-stats.test.ts tests/sim-field-stacking.test.ts tests/sim-player-shadow-root.test.ts tests/sim-rules-dialog-theme.test.ts tests/sim-router-items.test.ts tests/sim-geometry.test.ts
```

Ожидается: PASS.

- [ ] **Шаг 3. Паритет хостов и круговой тест цепочки.**

```powershell
npm test -- tests/sim-host-parity
npm run test:it -- tests/it/sim-chain-roundtrip.it.test.ts
```

Ожидается: PASS. Паритет собирает настоящий пакет: бандл `TBTemplate` пересобирается из `shared/sim`, так что зелёный
паритет — проверка и рантайма пакета на v2.

- [ ] **Шаг 4. Поиск забытых потребителей в тестах** (`tsc` их не видит):

```powershell
Select-String -Path tests\**\*.ts,client\src\**\__tests__\*.ts*,server\**\__tests__\*.ts -Pattern "\.goal\b|settings\.stage|createRun\(|summarizeScenario\(" | Select-Object Path -Unique
```

Каждый найденный файл прогнать точечно.

- [ ] **Шаг 5. Полный прогон — только с согласия владельца.** Спросить: «П1 готов, точечные наборы зелёные; можно
  запустить полный `npm test` (~8 минут)?». Без ответа «да» не запускать. В отчёте сказать, был ли полный прогон.

- [ ] **Шаг 6. Отчёт владельцу.** Что сделано по задачам 0–14, что проверено и чем, найденные расхождения примера
  (если задача 10, шаг 5 дала новое предупреждение), что не сделано по плану и почему.

/**
 * @module shared/sim/validate
 *
 * The import checks of a scenario (`docs/specs/sim-scenario/exchange-format.md`, section 6):
 * what makes a `scenario.json` unplayable or wrong, said in words an author can act on.
 *
 * Errors reject the import; warnings are reported and let it through. Messages name the scene by
 * its title and the element, field or zone by its id, so the author finds the place in the file.
 *
 * Two modes, one rule set:
 * - `archive` — a scenario read from an exchange archive: media paths are `media/<name>` and must
 *   be present among `files`, which carry what the server read from each image (type, size,
 *   pixel dimensions);
 * - `stored` — a scenario saved in a question: media paths are media-library addresses
 *   `/api/media/<id>`, and the files themselves are not at hand.
 *
 * Pure and framework-free: the server runs it on upload and on save, tests run it directly.
 *
 * Version 1 is checked as its upgrade: `liftV1` moves it into the version 2 shape without trusting
 * it, and every rule below runs on that shape. Messages about scenes, elements, fields and zones
 * are the same in both versions; a scenario with several variants prefixes them with the device.
 */
import { CONTRACT_VERSION, SCENARIO_FORMAT, type Condition, type Effect, type Scenario, type Size } from "./contract";
import { boundsOf, polygonProblem, type Point } from "./geometry";
import { cheapestPath } from "./optimum";
import { routeProblems } from "./routes";
import { liftV1, type ScenarioInput } from "./upgrade";
import { playable } from "./variant";

/** What the server read from one image of the archive. */
export interface ArchiveImage {
  /** Path inside the archive, `media/<name>`. */
  path: string;
  byteSize: number;
  /** Detected from the bytes, not from the extension; `null` — not an image we accept. */
  format: "png" | "jpeg" | "webp" | null;
  width?: number;
  height?: number;
}

/** Options of {@link validateScenario}. */
export interface ValidateOptions {
  mode: "archive" | "stored";
  /** `archive` mode: the images found in the archive, by path. */
  files?: Map<string, ArchiveImage>;
  /** Largest image accepted, bytes. Defaults to {@link MAX_IMAGE_BYTES}. */
  maxImageBytes?: number;
}

/** The verdict: errors reject the scenario, warnings do not. */
export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

/**
 * Largest single image of a scenario, bytes (exchange-format.md, section 3). The target stand
 * refuses uploads over 1 MB per file, and a package carries every image of a scenario.
 */
export const MAX_IMAGE_BYTES = 1024 * 1024;

/** Longest side of a scenario image, pixels (exchange-format.md, section 3). */
export const MAX_IMAGE_SIDE = 3840;

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KEYS = /^((Ctrl|Alt|Shift|Meta)\+)*([A-Z0-9]|F([1-9]|1[0-2])|Enter|Escape|Tab|Delete|Backspace|Space|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown)$/;
const ARCHIVE_MEDIA = /^media\/[A-Za-z0-9._-]+\.(png|jpe?g|webp)$/i;
const STORED_MEDIA = /^\/api\/media\/[A-Za-z0-9-]+$/;
const ROLES = new Set(["path", "alt", "detour", "trap", "neutral"]);
const SHAPES = new Set(["rect", "ellipse", "polygon"]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const MOUSE = new Set(["click", "dblclick", "rightclick", "hover", "drag"]);
const GESTURES = new Set(["tap", "doubletap", "longpress", "swipe-left", "swipe-right", "swipe-up", "swipe-down"]);
const DEVICE_ACTIONS: Record<string, Set<string>> = { desktop: MOUSE, phone: GESTURES };
const DEVICE_TITLES: Record<string, string> = { desktop: "десктоп", phone: "телефон" };
const COST_KINDS = new Set([...MOUSE, ...GESTURES, "key", "field"]);
const isCost = (v: unknown): boolean => isNum(v) && v >= 0;

/**
 * Check a scenario against the contract.
 *
 * @param input The parsed `scenario.json` — any value; the shape is checked here too.
 * @param options The mode and, for an archive, its images.
 * @returns Errors and warnings in Russian, in the order they were found.
 */
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
        // A keyboard shortcut needs a keyboard: only the desktop variant has one.
        if (v.device !== "desktop") errors.push(`${what}: сочетаний клавиш не бывает на устройстве «${DEVICE_TITLES[v.device]}»`);
      } else {
        checkShape(raw, size, what, errors);
        // Changed: the action must be one of the variant's device.
        if (raw.action !== undefined) {
          if (!(isStr(raw.action) && (MOUSE.has(raw.action) || GESTURES.has(raw.action)))) errors.push(`${what}: неизвестное действие ${String(raw.action)}`);
          else if (!v.actions.has(raw.action)) errors.push(`${what}: действие ${raw.action} не бывает на устройстве «${DEVICE_TITLES[v.device]}»`);
        } else if (role !== "neutral" && !v.actions.has("click")) {
          // The default action is a click; a device without a mouse has to name its gesture.
          errors.push(`${what}: на устройстве «${DEVICE_TITLES[v.device]}» действие зоны задаётся явно — click по умолчанию здесь не бывает`);
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

function sizeOf(v: unknown): Size | null {
  return isObj(v) && isNum(v.w) && isNum(v.h) && v.w > 0 && v.h > 0 ? { w: v.w, h: v.h } : null;
}

function num(v: unknown): number {
  return isNum(v) ? v : NaN;
}

function outside(b: { x: number; y: number; w: number; h: number }, size: Size): boolean {
  if (![b.x, b.y, b.w, b.h].every(Number.isFinite)) return true;
  return b.x < 0 || b.y < 0 || b.x + b.w > size.w || b.y + b.h > size.h;
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
}

function checkShape(z: Obj, size: Size | null, what: string, errors: string[]): void {
  const shape = z.shape === undefined ? "rect" : z.shape;
  if (!isStr(shape) || !SHAPES.has(shape)) { errors.push(`${what}: неизвестная форма ${String(shape)}`); return; }
  if (shape === "polygon") {
    if (["x", "y", "w", "h", "radius"].some((k) => k in z)) errors.push(`${what}: у многоугольника не бывает x, y, w, h и radius`);
    const points = arr(z.points);
    if (!points.every((p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]))) {
      errors.push(`${what}: вершины многоугольника — пары чисел [x, y]`);
      return;
    }
    const problem = polygonProblem(points as Point[]);
    if (problem) { errors.push(`${what}: многоугольник — ${problem}`); return; }
  } else {
    if (!isNum(z.x) || !isNum(z.y) || !isNum(z.w) || !isNum(z.h) || z.w <= 0 || z.h <= 0) {
      errors.push(`${what}: не задано место x, y, w, h`);
      return;
    }
    if (z.radius !== undefined) {
      if (shape !== "rect") errors.push(`${what}: скругление бывает только у прямоугольника`);
      else if (!isNum(z.radius) || z.radius < 0 || z.radius > Math.min(z.w, z.h) / 2) errors.push(`${what}: радиус скругления больше половины меньшей стороны`);
    }
  }
  if (size && outside(boundsOf(z as never), size)) errors.push(`${what} выходит за пределы сцены`);
}

interface Scope {
  scenes?: Map<string, Obj>;
  elements: Map<string, Obj>;
  fields: Map<string, Obj>;
}

/** Check one effect; answers the scene a `goto` leads to. */
function checkEffect(raw: unknown, scope: Scope, what: string, errors: string[]): string | null {
  if (!isObj(raw)) { errors.push(`${what}: эффект не объект`); return null; }
  const e = raw as Partial<Record<keyof Effect | "goto" | "show" | "hide" | "toggle" | "set" | "clear" | "value", unknown>>;
  if ("goto" in e) {
    if (!isStr(e.goto) || !scope.scenes?.has(e.goto)) { errors.push(`${what}: переход на несуществующую сцену ${String(e.goto)}`); return null; }
    return e.goto;
  }
  for (const k of ["show", "hide", "toggle"] as const) {
    if (k in e) {
      if (!isStr(e[k]) || !scope.elements.has(e[k] as string)) errors.push(`${what}: ${k} ${String(e[k])} — нет такого элемента на этой сцене`);
      return null;
    }
  }
  if ("set" in e || "clear" in e) {
    const f = "set" in e ? e.set : e.clear;
    if (!isStr(f) || !scope.fields.has(f)) errors.push(`${what}: поле ${String(f)} не объявлено`);
    if ("set" in e && !isStr(e.value)) errors.push(`${what}: set без строкового value`);
    return null;
  }
  errors.push(`${what}: неизвестный эффект ${Object.keys(e).join(", ") || "{}"}`);
  return null;
}

function checkCondition(raw: unknown, scope: Scope, what: string, errors: string[]): void {
  if (!isObj(raw)) { errors.push(`${what}: условие не объект`); return; }
  const c = raw as Partial<Record<string, unknown>> & Partial<Condition>;
  if ("filled" in c) {
    for (const f of arr(c.filled)) if (!isStr(f) || !scope.fields.has(f)) errors.push(`${what}: условие по необъявленному полю ${String(f)}`);
  } else if ("field" in c) {
    if (!isStr(c.field) || !scope.fields.has(c.field)) errors.push(`${what}: условие по необъявленному полю ${String(c.field)}`);
  } else if ("visible" in c) {
    if (!isStr(c.visible) || !scope.elements.has(c.visible)) errors.push(`${what}: условие visible ${String(c.visible)} — нет такого элемента на этой сцене`);
  } else if ("all" in c || "any" in c) {
    for (const sub of arr("all" in c ? c.all : c.any)) checkCondition(sub, scope, what, errors);
  } else if ("not" in c) {
    checkCondition(c.not, scope, what, errors);
  } else {
    errors.push(`${what}: неизвестное условие ${Object.keys(c).join(", ") || "{}"}`);
  }
}

function reach(start: string, graph: Map<string, Set<string>>): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    for (const next of graph.get(queue.shift()!) ?? []) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen;
}

/** The numbers the author sees on an accepted scenario. */
export interface ScenarioSummary {
  title: string;
  system: string | null;
  task: string;
  stage: Size | null;
  scenes: number;
  images: number;
  fields: number;
  traps: number;
  /** Field checks of the goal. */
  checks: number;
  /** The scenario's own time limit, seconds; `null` — none. */
  limitSeconds: number | null;
}

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

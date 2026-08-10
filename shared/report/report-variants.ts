/**
 * @module shared/report/report-variants
 *
 * PRD-27 Фаза 1 — контракт ВИДА отчёта в манифесте шаблона.
 *
 * Отчёт объявляется так же, как любой другой вариант экрана: записью
 * `manifest.contentTemplates[]`. Видов два и они РАЗНЫЕ, а не варианты одного:
 * `report` печатает баллы, `report.adaptive` — подтверждённые уровни, и вариант одного
 * режима нельзя выбрать для другого (PRD-27 D-5).
 *
 * Здесь же живут статические проверки, без которых макет отчёта заработал бы в
 * SCORM-пакете и сломался в браузере: CSS шаблона в пакете лежит в главном документе, а на
 * вебе внедряется внутрь Shadow DOM экрана, тогда как отчёт рендерится вне сцены (PRD-27
 * §6.3, риск R-1a). Поймать это ревью не может — только проверка.
 *
 * Чистый модуль: ни DOM, ни Node, ни файловой системы — вызывающий сам читает файлы.
 */

import { validateVariantFields, isSettingType, SETTING_TYPES } from "../template/field-types";
import { legacyChartKind, type ChartKindSettings } from "../template/scales-chart";
import { reportImageKeys, resolveReportImageValues } from "./report-assets";

/** Виды отчёта. Обычный режим и адаптивный — разные виды (D-5). */
export const REPORT_KINDS = ["report", "report.adaptive"] as const;

/** Вид отчёта. */
export type ReportKind = (typeof REPORT_KINDS)[number];

/** Корневой класс макета отчёта: он же префикс, которым скоупится CSS варианта (§6.3). */
export const REPORT_ROOT_CLASS = "tb-report";

/** Классы слоя сцены: экран фиксированного вьюпорта, для страницы A4 неприменимы (§6.3). */
const SCENE_CLASS_PREFIX = "tb-scene";

/**
 * Тип поля, недопустимый для отчёта: `sequence` — идентификатор последовательности
 * страниц прохождения (PRD-22), у отчёта последовательностей нет.
 */
const SETTING_TYPES_FORBIDDEN_IN_REPORT = new Set<string>(["sequence"]);

/** Объявление варианта отчёта (подмножество `contentTemplates[]`). */
export interface ReportVariantDecl {
  key: string;
  label?: string;
  kind: ReportKind;
  layoutFile?: string;
  styleFile?: string;
  isDefault?: boolean;
  settings?: unknown;
  placeholders?: unknown;
}

/** Проблема объявления варианта отчёта. */
export interface ReportVariantIssue {
  /** Ключ варианта, либо `#N`, когда ключа нет. */
  variantKey: string;
  /** Путь в манифесте/пакете, к которому относится замечание. */
  ref: string;
  message: string;
}

/** Является ли строка видом отчёта. */
export function isReportKind(value: unknown): value is ReportKind {
  return typeof value === "string" && (REPORT_KINDS as readonly string[]).indexOf(value) !== -1;
}

/** Вид отчёта, соответствующий режиму теста. */
export function reportKindForMode(mode: string | null | undefined): ReportKind {
  return mode === "adaptive" ? "report.adaptive" : "report";
}

/**
 * Варианты отчёта данного вида, объявленные манифестом, в порядке объявления.
 *
 * @param manifest Разобранный `manifest.json`.
 * @param kind Вид отчёта.
 */
export function reportVariants(manifest: unknown, kind: ReportKind): ReportVariantDecl[] {
  const list = (manifest as { contentTemplates?: unknown } | null)?.contentTemplates;
  if (!Array.isArray(list)) return [];
  return list.filter((raw): raw is ReportVariantDecl => {
    const v = (raw ?? {}) as { kind?: unknown; key?: unknown };
    return v.kind === kind && typeof v.key === "string" && v.key.length > 0;
  });
}

/**
 * Вариант, который получит тест: выбранный автором, иначе помеченный `isDefault`,
 * иначе первый объявленный. `null` — шаблон вида не объявил, и хост обязан
 * деградировать на макет «Стандартного» (FR-10).
 *
 * @param manifest Разобранный `manifest.json`.
 * @param kind Вид отчёта.
 * @param selectedKey Ключ, выбранный автором теста (`tests.report_settings_json`).
 */
export function resolveReportVariant(
  manifest: unknown,
  kind: ReportKind,
  selectedKey?: string | null,
): ReportVariantDecl | null {
  const list = reportVariants(manifest, kind);
  if (list.length === 0) return null;
  if (selectedKey) {
    const chosen = list.find((v) => v.key === selectedKey);
    if (chosen) return chosen;
  }
  return list.find((v) => v.isDefault === true) ?? list[0];
}

/**
 * Значения `settings[]` варианта: правки автора поверх `default` из манифеста.
 * Поле, которого вариант не объявляет, отбрасывается — так смена варианта не тащит
 * чужие значения (FR-14).
 *
 * Единственное исключение из «умолчание перекрывает пустоту» — вид диаграммы по шкалам:
 * см. {@link applyLegacyChartKind}.
 *
 * @param variant Объявление варианта.
 * @param authored Значения, сохранённые автором теста.
 */
export function resolveReportValues(
  variant: ReportVariantDecl | null,
  authored?: Record<string, unknown> | null,
): Record<string, unknown> {
  const declared = Array.isArray(variant?.settings) ? (variant?.settings as Array<Record<string, unknown>>) : [];
  const out: Record<string, unknown> = {};
  for (const field of declared) {
    const key = typeof field?.key === "string" ? field.key : "";
    if (!key) continue;
    const given = authored ? authored[key] : undefined;
    out[key] = given !== undefined && given !== null ? given : (field.default ?? "");
  }
  return applyLegacyChartKind(out, authored);
}

/**
 * Перенести галочку радара PRD-35 в новое поле вида диаграммы, пока автор его не трогал.
 *
 * Без этого умолчание манифеста (`none`) молча отменяло авторскую настройку: PRD-46 добавил
 * варианту отчёта поле `scalesChartKind`, у сохранённых раньше тестов его в значениях нет,
 * значит поле берёт умолчание — а явная строка старше булева флага, и диаграмма из отчёта
 * исчезала без единой правки автора. Экрана это не касалось: там нетронутое поле остаётся
 * ОТСУТСТВУЮЩИМ, и перенос делает сам `chartKindSetting`.
 *
 * Правило действует только когда вариант объявляет оба поля; выбранное автором «Не
 * показывать» остаётся в силе — это тронутое поле.
 *
 * @param values Значения, уже слитые с умолчаниями манифеста.
 * @param authored Значения, сохранённые автором.
 */
function applyLegacyChartKind(
  values: Record<string, unknown>,
  authored?: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!authored) return values;
  if (!Object.prototype.hasOwnProperty.call(values, "scalesChartKind")) return values;
  const carried = legacyChartKind(authored as ChartKindSettings);
  return carried ? { ...values, scalesChartKind: carried } : values;
}

/** Что нужно знать хосту, чтобы собрать отчёт выбранным вариантом (FR-22). */
export interface ReportBake {
  /** Выбранный вариант; `null` — шаблон видов не объявил, идёт деградация (FR-10/FR-15). */
  variantKey: string | null;
  /**
   * Выдавать ли отчёт обучающемуся (общая настройка теста, PRD-27 §7.1).
   *
   * Едет в пакет вместе с выбором вида, потому что в LMS кнопку рисует рантайм и другого
   * источника этого факта у него нет. Отсутствие = выдавать: пакеты, собранные до
   * настройки, обязаны сохранить кнопку.
   */
  enabled?: boolean;
  /**
   * Ключи полей-картинок варианта (FR-05). Хост инлайнит именно их в data-URL перед
   * растеризацией: растеризатор дозагружать ничего не станет, а незагруженная подложка
   * молча меняет PDF.
   */
  imageKeys: string[];
  /**
   * Ключ, под которым макет лежит у рантайма. Вариант называет свой файл (`layoutFile`),
   * и загрузчик пакета регистрирует его ПО ПУТИ; когда файла нет, остаётся канонический
   * ключ вида — тот самый, по которому работает деградация на «Стандартный».
   */
  layoutKey: string;
  /** Файл стиля варианта относительно каталога шаблона; `null` — своего стиля нет. */
  styleFile: string | null;
  /** Значения `settings[]`, уже слитые с умолчаниями манифеста. */
  values: Record<string, unknown>;
}

/**
 * Разрешить выбор автора против манифеста шаблона — ОДИН раз и в одном месте.
 *
 * Тем же вызовом пользуются сборщик пакета, веб-хост и отладчик: если каждый решал бы
 * сам, отчёт в LMS расходился бы с тем, что автор видел в предпросмотре.
 *
 * @param manifest Разобранный `manifest.json` активного шаблона.
 * @param kind Вид отчёта, отвечающий режиму теста.
 * @param branch Ветка `tests.report_settings_json` этого режима (может отсутствовать).
 * @param assetBase Где у ЭТОГО хоста лежат файлы шаблона, со слешем на конце
 *   (`template/` в пакете, `/api/templates/<id>/assets/` на вебе). Пути картинок из
 *   манифеста разрешаются против неё (FR-05); пустая база оставляет их как есть.
 */
export function resolveReportBake(
  manifest: unknown,
  kind: ReportKind,
  branch?: { variantKey?: string | null; values?: Record<string, unknown> | null } | null,
  assetBase = "",
): ReportBake {
  const variant = resolveReportVariant(manifest, kind, branch?.variantKey);
  const layoutFile = typeof variant?.layoutFile === "string" ? variant.layoutFile : "";
  const imageKeys = reportImageKeys(variant);
  const values = resolveReportValues(variant, branch?.values ?? null);
  return {
    variantKey: variant?.key ?? null,
    imageKeys,
    layoutKey: layoutFile || kind,
    styleFile: typeof variant?.styleFile === "string" && variant.styleFile ? variant.styleFile : null,
    values: assetBase ? resolveReportImageValues(values, imageKeys, assetBase) : values,
  };
}

/**
 * Ключи, которые ПЕРЕЖИВУТ смену варианта: объявлены обоими вариантами с одним типом
 * (FR-14). Всё прочее автор теряет, и интерфейс обязан назвать потери до сохранения.
 *
 * @param from Вариант, с которого уходят.
 * @param to Вариант, на который переходят.
 */
export function carriedOverSettingKeys(from: ReportVariantDecl | null, to: ReportVariantDecl | null): string[] {
  const typeOf = (v: ReportVariantDecl | null): Map<string, string> => {
    const map = new Map<string, string>();
    const list = Array.isArray(v?.settings) ? (v?.settings as Array<Record<string, unknown>>) : [];
    for (const f of list) {
      if (typeof f?.key === "string" && typeof f?.type === "string") map.set(f.key, f.type);
    }
    return map;
  };
  const a = typeOf(from);
  const b = typeOf(to);
  const out: string[] = [];
  for (const [key, type] of a) if (b.get(key) === type) out.push(key);
  return out;
}

/** Как проверяющий читает файлы пакета: `null`, когда файла нет. */
export interface ReportFileReader {
  (path: string): string | null;
}

/** Соответствует ли строка селектору, скоупленному в корневой класс отчёта. */
function selectorScoped(selector: string): boolean {
  return selector.includes("." + REPORT_ROOT_CLASS);
}

/** Селекторы верхнего уровня CSS (без содержимого правил и без @-блоков). */
function topLevelSelectors(css: string): string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  // Селектор — то, что стоит перед `{`. Внутренности правил и @-правила пропускаем:
  // проверяем именно то, чем автор адресует документ.
  const re = /(^|[};])\s*([^{}@;]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutComments)) !== null) {
    const raw = m[2].trim();
    if (raw) out.push(raw);
  }
  return out;
}

/**
 * Статические проверки объявленных вариантов отчёта (FR-25).
 *
 * Нарушение — блокирующая ошибка активации: несоответствие §6.3 не проявляется в
 * SCORM-пакете и всплывает только в браузере, то есть на живой приёмке.
 *
 * @param manifest Разобранный `manifest.json`.
 * @param readFile Чтение файла пакета. БЕЗ него проверяются только ОБЪЯВЛЕНИЯ —
 *   так вызывает активационный гейт, у которого файлов пакета нет (та же схема, что у
 *   проверки тем). Проверки макета и CSS в этом режиме пропускаются, а не считаются
 *   провалившимися: отсутствие файлов не улика.
 * @returns Список замечаний; пустой — вариантов отчёта нет либо всё в порядке.
 */
export function validateReportVariants(manifest: unknown, readFile?: ReportFileReader): ReportVariantIssue[] {
  const issues: ReportVariantIssue[] = [];
  const list = (manifest as { contentTemplates?: unknown } | null)?.contentTemplates;
  if (!Array.isArray(list)) return issues;

  const defaultsPerKind = new Map<ReportKind, number>();
  const seenPerKind = new Map<ReportKind, number>();

  list.forEach((raw, index) => {
    const v = (raw ?? {}) as Partial<ReportVariantDecl> & { kind?: unknown };
    if (!isReportKind(v.kind)) return;
    const kind = v.kind;
    const key = typeof v.key === "string" && v.key.length > 0 ? v.key : `#${index + 1}`;
    const at = (suffix: string) => `contentTemplates.${key}.${suffix}`;
    seenPerKind.set(kind, (seenPerKind.get(kind) ?? 0) + 1);
    if (v.isDefault === true) defaultsPerKind.set(kind, (defaultsPerKind.get(kind) ?? 0) + 1);

    if (typeof v.key !== "string" || v.key.length === 0) {
      issues.push({ variantKey: key, ref: at("key"), message: "вариант отчёта обязан иметь key" });
    }

    // Макет: у отчёта нет осмысленного общего макета, поэтому layoutFile обязателен.
    const layoutPath = typeof v.layoutFile === "string" ? v.layoutFile : "";
    if (!layoutPath) {
      issues.push({ variantKey: key, ref: at("layoutFile"), message: "вариант отчёта обязан объявить layoutFile" });
    } else if (readFile) {
      const layout = readFile(layoutPath);
      if (layout === null) {
        issues.push({ variantKey: key, ref: at("layoutFile"), message: `макет не найден в пакете: ${layoutPath}` });
      } else {
        if (!new RegExp(`\\bclass\\s*=\\s*["'][^"']*\\b${REPORT_ROOT_CLASS}\\b`).test(layout)) {
          issues.push({
            variantKey: key,
            ref: at("layoutFile"),
            message: `корневой элемент макета обязан нести класс "${REPORT_ROOT_CLASS}": им скоупится CSS отчёта`,
          });
        }
        if (new RegExp(`\\b${SCENE_CLASS_PREFIX}[a-z_-]*`).test(layout)) {
          issues.push({
            variantKey: key,
            ref: at("layoutFile"),
            message:
              `макет отчёта не вправе использовать классы слоя сцены ("${SCENE_CLASS_PREFIX}*"): ` +
              "сцена — экран фиксированного вьюпорта, а отчёт печатается на A4; " +
              "в пакете такой макет заработает, в браузере — нет",
          });
        }
      }
    }

    // Стили: только скоупленные в корневой класс, без обращений к документу.
    const stylePath = typeof v.styleFile === "string" ? v.styleFile : "";
    if (stylePath && readFile) {
      const css = readFile(stylePath);
      if (css === null) {
        issues.push({ variantKey: key, ref: at("styleFile"), message: `таблица стилей не найдена в пакете: ${stylePath}` });
      } else {
        for (const selector of topLevelSelectors(css)) {
          if (/(^|[\s,>+~])(:root|html|body)(?![\w-])/i.test(selector)) {
            issues.push({
              variantKey: key,
              ref: at("styleFile"),
              message: `селектор "${selector}" адресует документ; отчёт документом не является — тема приходит переменными на контейнер`,
            });
            continue;
          }
          if (!selectorScoped(selector)) {
            issues.push({
              variantKey: key,
              ref: at("styleFile"),
              message: `селектор "${selector}" не вложен в ".${REPORT_ROOT_CLASS}": стили отчёта обязаны быть скоуплены`,
            });
          }
        }
      }
    }

    // Поля: общий реестр типов плюс запрет неприменимых к отчёту.
    for (const issue of validateVariantFields(v)) {
      issues.push({ variantKey: key, ref: at(`${issue.list}.${issue.field}`), message: issue.message });
    }
    const settings = Array.isArray(v.settings) ? (v.settings as Array<Record<string, unknown>>) : [];
    settings.forEach((field, i) => {
      const type = field?.type;
      const label = typeof field?.key === "string" && field.key ? field.key : `#${i + 1}`;
      if (isSettingType(type) && SETTING_TYPES_FORBIDDEN_IN_REPORT.has(type)) {
        issues.push({
          variantKey: key,
          ref: at(`settings.${label}`),
          message:
            `тип "${type}" неприменим к отчёту; допустимы: ` +
            SETTING_TYPES.filter((t) => !SETTING_TYPES_FORBIDDEN_IN_REPORT.has(t)).join(", "),
        });
      }
    });
    if (Array.isArray(v.placeholders) && v.placeholders.length > 0) {
      issues.push({
        variantKey: key,
        ref: at("placeholders"),
        message: "у отчёта нет содержимого, которое читает обучающийся: placeholders неприменимы, используйте settings",
      });
    }
  });

  // Ровно один вариант по умолчанию на вид — иначе выбор «по умолчанию» неоднозначен.
  for (const [kind, count] of seenPerKind) {
    const defaults = defaultsPerKind.get(kind) ?? 0;
    if (count > 0 && defaults !== 1) {
      issues.push({
        variantKey: kind,
        ref: `contentTemplates.${kind}`,
        message:
          defaults === 0
            ? `вид "${kind}": ни один вариант не помечен isDefault`
            : `вид "${kind}": isDefault помечены ${defaults} варианта, допустим один`,
      });
    }
  }

  return issues;
}

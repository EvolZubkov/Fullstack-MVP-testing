/**
 * @module shared/report/report-document
 *
 * Разрешение ДОКУМЕНТА отчёта: манифест шаблона плюс строки теста дают упорядоченный
 * список блоков с раскладкой, значениями и признаком показа (PRD-51 §5.1).
 *
 * ОДНА функция на все три выдачи — PDF, SCORM-пакет и предпросмотр автора. Вторая
 * реализация означала бы, что автор согласовывает не тот документ, который получит
 * слушатель, а поймать такое расхождение можно только живой приёмкой.
 *
 * Все четыре правила разрешения защищают автора от молчаливой потери работы при смене
 * шаблона: строку не удаляют, новый блок не вставляют в середину чужого документа, а
 * исчезнувший вариант деградирует к умолчанию своего блока, а не роняет блок целиком.
 *
 * Чистый модуль: ни DOM, ни Node.
 */
import {
  reportBlockNature,
  MINIMUM_REPORT_DOCUMENT,
  REPORT_PAGE_BREAK_BLOCK,
  type ReportBlockNature,
} from "./report-blocks";
import {
  resolveReportBake,
  resolveReportDocumentDecl,
  REPORT_BLOCK_KIND,
  type ReportBake,
  type ReportKind,
  type ReportLabelLayers,
} from "./report-variants";

/** Строка документа, как её хранит тест (подмножество `report_blocks`). */
export interface ReportBlockRowInput {
  block: string;
  sortOrder: number;
  enabled: boolean;
  templateKey: string | null;
  valuesJson: Record<string, unknown>;
  settingsJson: Record<string, unknown>;
}

/** Объявление поля содержимого в том виде, в каком его читает рендерер. */
export interface ReportBlockPlaceholder {
  key: string;
  type: string;
}

/** Блок, готовый к печати. */
export interface ResolvedReportBlock {
  block: string;
  nature: ReportBlockNature;
  enabled: boolean;
  /** Путь раскладки; ПУСТ у разрыва листа — он не раскладка, а инструкция документу. */
  layoutFile: string;
  /** Объявление `placeholders[]` варианта — по нему рендерер заполняет области. */
  placeholders: ReportBlockPlaceholder[];
  values: Record<string, unknown>;
  settings: Record<string, unknown>;
  /**
   * Вариант, ВЫБРАННЫЙ автором; `null` — умолчание блока. Печати он не нужен (она уже
   * получила `layoutFile`), но нужен редактору: черновик обязан помнить выбор автора, а не
   * пересчитывать его из раскладки. Хранится РОВНО то, что пришло строкой, даже если такого
   * варианта шаблон больше не знает и печать деградировала к умолчанию: вернувшийся шаблон
   * вернёт автору его выбор.
   */
  templateKey: string | null;
  /**
   * Блок дописан разрешением, а не автором: шаблон объявил его после того, как документ был
   * собран (§5.1). Редактор метит такую строку — без метки она читается как забытая.
   */
  appended: boolean;
}

/** Разрешённый документ. */
export interface ResolvedReportDocument {
  blocks: ResolvedReportBlock[];
  /**
   * Блоки строк теста, которых текущий шаблон не объявляет: пропущены при печати, но
   * НЕ удалены из базы. Список нужен редактору, чтобы сказать об этом автору.
   */
  skipped: string[];
  /** Шаблон блоков не объявил — печатается цельная раскладка (§5.4). */
  monolithic: boolean;
}

/** Объявление варианта блока в манифесте (подмножество). */
export interface BlockVariant {
  key: string;
  block: string;
  kinds?: string[];
  layoutFile?: string;
  isDefault?: boolean;
  label?: string;
  /**
   * Чем этот вариант отличается от соседнего. Объявляет ШАБЛОН: варианты у него свои,
   * и только он знает, что печатает каждый. Палитра блоков показывает это описание при
   * выборе; отсутствует — печатается общая фраза про авторскую страницу.
   */
  description?: string;
  placeholders?: unknown;
}

/**
 * Варианты блоков, объявленные манифестом ДЛЯ ЭТОГО ВИДА отчёта.
 *
 * Отбор по виду обязателен: один и тот же блок печатается по-разному у обычного и
 * адаптивного отчёта — карточка темы говорит то процентами, то подтверждённым уровнем, —
 * и без отбора умолчанием блока стала бы та раскладка, что объявлена раньше. Вариант без
 * `kinds` служит всем видам: так объявлены блоки, у которых различий нет.
 *
 * Экспортируется ради редактора: палитра и список блоков обязаны предлагать РОВНО то, что
 * увидит рендерер. Второй отбор по своим правилам означал бы, что автор выбирает вариант,
 * которого печать не знает.
 */
export function blockVariants(manifest: unknown, kind: ReportKind): BlockVariant[] {
  const list = (manifest as { contentTemplates?: unknown[] } | null)?.contentTemplates;
  if (!Array.isArray(list)) return [];
  return list.filter((v): v is BlockVariant => {
    const raw = (v ?? {}) as { kind?: unknown; block?: unknown; key?: unknown; kinds?: unknown };
    if (raw.kind !== REPORT_BLOCK_KIND) return false;
    if (typeof raw.key !== "string" || !raw.key.length) return false;
    if (typeof raw.block !== "string" || !raw.block.length) return false;
    if (!Array.isArray(raw.kinds) || !raw.kinds.length) return true;
    return (raw.kinds as unknown[]).includes(kind);
  });
}

/** Поля содержимого варианта, приведённые к паре «ключ + тип». */
function placeholdersOf(variant: BlockVariant | undefined): ReportBlockPlaceholder[] {
  const raw = variant?.placeholders;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is { key: string; type?: unknown } => typeof (p as { key?: unknown })?.key === "string")
    .map((p) => ({ key: p.key, type: typeof p.type === "string" ? p.type : "text" }));
}

/**
 * Свести манифест и строки теста в документ.
 *
 * @param manifest Манифест активного шаблона.
 * @param kind Вид отчёта: `report` или `report.adaptive`.
 * @param rows Строки `report_blocks` теста для режима, в любом порядке.
 */
export function resolveReportDocument(
  manifest: unknown,
  kind: ReportKind,
  /** Строки теста; пусто/не передано — документ по умолчанию шаблона. */
  rows: readonly ReportBlockRowInput[] = [],
): ResolvedReportDocument {
  const variants = blockVariants(manifest, kind);
  const declared = resolveReportDocumentDecl(manifest, kind);
  // Документ объявляется НА ВИД, а варианты блоков общие для обоих. Поэтому решает
  // именно `declared`: вид, для которого состав не объявлен, живёт по прежнему контракту
  // и печатается цельной раскладкой (§5.4) — даже если соседний вид уже переехал на
  // блоки. Смотреть на наличие вариантов было бы ошибкой: шаблон, переведённый наполовину,
  // печатал бы у непереведённого вида пустой документ вместо своего макета.
  if (!declared.length) return { blocks: [], skipped: [], monolithic: true };

  const defaultOf = new Map<string, BlockVariant>();
  const byKey = new Map<string, BlockVariant>();
  for (const v of variants) {
    byKey.set(v.key, v);
    if (v.isDefault && !defaultOf.has(v.block)) defaultOf.set(v.block, v);
  }

  /**
   * Знает ли текущий шаблон этот блок. Разрыв листа знают все — раскладки у него нет, и
   * объявлять его шаблону нечем.
   */
  const known = (block: string): boolean =>
    block === REPORT_PAGE_BREAK_BLOCK || defaultOf.has(block);

  const build = (input: ReportBlockRowInput, appended = false): ResolvedReportBlock => {
    const nature = reportBlockNature(input.block);
    if (nature === "page-break") {
      return {
        block: input.block,
        nature,
        enabled: input.enabled,
        layoutFile: "",
        placeholders: [],
        values: {},
        settings: {},
        templateKey: null,
        appended,
      };
    }
    // Вариант, которого шаблон больше не объявляет, деградирует к умолчанию СВОЕГО блока:
    // автор терял бы блок целиком там, где на деле сменилось лишь его оформление.
    const chosen = (input.templateKey ? byKey.get(input.templateKey) : undefined) ?? defaultOf.get(input.block);
    return {
      block: input.block,
      nature,
      enabled: input.enabled,
      layoutFile: typeof chosen?.layoutFile === "string" ? chosen.layoutFile : "",
      placeholders: placeholdersOf(chosen),
      values: input.valuesJson ?? {},
      settings: input.settingsJson ?? {},
      // Именно строка, а не `chosen.key`: выбор автора переживает пропажу варианта из
      // шаблона, хотя печать на время этой пропажи деградирует к умолчанию блока.
      templateKey: input.templateKey ?? null,
      appended,
    };
  };

  /** Строка документа по умолчанию: всё включено, вариант — умолчание блока. */
  const defaultRow = (block: string, enabled: boolean): ReportBlockRowInput => ({
    block,
    sortOrder: 0,
    enabled,
    templateKey: null,
    valuesJson: {},
    settingsJson: {},
  });

  if (!rows.length) {
    // Документ по умолчанию — состав, объявленный шаблоном. Если шаблон его не объявил
    // (или всё объявленное ему самому неизвестно), берётся МИНИМАЛЬНЫЙ документ: пустой
    // отчёт не выдаётся никогда — лист без имени и без вердикта не годится ни на что.
    // Это граница умолчания, а не запрет: строки автора ниже уважаются как есть, включая
    // выключенный титул.
    const list = declared.filter(known);
    const base = list.length ? list : MINIMUM_REPORT_DOCUMENT.filter(known);
    return {
      blocks: base.map((block) => build(defaultRow(block, true))),
      skipped: [],
      monolithic: false,
    };
  }

  const ordered = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
  const skipped = ordered.filter((r) => !known(r.block)).map((r) => r.block);
  const blocks = ordered.filter((r) => known(r.block)).map((r) => build(r));

  // Блок, появившийся в шаблоне ПОСЛЕ того, как автор собрал документ, дописывается в
  // КОНЕЦ и ВЫКЛЮЧЕННЫМ: молча вставить в середину чужого документа новый раздел нельзя,
  // а потерять его — тоже, иначе автор о нём никогда не узнает.
  const present = new Set(ordered.map((r) => r.block));
  for (const block of declared) {
    if (present.has(block) || !known(block)) continue;
    blocks.push(build(defaultRow(block, false), true));
  }

  return { blocks, skipped, monolithic: false };
}

/** Что хост получает одним вызовом: оболочка со своими полями и разрешённый документ. */
export interface ReportBundle extends ReportBake {
  /**
   * Документ из блоков; `null` — шаблон блоков не объявил, и печатается цельная
   * раскладка `layoutKey` (§5.4). Проверять надо именно `null`, а не длину списка:
   * документ из нуля включённых блоков — законный результат авторской настройки.
   */
  document: ResolvedReportDocument | null;
}

/**
 * ОДИН вызов на хост: разрешить и оболочку, и документ (PRD-51 §5.3).
 *
 * Живёт здесь, а не рядом с {@link resolveReportBake}, чтобы не замкнуть кольцо импортов:
 * этот модуль уже зависит от `report-variants`, а обратная зависимость сделала бы пару
 * взаимной. Зависимость односторонняя — документ знает про вид отчёта, вид про документ
 * не знает.
 *
 * @param manifest Манифест активного шаблона.
 * @param kind Вид отчёта по режиму теста.
 * @param branch Ветвь `report_settings_json` этого режима: выбор оболочки и её поля.
 * @param rows Строки `report_blocks` теста для этого режима; пусто — документ по умолчанию.
 * @param assetBase База для картинок оболочки (см. `resolveReportBake`).
 * @param labelLayers Слои надписей PRD-49.
 */
export function resolveReportBundle(
  manifest: unknown,
  kind: ReportKind,
  branch?: { variantKey?: string | null; values?: Record<string, unknown> | null } | null,
  rows: readonly ReportBlockRowInput[] = [],
  assetBase = "",
  labelLayers?: ReportLabelLayers | null,
): ReportBundle {
  const bake = resolveReportBake(manifest, kind, branch, assetBase, labelLayers);
  const document = resolveReportDocument(manifest, kind, rows);
  return { ...bake, document: document.monolithic ? null : document };
}

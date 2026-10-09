/**
 * @module features/tests/editor/use-report-document
 *
 * ЧЕРНОВИК ДОКУМЕНТА ОТЧЁТА в редакторе теста (PRD-51 §7).
 *
 * Операции над списком блоков — ЧИСТЫЕ функции над массивом, без React. Их зовёт и
 * компонент списка, и сборка тела запроса, и предпросмотр; спрятать их в хук значило бы
 * закрыть от всех, кроме компонента, а проверять пришлось бы через отрисовку.
 *
 * Порядок в массиве И ЕСТЬ порядок печати. Отдельного поля порядка в черновике нет
 * намеренно: второй источник истины о порядке рано или поздно разошёлся бы с первым, и
 * спорить с ними было бы нечем. Номер выводится один раз, при сборке строк для сервера
 * ({@link toRowInputs}).
 *
 * Каждая операция возвращает НОВЫЙ массив и не трогает вход: черновик редактора
 * сравнивается по ссылке, и правка на месте не вызвала бы перерисовки.
 */
import {
  resolveReportDocument,
  type ReportBlockRowInput,
  type ResolvedReportBlock,
} from "@shared/report/report-document";
import type { ReportKind } from "@shared/report/report-variants";

/** Блок документа, каким его держит черновик редактора. */
export interface DraftBlock {
  /** Ключ блока из реестра продукта (`shared/report/report-blocks`). */
  block: string;
  /** Выбранный вариант шаблона; `null` — умолчание блока для этого вида отчёта. */
  templateKey: string | null;
  /** Показывать ли блок. Системный блок гасится этим признаком, а не удалением. */
  enabled: boolean;
  /** Содержимое: значения `placeholders[]` варианта. */
  values: Record<string, unknown>;
  /** Свойства: значения `settings[]` варианта. */
  settings: Record<string, unknown>;
  /**
   * Блок дописан в конец РАЗРЕШЕНИЕМ документа: шаблон объявил его после того, как автор
   * собрал свой (§5.1). Признак выводится при загрузке и в базу не сохраняется — он живёт
   * ровно до тех пор, пока автор не решит судьбу блока: включить или удалить.
   */
  appended?: boolean;
}

/**
 * Переместить блок на одну позицию.
 *
 * @param blocks Текущий документ.
 * @param index Позиция блока.
 * @param delta `-1` вверх, `+1` вниз.
 * @returns Новый документ. Выход за границы списка — документ БЕЗ изменений, а не
 *   молчаливое зацикливание: автор, упёршийся в край, ждёт, что ничего не произойдёт.
 */
export function moveBlock(blocks: readonly DraftBlock[], index: number, delta: number): DraftBlock[] {
  const target = index + delta;
  if (index < 0 || index >= blocks.length || target < 0 || target >= blocks.length) {
    return [...blocks];
  }
  const next = [...blocks];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

/** Переключить показ блока. Строка остаётся на месте — гаснет только печать. */
export function toggleBlock(blocks: readonly DraftBlock[], index: number): DraftBlock[] {
  return blocks.map((b, i) => (i === index ? { ...b, enabled: !b.enabled } : b));
}

/**
 * Вставить блок НА МЕСТО, откуда его добавили.
 *
 * @param at Позиция, перед которой встаёт новый блок; кнопка-вставка между строками
 *   передаёт индекс строки под собой.
 */
export function insertBlock(blocks: readonly DraftBlock[], at: number, block: DraftBlock): DraftBlock[] {
  const next = [...blocks];
  next.splice(Math.max(0, Math.min(at, next.length)), 0, block);
  return next;
}

/** Удалить блок вместе с его содержимым. Системным блокам эта операция не предлагается. */
export function removeBlock(blocks: readonly DraftBlock[], index: number): DraftBlock[] {
  return blocks.filter((_, i) => i !== index);
}

/** Разрешённый блок в форме черновика редактора. */
function draftOf(block: ResolvedReportBlock): DraftBlock {
  return {
    block: block.block,
    templateKey: block.templateKey,
    enabled: block.enabled,
    values: block.values,
    settings: block.settings,
    ...(block.appended ? { appended: true } : {}),
  };
}

/**
 * Собрать НАЧАЛЬНЫЙ черновик документа: сохранённые строки теста плюс правила §5.1.
 *
 * Зовётся ОДИН раз на загрузку, а не на каждую правку. Разрешение дописывает в конец блоки,
 * которых в строках нет, и пропускает те, которых шаблон не знает; примени его к каждому
 * изменению — оно спорило бы с автором на каждом нажатии, возвращая только что убранное.
 *
 * @returns `null` — шаблон блоков не объявил: он печатает цельную раскладку, и собирать в
 *   нём нечего (§5.4). Это НЕ то же, что пустой список: пустой список — законный документ.
 */
export function initialReportDraft(
  manifest: unknown,
  kind: ReportKind,
  saved: readonly DraftBlock[] = [],
): DraftBlock[] | null {
  const resolved = resolveReportDocument(manifest, kind, toRowInputs(saved));
  return resolved.monolithic ? null : resolved.blocks.map(draftOf);
}

/**
 * Привести черновик к строкам, которые понимают разрешение документа и сервер.
 *
 * Здесь и ТОЛЬКО здесь появляется `sortOrder` — выведенный из позиции. Сервер его от
 * клиента не принимает по той же причине (см. план Э3, задача 3).
 */
export function toRowInputs(blocks: readonly DraftBlock[]): ReportBlockRowInput[] {
  return blocks.map((b, i) => ({
    block: b.block,
    sortOrder: i,
    enabled: b.enabled,
    templateKey: b.templateKey,
    valuesJson: b.values,
    settingsJson: b.settings,
  }));
}

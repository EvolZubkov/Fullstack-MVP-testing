/**
 * @module features/questions/sanitize-report
 *
 * Перевод находок санитайзера в слова, которыми о них говорят автору задания
 * (согласованный эскиз `prd57-question-text.html`, состояние `s-diag`).
 *
 * Санитайзер называет свои правила по-своему: `external src/href`, `onclick`, `<script>` —
 * это метки движка, а не речь. Автору нужно другое: что именно исчезло из ЕГО текста и
 * сколько раз. Отсюда два свойства модуля.
 *
 * Первое: находка печатается ЧИСЛОМ. «Часть разметки удалена» не даёт понять, потерял ли
 * автор один забытый обработчик или половину вставленного фрагмента.
 *
 * Второе: имя правила остаётся в тексте как есть, машинным написанием в `<code>`. Его
 * перевод («сценарий», «обработчик щелчка») автор не сможет найти в своём тексте, а именно
 * это ему и предстоит сделать.
 *
 * Чистый модуль без React: вид баннера собирает ящик, а слова проверяются тестом.
 */
import type { SanitizeRemoval } from "@shared/security/html-sanitize";

/** Одна находка в виде, готовом к печати: «обработчик <code>onclick</code> — 2». */
export interface RemovalPhrase {
  /** Слово перед именем правила; пустое, когда имя говорит само за себя. */
  prefix: string;
  /** Имя правила машинным написанием — тем, которое автор найдёт в своём тексте. */
  code: string;
  /** Сколько раз правило сработало. */
  count: number;
}

/** Метка санитайзера для внешнего адреса — одна на `src` и на `href`. */
const EXTERNAL_URI_LABEL = "external src/href";

/**
 * Назвать находки словами.
 *
 * @param removed Находки санитайзера за одно сохранение.
 * @returns Находки в порядке, в котором их вернул санитайзер; пустой список — терять нечего.
 */
export function removalPhrases(removed: readonly SanitizeRemoval[] | undefined): RemovalPhrase[] {
  if (!Array.isArray(removed)) return [];
  return removed
    .filter((removal) => removal && typeof removal.label === "string" && removal.count > 0)
    .map((removal) => ({ ...describe(removal), count: removal.count }));
}

/** Приставка и машинное имя одной находки. */
function describe(removal: SanitizeRemoval): { prefix: string; code: string } {
  if (removal.kind === "attribute") return { prefix: "обработчик", code: removal.label };
  if (removal.kind === "uri") {
    if (removal.label === EXTERNAL_URI_LABEL) return { prefix: "внешний", code: "src/href" };
    return { prefix: "адрес", code: removal.label };
  }
  // Тег и всё незнакомое печатаются как есть: выдумывать название правилу, которого этот
  // модуль не знает, значит однажды сказать автору неправду.
  return { prefix: "", code: removal.label };
}

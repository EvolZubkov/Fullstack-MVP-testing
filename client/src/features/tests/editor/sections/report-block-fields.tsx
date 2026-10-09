/**
 * @module features/tests/editor/sections/report-block-fields
 * @description ПОЛЯ РАСКРЫТОЙ СТРОКИ авторской страницы документа (PRD-51 §7.2, FR-17).
 *
 * Эскиз: `docs/wireframes/prd51-report-document.html`, состояние `s-row-expanded`. Форма —
 * тот же `page-row-expand`, что у страницы во вкладке «Структура», и контрол поля тот же
 * ({@link PlaceholderControl}): второй способ вводить заголовок и текст автору не нужен, а
 * второй КОНТРОЛ разошёлся бы с первым на первой же правке режимов ввода или очистки.
 *
 * Состав полей объявляет ВАРИАНТ блока, а не продукт: «Три колонки» и «Текст и картинка» —
 * разные наборы, и знать их наперёд нельзя. Вариант без единого поля показывает не пустую
 * форму, а объяснение: раскладка, которой нечего сказать, выглядит как сломанная.
 */
import type { ContentTemplatePlaceholder } from "../use-content-pages";
import { PlaceholderControl } from "./placeholder-control";
import type { DraftBlock } from "../use-report-document";

export interface ReportBlockFieldsProps {
  block: DraftBlock;
  /** Поля варианта в порядке объявления шаблоном. */
  placeholders: ContentTemplatePlaceholder[];
  onChange: (next: DraftBlock) => void;
  readOnly?: boolean;
  index: number;
}

/** Начертания полей: живут рядом со значениями, как и у страницы «Структуры». */
type Styles = Record<string, { fontSize?: number }>;

export function ReportBlockFields(props: ReportBlockFieldsProps) {
  const { block, placeholders, index } = props;
  const values = block.values ?? {};
  const styles = (values.placeholderStyles ?? {}) as Styles;

  const write = (nextValues: Record<string, unknown>) =>
    props.onChange({ ...block, values: nextValues });

  return (
    <div className="page-row-expand" data-testid={`report-document-edit-${index}`}>
      {placeholders.length === 0 ? (
        <p className="ou-formfield__desc" data-testid={`report-document-edit-empty-${index}`}>
          У этого варианта нет полей: он печатает данные попытки, а не авторский текст.
        </p>
      ) : (
        <fieldset
          disabled={props.readOnly}
          className="page-row-expand__fields"
          data-testid={`report-document-edit-fields-${index}`}
        >
          {placeholders.map((ph) => (
            <div className="ou-formfield" key={ph.key}>
              <PlaceholderControl
                placeholder={ph}
                value={values[ph.key]}
                style={styles[ph.key]}
                onChange={(v) => write({ ...values, [ph.key]: v })}
                onStyleChange={(s) =>
                  write({ ...values, placeholderStyles: { ...styles, [ph.key]: s } })
                }
                testId={`report-document-field-${index}-${ph.key}`}
              />
            </div>
          ))}
        </fieldset>
      )}
    </div>
  );
}

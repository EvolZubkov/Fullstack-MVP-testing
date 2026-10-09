/**
 * @module client/src/features/tests/editor/field-errors
 * @description Per-field lookup over {@link ValidationIssue}s so section
 * components can mark the exact offending input as invalid (FR-20c). The test
 * editor validates the whole model centrally; this index lets each section
 * surface the relevant message on its own controls without re-validating.
 */
import type { ValidationIssue } from "./test-editor.types";

/**
 * Read-only index of validation issues keyed by field path. Built once per
 * validation pass and passed down to section components.
 */
export interface FieldErrorIndex {
  /**
   * First error message for an exact field path (e.g. `sections[0].drawCount`),
   * or `undefined` when the field has no error. Feed straight into a control's
   * `error` prop.
   */
  get(field: string): string | undefined;
  /**
   * `true` when the field itself or any descendant path has an error. Use for
   * container-level affordances (e.g. flag a topic row when any of its inputs
   * err): `has("sections[0]")` matches `sections[0].drawCount`.
   */
  has(field: string): boolean;
}

/**
 * Builds a {@link FieldErrorIndex} from a validation pass. Only `error`
 * severity issues are indexed — warnings never block or highlight a field.
 * On duplicate field paths the first message wins (validation pushes the most
 * specific issue first).
 */
export function buildFieldErrorIndex(issues: ValidationIssue[]): FieldErrorIndex {
  const byField = new Map<string, string>();
  for (const issue of issues) {
    if (issue.severity !== "error") continue;
    if (!byField.has(issue.field)) byField.set(issue.field, issue.message);
  }

  return {
    get: (field) => byField.get(field),
    has: (field) => {
      if (byField.has(field)) return true;
      for (const key of byField.keys()) {
        if (key.startsWith(`${field}.`) || key.startsWith(`${field}[`)) return true;
      }
      return false;
    },
  };
}

/**
 * Событие «к этому месту идёт переход — раскройся».
 *
 * `goToError` шлёт его на якоре поля, и оно ВСПЛЫВАЕТ: каждая сворачиваемая карточка
 * на пути слышит его и открывается, поэтому вложенность разбирается сама, без знания
 * о том, кто внутри кого лежит.
 *
 * Явное событие, а не догадка по DOM, потому что тело свёрнутой карточки остаётся в
 * разметке — её прячет CSS. Значит и «точный» якорь находится, и `focus()` на нём
 * молча не срабатывает: до этого автор нажимал «Перейти к ошибкам» и не двигался
 * никуда, а ошибка оставалась невидимой.
 */
export const REVEAL_EVENT = "tb:reveal";

/** Empty index — used as a safe default when a section receives no errors. */
export const EMPTY_FIELD_ERRORS: FieldErrorIndex = {
  get: () => undefined,
  has: () => false,
};

/**
 * Худший уровень проблемы по адресу поля или по любому вложенному в него.
 *
 * Нужен рейлу: точка на пункте подраздела показывает ХУДШИЙ уровень внутри него, а
 * `FieldErrorIndex` знает только ошибки — предупреждения в него намеренно не попадают,
 * чтобы не подсвечивать поле красным из-за замечания (контракт «Индикация проблем»).
 *
 * @param issues Все находки проверки: и ошибки, и предупреждения.
 * @returns Функция «адрес -> уровень»; `undefined` — внутри чисто.
 */
export function buildIssueLevel(
  issues: ValidationIssue[],
): (field: string) => "error" | "warning" | undefined {
  const covers = (issueField: string, field: string) =>
    issueField === field ||
    issueField.startsWith(`${field}.`) ||
    issueField.startsWith(`${field}[`);
  return (field) => {
    let worst: "error" | "warning" | undefined;
    for (const issue of issues) {
      if (!covers(issue.field, field)) continue;
      if (issue.severity === "error") return "error";
      worst = "warning";
    }
    return worst;
  };
}

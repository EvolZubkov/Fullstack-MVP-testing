/**
 * @module features/analytics/test/no-value
 * @description Э4а UX-аудита аналитики: пустое значение — одно на все таблицы и плитки аналитики.
 *
 * В одной колонке встречалось до четырёх разных пустых значений: «—», «мало данных», пустая
 * ячейка и подставленный ноль. Читатель не мог отличить «величины у вопроса нет» от «пока не
 * набралось» и от «ноль». Остались три вида и больше никаких:
 *   - «не применимо» — величина у вопроса не определена (у развёрнутого ответа нет оценки),
 *     причина — в подсказке;
 *   - «мало данных» и под ним «ещё N» — сколько не хватает до порога; подсказка называет порог и
 *     сколько собрано;
 *   - ноль — обычным числом, этим компонентом не рисуется.
 */
import { Stack, Text } from "@skillum/ui-kit";

import { GLOSSARY, insufficientHint } from "../glossary";
import { FloatingHint } from "./floating-hint";

/** Свойства пустого значения. */
export type NoValueProps =
  | { kind: "notApplicable"; reason?: string; align?: "center" | "start" }
  | {
    kind: "insufficient";
    /** Порог наблюдений, с которого величина появится. */
    need: number;
    /** Сколько собрано. */
    have: number;
    align?: "center" | "start";
  };

/**
 * Пустое значение с причиной в подсказке.
 *
 * @param props - вид, порог и собранное либо причина
 * @returns слово, при «мало данных» — с числом недостающих наблюдений
 */
export function NoValue(props: NoValueProps) {
  const align = props.align === "start" ? "start" : "center";
  if (props.kind === "notApplicable") {
    return (
      <FloatingHint content={props.reason ?? GLOSSARY.notApplicable.hint} className="tb-no-value">
        <Text variant="body-s" tone="muted">{GLOSSARY.notApplicable.term}</Text>
      </FloatingHint>
    );
  }
  const missing = Math.max(0, props.need - props.have);
  return (
    <FloatingHint content={insufficientHint(props.need, props.have)} className="tb-no-value">
      <Stack gap={1} align={align}>
        <Text variant="body-s" tone="muted">мало данных</Text>
        <Text variant="body-xs" tone="muted">{`ещё ${missing}`}</Text>
      </Stack>
    </FloatingHint>
  );
}

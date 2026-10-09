/**
 * @module features/questions/answer-rules/answer-rules-block
 *
 * The «Проверка ответа» block of the question drawer (PRD-57 §6.1), shown instead of the
 * option list for a typed answer. Layout follows the approved wireframe
 * `docs/wireframes/approved/prd57-answer-rule.html` (state `k-list`) one element at a
 * time; the editing rules live in {@link module:features/questions/answer-rules/answer-rules-model}.
 *
 * It lives in its own file rather than inside `question-editor-drawer`: that file is
 * already past 1200 lines, and the rule set is the one part of a typed answer that grows
 * with every stage of the track — the numeric operators of Э5, the probe of Э6, the
 * expression panel and its measurement of Э7 all landed here.
 *
 * Not here yet, on purpose: the blanks of Э8, which bring their own rule set per blank.
 */
import { Accordion, AccordionItem, Banner, Button, Input, SegmentedControl, Select, Switch, Tag } from "@skillum/ui-kit";
import { Plus, Trash2 } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";

import {
  checkRuleSet,
  DEFAULT_WARN_MS,
  parseNumericAnswer,
  simplifyExpression,
  type AnswerRuleSet,
  type NumericOp,
  type NumericRule,
  type TextRule,
} from "@shared/answer-check";
import { measureExpression, type Measurement } from "./measure-expression";
import { RegexBar } from "./regex-bar";
import {
  describeNumericRule,
  describeProbe,
  formatRuleNumber,
  hasTolerance,
  numericRuleTitle,
  NUMERIC_OPERATORS,
} from "@shared/answer-check/describe";
import {
  addRule,
  createDraft,
  removeRule,
  setAutoCheck,
  setJoin,
  setUnit,
  switchKind,
  toCorrectJson,
  updateRule,
  type AnswerRulesDraft,
} from "./answer-rules-model";

export interface AnswerRulesBlockProps {
  /** Current draft; the drawer owns it so a type switch does not reset the editing state. */
  draft: AnswerRulesDraft;
  onChange: (draft: AnswerRulesDraft) => void;
  /**
   * PRD-57 FR-28v: how many characters the learner may type. `undefined` means the
   * installation's ceiling applies — a property of the QUESTION, not of the rule set,
   * which is why it travels beside the draft rather than inside it.
   */
  maxLength?: number;
  onMaxLength?: (value: number | undefined) => void;
  /**
   * PRD-57 FR-24c: тот же блок обслуживает и КОРОТКИЙ ОТВЕТ, и каждый ПРОПУСК.
   *
   * У пропуска нет ни своего предела длины (он свойство задания), ни тумблера проверки:
   * пропуск без правил — это не «собираем текст», а несделанная работа, о которой список
   * говорит отдельной пометкой. Поэтому вариант убирает ровно эти два элемента и ничего
   * больше: остальное — вид ответа, связка, правила, проба — у них общее до буквы.
   */
  variant?: "question" | "blank";
}

/** Summary line of a collapsed rule — «что правило проверяет» (FR-28b). */
function ruleTitle(rule: TextRule | NumericRule, unit: string): string {
  if (rule.kind === "number") return numericRuleTitle(rule, unit);
  return rule.value.trim() === "" ? "Правило не заполнено" : rule.value;
}

/** Subtitle of a collapsed rule — HOW it compares. */
function ruleSubtitle(rule: TextRule | NumericRule): string {
  if (rule.kind === "number") return "Сравнение числа";
  return rule.match === "regex" ? "Регулярное выражение" : "Обычное сравнение";
}

export function AnswerRulesBlock({
  draft,
  onChange,
  maxLength,
  onMaxLength,
  variant = "question",
}: AnswerRulesBlockProps) {
  const forBlank = variant === "blank";
  const rules = (draft.answerKind === "number" ? draft.number : draft.text) as Array<TextRule | NumericRule>;
  const saved: AnswerRuleSet = toCorrectJson(draft);
  // PRD-57 FR-28h: проба живёт ЗДЕСЬ, а не в черновике. `toCorrectJson` её не видит,
  // поэтому попасть в задание она не может ни при какой правке.
  const [probe, setProbe] = useState("");
  // Вердикт считает тот же движок, что и попытка: вторая «как бы проверка» для автора
  // обещала бы одно, а прохождение делало бы другое.
  // `skipSlow` здесь — защита АВТОРА: выражение, которое замер уже назвал долгим, в
  // ящике не запускается, иначе проба подвесила бы вкладку ровно на то время, о котором
  // предупреждение и говорит. Такое правило проба честно называет непроверенным.
  const outcome =
    probe.trim() === "" || saved.rules.length === 0
      ? null
      : checkRuleSet(saved, probe, undefined, { skipSlow: true });

  return (
    <div className="tb-rules" data-testid="answer-rules-block">
      {forBlank ? null : (
      <div className="ou-formfield">
        <span className="ou-formfield__lbl">Предел длины ответа</span>
        <Input
          size="m"
          value={maxLength === undefined ? "" : String(maxLength)}
          onChange={(e) => {
            // Пустое поле — это «системный предел», а не ноль: ноль запретил бы ответ вовсе.
            const raw = e.target.value.trim();
            if (raw === "") return onMaxLength?.(undefined);
            const parsed = Number(raw);
            onMaxLength?.(Number.isInteger(parsed) && parsed > 0 ? parsed : undefined);
          }}
          data-testid="answer-rules-max-length"
        />
        <span className="ou-formfield__desc">
          До скольких символов участник может ответить. Пусто — системный предел.
        </span>
      </div>
      )}

      {forBlank ? null : (
      <div className="ou-formfield">
        <span className="ou-formfield__lbl">Проверка ответа</span>
        <Switch
          size="m"
          checked={draft.autoCheck}
          onChange={(e) => onChange(setAutoCheck(draft, e.target.checked))}
          label="Проверять ответ автоматически"
          description="Без правил задание собирает короткий текст и не приносит баллов"
          data-testid="answer-rules-autocheck"
        />
      </div>
      )}

      {draft.autoCheck || forBlank ? (
        <>
          <div className="ou-formfield">
            <span className="ou-formfield__lbl">Ответ участника — это</span>
            <SegmentedControl<"text" | "number">
              size="s"
              value={draft.answerKind}
              aria-label="Что проверяем"
              items={[
                { value: "text", label: "Текст" },
                { value: "number", label: "Число" },
              ]}
              onChange={(value) => onChange(switchKind(draft, value))}
            />
            <span className="ou-formfield__desc">
              {draft.answerKind === "number"
                ? "Участник вводит число, поэтому правила сравнивают величины."
                : "Участник вводит текст, поэтому правила сравнивают слова."}
            </span>
          </div>

          <div className="ou-formfield">
            <span className="ou-formfield__lbl">Ответ засчитывается, если выполнено</span>
            <SegmentedControl<"any" | "all">
              size="s"
              value={draft.join}
              aria-label="Как объединять правила"
              items={[
                { value: "any", label: "Любое правило" },
                { value: "all", label: "Все правила" },
              ]}
              onChange={(value) => onChange(setJoin(draft, value))}
            />
          </div>

          {draft.answerKind === "number" ? (
            <div className="ou-formfield">
              <span className="ou-formfield__lbl">Единица измерения</span>
              <Input
                size="m"
                value={draft.unit}
                onChange={(e) => onChange(setUnit(draft, e.target.value))}
                data-testid="answer-rules-unit"
              />
              <span className="ou-formfield__desc">
                Подпись у поля ответа. Участник вводит только число, единицу не печатает.
              </span>
            </div>
          ) : null}

          <div className="ou-formfield">
            <span className="ou-formfield__lbl">Правила</span>
            {rules.length === 0 ? (
              <span className="ou-formfield__desc">
                Правил пока нет. Пока их нет, задание собирает ответы и не приносит баллов.
              </span>
            ) : (
              <Accordion variant="bordered" type="multiple">
                {rules.map((rule, index) => (
                  <Fragment key={index}>
                    {index > 0 ? (
                      // Связка стоит МЕЖДУ строками, чтобы набор читался сверху вниз
                      // одной фразой; подписью под списком при пяти правилах она
                      // оказывалась за пределами взгляда.
                      <div className="tb-rules__join" data-testid="answer-rules-join">
                        {draft.join === "all" ? "и" : "или"}
                      </div>
                    ) : null}
                  <AccordionItem
                    value={`rule-${index}`}
                    title={ruleTitle(rule, draft.unit)}
                    subtitle={ruleSubtitle(rule)}
                    trailing={
                      outcome ? (
                        <Tag tone={outcome.perRule[index] ? "success" : "neutral"} size="s">
                          {outcome.perRule[index] ? "выполнено" : "не выполнено"}
                        </Tag>
                      ) : undefined
                    }
                  >
                    {rule.kind === "text" ? (
                      <TextRuleFields
                        rule={rule}
                        index={index}
                        onPatch={(patch) => onChange(updateRule(draft, index, patch))}
                      />
                    ) : (
                      <NumberRuleFields
                        rule={rule}
                        index={index}
                        unit={draft.unit}
                        onPatch={(patch) => onChange(updateRule(draft, index, patch))}
                      />
                    )}
                    <Button
                      variant="ghost"
                      size="s"
                      leadingIcon={<Trash2 width={14} height={14} aria-hidden="true" />}
                      onClick={() => onChange(removeRule(draft, index))}
                      data-testid={`answer-rules-remove-${index}`}
                    >
                      Удалить правило
                    </Button>
                  </AccordionItem>
                  </Fragment>
                ))}
              </Accordion>
            )}
            <Button
              variant="ghost"
              size="s"
              leadingIcon={<Plus width={14} height={14} aria-hidden="true" />}
              onClick={() => onChange(addRule(draft))}
              data-testid="answer-rules-add"
            >
              Добавить правило
            </Button>
          </div>

          {saved.rules.length > 0 ? (
            <div className="ou-formfield">
              <span className="ou-formfield__lbl">Проверить ответ</span>
              <div className="tb-probe">
                <Input
                  size="m"
                  value={probe}
                  onChange={(e) => setProbe(e.target.value)}
                  data-testid="answer-rules-probe"
                />
                {outcome ? (
                  <Tag tone={outcome.passed ? "success" : "error"} data-testid="answer-rules-verdict">
                    {outcome.passed ? "Зачтено" : "Не зачтено"}
                  </Tag>
                ) : null}
              </div>
              <span className="ou-formfield__desc">
                {outcome
                  ? describeProbe(saved, outcome)
                  : "Наберите вариант ответа — рядом появится вердикт, а в списке будет видно, какие правила выполнены. Проба не сохраняется и на статистику не влияет."}
              </span>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Fields of ONE textual rule (wireframe: «Как сравнивать» + «Ответ»). */
function TextRuleFields({
  rule,
  index,
  onPatch,
}: {
  rule: TextRule;
  index: number;
  onPatch: (patch: Partial<TextRule>) => void;
}) {
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const [measured, setMeasured] = useState<Measurement | null>(null);
  const expression = rule.match === "regex";

  // Замер идёт по выражению, а не по каждой букве: пока автор печатает, мерить нечего,
  // а поток на каждый символ — это поток на каждый символ.
  useEffect(() => {
    if (!expression || rule.value.trim() === "") {
      setMeasured(null);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      void measureExpression(rule.value).then((result) => {
        if (!alive) return;
        setMeasured(result);
        // Признак едет ВМЕСТЕ с правилом: в пакете он единственная защита участника
        // (там сравнение идёт в основном потоке и прервать его нечем).
        const slow = result.killed || result.worstMs >= DEFAULT_WARN_MS;
        if (slow !== (rule.slow === true)) onPatch({ slow: slow || undefined });
      });
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expression, rule.value]);

  const replacement = expression ? simplifyExpression(rule.value) : null;
  const slow = measured !== null && (measured.killed || measured.worstMs >= DEFAULT_WARN_MS);

  return (
    <>
      <div className="ou-formfield">
        <span className="ou-formfield__lbl">Как сравнивать</span>
        <SegmentedControl<"wildcard" | "regex">
          size="s"
          value={rule.match}
          aria-label="Как сравнивать"
          items={[
            { value: "wildcard", label: "Обычный" },
            { value: "regex", label: "Регулярное выражение" },
          ]}
          onChange={(value) => onPatch({ match: value })}
        />
      </div>
      <div className="ou-formfield">
        <span className="ou-formfield__lbl">{expression ? "Выражение" : "Ответ"}</span>
        {expression ? (
          <RegexBar field={() => fieldRef.current} onInsert={(value) => onPatch({ value })} />
        ) : null}
        <Input
          ref={expression ? fieldRef : undefined}
          size="m"
          className={expression ? "tb-mono" : undefined}
          value={rule.value}
          onChange={(e) => onPatch({ value: e.target.value })}
          data-testid="answer-rules-text-value"
        />
        {expression && measured ? (
          <span
            className={`ou-formfield__msg${slow ? " ou-formfield__msg--warn" : ""}`}
            data-testid={`answer-rules-measure-${index}`}
          >
            {measured.killed
              ? "Проверка ответа не уложилась в отведённое время"
              : `Проверка ответа заняла ${formatDuration(measured.worstMs)}`}
          </span>
        ) : null}
        {!expression ? (
          <span className="ou-formfield__desc">
            Звёздочка заменяет любое продолжение, знак вопроса — один любой символ.
            Регистр, лишние пробелы, «ё» и вид кавычек значения не имеют.
          </span>
        ) : null}
      </div>
      {expression && slow ? (
        <Banner
          tone="warning"
          variant="subtle"
          title="Выражение считается слишком долго"
          data-testid={`answer-rules-slow-${index}`}
          actions={
            replacement
              ? [
                {
                  label: "Заменить на обычное сравнение",
                  primary: true,
                  className: `answer-rules-replace-${index}`,
                  onClick: () => onPatch({ match: "wildcard", value: replacement, slow: undefined }),
                },
              ]
              : undefined
          }
        >
          {replacement
            ? `Проверка одного ответа занимает недопустимо долго, и чем длиннее ответ, тем дольше. Участник столько ждать не будет. Тот же ответ поймает обычное сравнение со звёздочкой: «${replacement}».`
            : "Проверка одного ответа занимает недопустимо долго, и чем длиннее ответ, тем дольше. Участник столько ждать не будет. Замену подобрать не удалось: упростите выражение сами или обойдитесь обычным сравнением — для большинства заданий его хватает."}
        </Banner>
      ) : null}
    </>
  );
}

/** «230 мс» либо «27 секунд» — автору важен порядок величины, а не точность. */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} мс`;
  const seconds = Math.round(ms / 100) / 10;
  return `${String(seconds).replace(".", ",")} с`;
}

/** Fields of ONE numeric rule (wireframe states `k-number` and `k-frac`). */
function NumberRuleFields({
  rule,
  index,
  unit,
  onPatch,
}: {
  rule: NumericRule;
  index: number;
  unit: string;
  onPatch: (patch: Partial<NumericRule>) => void;
}) {
  const tolerance = rule.tolerance ?? { unit: "abs" as const, value: 0 };
  return (
    <>
      <div className="ou-formfield">
        <span className="ou-formfield__lbl">Условие</span>
        <div className="ou-formgroup ou-formgroup--two" data-testid={`answer-rules-operator-${index}`}>
          <Select<NumericOp>
            size="m"
            value={rule.op}
            aria-label="Как сравнивать"
            options={NUMERIC_OPERATORS}
            onChange={(op) => onPatch({ op })}
          />
          <NumberValueInput
            value={rule.value}
            onValue={(value) => onPatch({ value })}
            testId="answer-rules-number-value"
          />
        </div>
        <span className="ou-formfield__desc">
          Можно вводить отрицательные значения, десятичные и обыкновенные дроби: -25, 0,75, 1/3, 2 1/2.
        </span>
      </div>
      {hasTolerance(rule.op) ? (
        <div className="ou-formfield">
          <span className="ou-formfield__lbl">Допуск</span>
          <div className="ou-formgroup ou-formgroup--two">
            <NumberValueInput
              value={tolerance.value}
              onValue={(value) => onPatch({ tolerance: { ...tolerance, value } })}
              testId="answer-rules-tolerance-value"
            />
            <Select<"abs" | "pct">
              size="m"
              value={tolerance.unit}
              aria-label="Мера допуска"
              options={[
                { value: "abs", label: "в единицах" },
                { value: "pct", label: "в процентах" },
              ]}
              onChange={(measure) => onPatch({ tolerance: { ...tolerance, unit: measure } })}
            />
          </div>
        </div>
      ) : null}
      <span className="ou-formfield__desc">{describeNumericRule(rule, unit)}</span>
    </>
  );
}

/**
 * A number field that lets the author FINISH typing.
 *
 * The typed text is state of its own, and the rule is patched only when that text reads
 * as a number: `1/` on the way to `1/3` is not one, and writing it through as `NaN` (or,
 * worse, as zero) would wipe a rule the author is in the middle of correcting.
 */
function NumberValueInput({
  value,
  onValue,
  testId,
}: {
  value: number;
  onValue: (value: number) => void;
  testId: string;
}) {
  const [text, setText] = useState(() => formatRuleNumber(value));
  return (
    <Input
      size="m"
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const parsed = parseNumericAnswer(raw);
        if (parsed !== null) onValue(parsed);
      }}
      data-testid={testId}
    />
  );
}

export { createDraft, toCorrectJson };
export type { AnswerRulesDraft };

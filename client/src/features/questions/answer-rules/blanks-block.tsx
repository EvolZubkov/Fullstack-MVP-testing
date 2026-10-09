/**
 * @module features/questions/answer-rules/blanks-block
 *
 * Блок «Пропуски» ящика вопроса (PRD-57 FR-24 — FR-24d). Раскладка — из согласованного
 * эскиза `docs/wireframes/approved/prd57-blanks-editor.html`.
 *
 * Главное решение раздела, и оно про НАПРАВЛЕНИЕ связи: список пропусков ЕСТЬ отображение
 * текста задания. Имя берётся из текста и правится только там; строка переименовывается
 * следом вместе со своими правилами. Второго места, где имя правится руками, не
 * существует — поэтому осиротевшему правилу возникнуть неоткуда, и прежняя ловля
 * рассогласования при сохранении не нужна (FR-24d).
 *
 * Стёртый из текста пропуск уносит и строку, но не молча: если у пропуска были правила,
 * ящик спрашивает подтверждение, а отказ ВОЗВРАЩАЕТ пропуск в текст. Пропуск без правил
 * исчезает сразу — терять там нечего.
 */
import { Accordion, AccordionItem, Button, Cluster, ModalDialog, Text } from "@skillum/ui-kit";
import { useEffect, useRef, useState } from "react";

import { blankIds } from "@shared/questions/blanks";
import type { BlankRuleSet } from "@shared/questions/blanks-render";

import { AnswerRulesBlock } from "./answer-rules-block";
import {
  createDraft,
  toCorrectJson,
  type AnswerRulesDraft,
} from "./answer-rules-model";

export interface BlanksBlockProps {
  /** Текст задания — единственный источник имён пропусков. */
  prompt: string;
  /** Наборы правил по пропускам, как они уедут в `correct_json`. */
  blanks: BlankRuleSet[];
  onChange: (blanks: BlankRuleSet[]) => void;
  /** Вернуть пропуск в текст, когда автор отказался от удаления (FR-24d). */
  onRestorePrompt: (prompt: string) => void;
}

/** Пустой набор правил только что появившегося пропуска. */
function emptySet(id: string): BlankRuleSet {
  return { id, answerKind: "text", join: "any", rules: [] };
}

/** Подзаголовок строки: чем пропуск проверяется. */
function blankSubtitle(set: BlankRuleSet): string {
  if (set.rules.length === 0) return "Правил нет";
  const kind = set.answerKind === "number" ? "Число" : "Текст";
  if (set.rules.length === 1) return `${kind} · одно правило`;
  const join = set.join === "all" ? "все" : "любое";
  return `${kind} · ${join} из ${set.rules.length}`;
}

export function BlanksBlock({ prompt, blanks, onChange, onRestorePrompt }: BlanksBlockProps) {
  const ids = blankIds(prompt);
  /** Текст, каким он был до последней правки: из него восстанавливается отказ от удаления. */
  const previousPrompt = useRef(prompt);
  /** Удаление, которое ждёт подтверждения: у пропуска были правила. */
  const [pendingRemoval, setPendingRemoval] = useState<{ set: BlankRuleSet; prompt: string } | null>(null);
  /** Черновики правил по пропускам: переключение вида ответа не теряет набранного. */
  const [drafts, setDrafts] = useState<Record<string, AnswerRulesDraft>>({});

  // Список идёт за текстом: появившийся пропуск добавляет строку, исчезнувший — уносит.
  useEffect(() => {
    const before = previousPrompt.current;
    previousPrompt.current = prompt;
    const known = new Map(blanks.map((set) => [set.id, set]));
    const removed = blanks.filter((set) => !ids.includes(set.id));
    const withRules = removed.find((set) => set.rules.length > 0);

    if (withRules) {
      // Правила терять молча нельзя: спрашиваем, а отказ вернёт текст как был.
      setPendingRemoval({ set: withRules, prompt: before });
      return;
    }

    const next = ids.map((id) => known.get(id) ?? emptySet(id));
    const same =
      next.length === blanks.length && next.every((set, index) => set.id === blanks[index]?.id);
    if (!same) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt]);

  const confirmRemoval = () => {
    if (!pendingRemoval) return;
    setPendingRemoval(null);
    onChange(ids.map((id) => blanks.find((set) => set.id === id) ?? emptySet(id)));
  };

  const cancelRemoval = () => {
    if (!pendingRemoval) return;
    const restored = pendingRemoval.prompt;
    setPendingRemoval(null);
    previousPrompt.current = restored;
    onRestorePrompt(restored);
  };

  const draftOf = (set: BlankRuleSet): AnswerRulesDraft => drafts[set.id] ?? createDraft(set);

  const patch = (set: BlankRuleSet, draft: AnswerRulesDraft) => {
    setDrafts((current) => ({ ...current, [set.id]: draft }));
    const saved = toCorrectJson(draft);
    onChange(blanks.map((item) => (item.id === set.id ? { ...saved, id: set.id } : item)));
  };

  return (
    <div className="ou-formfield" data-testid="blanks-block">
      <span className="ou-formfield__lbl">Пропуски</span>
      {blanks.length === 0 ? (
        <span className="ou-formfield__desc">
          Пропусков пока нет. Поставьте пропуск кнопкой над полем текста — он пишется как
          {" "}
          <span className="tb-mono">{"{{имя}}"}</span>.
        </span>
      ) : (
        <Accordion variant="bordered" type="multiple">
          {blanks.map((set) => (
            <AccordionItem
              key={set.id}
              value={`blank-${set.id}`}
              title={<span className="tb-mono">{`{{${set.id}}}`}</span>}
              subtitle={blankSubtitle(set)}
            >
              <AnswerRulesBlock
                variant="blank"
                draft={draftOf(set)}
                onChange={(draft) => patch(set, draft)}
              />
            </AccordionItem>
          ))}
        </Accordion>
      )}

      <ModalDialog
        open={pendingRemoval !== null}
        onClose={cancelRemoval}
        title="Удалить пропуск вместе с правилами?"
        footer={
          <Cluster justify="end" gap={2} wrap={false}>
            <Button variant="secondary" onClick={cancelRemoval} data-testid="blanks-remove-cancel">
              Оставить
            </Button>
            <Button variant="destructive" onClick={confirmRemoval} data-testid="blanks-remove-confirm">
              Удалить
            </Button>
          </Cluster>
        }
        data-testid="blanks-remove-dialog"
      >
        <Text variant="body-m">
          {`Пропуск {{${pendingRemoval?.set.id ?? ""}}} убран из текста, а у него есть правила проверки. `}
          Если удалить — правила пропадут вместе с ним, и вернуть их будет невозможно.
        </Text>
      </ModalDialog>
    </div>
  );
}

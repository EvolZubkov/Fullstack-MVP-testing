/**
 * @module features/tests/editor/sections/score-preview-modal
 * @description «Предпросмотр балла» (PRD-10 §7, issue #31): scores a demo answer
 * against the answer-price config currently OPEN in the constructor, so the
 * author stops setting weights and step tables blind.
 *
 * Two properties make it trustworthy. The score comes from the product's own
 * engine (`@shared/scoring/engine`) — the preview cannot drift from what the
 * learner will get, because there is no second implementation to drift. And it
 * reads the DRAFT config, not the saved one: the author sees the effect of the
 * edit before «Применить».
 *
 * Source of truth for the layout:
 * docs/wireframes/approved/prd15-test-scoring.html (s-preview).
 */

import { useMemo, useState } from "react";
import { Button, ModalDialog, Select, Tag, Text } from "@skillum/ui-kit";

import type { QuestionScoring } from "@shared/schema";
import { buildDemoAnswers, optionName } from "@shared/scoring/demo-answers";
import { explainAnswer, type CorrectData } from "@shared/scoring/engine";
import { isSingleIndexChoice, type QuestionType } from "@shared/questions/question-type";

export interface ScorePreviewModalProps {
  type: QuestionType;
  /** Answer options (single/scale/multiple); empty for matching/ranking. */
  options: string[];
  /** The question's answer key (`correct_json`). */
  correct: CorrectData;
  /** The config open in the constructor — null means exact matching. */
  scoring: QuestionScoring | null;
  onClose: () => void;
}

/** Short type names, as in the wireframe subtitle («Множественный · ступенчато»). */
const TYPE_LABEL: Record<QuestionType, string> = {
  single: "Одиночный",
  multiple: "Множественный",
  matching: "Сопоставление",
  ranking: "Ранжирование",
  scale: "Шкала",
  allocation: "Распределение баллов",
  short: "Короткий ответ",
  blanks: "Пропуски",
  long: "Развёрнутый ответ",
  simulation: "Сценарий",
};

const METHOD_LABEL: Record<"exact" | "weighted" | "tiered", string> = {
  exact: "точное совпадение",
  weighted: "веса опций",
  tiered: "ступенчато",
};

/** «Москва, Тула (T = 2)» — what the key says, in the terms the tiers use. */
function keySummary(type: QuestionType, correct: CorrectData, options: string[]): string {
  if (isSingleIndexChoice(type)) {
    return typeof correct.correctIndex === "number"
      ? optionName(options, correct.correctIndex)
      : "не задан — вопрос только измеряет";
  }
  if (type === "multiple") {
    const picked = correct.correctIndices ?? [];
    if (picked.length === 0) return "не задан";
    return `${picked.map((i) => optionName(options, i)).join(", ")} (T = ${picked.length})`;
  }
  if (type === "matching") {
    const pairs = correct.pairs ?? [];
    return pairs.length === 0 ? "не задан" : `${pairs.length} пар (P = ${pairs.length})`;
  }
  if (type === "ranking") {
    const order = correct.correctOrder ?? [];
    return order.length === 0 ? "не задан" : `${order.length} элементов (N = ${order.length})`;
  }
  return "не задан";
}

/** A tier predicate in the wording of the constructor: «Верных (c) ≥ 1». */
function describeTier(scoring: QuestionScoring | null, index: number): string {
  if (!scoring || scoring.kind !== "tiered") return "";
  const tier = scoring.tiers[index];
  if (!tier) return "";
  const OPS: Record<string, string> = { "==": "=", ">=": "≥", "<=": "≤", "<": "<", ">": ">" };
  const conds = tier.when.all.map(
    (c) => `${c.lhs === "c" ? "Верных (c)" : "Лишних (x)"} ${OPS[c.op] ?? c.op} ${c.rhs}`,
  );
  return `${index + 1} — «${conds.join(" и ")}»`;
}

/** The learner-facing verdict of a ratio — the same three positions as the runtime banner. */
function verdictOf(ratio: number): { label: string; tone: "success" | "warning" | "error" } {
  if (ratio >= 1) return { label: "Правильно", tone: "success" };
  if (ratio > 0) return { label: "Частично правильно", tone: "warning" };
  return { label: "Неверно", tone: "error" };
}

/** Trailing zeros hurt readability: 0.5 stays 0.5, 1 stays 1. */
function formatRatio(ratio: number): string {
  return String(Math.round(ratio * 100) / 100);
}

export function ScorePreviewModal({ type, options, correct, scoring, onClose }: ScorePreviewModalProps) {
  const demos = useMemo(
    () => buildDemoAnswers({ type, correct, options }),
    [type, correct, options],
  );
  const [demoId, setDemoId] = useState(demos[0]?.id ?? "empty");
  const demo = demos.find((d) => d.id === demoId) ?? demos[0];

  const result = explainAnswer({ type, correct, answer: demo?.answer ?? null, scoring });
  const verdict = verdictOf(result.ratio);
  const method = METHOD_LABEL[result.kind];

  return (
    <ModalDialog
      open
      onClose={onClose}
      size="m"
      title="Предпросмотр балла"
      description={`${TYPE_LABEL[type]} · ${method} · эталон: ${keySummary(type, correct, options)}`}
      footer={
        <Button variant="ghost" onClick={onClose} data-testid="score-preview-back">
          Назад к цене ответа
        </Button>
      }
      data-testid="score-preview-modal"
    >
      <Select
        label="Демо-ответ"
        fullWidth
        value={demoId}
        onChange={(v) => setDemoId(v as string)}
        options={demos.map((d) => ({ value: d.id, label: d.label }))}
        data-testid="score-preview-answer"
      />
      <Text as="p" variant="body-s" tone="muted">
        Набор собран из эталона вопроса. Балл считает движок цены ответа по настройке, открытой в
        конструкторе, — ещё до «Применить».
      </Text>

      <table className="tb-table" data-testid="score-preview-table">
        <thead>
          <tr>
            <th>Поле</th>
            <th>Значение</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Эталон</td>
            <td>{keySummary(type, correct, options)}</td>
          </tr>
          <tr>
            <td>Ответ</td>
            <td>{`${demo?.label ?? "—"} → c = ${result.c}, x = ${result.x}`}</td>
          </tr>
          {result.kind === "tiered" && (
            <tr>
              <td>Сработала строка</td>
              <td>
                {result.tierIndex === null
                  ? "Иначе — во всех остальных случаях"
                  : describeTier(scoring, result.tierIndex)}
              </td>
            </tr>
          )}
          <tr>
            <td>Балл s</td>
            <td>{result.score}</td>
          </tr>
          <tr>
            <td>sMax</td>
            <td>{result.sMax}</td>
          </tr>
          <tr>
            <td>scoreRatio</td>
            <td>{formatRatio(result.ratio)}</td>
          </tr>
          <tr>
            <td>Статус</td>
            <td>
              <Tag variant="soft" tone={verdict.tone} data-testid="score-preview-verdict">
                {verdict.label}
              </Tag>
            </td>
          </tr>
        </tbody>
      </table>
    </ModalDialog>
  );
}

/**
 * @module features/analytics/test/questions-tab
 * @description Э4б UX-аудита аналитики: вкладка «Вопросы» — одна таблица вопросов с наборами
 * колонок вместо вкладок «Вопросы» и «Качество вопросов» (эскиз approved/e4b-questions-table.html).
 *
 * Две таблицы вопросов с разными числами запрещал ещё PRD-66 §3 (противоречие К4 плана): автор
 * сверял «Вопросы» с «Качеством вопросов» и не понимал, какая права. Теперь таблица одна, а
 * колонки выбираются набором:
 *   - «Основное» (по умолчанию) — что отвечали, трудность, дискриминативность, сложность «задана →
 *     по ответам», время, цена;
 *   - «Психометрика» — что не так, трудность, дискриминативность, n; над таблицей — блок качества
 *     теста (надёжность, ошибка измерения, выборка, предупреждения);
 *   - «Показы и пропуски» — пропуски, экспозиция, другие тесты, время. Не «Выдача»: так
 *     называется вкладка теста об устройстве выдачи (варианты, версии, банки тем), а набор — о
 *     том, как ведёт себя в прохождениях отдельный вопрос (решение владельца 2026-10-05).
 *
 * Вид — «Все / Под подозрением / Мало данных / Исключённые» — не зависит от набора: переключая
 * набор, автор смотрит на те же вопросы под другим углом. «Под подозрением» — психометрические
 * признаки и эвристики ревизии вместе, одним правилом (`shared/psychometrics/question-flag`).
 *
 * Сами таблицы — прежние: «Основное» и «Выдачу» рисует `QuestionTable`, «Психометрику» — таблица
 * `ItemQualityPanel`, вынутая из своей карточки. Их проверенное поведение (сортировка по силе
 * подозрения, «Состояние» при малой выборке, невыданные вопросы, меню) переносится без переделки.
 */
import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";

import {
  Button, Card, CardBody, CardHeader, EmptyState, SegmentedControl, Stack,
} from "@skillum/ui-kit";

import { isSuspicious, isThin, questionFlag } from "@shared/psychometrics/question-flag";
import { LoadingState } from "@/components/loading-state";
import { pluralize } from "@/lib/i18n";

import { useAnalyticsTab } from "../levels/use-analytics-tab";
import { GlossaryDialog, ItemQualityPanel, type ItemQualityView, type ReviewHeuristic } from "./item-quality";
import { QuestionTable, type QuestionPsychometrics, type QuestionRow } from "./question-table";

/** Набор колонок — значение параметра адреса `cols`. */
export const COLUMN_SETS = ["main", "psychometrics", "delivery"] as const;
export type ColumnSet = (typeof COLUMN_SETS)[number];

/** Вид таблицы. */
export type QuestionsTabView = "all" | "suspicious" | "thin" | "excluded";

/** Свойства вкладки. */
export interface QuestionsTabProps {
  questions: QuestionRow[];
  /** Тест измерительный: психометрики вопросов нет, наборов два. */
  measurement: boolean;
  minObservations: number;
  testId?: string;
  passages?: number;
  /** Психометрика теста; `undefined` — ещё считается или недоступна. */
  quality?: ItemQualityView;
  qualityLoading: boolean;
  heuristics: Record<string, ReviewHeuristic>;
  /** Исключённые из выдачи — по ним меню психометрики предлагает «Вернуть в выдачу». */
  excluded: Record<string, boolean>;
  /** Вид и набор, с которыми вкладка открывается, — «Требует внимания» ведёт в нужный. */
  initialView?: QuestionsTabView;
  initialSet?: ColumnSet;
  onOpenQuestion: (questionId: string, order: string[]) => void;
  onOpenRegistry?: (questionId: string) => void;
  onDeliveryChange?: (questionId: string, excluded: boolean) => void;
  onRestoreFirstAttempt?: () => void;
}

/** Строка таблицы для вопроса пула, которого ещё никто не видел: чисел нет, только подписи. */
function neverDeliveredRow(item: ItemQualityView["items"][number]): QuestionRow {
  return {
    questionId: item.questionId,
    questionPrompt: item.prompt ?? item.questionId,
    questionType: item.questionType ?? "single",
    topicName: item.topicName ?? "",
    difficulty: item.declaredDifficulty,
    totalAnswers: 0,
    gradedAnswers: 0,
    correctAnswers: 0,
    correctPercent: null,
    skipShare: null,
    exposurePercent: null,
    latencyMedianMs: null,
    latencySampleSize: 0,
    reviewFlags: [],
  };
}

/**
 * Вкладка «Вопросы» с наборами колонок.
 *
 * @param props - вопросы, психометрика, эвристики и обработчики
 * @returns блок качества (в «Психометрике») и таблица выбранного набора
 */
export function QuestionsTab(props: QuestionsTabProps) {
  const {
    questions, measurement, minObservations, testId, passages, quality, qualityLoading, heuristics,
    excluded, initialView = "all", initialSet, onOpenQuestion, onOpenRegistry, onDeliveryChange,
    onRestoreFirstAttempt,
  } = props;
  const sets: readonly ColumnSet[] = measurement ? ["main", "delivery"] : COLUMN_SETS;
  const [set, setSet] = useAnalyticsTab(sets, "main", "cols");
  const [view, setView] = useState<QuestionsTabView>(initialView);
  const [glossary, setGlossary] = useState(false);

  // Переход из «Требует внимания» задаёт набор один раз, при открытии.
  useEffect(() => {
    if (initialSet && initialSet !== set && sets.includes(initialSet)) setSet(initialSet);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при открытии вкладки
  }, []);

  const items = useMemo(() => new Map((quality?.items ?? []).map(item => [item.questionId, item])), [quality]);

  // Вопросы пула без наблюдений — строками и в «Основном» с «Выдачей»: иначе они были бы видны
  // только в «Психометрике», и наборы показывали бы разные списки.
  const rows = useMemo(() => {
    const known = new Set(questions.map(question => question.questionId));
    const pool = (quality?.items ?? []).filter(item => item.neverDelivered && !known.has(item.questionId));
    return [...questions, ...pool.map(neverDeliveredRow)];
  }, [questions, quality]);

  const groups = useMemo(() => {
    const suspicious = new Set<string>();
    const thin = new Set<string>();
    const excludedIds = new Set<string>();
    for (const row of rows) {
      const item = items.get(row.questionId);
      const heuristic = heuristics[row.questionId];
      if (item ? isSuspicious(item, heuristic) : !!heuristic) suspicious.add(row.questionId);
      if (item ? isThin(item) : row.totalAnswers < minObservations) thin.add(row.questionId);
      if (row.excludedFromDelivery || excluded[row.questionId]) excludedIds.add(row.questionId);
    }
    return { suspicious, thin, excluded: excludedIds };
  }, [rows, items, heuristics, excluded, minObservations]);

  const only: ReadonlySet<string> | null = view === "all" ? null : groups[view];
  const shown = only ? rows.filter(row => only.has(row.questionId)) : rows;

  const psychometrics: Record<string, QuestionPsychometrics> | undefined = quality?.items
    ? Object.fromEntries(quality.items.map(item => [item.questionId, {
      difficulty: item.difficulty,
      itemRest: item.itemRest,
      observations: item.observations,
      difficultyConfidence: item.difficultyConfidence,
      coefficientConfidence: item.coefficientConfidence,
    }]))
    : undefined;

  // Причина «под подозрением» — подписью под вопросом в «Основном» и «Выдаче» (эскиз Э4б, docs).
  const flags = useMemo(() => Object.fromEntries(rows.map(row => {
    const item = items.get(row.questionId);
    const heuristic = heuristics[row.questionId];
    return [row.questionId, item ? questionFlag(item, heuristic) : null];
  })), [rows, items, heuristics]);

  const inDelivery = rows.length - groups.excluded.size;
  const subtitle = [
    `${inDelivery} ${pluralize(inDelivery, "вопрос", "вопроса", "вопросов")} в выдаче${groups.excluded.size > 0 ? `, ${groups.excluded.size} ${pluralize(groups.excluded.size, "исключён", "исключено", "исключено")} из выдачи` : ""}`,
    passages !== undefined ? `${passages} ${pluralize(passages, "прохождение", "прохождения", "прохождений")}` : null,
    set === "psychometrics" ? "отсортированы по силе подозрения" : null,
  ].filter(Boolean).join(" · ");

  const viewItems = [
    { value: "all", label: "Все", badge: rows.length },
    ...(measurement ? [] : [{ value: "suspicious", label: "Под подозрением", badge: groups.suspicious.size }]),
    { value: "thin", label: "Мало данных", badge: groups.thin.size },
    { value: "excluded", label: "Исключённые", badge: groups.excluded.size },
  ];

  const psychometricsTable = qualityLoading && !quality
    ? <LoadingState message="Считаем психометрику..." />
    : quality && !quality.measurementOnly
      ? (
        <ItemQualityPanel
          section="table"
          view={quality}
          only={only ?? undefined}
          heuristics={heuristics}
          onOpenItem={onOpenQuestion}
          testId={testId}
          onDeliveryChange={onDeliveryChange}
          excluded={excluded}
        />
      )
      : <EmptyState title="Психометрика недоступна" description="Не удалось посчитать показатели по этому тесту" />;

  return (
    <Stack gap={4}>
      {set === "psychometrics" && quality && !quality.measurementOnly ? (
        <ItemQualityPanel section="block" view={quality} heuristics={heuristics} onRestoreFirstAttempt={onRestoreFirstAttempt} />
      ) : null}
      <Card>
        <CardHeader
          title="Вопросы теста"
          subtitle={subtitle}
          trail={(
            <SegmentedControl
              size="s"
              value={set}
              onChange={value => setSet(value)}
              items={sets.map(value => ({
                value,
                label: value === "main" ? "Основное" : value === "psychometrics" ? "Психометрика" : "Показы и пропуски",
              }))}
            />
          )}
        />
        <CardBody>
          <Stack gap={4}>
            <Stack direction="row" justify="between" align="center" gap={2} wrap>
              <SegmentedControl
                size="s"
                value={view}
                onChange={value => setView(value as QuestionsTabView)}
                items={viewItems}
              />
              {set === "psychometrics" ? (
                <Button variant="ghost" size="s" onClick={() => setGlossary(true)} leadingIcon={<Info size={14} />}>
                  Термины
                </Button>
              ) : null}
            </Stack>
            {set === "psychometrics"
              ? psychometricsTable
              : (
                <QuestionTable
                  bare
                  // Набор и вид меняют состав колонок и строк: таблица пересоздаётся, сортировка
                  // остаётся своей у каждого набора.
                  key={`${set}-${view}`}
                  columnSet={set}
                  questions={shown}
                  measurement={measurement}
                  minObservations={minObservations}
                  attempts={quality?.attempts}
                  testId={testId}
                  psychometrics={psychometrics}
                  flags={quality?.items ? flags : undefined}
                  onOpenQuality={onOpenQuestion}
                  onOpenRegistry={onOpenRegistry}
                  onDeliveryChange={onDeliveryChange}
                />
              )}
          </Stack>
        </CardBody>
      </Card>
      <GlossaryDialog open={glossary} onClose={() => setGlossary(false)} />
    </Stack>
  );
}

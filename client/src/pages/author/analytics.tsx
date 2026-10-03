/**
 * @module pages/author/analytics
 * @description Analytics for the author: the passage registry (web, LMS telemetry and
 * imported exports in one list), slices of those passages within a single test, the
 * «needs attention» cases, plus the attempt-details window every list opens into. The Excel
 * export is the registry button (FR-04); the separate «Export» tab was removed on 2026-09-25,
 * its only rule without a registry equivalent — best attempt per participant — moved into the
 * export dialog.
 *
 * PRD-56 FR-12 removed the «overview» tab: an average score or pass rate computed ACROSS
 * tests mixes different thresholds, scales and populations, so the number could not be
 * acted upon. What replaced it — slices and the queue — always names the population it
 * describes. Rendered entirely with the Skillum design system.
 */
import { useState } from "react";
import { ExportDialog } from "@/features/analytics/registry/export-dialog";
import { PassageRegistry, type RegistryRow } from "@/features/analytics/registry/passage-registry";
import { useLocation } from "wouter";

import {
  conditionsToFilter,
  countConditions,
  EMPTY_FILTER,
  type RegistryFilter,
} from "@/features/analytics/registry/filter-state";
import { testHref } from "@/features/analytics/levels/analytics-routes";
import { useAnalyticsTab } from "@/features/analytics/levels/use-analytics-tab";
import { AnalyticsHeader } from "@/features/analytics/levels/analytics-header";

/** Вкладки общего уровня. Первая — по умолчанию. */
const GENERAL_ANALYTICS_TABS = ["attempts", "slices", "attention"] as const;
import { percent } from "@/features/analytics/format";
import { useRegistryFilter } from "@/features/analytics/registry/use-registry-filter";
import { SlicesTab } from "@/features/analytics/slices/slices-tab";
import { AttentionQueue, type AttentionData, type AttentionRow } from "@/features/analytics/attention/attention-queue";
import { DEFAULT_ATTENTION_PERIOD, type AttentionPeriod } from "@shared/analytics/attention-period";
import { useQuery } from "@tanstack/react-query";
import { LoadingState } from "@/components/loading-state";
import {
  Box,
  Button,
  Card,
  CardBody,
  CardHeader,
  Cluster,
  Grid,
  ModalDialog,
  ProgressBar,
  Separator,
  Stack,
  Tabs,
  Tag,
  Text,
} from "@skillum/ui-kit";
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Globe,
  Server,
  Clock,
  XCircle,
  HelpCircle,
  Layers,
  RefreshCw,
  FileDown,
} from "lucide-react";
import type { QuestionType } from "@shared/questions/question-type";
import { QuestionTypeIcon } from "@/features/tests/editor/sections/question-type-icon";
import { FoldAllButtons, useSectionFold } from "@/features/tests/editor/sections/section-fold";

// ============================================
// Интерфейсы
// ============================================

/**
 * Прохождение, разбор которого открыт в окне деталей.
 *
 * Это НЕ строка реестра: реестр говорит, что прохождение было, а окно — что в нём произошло.
 * Строка приводится к этой форме при открытии (`handleOpenPassage`).
 */
interface CombinedAttempt {
  id: string;
  testId: string | null;
  testTitle: string;
  testMode?: string;
  userId?: string;
  username?: string;
  userEmail?: string | null;
  lmsUserId?: string | null;
  lmsUserName?: string | null;
  lmsUserEmail?: string | null;
  startedAt: string;
  finishedAt: string | null;
  duration?: number | null;
  resultPercent: number;
  resultPassed: boolean;
  totalPoints: number;
  maxPoints: number;
  source: "web" | "lms";
  isAdaptive?: boolean;
  achievedTopics?: number | null;
  totalTopics?: number | null;
}

// Детальный ответ
interface DetailedAnswer {
  questionId: string;
  questionPrompt: string;
  questionType: string;
  topicId: string;
  topicName: string;
  difficulty: number;
  userAnswer: any;
  correctAnswer: any;
  options?: string[]; // для single/multiple
  leftItems?: string[]; // для matching
  rightItems?: string[];
  items?: string[]; // для ranking
  isCorrect: boolean;
  /** PRD-44 FR-10 / PRD-26 FR-08: у измерительного ответа эталона нет, вердикт к нему
   *  неприменим — ни «верно», ни «неверно». Приходит с сервера. */
  measurementOnly?: boolean;
  earnedPoints: number;
  possiblePoints: number;
  levelName?: string;
  levelIndex?: number;
}

interface TopicResult {
  topicId: string;
  topicName: string;
  percent: number;
  passed: boolean | null;
  earnedPoints: number;
  possiblePoints: number;
}

interface AchievedLevel {
  topicId: string;
  topicName: string;
  levelIndex: number | null;
  levelName: string | null;
}

interface AttemptDetail {
  attemptId: string;
  userId?: string;
  username?: string;
  lmsUserId?: string;
  lmsUserName?: string;
  lmsUserEmail?: string;
  testId: string;
  testTitle: string;
  testMode: string;
  startedAt: string | null;
  finishedAt: string | null;
  duration: number | null;
  overallPercent: number;
  earnedPoints: number;
  possiblePoints: number;
  passed: boolean;
  answers: DetailedAnswer[];
  topicResults: TopicResult[];
  achievedLevels?: AchievedLevel[];
  trajectory?: { action: string; levelName: string; message: string }[];
  source: "web" | "lms";
}

// ============================================
// Утилиты для форматирования ответов
// ============================================

/**
 * PRD-57 §6.5: написанный ответ печатается ДОСЛОВНО — разбирая спор, важно видеть, что
 * человек набрал `3,14`, а не то, во что мы это превратили при сравнении.
 */
export function formatUserAnswer(answer: DetailedAnswer): string {
  const { questionType, userAnswer } = answer;

  // Получаем данные вопроса из questionData
  const questionData = (answer as any).questionData || {};
  const options = questionData.options || (answer as any).options;
  const leftItems = questionData.left || (answer as any).leftItems;
  const rightItems = questionData.right || (answer as any).rightItems;
  const items = questionData.items || (answer as any).items;

  if (userAnswer === undefined || userAnswer === null) return "Нет ответа";
  // Текстовый ввод: строка и есть ответ, разбирать нечего.
  if (questionType === "short") return String(userAnswer);

  switch (questionType) {
    case "single":
    case "scale":
      if (typeof userAnswer === "number" && options) {
        return options[userAnswer] || `Вариант ${userAnswer + 1}`;
      }
      if (typeof userAnswer === "string" && options) {
        return userAnswer;
      }
      return String(userAnswer);

    // PRD-44: распределение баллов сервер отдаёт как «утверждение + балл» по КАЖДОМУ
    // утверждению, включая нулевые (ноль отличает «рассмотрел и не дал веса» от «не
    // дошёл»). Без этой ветки в окне печатался сырой JSON ответа.
    case "allocation":
      if (Array.isArray(userAnswer) && typeof userAnswer[0] === "object" && userAnswer[0] !== null) {
        return (userAnswer as Array<{ statement?: string; points?: number }>)
          .map(row => `${row.statement ?? "?"} — ${Number(row.points ?? 0)}`)
          .join("; ");
      }
      // Запасной разбор: сырое распределение «индекс → балл» вместе с подписями вопроса.
      if (typeof userAnswer === "object" && !Array.isArray(userAnswer) && options) {
        const assigned = userAnswer as Record<string, number>;
        return (options as string[])
          .map((label, i) => `${label} — ${Number(assigned[String(i)] ?? 0)}`)
          .join("; ");
      }
      return String(userAnswer);

    case "multiple":
      if (Array.isArray(userAnswer)) {
        // Подписи проверяются ПЕРВЫМИ: сервер отдаёт множественный ответ уже готовыми
        // строками вариантов (`formattedUserAnswer`), а `questionData` приходит рядом —
        // ветка по индексам брала `options["Нанимать молодых…"]`, получала `undefined` и
        // складывала строки в «Вариант Нанимать молодых…1».
        if (typeof userAnswer[0] === "string") {
          return userAnswer.join(", ");
        }
        if (options) {
          return userAnswer.map(i => options[i] || `Вариант ${i + 1}`).join(", ");
        }
        return userAnswer.join(", ");
      }
      return String(userAnswer);

    case "matching":
      if (typeof userAnswer === "object" && !Array.isArray(userAnswer) && leftItems && rightItems) {
        return Object.entries(userAnswer)
          .map(([left, right]) => `${leftItems[+left]} → ${rightItems[+(right as string)]}`)
          .join("; ");
      }
      // Если уже отформатирован
      if (Array.isArray(userAnswer)) {
        return userAnswer.map((p: any) => `${p.left} → ${p.right}`).join("; ");
      }
      return JSON.stringify(userAnswer);

    case "ranking":
      if (Array.isArray(userAnswer)) {
        if (items && typeof userAnswer[0] === "number") {
          return userAnswer.map((i, pos) => `${pos + 1}. ${items[i]}`).join("; ");
        }
        // Если уже отформатирован как массив строк
        if (typeof userAnswer[0] === "string") {
          return userAnswer.map((item, pos) => `${pos + 1}. ${item}`).join("; ");
        }
        return userAnswer.join(" → ");
      }
      return String(userAnswer);

    default:
      return typeof userAnswer === "object" ? JSON.stringify(userAnswer) : String(userAnswer);
  }
}

/**
 * Набор правил сравнения человеческой строкой (PRD-57 §6.1).
 *
 * Пустой набор даёт прочерк, а не пустую строку: блок «Правильный ответ» печатается только
 * при непустом значении, и пустая рамка читалась бы как потеря данных (FR-17).
 */
function formatAnswerRules(correctAnswer: unknown): string {
  const set = (correctAnswer ?? {}) as {
    unit?: string;
    rules?: Array<Record<string, unknown>>;
  };
  const rules = Array.isArray(set.rules) ? set.rules : [];
  if (rules.length === 0) return "—";

  const unit = typeof set.unit === "string" && set.unit.trim() !== "" ? ` ${set.unit.trim()}` : "";
  const parts = rules.map((rule) => {
    if (rule.kind === "number") {
      const tolerance = rule.tolerance as { unit?: string; value?: number } | undefined;
      const spread = tolerance
        ? ` ±${tolerance.value}${tolerance.unit === "pct" ? " %" : unit}`
        : unit;
      return `равно ${rule.value}${spread}`;
    }
    return String(rule.value ?? "");
  });
  return parts.join(", ");
}

/**
 * Эталон задания для АВТОРА.
 *
 * У короткого ответа эталон — набор правил (PRD-57 §6.1), и показывается он здесь именно
 * потому, что адресован автору: ему нужно видеть, что правило ловит. Участнику образец
 * правила не показывается нигде — `Федеральная служба по * надзору` объясняет ему наш
 * синтаксис вместо предмета.
 */
export function formatCorrectAnswer(answer: DetailedAnswer): string {
  const { questionType, correctAnswer } = answer;

  // Получаем данные вопроса из questionData
  const questionData = (answer as any).questionData || {};
  const options = questionData.options || (answer as any).options;
  const leftItems = questionData.left || (answer as any).leftItems;
  const rightItems = questionData.right || (answer as any).rightItems;
  const items = questionData.items || (answer as any).items;

  if (questionType === "short") return formatAnswerRules(correctAnswer);
  if (!correctAnswer) return "—";

  // Если correctAnswer уже отформатирован (массив строк или объекты с текстом)
  if (Array.isArray(correctAnswer)) {
    if (questionType === "multiple" && typeof correctAnswer[0] === "string") {
      return correctAnswer.join(", ");
    }
    if (questionType === "matching" && correctAnswer[0]?.left) {
      return correctAnswer.map((p: any) => `${p.left} → ${p.right}`).join("; ");
    }
    if (questionType === "ranking" && typeof correctAnswer[0] === "string") {
      return correctAnswer.map((item, pos) => `${pos + 1}. ${item}`).join("; ");
    }
  }

  switch (questionType) {
    case "single":
    case "scale":
      const idx = correctAnswer.correctIndex;
      if (typeof idx === "number" && options) {
        return options[idx] || `Вариант ${idx + 1}`;
      }
      // Если уже отформатирован как строка
      if (typeof correctAnswer === "string") {
        return correctAnswer;
      }
      return String(idx);

    case "multiple":
      const indices = correctAnswer.correctIndices;
      if (Array.isArray(indices) && options) {
        return indices.map(i => options[i] || `Вариант ${i + 1}`).join(", ");
      }
      return Array.isArray(indices) ? indices.join(", ") : String(indices);

    case "matching":
      const pairs = correctAnswer.pairs;
      if (Array.isArray(pairs) && leftItems && rightItems) {
        return pairs.map((p: any) => `${leftItems[p.left]} → ${rightItems[p.right]}`).join("; ");
      }
      return JSON.stringify(pairs);

    case "ranking":
      const order = correctAnswer.correctOrder;
      if (Array.isArray(order) && items) {
        return order.map((i, pos) => `${pos + 1}. ${items[i]}`).join("; ");
      }
      return Array.isArray(order) ? order.join(" → ") : String(order);

    default:
      return typeof correctAnswer === "object" ? JSON.stringify(correctAnswer) : String(correctAnswer);
  }
}

// ============================================
// Компонент фильтров

// ============================================
// Карточки статистики

// ============================================
// Таблица попыток

// ============================================
// Модальное окно деталей попытки (ПОЛНОЕ)
// ============================================

function AttemptDetailsDialog({
  attempt,
  open,
  onClose,
  onExport,
}: {
  attempt: CombinedAttempt | null;
  open: boolean;
  onClose: () => void;
  /** Выгрузить это прохождение отдельным файлом. */
  onExport?: (attempt: CombinedAttempt) => void;
}) {
  const { data: details, isLoading } = useQuery<AttemptDetail>({
    queryKey: ["/api/analytics/attempt-details", attempt?.id, attempt?.source],
    queryFn: async () => {
      if (!attempt) throw new Error("No attempt");
      const endpoint =
        attempt.source === "web"
          ? `/api/analytics/attempts/${attempt.id}`
          : `/api/analytics/scorm-attempts/${attempt.id}`;
      const response = await fetch(endpoint, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch");
      const data = await response.json();
      return { ...data, source: attempt.source };
    },
    enabled: open && !!attempt,
  });

  /**
   * Сворачивание карточек ответов. Разбор на два десятка вопросов — стена текста, в
   * которой нужный вопрос ищут прокруткой; свёрнутая карточка оставляет шапку (номер,
   * тема, тип, текст задания, балл и вердикт), и список читается одним экраном.
   *
   * Состояние живёт, пока окно открыто, и по умолчанию РАЗВЁРНУТО: автор пришёл читать
   * ответы, а не раскрывать их по одному, — свернуть все он просит одной кнопкой.
   */
  const fold = useSectionFold((details?.answers ?? []).map((a) => a.questionId));

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "—";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const emptyState = (message: string) => (
    <Box pad={6}>
      <Stack align="center" gap={4}>
        <HelpCircle size={48} color="var(--ou-fg-subtle)" />
        <Text tone="muted">{message}</Text>
      </Stack>
    </Box>
  );

  const overviewContent = details && (
    <Stack gap={4}>
        {/* Основная информация */}
        <Grid minItem="sm" gap={1}>
          <Card>
            <CardBody>
              <Stack gap={1}>
                <Text variant="body-xs" tone="muted">Пользователь</Text>
                <Text variant="body-m" weight="medium">{details.username || details.lmsUserName || "—"}</Text>
                {details.lmsUserEmail && <Text variant="body-xs" tone="muted">{details.lmsUserEmail}</Text>}
              </Stack>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <Stack gap={1}>
                <Text variant="body-xs" tone="muted">Тест</Text>
                <Text variant="body-m" weight="medium">{details.testTitle}</Text>
              </Stack>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <Stack gap={1}>
                <Text variant="body-xs" tone="muted">Время</Text>
                <Cluster gap={1}><Clock size={16} /><Text variant="body-m" weight="medium">{formatDuration(details.duration)}</Text></Cluster>
              </Stack>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <Stack gap={1}>
                <Text variant="body-xs" tone="muted">Дата</Text>
                <Text variant="body-m" weight="medium">
                  {details.finishedAt ? new Date(details.finishedAt).toLocaleString("ru-RU") : "—"}
                </Text>
              </Stack>
            </CardBody>
          </Card>
        </Grid>

        {/* Результат */}
        <Card>
          <CardHeader title="Результат" />
          <CardBody>
            {details.testMode === "adaptive" ? (
              <Cluster gap={4}>
                <Tag tone="info"><CheckCircle />ЗАВЕРШЁН</Tag>
                <Text variant="body-s" tone="muted">Результаты по достигнутым уровням — см. ниже</Text>
              </Cluster>
            ) : (
              <Cluster gap={4}>
                <Stack gap={1} align="center">
                  <Text variant="display-m" weight="bold">{percent(details.overallPercent)}</Text>
                  <Text variant="body-s" tone="muted">{details.earnedPoints} / {details.possiblePoints} баллов</Text>
                </Stack>
                <Box grow>
                  <ProgressBar value={details.overallPercent} tone={details.passed ? "success" : "error"} size="m" hideHeader />
                </Box>
                {details.passed ? (
                  <Tag tone="success"><CheckCircle />СДАН</Tag>
                ) : (
                  <Tag tone="error" variant="solid"><XCircle />НЕ СДАН</Tag>
                )}
              </Cluster>
            )}
          </CardBody>
        </Card>

        {/* Достигнутые уровни (для адаптивных) */}
        {details.achievedLevels && details.achievedLevels.length > 0 && (
          <Card>
            <CardHeader title={<Cluster gap={1}><Layers size={16} />Достигнутые уровни</Cluster>} />
            <CardBody>
              <Stack gap={1}>
                {details.achievedLevels.map((level) => (
                  <Box key={level.topicId} pad={4} surface="muted" radius="l">
                    <Cluster justify="between">
                      <Text weight="medium">{level.topicName}</Text>
                      <Tag variant="outline">{level.levelName || `Уровень ${(level.levelIndex || 0) + 1}`}</Tag>
                    </Cluster>
                  </Box>
                ))}
              </Stack>
            </CardBody>
          </Card>
        )}

        {/*
          PRD-56 FR-23: траектория адаптивного прохождения. Переехала сюда со страницы теста
          вместе со снятым оттуда списком попыток: другого места, где видно, на каком шаге
          участник поднялся и где сорвался, в продукте нет.
        */}
        {details.trajectory && details.trajectory.length > 0 && (
          <Card>
            <CardHeader title="Траектория прохождения" />
            <CardBody>
              <Stack gap={1}>
                {details.trajectory.map((event, index) => (
                  <Cluster key={index} gap={1}>
                    {event.action === "level_up"
                      ? <CheckCircle size={16} color="var(--ou-success-600)" />
                      : <XCircle size={16} color="var(--ou-error-600)" />}
                    <Text variant="body-s">{event.message}</Text>
                  </Cluster>
                ))}
              </Stack>
            </CardBody>
          </Card>
        )}
    </Stack>
  );

  const answersContent = details && (
    <Stack gap={4}>
        {(details.answers?.length ?? 0) > 1 && (
          <div className="tb-fold-toolbar">
            <FoldAllButtons fold={fold} testIdPrefix="attempt-answers" />
          </div>
        )}
        {details.answers?.map((answer, index) => {
          const open = fold.isOpen(answer.questionId);
          /*
            Эталон печатается ТОЛЬКО там, где ответ неверен (согласованный эскиз
            `analytics-attempt-details.html`: «печатается при ratio < 1»). У верного
            ответа это буквальный повтор соседней ячейки — читать нечего, а разбор
            растёт вдвое. У измерительного вопроса эталона нет по природе (PRD-26/PRD-44).
          */
          const showCorrect = !answer.measurementOnly && !answer.isCorrect;
          return (
          <Card key={answer.questionId} variant="outlined">
            <CardBody>
              <Stack gap={4}>
                <Cluster justify="between" align="start" gap={4}>
                  {/*
                    Внутри кнопки только строчные элементы: Stack/Cluster — это `div`,
                    а блочное содержимое в `button` недопустимо, поэтому колонка шапки
                    собрана на `tb-ansfold__*`, как и сам примитив сворачивания.
                  */}
                  <button
                    type="button"
                    className="tb-fold-trigger tb-ansfold__head"
                    aria-expanded={open ? "true" : "false"}
                    aria-label={open ? `Свернуть вопрос ${index + 1}` : `Развернуть вопрос ${index + 1}`}
                    onClick={() => fold.toggle(answer.questionId)}
                    data-testid={`attempt-answer-toggle-${index + 1}`}
                  >
                    {open
                      ? <ChevronDown className="tb-fold-chev" width={16} height={16} aria-hidden="true" />
                      : <ChevronRight className="tb-fold-chev" width={16} height={16} aria-hidden="true" />}
                    <span className="tb-ansfold__title">
                      <span className="tb-ansfold__meta">
                        <Text variant="body-xs" weight="medium" tone="muted">#{index + 1}</Text>
                        {answer.topicName && <Tag size="s">{answer.topicName}</Tag>}
                        {answer.levelName && <Tag tone="accent" size="s">{answer.levelName}</Tag>}
                      </span>
                      {/*
                        Тип вопроса — пиктограмма перед текстом задания, та же, что в
                        «Оценке», «Вкладах вопросов» и дереве содержания. Тег печатал
                        сырое значение колонки (`multiple`, `single`) — по-английски и
                        мимо общей условности.
                      */}
                      <Text weight="medium">
                        <QuestionTypeIcon type={answer.questionType as QuestionType} />
                        {answer.questionPrompt}
                      </Text>
                    </span>
                  </button>
                  <Cluster gap={1}>
                    {answer.measurementOnly
                      ? <Tag size="s">Измерение</Tag>
                      : (
                        <>
                          <Text variant="body-s" weight="medium">{answer.earnedPoints}/{answer.possiblePoints}</Text>
                          {answer.isCorrect
                            ? <CheckCircle size={20} color="var(--ou-success-600)" />
                            : <XCircle size={20} color="var(--ou-error-600)" />}
                        </>
                      )}
                  </Cluster>
                </Cluster>

                {open && (
                  <>
                    <Separator />

                    <Grid minItem="md" gap={1}>
                      <Stack gap={1}>
                        <Text variant="body-xs" tone="muted">Ответ пользователя:</Text>
                        <Box pad={4} radius="l" surface="muted">
                          <Text variant="body-s" tone={answer.measurementOnly ? "default" : (answer.isCorrect ? "success" : "error")}>{formatUserAnswer(answer)}</Text>
                        </Box>
                      </Stack>
                      {showCorrect && (
                        <Stack gap={1}>
                          <Text variant="body-xs" tone="muted">Правильный ответ:</Text>
                          <Box pad={4} radius="l" surface="muted">
                            <Text variant="body-s">{formatCorrectAnswer(answer)}</Text>
                          </Box>
                        </Stack>
                      )}
                    </Grid>
                  </>
                )}
              </Stack>
            </CardBody>
          </Card>
          );
        })}

        {(!details.answers || details.answers.length === 0) && emptyState("Нет данных об ответах")}
    </Stack>
  );

  const topicsContent = details && (
    <Stack gap={4}>
        {details.testMode === "adaptive" ? (
          // Адаптивный — показываем достигнутые уровни
          details.achievedLevels && details.achievedLevels.length > 0 ? (
            details.achievedLevels.map((level) => (
              <Card key={level.topicId}>
                <CardBody>
                  <Cluster justify="between">
                    <Cluster gap={1}>
                      {level.levelName
                        ? <CheckCircle size={20} color="var(--ou-info-600)" />
                        : <XCircle size={20} color="var(--ou-error-600)" />}
                      <Text weight="medium">{level.topicName}</Text>
                    </Cluster>
                    <Tag tone={level.levelName ? "info" : "error"}>{level.levelName || "Не достигнут"}</Tag>
                  </Cluster>
                </CardBody>
              </Card>
            ))
          ) : emptyState("Нет данных по уровням")
        ) : (
          // Стандартный — показываем процент по темам
          details.topicResults?.length > 0 ? (
            details.topicResults.map((topic) => (
              <Card key={topic.topicId}>
                <CardBody>
                  <Stack gap={4}>
                    <Cluster justify="between">
                      <Stack gap={1}>
                        <Text weight="medium">{topic.topicName}</Text>
                        <Text variant="body-s" tone="muted">{topic.earnedPoints} / {topic.possiblePoints} баллов</Text>
                      </Stack>
                      <Cluster gap={1}>
                        <Text variant="display-s" weight="bold">{percent(topic.percent ?? 0)}</Text>
                        {topic.passed !== null && (
                          topic.passed
                            ? <CheckCircle size={24} color="var(--ou-success-600)" />
                            : <XCircle size={24} color="var(--ou-error-600)" />
                        )}
                      </Cluster>
                    </Cluster>
                    <ProgressBar
                      value={topic.percent ?? 0}
                      tone={topic.passed === null ? "accent" : topic.passed ? "success" : "error"}
                      size="s"
                      hideHeader
                    />
                  </Stack>
                </CardBody>
              </Card>
            ))
          ) : emptyState("Нет данных по темам")
        )}
    </Stack>
  );

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="xl"
      title={
        <Cluster gap={1}>
          Детали попытки
          {attempt?.source === "web"
            ? <Tag variant="outline" size="s"><Globe />Web</Tag>
            : <Tag size="s"><Server />LMS</Tag>}
          {details?.testMode === "adaptive" && <Tag tone="accent" size="s"><Layers />Адаптивный</Tag>}
        </Cluster>
      }
      footer={onExport && attempt && (
        <Button
          variant="secondary"
          size="s"
          leadingIcon={<FileDown size={16} />}
          onClick={() => onExport(attempt)}
        >
          Скачать детали
        </Button>
      )}
    >
      {isLoading ? (
        <Box pad={6}><LoadingState message="Загрузка деталей..." /></Box>
      ) : details ? (
        <Tabs
          defaultValue="overview"
          variant="segment"
          align="stretch"
          items={[
            { id: "overview", label: "Обзор", content: overviewContent },
            { id: "answers", label: `Ответы (${details.answers?.length || 0})`, content: answersContent },
            { id: "topics", label: "Темы", content: topicsContent },
          ]}
        />
      ) : (
        <Box pad={6}><Text align="center" tone="muted">Не удалось загрузить детали</Text></Box>
      )}
    </ModalDialog>
  );
}

// ============================================
// Секция статистики по темам

// ============================================
// Главный компонент
// ============================================

export default function AnalyticsPage() {
  const [selectedAttempt, setSelectedAttempt] = useState<CombinedAttempt | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** PRD-54: окно загрузки выгрузки отчёта LMS. */
  /**
   * Очередь «требует внимания» — страницей, а не только вкладкой: число дел стоит на самой
   * вкладке (эскиз prd56-analytics-section), и видно его должно быть до того, как её открыли.
   * Вкладка получает те же данные и второй раз их не запрашивает.
   */
  // Период вкладки (решение владельца 2026-09-25): бейдж считает по нему же.
  const [attentionPeriod, setAttentionPeriod] = useState<AttentionPeriod>(DEFAULT_ATTENTION_PERIOD);
  const { data: attentionData } = useQuery<AttentionData>({
    queryKey: [`/api/analytics/attention?period=${attentionPeriod}`],
  });
  const attentionTotal = attentionData
    ? Object.values(attentionData.counts).reduce((sum, count) => sum + count, 0)
    : null;
  /** PRD-56 FR-03: условия отбора реестра живут в адресе страницы. */
  const [registryFilter, setRegistryFilter] = useRegistryFilter();
  /** PRD-56 FR-04: окно выгрузки отфильтрованного — открывается из панели фильтра реестра. */
  const [exportOpen, setExportOpen] = useState(false);
  /** FR-24: переход «группа → тест» уводит со страницы, поэтому нужен переход маршрутизатора. */
  const [, setLocation] = useLocation();
  /**
   * Отбор, отправленный из реестра в сравнение (FR-07b).
   *
   * Держится состоянием страницы, а не адресом: это не выборка, а НАМЕРЕНИЕ сравнить —
   * пересылать его ссылкой незачем, а вкладка «Срезы» о нём должна узнать сразу.
   */
  const [compareWith, setCompareWith] = useState<RegistryFilter | null>(null);
  /**
   * Открытая вкладка. Держится состоянием, а не умолчанием, ради FR-08: переход из строки
   * среза открывает реестр и должен ПЕРЕКЛЮЧИТЬ экран, а не только подставить условия.
   */
  // Э2: вкладка — в адресе (`?tab=`): «Назад» возвращает на прежнюю, ссылка открывает ту же.
  const [tab, setTab] = useAnalyticsTab(GENERAL_ANALYTICS_TABS, "attempts");

  // PRD-56 FR-12: combined-full и summary сняты вместе с «Обзором». Величины, которые они
  // считали — средний балл и pass rate ПО ВСЕМ тестам, тренды и проблемные темы вне контекста
  // теста, — неинтерпретируемы: смешивают разные пороги, шкалы и популяции. Их место заняли
  // срезы и очередь «требует внимания».

  const { data: tests } = useQuery<{ id: string; title: string }[]>({
    queryKey: ["/api/tests-list"],
    queryFn: async () => {
      const response = await fetch("/api/tests", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch");
      const data = await response.json();
      return data.map((t: any) => ({ id: t.id, title: t.title }));
    },
  });

  const handleViewDetails = (attempt: CombinedAttempt) => {
    setSelectedAttempt(attempt);
    setDetailsOpen(true);
  };

  const handleOpenPassage = (row: RegistryRow) => {
    handleViewDetails({
      id: row.id,
      testId: row.testId,
      testTitle: row.testTitle,
      userId: row.userId ?? undefined,
      username: row.participant,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      duration: row.durationMs === null ? null : Math.round(row.durationMs / 1000),
      // Ноль здесь — не оценка, а отсутствие числа: окно показывает прочерк по своим правилам.
      resultPercent: row.percent ?? 0,
      resultPassed: row.passed === true,
      totalPoints: 0,
      maxPoints: 0,
      source: row.source === "web" ? "web" : "lms",
    });
  };

  /**
   * FR-08: открыть реестр по условиям среза.
   *
   * Условия приходят от вкладки срезов уже вместе с рамкой расчёта — тестом и периодом:
   * у самого среза их нет, они общие для всей вкладки (FR-07e).
   */
  const handleOpenSliceInRegistry = (conditions: Record<string, unknown>) => {
    const list = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    const text = (value: unknown): string | undefined =>
      typeof value === "string" && value ? value : undefined;

    setRegistryFilter({
      testIds: list(conditions.testIds),
      groupIds: list(conditions.groupIds),
      // Вариант и версия приезжают из срезов по этим осям: перевод условий больше не теряет
      // их, и реестр открывается ровно тем составом, что в строке среза (FR-08).
      formIds: list(conditions.formIds),
      snapshotIds: list(conditions.snapshotIds),
      // Оргсрезы (FR-06b) открываются в реестре тем же составом, что в строке.
      organizations: list(conditions.organizations),
      units: list(conditions.units),
      positions: list(conditions.positions),
      sources: list(conditions.sources) as RegistryFilter["sources"],
      outcomes: list(conditions.outcomes) as RegistryFilter["outcomes"],
      ...(text(conditions.from) ? { from: text(conditions.from) } : {}),
      ...(text(conditions.to) ? { to: text(conditions.to) } : {}),
    });
    setTab("attempts");
  };

  /** FR-11: открыть разбор прохождения, из-за которого дело попало в очередь. */
  const handleOpenAttentionPassage = (row: AttentionRow) => {
    if (!row.observationId) return;
    handleViewDetails({
      id: row.observationId,
      testId: row.testId,
      testTitle: row.testTitle,
      userId: row.participantId ?? undefined,
      username: row.participant,
      startedAt: row.startedAt ?? "",
      finishedAt: null,
      duration: null,
      resultPercent: 0,
      resultPassed: false,
      totalPoints: 0,
      maxPoints: 0,
      source: row.source === "web" ? "web" : "lms",
    });
  };

  /**
   * «Скачать детали»: протокол попытки книгой Excel (дефект D3 UX-аудита).
   *
   * Книгу собирает сервер из того же разбора, что показывает окно, — ответ и эталон в ней
   * словами, а не сырым JSON, как было в прежнем CSV, собранном в браузере.
   */
  const handleExportAttempt = async (attempt: CombinedAttempt) => {
    try {
      const endpoint = attempt.source === "web"
        ? `/api/analytics/attempts/${attempt.id}/export/excel`
        : `/api/analytics/scorm-attempts/${attempt.id}/export/excel`;

      const res = await fetch(endpoint, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      const blob = await res.blob();

      // Имя файла задаёт сервер; без заголовка — запасное, по участнику и дате.
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const named = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
      const userName = (attempt.username || attempt.lmsUserName || "user").replace(/[^a-zA-Zа-яА-Я0-9]/g, "_");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = named
        ? decodeURIComponent(named)
        : `attempt_${userName}_${new Date().toISOString().split("T")[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {
      alert("Не удалось скачать данные попытки");
    }
  };


  return (
    // Модульная сетка 4 px (эскиз prd56-analytics-section, дельта 6.2): шапка и вкладки —
    // разные блоки страницы, 4x; тот же шаг держит `ou-shell__main` эскиза.
    <Stack gap={4}>
      {/* Шапка уровня (Э2): общий уровень — корень, крошек нет. */}
      <AnalyticsHeader
        title="Аналитика"
        subtitle="Прохождения, срезы и дела, по которым нужно действие"
        actions={(
          <Button variant="secondary" size="s" leadingIcon={<RefreshCw size={16} />} onClick={() => window.location.reload()}>
            Обновить
          </Button>
        )}
      />

      {/* Табы */}
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          {
            id: "attempts",
            label: "Прохождения",
            content: (
              /*
                PRD-56 FR-01 - FR-04: один список на все источники. Своя панель фильтров,
                постраничность и сортировка в памяти сняты: условия отбора живут в адресе,
                порции приходят с сервера, состав строк книги задаёт тот же фильтр. Карточку
                со счётом прохождений рисует сам реестр — число знает он.
              */
              <PassageRegistry
                filter={registryFilter}
                onFilterChange={setRegistryFilter}
                onOpenPassage={handleOpenPassage}
                // FR-04: выгрузка живёт там же, где фильтр, и берёт его условия. Отдельного
                // набора галочек для состава строк книги в продукте быть не должно — два
                // описания одной выборки однажды разойдутся, и книга перестанет отвечать
                // экрану (эскиз prd56-analytics-section.html, состояние reg-export).
                actions={(
                  <>
                    {/* FR-07b: сравнить набранный отбор со срезом можно НЕ СОХРАНЯЯ его —
                        сохранение нужно, когда срезом будут пользоваться и завтра, а вопрос
                        «чем эти хуже тех» живёт одну минуту. */}
                    <Button
                      variant="secondary"
                      size="s"
                      disabled={countConditions(registryFilter) === 0}
                      onClick={() => {
                        setCompareWith(registryFilter);
                        setTab("slices");
                      }}
                    >
                      Сравнить со срезом
                    </Button>
                    <Button variant="secondary" size="s" onClick={() => setExportOpen(true)}>
                      Экспорт
                    </Button>
                  </>
                )}
              />
            ),
          },
          {
            id: "slices",
            label: "Срезы",
            content: (
              <SlicesTab
                tests={tests ?? []}
                // Условия уходят в сравнение БЕЗ теста: он там рамка расчёта, а не условие
                // отбора (FR-07e), и приезжает отдельным полем.
                adhoc={compareWith
                  ? {
                    groupIds: compareWith.groupIds,
                    sources: compareWith.sources,
                    outcomes: compareWith.outcomes,
                    // Вариант и версия — такие же условия отбора: без них отбор «Вариант Б»
                    // сравнивался бы как тест целиком.
                    formIds: compareWith.formIds,
                    snapshotIds: compareWith.snapshotIds,
                    organizations: compareWith.organizations,
                    units: compareWith.units,
                    positions: compareWith.positions,
                    ...(compareWith.from ? { from: compareWith.from } : {}),
                    ...(compareWith.to ? { to: compareWith.to } : {}),
                  }
                  : null}
                adhocTestId={compareWith?.testIds[0] ?? null}
                onOpenRegistry={handleOpenSliceInRegistry}
                // FR-24, переход «группа → тест»: условия среза едут в адрес аналитики теста,
                // где их читает тот же разбор, что у реестра. Тест в условия не входит — он
                // задан адресом страницы.
                onOpenTestAnalytics={(openTestId, conditions) => {
                  setLocation(testHref(openTestId, { ...EMPTY_FILTER, ...conditionsToFilter(conditions) }));
                }}
              />
            ),
          },
          {
            id: "attention",
            label: "Требует внимания",
            badge: attentionTotal ? attentionTotal : undefined,
            content: (
              <AttentionQueue
                data={attentionData}
                period={attentionPeriod}
                onPeriodChange={setAttentionPeriod}
                onOpenPassage={handleOpenAttentionPassage}
                onOpenRegistry={handleOpenSliceInRegistry}
              />
            ),
          },
        ]}
      />

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        filter={registryFilter}
      />

      {/* Модальное окно деталей */}
      <AttemptDetailsDialog
        attempt={selectedAttempt}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        onExport={handleExportAttempt}
      />
    </Stack>
  );
}

/**
 * @module features/analytics/attempt/attempt-details-dialog
 * @description Окно «Детали попытки»: разбор одного прохождения — ответы, темы, шкалы,
 * показатели, траектория адаптивного теста — и выгрузка протокола книгой Excel.
 *
 * Э3.1: вынесено со страницы общего уровня, чтобы открываться с обоих уровней — из реестра
 * общего уровня и из вкладки «Прохождения» теста. Окно одно: два разбора одного прохождения
 * однажды разошлись бы в подписях и правилах прочерков.
 */
import { useQuery } from "@tanstack/react-query";
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
  FileDown,
} from "lucide-react";
import type { QuestionType } from "@shared/questions/question-type";
import { LoadingState } from "@/components/loading-state";
import { QuestionTypeIcon } from "@/features/tests/editor/sections/question-type-icon";
import { FoldAllButtons, useSectionFold } from "@/features/tests/editor/sections/section-fold";
import { percent } from "../format";
import type { RegistryRow } from "../registry/passage-registry";

// ============================================
// Интерфейсы
// ============================================

/**
 * Прохождение, разбор которого открыт в окне деталей.
 *
 * Это НЕ строка реестра: реестр говорит, что прохождение было, а окно — что в нём произошло.
 * Строка приводится к этой форме при открытии (`handleOpenPassage`).
 */
export interface CombinedAttempt {
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
  difficulty: number | null;
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

export function AttemptDetailsDialog({
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

/**
 * Строка реестра — в форму окна деталей.
 *
 * Реестр говорит, что прохождение было; окно — что в нём произошло. Ноль в результате здесь не
 * оценка, а отсутствие числа: окно показывает прочерк по своим правилам.
 *
 * @param row строка реестра прохождений
 * @returns прохождение для окна деталей
 */
export function attemptOfRegistryRow(row: RegistryRow): CombinedAttempt {
  return {
    id: row.id,
    testId: row.testId,
    testTitle: row.testTitle,
    userId: row.userId ?? undefined,
    username: row.participant,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    duration: row.durationMs === null ? null : Math.round(row.durationMs / 1000),
    resultPercent: row.percent ?? 0,
    resultPassed: row.passed === true,
    totalPoints: 0,
    maxPoints: 0,
    source: row.source === "web" ? "web" : "lms",
  };
}

/**
 * «Скачать детали»: протокол попытки книгой Excel (дефект D3 UX-аудита).
 *
 * Книгу собирает сервер из того же разбора, что показывает окно, — ответ и эталон в ней
 * словами, а не сырым JSON, как было в прежнем CSV, собранном в браузере.
 *
 * @param attempt прохождение, открытое в окне
 */
export async function exportAttemptWorkbook(attempt: CombinedAttempt): Promise<void> {
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
}

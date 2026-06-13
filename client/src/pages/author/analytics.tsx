/**
 * @module pages/author/analytics
 * @description Combined analytics dashboard (web + LMS): summary KPIs, trends,
 * per-test/per-topic stats, an attempts table with a full attempt-details modal,
 * and a configurable Excel export. Rendered entirely with the UniversityRT design
 * system — layout via Stack/Cluster/Grid/Box, typography via Text, data via the
 * DS Table/Card/Tabs/ProgressBar/Select primitives (no raw utility classes).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LoadingState } from "@/components/loading-state";
import {
  Box,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Cluster,
  FormGroup,
  Grid,
  IconButton,
  Input,
  ModalDialog,
  ProgressBar,
  ScrollArea,
  Select,
  Separator,
  Stack,
  Table,
  Tabs,
  Tag,
  Text,
  type TableColumn,
  type Tone,
} from "@universityrt/ui-kit";
import {
  TrendingUp,
  Users,
  Target,
  AlertTriangle,
  CheckCircle,
  FileSpreadsheet,
  Filter,
  Eye,
  Globe,
  Server,
  Download,
  Clock,
  XCircle,
  HelpCircle,
  Layers,
  RefreshCw,
  FileDown,
  TrendingDown,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from "recharts";

// ============================================
// Интерфейсы
// ============================================

interface CombinedSummary {
  totalAttempts: number;
  passedAttempts: number;
  passRate: number;
  avgPercent: number;
  webAttempts: number;
  lmsAttempts: number;
  uniqueWebUsers: number;
  uniqueLmsUsers: number;
  adaptiveAttempts?: number;
  adaptivePassed?: number;
}

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

interface TestStat {
  testId: string;
  testTitle: string;
  totalAttempts: number;
  webAttempts: number;
  lmsAttempts: number;
  passRate: number;
  avgPercent: number;
}

interface TopicStat {
  topicId: string;
  topicName: string;
  totalAnswers: number;
  correctAnswers: number;
  avgPercent: number;
  failureCount: number;
}

interface TrendData {
  date: string;
  attempts: number;
  webAttempts: number;
  lmsAttempts: number;
  avgPercent: number;
  passRate: number;
}

interface CombinedAnalyticsData {
  summary: CombinedSummary;
  attempts: CombinedAttempt[];
  testStats: TestStat[];
  topicStats: TopicStat[];
  trends: TrendData[];
  top5Tests?: { testId: string; testTitle: string }[];
  alerts?: { testId: string; testTitle: string; recentPassRate: number; prevPassRate: number; drop: number }[];
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

interface ExportFilters {
  tests: { id: string; title: string; mode: string; hasWebAttempts: boolean; hasLmsAttempts: boolean }[];
  users: { id: string; username: string; source?: "web" | "lms"; email?: string }[];
  groups: { id: string; name: string; userCount: number; userIds: string[] }[];
  scormPackages?: { id: string; testId: string; testTitle: string }[];
}

interface ExportConfig {
  source: "all" | "web" | "lms";
  testIds: string[];
  userIds: string[];
  groupIds: string[];
  dateFrom: string;
  dateTo: string;
  testMode: "all" | "standard" | "adaptive";
  bestAttemptOnly: boolean;
  bestAttemptCriteria: "percent" | "level_sum" | "level_count";
  includeSheets: {
    summary: boolean;
    attempts: boolean;
    answers: boolean;
    questionStats: boolean;
    levelStats: boolean;
    recommendations: boolean;
  };
}

// ============================================
// Утилиты для форматирования ответов
// ============================================

function formatUserAnswer(answer: DetailedAnswer): string {
  const { questionType, userAnswer } = answer;

  // Получаем данные вопроса из questionData
  const questionData = (answer as any).questionData || {};
  const options = questionData.options || (answer as any).options;
  const leftItems = questionData.left || (answer as any).leftItems;
  const rightItems = questionData.right || (answer as any).rightItems;
  const items = questionData.items || (answer as any).items;

  if (userAnswer === undefined || userAnswer === null) return "Нет ответа";

  switch (questionType) {
    case "single":
      if (typeof userAnswer === "number" && options) {
        return options[userAnswer] || `Вариант ${userAnswer + 1}`;
      }
      if (typeof userAnswer === "string" && options) {
        return userAnswer;
      }
      return String(userAnswer);

    case "multiple":
      if (Array.isArray(userAnswer)) {
        if (options) {
          return userAnswer.map(i => options[i] || `Вариант ${i + 1}`).join(", ");
        }
        // Если userAnswer уже отформатирован как массив строк
        if (typeof userAnswer[0] === "string") {
          return userAnswer.join(", ");
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

function formatCorrectAnswer(answer: DetailedAnswer): string {
  const { questionType, correctAnswer } = answer;

  // Получаем данные вопроса из questionData
  const questionData = (answer as any).questionData || {};
  const options = questionData.options || (answer as any).options;
  const leftItems = questionData.left || (answer as any).leftItems;
  const rightItems = questionData.right || (answer as any).rightItems;
  const items = questionData.items || (answer as any).items;

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

function FiltersBar({
  source,
  onSourceChange,
  testId,
  onTestIdChange,
  tests,
}: {
  source: "all" | "web" | "lms";
  onSourceChange: (v: "all" | "web" | "lms") => void;
  testId: string;
  onTestIdChange: (v: string) => void;
  tests: { id: string; title: string }[];
}) {
  return (
    <Box pad={4} surface="muted" radius="l" border>
      <Cluster gap={4}>
        <Cluster gap={2}>
          <Filter size={16} color="var(--ou-fg-muted)" />
          <Text variant="body-s" weight="medium">Фильтры:</Text>
        </Cluster>

        <Cluster gap={2}>
          <Text variant="body-s" tone="muted">Источник:</Text>
          <Select<"all" | "web" | "lms">
            value={source}
            onChange={onSourceChange}
            options={[
              { value: "all", label: <Cluster gap={2}><Users size={12} />Все</Cluster> },
              { value: "web", label: <Cluster gap={2}><Globe size={12} />Web</Cluster> },
              { value: "lms", label: <Cluster gap={2}><Server size={12} />LMS</Cluster> },
            ]}
          />
        </Cluster>

        <Cluster gap={2}>
          <Text variant="body-s" tone="muted">Тест:</Text>
          <Select
            value={testId}
            onChange={onTestIdChange}
            placeholder="Все тесты"
            options={[
              { value: "all", label: "Все тесты" },
              ...tests.map((test) => ({ value: test.id, label: test.title })),
            ]}
          />
        </Cluster>

        {(source !== "all" || testId !== "all") && (
          <Button
            variant="ghost"
            size="s"
            onClick={() => {
              onSourceChange("all");
              onTestIdChange("all");
            }}
          >
            Сбросить
          </Button>
        )}
      </Cluster>
    </Box>
  );
}

// ============================================
// Карточки статистики
// ============================================

function SummaryCards({ summary, source }: { summary: CombinedSummary; source: "all" | "web" | "lms" }) {
  return (
    <Grid minItem="sm" gap={4}>
      <Card>
        <CardHeader title="Всего попыток" trail={<Users size={16} color="var(--ou-fg-muted)" />} />
        <CardBody>
          <Text variant="display-s" weight="bold">{summary.totalAttempts}</Text>
          {source === "all" && (
            <Cluster gap={2}>
              <Cluster gap={1}><Globe size={12} color="var(--ou-fg-muted)" /><Text variant="body-xs" tone="muted">{summary.webAttempts}</Text></Cluster>
              <Text variant="body-xs" tone="subtle">|</Text>
              <Cluster gap={1}><Server size={12} color="var(--ou-fg-muted)" /><Text variant="body-xs" tone="muted">{summary.lmsAttempts}</Text></Cluster>
            </Cluster>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Успешных" trail={<CheckCircle size={16} color="var(--ou-success-600)" />} />
        <CardBody>
          <Text variant="display-s" weight="bold" tone="success">{summary.passedAttempts}</Text>
          <Text as="p" variant="body-xs" tone="muted">
            из {summary.totalAttempts} ({summary.passRate.toFixed(0)}%)
          </Text>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Pass Rate" trail={<Target size={16} color="var(--ou-fg-muted)" />} />
        <CardBody>
          <Stack gap={2}>
            <Text variant="display-s" weight="bold">{summary.passRate.toFixed(1)}%</Text>
            <ProgressBar value={summary.passRate} tone="accent" size="s" hideHeader />
          </Stack>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Средний балл" trail={<TrendingUp size={16} color="var(--ou-fg-muted)" />} />
        <CardBody>
          <Stack gap={2}>
            <Text variant="display-s" weight="bold">{summary.avgPercent.toFixed(1)}%</Text>
            <ProgressBar value={summary.avgPercent} tone="accent" size="s" hideHeader />
            {(summary.adaptiveAttempts ?? 0) > 0 && (
              <Text variant="body-xs" tone="muted">
                + {summary.adaptiveAttempts} адаптивных ({summary.adaptivePassed} завершили)
              </Text>
            )}
          </Stack>
        </CardBody>
      </Card>
    </Grid>
  );
}

// ============================================
// Таблица попыток
// ============================================

function AttemptsTable({
  attempts,
  source,
  onViewDetails,
  sortCol,
  sortDir,
  onSort,
  onExport,
}: {
  attempts: CombinedAttempt[];
  source: "all" | "web" | "lms";
  onViewDetails: (attempt: CombinedAttempt) => void;
  sortCol?: "date" | "result" | "user" | "test";
  sortDir?: "asc" | "desc";
  onSort?: (col: "date" | "result" | "user" | "test") => void;
  onExport?: (attempt: CombinedAttempt) => void;
}) {
  if (attempts.length === 0) {
    return (
      <Stack align="center" gap={3}>
        <Box pad={8}>
          <Stack align="center" gap={3}>
            <HelpCircle size={48} color="var(--ou-fg-subtle)" />
            <Text tone="muted">Нет данных о попытках</Text>
          </Stack>
        </Box>
      </Stack>
    );
  }

  const columns: TableColumn<CombinedAttempt>[] = [
    ...(source === "all"
      ? [{
        key: "source",
        header: "Источник",
        width: "90px",
        render: (a: CombinedAttempt) =>
          a.source === "web"
            ? <Tag variant="outline" size="s"><Globe />Web</Tag>
            : <Tag size="s"><Server />LMS</Tag>,
      } as TableColumn<CombinedAttempt>]
      : []),
    {
      key: "user",
      header: "Пользователь",
      sortable: true,
      render: (a) => (
        <Text variant="body-s" weight="medium">
          {a.source === "web"
            ? (a.username || "—")
            : (a.lmsUserName || a.lmsUserEmail || a.lmsUserId || "—")}
        </Text>
      ),
    },
    ...(source !== "web"
      ? [{
        key: "email",
        header: "Email",
        render: (a: CombinedAttempt) => (
          <Text variant="body-xs" tone="muted">
            {a.source === "lms" ? (a.lmsUserEmail || "—") : (a.userEmail || "—")}
          </Text>
        ),
      } as TableColumn<CombinedAttempt>]
      : []),
    {
      key: "test",
      header: "Тест",
      sortable: true,
      render: (a) => <Text variant="body-s">{a.testTitle || "—"}</Text>,
    },
    {
      key: "date",
      header: "Дата",
      width: "150px",
      sortable: true,
      render: (a) => (
        <Text variant="body-xs" tone="muted">
          {a.finishedAt
            ? new Date(a.finishedAt).toLocaleString("ru-RU", {
              day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
            })
            : "В процессе"}
        </Text>
      ),
    },
    {
      key: "result",
      header: "Результат",
      width: "110px",
      align: "right",
      sortable: true,
      render: (a) =>
        a.isAdaptive
          ? <Text variant="body-s" tone="muted">{a.achievedTopics ?? 0}/{a.totalTopics ?? 0} тем</Text>
          : <Text variant="heading-s" weight="bold">{a.resultPercent?.toFixed(0) || 0}%</Text>,
    },
    {
      key: "status",
      header: "Статус",
      width: "120px",
      align: "center",
      render: (a) =>
        a.isAdaptive
          ? <Tag tone="info" size="s"><CheckCircle />Завершён</Tag>
          : a.resultPassed
            ? <Tag tone="success" size="s"><CheckCircle />Сдан</Tag>
            : <Tag tone="error" variant="solid" size="s"><XCircle />Не сдан</Tag>,
    },
    {
      key: "actions",
      header: "",
      width: "96px",
      align: "center",
      render: (a) => (
        <Cluster gap={1} justify="center" wrap={false}>
          <IconButton
            variant="ghost"
            size="s"
            aria-label="Детали попытки"
            icon={<Eye size={16} />}
            onClick={(e) => { e.stopPropagation(); onViewDetails(a); }}
          />
          {onExport && (
            <IconButton
              variant="ghost"
              size="s"
              aria-label="Скачать детали попытки"
              title="Скачать детали попытки"
              icon={<FileDown size={16} />}
              onClick={(e) => { e.stopPropagation(); onExport(a); }}
            />
          )}
        </Cluster>
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      rows={attempts}
      rowKey={(a) => `${a.source}-${a.id}`}
      onRowClick={(a) => onViewDetails(a)}
      sortKey={sortCol}
      sortDir={sortDir}
      onSort={(key) => onSort?.(key as "date" | "result" | "user" | "test")}
    />
  );
}

// ============================================
// Модальное окно деталей попытки (ПОЛНОЕ)
// ============================================

function AttemptDetailsDialog({
  attempt,
  open,
  onClose,
}: {
  attempt: CombinedAttempt | null;
  open: boolean;
  onClose: () => void;
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

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "—";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const emptyState = (message: string) => (
    <Box pad={8}>
      <Stack align="center" gap={3}>
        <HelpCircle size={48} color="var(--ou-fg-subtle)" />
        <Text tone="muted">{message}</Text>
      </Stack>
    </Box>
  );

  const overviewContent = details && (
    <ScrollArea maxH="xl">
      <Stack gap={6}>
        {/* Основная информация */}
        <Grid minItem="sm" gap={4}>
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
              <Cluster gap={6}>
                <Stack gap={1} align="center">
                  <Text variant="display-m" weight="bold">{details.overallPercent?.toFixed(0)}%</Text>
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
            <CardHeader title={<Cluster gap={2}><Layers size={16} />Достигнутые уровни</Cluster>} />
            <CardBody>
              <Stack gap={2}>
                {details.achievedLevels.map((level) => (
                  <Box key={level.topicId} pad={3} surface="muted" radius="l">
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
      </Stack>
    </ScrollArea>
  );

  const answersContent = details && (
    <ScrollArea maxH="xl">
      <Stack gap={3}>
        {details.answers?.map((answer, index) => (
          <Card key={answer.questionId} variant="outlined">
            <CardBody>
              <Stack gap={3}>
                <Cluster justify="between" align="start" gap={4}>
                  <Stack gap={1}>
                    <Cluster gap={2}>
                      <Text variant="body-xs" weight="medium" tone="muted">#{index + 1}</Text>
                      <Tag variant="outline" size="s">{answer.questionType}</Tag>
                      {answer.topicName && <Tag size="s">{answer.topicName}</Tag>}
                      {answer.levelName && <Tag tone="accent" size="s">{answer.levelName}</Tag>}
                    </Cluster>
                    <Text weight="medium">{answer.questionPrompt}</Text>
                  </Stack>
                  <Cluster gap={2}>
                    <Text variant="body-s" weight="medium">{answer.earnedPoints}/{answer.possiblePoints}</Text>
                    {answer.isCorrect
                      ? <CheckCircle size={20} color="var(--ou-success-600)" />
                      : <XCircle size={20} color="var(--ou-error-600)" />}
                  </Cluster>
                </Cluster>

                <Separator />

                <Grid minItem="md" gap={4}>
                  <Stack gap={1}>
                    <Text variant="body-xs" tone="muted">Ответ пользователя:</Text>
                    <Box pad={3} radius="l" surface={answer.isCorrect ? "muted" : "muted"}>
                      <Text variant="body-s" tone={answer.isCorrect ? "success" : "error"}>{formatUserAnswer(answer)}</Text>
                    </Box>
                  </Stack>
                  <Stack gap={1}>
                    <Text variant="body-xs" tone="muted">Правильный ответ:</Text>
                    <Box pad={3} radius="l" surface="muted">
                      <Text variant="body-s">{formatCorrectAnswer(answer)}</Text>
                    </Box>
                  </Stack>
                </Grid>
              </Stack>
            </CardBody>
          </Card>
        ))}

        {(!details.answers || details.answers.length === 0) && emptyState("Нет данных об ответах")}
      </Stack>
    </ScrollArea>
  );

  const topicsContent = details && (
    <ScrollArea maxH="xl">
      <Stack gap={3}>
        {details.testMode === "adaptive" ? (
          // Адаптивный — показываем достигнутые уровни
          details.achievedLevels && details.achievedLevels.length > 0 ? (
            details.achievedLevels.map((level) => (
              <Card key={level.topicId}>
                <CardBody>
                  <Cluster justify="between">
                    <Cluster gap={2}>
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
                  <Stack gap={3}>
                    <Cluster justify="between">
                      <Stack gap={1}>
                        <Text weight="medium">{topic.topicName}</Text>
                        <Text variant="body-s" tone="muted">{topic.earnedPoints} / {topic.possiblePoints} баллов</Text>
                      </Stack>
                      <Cluster gap={3}>
                        <Text variant="display-s" weight="bold">{(topic.percent ?? 0).toFixed(0)}%</Text>
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
    </ScrollArea>
  );

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="xl"
      title={
        <Cluster gap={3}>
          Детали попытки
          {attempt?.source === "web"
            ? <Tag variant="outline" size="s"><Globe />Web</Tag>
            : <Tag size="s"><Server />LMS</Tag>}
          {details?.testMode === "adaptive" && <Tag tone="accent" size="s"><Layers />Адаптивный</Tag>}
        </Cluster>
      }
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

function TopicStatsSection({ topicStats }: { topicStats: TopicStat[] }) {
  const sortedByFailure = [...topicStats]
    .filter((t) => t.failureCount > 0)
    .sort((a, b) => b.failureCount - a.failureCount)
    .slice(0, 5);

  return (
    <Grid minItem="lg" gap={6}>
      {/* Статистика по темам */}
      <Card>
        <CardHeader title="Статистика по темам" />
        <CardBody>
          <Stack gap={3}>
            {topicStats.length > 0 ? (
              topicStats.map((topic) => (
                <Cluster key={topic.topicId} justify="between" gap={4}>
                  <Stack gap={1} grow>
                    <Text weight="medium" truncate>{topic.topicName}</Text>
                    <Text variant="body-xs" tone="muted">{topic.totalAnswers} ответов | {topic.correctAnswers} верных</Text>
                  </Stack>
                  <Tag tone={topic.avgPercent >= 70 ? "success" : topic.avgPercent >= 50 ? "warning" : "error"}>
                    {topic.avgPercent.toFixed(0)}%
                  </Tag>
                </Cluster>
              ))
            ) : (
              <Text align="center" tone="muted">Нет данных</Text>
            )}
          </Stack>
        </CardBody>
      </Card>

      {/* Проблемные темы */}
      <Card>
        <CardHeader title={<Cluster gap={2}><AlertTriangle size={20} color="var(--ou-warning-600)" />Проблемные темы</Cluster>} />
        <CardBody>
          <Stack gap={3}>
            {sortedByFailure.length > 0 ? (
              sortedByFailure.map((topic, idx) => (
                <Cluster key={topic.topicId} justify="between" gap={4}>
                  <Cluster gap={3} grow wrap={false}>
                    <Tag tone="error" variant="solid" size="s">{idx + 1}</Tag>
                    <Text weight="medium" truncate>{topic.topicName}</Text>
                  </Cluster>
                  <Tag tone="error">{topic.failureCount} ошибок</Tag>
                </Cluster>
              ))
            ) : (
              <Stack align="center" gap={2}>
                <CheckCircle size={32} color="var(--ou-success-600)" />
                <Text tone="muted">Нет проблемных тем!</Text>
              </Stack>
            )}
          </Stack>
        </CardBody>
      </Card>
    </Grid>
  );
}

// ============================================
// Секция экспорта
// ============================================

function ExportSection() {
  const [isExporting, setIsExporting] = useState(false);

  const { data: filters, isLoading: filtersLoading } = useQuery<ExportFilters>({
    queryKey: ["/api/export/filters"],
  });

  const [config, setConfig] = useState<ExportConfig>({
    source: "all",
    testIds: [],
    userIds: [],
    groupIds: [],
    dateFrom: "",
    dateTo: "",
    testMode: "all",
    bestAttemptOnly: false,
    bestAttemptCriteria: "percent",
    includeSheets: {
      summary: true,
      attempts: true,
      answers: true,
      questionStats: true,
      levelStats: true,
      recommendations: true,
    },
  });

  const [testSearch, setTestSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");

  const handleTestToggle = (testId: string) => {
    setConfig(prev => ({
      ...prev,
      testIds: prev.testIds.includes(testId)
        ? prev.testIds.filter(id => id !== testId)
        : [...prev.testIds, testId],
    }));
  };

  const handleSelectAllTests = () => {
    if (!filters) return;
    let testsToSelect = filters.tests;
    if (config.testMode === "standard") testsToSelect = testsToSelect.filter(t => t.mode !== "adaptive");
    else if (config.testMode === "adaptive") testsToSelect = testsToSelect.filter(t => t.mode === "adaptive");
    if (testSearch) testsToSelect = testsToSelect.filter(t => t.title.toLowerCase().includes(testSearch.toLowerCase()));
    const allSelected = testsToSelect.every(t => config.testIds.includes(t.id));
    setConfig(prev => ({ ...prev, testIds: allSelected ? [] : testsToSelect.map(t => t.id) }));
  };

  const handleUserToggle = (userId: string) => {
    setConfig(prev => ({
      ...prev,
      userIds: prev.userIds.includes(userId) ? prev.userIds.filter(id => id !== userId) : [...prev.userIds, userId],
    }));
  };

  const handleSelectAllUsers = () => {
    if (!filters) return;
    let usersToSelect = filters.users;
    if (userSearch) usersToSelect = usersToSelect.filter(u => u.username.toLowerCase().includes(userSearch.toLowerCase()));
    const allSelected = usersToSelect.every(u => config.userIds.includes(u.id));
    setConfig(prev => ({ ...prev, userIds: allSelected ? [] : usersToSelect.map(u => u.id) }));
  };

  const handleGroupToggle = (groupId: string) => {
    setConfig(prev => {
      const newGroupIds = prev.groupIds.includes(groupId) ? prev.groupIds.filter(id => id !== groupId) : [...prev.groupIds, groupId];
      return { ...prev, groupIds: newGroupIds, userIds: [] };
    });
  };

  const handleSelectAllGroups = () => {
    if (!filters) return;
    let groupsToSelect = filters.groups;
    if (groupSearch) groupsToSelect = groupsToSelect.filter(g => g.name.toLowerCase().includes(groupSearch.toLowerCase()));
    const allSelected = groupsToSelect.every(g => config.groupIds.includes(g.id));
    setConfig(prev => ({ ...prev, groupIds: allSelected ? [] : groupsToSelect.map(g => g.id), userIds: [] }));
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const handleExport = async () => {
    if (config.testIds.length === 0) { alert("Выберите хотя бы один тест"); return; }
    setIsExporting(true);
    try {
      if (config.source === "lms") {
        const response = await fetch("/api/export/excel-lms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config), credentials: "include" });
        if (!response.ok) throw new Error("LMS export failed");
        downloadBlob(await response.blob(), `analytics_lms_${new Date().toISOString().split("T")[0]}.xlsx`);
      } else {
        const response = await fetch("/api/export/excel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config), credentials: "include" });
        if (!response.ok) throw new Error("Export failed");
        downloadBlob(await response.blob(), `analytics_${config.source}_${new Date().toISOString().split("T")[0]}.xlsx`);
      }
    } catch (error) {
      alert("Ошибка при создании отчёта");
    } finally {
      setIsExporting(false);
    }
  };

  const filteredTests = filters?.tests.filter(test => {
    if (config.source === "web" && !test.hasWebAttempts) return false;
    if (config.source === "lms" && !test.hasLmsAttempts) return false;
    if (config.testMode === "standard" && test.mode === "adaptive") return false;
    if (config.testMode === "adaptive" && test.mode !== "adaptive") return false;
    if (testSearch && !test.title.toLowerCase().includes(testSearch.toLowerCase())) return false;
    return true;
  }) || [];

  const groupUserIds = new Set<string>();
  if (config.groupIds.length > 0 && filters?.groups) {
    for (const groupId of config.groupIds) {
      const group = filters.groups.find(g => g.id === groupId);
      if (group) group.userIds.forEach(id => groupUserIds.add(id));
    }
  }

  const filteredUsers = filters?.users.filter(user => {
    if (config.source === "web" && user.source === "lms") return false;
    if (config.source === "lms" && user.source === "web") return false;
    if (config.source !== "lms" && config.groupIds.length > 0 && !groupUserIds.has(user.id)) return false;
    if (userSearch && !user.username.toLowerCase().includes(userSearch.toLowerCase())) return false;
    return true;
  }) || [];

  const filteredGroups = filters?.groups.filter(group => {
    if (groupSearch && !group.name.toLowerCase().includes(groupSearch.toLowerCase())) return false;
    return true;
  }) || [];

  const hasAdaptiveSelected = config.testIds.some(id => filters?.tests.find(t => t.id === id)?.mode === "adaptive");

  const sheetOptions: { key: keyof ExportConfig["includeSheets"]; label: string; adaptive?: boolean }[] = [
    { key: "summary", label: "Сводка" },
    { key: "attempts", label: "Попытки" },
    { key: "answers", label: "Ответы" },
    { key: "questionStats", label: "Статистика вопросов" },
    { key: "levelStats", label: "Статистика уровней", adaptive: true },
    { key: "recommendations", label: "Рекомендации", adaptive: true },
  ];

  return (
    <Card>
      <CardHeader title={<Cluster gap={2}><FileSpreadsheet size={20} />Экспорт отчёта</Cluster>} />
      <CardBody>
        {filtersLoading ? (
          <LoadingState message="Загрузка фильтров..." />
        ) : (
          <Stack gap={6}>
            <FormGroup columns="two">
              <Select<"all" | "web" | "lms">
                label="Источник данных"
                fullWidth
                value={config.source}
                onChange={(v) => setConfig(prev => ({ ...prev, source: v }))}
                options={[
                  { value: "all", label: "Все источники" },
                  { value: "web", label: "Только Web" },
                  { value: "lms", label: "Только LMS" },
                ]}
              />
              <Select<"all" | "standard" | "adaptive">
                label="Режим тестов"
                fullWidth
                value={config.testMode}
                onChange={(v) => setConfig(prev => ({ ...prev, testMode: v, testIds: [] }))}
                options={[
                  { value: "all", label: "Все тесты" },
                  { value: "standard", label: "Стандартные" },
                  { value: "adaptive", label: "Адаптивные" },
                ]}
              />
            </FormGroup>

            <Stack gap={2}>
              <Cluster justify="between">
                <Text variant="body-s" weight="medium">Тесты ({config.testIds.length} выбрано)</Text>
                <Button variant="ghost" size="s" onClick={handleSelectAllTests}>
                  {filteredTests.every(t => config.testIds.includes(t.id)) && filteredTests.length > 0 ? "Снять все" : "Выбрать все"}
                </Button>
              </Cluster>
              <Input placeholder="Поиск тестов..." value={testSearch} onChange={(e) => setTestSearch(e.target.value)} fullWidth />
              <Box border radius="l" pad={2}>
                <ScrollArea maxH="sm">
                  <Stack gap={1}>
                    {filteredTests.map((test) => (
                      <Cluster key={test.id} justify="between" gap={2}>
                        <Checkbox label={test.title} checked={config.testIds.includes(test.id)} onChange={() => handleTestToggle(test.id)} />
                        <Tag variant="outline" size="s">{test.mode === "adaptive" ? "Адапт." : "Станд."}</Tag>
                      </Cluster>
                    ))}
                    {filteredTests.length === 0 && <Text align="center" variant="body-s" tone="muted">Нет тестов</Text>}
                  </Stack>
                </ScrollArea>
              </Box>
            </Stack>

            <FormGroup columns="two">
              <Input label="Дата от" type="date" fullWidth value={config.dateFrom} onChange={(e) => setConfig(prev => ({ ...prev, dateFrom: e.target.value }))} />
              <Input label="Дата до" type="date" fullWidth value={config.dateTo} onChange={(e) => setConfig(prev => ({ ...prev, dateTo: e.target.value }))} />
            </FormGroup>

            {config.source !== "lms" && filters?.groups && filters.groups.length > 0 && (
              <Stack gap={2}>
                <Cluster justify="between">
                  <Text variant="body-s" weight="medium">Группы ({config.groupIds.length > 0 ? config.groupIds.length : "все"})</Text>
                  <Button variant="ghost" size="s" onClick={handleSelectAllGroups}>
                    {filteredGroups.every(g => config.groupIds.includes(g.id)) && filteredGroups.length > 0 ? "Снять все" : "Выбрать все"}
                  </Button>
                </Cluster>
                <Input placeholder="Поиск групп..." value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)} fullWidth />
                <Box border radius="l" pad={2}>
                  <ScrollArea maxH="xs">
                    <Stack gap={1}>
                      {filteredGroups.map((group) => (
                        <Checkbox
                          key={group.id}
                          label={<>{group.name} <Text variant="body-xs" tone="muted">({group.userCount})</Text></>}
                          checked={config.groupIds.includes(group.id)}
                          onChange={() => handleGroupToggle(group.id)}
                        />
                      ))}
                    </Stack>
                  </ScrollArea>
                </Box>
              </Stack>
            )}

            <Stack gap={2}>
              <Cluster justify="between">
                <Text variant="body-s" weight="medium">Пользователи ({config.userIds.length > 0 ? config.userIds.length : "все"})</Text>
                <Button variant="ghost" size="s" onClick={handleSelectAllUsers}>
                  {filteredUsers.every(u => config.userIds.includes(u.id)) && filteredUsers.length > 0 ? "Снять всех" : "Выбрать всех"}
                </Button>
              </Cluster>
              <Input placeholder="Поиск пользователей..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} fullWidth />
              <Box border radius="l" pad={2}>
                <ScrollArea maxH="xs">
                  <Stack gap={1}>
                    {filteredUsers.map((user) => (
                      <Checkbox key={user.id} label={user.username} checked={config.userIds.includes(user.id)} onChange={() => handleUserToggle(user.id)} />
                    ))}
                    {filteredUsers.length === 0 && <Text align="center" variant="body-s" tone="muted">Нет пользователей</Text>}
                  </Stack>
                </ScrollArea>
              </Box>
            </Stack>

            <Box pad={4} surface="muted" radius="l">
              <Stack gap={3}>
                <Checkbox
                  label="Только лучшая попытка каждого пользователя"
                  checked={config.bestAttemptOnly}
                  onChange={(e) => setConfig(prev => ({ ...prev, bestAttemptOnly: e.target.checked }))}
                />
                {config.bestAttemptOnly && hasAdaptiveSelected && (
                  <Select<"percent" | "level_sum" | "level_count">
                    label="Критерий лучшей попытки (для адаптивных)"
                    fullWidth
                    value={config.bestAttemptCriteria}
                    onChange={(v) => setConfig(prev => ({ ...prev, bestAttemptCriteria: v }))}
                    options={[
                      { value: "percent", label: "По проценту" },
                      { value: "level_sum", label: "По сумме уровней" },
                      { value: "level_count", label: "По количеству уровней" },
                    ]}
                  />
                )}
              </Stack>
            </Box>

            <Stack gap={2}>
              <Text variant="body-s" weight="medium">Листы в отчёте</Text>
              <Grid minItem="sm" gap={3}>
                {sheetOptions.map(({ key, label, adaptive }) => (
                  <Checkbox
                    key={key}
                    label={<>{label}{adaptive && <Text variant="body-xs" tone="muted"> (адапт.)</Text>}</>}
                    checked={config.includeSheets[key]}
                    onChange={(e) => setConfig(prev => ({ ...prev, includeSheets: { ...prev.includeSheets, [key]: e.target.checked } }))}
                  />
                ))}
              </Grid>
            </Stack>

            <Button
              fullWidth
              onClick={handleExport}
              disabled={isExporting || config.testIds.length === 0}
              leadingIcon={isExporting ? undefined : <Download size={16} />}
              loading={isExporting}
            >
              {isExporting ? "Создание отчёта..." : "Создать отчёт"}
            </Button>
          </Stack>
        )}
      </CardBody>
    </Card>
  );
}

// ============================================
// Главный компонент
// ============================================

export default function AnalyticsPage() {
  const [source, setSource] = useState<"all" | "web" | "lms">("all");
  const [testId, setTestId] = useState<string>("all");
  const [selectedAttempt, setSelectedAttempt] = useState<CombinedAttempt | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [attemptsPage, setAttemptsPage] = useState(1);
  const ATTEMPTS_PER_PAGE = 25;
  const [sortCol, setSortCol] = useState<"date" | "result" | "user" | "test">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [trendMode, setTrendMode] = useState<"total" | "byTest">("total");

  const queryParams = new URLSearchParams({ source });
  if (testId !== "all") queryParams.append("testId", testId);

  const { data, isLoading, error, refetch, isFetching } = useQuery<CombinedAnalyticsData>({
    queryKey: ["/api/analytics/combined-full", source, testId],
    queryFn: async () => {
      const response = await fetch(`/api/analytics/combined-full?${queryParams}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch");
      return response.json();
    },
    refetchInterval: false,
    staleTime: 60000,
  });

  const { data: summaryData, isLoading: summaryLoading, refetch: refetchSummary } = useQuery<CombinedSummary>({
    queryKey: ["/api/analytics/summary", source, testId],
    queryFn: async () => {
      const response = await fetch(`/api/analytics/summary?${queryParams}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch summary");
      return response.json();
    },
    refetchInterval: false,
    staleTime: 60000,
  });

  const { data: tests } = useQuery<{ id: string; title: string }[]>({
    queryKey: ["/api/tests-list"],
    queryFn: async () => {
      const response = await fetch("/api/tests", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch");
      const data = await response.json();
      return data.map((t: any) => ({ id: t.id, title: t.title }));
    },
  });

  const handleSourceChange = (v: "all" | "web" | "lms") => {
    setSource(v);
    setAttemptsPage(1);
  };

  const handleTestIdChange = (v: string) => {
    setTestId(v);
    setAttemptsPage(1);
  };

  const handleDateFromChange = (v: string) => {
    setDateFrom(v);
    setAttemptsPage(1);
  };

  const handleDateToChange = (v: string) => {
    setDateTo(v);
    setAttemptsPage(1);
  };

  const handleUserSearchChange = (v: string) => {
    setUserSearch(v);
    setAttemptsPage(1);
  };

  const filteredAttempts = (data?.attempts || []).filter(a => {
    if (dateFrom && a.finishedAt && new Date(a.finishedAt) < new Date(dateFrom)) return false;
    if (dateTo && a.finishedAt && new Date(a.finishedAt) > new Date(dateTo + "T23:59:59")) return false;
    if (userSearch) {
      const q = userSearch.toLowerCase();
      const name = (a.username || a.lmsUserName || "").toLowerCase();
      const email = (a.userEmail || a.lmsUserEmail || "").toLowerCase();
      if (!name.includes(q) && !email.includes(q)) return false;
    }
    return true;
  });

  const handleSort = (col: "date" | "result" | "user" | "test") => {
    if (sortCol === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
    setAttemptsPage(1);
  };

  const sortedAttempts = [...filteredAttempts].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortCol) {
      case "date":
        return dir * (new Date(a.finishedAt || 0).getTime() - new Date(b.finishedAt || 0).getTime());
      case "result":
        return dir * ((a.resultPercent || 0) - (b.resultPercent || 0));
      case "user":
        return dir * (a.username || a.lmsUserName || "").localeCompare(b.username || b.lmsUserName || "");
      case "test":
        return dir * (a.testTitle || "").localeCompare(b.testTitle || "");
      default:
        return 0;
    }
  });

  const handleViewDetails = (attempt: CombinedAttempt) => {
    setSelectedAttempt(attempt);
    setDetailsOpen(true);
  };

  const handleExportAttempt = async (attempt: CombinedAttempt) => {
    try {
      const endpoint = attempt.source === "web"
        ? `/api/analytics/attempts/${attempt.id}`
        : `/api/analytics/scorm-attempts/${attempt.id}`;

      const res = await fetch(endpoint, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      const details = await res.json();

      const rows: any[][] = [
        ["Попытка", attempt.id],
        ["Пользователь", attempt.username || attempt.lmsUserName || "—"],
        ["Email", attempt.userEmail || attempt.lmsUserEmail || "—"],
        ["Тест", attempt.testTitle],
        ["Источник", attempt.source === "web" ? "Web" : "LMS"],
        ["Дата", attempt.finishedAt ? new Date(attempt.finishedAt).toLocaleString("ru-RU") : "—"],
        [],
      ];

      if (attempt.isAdaptive) {
        rows.push(["Режим", "Адаптивный"]);
        rows.push([]);
        rows.push(["Тема", "Достигнутый уровень"]);
        for (const level of details.achievedLevels || []) {
          rows.push([level.topicName, level.levelName || "Не достигнут"]);
        }
      } else {
        rows.push(["Результат", `${details.overallPercent?.toFixed(1)}%`]);
        rows.push(["Баллы", `${details.earnedPoints} / ${details.possiblePoints}`]);
        rows.push(["Статус", details.passed ? "Сдан" : "Не сдан"]);
        rows.push([]);
        rows.push(["Вопрос", "Тема", "Тип", "Ответ", "Правильный", "Результат", "Баллы"]);
        for (const ans of details.answers || []) {
          rows.push([
            ans.questionPrompt,
            ans.topicName,
            ans.questionType,
            JSON.stringify(ans.userAnswer),
            JSON.stringify(ans.correctAnswer),
            ans.isCorrect ? "Верно" : "Неверно",
            `${ans.earnedPoints}/${ans.possiblePoints}`,
          ]);
        }
      }

      // Создаём xlsx через динамический импорт не нужен — используем CSV
      const csv = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
      const bom = "﻿";
      const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const userName = (attempt.username || attempt.lmsUserName || "user").replace(/[^a-zA-Zа-яА-Я0-9]/g, "_");
      a.download = `attempt_${userName}_${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {
      alert("Не удалось скачать данные попытки");
    }
  };

  if (isLoading) {
    return <LoadingState message="Загрузка аналитики..." />;
  }

  if (error || !data) {
    return (
      <Box pad={8}>
        <Text align="center" tone="muted">Не удалось загрузить аналитику</Text>
      </Box>
    );
  }

  const totalPages = Math.ceil(filteredAttempts.length / ATTEMPTS_PER_PAGE);
  const chartTooltipStyle = { backgroundColor: "var(--ou-bg-elevated)", border: "1px solid var(--ou-border-soft)" };

  return (
    <Stack gap={6}>
      {/* Заголовок */}
      <Cluster justify="between">
        <Stack gap={1}>
          <Text as="h1" variant="display-s" weight="semibold">Аналитика</Text>
          <Text tone="muted">Обзор эффективности тестов и статистика по источникам</Text>
        </Stack>
        <Button variant="secondary" size="s" leadingIcon={<RefreshCw size={16} />} loading={isFetching} onClick={() => { refetch(); refetchSummary(); }}>
          Обновить
        </Button>
      </Cluster>

      {/* Фильтры */}
      <FiltersBar
        source={source}
        onSourceChange={handleSourceChange}
        testId={testId}
        onTestIdChange={handleTestIdChange}
        tests={tests || []}
      />

      {/* Табы */}
      <Tabs
        defaultValue="overview"
        items={[
          {
            id: "overview",
            label: "Обзор",
            content: (
              <Stack gap={6}>
                {summaryLoading ? (
                  <Grid minItem="sm" gap={4}>
                    {[1, 2, 3, 4].map(i => <Card key={i}><CardBody><ProgressBar indeterminate hideHeader /></CardBody></Card>)}
                  </Grid>
                ) : summaryData ? (
                  <SummaryCards summary={summaryData} source={source} />
                ) : null}

                {/* Алерты */}
                {(data.alerts || []).length > 0 && (
                  <Stack gap={2}>
                    {data.alerts!.map(alert => (
                      <Box key={alert.testId} pad={3} surface="muted" radius="l" border>
                        <Cluster gap={3} wrap={false}>
                          <TrendingDown size={20} color="var(--ou-warning-600)" />
                          <Stack gap={1} grow>
                            <Text variant="body-s" weight="medium" truncate>{alert.testTitle}</Text>
                            <Text variant="body-xs" tone="muted">
                              Pass rate упал на <Text variant="body-xs" tone="warning" weight="medium">{alert.drop.toFixed(0)}%</Text>
                              {" "}за последние 7 дней: {alert.prevPassRate.toFixed(0)}% → {alert.recentPassRate.toFixed(0)}%
                            </Text>
                          </Stack>
                          <Tag variant="outline" tone="warning">−{alert.drop.toFixed(0)}%</Tag>
                        </Cluster>
                      </Box>
                    ))}
                  </Stack>
                )}

                <Grid minItem="lg" gap={6}>
                  <Card>
                    <CardHeader
                      title="Тренды (30 дней)"
                      trail={
                        <Tabs
                          value={trendMode}
                          onChange={(v) => setTrendMode(v as "total" | "byTest")}
                          variant="segment"
                          size="s"
                          hidePanel
                          items={[
                            { id: "total", label: "Общие" },
                            { id: "byTest", label: "По тестам" },
                          ]}
                        />
                      }
                    />
                    <CardBody>
                      {data.trends.some(t => t.attempts > 0) ? (
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={data.trends}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--ou-border-soft)" />
                            <XAxis
                              dataKey="date"
                              tickFormatter={(val) =>
                                new Date(val).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
                              }
                              fontSize={12}
                            />
                            <YAxis fontSize={12} />
                            <Tooltip
                              labelFormatter={(val) => new Date(val).toLocaleDateString("ru-RU")}
                              contentStyle={chartTooltipStyle}
                            />
                            <Legend />
                            {trendMode === "total" ? (
                              <>
                                <Line type="monotone" dataKey="attempts" stroke="var(--ou-accent-default)" strokeWidth={2} name="Попытки" />
                                <Line type="monotone" dataKey="passRate" stroke="var(--ou-success-default)" strokeWidth={2} name="Pass Rate %" />
                              </>
                            ) : (
                              (data.top5Tests || []).map((test, i) => (
                                <Line
                                  key={test.testId}
                                  type="monotone"
                                  dataKey={test.testId}
                                  stroke={`hsl(${i * 60}, 70%, 50%)`}
                                  strokeWidth={2}
                                  name={test.testTitle.length > 20 ? test.testTitle.slice(0, 20) + "…" : test.testTitle}
                                />
                              ))
                            )}
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <Box pad={8}><Text align="center" tone="muted">Нет данных</Text></Box>
                      )}
                    </CardBody>
                  </Card>

                  <Card>
                    <CardHeader title="Эффективность тестов" />
                    <CardBody>
                      {data.testStats.length > 0 ? (
                        <ResponsiveContainer width="100%" height={280}>
                          <BarChart data={data.testStats}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--ou-border-soft)" />
                            <XAxis dataKey="testTitle" fontSize={10} tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={80} />
                            <YAxis fontSize={12} />
                            <Tooltip contentStyle={chartTooltipStyle} />
                            <Legend />
                            <Bar dataKey="avgPercent" fill="var(--ou-accent-default)" name="Средний %" />
                            <Bar dataKey="passRate" fill="var(--ou-success-default)" name="Pass Rate" />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <Box pad={8}><Text align="center" tone="muted">Нет данных</Text></Box>
                      )}
                    </CardBody>
                  </Card>
                </Grid>

                <TopicStatsSection topicStats={data.topicStats} />
              </Stack>
            ),
          },
          {
            id: "attempts",
            label: `Попытки${data.attempts.length > 0 ? ` (${data.attempts.length})` : ""}`,
            content: (
              <Card>
                <CardHeader
                  title="Попытки"
                  trail={
                    <Text variant="body-s" tone="muted">
                      {filteredAttempts.length !== data.attempts.length
                        ? `${filteredAttempts.length} из ${data.attempts.length}`
                        : `Всего: ${data.attempts.length}`}
                    </Text>
                  }
                />
                <CardBody>
                  <Stack gap={4}>
                    <Cluster gap={3}>
                      <Input
                        placeholder="Имя или email..."
                        value={userSearch}
                        onChange={(e) => handleUserSearchChange(e.target.value)}
                        size="s"
                      />
                      <Cluster gap={2}>
                        <Text variant="body-xs" tone="muted">С:</Text>
                        <Input type="date" value={dateFrom} onChange={(e) => handleDateFromChange(e.target.value)} size="s" />
                      </Cluster>
                      <Cluster gap={2}>
                        <Text variant="body-xs" tone="muted">По:</Text>
                        <Input type="date" value={dateTo} onChange={(e) => handleDateToChange(e.target.value)} size="s" />
                      </Cluster>
                      {(userSearch || dateFrom || dateTo) && (
                        <Button
                          variant="ghost"
                          size="s"
                          onClick={() => {
                            setUserSearch("");
                            setDateFrom("");
                            setDateTo("");
                            setAttemptsPage(1);
                          }}
                        >
                          Сбросить
                        </Button>
                      )}
                    </Cluster>

                    <AttemptsTable
                      attempts={sortedAttempts.slice((attemptsPage - 1) * ATTEMPTS_PER_PAGE, attemptsPage * ATTEMPTS_PER_PAGE)}
                      source={source}
                      onViewDetails={handleViewDetails}
                      sortCol={sortCol}
                      sortDir={sortDir}
                      onSort={handleSort}
                      onExport={handleExportAttempt}
                    />

                    {filteredAttempts.length > ATTEMPTS_PER_PAGE && (
                      <Cluster justify="between">
                        <Text variant="body-s" tone="muted">Страница {attemptsPage} из {totalPages}</Text>
                        <Cluster gap={2}>
                          <Button variant="secondary" size="s" onClick={() => setAttemptsPage(p => Math.max(1, p - 1))} disabled={attemptsPage === 1}>←</Button>
                          <Button variant="secondary" size="s" onClick={() => setAttemptsPage(p => Math.min(totalPages, p + 1))} disabled={attemptsPage === totalPages}>→</Button>
                        </Cluster>
                      </Cluster>
                    )}
                  </Stack>
                </CardBody>
              </Card>
            ),
          },
          {
            id: "export",
            label: "Экспорт",
            content: <ExportSection />,
          },
        ]}
      />

      {/* Модальное окно деталей */}
      <AttemptDetailsDialog
        attempt={selectedAttempt}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
      />
    </Stack>
  );
}

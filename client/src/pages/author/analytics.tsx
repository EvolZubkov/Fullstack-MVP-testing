import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingState } from "@/components/loading-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  BarChart3,
  TrendingUp,
  Users,
  Target,
  AlertTriangle,
  CheckCircle,
  FileSpreadsheet,
  ChevronDown,
  ChevronUp,
  Filter,
  Eye,
  Globe,
  Server,
  Download,
  Clock,
  XCircle,
  HelpCircle,
  ArrowRight,
  Layers,
  RefreshCw,
  FileDown,
  TrendingDown
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
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { t } from "@/lib/i18n";

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
    <div className="flex flex-wrap items-center gap-4 p-4 bg-muted/30 rounded-lg border">
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Label className="text-sm font-medium">Фильтры:</Label>
      </div>

      <div className="flex items-center gap-2">
        <Label className="text-sm text-muted-foreground">Источник:</Label>
        <Select value={source} onValueChange={onSourceChange}>
          <SelectTrigger className="w-[140px] h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              <span className="flex items-center gap-2">
                <Users className="h-3 w-3" />
                Все
              </span>
            </SelectItem>
            <SelectItem value="web">
              <span className="flex items-center gap-2">
                <Globe className="h-3 w-3" />
                Web
              </span>
            </SelectItem>
            <SelectItem value="lms">
              <span className="flex items-center gap-2">
                <Server className="h-3 w-3" />
                LMS
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <Label className="text-sm text-muted-foreground">Тест:</Label>
        <Select value={testId} onValueChange={onTestIdChange}>
          <SelectTrigger className="w-[220px] h-9">
            <SelectValue placeholder="Все тесты" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все тесты</SelectItem>
            {tests.map((test) => (
              <SelectItem key={test.id} value={test.id}>
                {test.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {(source !== "all" || testId !== "all") && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onSourceChange("all");
            onTestIdChange("all");
          }}
        >
          Сбросить
        </Button>
      )}
    </div>
  );
}

// ============================================
// Карточки статистики
// ============================================

function SummaryCards({ summary, source }: { summary: CombinedSummary; source: "all" | "web" | "lms" }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Всего попыток</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{summary.totalAttempts}</div>
          {source === "all" && (
            <p className="text-xs text-muted-foreground mt-1">
              <Globe className="h-3 w-3 inline mr-1" />
              {summary.webAttempts}
              <span className="mx-2">|</span>
              <Server className="h-3 w-3 inline mr-1" />
              {summary.lmsAttempts}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Успешных</CardTitle>
          <CheckCircle className="h-4 w-4 text-green-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">{summary.passedAttempts}</div>
          <p className="text-xs text-muted-foreground mt-1">
            из {summary.totalAttempts} ({summary.passRate.toFixed(0)}%)
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Pass Rate</CardTitle>
          <Target className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{summary.passRate.toFixed(1)}%</div>
          <div className="w-full bg-muted rounded-full h-2 mt-2">
            <div
              className="bg-primary rounded-full h-2 transition-all"
              style={{ width: `${Math.min(summary.passRate, 100)}%` }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Средний балл</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{summary.avgPercent.toFixed(1)}%</div>
          <div className="w-full bg-muted rounded-full h-2 mt-2">
            <div
              className="bg-blue-500 rounded-full h-2 transition-all"
              style={{ width: `${Math.min(summary.avgPercent, 100)}%` }}
            />
          </div>
          {(summary.adaptiveAttempts ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              + {summary.adaptiveAttempts} адаптивных ({summary.adaptivePassed} завершили)
            </p>
          )}
        </CardContent>
      </Card>
    </div>
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
  const SortIcon = ({ col }: { col: "date" | "result" | "user" | "test" }) => {
    if (sortCol !== col) return <span className="ml-1 opacity-30">↕</span>;
    return <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  if (attempts.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <HelpCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>Нет данных о попытках</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            {source === "all" && <th className="text-left py-3 px-3 font-medium w-20">Источник</th>}
            <th
              className="text-left py-3 px-3 font-medium cursor-pointer hover:text-foreground select-none"
              onClick={() => onSort?.("user")}
            >
              Пользователь<SortIcon col="user" />
            </th>
            {source !== "web" && <th className="text-left py-3 px-3 font-medium">Email</th>}
            <th
              className="text-left py-3 px-3 font-medium cursor-pointer hover:text-foreground select-none"
              onClick={() => onSort?.("test")}
            >
              Тест<SortIcon col="test" />
            </th>
            <th
              className="text-left py-3 px-3 font-medium w-36 cursor-pointer hover:text-foreground select-none"
              onClick={() => onSort?.("date")}
            >
              Дата<SortIcon col="date" />
            </th>
            <th
              className="text-right py-3 px-3 font-medium w-24 cursor-pointer hover:text-foreground select-none"
              onClick={() => onSort?.("result")}
            >
              Результат<SortIcon col="result" />
            </th>
            <th className="text-center py-3 px-3 font-medium w-20">Статус</th>
            <th className="text-center py-3 px-3 font-medium w-20">Детали</th>
            <th className="text-center py-3 px-3 font-medium w-16"></th>
          </tr>
        </thead>
        <tbody>
          {attempts.map((attempt) => (
            <tr
              key={`${attempt.source}-${attempt.id}`}
              className="border-b hover:bg-muted/30 transition-colors cursor-pointer"
              onClick={() => onViewDetails(attempt)}
            >
              {source === "all" && (
                <td className="py-3 px-3">
                  {attempt.source === "web" ? (
                    <Badge variant="outline" className="text-xs font-normal">
                      <Globe className="h-3 w-3 mr-1" />
                      Web
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs font-normal">
                      <Server className="h-3 w-3 mr-1" />
                      LMS
                    </Badge>
                  )}
                </td>
              )}
              <td className="py-3 px-3 font-medium">
                {attempt.source === "web"
                  ? (attempt.username || "—")
                  : (attempt.lmsUserName || attempt.lmsUserEmail || attempt.lmsUserId || "—")}
              </td>
              {source !== "web" && (
                <td className="py-3 px-3 text-muted-foreground text-xs">
                  {attempt.source === "lms"
                    ? (attempt.lmsUserEmail || "—")
                    : (attempt.userEmail || "—")}
                </td>
              )}
              <td className="py-3 px-3">{attempt.testTitle || "—"}</td>
              <td className="py-3 px-3 text-muted-foreground text-xs">
                {attempt.finishedAt
                  ? new Date(attempt.finishedAt).toLocaleString("ru-RU", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                  : "В процессе"}
              </td>
              <td className="py-3 px-3 text-right">
                {attempt.isAdaptive ? (
                  <span className="text-sm text-muted-foreground">
                    {attempt.achievedTopics ?? 0}/{attempt.totalTopics ?? 0} тем
                  </span>
                ) : (
                  <span className="font-bold text-lg">{attempt.resultPercent?.toFixed(0) || 0}%</span>
                )}
              </td>
              <td className="py-3 px-3 text-center">
                {attempt.isAdaptive ? (
                  <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Завершён
                  </Badge>
                ) : attempt.resultPassed ? (
                  <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Сдан
                  </Badge>
                ) : (
                  <Badge variant="destructive">
                    <XCircle className="h-3 w-3 mr-1" />
                    Не сдан
                  </Badge>
                )}
              </td>
              <td className="py-3 px-3 text-center">
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onViewDetails(attempt); }}>
                  <Eye className="h-4 w-4" />
                </Button>
              </td>
              <td className="py-3 px-3 text-center">
                {onExport && (
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Скачать детали попытки"
                    onClick={(e) => { e.stopPropagation(); onExport(attempt); }}
                  >
                    <FileDown className="h-4 w-4" />
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[95vh] p-0">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="flex items-center gap-3">
            <span>Детали попытки</span>
            {attempt?.source === "web" ? (
              <Badge variant="outline">
                <Globe className="h-3 w-3 mr-1" />
                Web
              </Badge>
            ) : (
              <Badge variant="secondary">
                <Server className="h-3 w-3 mr-1" />
                LMS
              </Badge>
            )}
            {details?.testMode === "adaptive" && (
              <Badge className="bg-purple-100 text-purple-700">
                <Layers className="h-3 w-3 mr-1" />
                Адаптивный
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="p-6">
            <LoadingState message="Загрузка деталей..." />
          </div>
        ) : details ? (
          <Tabs defaultValue="overview" className="w-full">
            <div className="px-6">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="overview">Обзор</TabsTrigger>
                <TabsTrigger value="answers">
                  Ответы ({details.answers?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="topics">Темы</TabsTrigger>
              </TabsList>
            </div>

            <ScrollArea className="h-[calc(95vh-180px)]">
              {/* ===== TAB: Overview ===== */}
              <TabsContent value="overview" className="p-6 pt-4 space-y-6">
                {/* Основная информация */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="pt-4">
                      <Label className="text-xs text-muted-foreground">Пользователь</Label>
                      <p className="font-medium mt-1">
                        {details.username || details.lmsUserName || "—"}
                      </p>
                      {details.lmsUserEmail && (
                        <p className="text-xs text-muted-foreground">{details.lmsUserEmail}</p>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pt-4">
                      <Label className="text-xs text-muted-foreground">Тест</Label>
                      <p className="font-medium mt-1">{details.testTitle}</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pt-4">
                      <Label className="text-xs text-muted-foreground">Время</Label>
                      <p className="font-medium mt-1 flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {formatDuration(details.duration)}
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pt-4">
                      <Label className="text-xs text-muted-foreground">Дата</Label>
                      <p className="font-medium mt-1">
                        {details.finishedAt
                          ? new Date(details.finishedAt).toLocaleString("ru-RU")
                          : "—"}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Результат */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Результат</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {details.testMode === "adaptive" ? (
                      <div className="flex items-center gap-4">
                        <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 text-lg px-4 py-2">
                          <CheckCircle className="h-5 w-5 mr-2" />
                          ЗАВЕРШЁН
                        </Badge>
                        <p className="text-sm text-muted-foreground">
                          Результаты по достигнутым уровням — см. ниже
                        </p>
                      </div>
                    ) : (
                      <div className="flex items-center gap-8">
                        <div className="text-center">
                          <div className="text-4xl font-bold">
                            {details.overallPercent?.toFixed(0)}%
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            {details.earnedPoints} / {details.possiblePoints} баллов
                          </p>
                        </div>
                        <div className="flex-1">
                          <div className="w-full bg-muted rounded-full h-4">
                            <div
                              className={`rounded-full h-4 transition-all ${details.passed ? "bg-green-500" : "bg-red-500"}`}
                              style={{ width: `${Math.min(details.overallPercent, 100)}%` }}
                            />
                          </div>
                        </div>
                        <div>
                          {details.passed ? (
                            <Badge className="bg-green-100 text-green-700 text-lg px-4 py-2">
                              <CheckCircle className="h-5 w-5 mr-2" />
                              СДАН
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="text-lg px-4 py-2">
                              <XCircle className="h-5 w-5 mr-2" />
                              НЕ СДАН
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Достигнутые уровни (для адаптивных) */}
                {details.achievedLevels && details.achievedLevels.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Layers className="h-4 w-4" />
                        Достигнутые уровни
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {details.achievedLevels.map((level) => (
                          <div
                            key={level.topicId}
                            className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                          >
                            <span className="font-medium">{level.topicName}</span>
                            <Badge variant="outline">
                              {level.levelName || `Уровень ${(level.levelIndex || 0) + 1}`}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* ===== TAB: Answers ===== */}
              <TabsContent value="answers" className="p-6 pt-4">
                <div className="space-y-3">
                  {details.answers?.map((answer, index) => (
                    <Card
                      key={answer.questionId}
                      className={`${answer.isCorrect
                        ? "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30"
                        : "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30"
                        }`}
                    >
                      <CardContent className="pt-4">
                        {/* Заголовок вопроса */}
                        <div className="flex items-start justify-between gap-4 mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-medium text-muted-foreground">
                                #{index + 1}
                              </span>
                              <Badge variant="outline" className="text-xs">
                                {answer.questionType}
                              </Badge>
                              {answer.topicName && (
                                <Badge variant="secondary" className="text-xs">
                                  {answer.topicName}
                                </Badge>
                              )}
                              {answer.levelName && (
                                <Badge className="text-xs bg-purple-100 text-purple-700">
                                  {answer.levelName}
                                </Badge>
                              )}
                            </div>
                            <p className="font-medium">{answer.questionPrompt}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                              {answer.earnedPoints}/{answer.possiblePoints}
                            </span>
                            {answer.isCorrect ? (
                              <CheckCircle className="h-5 w-5 text-green-600" />
                            ) : (
                              <XCircle className="h-5 w-5 text-red-600" />
                            )}
                          </div>
                        </div>

                        <Separator className="my-3" />

                        {/* Ответы */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <Label className="text-xs text-muted-foreground mb-1 block">
                              Ответ пользователя:
                            </Label>
                            <div
                              className={`p-3 rounded-lg text-sm ${answer.isCorrect
                                ? "bg-green-100 dark:bg-green-900/50"
                                : "bg-red-100 dark:bg-red-900/50"
                                }`}
                            >
                              {formatUserAnswer(answer)}
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground mb-1 block">
                              Правильный ответ:
                            </Label>
                            <div className="p-3 rounded-lg bg-muted text-sm">
                              {formatCorrectAnswer(answer)}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}

                  {(!details.answers || details.answers.length === 0) && (
                    <div className="text-center py-12 text-muted-foreground">
                      <HelpCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>Нет данных об ответах</p>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* ===== TAB: Topics ===== */}
              <TabsContent value="topics" className="p-6 pt-4">
                <div className="space-y-3">
                  {details.testMode === "adaptive" ? (
                    // Адаптивный — показываем достигнутые уровни
                    details.achievedLevels && details.achievedLevels.length > 0 ? (
                      details.achievedLevels.map((level) => (
                        <Card key={level.topicId}>
                          <CardContent className="pt-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {level.levelName
                                  ? <CheckCircle className="h-5 w-5 text-blue-500 shrink-0" />
                                  : <XCircle className="h-5 w-5 text-red-500 shrink-0" />
                                }
                                <p className="font-medium">{level.topicName}</p>
                              </div>
                              <Badge className={level.levelName
                                ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                                : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                              }>
                                {level.levelName || "Не достигнут"}
                              </Badge>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    ) : (
                      <div className="text-center py-12 text-muted-foreground">
                        <HelpCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>Нет данных по уровням</p>
                      </div>
                    )
                  ) : (
                    // Стандартный — показываем процент по темам
                    details.topicResults?.length > 0 ? (
                      details.topicResults.map((topic) => (
                        <Card key={topic.topicId}>
                          <CardContent className="pt-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="font-medium">{topic.topicName}</p>
                                <p className="text-sm text-muted-foreground">
                                  {topic.earnedPoints} / {topic.possiblePoints} баллов
                                </p>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="text-right">
                                  <p className="text-2xl font-bold">{(topic.percent ?? 0).toFixed(0)}%</p>
                                </div>
                                {topic.passed !== null && (
                                  topic.passed
                                    ? <CheckCircle className="h-6 w-6 text-green-500" />
                                    : <XCircle className="h-6 w-6 text-red-500" />
                                )}
                              </div>
                            </div>
                            <div className="w-full bg-muted rounded-full h-2 mt-3">
                              <div
                                className={`rounded-full h-2 ${topic.passed === null ? "bg-blue-500" : topic.passed ? "bg-green-500" : "bg-red-500"}`}
                                style={{ width: `${Math.min(topic.percent ?? 0, 100)}%` }}
                              />
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    ) : (
                      <div className="text-center py-12 text-muted-foreground">
                        <HelpCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>Нет данных по темам</p>
                      </div>
                    )
                  )}
                </div>
              </TabsContent>
            </ScrollArea>
          </Tabs>
        ) : (
          <div className="p-6 text-center text-muted-foreground">
            Не удалось загрузить детали
          </div>
        )}
      </DialogContent>
    </Dialog>
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
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Статистика по темам */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Статистика по темам</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {topicStats.length > 0 ? (
              topicStats.map((topic) => (
                <div key={topic.topicId} className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{topic.topicName}</p>
                    <p className="text-xs text-muted-foreground">
                      {topic.totalAnswers} ответов | {topic.correctAnswers} верных
                    </p>
                  </div>
                  <Badge
                    variant={topic.avgPercent >= 70 ? "secondary" : topic.avgPercent >= 50 ? "outline" : "destructive"}
                  >
                    {topic.avgPercent.toFixed(0)}%
                  </Badge>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground text-center py-8">Нет данных</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Проблемные темы */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            Проблемные темы
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {sortedByFailure.length > 0 ? (
              sortedByFailure.map((topic, idx) => (
                <div key={topic.topicId} className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-destructive/10 text-destructive text-xs font-medium">
                      {idx + 1}
                    </span>
                    <p className="font-medium truncate">{topic.topicName}</p>
                  </div>
                  <Badge variant="destructive">{topic.failureCount} ошибок</Badge>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle className="h-8 w-8 text-green-500 mb-2" />
                <p className="text-muted-foreground">Нет проблемных тем!</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          Экспорт отчёта
        </CardTitle>
      </CardHeader>
      <CardContent>
        {filtersLoading ? (
          <LoadingState message="Загрузка фильтров..." />
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Источник данных</Label>
                <Select value={config.source} onValueChange={(v: "all" | "web" | "lms") => setConfig(prev => ({ ...prev, source: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все источники</SelectItem>
                    <SelectItem value="web">Только Web</SelectItem>
                    <SelectItem value="lms">Только LMS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Режим тестов</Label>
                <Select value={config.testMode} onValueChange={(v: "all" | "standard" | "adaptive") => setConfig(prev => ({ ...prev, testMode: v, testIds: [] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все тесты</SelectItem>
                    <SelectItem value="standard">Стандартные</SelectItem>
                    <SelectItem value="adaptive">Адаптивные</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Тесты ({config.testIds.length} выбрано)</Label>
                <Button variant="ghost" size="sm" onClick={handleSelectAllTests}>
                  {filteredTests.every(t => config.testIds.includes(t.id)) && filteredTests.length > 0 ? "Снять все" : "Выбрать все"}
                </Button>
              </div>
              <Input placeholder="Поиск тестов..." value={testSearch} onChange={(e) => setTestSearch(e.target.value)} />
              <div className="max-h-[150px] overflow-y-auto space-y-1 border rounded-lg p-2">
                {filteredTests.map((test) => (
                  <div key={test.id} className="flex items-center justify-between gap-2 py-1">
                    <div className="flex items-center gap-2">
                      <Checkbox checked={config.testIds.includes(test.id)} onCheckedChange={() => handleTestToggle(test.id)} />
                      <span className="text-sm">{test.title}</span>
                    </div>
                    <Badge variant="outline" className="text-xs">{test.mode === "adaptive" ? "Адапт." : "Станд."}</Badge>
                  </div>
                ))}
                {filteredTests.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Нет тестов</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Дата от</Label>
                <Input type="date" value={config.dateFrom} onChange={(e) => setConfig(prev => ({ ...prev, dateFrom: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Дата до</Label>
                <Input type="date" value={config.dateTo} onChange={(e) => setConfig(prev => ({ ...prev, dateTo: e.target.value }))} />
              </div>
            </div>

            {config.source !== "lms" && filters?.groups && filters.groups.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Группы ({config.groupIds.length > 0 ? config.groupIds.length : "все"})</Label>
                  <Button variant="ghost" size="sm" onClick={handleSelectAllGroups}>
                    {filteredGroups.every(g => config.groupIds.includes(g.id)) && filteredGroups.length > 0 ? "Снять все" : "Выбрать все"}
                  </Button>
                </div>
                <Input placeholder="Поиск групп..." value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)} />
                <div className="max-h-[120px] overflow-y-auto space-y-1 border rounded-lg p-2">
                  {filteredGroups.map((group) => (
                    <div key={group.id} className="flex items-center gap-2 py-1">
                      <Checkbox checked={config.groupIds.includes(group.id)} onCheckedChange={() => handleGroupToggle(group.id)} />
                      <span className="text-sm">{group.name}</span>
                      <span className="text-xs text-muted-foreground">({group.userCount})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Пользователи ({config.userIds.length > 0 ? config.userIds.length : "все"})</Label>
                <Button variant="ghost" size="sm" onClick={handleSelectAllUsers}>
                  {filteredUsers.every(u => config.userIds.includes(u.id)) && filteredUsers.length > 0 ? "Снять всех" : "Выбрать всех"}
                </Button>
              </div>
              <Input placeholder="Поиск пользователей..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
              <div className="max-h-[120px] overflow-y-auto space-y-1 border rounded-lg p-2">
                {filteredUsers.map((user) => (
                  <div key={user.id} className="flex items-center gap-2 py-1">
                    <Checkbox checked={config.userIds.includes(user.id)} onCheckedChange={() => handleUserToggle(user.id)} />
                    <span className="text-sm">{user.username}</span>
                  </div>
                ))}
                {filteredUsers.length === 0 && <p className="text-sm text-muted-foreground text-center py-2">Нет пользователей</p>}
              </div>
            </div>

            <div className="space-y-3 p-4 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-2">
                <Checkbox checked={config.bestAttemptOnly} onCheckedChange={(checked) => setConfig(prev => ({ ...prev, bestAttemptOnly: !!checked }))} />
                <Label className="text-sm font-medium">Только лучшая попытка каждого пользователя</Label>
              </div>
              {config.bestAttemptOnly && hasAdaptiveSelected && (
                <div className="ml-6 space-y-2">
                  <Label className="text-xs text-muted-foreground">Критерий лучшей попытки (для адаптивных)</Label>
                  <Select value={config.bestAttemptCriteria} onValueChange={(v: "percent" | "level_sum" | "level_count") => setConfig(prev => ({ ...prev, bestAttemptCriteria: v }))}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percent">По проценту</SelectItem>
                      <SelectItem value="level_sum">По сумме уровней</SelectItem>
                      <SelectItem value="level_count">По количеству уровней</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Листы в отчёте</Label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  { key: "summary", label: "Сводка" },
                  { key: "attempts", label: "Попытки" },
                  { key: "answers", label: "Ответы" },
                  { key: "questionStats", label: "Статистика вопросов" },
                  { key: "levelStats", label: "Статистика уровней", adaptive: true },
                  { key: "recommendations", label: "Рекомендации", adaptive: true },
                ].map(({ key, label, adaptive }) => (
                  <div key={key} className="flex items-center gap-2">
                    <Checkbox
                      checked={config.includeSheets[key as keyof typeof config.includeSheets]}
                      onCheckedChange={(checked) => setConfig(prev => ({ ...prev, includeSheets: { ...prev.includeSheets, [key]: !!checked } }))}
                    />
                    <Label className="text-sm">{label}{adaptive && <span className="text-xs text-muted-foreground ml-1">(адапт.)</span>}</Label>
                  </div>
                ))}
              </div>
            </div>

            <Button onClick={handleExport} disabled={isExporting || config.testIds.length === 0} className="w-full">
              {isExporting ? "Создание отчёта..." : <><Download className="h-4 w-4 mr-2" />Создать отчёт</>}
            </Button>
          </div>
        )}
      </CardContent>
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
      const bom = "\uFEFF";
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
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Не удалось загрузить аналитику</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Аналитика</h1>
          <p className="text-muted-foreground">
            Обзор эффективности тестов и статистика по источникам
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { refetch(); refetchSummary(); }} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </div>

      {/* Фильтры */}
      <FiltersBar
        source={source}
        onSourceChange={handleSourceChange}
        testId={testId}
        onTestIdChange={handleTestIdChange}
        tests={tests || []}
      />

      {/* Табы */}
      <Tabs defaultValue="overview">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">Обзор</TabsTrigger>
          <TabsTrigger value="attempts">
            Попытки {data.attempts.length > 0 && `(${data.attempts.length})`}
          </TabsTrigger>
          <TabsTrigger value="export">Экспорт</TabsTrigger>
        </TabsList>

        {/* ===== ТАБ: Обзор ===== */}
        <TabsContent value="overview" className="space-y-6 mt-6">
          {summaryLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[1, 2, 3, 4].map(i => <Card key={i}><CardContent className="pt-6"><div className="h-12 bg-muted rounded animate-pulse" /></CardContent></Card>)}
            </div>
          ) : summaryData ? (
            <SummaryCards summary={summaryData} source={source} />
          ) : null}

          {/* Алерты */}
          {(data.alerts || []).length > 0 && (
            <div className="space-y-2">
              {data.alerts!.map(alert => (
                <div
                  key={alert.testId}
                  className="flex items-center gap-3 p-3 rounded-lg border border-orange-200 bg-orange-50/50 dark:border-orange-800 dark:bg-orange-950/30"
                >
                  <TrendingDown className="h-5 w-5 text-orange-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{alert.testTitle}</p>
                    <p className="text-xs text-muted-foreground">
                      Pass rate упал на <span className="text-orange-600 font-medium">{alert.drop.toFixed(0)}%</span>
                      {" "}за последние 7 дней: {alert.prevPassRate.toFixed(0)}% → {alert.recentPassRate.toFixed(0)}%
                    </p>
                  </div>
                  <Badge variant="outline" className="border-orange-300 text-orange-700 shrink-0">
                    −{alert.drop.toFixed(0)}%
                  </Badge>
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Тренды (30 дней)</CardTitle>
                  <div className="flex items-center gap-1 border rounded-md p-1">
                    <Button
                      variant={trendMode === "total" ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setTrendMode("total")}
                    >
                      Общие
                    </Button>
                    <Button
                      variant={trendMode === "byTest" ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setTrendMode("byTest")}
                    >
                      По тестам
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {data.trends.some(t => t.attempts > 0) ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={data.trends}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(val) =>
                          new Date(val).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
                        }
                        className="text-xs"
                      />
                      <YAxis className="text-xs" />
                      <Tooltip
                        labelFormatter={(val) => new Date(val).toLocaleDateString("ru-RU")}
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                      />
                      <Legend />
                      {trendMode === "total" ? (
                        <>
                          <Line type="monotone" dataKey="attempts" stroke="hsl(var(--primary))" strokeWidth={2} name="Попытки" />
                          <Line type="monotone" dataKey="passRate" stroke="hsl(var(--chart-2))" strokeWidth={2} name="Pass Rate %" />
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
                  <div className="flex items-center justify-center h-[280px] text-muted-foreground">Нет данных</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Эффективность тестов</CardTitle>
              </CardHeader>
              <CardContent>
                {data.testStats.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={data.testStats}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="testTitle" className="text-xs" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={80} />
                      <YAxis className="text-xs" />
                      <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                      <Legend />
                      <Bar dataKey="avgPercent" fill="hsl(var(--primary))" name="Средний %" />
                      <Bar dataKey="passRate" fill="hsl(var(--chart-2))" name="Pass Rate" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[280px] text-muted-foreground">Нет данных</div>
                )}
              </CardContent>
            </Card>
          </div>

          <TopicStatsSection topicStats={data.topicStats} />
        </TabsContent>

        {/* ===== ТАБ: Попытки ===== */}
        <TabsContent value="attempts" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Попытки</CardTitle>
                <span className="text-sm text-muted-foreground">
                  {filteredAttempts.length !== data.attempts.length
                    ? `${filteredAttempts.length} из ${data.attempts.length}`
                    : `Всего: ${data.attempts.length}`}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-3">
                <Input
                  placeholder="Имя или email..."
                  value={userSearch}
                  onChange={(e) => handleUserSearchChange(e.target.value)}
                  className="w-52 h-8 text-sm"
                />
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground shrink-0">С:</Label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => handleDateFromChange(e.target.value)}
                    className="w-36 h-8 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground shrink-0">По:</Label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => handleDateToChange(e.target.value)}
                    className="w-36 h-8 text-sm"
                  />
                </div>
                {(userSearch || dateFrom || dateTo) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
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
              </div>
            </CardHeader>
            <CardContent>
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
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    Страница {attemptsPage} из {Math.ceil(filteredAttempts.length / ATTEMPTS_PER_PAGE)}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAttemptsPage(p => Math.max(1, p - 1))}
                      disabled={attemptsPage === 1}
                    >
                      ←
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAttemptsPage(p => Math.min(Math.ceil(filteredAttempts.length / ATTEMPTS_PER_PAGE), p + 1))}
                      disabled={attemptsPage === Math.ceil(filteredAttempts.length / ATTEMPTS_PER_PAGE)}
                    >
                      →
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== ТАБ: Экспорт ===== */}
        <TabsContent value="export" className="mt-6">
          <ExportSection />
        </TabsContent>
      </Tabs>

      {/* Модальное окно деталей */}
      <AttemptDetailsDialog
        attempt={selectedAttempt}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
      />
    </div>
  );
}
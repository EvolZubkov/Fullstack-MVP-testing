/**
 * @module pages/author/test-analytics
 * @description Per-test analytics dashboard: summary KPIs, score-distribution and
 * trend charts, per-topic / per-question / per-level statistics, an attempts table
 * and a full attempt-details modal. Rendered entirely with the UniversityRT design
 * system — layout via Stack/Cluster/Grid/Box, typography via Text, data via the DS
 * Table/Card/Tabs/ProgressBar/Tag primitives (no raw utility classes). recharts
 * charts use `--ou-*` tokens for colours.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import {
    Box,
    Button,
    Card,
    CardBody,
    CardHeader,
    Cluster,
    EmptyState,
    Grid,
    IconButton,
    ModalDialog,
    ProgressBar,
    ScrollArea,
    Stack,
    Table,
    Tabs,
    Tag,
    Text,
    type ProgressTone,
    type TableColumn,
    type Tone,
} from "@universityrt/ui-kit";
import { LoadingState } from "@/components/loading-state";
import {
    ArrowLeft,
    Users,
    Target,
    Clock,
    TrendingUp,
    CheckCircle,
    XCircle,
    BarChart3,
    FileText,
    HelpCircle,
    Layers,
    FileSpreadsheet,
    Gauge,
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
} from "recharts";

// Types
interface TestAnalytics {
    testId: string;
    testTitle: string;
    testMode: "standard" | "adaptive";
    /** Does the test declare an overall pass threshold at all (PRD-29 §6.7)? */
    hasPassThreshold: boolean;
    summary: {
        totalAttempts: number;
        completedAttempts: number;
        /** Of the completed runs, how many had points to grade / a verdict to pronounce. */
        gradedAttempts: number;
        judgedAttempts: number;
        uniqueUsers: number;
        /**
         * `null` = «неприменимо», not «ноль»: a measurement questionnaire grades nothing,
         * so it has no average result and no pass rate (PRD-29 §6.7). Rendering a zero
         * here is what used to headline «Средний балл 0.0%» beside «Прохождение 100.0%».
         */
        avgPercent: number | null;
        avgDuration: number | null;
        passRate: number | null;
        avgScore: number | null;
        maxScore: number;
    };
    topicStats: Array<{
        topicId: string;
        topicName: string;
        totalAnswers: number;
        correctAnswers: number;
        avgPercent: number;
        passRate: number | null;
    }>;
    questionStats: Array<{
        questionId: string;
        questionPrompt: string;
        questionType: string;
        topicId: string;
        topicName: string;
        difficulty: number;
        totalAnswers: number;
        correctAnswers: number;
        correctPercent: number;
    }>;
    levelStats?: Array<{
        levelIndex: number;
        levelName: string;
        topicId: string;
        topicName: string;
        achievedCount: number;
        attemptedCount: number;
        passedCount: number;
        failedCount: number;
        avgCorrectPercent: number;
    }>;
    scoreDistribution: Array<{
        range: string;
        count: number;
    }>;
    dailyTrends: Array<{
        date: string;
        attempts: number;
        avgPercent: number;
        passRate: number;
    }>;
}

interface AttemptListItem {
    attemptId: string;
    userId: string;
    username: string;
    startedAt: string | null;
    finishedAt: string | null;
    duration: number | null;
    overallPercent: number;
    earnedPoints: number;
    possiblePoints: number;
    passed: boolean;
    completed: boolean;
    /**
     * PRD-29 §6.7. `scored` — were there points to speak of; `verdictPronounced` — was
     * «Сдан / Не сдан» pronounced at all. A questionnaire run answers false to both, and
     * `passed` then carries the stored default that nobody decided.
     *
     * Optional, and ABSENT means «unknown», which shows rather than hides (the flags
     * only ever silence — see `hasPronouncedVerdict`). So a response from a server that
     * predates them renders exactly as it always did instead of blanking every row.
     */
    scored?: boolean;
    verdictPronounced?: boolean;
    achievedLevels?: Array<{
        topicName: string;
        levelName: string | null;
    }>;
}

interface AttemptDetail {
    attemptId: string;
    userId: string;
    username: string;
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
    /** PRD-29 §6.7 — see {@link AttemptListItem}. Absent = unknown = show. */
    scored?: boolean;
    verdictPronounced?: boolean;
    /** How much of what was delivered the learner answered. */
    questionCount?: number;
    answeredCount?: number;
    /** PRD-5/PRD-2: what the test measures, and what to call it. */
    measures?: {
        scales: Array<{ key: string; label: string; hasLevels: boolean }>;
        indicators: Array<{ name: string; label: string }>;
    };
    /** The run's scale values, as stored at finish (keyed by scale key). */
    scaleResults?: Record<string, { raw: number; label?: string; level?: string } | undefined>;
    /** The run's indicators, already resolved to «значение + что оно значит». */
    indicatorViews?: Array<{
        name: string;
        label: string;
        value: string | number | boolean | null;
        interpretation: string | null;
    }>;
    answers: Array<{
        questionId: string;
        questionPrompt: string;
        questionType: string;
        topicId: string;
        topicName: string;
        userAnswer: unknown;
        correctAnswer: unknown;
        /**
         * The RUNTIME encoding of the same answers — option indices, not labels.
         * Only these carry the ordinal («4) Скорее важно»), and for a scale question
         * the graduation index IS the answer.
         */
        userAnswerRaw?: unknown;
        correctAnswerRaw?: unknown;
        isCorrect: boolean;
        /** 0..1 — a graded answer may be PARTIALLY right (PRD-10). */
        ratio?: number;
        /** PRD-26/PRD-44: never checked — no tick, no points, only its contribution. */
        measurementOnly?: boolean;
        /** PRD-5: how this answer moved each scale. */
        contribs?: Array<{ scaleKey: string; delta: number }>;
        earnedPoints: number;
        possiblePoints: number;
        difficulty: number;
        levelName?: string;
        levelIndex?: number;
    }>;
    topicResults: Array<{
        topicId: string;
        topicName: string;
        correct?: number;
        total?: number;
        percent?: number;
        achievedLevelName?: string;
    }>;
    trajectory?: Array<{
        action: string;
        topicName?: string;
        levelName?: string;
        message?: string;
    }>;
    achievedLevels?: Array<{
        topicId: string;
        topicName: string;
        levelIndex: number | null;
        levelName: string | null;
    }>;
}

/**
 * A percent metric that may not apply at all (PRD-29 §6.7): a measurement test grades
 * nothing, so its average result and pass rate are `null` — «неприменимо», not «ноль».
 * The dash is the same answer `formatDuration` has always given for a missing duration.
 */
function formatPercent(percent: number | null): string {
    return percent === null ? "—" : `${percent.toFixed(1)}%`;
}

function formatDuration(seconds: number | null): string {
    if (seconds === null) return "—";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDate(dateStr: string | null): string {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleString("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/** Map a 0–100 correctness percent to a semantic tone. */
function percentTone(percent: number): "success" | "warning" | "error" {
    return percent >= 70 ? "success" : percent >= 50 ? "warning" : "error";
}

/** Map a 0–100 correctness percent to a ProgressBar tone. */
function percentProgressTone(percent: number): ProgressTone {
    return percent >= 70 ? "success" : percent >= 50 ? "warning" : "error";
}

const chartTooltipStyle = { backgroundColor: "var(--ou-bg-elevated)", border: "1px solid var(--ou-border-soft)" };

/**
 * Маркеры многострочного ответа. `Stack` гасит списочные маркеры вместе с остальным
 * сбросом, а у распределения и сопоставления строки переносятся: без маркера соседние
 * утверждения сливаются в один абзац и ответ перестаёт читаться.
 */
const listStyle: React.CSSProperties = { listStyle: "disc", paddingInlineStart: "var(--ou-space-4)" };

/** Печатное значение показателя: код и число печатаются как есть, пустое — прочерком. */
function formatIndicatorValue(value: string | number | boolean | null): string {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "boolean") return value ? "Да" : "Нет";
    return String(value);
}

/**
 * Ответ ученика в печатном виде.
 *
 * The server hands over BOTH forms: the labels a person reads and the raw option
 * indices. Only the raw form carries the ordinal, and for a scale question the
 * graduation index IS the answer — «4) Скорее важно» says which end of the scale was
 * chosen, «Скорее важно» alone does not.
 *
 * @param value Formatted answer (label, list of labels, pairs, or statement/points).
 * @param raw The same answer in runtime encoding, when the type has one.
 */
function renderAnswerValue(value: unknown, raw?: unknown): React.ReactNode {
    if (value === null || value === undefined || value === "") {
        return <Text variant="body-s" tone="muted">(нет ответа)</Text>;
    }

    if (Array.isArray(value)) {
        if (value.length === 0) {
            return <Text variant="body-s" tone="muted">(ничего не выбрано)</Text>;
        }

        // PRD-44: распределение — «утверждение — балл» по КАЖДОМУ утверждению, включая
        // нулевые: ноль отличает «рассмотрел и не дал веса» от «не дошёл».
        if (typeof value[0] === "object" && value[0] !== null && "statement" in (value[0] as object)) {
            const items = value as Array<{ statement: string; points: number }>;
            return (
                <Stack as="ul" gap={0} style={listStyle}>
                    {items.map((item, i) => (
                        <Text as="li" key={i} variant="body-s">
                            {item.statement} — {item.points > 0
                                ? <Text as="span" weight="bold">{item.points}</Text>
                                : <Text as="span" tone="muted">0</Text>}
                        </Text>
                    ))}
                </Stack>
            );
        }

        // Сопоставление: пары «слева → справа».
        if (typeof value[0] === "object" && value[0] !== null && "left" in (value[0] as object)) {
            const pairs = value as Array<{ left: string; right: string }>;
            return (
                <Stack as="ul" gap={0} style={listStyle}>
                    {pairs.map((pair, i) => (
                        <Text as="li" key={i} variant="body-s">{pair.left} → {pair.right}</Text>
                    ))}
                </Stack>
            );
        }

        const labels = value.map((v) => String(v));
        const indices = Array.isArray(raw) && raw.length === labels.length && raw.every((n) => typeof n === "number")
            ? (raw as number[])
            : null;
        return (
            <Text variant="body-s">
                {labels.map((label, i) => (indices ? `${indices[i] + 1}) ${label}` : label)).join(", ")}
            </Text>
        );
    }

    if (typeof value === "object") {
        return <Text variant="body-s">{JSON.stringify(value)}</Text>;
    }

    return (
        <Text variant="body-s">
            {typeof raw === "number" ? `${raw + 1}) ${String(value)}` : String(value)}
        </Text>
    );
}

/** Эталон в печатном виде: тот же рендер, но порядковые номера берутся из ключа. */
function renderReferenceValue(value: unknown, raw?: unknown): React.ReactNode {
    const key = (raw ?? {}) as { correctIndex?: unknown; correctIndices?: unknown; correctOrder?: unknown };
    if (typeof key.correctIndex === "number") return renderAnswerValue(value, key.correctIndex);
    if (Array.isArray(key.correctIndices)) return renderAnswerValue(value, key.correctIndices);
    if (Array.isArray(key.correctOrder)) return renderAnswerValue(value, key.correctOrder);
    return renderAnswerValue(value);
}

/** Строка «подпись — значение» под текстом вопроса (Ответ / Эталон / Вклад). */
function AnswerRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <Cluster gap={2} align="start" wrap={false}>
            <Box style={{ minWidth: "4.5rem" }}>
                <Text variant="body-xs" tone="muted">{label}</Text>
            </Box>
            <Box grow>{children}</Box>
        </Cluster>
    );
}

// Attempt Detail Modal
function AttemptDetailModal({
    attemptId,
    open,
    onClose,
}: {
    attemptId: string | null;
    open: boolean;
    onClose: () => void;
}) {
    const { data, isLoading } = useQuery<AttemptDetail>({
        queryKey: [`/api/analytics/attempts/${attemptId}`],
        enabled: !!attemptId && open,
    });

    // Ключ шкалы -> её название: вклад ответа приходит по ключам (DSL-идентификаторам),
    // а в строке должно стоять то, как автор шкалу назвал.
    const scaleLabels = new Map((data?.measures?.scales ?? []).map((s) => [s.key, s.label]));

    return (
        <ModalDialog
            open={open}
            onClose={onClose}
            size="xl"
            title={
                <Cluster gap={2}>
                    <Text>Детализация попытки</Text>
                    {data && <Text tone="muted">— {data.username}</Text>}
                </Cluster>
            }
        >
            {isLoading ? (
                <LoadingState message="Загрузка..." />
            ) : data ? (
                <ScrollArea maxH="xl">
                    <Stack gap={6}>
                        {/* Summary. PRD-29 §6.7: у прогона, которому нечего оценивать, две
                            оценочные плитки МЕНЯЮТ содержимое — печатать два прочерка значит
                            оставить половину шапки пустой там, где есть что показать. */}
                        <Grid minItem="sm" gap={1}>
                            <Box pad={3} surface="muted" radius="l">
                                <Stack gap={1} align="center">
                                    {data.scored !== false ? (
                                        <>
                                            <Text variant="display-s" weight="bold">{data.overallPercent.toFixed(1)}%</Text>
                                            <Text variant="body-s" tone="muted">Результат</Text>
                                        </>
                                    ) : (
                                        <>
                                            <Text variant="display-s" weight="bold">
                                                {data.answeredCount ?? data.answers.length} из {data.questionCount ?? data.answers.length}
                                            </Text>
                                            <Text variant="body-s" tone="muted">Отвечено</Text>
                                        </>
                                    )}
                                </Stack>
                            </Box>
                            <Box pad={3} surface="muted" radius="l">
                                <Stack gap={1} align="center">
                                    {data.scored !== false ? (
                                        <>
                                            <Text variant="display-s" weight="bold">{data.earnedPoints}/{data.possiblePoints}</Text>
                                            <Text variant="body-s" tone="muted">Баллы</Text>
                                        </>
                                    ) : (
                                        <>
                                            <Text variant="display-s" weight="bold">{formatDate(data.finishedAt)}</Text>
                                            <Text variant="body-s" tone="muted">Завершена</Text>
                                        </>
                                    )}
                                </Stack>
                            </Box>
                            <Box pad={3} surface="muted" radius="l">
                                <Stack gap={1} align="center">
                                    <Text variant="display-s" weight="bold">{formatDuration(data.duration)}</Text>
                                    <Text variant="body-s" tone="muted">Время</Text>
                                </Stack>
                            </Box>
                            <Box pad={3} surface="muted" radius="l">
                                <Stack gap={1} align="center" justify="center" full>
                                    {data.verdictPronounced !== false ? (
                                        <Tag tone={data.passed ? "success" : "error"} size="l">
                                            {data.passed ? "Пройден" : "Не пройден"}
                                        </Tag>
                                    ) : (
                                        // Вердикта никто не выносил: сохранённый `passed` —
                                        // умолчание теста, который не оценивает.
                                        <Tag size="l">Завершена</Tag>
                                    )}
                                </Stack>
                            </Box>
                        </Grid>

                        {/* Achieved Levels (for adaptive) */}
                        {data.testMode === "adaptive" && data.achievedLevels && (
                            <Card>
                                <CardHeader lead={<Layers size={16} />} title="Достигнутые уровни" />
                                <CardBody>
                                    <Cluster gap={2}>
                                        {data.achievedLevels.map((level, idx) => (
                                            <Tag key={idx} tone={level.levelName ? "success" : "neutral"}>
                                                {level.topicName}: {level.levelName || "Не достигнут"}
                                            </Tag>
                                        ))}
                                    </Cluster>
                                </CardBody>
                            </Card>
                        )}

                        {/* Trajectory (for adaptive) */}
                        {data.trajectory && data.trajectory.length > 0 && (
                            <Card>
                                <CardHeader title="Траектория прохождения" />
                                <CardBody>
                                    <Stack gap={2}>
                                        {data.trajectory.map((event, idx) => (
                                            <Cluster key={idx} gap={2}>
                                                {event.action === "level_up" ? (
                                                    <CheckCircle size={16} color="var(--ou-success-600)" />
                                                ) : (
                                                    <XCircle size={16} color="var(--ou-error-600)" />
                                                )}
                                                <Text variant="body-s">{event.message}</Text>
                                            </Cluster>
                                        ))}
                                    </Stack>
                                </CardBody>
                            </Card>
                        )}

                        {/* PRD-2: показатели. Порядок «показатели → шкалы» — тот же, что на
                            экране итогов у ученика (fillMeasureBlocks): автор смотрит на то же
                            и в том же порядке, что видел ученик. */}
                        {data.indicatorViews && data.indicatorViews.length > 0 && (
                            <Card>
                                <CardHeader lead={<Target size={16} />} title="Показатели" />
                                <CardBody>
                                    {/* Две колонки, не три: окно ФИКСИРУЕТ результат прогона.
                                        Авторский текст исхода — это листовка для ученика (на
                                        референсной методике он идёт на полторы страницы), её
                                        место на экране итогов и в отчёте, а не в ячейке таблицы. */}
                                    <Table
                                        columns={[
                                            { key: "label", header: "Показатель", render: (i) => <Text variant="body-s">{i.label}</Text> },
                                            {
                                                key: "value",
                                                header: "Значение",
                                                // Метка исхода, если автор её задал: «Командный» вместо
                                                // кода «kom». Код остаётся в Excel-выгрузке, где он и
                                                // нужен — там значения сопоставляют между прогонами.
                                                render: (i) => (
                                                    <Text variant="body-s" weight="medium">
                                                        {i.interpretation ?? formatIndicatorValue(i.value)}
                                                    </Text>
                                                ),
                                            },
                                        ]}
                                        rows={data.indicatorViews}
                                        rowKey={(i) => i.name}
                                    />
                                </CardBody>
                            </Card>
                        )}

                        {/* PRD-5: шкалы. Колонка «Уровень» — только если у теста есть шкалы с
                            полосами толкования: всегда пустая колонка читается как потеря данных. */}
                        {data.measures && data.measures.scales.length > 0 && data.scaleResults && (
                            <Card>
                                <CardHeader lead={<Gauge size={16} />} title="По шкалам" />
                                <CardBody>
                                    <Table
                                        columns={[
                                            { key: "label", header: "Шкала", render: (s) => <Text variant="body-s">{s.label}</Text> },
                                            {
                                                key: "value",
                                                header: "Значение",
                                                align: "right",
                                                render: (s) => {
                                                    const value = data.scaleResults?.[s.key];
                                                    return typeof value?.raw === "number"
                                                        ? <Text variant="body-s" weight="medium">{value.raw}</Text>
                                                        : <Text variant="body-s" tone="muted">—</Text>;
                                                },
                                            },
                                            ...(data.measures.scales.some((s) => s.hasLevels)
                                                ? [{
                                                    key: "level",
                                                    header: "Уровень",
                                                    render: (s: { key: string }) => {
                                                        const value = data.scaleResults?.[s.key];
                                                        // Метка полосы, код — запасной вариант (PRD-45).
                                                        const level = value?.label || value?.level;
                                                        return level
                                                            ? <Tag size="s">{level}</Tag>
                                                            : <Text variant="body-s" tone="muted">—</Text>;
                                                    },
                                                }]
                                                : []),
                                        ]}
                                        rows={data.measures.scales}
                                        rowKey={(s) => s.key}
                                    />
                                </CardBody>
                            </Card>
                        )}

                        {/* Answers */}
                        <Card>
                            <CardHeader title={`Ответы (${data.answers.length})`} />
                            <CardBody>
                                <ScrollArea maxH="md">
                                    <Stack gap={3}>
                                        {data.answers.map((answer, idx) => {
                                            // PRD-10: ответ бывает ЧАСТИЧНО верным. Крестик рядом с
                                            // «1.5/3» — два несогласных утверждения в одной строке.
                                            const ratio = answer.ratio ?? (answer.isCorrect ? 1 : 0);
                                            const partial = !answer.measurementOnly && ratio > 0 && ratio < 1;
                                            // Эталон печатается только там, где он что-то добавляет:
                                            // у верного ответа он совпадает с ответом.
                                            const showReference = !answer.measurementOnly
                                                && ratio < 1
                                                && answer.correctAnswer !== null
                                                && answer.correctAnswer !== undefined;

                                            return (
                                                <Box
                                                    key={answer.questionId}
                                                    pad={3}
                                                    radius="l"
                                                    border
                                                    surface={answer.measurementOnly || answer.isCorrect ? "muted" : "subtle"}
                                                >
                                                    <Stack gap={2}>
                                                        <Cluster justify="between" align="start" gap={2}>
                                                            <Stack gap={1} grow>
                                                                <Cluster gap={2}>
                                                                    <Text variant="body-xs" tone="muted">#{idx + 1}</Text>
                                                                    <Tag variant="outline" size="s">{answer.topicName}</Tag>
                                                                    {answer.levelName && (
                                                                        <Tag size="s">{answer.levelName}</Tag>
                                                                    )}
                                                                    {partial && <Tag tone="warning" size="s">Частично</Tag>}
                                                                </Cluster>
                                                                <Text variant="body-s" weight="medium">{answer.questionPrompt}</Text>
                                                            </Stack>
                                                            {/* PRD-26 FR-08 / PRD-44 FR-09: у измерительного вопроса
                                                                ни балла, ни галочки — «0/1 ✗» это вердикт вопросу,
                                                                у которого его не бывает. */}
                                                            {!answer.measurementOnly && (
                                                                <Cluster gap={2} wrap={false}>
                                                                    <Text variant="body-s">
                                                                        {answer.earnedPoints}/{answer.possiblePoints}
                                                                    </Text>
                                                                    {ratio === 1 && <CheckCircle size={20} color="var(--ou-success-600)" />}
                                                                    {ratio === 0 && <XCircle size={20} color="var(--ou-error-600)" />}
                                                                </Cluster>
                                                            )}
                                                        </Cluster>

                                                        <Stack gap={1}>
                                                            <AnswerRow label="Ответ">
                                                                {renderAnswerValue(answer.userAnswer, answer.userAnswerRaw)}
                                                            </AnswerRow>
                                                            {showReference && (
                                                                <AnswerRow label="Эталон">
                                                                    {renderReferenceValue(answer.correctAnswer, answer.correctAnswerRaw)}
                                                                </AnswerRow>
                                                            )}
                                                            {answer.contribs && answer.contribs.length > 0 && (
                                                                <AnswerRow label="Вклад">
                                                                    <Cluster gap={1}>
                                                                        {answer.contribs.map((c) => (
                                                                            <Tag key={c.scaleKey} tone="accent" size="s">
                                                                                {scaleLabels.get(c.scaleKey) ?? c.scaleKey} {c.delta > 0 ? "+" : ""}{c.delta}
                                                                            </Tag>
                                                                        ))}
                                                                    </Cluster>
                                                                </AnswerRow>
                                                            )}
                                                        </Stack>
                                                    </Stack>
                                                </Box>
                                            );
                                        })}
                                    </Stack>
                                </ScrollArea>
                            </CardBody>
                        </Card>
                    </Stack>
                </ScrollArea>
            ) : (
                <Box pad={8}><Text align="center" tone="muted">Не удалось загрузить данные</Text></Box>
            )}
        </ModalDialog>
    );
}

export default function TestAnalyticsPage() {
    const [, params] = useRoute("/author/tests/:testId/analytics");
    const testId = params?.testId;

    const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState("overview");

    const { data: analytics, isLoading: analyticsLoading } = useQuery<TestAnalytics>({
        queryKey: [`/api/analytics/tests/${testId}`],
        enabled: !!testId,
    });

    const { data: attemptsData, isLoading: attemptsLoading } = useQuery<{
        testId: string;
        testTitle: string;
        testMode: string;
        attempts: AttemptListItem[];
    }>({
        queryKey: [`/api/analytics/tests/${testId}/attempts`],
        enabled: !!testId && activeTab === "attempts",
    });

    // Функция экспорта в Excel
    const handleExportExcel = () => {
        window.open(`/api/analytics/tests/${testId}/export/excel`, "_blank");
    };

    if (analyticsLoading) {
        return <LoadingState message="Загрузка аналитики..." />;
    }

    if (!analytics) {
        return (
            <EmptyState
                art={<HelpCircle size={48} color="var(--ou-fg-subtle)" />}
                title="Не удалось загрузить аналитику"
                actions={
                    <Link href="/author/tests">
                        <Button variant="secondary" leadingIcon={<ArrowLeft size={16} />}>
                            Назад к тестам
                        </Button>
                    </Link>
                }
            />
        );
    }

    const { summary, topicStats, questionStats, levelStats, scoreDistribution, dailyTrends } = analytics;

    const overviewPanel = (
        <Stack gap={1}>
            <Grid minItem="lg" gap={1}>
                {/* Score Distribution */}
                <Card>
                    <CardHeader title="Распределение результатов" />
                    <CardBody>
                        {scoreDistribution.some((d) => d.count > 0) ? (
                            <ResponsiveContainer width="100%" height={250}>
                                <BarChart data={scoreDistribution}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--ou-border-soft)" />
                                    <XAxis dataKey="range" fontSize={12} />
                                    <YAxis fontSize={12} />
                                    <Tooltip contentStyle={chartTooltipStyle} />
                                    <Bar dataKey="count" fill="var(--ou-accent-default)" name="Попытки" />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <Box pad={8}><Text align="center" tone="muted">Нет данных</Text></Box>
                        )}
                    </CardBody>
                </Card>

                {/* Daily Trends */}
                <Card>
                    <CardHeader title="Тренды (30 дней)" />
                    <CardBody>
                        {dailyTrends.length > 0 ? (
                            <ResponsiveContainer width="100%" height={250}>
                                <LineChart data={dailyTrends}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--ou-border-soft)" />
                                    <XAxis
                                        dataKey="date"
                                        tickFormatter={(val) =>
                                            new Date(val).toLocaleDateString("ru-RU", {
                                                day: "numeric",
                                                month: "short",
                                            })
                                        }
                                        fontSize={12}
                                    />
                                    <YAxis fontSize={12} />
                                    <Tooltip
                                        labelFormatter={(val) => new Date(val).toLocaleDateString("ru-RU")}
                                        contentStyle={chartTooltipStyle}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="avgPercent"
                                        stroke="var(--ou-accent-default)"
                                        strokeWidth={2}
                                        name="Средний %"
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="passRate"
                                        stroke="var(--ou-success-default)"
                                        strokeWidth={2}
                                        name="% прохождения"
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        ) : (
                            <Box pad={8}><Text align="center" tone="muted">Нет данных</Text></Box>
                        )}
                    </CardBody>
                </Card>
            </Grid>

            {/* Topic Stats */}
            <Card>
                <CardHeader title="Статистика по темам" />
                <CardBody>
                    {topicStats.length > 0 ? (
                        <Stack gap={3}>
                            {topicStats.map((topic) => (
                                <Box key={topic.topicId} pad={3} surface="muted" radius="l">
                                    <Cluster justify="between" gap={4}>
                                        <Stack gap={1} grow>
                                            <Text weight="medium">{topic.topicName}</Text>
                                            <Text variant="body-s" tone="muted">
                                                {topic.correctAnswers} / {topic.totalAnswers} правильных
                                            </Text>
                                        </Stack>
                                        <Cluster gap={3} wrap={false}>
                                            <Tag>{topic.avgPercent.toFixed(1)}%</Tag>
                                            {topic.passRate !== null && (
                                                <Tag tone={topic.passRate >= 70 ? "success" : "error"}>
                                                    {topic.passRate.toFixed(0)}% сдали
                                                </Tag>
                                            )}
                                        </Cluster>
                                    </Cluster>
                                </Box>
                            ))}
                        </Stack>
                    ) : (
                        <Box pad={8}><Text align="center" tone="muted">Нет данных по темам</Text></Box>
                    )}
                </CardBody>
            </Card>
        </Stack>
    );

    const attemptColumns: TableColumn<AttemptListItem>[] = [
        {
            key: "user",
            header: "Пользователь",
            render: (a) => <Text variant="body-s" weight="medium">{a.username}</Text>,
        },
        {
            key: "date",
            header: "Дата",
            render: (a) => <Text variant="body-xs" tone="muted">{formatDate(a.finishedAt)}</Text>,
        },
        {
            key: "duration",
            header: "Время",
            align: "right",
            render: (a) => <Text variant="body-s">{formatDuration(a.duration)}</Text>,
        },
        {
            key: "result",
            header: "Результат",
            align: "right",
            // PRD-29 §6.7: a run that graded nothing has no percent to show. «0.0 %»
            // over a questionnaire is not a low score — there was no score.
            render: (a) =>
                a.completed && a.scored !== false
                    ? <Text variant="body-s" weight="medium">{a.overallPercent.toFixed(1)}%</Text>
                    : <Text variant="body-s" tone="muted">—</Text>,
        },
        {
            key: "status",
            header: "Статус",
            align: "right",
            render: (a) =>
                !a.completed
                    ? <Tag>В процессе</Tag>
                    : a.verdictPronounced !== false
                        ? <Tag tone={a.passed ? "success" : "error"}>{a.passed ? "Сдан" : "Не сдан"}</Tag>
                        // Nobody pronounced a verdict on this run — the stored `passed`
                        // is the default of a test that judges nothing, not a decision.
                        : <Tag>Завершён</Tag>,
        },
        ...(analytics.testMode === "adaptive"
            ? [{
                key: "levels",
                header: "Уровни",
                render: (a: AttemptListItem) => (
                    <Cluster gap={1}>
                        {a.achievedLevels?.map((level, idx) => (
                            <Tag key={idx} variant="outline" size="s">
                                {level.levelName || "—"}
                            </Tag>
                        ))}
                    </Cluster>
                ),
            } as TableColumn<AttemptListItem>]
            : []),
        {
            key: "actions",
            header: "",
            width: "56px",
            align: "center",
            render: (a) =>
                a.completed ? (
                    <IconButton
                        variant="ghost"
                        size="s"
                        aria-label="Детализация попытки"
                        icon={<FileText size={16} />}
                        onClick={() => setSelectedAttemptId(a.attemptId)}
                    />
                ) : null,
        },
    ];

    const attemptsPanel = (
        <Card>
            <CardHeader title="Список попыток" />
            <CardBody>
                {attemptsLoading ? (
                    <LoadingState message="Загрузка..." />
                ) : attemptsData?.attempts && attemptsData.attempts.length > 0 ? (
                    <Table
                        columns={attemptColumns}
                        rows={attemptsData.attempts}
                        rowKey={(a) => a.attemptId}
                    />
                ) : (
                    <Box pad={8}><Text align="center" tone="muted">Нет попыток</Text></Box>
                )}
            </CardBody>
        </Card>
    );

    const questionsPanel = (
        <Card>
            <CardHeader lead={<HelpCircle size={20} />} title="Статистика по вопросам" />
            <CardBody>
                {questionStats.length > 0 ? (
                    <Stack gap={3}>
                        {questionStats.map((q, idx) => (
                            <Box key={q.questionId} pad={3} radius="l" border>
                                <Stack gap={2}>
                                    <Cluster justify="between" align="start" gap={4}>
                                        <Stack gap={1} grow>
                                            <Cluster gap={2}>
                                                <Text variant="body-xs" tone="muted">#{idx + 1}</Text>
                                                <Tag variant="outline" size="s">{q.topicName}</Tag>
                                                <Tag size="s">Сложность: {q.difficulty}</Tag>
                                            </Cluster>
                                            <Text variant="body-s">{q.questionPrompt}</Text>
                                        </Stack>
                                        <Stack gap={1} align="end">
                                            <Text variant="heading-s" weight="bold" tone={percentTone(q.correctPercent)}>
                                                {q.correctPercent.toFixed(0)}%
                                            </Text>
                                            <Text variant="body-xs" tone="muted">
                                                {q.correctAnswers}/{q.totalAnswers}
                                            </Text>
                                        </Stack>
                                    </Cluster>
                                    <ProgressBar
                                        value={q.correctPercent}
                                        tone={percentProgressTone(q.correctPercent)}
                                        size="s"
                                        hideHeader
                                    />
                                </Stack>
                            </Box>
                        ))}
                    </Stack>
                ) : (
                    <Box pad={8}><Text align="center" tone="muted">Нет данных по вопросам</Text></Box>
                )}
            </CardBody>
        </Card>
    );

    const levelsPanel = (
        <Card>
            <CardHeader lead={<Layers size={20} />} title="Статистика по уровням" />
            <CardBody>
                {levelStats && levelStats.length > 0 ? (
                    <Stack gap={4}>
                        {/* Group by topic */}
                        {Array.from(new Set(levelStats.map((l) => l.topicId))).map((topicId) => {
                            const topicLevels = levelStats.filter((l) => l.topicId === topicId);
                            const topicName = topicLevels[0]?.topicName || "Unknown";

                            return (
                                <Box key={topicId} pad={4} surface="muted" radius="l">
                                    <Stack gap={3}>
                                        <Text as="h4" variant="heading-s" weight="medium">{topicName}</Text>
                                        <Grid minItem="sm" gap={3}>
                                            {topicLevels
                                                .sort((a, b) => a.levelIndex - b.levelIndex)
                                                .map((level) => (
                                                    <Box
                                                        key={`${level.topicId}-${level.levelIndex}`}
                                                        pad={3}
                                                        radius="l"
                                                        border
                                                        surface="elevated"
                                                    >
                                                        <Stack gap={2}>
                                                            <Cluster justify="between">
                                                                <Text weight="medium">{level.levelName}</Text>
                                                                <Tag>{level.achievedCount} достигли</Tag>
                                                            </Cluster>
                                                            <Stack gap={1}>
                                                                <Cluster justify="between">
                                                                    <Text variant="body-s" tone="muted">Попыток:</Text>
                                                                    <Text variant="body-s">{level.attemptedCount}</Text>
                                                                </Cluster>
                                                                <Cluster justify="between">
                                                                    <Text variant="body-s" tone="muted">Прошли/Провалили:</Text>
                                                                    <Cluster gap={1} wrap={false}>
                                                                        <Text variant="body-s" tone="success">{level.passedCount}</Text>
                                                                        <Text variant="body-s" tone="muted">/</Text>
                                                                        <Text variant="body-s" tone="error">{level.failedCount}</Text>
                                                                    </Cluster>
                                                                </Cluster>
                                                                <Cluster justify="between">
                                                                    <Text variant="body-s" tone="muted">Средний %:</Text>
                                                                    <Text variant="body-s">{level.avgCorrectPercent.toFixed(1)}%</Text>
                                                                </Cluster>
                                                            </Stack>
                                                        </Stack>
                                                    </Box>
                                                ))}
                                        </Grid>
                                    </Stack>
                                </Box>
                            );
                        })}
                    </Stack>
                ) : (
                    <Box pad={8}><Text align="center" tone="muted">Нет данных по уровням</Text></Box>
                )}
            </CardBody>
        </Card>
    );

    return (
        <Stack gap={6}>
            {/* Header */}
            <Cluster justify="between">
                <Cluster gap={4}>
                    <Link href="/author/tests">
                        <IconButton variant="ghost" aria-label="Назад к тестам" icon={<ArrowLeft size={20} />} />
                    </Link>
                    <Stack gap={1}>
                        <Text as="h1" variant="display-s" weight="semibold">{analytics.testTitle}</Text>
                        <Cluster gap={2}>
                            <Text tone="muted">Аналитика</Text>
                            <Tag tone={analytics.testMode === "adaptive" ? "accent" : "neutral"}>
                                {analytics.testMode === "adaptive" ? "Адаптивный" : "Стандартный"}
                            </Tag>
                        </Cluster>
                    </Stack>
                </Cluster>
                <Button onClick={handleExportExcel} variant="secondary" leadingIcon={<FileSpreadsheet size={16} />}>
                    Экспорт Excel
                </Button>
            </Cluster>

            {/* Summary Cards */}
            <Grid minItem="sm" gap={1}>
                <Card>
                    <CardHeader title="Попытки" trail={<Users size={16} color="var(--ou-fg-muted)" />} />
                    <CardBody>
                        <Text variant="display-s" weight="bold">{summary.completedAttempts}</Text>
                        <Text as="p" variant="body-xs" tone="muted">{summary.uniqueUsers} уникальных пользователей</Text>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader title="Средний балл" trail={<TrendingUp size={16} color="var(--ou-fg-muted)" />} />
                    <CardBody>
                        <Text variant="display-s" weight="bold">{formatPercent(summary.avgPercent)}</Text>
                        <Text as="p" variant="body-xs" tone="muted">
                            {summary.avgScore === null
                                ? "тест не оценивает ответы"
                                : `${summary.avgScore.toFixed(1)} из ${summary.maxScore} баллов`}
                        </Text>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader title="Прохождение" trail={<Target size={16} color="var(--ou-fg-muted)" />} />
                    <CardBody>
                        <Text variant="display-s" weight="bold">{formatPercent(summary.passRate)}</Text>
                        <Text as="p" variant="body-xs" tone="muted">
                            {summary.passRate === null ? "вердикт не выносится" : "успешно сдали тест"}
                        </Text>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader title="Среднее время" trail={<Clock size={16} color="var(--ou-fg-muted)" />} />
                    <CardBody>
                        <Text variant="display-s" weight="bold">{formatDuration(summary.avgDuration)}</Text>
                        <Text as="p" variant="body-xs" tone="muted">на прохождение</Text>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader title="Всего" trail={<BarChart3 size={16} color="var(--ou-fg-muted)" />} />
                    <CardBody>
                        <Text variant="display-s" weight="bold">{summary.totalAttempts}</Text>
                        <Text as="p" variant="body-xs" tone="muted">{summary.totalAttempts - summary.completedAttempts} незавершённых</Text>
                    </CardBody>
                </Card>
            </Grid>

            {/* Tabs */}
            <Tabs
                value={activeTab}
                onChange={setActiveTab}
                items={[
                    { id: "overview", label: "Обзор", content: overviewPanel },
                    { id: "attempts", label: "Попытки", content: attemptsPanel },
                    { id: "questions", label: "Вопросы", content: questionsPanel },
                    ...(analytics.testMode === "adaptive"
                        ? [{ id: "levels", label: "Уровни", content: levelsPanel }]
                        : []),
                ]}
            />

            {/* Attempt Detail Modal */}
            <AttemptDetailModal
                attemptId={selectedAttemptId}
                open={!!selectedAttemptId}
                onClose={() => setSelectedAttemptId(null)}
            />
        </Stack>
    );
}

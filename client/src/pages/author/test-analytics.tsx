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
    summary: {
        totalAttempts: number;
        completedAttempts: number;
        uniqueUsers: number;
        avgPercent: number;
        avgDuration: number | null;
        passRate: number;
        avgScore: number;
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
    answers: Array<{
        questionId: string;
        questionPrompt: string;
        questionType: string;
        topicId: string;
        topicName: string;
        userAnswer: unknown;
        correctAnswer: unknown;
        isCorrect: boolean;
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
                        {/* Summary */}
                        <Grid minItem="sm" gap={1}>
                            <Box pad={3} surface="muted" radius="l">
                                <Stack gap={1} align="center">
                                    <Text variant="display-s" weight="bold">{data.overallPercent.toFixed(1)}%</Text>
                                    <Text variant="body-s" tone="muted">Результат</Text>
                                </Stack>
                            </Box>
                            <Box pad={3} surface="muted" radius="l">
                                <Stack gap={1} align="center">
                                    <Text variant="display-s" weight="bold">{data.earnedPoints}/{data.possiblePoints}</Text>
                                    <Text variant="body-s" tone="muted">Баллы</Text>
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
                                    <Tag tone={data.passed ? "success" : "error"} size="l">
                                        {data.passed ? "Пройден" : "Не пройден"}
                                    </Tag>
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

                        {/* Answers */}
                        <Card>
                            <CardHeader title={`Ответы (${data.answers.length})`} />
                            <CardBody>
                                <ScrollArea maxH="md">
                                    <Stack gap={3}>
                                        {data.answers.map((answer, idx) => (
                                            <Box
                                                key={answer.questionId}
                                                pad={3}
                                                radius="l"
                                                border
                                                surface={answer.isCorrect ? "muted" : "subtle"}
                                            >
                                                <Cluster justify="between" align="start" gap={2}>
                                                    <Stack gap={1} grow>
                                                        <Cluster gap={2}>
                                                            <Text variant="body-xs" tone="muted">#{idx + 1}</Text>
                                                            <Tag variant="outline" size="s">{answer.topicName}</Tag>
                                                            {answer.levelName && (
                                                                <Tag size="s">{answer.levelName}</Tag>
                                                            )}
                                                        </Cluster>
                                                        <Text variant="body-s" weight="medium">{answer.questionPrompt}</Text>
                                                    </Stack>
                                                    <Cluster gap={2} wrap={false}>
                                                        <Text variant="body-s">
                                                            {answer.earnedPoints}/{answer.possiblePoints}
                                                        </Text>
                                                        {answer.isCorrect ? (
                                                            <CheckCircle size={20} color="var(--ou-success-600)" />
                                                        ) : (
                                                            <XCircle size={20} color="var(--ou-error-600)" />
                                                        )}
                                                    </Cluster>
                                                </Cluster>
                                            </Box>
                                        ))}
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
            render: (a) =>
                a.completed
                    ? <Text variant="body-s" weight="medium">{a.overallPercent.toFixed(1)}%</Text>
                    : <Text variant="body-s" tone="muted">—</Text>,
        },
        {
            key: "status",
            header: "Статус",
            align: "right",
            render: (a) =>
                a.completed
                    ? <Tag tone={a.passed ? "success" : "error"}>{a.passed ? "Сдан" : "Не сдан"}</Tag>
                    : <Tag>В процессе</Tag>,
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
                        <Text variant="display-s" weight="bold">{summary.avgPercent.toFixed(1)}%</Text>
                        <Text as="p" variant="body-xs" tone="muted">{summary.avgScore.toFixed(1)} из {summary.maxScore} баллов</Text>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader title="Прохождение" trail={<Target size={16} color="var(--ou-fg-muted)" />} />
                    <CardBody>
                        <Text variant="display-s" weight="bold">{summary.passRate.toFixed(1)}%</Text>
                        <Text as="p" variant="body-xs" tone="muted">успешно сдали тест</Text>
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

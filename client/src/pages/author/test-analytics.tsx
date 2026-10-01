/**
 * @module pages/author/test-analytics
 * @description Аналитика одного теста: плитки сводки и четыре вкладки — «Обзор»
 * (распределение результатов, темы, динамика), «Вопросы», «Выдача» (варианты, версии
 * публикации, профиль банка и уровни адаптивного теста) и «Шкалы» у измерительного.
 *
 * Чего здесь БОЛЬШЕ НЕТ и почему: списка попыток (PRD-56 FR-23 — он в реестре прохождений,
 * один список на продукт), окна разбора попытки (переехало туда же) и диаграмм на recharts —
 * страница целиком собрана `Charts` дизайн-системы. Блоки вкладок живут в
 * `features/analytics/test/*`, здесь остаётся только сборка и запросы: данные «Выдачи» и
 * «Шкал» грузятся своими ручками и ТОЛЬКО на своей вкладке.
 */
import { useMemo, useState, type ReactNode } from "react";
import { PassTrend } from "@/features/analytics/test/pass-trend";
import { ScoreDistribution } from "@/features/analytics/test/score-distribution";
import { QuestionTable } from "@/features/analytics/test/question-table";
import { TopicBreakdown } from "@/features/analytics/test/topic-breakdown";
import { VariantTable, type VariantSectionView } from "@/features/analytics/test/variant-table";
import { VersionTable, type VersionRowView } from "@/features/analytics/test/version-table";
import {
    ExposureProfile,
    type ExposureProfileView,
} from "@/features/analytics/test/exposure-profile";
import {
    ScaleProfilePanel,
    type ScaleProfileView,
} from "@/features/analytics/test/scale-profile";
import {
    ItemQualityPanel,
    type ItemQualityView,
} from "@/features/analytics/test/item-quality";
import {
    ItemBreakdownPanel,
    type ItemBreakdownView,
} from "@/features/analytics/test/item-breakdown";
import {
    ScaleQualityPanel,
    type ScaleQualityRow,
} from "@/features/analytics/test/scale-quality";
import { PsychometricsComparePanel } from "@/features/analytics/test/psychometrics-compare-panel";
import { invalidateAnalytics } from "@/features/analytics/invalidate-analytics";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import {
    Box,
    Button,
    Card,
    CardBody,
    CardHeader,
    Cluster,
    EmptyState,
    FilterBar,
    Grid,
    IconButton,
    Stack,
    Tabs,
    Tag,
    Text,
} from "@skillum/ui-kit";
import { LoadingState } from "@/components/loading-state";
import { readQuestionAnalyticsLink } from "@/features/analytics/test/question-analytics-link";
import { pluralize } from "@/lib/i18n";
import { LmsImportDialog } from "@/features/analytics/lms-import/lms-import-dialog";
import { RegistryFilterDialog } from "@/features/analytics/registry/filter-dialog";
import {
    countConditions,
    describeConditions,
    filterToSearch,
    EMPTY_FILTER,
    type RegistryFilter,
} from "@/features/analytics/registry/filter-state";
import { useRegistryDictionaries, useTestDictionary } from "@/features/analytics/registry/use-dictionaries";
import { useRegistryFilter } from "@/features/analytics/registry/use-registry-filter";
import {
    ArrowLeft,
    HelpCircle,
    Layers,
    FileSpreadsheet,
    Upload,
    ChevronRight,
    RefreshCw,
} from "lucide-react";

// Types
interface TestAnalytics {
    testId: string;
    testTitle: string;
    testMode: "standard" | "adaptive";
    /** PRD-56 FR-21: у теста есть шкалы — тогда показывается вкладка «Шкалы». */
    hasScales?: boolean;
    /** Does the test declare an overall pass threshold at all (PRD-29 §6.7)? */
    hasPassThreshold: boolean;
    /** Порог наблюдений инстанса: ниже него разброс ответов не печатается (FR-22). */
    minObservations: number;
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
        /** Медиана длительности, секунды: плитка «Время, медиана» (эскиз обзора). */
        medianDuration?: number | null;
        passRate: number | null;
        avgScore: number | null;
        maxScore: number;
    };
    /** PRD-56 FR-14a: у каждой доли своя единица счёта — прохождения против ответов. */
    topicStats: Array<{
        topicId: string;
        topicName: string;
        passedShare: number | null;
        correctShare: number | null;
        thresholdPercent: number | null;
        inSample: number;
        subtopics: Array<{
            name: string;
            passedShare: number | null;
            correctShare: number | null;
            thresholdPercent: number | null;
            inSample: number;
        }>;
    }>;
    /** PRD-55 (FR-31): попытки за окно наблюдения, считая брошенные, — знаменатель доли выдачи. */
    exposureAttempts?: number;
    /** PRD-56 FR-13a: проходной балл в процентах; `null` — тест не оценивает или порог в баллах. */
    thresholdPercent: number | null;
    questionStats: Array<{
        questionId: string;
        questionPrompt: string;
        questionType: string;
        topicId: string;
        topicName: string;
        difficulty: number;
        totalAnswers: number;
        correctAnswers: number;
        /** `null` — оценивать было нечего: у измерительного вопроса эталона нет. */
        correctPercent: number | null;
        /** Сколько ответов оценивалось: знаменатель доли верных. */
        gradedAnswers: number;
        /** PRD-56 FR-15: доля пропусков; `null` — состав выдачи по попытке неизвестен. */
        skipShare: number | null;
        deliveredWeb?: number;
        skippedWeb?: number;
        /** PRD-56 FR-16: признаки, по которым задание попало в вид «требуют ревизии». */
        reviewFlags: Array<{ kind: string; reason: string }>;
        /** PRD-56 FR-17a: задание исключено из выдачи этого теста. */
        excludedFromDelivery?: boolean;
        /** PRD-56 FR-22: разброс ответов измерительного задания вместо доли верных. */
        spread?: { options: Array<{ label: string; share: number; correct?: boolean }>; answered: number } | null;
        /** PRD-57 FR-32: сводка свободного текста — объём и длина вместо частот. */
        volume?: { answered: number; medianLength: number; minLength: number; maxLength: number } | null;
        // PRD-55 (FR-31/FR-31a/FR-32). Необязательные: ответ старой сборки сервера этих полей
        // не несёт, и карточка тогда показывает прочерки вместо выдуманных нулей.
        exposureCount?: number;
        exposurePercent: number | null;
        globalExposureCount?: number;
        otherTestsCount?: number;
        /** Цена задания в этом тесте; `null` у измерительного. */
        points?: number | null;
        latencyMedianMs: number | null;
        latencySampleSize: number;
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
    /** PRD-56 FR-13a: корзины одной ширины с цветом от проходного балла. */
    scoreDistribution: Array<{
        label: string;
        from: number;
        to: number;
        count: number;
        share: number;
        tone: "error" | "warning" | "success" | "neutral";
        holdsThreshold: boolean;
    }>;
    /** PRD-56 FR-13: динамика сдаваемости по месяцам. */
    passTrend: Array<{
        key: string;
        label: string;
        attempts: number;
        judged: number;
        passRate: number | null;
    }>;
}

/** PRD-56 FR-21: ответ вкладки «Шкалы». */
interface ScaleAnalytics {
    observations: number;
    scales: ScaleProfileView[];
}

/** PRD-56 FR-18 - FR-20: ответ вкладки «Выдача». */
interface DeliveryAnalytics {
    variants: VariantSectionView[];
    versions: VersionRowView[];
    exposure: ExposureProfileView | null;
    topics: Array<{ topicId: string; topicName: string }>;
    minObservations: number;
}

/**
 * A percent metric that may not apply at all (PRD-29 §6.7): a measurement test grades
 * nothing, so its average result and pass rate are `null` — «неприменимо», not «ноль».
 * The dash is the same answer `formatDuration` has always given for a missing duration.
 */
/**
 * Ключ чипа «Только первая попытка» в строке фильтра (PRD-66 FR-51).
 *
 * Без двоеточия намеренно: ключи условий фильтра имеют вид «вид:значение», и этот с ними не
 * совпадёт ни при каком значении.
 */
const FIRST_ATTEMPT_CHIP = "first-attempt-only";

/** Процент на плитке обзора — целым, как в эскизе: «79 %». */
function tilePercent(percent: number | null): string {
    return percent === null ? "—" : `${Math.round(percent)} %`;
}

/** Названия источников для подзаголовка шапки. */
const SOURCE_NAMES: Record<string, string> = {
    web: "веб",
    telemetry: "телеметрия LMS",
    import: "импортированные выгрузки",
};

/**
 * Источники, по которым посчитана страница, — словами, как в эскизе: «веб, телеметрия LMS и
 * импортированные выгрузки». Отбор по источнику сужает перечень, а не прячет его.
 */
function sourcesLabel(sources: readonly string[]): string {
    const names = (sources.length ? sources : ["web", "telemetry", "import"])
        .map(source => SOURCE_NAMES[source] ?? source);
    return names.length > 1
        ? `${names.slice(0, -1).join(", ")} и ${names[names.length - 1]}`
        : names[0];
}

function formatDuration(seconds: number | null): string {
    if (seconds === null) return "—";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}




/** Строка «подпись — значение» под текстом вопроса (Ответ / Эталон / Вклад). */

export default function TestAnalyticsPage() {
    const [, params] = useRoute("/author/tests/:testId/analytics");
    const testId = params?.testId;

    // Ссылка «Открыть в аналитике» из редактора теста приходит с `?tab=quality&questionId=…`:
    // вкладка и раскрытый разбор берутся из адреса один раз, при открытии страницы.
    const [deepLink] = useState(() =>
        readQuestionAnalyticsLink(typeof window === "undefined" ? "" : window.location.search),
    );
    const [activeTab, setActiveTab] = useState<string>(deepLink.tab);
    /** PRD-54: окно загрузки выгрузки отчёта LMS. Тест здесь задан страницей. */
    const [lmsImportOpen, setLmsImportOpen] = useState(false);
    /**
     * PRD-56 FR-20: тема профиля экспозиции. Держится в состоянии, а не выводится из данных:
     * профиль строится по банку ОДНОЙ темы, и выбирать её должен читатель.
     */
    const [exposureTopic, setExposureTopic] = useState<string | null>(null);
    /**
     * PRD-56 FR-13: экран считается по отобранному — источнику, группе и периоду. Форма
     * отбора та же, что у реестра, только без условия «тест»: он задан страницей.
     *
     * Условия держатся в адресе тем же хуком, что у реестра, и это не украшение: переход
     * «группа → тест» (FR-24) приводит сюда со своим условием, и прочитать его можно только
     * из адреса. Заодно ссылка на «аналитику теста по этой группе» пересылается коллеге.
     */
    const [filter, setFilter] = useRegistryFilter();
    const [filterOpen, setFilterOpen] = useState(false);
    const dictionaries = useRegistryDictionaries();
    // Вариант и версия — условия внутри теста, а он здесь задан страницей: справочник для
    // чипов и для окна отбора читается по нему.
    const testDictionary = useTestDictionary(testId ?? null);
    const queryClient = useQueryClient();

    const filterSearch = filterToSearch({ ...filter, testIds: [] });
    /**
     * PRD-66 FR-51: психометрика по умолчанию считает только первую попытку каждого участника —
     * повторные попытки того же человека не независимы. Условие живёт здесь, а не в общем фильтре
     * PRD-56: там оно действовало бы и на «Обзор», где считаются все попытки.
     */
    const [firstAttemptOnly, setFirstAttemptOnly] = useState(true);
    /** Чип «Только первая попытка» — только там, где он что-то значит: у психометрики. */
    const showsAttemptChip = firstAttemptOnly && (activeTab === "quality" || activeTab === "questions");
    /**
     * Адрес ручки психометрики с условиями экрана (PRD-66 FR-04a, FR-54b).
     *
     * Выборку «Качества заданий» задаёт тот же фильтр, что у «Обзора»: без условий в адресе
     * автор выбирал группу, а числа считались по всем прохождениям теста. Выгрузки идут по тем же
     * условиям — файл, собранный иначе, чем показано на экране, невоспроизводим. Условие исхода
     * сервер психометрики не читает, как и сервер обзора.
     *
     * @param path путь ручки без параметров
     * @param extra собственные параметры ручки поверх условий экрана
     */
    const psychometricsUrl = (path: string, extra: Record<string, string> = {}): string => {
        const params = new URLSearchParams(filterSearch.replace(/^\?/, ""));
        // Умолчание сервера — первая попытка; параметр нужен только для отказа от неё.
        if (!firstAttemptOnly) params.set("firstAttemptOnly", "false");
        for (const [name, value] of Object.entries(extra)) params.set(name, value);
        const search = params.toString();
        return search ? `${path}?${search}` : path;
    };

    const { data: analytics, isLoading: analyticsLoading } = useQuery<TestAnalytics>({
        queryKey: [`/api/analytics/tests/${testId}`, filterSearch],
        queryFn: async () => {
            const response = await fetch(`/api/analytics/tests/${testId}${filterSearch}`, {
                credentials: "include",
            });
            if (!response.ok) throw new Error("Не удалось загрузить аналитику теста");
            return response.json();
        },
        enabled: !!testId,
    });

    /**
     * PRD-56 FR-18 - FR-20: данные вкладки «Выдача» — своим запросом и ТОЛЬКО когда вкладку
     * открыли: варианты, версии и профиль банка не нужны тому, кто смотрит обзор.
     */
    const { data: delivery } = useQuery<DeliveryAnalytics>({
        queryKey: [
            `/api/analytics/tests/${testId}/delivery`,
            ...(exposureTopic ? [exposureTopic] : []),
        ],
        queryFn: async () => {
            const query = exposureTopic ? `?topicId=${encodeURIComponent(exposureTopic)}` : "";
            const response = await fetch(`/api/analytics/tests/${testId}/delivery${query}`, {
                credentials: "include",
            });
            if (!response.ok) throw new Error("Не удалось загрузить данные выдачи");
            return response.json();
        },
        enabled: !!testId && activeTab === "delivery",
    });

    /** PRD-56 FR-21: профиль по шкалам — тоже своим запросом и только на своей вкладке. */
    const { data: scaleProfile } = useQuery<ScaleAnalytics>({
        queryKey: [`/api/analytics/tests/${testId}/scales`],
        enabled: !!testId && activeTab === "scales",
    });

    /**
     * PRD-66: психометрика — своим запросом и только на своей вкладке.
     *
     * Расчёт идёт по требованию и по всей выборке (порции у метрики нет: её нельзя посчитать
     * по половине наблюдений), поэтому грузить его вместе с обзором значило бы платить за него
     * каждому, кто открыл страницу.
     */
    const { data: itemQuality, isLoading: qualityLoading } = useQuery<ItemQualityView>({
        queryKey: [psychometricsUrl(`/api/analytics/psychometrics/${testId}`)],
        // PRD-66 FR-02, FR-03: те же числа стоят в строке таблицы «Вопросы», поэтому расчёт
        // нужен и там. Ключ запроса ОДИН на обе вкладки: переход между ними не платит за
        // второй расчёт, а колонка и карточка не могут разойтись в числах.
        enabled: !!testId && (activeTab === "quality" || activeTab === "questions"),
    });

    /**
     * Психометрика строкой таблицы: задание -> трудность и дискриминативность.
     *
     * Выборка у неё СВОЯ — первая попытка каждого участника (`firstAttemptOnly` движка), и
     * это сказано подписью под таблицей. Считать её по всем попыткам значило бы складывать
     * зависимые наблюдения: повторная попытка того же человека — не второй участник.
     */
    const questionPsychometrics = useMemo(() => {
        // Списка может не быть вовсе: расчёт ещё в пути либо ручка ответила иначе, чем ждём.
        // Пустая карта тут честнее исключения — колонка покажет прочерк и дождётся чисел.
        if (!itemQuality?.items) return undefined;
        return Object.fromEntries(itemQuality.items.map(item => [item.questionId, {
            difficulty: item.difficulty,
            itemRest: item.itemRest,
            observations: item.observations,
            coefficientConfidence: item.coefficientConfidence,
        }]));
    }, [itemQuality]);

    /**
     * PRD-66 FR-05, FR-48: эвристики PRD-56 «Требуют ревизии» для таблицы качества.
     *
     * Их считает ответ «Обзора» (`questionStats[].reviewFlags`), он уже загружен страницей, и
     * вторую копию правил психометрика не заводит. В карту попадают только задания, где эвристика
     * сработала.
     */
    const reviewHeuristics = useMemo(() => Object.fromEntries(
        (analytics?.questionStats ?? [])
            .filter(question => question.reviewFlags.length > 0)
            .map(question => [question.questionId, {
                kinds: question.reviewFlags.map(flag => flag.kind),
                exposurePercent: question.exposurePercent ?? null,
                correctPercent: question.correctPercent ?? null,
                latencyMedianMs: question.latencyMedianMs ?? null,
            }]),
    ), [analytics]);

    /**
     * PRD-66 FR-24: разбор одного задания — своим запросом и только когда его открыли.
     *
     * Дистракторный разбор требует ответов КАЖДОГО участника по этому заданию, и считать его
     * для всех строк таблицы заранее значило бы платить за сорок разборов ради одного.
     */
    const [breakdownId, setBreakdownId] = useState<string | null>(deepLink.questionId);
    /**
     * Выбранная редакция вопроса: `undefined` — автор ещё не выбирал, и сервер считает карточку по
     * текущей редакции (FR-49a); `null` — «версия неизвестна».
     */
    const [breakdownVersion, setBreakdownVersion] = useState<string | null | undefined>(undefined);
    /**
     * PRD-66 FR-04b: режим вкладки — выборка целиком или сравнение срезов.
     *
     * Переключатель берётся у раздела «Аналитика» без изменений: один механизм обязан
     * выглядеть одинаково на обоих экранах.
     */
    const [qualityMode, setQualityMode] = useState<"sample" | "compare">("sample");
    const { data: breakdown } = useQuery<ItemBreakdownView>({
        queryKey: [psychometricsUrl(
            `/api/analytics/psychometrics/${testId}/items/${breakdownId}`,
            breakdownVersion === undefined ? {} : { version: breakdownVersion ?? "" },
        )],
        enabled: !!testId && !!breakdownId && activeTab === "quality",
    });

    /**
     * PRD-66 FR-29: качество шкал — только у теста, где шкалы есть.
     *
     * У оцениваемого теста без них раздел сказать ничего не может, а пустой блок читается как
     * поломка (FR-52).
     */
    const { data: scaleQuality } = useQuery<{ scales: ScaleQualityRow[] }>({
        queryKey: [psychometricsUrl(`/api/analytics/psychometrics/${testId}/scales`)],
        enabled: !!testId && activeTab === "quality" && !!analytics?.hasScales,
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

    const { summary, topicStats, questionStats, levelStats, scoreDistribution, passTrend } = analytics;

    /**
     * Проходной балл в процентах — подпись гистограммы и место её вертикали.
     *
     * Приходит числом с сервера. Выводить его из раскраски корзин (как было до приёмки Э4)
     * можно лишь при пороге, кратном их ширине: при 75 % такой вывод давал «порог 70 %» и
     * ставил вертикаль на границу столбиков вместо её настоящего места.
     */
    const thresholdPercent = analytics.thresholdPercent ?? null;

    /**
     * Плитки сводки — на «Обзоре», а не над вкладками (эскиз prd56-test-analytics, состояние
     * overview; план сверки, 5.1). Над вкладками они стояли на каждой из них, и на «Качестве
     * заданий» к ним добавлялись свои четыре: девять чисел подряд, из которых половина к вкладке
     * отношения не имеет. Четыре однородные величины, время — медианой: среднее тянут
     * брошенные и забытые открытыми вкладки.
     */
    const summaryTiles: Array<{ value: string; label: string; hint?: string }> = [
        { value: String(summary.completedAttempts), label: "Прохождений" },
        {
            value: tilePercent(summary.passRate),
            label: "Сдали",
            ...(summary.passRate === null ? { hint: "вердикт не выносится" } : {}),
        },
        {
            value: tilePercent(summary.avgPercent),
            label: "Средний результат",
            ...(summary.avgPercent === null ? { hint: "тест не оценивает ответы" } : {}),
        },
        { value: formatDuration(summary.medianDuration ?? null), label: "Время, медиана" },
    ];

    const overviewPanel = (
        <Stack gap={5}>
            <Grid minItem="sm" gap={1}>
                {summaryTiles.map(tile => (
                    <Card key={tile.label} variant="outlined">
                        <CardBody>
                            <Stack gap={1} align="center">
                                <Text variant="display-s" weight="bold">{tile.value}</Text>
                                <Text variant="body-s" tone="muted">{tile.label}</Text>
                                {tile.hint ? <Text variant="body-xs" tone="subtle">{tile.hint}</Text> : null}
                            </Stack>
                        </CardBody>
                    </Card>
                ))}
            </Grid>
            {/*
              PRD-56 FR-13, FR-13a, FR-14: три блока обзора, и каждый отвечает на свой вопрос —
              как результаты легли относительно порога, где тяжёлые темы и что меняется со
              временем. Считает их сервер по ВСЕМ источникам (FR-25), экран только показывает.
            */}
            <ScoreDistribution
                buckets={scoreDistribution}
                completed={summary.completedAttempts}
                thresholdPercent={thresholdPercent}
            />
            <TopicBreakdown topics={topicStats} />
            <PassTrend points={passTrend} />
        </Stack>
    );

    /**
     * PRD-56 FR-17a: исключить вопрос из выдачи или вернуть его. Один обработчик на две таблицы —
     * «Вопросы» и «Качество вопросов»: действие одно, и расходиться ему негде.
     *
     * Состояние меняется там же, где видно. Отказ сервера (выдачу собрать нельзя) показывается
     * как есть: он и есть ответ на вопрос «почему нельзя». После успеха перечитываются и
     * статистика вопросов (там живёт признак «исключён»), и психометрика теста.
     */
    const changeDelivery = async (questionId: string, excluded: boolean) => {
        const response = await fetch(
            `/api/analytics/tests/${testId}/questions/${questionId}/delivery`,
            {
                method: "PUT",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ excluded }),
            },
        );
        if (!response.ok) {
            const data = await response.json().catch(() => ({})) as { error?: string };
            alert(data.error ?? "Не удалось изменить состояние вопроса");
            return;
        }
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: [`/api/analytics/tests/${testId}`] }),
            queryClient.invalidateQueries({
                predicate: query => {
                    const head = query.queryKey[0];
                    const base = `/api/analytics/psychometrics/${testId}`;
                    return typeof head === "string"
                        && (head === base || head.startsWith(`${base}/`) || head.startsWith(`${base}?`));
                },
            }),
        ]);
    };

    /** Какие вопросы исключены из выдачи — меню «Качества вопросов» предлагает их вернуть. */
    const excludedFromDelivery = Object.fromEntries(
        questionStats
            .filter(question => question.excludedFromDelivery)
            .map(question => [question.questionId, true]),
    );

    const questionsPanel = (
        /*
          PRD-56 FR-15 - FR-17: одна таблица вместо карточек. Карточки не сравнивались между
          собой — а разбор задания начинается со сравнения: где доля верных ниже, где чаще
          выдаётся, где отвечают подозрительно быстро.
        */
        <QuestionTable
            questions={questionStats}
            testId={testId ?? undefined}
            passages={summary.completedAttempts}
            // FR-22: измерительным тест считается по ФАКТУ — прохождения есть, а оценённых
            // среди них нет ни одного. Объявленный проходной балл признаком не годится:
            // опросник нередко несёт его по умолчанию, ничего при этом не оценивая, и тест
            // с порогом 70 % показывал бы колонку «Доля верных», пустую во всех строках.
            //
            // Тот же счёт стоит за «неприменимо» в плитках (PRD-29 §6.7). Пока прохождений
            // нет вовсе, таблица остаётся обычной: набор колонок не должен зависеть от того,
            // успел ли кто-то пройти тест.
            measurement={summary.completedAttempts > 0 && summary.gradedAttempts === 0}
            minObservations={analytics.minObservations}
            onDeliveryChange={changeDelivery}
            onOpenRegistry={questionId => {
                // FR-17: переход в реестр к прохождениям, где на задании ошиблись. Условия
                // отбора живут в адресе реестра (FR-03), поэтому это обычная ссылка.
                window.location.href = `/author/analytics?testId=${testId}&outcome=failed&questionId=${questionId}`;
            }}
            psychometrics={questionPsychometrics}
            onOpenQuality={questionId => {
                // PRD-66 FR-03: дискриминативность — вход в разбор задания, а не просто
                // число. Переход открывает КАРТОЧКУ на своей вкладке: возвращать автора к
                // списку, из которого он только что пришёл, значит заставить искать строку
                // второй раз.
                setBreakdownId(questionId);
                setBreakdownVersion(undefined);
                setActiveTab("quality");
            }}
        />
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

    /**
     * PRD-56 FR-18 - FR-20: вкладка «Выдача» — как тест выдавался и кому что досталось.
     *
     * Сюда же переехала статистика по уровням адаптивного теста: она о том же — об устройстве
     * выдачи, — и отдельной вкладки ей не нужно.
     */
    const deliveryPanel = (
        <Stack gap={5}>
            <VariantTable sections={delivery?.variants ?? []} />
            <VersionTable versions={delivery?.versions ?? []} />
            <ExposureProfile
                profile={delivery?.exposure ?? null}
                topics={delivery?.topics ?? []}
                onTopicChange={setExposureTopic}
            />
            {analytics.testMode === "adaptive" && levelsPanel}
        </Stack>
    );

    /**
     * PRD-56 FR-13, FR-31: один фильтр на экран, и стоит он ПОД вкладками, над их содержимым
     * (эскизы prd56-test-analytics и prd66-item-quality: шапка, вкладки, фильтр). Всё, что
     * ниже, посчитано по отобранному. Условия те же, что в реестре, минус тест: он задан
     * страницей.
     */
    const filterBar = (
        <FilterBar
            count={countConditions({ ...filter, testIds: [] }) + (showsAttemptChip ? 1 : 0)}
            applied={[
                ...describeConditions(
                  { ...filter, testIds: [] },
                  { ...dictionaries, ...testDictionary },
                ),
                // FR-51: снимается крестиком; путь назад — кнопка в предупреждении вкладки.
                ...(showsAttemptChip ? [{ id: FIRST_ATTEMPT_CHIP, label: "Только первая попытка" }] : []),
            ]}
            // FR-04b, эскиз: вход в сравнение срезов — рядом с фильтром, потому что
            // сравнение и есть несколько фильтров рядом. Только на «Качестве заданий» и
            // только вне режима: внутри него выход — переключатель в шапке карточки.
            actions={activeTab === "quality" && qualityMode === "sample" ? (
                <Button
                    variant="ghost"
                    size="s"
                    trailingIcon={<ChevronRight size={14} />}
                    onClick={() => { setBreakdownId(null); setQualityMode("compare"); }}
                >
                    Сравнить срезы
                </Button>
            ) : undefined}
            onOpenFilter={() => setFilterOpen(true)}
            onRemove={(id: string) => {
                const [kind, value] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
                if (id === FIRST_ATTEMPT_CHIP) {
                    setFirstAttemptOnly(false);
                } else if (kind === "group") {
                    setFilter({ ...filter, groupIds: filter.groupIds.filter(x => x !== value) });
                } else if (kind === "source") {
                    setFilter({ ...filter, sources: filter.sources.filter(x => x !== value) });
                } else if (kind === "outcome") {
                    setFilter({ ...filter, outcomes: filter.outcomes.filter(x => x !== value) });
                } else if (kind === "form") {
                    setFilter({ ...filter, formIds: filter.formIds.filter(x => x !== value) });
                } else if (kind === "snapshot") {
                    setFilter({ ...filter, snapshotIds: filter.snapshotIds.filter(x => x !== value) });
                } else if (id === "period") {
                    setFilter({ ...filter, from: undefined, to: undefined });
                }
            }}
            // Сброс возвращает умолчания — а умолчание психометрики «первая попытка».
            onReset={() => { setFilter(EMPTY_FILTER); setFirstAttemptOnly(true); }}
            resetLabel="Сбросить фильтры"
        />
    );

    /** Содержимое вкладки под общим фильтром. */
    const underFilter = (content: ReactNode) => (
        <Stack gap={4}>
            {filterBar}
            {content}
        </Stack>
    );

    return (
        <Stack gap={6}>
            {/*
              Шапка по эскизу (prd56-test-analytics, шаблон wf-head-tpl): возврат к тестам над
              названием, под ним — объём и источники, по которым посчитана страница. Справа
              кнопки PRD-54 (эскиз prd54-lms-import ставит загрузку рядом с экспортом), затем
              переход в реестр и «Обновить».
            */}
            {/* Кнопки держатся справа, как в эскизе: при нехватке места переносится подзаголовок и
                сами кнопки — вторым рядом справа, а не под название. */}
            <Cluster justify="between" align="start" wrap={false}>
                <Stack gap={1} align="start">
                    <Link href="/author/tests">
                        <Button variant="ghost" size="s" leadingIcon={<ArrowLeft size={16} />}>
                            Все тесты
                        </Button>
                    </Link>
                    <Text as="h1" variant="heading-l">{analytics.testTitle}</Text>
                    <Text tone="muted">
                        {`${summary.completedAttempts} ${pluralize(summary.completedAttempts, "завершённое прохождение", "завершённых прохождения", "завершённых прохождений")} · ${sourcesLabel(filter.sources)}`}
                        {/* FR-52, эскиз wf-scales: почему у вкладки качества нет плиток и таблицы
                            вопросов, говорит подзаголовок, а не отдельная карточка. Признак — тот же,
                            что у таблицы вопросов (прохождения есть, оценённых нет), а не ответ
                            вкладки качества: тот грузится только на ней, и шапка менялась бы при
                            переключении вкладок. */}
                        {summary.completedAttempts > 0 && summary.gradedAttempts === 0
                            ? " · измерительный тест, эталона у вопросов нет"
                            : ""}
                    </Text>
                </Stack>
                {/* Кнопки одной группы — 4 px, как в эскизе (план сверки 6.2, 6.4). */}
                <Cluster gap={1} justify="end" align="center">
                    {/* PRD-54: третья точка входа. Тест здесь ЗАДАН страницей, поэтому файл
                        чужого теста форма отвергнет — см. `fixedTestId`. */}
                    <Button
                        variant="secondary"
                        size="s"
                        leadingIcon={<Upload size={16} />}
                        onClick={() => setLmsImportOpen(true)}
                    >
                        Загрузить выгрузку LMS
                    </Button>
                    <Button onClick={handleExportExcel} variant="secondary" size="s" leadingIcon={<FileSpreadsheet size={16} />}>
                        Экспорт Excel
                    </Button>
                    {/*
                      PRD-56 FR-23: список попыток со страницы снят — он есть в реестре
                      прохождений, где умеет фильтровать, догружать порциями и вести в разбор.
                      Два списка на продукт означали бы два ответа на вопрос «кто проходил».
                    */}
                    <Link href={`/author/analytics?testId=${testId}`}>
                        <Button variant="secondary" size="s" trailingIcon={<ChevronRight size={16} />}>
                            Прохождения теста
                        </Button>
                    </Link>
                    {/* Значком, а не текстом (решение владельца 2026-09-26, план 6.4): четыре текстовые
                        кнопки не помещались в строку, и «Обновить» уходило вторым рядом. Имя для
                        экранного диктора и подсказка при наведении — те же слова. */}
                    <IconButton
                        variant="ghost"
                        size="s"
                        aria-label="Обновить"
                        title="Обновить"
                        icon={<RefreshCw size={16} />}
                        onClick={() => invalidateAnalytics(queryClient)}
                    />
                </Cluster>
            </Cluster>

            <LmsImportDialog
                open={lmsImportOpen}
                onClose={() => setLmsImportOpen(false)}
                description={analytics.testTitle}
                fixedTestId={testId}
                onDone={() => invalidateAnalytics(queryClient)}
            />

            <RegistryFilterDialog
                open={filterOpen}
                filter={filter}
                hideTest
                scopeTestId={testId ?? null}
                onApply={setFilter}
                onClose={() => setFilterOpen(false)}
            />

            {/* Tabs */}
            <Tabs
                value={activeTab}
                onChange={setActiveTab}
                items={[
                    { id: "overview", label: "Обзор", content: underFilter(overviewPanel) },
                    { id: "questions", label: "Вопросы", content: underFilter(questionsPanel) },
                    // PRD-66: пригодность задания как инструмента — отдельный вопрос от того,
                    // что с ним происходит, и потому отдельная вкладка.
                    {
                        id: "quality",
                        label: "Качество вопросов",
                        content: underFilter(qualityLoading
                            ? <LoadingState message="Считаем психометрику..." />
                            : qualityMode === "compare"
                            ? (
                                // FR-04b, эскиз: режим — одна карточка, выход из него —
                                // переключатель «Одна выборка / Сравнение» в её шапке.
                                <PsychometricsComparePanel
                                    testId={testId!}
                                    firstAttemptOnly={firstAttemptOnly}
                                    onExit={() => setQualityMode("sample")}
                                />
                            )
                            : breakdownId && breakdown
                                ? (
                                    <ItemBreakdownPanel
                                        view={breakdown}
                                        version={breakdownVersion}
                                        onSelectVersion={setBreakdownVersion}
                                        onBack={() => { setBreakdownId(null); setBreakdownVersion(undefined); }}
                                    />
                                )
                                : itemQuality?.measurementOnly
                                    // FR-52, эскиз wf-scales: у измерительного теста вкладка —
                                    // только раздел шкал, без плиток и таблицы вопросов.
                                    ? (scaleQuality
                                        ? <ScaleQualityPanel scales={scaleQuality.scales} />
                                        : analytics.hasScales
                                            ? <LoadingState message="Считаем психометрику..." />
                                            : <ScaleQualityPanel scales={[]} />)
                                : itemQuality
                                    ? (
                                        <Stack gap={4}>
                                            <ItemQualityPanel
                                                view={itemQuality}
                                                exportHref={psychometricsUrl(`/api/analytics/psychometrics/${testId}/export`)}
                                                matrixHref={psychometricsUrl(`/api/analytics/psychometrics/${testId}/matrix`)}
                                                onOpenItem={setBreakdownId}
                                                testId={testId ?? undefined}
                                                onDeliveryChange={changeDelivery}
                                                excluded={excludedFromDelivery}
                                                onRestoreFirstAttempt={() => setFirstAttemptOnly(true)}
                                                heuristics={reviewHeuristics}
                                            />
                                            {scaleQuality?.scales.length
                                                ? <ScaleQualityPanel scales={scaleQuality.scales} />
                                                : null}
                                        </Stack>
                                    )
                                    : <EmptyState title="Психометрика недоступна" description="Не удалось посчитать показатели по этому тесту" />),
                    },
                    // PRD-56: «Уровни» отдельной вкладкой больше нет — они внутри «Выдачи».
                    { id: "delivery", label: "Выдача", content: underFilter(deliveryPanel) },
                    // Вкладка есть только у теста со шкалами: оцениваемому тесту без них она
                    // сказать ничего не может, а пустая вкладка читается как поломка.
                    ...(analytics.hasScales
                        ? [{
                            id: "scales",
                            label: "Шкалы",
                            content: underFilter(
                                <ScaleProfilePanel
                                    scales={scaleProfile?.scales ?? []}
                                    observations={scaleProfile?.observations ?? 0}
                                />
                            ),
                        }]
                        : []),
                ]}
            />

        </Stack>
    );
}

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
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PassTrend } from "@/features/analytics/test/pass-trend";
import { TestExportDialog } from "@/features/analytics/test/test-export-dialog";
import { ScoreDistribution } from "@/features/analytics/test/score-distribution";
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
    IndicatorProfilePanel,
    type IndicatorProfileView,
} from "@/features/analytics/test/indicator-profile";
import {
    countSuspicious,
    reviewHeuristicsOf,
    type ItemQualityView,
} from "@/features/analytics/test/item-quality";
import { QuestionsTab, type ColumnSet, type QuestionsTabView } from "@/features/analytics/test/questions-tab";
import { TestAttention } from "@/features/analytics/test/test-attention";
import {
    BreakdownTitle,
    breakdownSubtitle,
    ItemBreakdownPanel,
    versionLabel,
    type ItemBreakdownView,
} from "@/features/analytics/test/item-breakdown";
import { AnalyticsHeader } from "@/features/analytics/levels/analytics-header";
import {
    ScaleQualityPanel,
    type ScaleQualityRow,
} from "@/features/analytics/test/scale-quality";
import { invalidateAnalytics } from "@/features/analytics/invalidate-analytics";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams, useSearch } from "wouter";
import {
    bankQuestionHref,
    filterOutOfTest,
    generalHref,
    questionHref,
    returnHrefOf,
    testHref,
} from "@/features/analytics/levels/analytics-routes";
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
    MenuItem,
    MenuTrigger,
    Select,
    Stack,
    Tabs,
    Tag,
    Text,
    useToast,
} from "@skillum/ui-kit";
import { LoadingState } from "@/components/loading-state";
import { TEST_ANALYTICS_TABS } from "@/features/analytics/test/question-analytics-link";
import { useAnalyticsTab } from "@/features/analytics/levels/use-analytics-tab";
import { pluralize } from "@/lib/i18n";
import { RegistryFilterPanel } from "@/features/analytics/registry/filter-panel";
import { currentHref, stateForDive, trailOf, type TrailCrumb } from "@/features/analytics/levels/trail";
import {
    conditionsOf,
    errorText,
    savedSetState,
    testLevelFilters,
    useSavedFilters,
    withoutTests,
} from "@/features/analytics/registry/use-saved-filters";
import {
    countConditions,
    describeConditions,
    filterToSearch,
    EMPTY_FILTER,
    ORG_CONDITIONS,
    conditionsToFilter,
    type RegistryFilter,
} from "@/features/analytics/registry/filter-state";
import { PassageRegistry, type RegistryRow } from "@/features/analytics/registry/passage-registry";
import { TestSlicesTab } from "@/features/analytics/slices/test-slices-tab";
import {
    QuestionInTestCard,
    type QuestionCardView,
} from "@/features/analytics/test/question-card";
import { DeliveryExclusionDialog, type ExclusionTarget } from "@/features/analytics/test/delivery-exclusion-dialog";
import { renderBlanksText } from "@shared/questions/blanks-render";
import type { UnitsView } from "@/features/analytics/test/answer-distribution";
import {
    NotGradedTiles,
    QuestionAnswersCard,
    SpreadCard,
    UnitsCard,
} from "@/features/analytics/test/question-distribution";
import { SimulationAnalytics, type SimulationStatsView } from "@/features/analytics/test/simulation-analytics";
import { QuestionTypeIcon } from "@/features/tests/editor/sections/question-type-icon";
import { questionInTopicHref } from "@/features/content/question-link";
import { ResultsByAxis } from "@/features/analytics/slices/results-by-axis";
import { SaveSliceDialog } from "@/features/analytics/slices/save-slice-dialog";
import {
    AttemptDetailsDialog,
    attemptOfRegistryRow,
    exportAttemptWorkbook,
    type CombinedAttempt,
} from "@/features/analytics/attempt/attempt-details-dialog";
import { ATTEMPT_PICK_CHIP_LABEL, DEFAULT_ATTEMPT_PICK, type AttemptPick } from "@shared/analytics/attempt-pick";
import { percent } from "@/features/analytics/format";
import { useRegistryDictionaries, useTestDictionary } from "@/features/analytics/registry/use-dictionaries";
import { useRegistryFilter } from "@/features/analytics/registry/use-registry-filter";
import {
    ArrowLeft,
    BarChart3,
    ChevronLeft,
    ChevronRight,
    MoreHorizontal,
    HelpCircle,
    Layers,
    FileSpreadsheet,
    RefreshCw,
} from "lucide-react";

// Types
interface TestAnalytics {
    testId: string;
    testTitle: string;
    testMode: "standard" | "adaptive";
    /** PRD-56 FR-21: у теста есть шкалы — вкладка «Шкалы и показатели» и её блок шкал. */
    hasScales?: boolean;
    /** PRD-56 FR-21c: у теста есть показатели — вкладка «Шкалы и показатели» и её блок показателей. */
    hasIndicators?: boolean;
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
        difficulty: number | null;
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
        /** Э4а: разбор сопоставления, ранжирования и пропусков по единицам. */
        units?: UnitsView | null;
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

/** PRD-56 FR-21, FR-21c: ответ вкладки «Шкалы и показатели». */
interface ScaleAnalytics {
    observations: number;
    scales: ScaleProfileView[];
    indicators: IndicatorProfileView[];
}

/** PRD-56 FR-18 - FR-20: ответ вкладки «Выдача». */
interface DeliveryAnalytics {
    variants: VariantSectionView[];
    versions: VersionRowView[];
    /** По профилю на раздел теста (замечание владельца 2026-10-04: темы — блоками, без выбора). */
    exposure: ExposureProfileView[];
    minObservations: number;
}

/**
 * A percent metric that may not apply at all (PRD-29 §6.7): a measurement test grades
 * nothing, so its average result and pass rate are `null` — «неприменимо», not «ноль».
 * The dash is the same answer `formatDuration` has always given for a missing duration.
 */
/**
 * Ключ чипа правила попыток («Только первая / лучшая / последняя попытка») в строке фильтра
 * (PRD-66 FR-51).
 *
 * Без двоеточия намеренно: ключи условий фильтра имеют вид «вид:значение», и этот с ними не
 * совпадёт ни при каком значении.
 */
const ATTEMPTS_CHIP = "attempts-pick";

/** Процент на плитке обзора — целым, как в эскизе: «79 %». */
const tilePercent = (value: number | null): string => percent(value);

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

/** Ключ редакции для выбора: «версия неизвестна» — пустая строка. */
function versionKeyOf(hash: string | null | undefined): string {
    return hash ?? "";
}

/**
 * PRD-70 FR-50: подзаголовок карточки «Вопрос в банке» — где ещё выдавался и сколько редакций.
 *
 * @param otherTests в скольких других тестах вопрос выдавался за окно
 * @param windowMonths окно счётчика выдач
 * @param versions сколько редакций содержания в выборке
 */
function bankCardSubtitle(otherTests: number, windowMonths: number, versions: number): string {
    const where = otherTests > 0
        ? `Выдавался ещё в ${otherTests} ${pluralize(otherTests, "тесте", "тестах", "тестах")} за ${windowMonths} мес.`
        : `В других тестах за ${windowMonths} мес. не выдавался`;
    return versions > 1
        ? `${where} · ${versions} ${pluralize(versions, "редакция", "редакции", "редакций")} содержания`
        : where;
}

export default function TestAnalyticsPage() {
    // Э2: страница отвечает двум уровням — тесту и вопросу в тесте. Вопрос — сегмент адреса
    // (`/author/analytics/tests/:testId/questions/:questionId`), а не состояние страницы: на разбор
    // вопроса ведёт ссылка, «Назад» возвращает к таблице.
    const params = useParams<{ testId: string; questionId?: string }>();
    const testId = params.testId;
    const routeQuestionId = params.questionId ?? null;
    const [, navigate] = useLocation();

    // Э2: вкладка — в адресе (`?tab=`): «Назад» возвращает на прежнюю, ссылка открывает ту же.
    const [tabState, setActiveTab] = useAnalyticsTab(TEST_ANALYTICS_TABS, "overview");
    // Э4б: вкладки «Качество вопросов» нет. Старая ссылка `?tab=quality` открывает «Вопросы» с
    // набором колонок «Психометрика» — её содержимое живёт там.
    const search = useSearch();
    useEffect(() => {
        const params = new URLSearchParams(search);
        if (params.get("tab") !== "quality") return;
        params.set("tab", "questions");
        params.set("cols", "psychometrics");
        navigate(`${window.location.pathname}?${params.toString()}`, { replace: true, state: window.history.state });
    }, [search, navigate]);
    // Разбор вопроса — уровень вопроса; запросы психометрики на нём включены, как у «Вопросов».
    const activeTab = routeQuestionId ? "questions" : tabState;
    /** PRD-54: окно загрузки выгрузки отчёта LMS. Тест здесь задан страницей. */
    /**
     * PRD-56 FR-20: тема профиля экспозиции. Держится в состоянии, а не выводится из данных:
     * профиль строится по банку ОДНОЙ темы, и выбирать её должен читатель.
     */
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
    const filterButtonRef = useRef<HTMLButtonElement>(null);
    /** Э3.1: окно «Детали попытки» — то же, что на общем уровне. */
    const [openedAttempt, setOpenedAttempt] = useState<CombinedAttempt | null>(null);
    /**
     * Э5.2: окно «Экспорт» — книга результатов, психометрический отчёт и матрица ответов по
     * условиям фильтра страницы. Одно на уровень: кнопка в шапке видна на любой вкладке.
     */
    const [exportOpen, setExportOpen] = useState(false);
    const dictionaries = useRegistryDictionaries();
    // Вариант и версия — условия внутри теста, а он здесь задан страницей: справочник для
    // чипов и для окна отбора читается по нему.
    const testDictionary = useTestDictionary(testId ?? null, true, filter.wrongQuestionIds);
    const queryClient = useQueryClient();

    const filterSearch = filterToSearch({ ...filter, testIds: [] });
    /** Условия фильтра уровня теста на языке среза — без теста: он задан страницей. */
    const filterConditions: Record<string, unknown> = (({ testIds: _testIds, ...rest }) => rest)(filter);
    const hasFilterConditions = countConditions({ ...filter, testIds: [] }) > 0;
    /**
     * Э3.2: «Прохождения» этого теста с условиями среза — одним переходом (условия и вкладка),
     * состояние истории сохраняется для крошки «Аналитика».
     */
    const openPassages = (conditions: Record<string, unknown>) => {
        navigate(testHref(testId!, { ...EMPTY_FILTER, ...conditionsToFilter(conditions) }, "passages"), {
            state: typeof window === "undefined" ? undefined : window.history.state,
        });
    };
    /** Э3.2: во вкладку «Срезы», в сравнение — с присланным отбором в первом слоте. */
    const compareInSlices = (conditions: Record<string, unknown>, name: string | null) => {
        setCompareAdhoc({ conditions, name });
        setActiveTab("slices");
    };
    /**
     * PRD-66 FR-51: психометрика по умолчанию считает только первую попытку каждого участника —
     * повторные попытки того же человека не независимы. Читатель может выбрать иное правило — все,
     * лучшую, последнюю (дельта 2026-10-07). Условие живёт здесь, а не в общем фильтре PRD-56: там
     * оно действовало бы и на «Обзор», где считаются все попытки.
     */
    const [attempts, setAttempts] = useState<AttemptPick>(DEFAULT_ATTEMPT_PICK);
    /** Чип правила попыток — только там, где он что-то значит: у психометрики. */
    const showsAttemptChip = attempts !== "all" && activeTab === "questions";
    /**
     * Адрес ручки психометрики с условиями экрана (PRD-66 FR-04a, FR-54b).
     *
     * Выборку «Качества вопросов» задаёт тот же фильтр, что у «Обзора»: без условий в адресе
     * автор выбирал группу, а числа считались по всем прохождениям теста. Выгрузки идут по тем же
     * условиям — файл, собранный иначе, чем показано на экране, невоспроизводим. Условие исхода
     * сервер психометрики не читает, как и сервер обзора.
     *
     * @param path путь ручки без параметров
     * @param extra собственные параметры ручки поверх условий экрана
     */
    const psychometricsUrl = (path: string, extra: Record<string, string> = {}): string => {
        const params = new URLSearchParams(filterSearch.replace(/^\?/, ""));
        // Умолчание сервера — первая попытка; параметр нужен только для иного правила.
        if (attempts !== DEFAULT_ATTEMPT_PICK) params.set("attempts", attempts);
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
        queryKey: [`/api/analytics/tests/${testId}/delivery`],
        queryFn: async () => {
            const response = await fetch(`/api/analytics/tests/${testId}/delivery`, {
                credentials: "include",
            });
            if (!response.ok) throw new Error("Не удалось загрузить данные выдачи");
            return response.json();
        },
        enabled: !!testId && activeTab === "delivery",
    });

    /**
     * PRD-56 FR-21, FR-21c: профиль по шкалам и показателям — своим запросом и только на своей
     * вкладке. Условия экрана — в адресе (FR-21f): вкладка стоит под тем же фильтром, что и
     * остальные, и считать её по другой выборке значило бы показывать не то, что отобрано.
     */
    const { data: scaleProfile } = useQuery<ScaleAnalytics>({
        queryKey: [`/api/analytics/tests/${testId}/scales${filterSearch}`],
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
        // Э3.4: и на «Обзоре» — блок «Требует внимания» считает вопросы под подозрением тем же
        // расчётом, что вид «Под подозрением»; ключ общий, переход между вкладками не платит.
        enabled: !!testId && (activeTab === "questions" || activeTab === "overview"),
    });

    /**
     * PRD-66 FR-05, FR-48: эвристики PRD-56 «Требуют ревизии» для таблицы качества.
     *
     * Их считает ответ «Обзора» (`questionStats[].reviewFlags`), он уже загружен страницей, и
     * вторую копию правил психометрика не заводит. В карту попадают только задания, где эвристика
     * сработала.
     */
    const reviewHeuristics = useMemo(
        () => reviewHeuristicsOf(analytics?.questionStats),
        [analytics],
    );

    /**
     * PRD-66 FR-24: разбор одного задания — своим запросом и только когда его открыли.
     *
     * Дистракторный разбор требует ответов КАЖДОГО участника по этому заданию, и считать его
     * для всех строк таблицы заранее значило бы платить за сорок разборов ради одного.
     */
    const breakdownId = routeQuestionId;
    /**
     * Открыть разбор вопроса — перейти на его адрес; `null` — вернуться к таблице вопросов.
     *
     * Э3.3: в состояние перехода уходят порядок таблицы, из которой пришли (по нему ходят
     * «Предыдущий / Следующий»), и её вкладка (туда возвращает крошка теста). Адрес возврата
     * крошки «Аналитика» в том же состоянии сохраняется.
     */
    const setBreakdownId = (questionId: string | null, order?: string[]) => {
        if (!testId) return;
        const current = (typeof window === "undefined" ? null : window.history.state) as Record<string, unknown> | null;
        navigate(questionId ? questionHref(testId, questionId, filter) : testHref(testId, filter, "questions"), {
            state: questionId
                ? { ...(current ?? {}), ...(order ? { questionOrder: order, questionFrom: activeTab } : {}) }
                : current,
        });
    };
    /** Э3.3: состояние перехода на уровень вопроса — порядок таблицы и вкладка, откуда пришли. */
    const questionState = (typeof window === "undefined" ? null : window.history.state) as
        { questionOrder?: string[]; questionFrom?: string } | null;
    /**
     * Э3.4: вид таблиц, в который ведёт блок «Требует внимания» на «Обзоре». Таблицы держат вид
     * сами; переход задаёт начальный и пересоздаёт таблицу ключом.
     */
    // Э3.4, Э4б: корзина общего «Требует внимания» открывает тест сразу в виде «Под подозрением»
    // набора «Психометрика»; блок «Требует внимания» на «Обзоре» — тоже.
    const [questionsView, setQuestionsView] = useState<QuestionsTabView>(() => {
        const wanted = (typeof window === "undefined" ? null : window.history.state as { questionsView?: string } | null)?.questionsView;
        return wanted === "suspicious" || wanted === "thin" || wanted === "excluded" ? wanted : "all";
    });
    const [questionsSet, setQuestionsSet] = useState<ColumnSet | undefined>(() => {
        const wanted = (typeof window === "undefined" ? null : window.history.state as { questionsSet?: string } | null)?.questionsSet;
        return wanted === "psychometrics" || wanted === "delivery" || wanted === "main" ? wanted : undefined;
    });
    /** Э3.3: окно «Исключить из выдачи» на уровне вопроса. */
    const [excludeTarget, setExcludeTarget] = useState<ExclusionTarget | null>(null);
    const cardKey = `/api/analytics/tests/${testId}/questions/${routeQuestionId}/card`;
    /** Э3.3: «Вопрос в этом тесте» и «Этот вопрос в других тестах». */
    const { data: questionCard } = useQuery<QuestionCardView>({
        queryKey: [cardKey],
        enabled: !!testId && !!routeQuestionId,
    });
    /**
     * «Сценарий в ИС» (Э5б): число прогонов в подзаголовке — из того же запроса, что и панель
     * сценария (ключ совпадает, запрос один). Строка таблицы вопросов режим попыток не учитывает,
     * и подзаголовок расходился бы с «Исходами».
     */
    const { data: simulationStats } = useQuery<SimulationStatsView>({
        queryKey: [`/api/analytics/tests/${testId}/questions/${routeQuestionId}/simulation${psychometricsUrl("", { attempts })}`],
        enabled: !!testId && !!routeQuestionId && questionCard?.questionType === "simulation",
    });
    /**
     * Выбранная редакция вопроса: `undefined` — автор ещё не выбирал, и сервер считает карточку по
     * текущей редакции (FR-49a); `null` — «версия неизвестна».
     */
    const [breakdownVersion, setBreakdownVersion] = useState<string | null | undefined>(undefined);
    /**
     * Э3.2: отбор, присланный во вкладку «Срезы» кнопкой «Сравнить со срезом» или строкой
     * «Результатов по группам». Сравнение срезов переехало туда с «Качества вопросов».
     */
    const [compareAdhoc, setCompareAdhoc] = useState<{ conditions: Record<string, unknown>; name: string | null } | null>(null);
    /** Э3.2: окно «Сохранить как срез» фильтра уровня теста. */
    const [saveSliceOpen, setSaveSliceOpen] = useState(false);
    /**
     * Сохранённые фильтры (решение владельца 2026-10-05): меню «Сохранённые» — критерии отбора,
     * а не срезы. Фильтр переносим между наборами данных, поэтому на уровне теста он сохраняется
     * и сравнивается без теста: тест задан страницей. Срезы — кнопкой «Сохранить как срез» и на
     * вкладке «Срезы».
     */
    const savedFilters = useSavedFilters();
    const [appliedSetId, setAppliedSetId] = useState<string | null>(null);
    const { push: toast } = useToast();
    const { data: breakdown, isFetched: breakdownFetched } = useQuery<ItemBreakdownView>({
        queryKey: [psychometricsUrl(
            `/api/analytics/psychometrics/${testId}/items/${breakdownId}`,
            breakdownVersion === undefined ? {} : { version: breakdownVersion ?? "" },
        )],
        enabled: !!testId && !!breakdownId,
    });

    /**
     * PRD-66 FR-29: качество шкал — только у теста, где шкалы есть.
     *
     * У оцениваемого теста без них раздел сказать ничего не может, а пустой блок читается как
     * поломка (FR-52).
     */
    const { data: scaleQuality } = useQuery<{ scales: ScaleQualityRow[] }>({
        queryKey: [psychometricsUrl(`/api/analytics/psychometrics/${testId}/scales`)],
        enabled: !!testId && activeTab === "scales" && !!analytics?.hasScales,
    });


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
            {/* Э3.4: точки внимания уровня теста — качество вопросов. Сводка посчитанного; строка
                ведёт в тот вид таблицы, чьё число в ней стоит. */}
            <TestAttention
                questions={questionStats.length}
                pending={!itemQuality && qualityLoading}
                lines={[
                    ...(itemQuality?.measurementOnly ? [] : [{
                        key: "suspicious",
                        title: "Вопросы под подозрением",
                        count: itemQuality ? countSuspicious(itemQuality, reviewHeuristics) : 0,
                        caption: "сильные ошибаются чаще, на уровне угадывания, слишком лёгкие или трудные",
                        // Э4б: «Требуют ревизии» вошли в «Под подозрением» — отбор один, причина
                        // названа в колонке «Что не так».
                        onShow: () => { setQuestionsView("suspicious"); setQuestionsSet("psychometrics"); setActiveTab("questions"); },
                    }]),
                    {
                        key: "excluded",
                        title: "Исключены из выдачи",
                        count: questionStats.filter(question => question.excludedFromDelivery).length,
                        caption: "не попадают в новые прохождения",
                        onShow: () => { setQuestionsView("excluded"); setQuestionsSet(undefined); setActiveTab("questions"); },
                    },
                ]}
            />
            {/* Э3.2: разбивка по полю участника — бывший «Список срезов» по оси. Это не срез:
                строку можно сохранить срезом, сравнить или открыть её прохождения. */}
            <ResultsByAxis
                testId={testId!}
                conditions={filterConditions}
                completed={summary.completedAttempts}
                onOpenPassages={openPassages}
                onCompare={(conditions, name) => compareInSlices(conditions, name)}
            />
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
        <QuestionsTab
            key={`questions-${questionsView}-${questionsSet ?? ""}`}
            initialView={questionsView}
            initialSet={questionsSet}
            questions={questionStats}
            testId={testId ?? undefined}
            passages={summary.completedAttempts}
            quality={itemQuality}
            qualityLoading={qualityLoading}
            heuristics={reviewHeuristics}
            excluded={excludedFromDelivery}
            onRestoreFirstAttempt={() => setAttempts("first")}
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
                // FR-17: переход в реестр к прохождениям, где на вопросе ошиблись. Условия
                // отбора живут в адресе реестра (FR-03), поэтому это обычная ссылка. Фильтр
                // страницы едет с ней: иначе реестр показал бы ошибки за всё время по всем
                // группам, а таблица вопросов — по отобранным.
                // Э3.1: во вкладку «Прохождения» ЭТОГО теста, а не в общий реестр. Условие и
                // вкладка уходят одним переходом: два шага по адресу перетёрли бы друг друга.
                // Состояние истории сохраняется — крошка «Аналитика» помнит, откуда пришли.
                navigate(testHref(testId!, { ...filter, wrongQuestionIds: [questionId] }, "passages"), {
                    state: typeof window === "undefined" ? undefined : window.history.state,
                });
            }}
            onOpenQuestion={(questionId, order) => {
                // PRD-66 FR-03: дискриминативность — вход в разбор задания, а не просто
                // число. Переход открывает КАРТОЧКУ на своей вкладке: возвращать автора к
                // списку, из которого он только что пришёл, значит заставить искать строку
                // второй раз.
                // Э2: адрес вопроса сам открывает вкладку «Качество вопросов».
                // Э3.3: порядок этой таблицы — для «Предыдущий / Следующий».
                setBreakdownId(questionId, order);
                setBreakdownVersion(undefined);
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
                                                                    <Text variant="body-s">{percent(level.avgCorrectPercent)}</Text>
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
            <ExposureProfile profiles={delivery?.exposure ?? []} />
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
                ...(showsAttemptChip ? [{ id: ATTEMPTS_CHIP, label: ATTEMPT_PICK_CHIP_LABEL[attempts] }] : []),
            ]}
            savedSets={testLevelFilters(savedFilters.filters).map(item => ({ id: item.id, name: item.name }))}
            {...savedSetState(testLevelFilters(savedFilters.filters).map(item => ({ ...item, conditions: withoutTests(conditionsOf(item)) })), appliedSetId, withoutTests(filter))}
            onApplySet={(id: string) => {
                const item = savedFilters.filters.find(f => f.id === id);
                if (!item) return;
                setAppliedSetId(id);
                setFilter(withoutTests(conditionsOf(item)));
            }}
            onSaveSet={(name: string) => {
                savedFilters.save(name, withoutTests(filter))
                    .then(item => setAppliedSetId(item.id))
                    .catch(error => toast({ tone: "error", title: "Фильтр не сохранён", description: errorText(error) }));
            }}
            onUpdateSet={(id: string) => {
                savedFilters.update(id, withoutTests(filter))
                    .catch(error => toast({ tone: "error", title: "Фильтр не обновлён", description: errorText(error) }));
            }}
            onDeleteSet={(id: string) => {
                if (appliedSetId === id) setAppliedSetId(null);
                savedFilters.remove(id)
                    .catch(error => toast({ tone: "error", title: "Фильтр не удалён", description: errorText(error) }));
            }}
            // Э3.2 (замечание владельца 2026-10-03): срез создаётся из фильтра теста. Отобранное
            // сравнивается со срезом без сохранения или сохраняется срезом этого теста; пока
            // условий нет, обе кнопки выключены, а не спрятаны — спрятанная не объясняет, почему.
            actions={(
                <>
                    <Button
                        variant="secondary"
                        size="s"
                        disabled={!hasFilterConditions}
                        onClick={() => compareInSlices(filterConditions, null)}
                    >
                        Сравнить со срезом
                    </Button>
                    <Button
                        variant="ghost"
                        size="s"
                        disabled={!hasFilterConditions}
                        onClick={() => setSaveSliceOpen(true)}
                    >
                        Сохранить как срез
                    </Button>
                </>
            )}
            filterButtonRef={filterButtonRef}
            filterOpen={filterOpen}
            onOpenFilter={() => setFilterOpen(value => !value)}
            onRemove={(id: string) => {
                const [kind, value] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
                if (id === ATTEMPTS_CHIP) {
                    setAttempts("all");
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
                } else if (kind === "wrongQuestion") {
                    // Э3.1: условие «Прохождения с ошибкой» теперь живёт и на уровне теста.
                    setFilter({ ...filter, wrongQuestionIds: (filter.wrongQuestionIds ?? []).filter(x => x !== value) });
                } else if (ORG_CONDITIONS.some(condition => condition.param === kind)) {
                    const { key } = ORG_CONDITIONS.find(condition => condition.param === kind)!;
                    setFilter({ ...filter, [key]: filter[key].filter(x => x !== value) });
                } else if (id === "period") {
                    setFilter({ ...filter, from: undefined, to: undefined });
                }
            }}
            // «Сбросить фильтры» снимает ВСЕ условия, и правило попыток тоже (замечание
            // владельца 2026-10-04: чип оставался после сброса). Умолчание при открытии
            // страницы — первая попытка (PRD-66 FR-51); вернуть условие можно в окне фильтра.
            onReset={() => { setFilter(EMPTY_FILTER); setAttempts("all"); }}
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

    /**
     * Крошка «Аналитика» (Э2): на общий уровень с тем фильтром, с которым с него ушли (адрес
     * возврата в состоянии истории), а пришли не с общего — с условиями этого уровня по тесту.
     */
    const generalCrumb = {
        label: "Аналитика",
        href: returnHrefOf(typeof window === "undefined" ? null : window.history.state)
            ?? generalHref(filterOutOfTest(filter, testId!), "attempts"),
    };
    const subtitle = (
        <>
            {`${summary.completedAttempts} ${pluralize(summary.completedAttempts, "завершённое прохождение", "завершённых прохождения", "завершённых прохождений")} · ${sourcesLabel(filter.sources)}`}
            {/* FR-52, эскиз wf-scales: почему у вкладки качества нет плиток и таблицы
                вопросов, говорит подзаголовок, а не отдельная карточка. Признак — тот же,
                что у таблицы вопросов (прохождения есть, оценённых нет), а не ответ
                вкладки качества: тот грузится только на ней, и шапка менялась бы при
                переключении вкладок. */}
            {summary.completedAttempts > 0 && summary.gradedAttempts === 0
                ? " · измерительный тест, эталона у вопросов нет"
                : ""}
        </>
    );

    // ── Уровень вопроса (Э2): своя шапка с крошками, разбор без вкладок теста ──────────────
    if (routeQuestionId) {
        // Порядок «Предыдущий / Следующий» — таблицы, из которой пришли; пришли по ссылке —
        // порядок таблицы «Качества вопросов» по умолчанию (эскиз).
        const order = questionState?.questionOrder ?? (itemQuality?.items ?? []).map(item => item.questionId);
        const at = order.indexOf(routeQuestionId);
        const previous = at > 0 ? order[at - 1] : null;
        const next = at >= 0 && at < order.length - 1 ? order[at + 1] : null;
        const goTo = (questionId: string) => navigate(questionHref(testId!, questionId, filter), {
            state: typeof window === "undefined" ? undefined : window.history.state,
        });
        // Э4б: вопросы живут на одной вкладке — крошка теста ведёт на неё.
        const sourceTab = "questions";
        const currentSince = breakdown?.versions?.find(row => row.psychoHash === breakdown.currentVersion)?.firstAt ?? null;
        // PRD-70 FR-51: редакции для выбора в шапке — текущая первой, прежние от новых к старым,
        // «версия неизвестна» последней (порядок прежней карточки «Версии содержания»).
        const breakdownVersions = [...(breakdown?.versions ?? [])].sort((a, b) => {
            const rank = (row: typeof a) => (row.psychoHash === null ? 2 : row.psychoHash === breakdown?.currentVersion ? 0 : 1);
            return rank(a) - rank(b) || (b.lastAt < a.lastAt ? -1 : b.lastAt > a.lastAt ? 1 : 0);
        });
        /**
         * Э4а: полный вид распределения ответов — по типу вопроса (эскиз approved/e4a). У выбора он
         * — таблица «Варианты ответа» разбора; здесь — остальные типы. Сжатые данные (разброс,
         * объём) — из строки таблицы вопросов, разрез по слабым и сильным — из разбора.
         */
        const questionRow = analytics.questionStats.find(row => row.questionId === routeQuestionId);
        const questionType = questionRow?.questionType ?? breakdown?.questionType ?? questionCard?.questionType ?? "";
        const measurementTest = analytics.summary.completedAttempts > 0 && analytics.summary.gradedAttempts === 0;
        const units = breakdown?.units ?? questionRow?.units ?? null;
        /**
         * Э4а: вопрос без оценки (развёрнутый ответ, вопрос опросника) — психометрики у него нет по
         * устройству. Движок всё равно отдаёт запись с нулём наблюдений, и плитки «мало данных ·
         * собрано 0» неправду говорили бы о том, что данных просто не хватает.
         */
        const notGraded = questionRow?.correctPercent === null;
        const answeredCaption = questionRow
            ? [questionRow.topicName, `${questionRow.totalAnswers} ${pluralize(questionRow.totalAnswers, "ответ", "ответа", "ответов")}`].join(" · ")
            : undefined;
        /**
         * Условия страницы для ответов задания — те же, что у разбора над ними (`psychometricsUrl`),
         * с режимом попыток, названным явно: без него ручка ответов отдаёт все попытки.
         */
        const answersSearch = psychometricsUrl("", { attempts });
        // Э5.2: окно выгрузки ответов называет условия страницы теми же словами, что полоса фильтра.
        const answersConditions = [
            ...describeConditions({ ...filter, testIds: [] }, { ...dictionaries, ...testDictionary })
                .map(condition => String(condition.label)),
            ...(attempts !== "all" ? [ATTEMPT_PICK_CHIP_LABEL[attempts]] : []),
        ];
        const distribution = (
            <>
                {units ? <UnitsCard units={units} /> : null}
                {!units && questionRow?.spread && ["short", "scale", "allocation"].includes(questionType) ? (
                    <SpreadCard
                        questionType={questionType}
                        spread={questionRow.spread}
                        testId={testId!}
                        questionId={routeQuestionId}
                        measurement={measurementTest}
                        search={answersSearch}
                        conditionLabels={answersConditions}
                    />
                ) : null}
                {questionType === "long" || questionType === "blanks" ? (
                    <QuestionAnswersCard
                        testId={testId!}
                        questionId={routeQuestionId}
                        questionType={questionType}
                        volume={questionRow?.volume}
                        search={answersSearch}
                        conditionLabels={answersConditions}
                    />
                ) : null}
            </>
        );
        // «Сценарий в ИС» (Э5б): сценарий называется своим названием, а не текстом задания.
        const simulation = questionType === "simulation";
        const scenarioTitle = questionCard?.scenario?.title ?? null;
        const questionLabel = simulation && scenarioTitle
            ? scenarioTitle
            : renderBlanksText(breakdown?.prompt ?? questionCard?.prompt ?? "Вопрос", { mode: "dash" });
        const testCrumb: TrailCrumb = {
            label: analytics.testTitle,
            // Э3.3: крошка теста возвращает на вкладку, с которой пришли.
            href: testHref(testId!, filter, sourceTab),
            state: typeof window === "undefined" ? undefined : window.history.state,
        };
        // Возврат (замечание владельца 2026-10-05): пришли сюда вглубь из другого места — крошки
        // ведут по пройденному пути (например, «Темы и вопросы → вопрос банка»), а не только вверх.
        const arrivedBy = trailOf(typeof window === "undefined" ? null : window.history.state);
        const pathCrumbs: TrailCrumb[] = arrivedBy ? [...arrivedBy, testCrumb] : [generalCrumb as TrailCrumb, testCrumb];
        /** Перейти на страницу вопроса банка, унося путь: её крошки вернут сюда. */
        const openBankQuestion = () => {
            const target = bankQuestionHref(routeQuestionId);
            navigate(target, {
                // Шаг называется ролью, а не текстом: текст вопроса стоит последней крошкой страницы банка.
                state: stateForDive(pathCrumbs, { label: "Вопрос в тесте", href: currentHref(), state: window.history.state }, target),
            });
        };
        return (
            <Stack gap={6}>
                <AnalyticsHeader
                    crumbs={[...pathCrumbs, { label: questionLabel }]}
                    title={simulation
                        ? <><QuestionTypeIcon type="simulation" size={20} />{" "}{questionLabel}</>
                        : breakdown?.item ? <BreakdownTitle view={breakdown} /> : renderBlanksText(questionCard?.prompt ?? "Вопрос", { mode: "dash" })}
                    subtitle={simulation && questionRow
                        ? [questionRow.topicName, "Сценарий", ...(simulationStats ? [`${simulationStats.runs} ${pluralize(simulationStats.runs, "прогон", "прогона", "прогонов")}`] : [])].join(" · ")
                        : notGraded ? answeredCaption : breakdown?.item ? breakdownSubtitle(breakdown) : answeredCaption}
                    actions={(
                        <>
                            {/* PRD-70 FR-51: выбор редакции — в шапке; версии содержания целиком — на
                                странице вопроса банка. */}
                            {breakdownVersions.length > 1 ? (
                                <Select
                                    size="s"
                                    aria-label="Редакция"
                                    value={versionKeyOf(breakdownVersion !== undefined ? breakdownVersion : breakdown?.selectedVersion)}
                                    onChange={key => setBreakdownVersion(key === "" ? null : key)}
                                    options={breakdownVersions.map(row => ({
                                        value: versionKeyOf(row.psychoHash),
                                        label: `Редакция: ${versionLabel(row, breakdown?.currentVersion, null).title}`,
                                    }))}
                                />
                            ) : null}
                            <Button
                                variant="secondary"
                                size="s"
                                leadingIcon={<ChevronLeft size={14} />}
                                disabled={!previous}
                                onClick={() => previous && goTo(previous)}
                            >
                                Предыдущий
                            </Button>
                            <Button
                                variant="secondary"
                                size="s"
                                trailingIcon={<ChevronRight size={14} />}
                                disabled={!next}
                                onClick={() => next && goTo(next)}
                            >
                                Следующий
                            </Button>
                            {/* Те же пункты, что в меню строки таблицы вопросов (эскиз). */}
                            <MenuTrigger
                              size="sm"
                                placement="bottom-end"
                                trigger={(
                                    <IconButton
                                        variant="ghost"
                                        size="s"
                                        aria-label="Действия с вопросом"
                                        icon={<MoreHorizontal size={16} />}
                                    />
                                )}
                            >
                                  <MenuItem onClick={() => navigate(questionInTopicHref(routeQuestionId))}>
                                      Открыть вопрос в теме
                                  </MenuItem>
                                  <MenuItem onClick={() => openPassages({ ...filterConditions, wrongQuestionIds: [routeQuestionId] })}>
                                      Прохождения с ошибкой
                                  </MenuItem>
                                  {questionCard?.excluded ? (
                                      <MenuItem onClick={() => void changeDelivery(routeQuestionId, false)
                                          .then(() => queryClient.invalidateQueries({ queryKey: [cardKey] }))}
                                      >
                                          Вернуть в выдачу
                                      </MenuItem>
                                  ) : (
                                      <MenuItem onClick={() => setExcludeTarget({
                                          questionId: routeQuestionId,
                                          prompt: questionCard?.prompt ?? breakdown?.prompt ?? "",
                                          caption: questionCard?.topicName ?? "",
                                      })}
                                      >
                                          Исключить из выдачи…
                                      </MenuItem>
                                  )}
                            </MenuTrigger>
                        </>
                    )}
                />
                {questionCard?.questionId ? (
                    <QuestionInTestCard
                        card={questionCard}
                        currentSince={currentSince}
                        measurement={measurementTest || questionType === "scale" || questionType === "allocation"}
                        onOpenInTopic={() => navigate(questionInTopicHref(routeQuestionId))}
                    />
                ) : null}
                {simulation
                    ? (
                        // «Сценарий в ИС» (Э5б, эскиз sim-scenario-analytics.html): вместо разбора
                        // вариантов — плитки, исходы, сцены, ошибки и карта промахов.
                        <SimulationAnalytics
                            testId={testId!}
                            questionId={routeQuestionId}
                            search={answersSearch}
                            itemRest={breakdown?.item?.itemRest ?? null}
                            observations={breakdown?.item?.observations ?? 0}
                        />
                    )
                    : notGraded
                    ? (
                        <Stack gap={4}>
                            {questionType === "long" && questionRow ? (
                                <NotGradedTiles
                                    declared={questionRow.difficulty}
                                    // Время разбора — по ответам ЭТОГО вопроса в выборке; у строки
                                    // таблицы его может не быть, когда не сработал сбор экспозиции.
                                    latencyMedianMs={breakdown?.item?.timing?.medianMs ?? questionRow.latencyMedianMs}
                                    latencySampleSize={breakdown?.item?.timing?.measured ?? questionRow.latencySampleSize}
                                />
                            ) : null}
                            {distribution}
                        </Stack>
                    )
                    : breakdown?.item
                    ? (
                        <ItemBreakdownPanel
                            view={breakdown}
                            minObservations={analytics.minObservations}
                            distribution={distribution}
                        />
                    )
                    : breakdownFetched
                        // Э4а: разбора нет (ни одного ответа в выборке) — страница показывает то, что
                        // известно, вместо вечного «Считаем психометрику».
                        ? <Stack gap={4}>{distribution}</Stack>
                        : <LoadingState message="Считаем психометрику..." />}
                {/* PRD-70 FR-50: вопрос по другим тестам и его редакции — на странице вопроса банка. */}
                {questionCard?.questionId ? (
                    <Card variant="outlined">
                        <CardHeader
                            title="Вопрос в банке"
                            subtitle={bankCardSubtitle(questionCard.otherTests?.length ?? 0, questionCard.windowMonths, breakdownVersions.length)}
                            trail={(
                                <Button
                                    variant="secondary"
                                    size="s"
                                    leadingIcon={<BarChart3 size={14} aria-hidden="true" />}
                                    onClick={openBankQuestion}
                                >
                                    Статистика вопроса банка
                                </Button>
                            )}
                        />
                    </Card>
                ) : null}
                <DeliveryExclusionDialog
                    target={excludeTarget}
                    testId={testId ?? undefined}
                    onClose={() => setExcludeTarget(null)}
                    onConfirm={questionId => {
                        setExcludeTarget(null);
                        void changeDelivery(questionId, true)
                            .then(() => queryClient.invalidateQueries({ queryKey: [cardKey] }));
                    }}
                />
            </Stack>
        );
    }

    return (
        <Stack gap={6}>
            {/* Шапка уровня теста (Э2, эскиз e2-analytics-levels): крошки «Аналитика › тест» вместо
                «Все тесты», под названием — объём и источники. Справа — экспорт и «Обновить»;
                прохождения теста — вкладка (Э3.1), а не переход в общий реестр. */}
            <AnalyticsHeader
                crumbs={[generalCrumb, { label: analytics.testTitle }]}
                title={analytics.testTitle}
                subtitle={subtitle}
                actions={(
                    <>
                        <Button onClick={() => setExportOpen(true)} variant="secondary" size="s" leadingIcon={<FileSpreadsheet size={16} />}>
                            Экспорт Excel
                        </Button>
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
                    </>
                )}
            />

            <RegistryFilterPanel
                open={filterOpen}
                anchorRef={filterButtonRef}
                filter={filter}
                hideTest
                scopeTestId={testId ?? null}
                // FR-51: условие психометрики — там, где его чип: на вкладке «Вопросы».
                // «Только лучшая» у измерительного теста недоступна: общего балла нет, сравнивать
                // попытки не по чему.
                attempts={activeTab === "questions"
                    ? {
                        value: attempts,
                        onApply: setAttempts,
                        bestUnavailable: summary.completedAttempts > 0 && summary.gradedAttempts === 0,
                    }
                    : undefined}
                onApply={setFilter}
                onClose={() => setFilterOpen(false)}
            />

            {/* Tabs */}
            <Tabs
                value={activeTab}
                onChange={setActiveTab}
                items={[
                    { id: "overview", label: "Обзор", content: underFilter(overviewPanel) },
                    {
                        // Э3.1, PRD-56 FR-23: прохождения теста — тот же реестр, что на общем уровне
                        // (один список на продукт), только тест задан страницей.
                        id: "passages",
                        label: "Прохождения",
                        content: underFilter(
                            <PassageRegistry
                                testId={testId!}
                                filter={filter}
                                onFilterChange={setFilter}
                                onOpenPassage={(row: RegistryRow) => setOpenedAttempt(attemptOfRegistryRow(row))}
                            />,
                        ),
                    },
                    { id: "questions", label: "Вопросы", content: underFilter(questionsPanel) },
                    {
                        // Э3.2: сохранённые срезы теста и их сравнение. Фильтра уровня теста над
                        // вкладкой нет: у каждого среза свои условия, рамка — только период.
                        id: "slices",
                        label: "Срезы",
                        content: (
                            <TestSlicesTab
                                // Присланный отбор пересоздаёт вкладку: она открывается в сравнении.
                                key={compareAdhoc ? JSON.stringify(compareAdhoc) : "slices"}
                                testId={testId!}
                                adhoc={compareAdhoc?.conditions ?? null}
                                adhocName={compareAdhoc?.name ?? null}
                                attempts={attempts}
                                // FR-07k: тот же признак, что у подзаголовка «измерительный тест».
                                measurement={summary.completedAttempts > 0 && summary.gradedAttempts === 0}
                                onOpenPassages={openPassages}
                            />
                        ),
                    },
                    // PRD-56: «Уровни» отдельной вкладкой больше нет — они внутри «Выдачи».
                    { id: "delivery", label: "Выдача", content: underFilter(deliveryPanel) },
                    // Вкладка есть только у теста со шкалами или показателями (FR-21c):
                    // оцениваемому тесту без них она сказать ничего не может, а пустая вкладка
                    // читается как поломка. Id прежний — `scales`: сохранённые ссылки не ломаются.
                    // Порядок блоков — как в деталях попытки: показатели, затем шкалы.
                    ...(analytics.hasScales || analytics.hasIndicators
                        ? [{
                            id: "scales",
                            label: "Шкалы и показатели",
                            content: underFilter(
                                <Stack gap={4}>
                                    {analytics.hasIndicators && (
                                        <IndicatorProfilePanel
                                            indicators={scaleProfile?.indicators ?? []}
                                            observations={scaleProfile?.observations ?? 0}
                                        />
                                    )}
                                    {analytics.hasScales && (
                                        <>
                                            <ScaleProfilePanel
                                                scales={scaleProfile?.scales ?? []}
                                                observations={scaleProfile?.observations ?? 0}
                                            />
                                            {/* Э4б: качество шкал — здесь, при самих шкалах: вкладки «Качество
                                                вопросов», где оно стояло, больше нет. */}
                                            {scaleQuality
                                                ? <ScaleQualityPanel scales={scaleQuality.scales} />
                                                : <LoadingState message="Считаем качество шкал..." />}
                                        </>
                                    )}
                                </Stack>
                            ),
                        }]
                        : []),
                ]}
            />

            <TestExportDialog
                open={exportOpen}
                onClose={() => setExportOpen(false)}
                testId={testId!}
                testTitle={analytics.testTitle}
                filter={{ ...filter, testIds: [] }}
                conditionLabels={describeConditions({ ...filter, testIds: [] }, { ...dictionaries, ...testDictionary })
                    .map(condition => String(condition.label))}
                psychometricsUrl={psychometricsUrl}
            />

            <SaveSliceDialog
                open={saveSliceOpen}
                onClose={() => setSaveSliceOpen(false)}
                testId={testId!}
                conditions={filterConditions}
                labels={describeConditions({ ...filter, testIds: [] }, { ...dictionaries, ...testDictionary })}
                total={summary.completedAttempts}
                // Новый срез — на вкладке «Срезы»: её списки перечитываются.
                onSaved={() => void queryClient.invalidateQueries({
                    predicate: query => String(query.queryKey[0] ?? "").startsWith("/api/analytics/slices"),
                })}
            />
            <AttemptDetailsDialog
                attempt={openedAttempt}
                open={openedAttempt !== null}
                onClose={() => setOpenedAttempt(null)}
                onExport={exportAttemptWorkbook}
            />
        </Stack>
    );
}

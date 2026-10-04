/**
 * @module features/analytics/test/question-table
 * @description PRD-56 FR-15, FR-16, FR-17, FR-22: таблица заданий теста.
 *
 * Одна строка отвечает на вопрос «что с этим заданием»: доля верных, пропуски, экспозиция,
 * время и авторская трудность рядом. Тип задания — пиктограммой, той же, что в дереве контента
 * и в таблице «Оценка» редактора: словом он занимал бы колонку, ничего к ней не добавляя.
 *
 * Вид «требуют ревизии» — отбор по СОШЕДШИМСЯ признакам, и каждый назван словами прямо в
 * строке: вид без объяснения читается как приговор заданию, а решение принимает автор.
 *
 * У измерительного задания доли верных нет вовсе (FR-22): эталона у него не существует, и ноль
 * в этой колонке был бы про него ложью — поэтому прочерк.
 */
import { useMemo, useState } from "react";

import { Ban } from "lucide-react";
import { useLocation } from "wouter";

import {
  Banner, Button, Card, CardBody, CardHeader, DataGrid, SegmentedControl, Stack, Tag, Text,
} from "@skillum/ui-kit";

import type { QuestionType } from "@shared/questions/question-type";
import { questionInTopicHref } from "@/features/content/question-link";
import { QuestionTypeIcon } from "@/features/tests/editor/sections/question-type-icon";
import { pluralize } from "@/lib/i18n";

import { percent } from "../format";
import { DeliveryExclusionDialog, type ExclusionTarget } from "./delivery-exclusion-dialog";
import { CompactDistribution, compactModel, type UnitsView } from "./answer-distribution";
import { NoValue } from "./no-value";
import { COEFFICIENT_MIN, num } from "./psychometrics-format";
import { QuestionRowMenu } from "./question-row-menu";
import { TermHint } from "./term-hint";

/**
 * Толкования терминов в заголовках колонок (FR-14b) — дословно из эскиза prd66-item-quality,
 * состояние wf-items. Трудность и дискриминативность толкуются теми же словами, что на вкладке
 * «Качество вопросов» (`psychometrics-format`): одна величина на двух экранах не объясняется
 * двумя способами.
 */
/** Признак ревизии — то, что отдаёт `GET /api/analytics/tests/:testId`. */
export interface ReviewFlagView {
  kind: string;
  reason: string;
}

/** Строка таблицы заданий. */
export interface QuestionRow {
  questionId: string;
  questionPrompt: string;
  questionType: string;
  topicName: string;
  /** Сложность, заданная автором; `null` — не задана (Э4а). */
  difficulty: number | null;
  totalAnswers: number;
  gradedAnswers: number;
  correctAnswers: number;
  /** `null` — оценивать было нечего (измерительное задание). */
  correctPercent: number | null;
  /** Доля пропусков; `null` — состав выдачи неизвестен (прохождения только из LMS). */
  skipShare: number | null;
  exposurePercent: number | null;
  /** В скольких ДРУГИХ тестах задание выдавалось за окно экспозиции (PRD-55 FR-32). */
  otherTestsCount?: number;
  /** Цена задания в этом тесте; `null` — измерительное задание, баллов не приносит. */
  points?: number | null;
  latencyMedianMs: number | null;
  latencySampleSize: number;
  reviewFlags: ReviewFlagView[];
  /** PRD-56 FR-17a: задание исключено из выдачи ЭТОГО теста. */
  excludedFromDelivery?: boolean;
  /**
   * PRD-56 FR-22: разброс ответов измерительного задания — то, чем у него заменена доля
   * верных. `null` — задание оценивается либо разбрасывать нечего.
   */
  spread?: { options: Array<{ label: string; share: number; correct?: boolean }>; answered: number } | null;
  /**
   * PRD-57 FR-32: сводка свободного текста — сколько написали и как длинно. Частотная
   * таблица развёрнутому ответу не годится: двух одинаковых ответов не бывает.
   */
  volume?: { answered: number; medianLength: number; minLength: number; maxLength: number } | null;
  /** Э4а: разбор сопоставления, ранжирования и пропусков по единицам. */
  units?: UnitsView | null;
}

export interface QuestionTableProps {
  questions: QuestionRow[];
  /** Э3.4: вид, с которым таблица открывается, — блок «Требует внимания» ведёт в нужный. */
  initialView?: QuestionsView;
  /**
   * Тест измерительный: вместо доли верных таблица показывает разброс ответов (FR-22).
   *
   * Признак приходит сверху, а не выводится из строк: таблица, где доля верных пуста у всех
   * заданий, бывает и у оцениваемого теста, по которому ещё никто не проходил, а набор
   * колонок от количества прохождений зависеть не должен.
   */
  measurement?: boolean;
  /** Порог наблюдений: ниже него разброс не печатается, потому что он шум (FR-06d). */
  minObservations?: number;
  /** Уйти в реестр к прохождениям, где на этом задании ошиблись (FR-17). */
  onOpenRegistry?: (questionId: string) => void;
  /** Переключить состояние «исключён из выдачи» (FR-17a). Без него действие не предлагается. */
  onDeliveryChange?: (questionId: string, excluded: boolean) => void;
  /** Тест, у которого спрашиваются последствия исключения. */
  testId?: string;
  /** Завершённых прохождений — объём, по которому считана таблица (эскиз: подзаголовок). */
  passages?: number;
  /**
   * PRD-66 FR-02, FR-03: трудность и дискриминативность задания, посчитанные движком
   * психометрики.
   *
   * Приходят сверху отдельным запросом, а не считаются здесь: то же число показывает вкладка
   * «Качество вопросов», и второй расчёт развёл бы их при первой же правке движка. Отсутствие
   * записи — «ещё не посчитано», и это прочерк, а не ноль.
   */
  psychometrics?: Record<string, QuestionPsychometrics>;
  /**
   * Э4б: признак «что не так» по вопросу — то же правило, что колонка набора «Психометрика»
   * (`shared/psychometrics/question-flag`). Задан — под текстом вопроса стоит он, а не одни
   * эвристики ревизии: вопрос в виде «Под подозрением» обязан сказать, почему он там.
   */
  flags?: Record<string, { tone: "error" | "warning" | "info"; title: string; detail: string } | null>;
  /**
   * Открыть разбор задания — уровень вопроса (FR-03, Э3.3). `order` — вопросы в порядке таблицы,
   * как она отсортирована сейчас: по нему ходят «Предыдущий / Следующий».
   */
  onOpenQuality?: (questionId: string, order: string[]) => void;
  /**
   * Э4б: набор колонок одной таблицы вопросов (эскиз approved/e4b-questions-table.html).
   * `full` — прежний состав всех колонок (по умолчанию).
   */
  columnSet?: QuestionColumnSet;
  /**
   * Э4б: только таблица и подпись под ней — без пояснения, карточки и переключателя видов: их
   * рисует контейнер вкладки «Вопросы», общий для всех наборов колонок.
   */
  bare?: boolean;
}

/** Набор колонок таблицы вопросов (Э4б). */
export type QuestionColumnSet = "full" | "main" | "delivery";

/**
 * Колонки наборов и их доли (эскиз approved/e4b-questions-table.html). Колонок в наборе меньше,
 * чем было в общей таблице, поэтому «Вопрос» широкий и длинный текст не идёт столбцом.
 */
const SET_WIDTHS: Record<"main" | "delivery", { graded: Record<string, string>; measurement: Record<string, string> }> = {
  main: {
    graded: { question: "26%", spread: "23%", difficulty: "9%", itemRest: "10%", declared: "12%", latency: "9%", points: "7%", rowActions: "4%" },
    measurement: { question: "36%", spread: "40%", answers: "10%", latency: "10%", rowActions: "4%" },
  },
  delivery: {
    graded: { question: "43%", skip: "12%", exposure: "14%", otherTests: "12%", latency: "13%", rowActions: "6%" },
    measurement: { question: "44%", skip: "16%", answers: "18%", latency: "16%", rowActions: "6%" },
  },
};

/** Психометрика одного задания — ровно то, что нужно строке таблицы. */
export interface QuestionPsychometrics {
  /** Доля набранного балла: 0 — не решил никто, 1 — решили все. */
  difficulty: number | null;
  /** Корреляция задание-остаток; `null` — считать не на чем. */
  itemRest: number | null;
  observations: number;
  /**
   * `insufficient` — наблюдений меньше порога трудности (`analytics.minObservations`). Число
   * движок всё равно отдаёт, но на шести ответах оно случайно, и таблица его не печатает (Э4а).
   */
  difficultyConfidence?: "insufficient" | "tentative" | "reliable";
  /** `insufficient` — наблюдений меньше порога коэффициентов (FR-38a). */
  coefficientConfidence: "insufficient" | "tentative" | "reliable";
}

/** Вид таблицы «Вопросы». */
export type QuestionsView = "all" | "review" | "excluded";
type View = QuestionsView;
type SortDir = "asc" | "desc";

/** Где браузер помнит, что пояснение о смене числа уже прочитано (FR-02). */
const DIFFICULTY_NOTICE_KEY = "tb.analytics.difficulty-notice-hidden";

/** Время на задание: минуты и секунды, как их читают. */
function duration(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Значение для сортировки: отсутствующее всегда уезжает в конец. */
function sortValue(row: QuestionRow, key: string, psycho?: QuestionPsychometrics): number {
  const byKey: Record<string, number | null> = {
    difficulty: psycho?.difficulty ?? null,
    itemRest: psycho?.itemRest ?? null,
    skip: row.skipShare,
    exposure: row.exposurePercent,
    otherTests: row.otherTestsCount ?? null,
    points: row.points ?? null,
    latency: row.latencyMedianMs,
    declared: row.difficulty,
  };
  const value = key in byKey ? byKey[key] : row.totalAnswers;
  return value ?? Number.POSITIVE_INFINITY;
}

/** Э4а: расхождение больше стольких пунктов — вопрос оказался легче или труднее заданного. */
const INTENT_GAP = 10;

/**
 * «Сложность: задана → по ответам» — решение владельца 2026-10-04, вариант Б эскиза.
 *
 * Обе величины в шкале редактора (0 — легко, 100 — сложно): заданная автором и полученная по
 * ответам, `(1 − трудность) × 100`. Незаданная — «не задана», а не подставленная 50: та была
 * неотличима от заданной 50, и расхождение с ней ничего не значило. Нет наблюдаемой —
 * заданная и под ней, почему по ответам числа нет.
 */
function IntentCell({ declared, hardness, missing }: {
  declared: number | null;
  /** Наблюдаемая сложность 0-100; `null` — её нет, и `missing` говорит почему. */
  hardness: number | null;
  missing: "notApplicable" | "insufficient";
}) {
  const declaredText = declared === null
    ? <Text as="span" variant="body-s" tone="muted">не задана</Text>
    : <Text as="span" variant="body-s">{declared}</Text>;
  if (hardness === null) {
    return (
      <Stack gap={1} align="center">
        {declaredText}
        <Text variant="body-xs" tone="muted">
          {missing === "notApplicable" ? "по ответам — не применимо" : "по ответам — мало данных"}
        </Text>
      </Stack>
    );
  }
  const gap = declared === null ? null : hardness - declared;
  return (
    <Stack gap={1} align="center">
      <Text as="span" variant="body-s">{declaredText} → {hardness}</Text>
      {gap === null ? (
        <Text variant="body-xs" tone="muted">расхождение не считается</Text>
      ) : Math.abs(gap) <= INTENT_GAP ? (
        <Text variant="body-xs" tone="muted">расхождения нет</Text>
      ) : (
        <Tag tone="warning" size="s">{gap > 0 ? `труднее заданной на ${gap}` : `легче заданной на ${-gap}`}</Tag>
      )}
    </Stack>
  );
}

/** Почему у вопроса нет трудности: оценивать нечего (развёрнутый ответ, опросник). */
function notGradedReason(row: QuestionRow): string | undefined {
  return row.questionType === "long"
    ? undefined
    : "У вопроса нет верного ответа, поэтому трудность и дискриминативность не считаются.";
}

export function QuestionTable({
  questions, onOpenRegistry, onDeliveryChange, testId, measurement, minObservations = 10,
  psychometrics, onOpenQuality, passages, initialView = "all", columnSet = "full", bare = false, flags,
}: QuestionTableProps) {
  const [view, setView] = useState<View>(initialView);
  const [sortKey, setSortKey] = useState(measurement ? "answers" : "difficulty");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  /** Вопрос, для которого открыто окно подтверждения исключения. */
  const [pending, setPending] = useState<ExclusionTarget | null>(null);
  const [, navigate] = useLocation();
  /**
   * Закрыто ли разовое пояснение о смене числа в колонке (FR-02).
   *
   * Отказ живёт в браузере читателя, а не в его учётной записи: это заметка «я прочитал»,
   * а не настройка продукта, и синхронизировать её между устройствами незачем. Хранилище
   * бывает недоступно (приватное окно, запрет на данные сайта), поэтому отказ читается и
   * пишется под try/catch, а недоступность значит «показать»: пояснение важнее тишины.
   */
  const [noticeHidden, setNoticeHidden] = useState(() => {
    try {
      return window.localStorage.getItem(DIFFICULTY_NOTICE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const hideNotice = () => {
    setNoticeHidden(true);
    try {
      window.localStorage.setItem(DIFFICULTY_NOTICE_KEY, "1");
    } catch {
      // Не сохранилось — пояснение вернётся в следующий раз. Это мелкое неудобство, а
      // падение экрана аналитики из-за заметки «я прочитал» — нет.
    }
  };

  const flagged = useMemo(
    () => questions.filter(question => question.reviewFlags.length > 0),
    [questions],
  );
  const excludedRows = useMemo(
    () => questions.filter(question => question.excludedFromDelivery),
    [questions],
  );
  /**
   * Фиксированная раскладка с долями колонок эскиза (approved/e4a-answer-distribution.html): при
   * `table-layout: auto` доли — лишь пожелание, и заголовки-термины со значком подсказки
   * распирали таблицу до горизонтальной прокрутки. Э4а: колонка распределения есть у любого теста,
   * и раскладка одна на все составы — у опросника свои доли.
   */
  const share = (width: string) => ({ width });

  const rows = useMemo(() => {
    const shown = view === "review" ? flagged : view === "excluded" ? excludedRows : questions;
    return [...shown].sort((a, b) => {
      const diff = sortValue(a, sortKey, psychometrics?.[a.questionId])
        - sortValue(b, sortKey, psychometrics?.[b.questionId]);
      return sortDir === "asc" ? diff : -diff;
    });
  }, [questions, flagged, excludedRows, view, sortKey, sortDir, psychometrics]);

  const columns = [
    {
      key: "question",
      // Вкладка «Вопросы» говорит «вопрос», как в эскизе и как в теме, откуда вопрос пришёл;
      // «задание» — термин психометрики и живёт на вкладке «Качество вопросов» (PRD-66).
      header: "Вопрос",
      frozen: true,
      // У опросника колонка ограничена: рядом с ней стоит разброс ответов, и текст вопроса,
      // растянувший её по себе, вытолкнул бы за край экрана всё, что правее.
      ...share(measurement ? "33%" : "15%"),
      render: (row: QuestionRow) => (
        // Текст задания переносится, иначе строка вопроса распирает столбец по себе: ячейки
        // стола по умолчанию не переносятся, и это верно для чисел, но не для предложения.
        // `tb-psy-question` держит НИЖНИЙ предел ширины: с приходом колонки
        // «Дискриминативность» условие сжималось в столбик по три слова (PRD-66, приёмка).
        <Stack gap={1} className="ou-grid__cell-wrap">
          {/* Э4а: значок типа — в строке текста, и текст его обтекает: рядом отдельным столбцом
              он сжимал вопрос в узкую полосу по два слова. */}
          <span className="ou-grid__cell-strong">
            <QuestionTypeIcon type={row.questionType as QuestionType} />
            {/*
              FR-17a: состояние выдачи метится перечёркнутым кругом с подсказкой, а НЕ тегом:
              тег стоит в одном ряду с темой и подтемой и читается как ярлык содержания, а
              речь идёт о состоянии выдачи.
            */}
            {row.excludedFromDelivery && (
              <span
                className="tb-qscoring__qtype"
                title="Исключён из выдачи — в новые прохождения не попадает"
                aria-label="Исключён из выдачи"
              >
                <Ban size={16} color="var(--ou-error-default)" aria-hidden="true" />
              </span>
            )}
            {row.questionPrompt}
          </span>
          <Text variant="body-xs" tone="muted">{row.topicName}</Text>
          {/* Признак назван прямо в строке: отбор без объяснения — это приговор без основания. */}
          {flags ? (
            flags[row.questionId] && flags[row.questionId]!.tone !== "info" ? (
              <Text variant="body-xs" tone={flags[row.questionId]!.tone === "error" ? "error" : "warning"}>
                {`${flags[row.questionId]!.title}: ${flags[row.questionId]!.detail}`}
              </Text>
            ) : null
          ) : row.reviewFlags.map(flag => (
            <Text key={flag.kind} variant="body-xs" tone="warning">{flag.reason}</Text>
          ))}
        </Stack>
      ),
    },
    // FR-22, Э4а: распределение ответов — у ЛЮБОГО теста и любого типа вопроса, одной разметкой
    // (`CompactDistribution`). У опросника цвет оценки не несёт, у оцениваемого верное — зелёным.
    // Развёрнутый ответ — сводка объёма; сами ответы читаются на странице вопроса.
    {
      key: "spread",
      header: <TermHint entry={measurement ? "spreadMeasure" : "spread"} />,
      ...share(measurement ? "35%" : "16%"),
      render: (row: QuestionRow) => {
        if (row.totalAnswers < minObservations) {
          return <NoValue kind="insufficient" need={minObservations} have={row.totalAnswers} align="start" />;
        }
        const model = compactModel(row, measurement);
        // Ответы есть, а распределения сервер не посчитал (например, ответы в незнакомом виде):
        // «мало данных» при сотне ответов было бы неправдой.
        return model
          ? <CompactDistribution model={model} />
          : <NoValue kind="notApplicable" reason="Распределение ответов для этого вопроса не посчитано." />;
      },
    },
    ...(measurement ? [{
      key: "answers",
      ...share("9%"),
      header: <TermHint entry="answers" />,
      align: "center" as const,
      numeric: true,
      sortable: true,
      render: (row: QuestionRow) => row.totalAnswers,
    }] : [
      // PRD-66 FR-02: место доли верных заняла трудность. Доля верных схлопывала верность к
      // «ровно максимум» и у задания с частичным кредитом была просто неверна; держать обе
      // колонки значило бы закрепить неверное число рядом с верным.
      {
        key: "difficulty",
        ...share("8%"),
        header: <TermHint entry="difficulty" />,
        numeric: true,
        align: "center" as const,
        sortable: true,
        render: (row: QuestionRow) => {
          const psycho = psychometrics?.[row.questionId];
          if (row.correctPercent === null) return <NoValue kind="notApplicable" reason={notGradedReason(row)} />;
          if (!psycho || psycho.difficulty === null || psycho.difficultyConfidence === "insufficient") {
            return <NoValue kind="insufficient" need={minObservations} have={psycho?.observations ?? row.totalAnswers} />;
          }
          return num(psycho.difficulty);
        },
      },
      // FR-03: главное психометрическое число обязано быть видно там, где автор работает, —
      // иначе новая вкладка становится складом, куда никто не заходит.
      {
        key: "itemRest",
        ...share("9%"),
        // Мягкий перенос: в колонке 9 % термин не помещается одной строкой (эскиз Э4а).
        header: <TermHint entry="itemRest" term={"Дискрими\u00adнативность"} />,
        numeric: true,
        align: "center" as const,
        sortable: true,
        render: (row: QuestionRow) => {
          const psycho = psychometrics?.[row.questionId];
          // FR-38a: у коэффициента свой порог, и он ВЫШЕ порога трудности. Строка, где
          // трудность есть, а дискриминативности нет, — это не сбой, и сказать об этом надо
          // словами: прочерк читался бы как «ноль» или «сломалось».
          if (row.correctPercent === null) return <NoValue kind="notApplicable" reason={notGradedReason(row)} />;
          if (!psycho || psycho.itemRest === null || psycho.coefficientConfidence === "insufficient") {
            return <NoValue kind="insufficient" need={COEFFICIENT_MIN} have={psycho?.observations ?? row.totalAnswers} />;
          }
          if (!onOpenQuality) return num(psycho.itemRest);
          return (
            <Button
              variant="ghost"
              size="s"
              aria-label={`Разбор вопроса: ${row.questionPrompt}`}
              onClick={() => onOpenQuality(row.questionId, rows.map(item => item.questionId))}
            >
              {num(psycho.itemRest)}
            </Button>
          );
        },
      },
    ]),
    {
      key: "skip",
      ...share(measurement ? "9%" : "8%"),
      header: <TermHint entry="skip" />,
      numeric: true,
      align: "center" as const,
      sortable: true,
      render: (row: QuestionRow) => (row.skipShare === null
        ? <NoValue kind="notApplicable" reason="Пропуски считаются по веб-прохождениям, а их в выборке нет: состав выданной формы пакет SCORM не сообщает." />
        : percent(row.skipShare)),
    },
    // Экспозиция — свойство ВЫДАЧИ, и у опросника она есть, но эскиз её в этой таблице не
    // держит: строка опросника отвечает на «что выбирали», а как часто задание показывали —
    // вопрос вкладки «Выдача», где профиль банка и стоит (FR-20).
    ...(measurement ? [] : [{
      key: "exposure",
      ...share("9%"),
      // «Экспозиция» — как в эскизе и в пояснении под таблицей: то же слово, что у профиля
      // банка на вкладке «Выдача» (PRD-55).
      header: <TermHint entry="exposure" />,
      numeric: true,
      align: "center" as const,
      sortable: true,
      render: (row: QuestionRow) => (row.exposurePercent === null
        ? <NoValue kind="notApplicable" reason="Попыток теста за окно наблюдения нет — сравнивать не с чем." />
        : percent(row.exposurePercent)),
    }, {
      // Колонка «Количество тестов» отчёта WebTutor. Считается по ВЫДАЧАМ, а не по составу
      // тестов: задание в теме чужого теста, которое там ни разу не выпало, участники не
      // видели, и для износа задания оно не в счёт (PRD-55 FR-32).
      key: "otherTests",
      ...share("6%"),
      header: <TermHint entry="otherTests" />,
      numeric: true,
      align: "center" as const,
      sortable: true,
      render: (row: QuestionRow) => (row.otherTestsCount === null || row.otherTestsCount === undefined
        ? <NoValue kind="notApplicable" reason="Выдачу в других тестах посчитать не удалось." />
        : row.otherTestsCount),
    }]),
    {
      key: "latency",
      ...share(measurement ? "9%" : "8%"),
      header: <TermHint entry="latency" />,
      numeric: true,
      align: "center" as const,
      sortable: true,
      // Время не измерялось — пакеты до 2026-09-12 его не сообщают (PRD-55): это не ноль.
      render: (row: QuestionRow) => (row.latencyMedianMs === null
        ? <NoValue kind="notApplicable" reason="Время на вопрос не измерялось: пакеты SCORM до 12.09.2026 его не сообщают." />
        : duration(row.latencyMedianMs)),
    },
    // Авторская трудность у опросника бессмысленна: трудным бывает задание с верным ответом,
    // а здесь верного ответа нет вовсе.
    //
    // Э4а: «Сложность: задана → по ответам» (решение владельца 2026-10-04) вместо «Замысла»:
    // заданная автором и полученная по ответам — рядом, в одной шкале, с выводом о расхождении.
    ...(measurement ? [] : [{
      key: "declared",
      ...share("10%"),
      header: <TermHint entry="intent" />,
      numeric: true,
      align: "center" as const,
      sortable: true,
      render: (row: QuestionRow) => {
        const psycho = psychometrics?.[row.questionId];
        const p = row.correctPercent === null || psycho?.difficultyConfidence === "insufficient"
          ? null
          : psycho?.difficulty ?? null;
        return (
          <IntentCell
            declared={row.difficulty}
            hardness={p === null ? null : Math.round((1 - p) * 100)}
            missing={row.correctPercent === null ? "notApplicable" : "insufficient"}
          />
        );
      },
    }, {
      // Колонка «Вес» отчёта WebTutor. Цена та же, что у движка оценивания: иначе таблица
      // называла бы одну цену, а результат участника считался бы по другой.
      key: "points",
      ...share("7%"),
      header: <TermHint entry="points" />,
      numeric: true,
      align: "center" as const,
      sortable: true,
      render: (row: QuestionRow) => (row.points === null || row.points === undefined
        ? <NoValue kind="notApplicable" reason="Вопрос не оценивается: баллов он не приносит." />
        : row.points.toLocaleString("ru-RU")),
    }]),
    // Действия строки — ПОД ТРОЕТОЧИЕМ, как в эскизе (prd66-item-quality, состояние
    // wf-items). Двумя текстовыми кнопками они занимали 263 px — пятую часть таблицы, — и
    // с приходом колонки «Дискриминативность» правая уезжала за горизонтальную прокрутку
    // (вскрыто приёмкой в браузере). Порядок пунктов — как в эскизе prd56-test-analytics:
    // сначала куда перейти, потом что сделать с выдачей.
    {
      key: "rowActions",
      ...share(measurement ? "5%" : "4%"),
      header: "",
      render: (row: QuestionRow) => (
        <QuestionRowMenu
          prompt={row.questionPrompt}
          onOpenQuality={onOpenQuality ? () => onOpenQuality(row.questionId, rows.map(item => item.questionId)) : undefined}
          onOpenInTopic={() => navigate(questionInTopicHref(row.questionId))}
          onOpenRegistry={onOpenRegistry && row.correctPercent !== null
            ? () => onOpenRegistry(row.questionId)
            : undefined}
          excluded={row.excludedFromDelivery}
          onExclude={onDeliveryChange
            ? () => setPending({
              questionId: row.questionId,
              prompt: row.questionPrompt,
              // Эскиз: «тема · N % показов при M % верных» — почему вопрос и стоит исключать.
              caption: [
                row.topicName,
                row.exposurePercent !== null && row.correctPercent !== null
                  ? `${percent(row.exposurePercent)} показов при ${percent(row.correctPercent)} верных`
                  : "",
              ].filter(Boolean).join(" · "),
            })
            : undefined}
          onRestore={onDeliveryChange ? () => onDeliveryChange(row.questionId, false) : undefined}
        />
      ),
    },
  ];
  // Э4б: набор колонок — подмножество общего состава со своими долями.
  const widths = columnSet === "full" ? null : SET_WIDTHS[columnSet][measurement ? "measurement" : "graded"];
  const shownColumns = widths
    ? columns.filter(column => column.key in widths).map(column => ({ ...column, width: widths[column.key] }))
    : columns;

  const grid = (
    <DataGrid
      className="tb-psy-grid tb-qtable"
      // Таблица — главное на вкладке: во всю высоту окна, а не в окошке 540 px, под которым
      // пустая страница (замечание владельца 2026-10-04). Прокрутка — внутри, шапка закреплена.
      fill={bare}
      columns={shownColumns}
      rows={rows}
      rowKey={row => row.questionId}
      sortKey={sortKey}
      sortDir={sortDir}
      onSort={(key, dir) => { setSortKey(key); setSortDir(dir); }}
      // Э3.3: строка открывает вопрос — прежде клик по ней не делал ничего.
      onRowClick={onOpenQuality ? row => onOpenQuality(row.questionId, rows.map(item => item.questionId)) : undefined}
      emptyMessage={view === "review"
        ? "Признаки проблем не сошлись ни у одного вопроса: чинить нечего"
        : view === "excluded"
          ? "Из выдачи ничего не исключено"
          : bare ? "В этом виде вопросов нет" : "Вопросов в выдаче пока нет"}
    />
  );
  /*
    PRD-66 FR-04, FR-38a: два порога сосуществуют в одной строке, и экран обязан сказать, какой к
    какому числу относится. Выборка названа там же: трудность считается по первой попытке
    участника, а пропуски и время — по всем ответам.
  */
  const footnote = !measurement ? (
    <Text variant="body-xs" tone="muted">
      Трудность и дискриминативность считаются по доле балла в первой попытке участника ·
      доли ответов, пропуски, экспозиция и время — от {minObservations} наблюдений,
      дискриминативность — от {COEFFICIENT_MIN}
    </Text>
  ) : null;
  /* FR-17b: исключение подтверждается отдельным окном — тем же, что у «Качества вопросов». */
  const exclusionDialog = (
    <DeliveryExclusionDialog
      target={pending}
      testId={testId}
      onClose={() => setPending(null)}
      onConfirm={questionId => onDeliveryChange?.(questionId, true)}
    />
  );

  if (bare) {
    // Подпись о порогах — над таблицей: таблица во всю высоту окна (`fill`), и строка под ней
    // уводила бы страницу во вторую прокрутку.
    return (
      <Stack gap={4}>
        {footnote}
        {grid}
        {exclusionDialog}
      </Stack>
    );
  }

  return (
    <Stack gap={4}>
      {/*
        PRD-66 ОВ-01: число в колонке сменилось у экрана, который автор уже читает, и молча
        подменять его нельзя — он сравнивает сегодняшнюю таблицу со вчерашней. Пояснение
        разовое: закрывший его больше не увидит (FR-02).
      */}
      {!measurement && noticeHidden === false ? (
        <Banner
          variant="subtle"
          tone="info"
          size="sm"
          title="Колонка «Доля верных» заменена трудностью"
          description="Трудность считается долей набранного балла. У вопросов с точной оценкой число прежнее, у вопросов с частичным кредитом — выше."
          actions={[{ label: "Больше не показывать", onClick: hideNotice }]}
        />
      ) : null}

      <Card>
      <CardHeader
        title="Вопросы теста"
        subtitle={`${questions.length} ${pluralize(questions.length, "вопрос", "вопроса", "вопросов")} в выдаче${excludedRows.length > 0 ? `, ${excludedRows.length} ${pluralize(excludedRows.length, "исключён", "исключено", "исключено")} из выдачи` : ""}${passages !== undefined ? ` · ${passages} ${pluralize(passages, "прохождение", "прохождения", "прохождений")}` : ""} · доля пропусков считается по веб-прохождениям: состав выданной формы пакет не сообщает`}
        trail={
          <SegmentedControl
            size="s"
            value={view}
            onChange={value => setView(value as View)}
            items={[
              { value: "all", label: "Все вопросы" },
              { value: "review", label: "Требуют ревизии", badge: flagged.length },
              { value: "excluded", label: "Исключённые", badge: excludedRows.length },
            ]}
          />
        }
      />
      <CardBody>
        {grid}
        {footnote}
      </CardBody>
      {exclusionDialog}

      </Card>
    </Stack>
  );
}

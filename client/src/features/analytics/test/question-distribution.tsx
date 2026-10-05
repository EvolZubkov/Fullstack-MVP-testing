/**
 * @module features/analytics/test/question-distribution
 * @description Э4а UX-аудита аналитики: полный вид распределения ответов на странице вопроса
 * (эскиз approved/e4a-answer-distribution.html, состояния «сопоставление» — «мало данных»).
 *
 * У выбора полный вид — таблица «Варианты ответа» разбора (`item-breakdown.tsx`). Здесь —
 * остальные типы:
 *   - сопоставление, ранжирование, пропуски — строка на пару, элемент или пропуск: доля верного у
 *     всех, у слабых и у сильных, частая ошибка; у ранжирования — среднее место и сдвиг;
 *   - короткий ответ, число, шкала, распределение баллов — строка на ответ тем же цветом, что в
 *     полосе таблицы вопросов, у короткого ответа — «засчитано / не засчитано»;
 *   - развёрнутый ответ и пропуски — сами ответы прямо на странице, без окна (решение владельца
 *     2026-10-04): новые сверху, по 20, следующие подгружаются при прокрутке к концу списка.
 */
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";

import {
  Button, Card, CardBody, CardHeader, DataGrid, Grid, Separator, Spinner, Stack, Tag, Text,
} from "@skillum/ui-kit";

import { pluralize } from "@/lib/i18n";

import { percentOfShare } from "../format";
import { colorize, type SpreadView, type UnitsView, type UnitView, type VolumeView } from "./answer-distribution";
import { Tile, IntentTile } from "./item-breakdown";
import { num } from "./psychometrics-format";
import { TermHint } from "./term-hint";
import { QuestionExportDialog } from "./question-export-dialog";

/** Наблюдений: «302 наблюдения». */
function observations(n: number): string {
  return `${n} ${pluralize(n, "наблюдение", "наблюдения", "наблюдений")}`;
}

/** Доля со шкалой; цвет — у ответа, без цвета — акцент. */
function Scale({ share, color }: { share: number | null; color?: string }) {
  if (share === null) return <Text variant="body-s" tone="muted">—</Text>;
  return (
    <span className="tb-psy-scale">
      <span className="tb-psy-scale__value ou-text ou-text--body-s">{percentOfShare(share)}</span>
      <span className="tb-psy-scale__track">
        <span className="tb-psy-scale__fill" style={{ width: `${Math.round(share * 100)}%`, ...(color ? { background: color } : {}) }} />
      </span>
    </span>
  );
}

/** Подпись строки с цветной меткой ответа — той же, что в легенде полосы таблицы. */
function Labelled({ label, color, sub }: { label: string; color?: string; sub?: string }) {
  return (
    <Stack gap={1}>
      <span className="tb-psy-prompt">
        {color ? <span className="tb-dist-dot" style={{ background: color }} /> : null}
        {label}
      </span>
      {sub ? <Text variant="body-xs" tone="muted">{sub}</Text> : null}
    </Stack>
  );
}

/** Свойства таблицы единиц. */
export interface UnitsCardProps {
  units: UnitsView;
}

/**
 * Пары, порядок или пропуски — строка на единицу.
 *
 * @param props - разбор по единицам (со слабыми и сильными, если считался разбор вопроса)
 * @returns карточка с таблицей
 */
export function UnitsCard({ units }: UnitsCardProps) {
  const groupColumns = [
    {
      key: "bottom",
      width: "17%",
      align: "center" as const,
      header: <TermHint entry="unitBottom" term="Слабые 27 %" />,
      render: (row: UnitView) => <Scale share={row.bottomShare} />,
    },
    {
      key: "top",
      width: "17%",
      align: "center" as const,
      header: <TermHint entry="unitTop" term="Сильные 27 %" />,
      render: (row: UnitView) => <Scale share={row.topShare} />,
    },
  ];
  const share = (entry: "pairCorrect" | "onPlace" | "blankCorrect") => ({
    key: "share",
    width: "13%",
    align: "center" as const,
    numeric: true,
    header: <TermHint entry={entry} />,
    render: (row: UnitView) => <Text variant="body-s">{percentOfShare(row.share)}</Text>,
  });
  const mistake = (entry: "pairMix" | "blankWrong") => ({
    key: "mistake",
    width: "21%",
    align: "center" as const,
    header: <TermHint entry={entry} />,
    render: (row: UnitView) => (row.mistake
      ? <Text variant="body-s">{`${row.mistake.label} — ${percentOfShare(row.mistake.share)}`}</Text>
      : <Text variant="body-s" tone="muted">ошибок нет</Text>),
  });

  if (units.type === "matching") {
    return (
      <Card variant="outlined">
        <CardHeader title="Пары" subtitle={`Доля участников, сопоставивших каждую пару верно · ${observations(units.observations)}`} />
        <CardBody>
          <DataGrid
            className="tb-psy-grid"
            columns={[
              { key: "label", width: "32%", frozen: true, header: "Элемент", render: (row: UnitView) => <Labelled label={row.label} sub={`верно: ${row.reference ?? "—"}`} /> },
              share("pairCorrect"), ...groupColumns, mistake("pairMix"),
            ]}
            rows={units.units}
            rowKey={row => String(row.index)}
            emptyMessage="Пар у вопроса нет"
          />
        </CardBody>
      </Card>
    );
  }
  if (units.type === "ranking") {
    return (
      <Card variant="outlined">
        <CardHeader title="Порядок" subtitle={`Где участники ставили каждый элемент · ${observations(units.observations)}`} />
        <CardBody>
          <DataGrid
            className="tb-psy-grid"
            columns={[
              { key: "label", width: "30%", frozen: true, header: "Элемент", render: (row: UnitView) => <Labelled label={row.label} sub={`верное место: ${row.place}`} /> },
              share("onPlace"), ...groupColumns,
              {
                key: "meanPlace", width: "11%", align: "center" as const, numeric: true,
                header: <TermHint entry="meanPlace" />,
                render: (row: UnitView) => <Text variant="body-s">{num(row.meanPlace ?? null, 1)}</Text>,
              },
              {
                key: "meanShift", width: "12%", align: "center" as const, numeric: true,
                header: <TermHint entry="meanShift" />,
                render: (row: UnitView) => <Text variant="body-s">{num(row.meanShift ?? null, 1)}</Text>,
              },
            ]}
            rows={units.units}
            rowKey={row => String(row.index)}
            emptyMessage="Элементов у вопроса нет"
          />
        </CardBody>
      </Card>
    );
  }
  return (
    <Card variant="outlined">
      <CardHeader title="Пропуски" subtitle={`Доля верно заполнивших каждый пропуск · ${observations(units.observations)}`} />
      <CardBody>
        <DataGrid
          className="tb-psy-grid"
          columns={[
            {
              key: "label", width: "32%", frozen: true, header: "Пропуск",
              render: (row: UnitView) => (
                <Labelled
                  label={row.label}
                  sub={[row.context, row.reference ? `верно: «${row.reference}»` : null].filter(Boolean).join(" · ")}
                />
              ),
            },
            share("blankCorrect"), ...groupColumns, mistake("blankWrong"),
          ]}
          rows={units.units}
          rowKey={row => String(row.index)}
          emptyMessage="Проверяемых пропусков у вопроса нет"
        />
      </CardBody>
    </Card>
  );
}

/**
 * Кнопка «Выгрузить ответы в Excel»: открывает окно «Экспорт» уровня вопроса (Э5.2) — условия
 * страницы и число ответов под них названы до выгрузки.
 */
function ExportButton({ testId, questionId, search = "", conditionLabels = [] }: {
  testId: string;
  questionId: string;
  search?: string;
  conditionLabels?: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="s" leadingIcon={<Download size={14} />} onClick={() => setOpen(true)}>
        Выгрузить ответы в Excel
      </Button>
      {open && (
        <QuestionExportDialog
          open
          onClose={() => setOpen(false)}
          testId={testId}
          questionId={questionId}
          search={search}
          conditionLabels={conditionLabels}
        />
      )}
    </>
  );
}

/** Свойства таблицы распределения. */
export interface SpreadCardProps {
  questionType: string;
  spread: SpreadView;
  testId: string;
  questionId: string;
  /** Тест измерительный: у опросника нет верного ответа. */
  measurement?: boolean;
  /** Условия страницы (`?…` или пусто) — выгрузка ответов идёт по ним. */
  search?: string;
  /** Подписи этих условий — для окна «Экспорт». */
  conditionLabels?: string[];
}

/**
 * Короткий ответ, число, шкала, распределение баллов — строка на ответ.
 *
 * @param props - тип вопроса и разброс его ответов
 * @returns карточка с таблицей
 */
export function SpreadCard({ questionType, spread, testId, questionId, search, conditionLabels }: SpreadCardProps) {
  const rows = colorize(spread.options.map(option => ({ ...option })));
  const accepted = spread.options.some(option => option.correct !== undefined);
  const numeric = questionType === "short" && rows.some(row => /^от .* до /.test(row.label));
  const answered = `${spread.answered} ${pluralize(spread.answered, "ответ", "ответа", "ответов")}`;
  const head = questionType === "scale"
    ? { title: "Разброс ответов", subtitle: `Доля выбравших каждую градацию; верного ответа у опросника нет · ${answered}`, label: "Градация", entry: "gradation" as const }
    : questionType === "allocation"
      ? { title: "Разброс ответов", subtitle: `Доля розданных баллов, отданная каждому утверждению · ${answered}`, label: "Утверждение", entry: "allocationShare" as const }
      : numeric
        ? { title: "Какие числа вводили", subtitle: `Значения по интервалам${accepted ? " и засчитали ли их правила" : ""} · ${answered}`, label: "Значение", entry: "numberBucket" as const }
        : { title: "Что писали", subtitle: `Частые написания${accepted ? " и засчитали ли их правила" : ""} · ${rows.length} ${pluralize(rows.length, "написание", "написания", "написаний")} · ${answered}`, label: "Написание", entry: "written" as const };
  return (
    <Card variant="outlined">
      <CardHeader
        title={head.title}
        subtitle={head.subtitle}
        trail={questionType === "short" ? <ExportButton testId={testId} questionId={questionId} search={search} conditionLabels={conditionLabels} /> : undefined}
      />
      <CardBody>
        <DataGrid
          className="tb-psy-grid"
          columns={[
            { key: "label", width: accepted ? "50%" : "50%", frozen: true, header: head.label, render: (row: typeof rows[number]) => <Labelled label={row.label} color={row.color} /> },
            {
              key: "share", width: accepted ? "30%" : "50%", align: "center" as const,
              header: <TermHint entry={head.entry} />,
              render: (row: typeof rows[number]) => <Scale share={row.share / 100} color={row.color} />,
            },
            ...(accepted ? [{
              key: "accepted", width: "20%", align: "center" as const,
              header: <TermHint entry="accepted" />,
              render: (row: typeof rows[number]) => (row.correct
                ? <Tag tone="success" size="s">засчитано</Tag>
                : <Tag tone="neutral" size="s">не засчитано</Tag>),
            }] : []),
          ]}
          rows={rows}
          rowKey={row => row.label}
          emptyMessage="Ответов пока нет"
        />
      </CardBody>
    </Card>
  );
}

/** Строка списка ответов — то, что отдаёт `GET .../questions/:id/answers`. */
interface AnswerRow {
  attemptId: string;
  participant: string;
  at: string | null;
  answer: string;
  length: number;
  outcome?: "correct" | "partial" | "incorrect" | "neutral";
  latencyMs: number | null;
}

/** Порция ответов. */
interface AnswersPage {
  total: number;
  offset: number;
  rows: AnswerRow[];
}

/** Сколько ответов в порции. */
const PAGE = 20;

/** Время на вопрос: «7:05». */
function duration(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Исход ответа тегом; у развёрнутого ответа (без оценки) — ничего. */
function OutcomeTag({ outcome }: { outcome?: AnswerRow["outcome"] }) {
  if (outcome === "correct") return <Tag tone="success" size="s">верно</Tag>;
  if (outcome === "partial") return <Tag tone="warning" size="s">частично</Tag>;
  if (outcome === "incorrect") return <Tag tone="neutral" size="s">неверно</Tag>;
  return null;
}

/** Свойства карточки ответов. */
export interface QuestionAnswersCardProps {
  testId: string;
  questionId: string;
  questionType: string;
  /** Сводка развёрнутого ответа — над списком. */
  volume?: VolumeView | null;
  /**
   * Условия страницы (`?…` или пусто): список и его книга говорят о той же выборке, что разбор
   * вопроса над ними.
   */
  search?: string;
  /** Подписи этих условий — для окна «Экспорт». */
  conditionLabels?: string[];
}

/**
 * Ответы на вопрос прямо на странице — с подгрузкой при прокрутке.
 *
 * @param props - тест, вопрос, тип и сводка объёма
 * @returns карточка «Ответы»
 */
export function QuestionAnswersCard({
  testId, questionId, questionType, volume, search = "", conditionLabels,
}: QuestionAnswersCardProps) {
  const sentinel = useRef<HTMLDivElement | null>(null);
  const query = useInfiniteQuery<AnswersPage>({
    queryKey: ["question-answers", testId, questionId, search],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams(search.replace(/^\?/, ""));
      params.set("offset", String(pageParam as number));
      params.set("limit", String(PAGE));
      const response = await fetch(
        `/api/analytics/tests/${testId}/questions/${questionId}/answers?${params.toString()}`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error(String(response.status));
      return response.json() as Promise<AnswersPage>;
    },
    getNextPageParam: (last) => (last.offset + last.rows.length < last.total ? last.offset + last.rows.length : undefined),
  });
  const rows = query.data?.pages.flatMap(page => page.rows) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  // Следующая порция — когда конец списка показался на экране.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
    }, { rootMargin: "200px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, rows.length]);

  const long = questionType === "long";
  return (
    <Card variant="outlined">
      <CardHeader
        title="Ответы"
        subtitle={long
          ? "Новые сверху · у развёрнутого ответа нет автоматической оценки, поэтому частот и долей нет"
          : "Новые сверху · что вписал каждый участник"}
        trail={<ExportButton testId={testId} questionId={questionId} search={search} conditionLabels={conditionLabels} />}
      />
      <CardBody>
        <Stack gap={6}>
          {long && volume ? (
            <Grid cols={3} gap={4}>
              <Stack gap={1}>
                <Text variant="body-xs" tone="muted">Ответов</Text>
                <Text variant="body-s">{volume.answered}</Text>
              </Stack>
              <Stack gap={1}>
                <Text variant="body-xs" tone="muted">Длина, медиана</Text>
                <Text variant="body-s">{`${volume.medianLength} ${pluralize(volume.medianLength, "знак", "знака", "знаков")}`}</Text>
              </Stack>
              <Stack gap={1}>
                <Text variant="body-xs" tone="muted">Самый короткий и самый длинный</Text>
                <Text variant="body-s">{`${volume.minLength} и ${volume.maxLength} ${pluralize(volume.maxLength, "знак", "знака", "знаков")}`}</Text>
              </Stack>
            </Grid>
          ) : null}
          {query.isLoading ? <Spinner size="s" label="Читаем ответы…" inline /> : null}
          {query.isError ? <Text variant="body-s" tone="muted">Ответы прочитать не удалось</Text> : null}
          {!query.isLoading && rows.length === 0 && !query.isError
            ? <Text variant="body-s" tone="muted">На этот вопрос пока никто не ответил</Text>
            : null}
          {rows.length > 0 ? (
            <Stack gap={4}>
              {rows.map((row, index) => (
                <Stack key={`${row.attemptId}-${index}`} gap={4}>
                  {index > 0 ? <Separator /> : null}
                  <Stack gap={1}>
                    <Stack direction="row" gap={2} align="center" wrap>
                      <Text variant="body-xs" tone="muted">
                        {[
                          row.participant,
                          row.at ? new Date(row.at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : null,
                          long ? `${row.length} ${pluralize(row.length, "знак", "знака", "знаков")}` : null,
                          row.latencyMs === null ? null : duration(row.latencyMs),
                        ].filter(Boolean).join(" · ")}
                      </Text>
                      <OutcomeTag outcome={row.outcome} />
                    </Stack>
                    <Text variant="body-m">{row.answer}</Text>
                  </Stack>
                </Stack>
              ))}
              <div ref={sentinel}>
                <Stack direction="row" justify="between" align="center">
                  {isFetchingNextPage || hasNextPage
                    ? <Spinner size="s" label="Загружаем следующие ответы…" inline />
                    : <span />}
                  <Text variant="body-xs" tone="muted">{`Показано ${rows.length} из ${total}`}</Text>
                </Stack>
              </div>
            </Stack>
          ) : null}
        </Stack>
      </CardBody>
    </Card>
  );
}

/** Свойства плиток вопроса без психометрики. */
export interface NotGradedTilesProps {
  /** Сложность, заданная автором; `null` — не задана. */
  declared: number | null;
  latencyMedianMs: number | null;
  latencySampleSize?: number;
}

/**
 * Плитки вопроса без автоматической оценки (развёрнутый ответ): трудность и дискриминативность
 * не применимы, сложность — только заданная, время — как у всех.
 *
 * @param props - заданная сложность и время
 * @returns ряд плиток
 */
export function NotGradedTiles({ declared, latencyMedianMs, latencySampleSize }: NotGradedTilesProps) {
  return (
    <Grid cols={3} gap={1}>
      <Tile entry="difficulty" value="не применимо" empty caption="нет автоматической оценки" />
      <Tile entry="itemRest" term="Дискриминативность (r)" value="не применимо" empty caption="нет автоматической оценки" />
      <IntentTile declared={declared} observed={null} missing="по ответам не считается: нет автоматической оценки" />
      {latencyMedianMs !== null ? (
        <Tile
          entry="latency"
          value={duration(latencyMedianMs)}
          caption={latencySampleSize ? observations(latencySampleSize) : ""}
        />
      ) : null}
    </Grid>
  );
}

/**
 * @module pages/author/bank-question-analytics
 * @description PRD-70 FR-40 - FR-44: страница вопроса банка — уровень «вопрос банка» в каркасе
 * аналитики (`/author/analytics/questions/:questionId`).
 *
 * Таблица «По тестам» — строка на каждый тест читателя, где вопрос выдавался; числа строки — по
 * выборке и правилам оценки своего теста, итоговой строки и средних нет (К1). «Версии
 * содержания» — свойство вопроса: выбор редакции меняет выборку строк (FR-11). Эскиз —
 * `docs/wireframes/approved/e7-question-bank.html`, состояние «вопрос банка».
 */
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams, useSearch } from "wouter";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DataGrid,
  Select,
  Stack,
  Tag,
  Text,
} from "@skillum/ui-kit";

import { LoadingState } from "@/components/loading-state";
import { AnalyticsHeader } from "@/features/analytics/levels/analytics-header";
import { ANALYTICS_ROUTE, questionHref } from "@/features/analytics/levels/analytics-routes";
import { currentHref, stateForDive, trailOf } from "@/features/analytics/levels/trail";
import { NoValue } from "@/features/analytics/test/no-value";
import { COEFFICIENT_MIN, num } from "@/features/analytics/test/psychometrics-format";
import { TermHint } from "@/features/analytics/test/term-hint";
import { questionInTopicHref } from "@/features/content/question-link";
import { QuestionTypeIcon } from "@/features/tests/editor/sections/question-type-icon";
import { renderBlanksText } from "@shared/questions/blanks-render";
import type { QuestionType } from "@shared/questions/question-type";

/** Признак вопроса в тесте. */
interface FlagView {
  tone: "error" | "warning" | "info";
  title: string;
  detail: string;
}

/** Строка «По тестам» (`GET /api/analytics/questions/:id`). */
interface TestRowView {
  testId: string;
  title: string;
  delivered: number;
  drawMode: "quota" | "all" | "forms" | "adaptive" | null;
  sharePercent: number | null;
  expectedPercent: number | null;
  observations: number;
  difficulty: number | null;
  difficultyConfidence: string;
  itemRest: number | null;
  coefficientConfidence: string;
  declared: number | null;
  hardness: number | null;
  skipShare: number | null;
  latencyMedianMs: number | null;
  flag: FlagView | null;
  deadOptions: Array<{ label: string; chosen: number; of: number }>;
}

/** Версия содержания вопроса. */
interface VersionView {
  psychoHash: string | null;
  firstAt: string;
  lastAt: string;
  tests: number;
  observations: number;
  current: boolean;
}

interface BankQuestionView {
  question: { id: string; prompt: string; type: string; topicId: string; topicName: string; tags: string[] };
  selectedVersion?: string | null;
  rows: TestRowView[];
  versions: VersionView[];
  minObservations: number;
}

/** Окно счётчика выдач в месяцах — то же, что в подписях эскиза. */
const WINDOW_MONTHS = 12;

/** Ключ редакции для выбора: «версия неизвестна» — пустая строка. */
const versionKey = (hash: string | null): string => hash ?? "";

/** Дата «дд.мм.гггг». */
function day(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU");
}

/** Процент целым с неразрывным пробелом. */
function percent(value: number): string {
  return `${Math.round(value)} %`;
}

/** Время на задание: минуты и секунды, как их читают. */
function duration(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Русская форма числительного. */
function plural(n: number, [one, few, many]: [string, string, string]): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** Подпись редакции: «текущая, с 04.09.2026» или период. */
function versionLabel(version: VersionView): string {
  if (version.psychoHash === null) return "версия неизвестна";
  return version.current ? `текущая, с ${day(version.firstAt)}` : `${day(version.firstAt)} — ${day(version.lastAt)}`;
}

/** Подпись под долей выдачи: ожидаемая доля или способ выдачи раздела. */
function exposureSub(row: TestRowView): string | null {
  if (row.expectedPercent !== null) return `ожидаемая ${percent(row.expectedPercent)}`;
  if (row.drawMode === "all") return "весь банк";
  if (row.drawMode === "forms") return "варианты";
  if (row.drawMode === "adaptive") return "адаптив";
  return null;
}

export default function BankQuestionAnalyticsPage() {
  const { questionId = "" } = useParams<{ questionId: string }>();
  const [location, navigate] = useLocation();
  const search = useSearch();
  const requested = new URLSearchParams(search).get("version");

  const { data, isLoading, isError } = useQuery<BankQuestionView>({
    queryKey: [`/api/analytics/questions/${questionId}${requested === null ? "" : `?version=${encodeURIComponent(requested)}`}`],
    enabled: Boolean(questionId),
  });

  /** Выбрать редакцию: смена выборки строк, помнится в адресе (FR-11). */
  const selectVersion = (key: string) => {
    const params = new URLSearchParams(search);
    params.set("version", key);
    navigate(`${location}?${params.toString()}`, { replace: true });
  };

  if (isLoading) return <LoadingState message="Считаем статистику вопроса…" />;
  if (isError || !data) {
    return <Text tone="error">Вопрос не найден или недоступен вам.</Text>;
  }

  const { question, rows, versions, minObservations } = data;
  const prompt = renderBlanksText(question.prompt, { mode: "dash" });
  // Возврат (замечание владельца 2026-10-05): пришли переходом вглубь — крошки ведут по пройденному
  // пути («Темы и вопросы», «Аналитика → тест → вопрос в тесте»); по ссылке — на «Аналитику».
  const arrivedBy = trailOf(typeof window === "undefined" ? null : window.history.state);
  const pathCrumbs = arrivedBy ?? [{ label: "Аналитика", href: ANALYTICS_ROUTE }];
  /** Перейти на вопрос в тесте, унося путь: его крошки вернут сюда. */
  const openInTest = (testId: string) => {
    const target = questionHref(testId, question.id);
    navigate(target, {
      // Шаг называется ролью, а не текстом: текст вопроса стоит последней крошкой вопроса в тесте.
      state: stateForDive(arrivedBy, { label: "Вопрос банка", href: currentHref(), state: window.history.state }, target),
    });
  };
  const selectedKey = data.selectedVersion === undefined ? undefined : versionKey(data.selectedVersion);
  const subtitle = [
    "Вопрос банка",
    question.topicName,
    ...question.tags,
    `выдавался в ${rows.length} ${plural(rows.length, ["тесте", "тестах", "тестах"])} за ${WINDOW_MONTHS} месяцев`,
  ].filter(Boolean).join(" · ");

  const columns = [
    {
      key: "title",
      // Доли колонок — из эскиза: при фиксированной раскладке таблица не уходит в прокрутку.
      width: "16%",
      header: "Тест",
      render: (row: TestRowView) => <span className="ou-grid__cell-strong tb-cell-wrap">{row.title}</span>,
    },
    {
      key: "delivered",
      width: "6%",
      header: <TermHint entry="bankQDelivered" />,
      align: "center" as const,
      numeric: true,
      render: (row: TestRowView) => row.delivered,
    },
    {
      key: "exposure",
      width: "12%",
      header: <TermHint entry="bankQExposure" />,
      align: "center" as const,
      numeric: true,
      render: (row: TestRowView) => {
        if (row.sharePercent === null) return <Text variant="body-s" tone="muted">—</Text>;
        const sub = exposureSub(row);
        return (
          <Stack gap={1} align="center">
            <span>{percent(row.sharePercent)}</span>
            {sub && <span className="ou-grid__cell-sub">{sub}</span>}
          </Stack>
        );
      },
    },
    {
      key: "difficulty",
      width: "10%",
      header: <TermHint entry="bankQDifficulty" />,
      align: "center" as const,
      numeric: true,
      render: (row: TestRowView) => (row.difficulty === null || row.difficultyConfidence === "insufficient"
        ? <NoValue kind="insufficient" need={minObservations} have={row.observations} />
        : num(row.difficulty)),
    },
    {
      key: "itemRest",
      width: "11%",
      header: <TermHint entry="bankQItemRest" term={"Дискрими­нативность"} />,
      align: "center" as const,
      numeric: true,
      render: (row: TestRowView) => (row.itemRest === null || row.coefficientConfidence === "insufficient"
        ? <NoValue kind="insufficient" need={COEFFICIENT_MIN} have={row.observations} />
        : num(row.itemRest)),
    },
    {
      key: "intent",
      width: "11%",
      header: <TermHint entry="bankQIntent" />,
      align: "center" as const,
      numeric: true,
      render: (row: TestRowView) => {
        if (row.hardness === null) return <NoValue kind="insufficient" need={minObservations} have={row.observations} />;
        return `${row.declared ?? "не задана"} → ${row.hardness}`;
      },
    },
    {
      key: "skip",
      width: "8%",
      header: <TermHint entry="bankQSkip" />,
      align: "center" as const,
      numeric: true,
      render: (row: TestRowView) => (row.skipShare === null ? "—" : percent(row.skipShare)),
    },
    {
      key: "latency",
      width: "8%",
      header: <TermHint entry="bankQLatency" />,
      align: "center" as const,
      numeric: true,
      render: (row: TestRowView) => duration(row.latencyMedianMs),
    },
    {
      key: "flags",
      width: "18%",
      header: <TermHint entry="bankQFlags" />,
      render: (row: TestRowView) => (row.flag || row.deadOptions.length > 0 ? (
        <Stack gap={1} align="start">
          {row.flag && <Tag tone={row.flag.tone === "info" ? "neutral" : row.flag.tone} size="s">{row.flag.title}</Tag>}
          {row.flag?.detail && <span className="ou-grid__cell-sub">{row.flag.detail}</span>}
          {row.deadOptions.map((option) => (
            <span key={option.label} className="ou-grid__cell-sub">
              {`Мёртвый вариант «${option.label}» — ${option.chosen} из ${option.of}`}
            </span>
          ))}
        </Stack>
      ) : null),
    },
  ];

  const versionColumns = [
    {
      key: "period",
      header: "Редакция",
      width: "46%",
      render: (version: VersionView) => (
        <Stack gap={1} align="start">
          <span className="ou-grid__cell-strong">{versionLabel(version)}</span>
          {!version.current && version.psychoHash !== null && <span className="ou-grid__cell-sub">предыдущая редакция</span>}
        </Stack>
      ),
    },
    { key: "tests", header: "Тестов", width: "18%", align: "center" as const, numeric: true, render: (v: VersionView) => v.tests },
    { key: "observations", header: "Выдан", width: "18%", align: "center" as const, numeric: true, render: (v: VersionView) => v.observations },
    {
      key: "select",
      header: "",
      width: "18%",
      // Редакция одна — выбирать не из чего, и действия у строки нет.
      render: (version: VersionView) => (versions.length <= 1 ? null : selectedKey === versionKey(version.psychoHash) ? (
        <Tag size="s">Выбрана</Tag>
      ) : (
        <Button variant="ghost" size="s" onClick={() => selectVersion(versionKey(version.psychoHash))}>Показать</Button>
      )),
    },
  ];

  return (
    <Stack gap={6}>
      <AnalyticsHeader
        crumbs={[...pathCrumbs, { label: prompt }]}
        title={(
          <>
            {question.type ? <QuestionTypeIcon type={question.type as QuestionType} size={20} /> : null}
            {" "}{prompt}
          </>
        )}
        subtitle={subtitle}
        actions={(
          <Button variant="secondary" size="s" onClick={() => navigate(questionInTopicHref(question.id))}>
            Открыть вопрос в теме
          </Button>
        )}
      />

      <Card>
        <CardHeader
          title="По тестам"
          subtitle="Числа каждой строки — по выборке и правилам оценки своего теста; между тестами они не складываются"
          trail={versions.length > 1 && selectedKey !== undefined ? (
            <Select
              size="s"
              aria-label="Редакция"
              value={selectedKey}
              onChange={selectVersion}
              options={versions.map((version) => ({
                value: versionKey(version.psychoHash),
                label: `Редакция: ${versionLabel(version)}`,
              }))}
            />
          ) : undefined}
        />
        <CardBody>
          <Stack gap={2}>
            <DataGrid
              className="tb-psy-grid"
              columns={columns}
              rows={rows}
              rowKey={(row) => row.testId}
              onRowClick={(row) => openInTest(row.testId)}
              emptyMessage={`За ${WINDOW_MONTHS} месяцев вопрос не выдавался ни в одном доступном вам тесте`}
            />
            <Text variant="body-xs" tone="muted">
              {`Тесты, где вопрос выдавался за ${WINDOW_MONTHS} месяцев и которые вам доступны · строка открывает вопрос в тесте`}
            </Text>
          </Stack>
        </CardBody>
      </Card>

      {versions.length > 0 && (
        <Card>
          <CardHeader
            title="Версии содержания"
            subtitle="Наблюдения разных редакций не складываются: выберите редакцию в таблице «По тестам»"
          />
          <CardBody>
            <DataGrid
              className="tb-psy-grid"
              columns={versionColumns}
              rows={versions}
              rowKey={(version) => versionKey(version.psychoHash)}
            />
          </CardBody>
        </Card>
      )}
    </Stack>
  );
}

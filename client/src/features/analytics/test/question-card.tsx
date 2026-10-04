/**
 * @module features/analytics/test/question-card
 * @description Э3.3: блоки страницы вопроса — «Вопрос в этом тесте» и «Этот вопрос в других
 * тестах» (решение владельца 2026-10-03, эскиз approved/e3-test-and-question.html, состояние
 * question).
 *
 * «Вопрос в этом тесте» — только чтение: текст и изображение вопроса, тема, подтемы, выдача,
 * балл, цена ответа и сложность — значения из «Оценки» теста; заданное в тесте подписано
 * «настроено в тесте». Варианты ответа отдельно не повторяются — их текст и пометка верного уже
 * есть в разборе; у типов без таблицы вариантов здесь стоит «Верный ответ» словами.
 *
 * «Этот вопрос в других тестах» — тесты, где вопрос выдавался за окно экспозиции, с объёмом и
 * трудностью; строка ведёт на уровень вопроса в том тесте.
 */
import { ChevronRight } from "lucide-react";

import {
  Button, Card, CardBody, CardHeader, DataGrid, Grid, IconButton, Stack, Tag, Text,
} from "@skillum/ui-kit";
import { renderBlanksText } from "@shared/questions/blanks-render";

import { num } from "./psychometrics-format";

/** Ответ `GET .../questions/:questionId/card` (см. `server/routes/analytics/question-card.ts`). */
export interface QuestionCardView {
  questionId: string;
  prompt: string;
  questionType: string;
  topicName: string | null;
  tags: string[];
  media: { url: string; type: string } | null;
  excluded: boolean;
  points: number;
  pointsInTest: boolean;
  scoringKind: string;
  scoringInTest: boolean;
  difficulty: number | null;
  difficultyInTest: boolean;
  correctAnswer: string | null;
  otherTests: OtherTestView[];
  /** Окно экспозиции инстанса в месяцах. */
  windowMonths: number;
}

/** Строка «Этот вопрос в других тестах». */
export interface OtherTestView {
  testId: string;
  title: string;
  delivered: number;
  observations: number;
  difficulty: number | null;
}

/** Правило начисления — словами «Оценки» теста. */
const KIND_LABEL: Record<string, string> = {
  exact: "Точное",
  weighted: "Веса",
  tiered: "Ступени",
};

/** Подпись поля и его значение — родственные элементы, 1x сетки. */
function Field({ label, children, note }: { label: string; children: React.ReactNode; note?: string }) {
  return (
    <Stack gap={1} align="start">
      <Text variant="body-xs" tone="muted">{label}</Text>
      {children}
      {note ? <Text variant="body-xs" tone="subtle">{note}</Text> : null}
    </Stack>
  );
}

/** Свойства блока «Вопрос в этом тесте». */
export interface QuestionInTestCardProps {
  card: QuestionCardView;
  /** С какого дня действует текущая редакция; `null` — неизвестно. */
  currentSince: string | null;
  onOpenInTopic: () => void;
  /**
   * Э4а: вопрос опросника — баллов, правила начисления и сложности у него нет, и поля не
   * показываются: «Балл 1» у вопроса без верного ответа читался бы как цена.
   */
  measurement?: boolean;
}

/**
 * «Вопрос в этом тесте».
 *
 * @param props - вопрос, дата текущей редакции, переход к правке в теме
 * @returns карточка с текстом вопроса и его настройками в тесте
 */
export function QuestionInTestCard({ card, currentSince, onOpenInTopic, measurement = false }: QuestionInTestCardProps) {
  return (
    <Card>
      <CardHeader
        title="Вопрос в этом тесте"
        subtitle={currentSince
          ? `Текущая редакция · с ${new Date(currentSince).toLocaleDateString("ru-RU")}`
          : "Текущая редакция"}
        trail={<Button variant="secondary" size="s" onClick={onOpenInTopic}>Открыть вопрос в теме</Button>}
      />
      <CardBody>
        <Stack gap={4}>
          {/* Э4а: маркеры пропусков ({{kind}}) — прочерком, как их видит участник. */}
          <Text variant="body-m">{renderBlanksText(card.prompt, { mode: "dash" })}</Text>
          {card.media?.type === "image" ? (
            <img src={card.media.url} alt="Изображение вопроса" className="tb-question-card__media" />
          ) : null}
          <Grid cols={3} gap={4}>
            <Field label="Тема"><Text variant="body-s">{card.topicName ?? "—"}</Text></Field>
            <Field label="Подтемы">
              {(card.tags ?? []).length > 0
                ? (
                  <Stack direction="row" gap={1} wrap>
                    {(card.tags ?? []).map(tag => <Tag key={tag} size="s">{tag}</Tag>)}
                  </Stack>
                )
                : <Text variant="body-s" tone="muted">нет</Text>}
            </Field>
            <Field label="Выдача">
              {card.excluded
                ? <Tag tone="warning" size="s">Исключён из выдачи</Tag>
                : <Text variant="body-s">выдаётся</Text>}
            </Field>
            {measurement ? null : (
              <>
                <Field label="Балл" note={card.pointsInTest ? "настроено в тесте" : undefined}>
                  <Text variant="body-s">{card.points}</Text>
                </Field>
                <Field label="Цена ответа" note={card.scoringInTest ? "настроено в тесте" : undefined}>
                  <Tag variant="outline" size="s">{KIND_LABEL[card.scoringKind] ?? card.scoringKind}</Tag>
                </Field>
                {/* Э4а: незаданная сложность — «не задана», а не прочерк и не подставленная 50. */}
                <Field
                  label="Сложность"
                  note={card.difficulty === null ? undefined : card.difficultyInTest ? "настроено в тесте" : "из вопроса"}
                >
                  {card.difficulty === null
                    ? <Text variant="body-s" tone="muted">не задана</Text>
                    : <Text variant="body-s">{card.difficulty}</Text>}
                </Field>
              </>
            )}
          </Grid>
          {/* Э4а: у развёрнутого ответа эталона нет — поле с прочерком не показывается. */}
          {card.correctAnswer && card.correctAnswer !== "—" ? (
            <Field label="Верный ответ"><Text variant="body-s">{card.correctAnswer}</Text></Field>
          ) : null}
        </Stack>
      </CardBody>
    </Card>
  );
}

/** Свойства блока «Этот вопрос в других тестах». */
export interface OtherTestsCardProps {
  rows: OtherTestView[];
  /** Окно экспозиции инстанса в месяцах — для подзаголовка. */
  windowMonths: number;
  onOpen: (testId: string) => void;
}

/**
 * «Этот вопрос в других тестах».
 *
 * @param props - строки, окно экспозиции, переход на уровень вопроса в другом тесте
 * @returns карточка со списком тестов
 */
export function OtherTestsCard({ rows, windowMonths, onOpen }: OtherTestsCardProps) {
  const columns = [
    {
      key: "title",
      header: "Тест",
      render: (row: OtherTestView) => <span className="ou-grid__cell-strong tb-cell-wrap">{row.title}</span>,
    },
    {
      key: "observations",
      header: "Наблюдений",
      align: "center" as const,
      numeric: true,
      render: (row: OtherTestView) => row.observations,
    },
    {
      key: "difficulty",
      header: "Трудность",
      align: "center" as const,
      numeric: true,
      render: (row: OtherTestView) => (row.difficulty === null
        ? <Text variant="body-s" tone="muted">мало данных</Text>
        : num(row.difficulty)),
    },
    {
      key: "open",
      header: "",
      width: "4%",
      render: (row: OtherTestView) => (
        <IconButton
          variant="ghost"
          size="s"
          aria-label={`Вопрос в тесте «${row.title}»`}
          title="Вопрос в этом тесте"
          icon={<ChevronRight size={14} />}
          onClick={event => { event.stopPropagation(); onOpen(row.testId); }}
        />
      ),
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Этот вопрос в других тестах"
        subtitle={`Тесты, где вопрос выдавался за последние ${windowMonths} мес.`}
      />
      <CardBody>
        <DataGrid
          columns={columns}
          rows={rows}
          rowKey={row => row.testId}
          onRowClick={row => onOpen(row.testId)}
          emptyMessage="В других тестах вопрос за это время не выдавался"
        />
      </CardBody>
    </Card>
  );
}

/**
 * @module features/analytics/test/exposure-profile
 * @description PRD-56 FR-20: профиль экспозиции банка (PRD-55) — по каждой теме теста.
 *
 * Список, а не столбцы: у столбца подпись помещается только номером, а «1, 2, 3…» читателю не
 * говорит ничего — ему нужны сами задания. В одном списке видно и выработанную голову банка, и
 * мёртвый хвост.
 *
 * Темы НЕ складываются в один список: у разных тем разные квоты выдачи, и вместе их доли
 * несопоставимы. Но и прятать темы за выбором незачем (замечание владельца 2026-10-04):
 * несопоставимость решается группировкой — блок на тему, у блока свой заголовок с банком и
 * способом выдачи, — а переключатель только заставлял прокликивать темы по одной.
 *
 * Блок темы сворачивается, у карточки — «Развернуть все / Свернуть все» (замечание владельца
 * 2026-10-04): банк в полтора десятка вопросов на тему превращает несколько тем в стену строк.
 * Разметка и поведение — общие `FoldSection` / `FoldAllButtons` редактора, а не своя копия.
 */
import { Ban } from "lucide-react";
import {
  Card,
  CardBody,
  CardHeader,
  DataGrid,
  ProgressBar,
  Stack,
  Text,
} from "@skillum/ui-kit";

import { pluralize } from "@/lib/i18n";
import { QuestionTypeIcon } from "@/features/tests/editor/sections/question-type-icon";
import {
  FoldAllButtons,
  FoldSection,
  useSectionFold,
} from "@/features/tests/editor/sections/section-fold";
import type { QuestionType } from "@shared/questions/question-type";

import { percent } from "../format";

export interface ExposureRowView {
  questionId: string;
  prompt: string;
  type: string;
  tags: string[];
  deliveredCount: number;
  sharePercent: number | null;
  excluded: boolean;
}

/** Как раздел выдаёт вопросы (`server/services/analytics/delivery-stats`). */
export type ExposureDrawMode = "quota" | "all" | "forms" | "adaptive";

export interface ExposureProfileView {
  topicId: string;
  topicName: string;
  bankSize: number;
  /** Без поля — по `drawCount`: ответ сервера до 2026-10-04. */
  drawMode?: ExposureDrawMode;
  drawCount: number | null;
  attemptsInWindow: number;
  rows: ExposureRowView[];
  neverDelivered: number;
}

export interface ExposureProfileProps {
  /** По профилю на раздел теста, в порядке разделов. */
  profiles: ExposureProfileView[];
}

/**
 * Что выдаётся на прохождение. Квота есть только у раздела со случайной выборкой: вариант
 * раздела и уровни адаптива её не читают, и печатать там `draw_count` значит печатать ноль.
 */
function drawPhrase(profile: ExposureProfileView): string {
  const mode = profile.drawMode ?? (profile.drawCount === null ? "all" : "quota");
  if (mode === "adaptive") return "вопросы выбирает уровень адаптивного прогона";
  if (mode === "forms") return "выдаётся вариант раздела";
  if (mode === "all" || profile.drawCount === null) return "выдаётся весь банк";
  return `на прохождение выдаётся ${profile.drawCount}`;
}

/*
 * Доли колонок при фиксированной раскладке (`tb-psy-grid`, как у таблиц вопросов): при раскладке
 * по содержимому формулировка в одну строку выталкивала «Долю» и «Выдан раз» за край блока.
 */
const columns = [
  {
    key: "question",
    header: "Вопрос",
    frozen: true,
    width: "56%",
    render: (row: ExposureRowView) => (
      <Stack gap={1}>
        <Stack direction="row" gap={2} align="center">
          <QuestionTypeIcon type={row.type as QuestionType} />
          {/* Та же метка, что в таблице заданий: состояние выдачи — не ярлык содержания. */}
          {row.excluded && (
            <span
              className="tb-qscoring__qtype"
              title="Исключён из выдачи — в новые прохождения не попадает"
              aria-label="Исключён из выдачи"
            >
              <Ban size={16} color="var(--ou-error-default)" aria-hidden="true" />
            </span>
          )}
          <span className="ou-grid__cell-strong">{row.prompt}</span>
        </Stack>
        {row.tags.length > 0 && (
          <Text variant="body-xs" tone="muted">{row.tags.join(" · ")}</Text>
        )}
      </Stack>
    ),
  },
  {
    key: "bar",
    align: "center" as const,
    width: "24%",
    header: "Доля прохождений с этим вопросом",
    render: (row: ExposureRowView) => (
      <ProgressBar value={row.sharePercent ?? 0} size="s" hideHeader />
    ),
  },
  {
    key: "share",
    header: "Доля",
    align: "center" as const,
    width: "10%",
    numeric: true,
    // Прохождений за окно не было — доли нет, а не ноль.
    render: (row: ExposureRowView) => (row.sharePercent === null
      ? "—"
      : `${percent(row.sharePercent)}`),
  },
  {
    key: "count",
    header: "Выдан раз",
    align: "center" as const,
    width: "10%",
    numeric: true,
    render: (row: ExposureRowView) => row.deliveredCount,
  },
];

/** Тело блока темы: способ выдачи, строки, свёрнутый хвост. Шапку с банком рисует `FoldSection`. */
function TopicBody({ profile }: { profile: ExposureProfileView }) {
  return (
    <Stack gap={3}>
      <Text variant="body-s" tone="muted">{drawPhrase(profile)}</Text>
      <DataGrid
        className="tb-psy-grid tb-qtable"
        columns={columns}
        rows={profile.rows}
        rowKey={row => row.questionId}
        emptyMessage="Ни один вопрос темы пока не выдавался"
      />
      {/* Хвост свёрнут в одну строку: перечислять невыданные задания поштучно незачем,
          а их ЧИСЛО и есть ответ на «сколько банка простаивает». */}
      {profile.neverDelivered > 0 && (
        <Text variant="body-s" tone="muted">
          Ещё {profile.neverDelivered}{" "}
          {pluralize(profile.neverDelivered, "вопрос не выдавался", "вопроса не выдавались", "вопросов не выдавались")}{" "}
          ни разу
        </Text>
      )}
    </Stack>
  );
}

/** Ключ блока: тема может стоять в двух разделах, поэтому — с номером раздела. */
const keyOf = (profile: ExposureProfileView, index: number) => `${profile.topicId}-${index}`;

export function ExposureProfile({ profiles }: ExposureProfileProps) {
  const fold = useSectionFold(profiles.map(keyOf));
  // Окно наблюдения общее для теста, поэтому число прохождений — одно, в шапке карточки.
  const attempts = profiles[0]?.attemptsInWindow ?? 0;
  const subtitle = profiles.length === 0
    ? "У теста нет разделов: банк показывать не по чему"
    : `${attempts} ${pluralize(attempts, "прохождение", "прохождения", "прохождений")} за окно наблюдения`;

  return (
    <Card>
      <CardHeader
        title="Профиль экспозиции банка"
        subtitle={subtitle}
        // Одна тема сворачивать нечего: пара кнопок — только когда блоков несколько.
        trail={profiles.length > 1 ? <FoldAllButtons fold={fold} testIdPrefix="exposure" /> : undefined}
      />
      {profiles.length > 0 && (
        <CardBody>
          {/* Секции тем — в рамках, как в редакторе: между ними шаг 4 × 4 px, как у FormSection. */}
          <Stack gap={4}>
            {profiles.map((profile, index) => (
              <FoldSection
                key={keyOf(profile, index)}
                open={fold.isOpen(keyOf(profile, index))}
                onToggle={() => fold.toggle(keyOf(profile, index))}
                name={profile.topicName}
                tag={`${profile.bankSize} ${pluralize(profile.bankSize, "вопрос", "вопроса", "вопросов")} в банке`}
                testId={`exposure-topic-${index}`}
              >
                <TopicBody profile={profile} />
              </FoldSection>
            ))}
          </Stack>
        </CardBody>
      )}
    </Card>
  );
}

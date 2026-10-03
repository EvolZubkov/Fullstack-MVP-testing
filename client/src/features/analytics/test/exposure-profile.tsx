/**
 * @module features/analytics/test/exposure-profile
 * @description PRD-56 FR-20: профиль экспозиции банка темы (PRD-55).
 *
 * Список, а не столбцы: у столбца подпись помещается только номером, а «1, 2, 3…» читателю не
 * говорит ничего — ему нужны сами задания. В одном списке видно и выработанную голову банка, и
 * мёртвый хвост.
 *
 * Профиль строится по банку ОДНОЙ темы: у разных тем разные квоты выдачи, и вместе они
 * несопоставимы. Тема выбирается явно — угадывать её по порядку разделов значит показывать
 * читателю не то, о чём он спрашивал.
 */
import { Ban } from "lucide-react";
import {
  Card,
  CardBody,
  CardHeader,
  DataGrid,
  ProgressBar,
  Select,
  Stack,
  Text,
} from "@skillum/ui-kit";

import { pluralize } from "@/lib/i18n";
import { QuestionTypeIcon } from "@/features/tests/editor/sections/question-type-icon";
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

export interface ExposureProfileView {
  topicId: string;
  topicName: string;
  bankSize: number;
  drawCount: number | null;
  attemptsInWindow: number;
  rows: ExposureRowView[];
  neverDelivered: number;
}

export interface ExposureProfileProps {
  profile: ExposureProfileView | null;
  topics: Array<{ topicId: string; topicName: string }>;
  onTopicChange: (topicId: string) => void;
}

export function ExposureProfile({ profile, topics, onTopicChange }: ExposureProfileProps) {
  const columns = [
    {
      key: "question",
      header: "Вопрос",
      frozen: true,
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
      header: "Доля прохождений с этим вопросом",
      render: (row: ExposureRowView) => (
        <ProgressBar value={row.sharePercent ?? 0} size="s" hideHeader />
      ),
    },
    {
      key: "share",
      header: "Доля",
      align: "center" as const,
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
      numeric: true,
      render: (row: ExposureRowView) => row.deliveredCount,
    },
  ];

  const subtitle = profile === null
    ? "У теста нет разделов: банк показывать не по чему"
    : `${profile.bankSize} ${pluralize(profile.bankSize, "вопрос", "вопроса", "вопросов")} в банке, на прохождение выдаётся ${profile.drawCount ?? "весь банк"}`
      + ` · ${profile.attemptsInWindow} ${pluralize(profile.attemptsInWindow, "прохождение", "прохождения", "прохождений")} за окно наблюдения`;

  return (
    <Card>
      <CardHeader
        title="Профиль экспозиции банка"
        subtitle={subtitle}
        trail={topics.length > 0 && (
          <Select
            size="s"
            // Подпись ВИДИМАЯ: доступным именем кнопки-триггера в ДС служит выбранное
            // ЗНАЧЕНИЕ, поэтому невидимый `aria-label` либо не объявится вовсе, либо
            // перекроет значение — и тогда читатель не услышит, какая тема выбрана.
            label="Тема"
            value={profile?.topicId ?? topics[0]?.topicId}
            onChange={onTopicChange}
            options={topics.map(topic => ({ value: topic.topicId, label: topic.topicName }))}
          />
        )}
      />
      <CardBody>
        {profile === null ? (
          <Text variant="body-s" tone="muted">Банк не выбран.</Text>
        ) : (
          <Stack gap={3}>
            <DataGrid
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
        )}
      </CardBody>
    </Card>
  );
}

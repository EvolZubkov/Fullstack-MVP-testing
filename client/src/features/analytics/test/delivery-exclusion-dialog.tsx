/**
 * @module features/analytics/test/delivery-exclusion-dialog
 * @description PRD-56 FR-17a, FR-17b: окно подтверждения «Исключить вопрос из выдачи?».
 *
 * Одно окно на две таблицы — «Вопросы» и «Качество вопросов». Исключают вопрос из обеих, и два
 * окна с разными словами и разной проверкой последствий разошлись бы при первой же правке.
 *
 * Окно называет последствия числами, и спрашивает их у сервера при открытии: считать остаток
 * пула на клиенте значило бы завести вторую копию правил выдачи. Невыполнимая выдача ЗАПРЕЩАЕТ
 * действие, а не сопровождает его предупреждением: тест, который нельзя собрать, ломается у
 * участника на старте попытки.
 *
 * Состав окна — по эскизу `prd56-test-analytics.html` (состояние items-exclude, план сверки 5.8):
 * что станет с вопросом, какой вопрос и где он, что сохранится и сколько останется в теме, и
 * когда исключение подействует.
 */
import { useEffect, useState } from "react";

import { Banner, Button, ModalDialog, Stack, Text } from "@skillum/ui-kit";

import { pluralize } from "@/lib/i18n";

/** Почему выдачу собрать нельзя — находка проверки выполнимости. */
interface DeliveryIssue {
  kind: string;
  tag?: string;
  requested?: number;
  available?: number;
  required?: number;
}

/** Последствия исключения — то, что отдаёт `GET .../delivery-impact` (FR-17b). */
interface DeliveryImpact {
  topicName: string;
  remaining: number;
  drawCount: number;
  allowed: boolean;
  findings?: Array<{ topicName: string; issues: DeliveryIssue[] }>;
  /** Дата последней публикации; `null` — тест не публиковался, и исключение действует сразу. */
  publishedAt?: string | null;
}

/** Вопрос, который собираются исключить. */
export interface ExclusionTarget {
  questionId: string;
  /** Текст вопроса: автор должен видеть, ЧТО он исключает. */
  prompt: string;
  /**
   * Где вопрос и чем он заметен — строка под текстом (эскиз: «Право и комплаенс · Антикоррупция ·
   * 82 % показов при 41 % верных»). Собирает таблица, которая открыла окно: числа у неё свои.
   */
  caption?: string;
}

export interface DeliveryExclusionDialogProps {
  /** Вопрос, для которого открыто окно; `null` — окно закрыто. */
  target: ExclusionTarget | null;
  /** Тест, у которого спрашиваются последствия исключения. */
  testId?: string;
  onClose: () => void;
  /** Исключение подтверждено. */
  onConfirm: (questionId: string) => void;
}

/**
 * Причина отказа словами.
 *
 * «Выдачу собрать нельзя» без причины оставляет автора гадать, что чинить: не хватает вопросов
 * вообще или проседает квота одного тега — это разные починки.
 */
function issueText(issue: DeliveryIssue): string {
  if (issue.kind === "quota_shortfall") {
    return `Подтема «${issue.tag}»: нужно ${issue.requested}, останется ${issue.available}`;
  }
  if (issue.kind === "pool_shortfall") {
    return `Вопросов в теме: нужно ${issue.required}, останется ${issue.available}`;
  }
  return "Выдача этого раздела перестанет собираться";
}

/** Дата «дд.мм.гггг» — так её пишет эскиз. */
function dateText(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Окно подтверждения исключения вопроса из выдачи.
 *
 * @param props вопрос, тест и обработчики
 * @returns модальное окно дизайн-системы
 */
export function DeliveryExclusionDialog({ target, testId, onClose, onConfirm }: DeliveryExclusionDialogProps) {
  const [impact, setImpact] = useState<DeliveryImpact | null>(null);

  // Последствия спрашиваются у сервера при открытии окна: считать остаток пула на клиенте
  // значило бы завести вторую копию правил выдачи, которая однажды разойдётся с первой.
  useEffect(() => {
    if (!target) {
      setImpact(null);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const response = await fetch(
          `/api/analytics/tests/${testId}/questions/${target.questionId}/delivery-impact`,
          { credentials: "include" },
        );
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json() as DeliveryImpact;
        if (alive) setImpact(data);
      } catch {
        // Вслепую окно подтверждения не спрашивает: без последствий кнопка остаётся
        // выключенной, а читателю сказано, что считаем.
        if (alive) setImpact(null);
      }
    })();
    return () => { alive = false; };
  }, [target, testId]);

  return (
    <ModalDialog
      open={target !== null}
      onClose={onClose}
      size="s"
      title="Исключить вопрос из выдачи?"
      description="Вопрос остаётся в теме и в банке, но перестаёт попадать в новые прохождения этого теста"
      footer={
        <>
          <Button variant="ghost" size="m" onClick={onClose}>Отмена</Button>
          {/* Тон удаления, как в эскизе: действие убирает вопрос из выдачи всем будущим участникам. */}
          <Button
            variant="destructive"
            size="m"
            disabled={!impact?.allowed}
            onClick={() => {
              if (target) onConfirm(target.questionId);
              onClose();
            }}
          >
            Исключить из выдачи
          </Button>
        </>
      }
    >
      <Stack gap={4}>
        <Stack gap={1}>
          <Text variant="body-m" weight="medium">{target?.prompt}</Text>
          {target?.caption ? <Text variant="body-xs" tone="muted">{target.caption}</Text> : null}
        </Stack>
        {impact === null ? (
          <Text tone="muted">Считаем, сколько вопросов останется в теме…</Text>
        ) : impact.allowed ? (
          <Banner
            variant="subtle"
            tone="info"
            size="sm"
            description={`Собранные ответы и статистика по вопросу сохраняются — из аналитики он не пропадёт. В теме останется ${impact.remaining} ${pluralize(impact.remaining, "вопрос", "вопроса", "вопросов")} при квоте ${impact.drawCount} на прохождение: выдача выполнима.`}
          />
        ) : (
          <Banner
            variant="subtle"
            tone="error"
            size="sm"
            title="Выдачу собрать будет нельзя"
            description={[
              ...(impact.findings ?? []).flatMap(finding => finding.issues).map(issueText),
              "Уменьшите число выдаваемых вопросов или добавьте новые в тему.",
            ].join(". ").replace(/\.\./g, ".")}
          />
        )}
        {impact?.publishedAt ? (
          <Banner
            variant="subtle"
            tone="warning"
            size="sm"
            title="Подействует после новой публикации"
            description={`Тест опубликован ${dateText(impact.publishedAt)}. Прохождения идут по опубликованной версии, где вопрос ещё есть, — и веб, и выгруженный пакет SCORM.`}
          />
        ) : null}
      </Stack>
    </ModalDialog>
  );
}

/**
 * @module features/templates/upload-outcome
 * @description Итог загрузки архива шаблона (PRD-3 §4.1–4.2): идёт проверка, архив не загрузился,
 * принят черновиком (возможно, с предупреждениями) или отвергнут с блокирующими ошибками.
 *
 * Общий для окна «Загрузка шаблона» в реестре шаблонов и шага шаблона в разделе «Импорт» (Э6
 * UX-аудита, «единая точка импорта»): разметка перенесена из окна без изменений.
 */
import { Banner } from "@skillum/ui-kit";
import type { UploadOutcome } from "./use-admin-templates";
import { IssueList } from "./issue-list";

export interface TemplateUploadOutcomeProps {
  /** Архив ещё распаковывается и проверяется. */
  pending: boolean;
  /** Запрос не удался вовсе (сеть, сервер) — до разбора дело не дошло. */
  failure?: string | null;
  /** Ответ сервера о разобранном архиве. */
  outcome: UploadOutcome | null;
}

export function TemplateUploadOutcome({ pending, failure, outcome }: TemplateUploadOutcomeProps) {
  const accepted = outcome?.ok && outcome.template;
  const rejected = outcome && !outcome.ok;
  const warnings = outcome?.report?.warnings ?? [];

  return (
    <>
      {pending && (
        <Banner
          tone="info"
          title="Идёт распаковка и проверка комплектности…"
          description="Архив проверяется в памяти; ничего не сохраняется до прохождения проверки."
        />
      )}

      {failure && !outcome && (
        <Banner tone="error" title="Не удалось загрузить архив" description={failure} />
      )}

      {accepted && (
        <Banner
          tone={warnings.length > 0 ? "warning" : "success"}
          title={
            warnings.length > 0
              ? "Архив принят с предупреждениями — создан черновик"
              : "Комплектность в порядке — создан черновик"
          }
          description="Запустите проверку работоспособности, чтобы шаблон можно было активировать."
        />
      )}

      {accepted && warnings.length > 0 && (
        <div>
          <div className="tpl-detail-section-title">Предупреждения ({warnings.length})</div>
          <IssueList issues={warnings} tone="warning" />
        </div>
      )}

      {rejected && (
        <>
          <Banner
            tone="error"
            title="Шаблон не загружен — есть блокирующие ошибки"
            description={outcome?.error ?? "Устраните ошибки и загрузите архив повторно."}
          />
          {outcome?.report?.blocking && outcome.report.blocking.length > 0 && (
            <div>
              <div className="tpl-detail-section-title">
                Блокирующие ошибки ({outcome.report.blocking.length})
              </div>
              <IssueList issues={outcome.report.blocking} tone="error" />
            </div>
          )}
        </>
      )}
    </>
  );
}

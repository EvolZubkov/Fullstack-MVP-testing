/**
 * @module features/templates/details-modal
 * @description Read-only details for a template (PRD-3 §3.3): identity, lifecycle
 * status, completeness + health badges, usage count, declared screen layouts,
 * template params and the smoke-test journal. Opens the preview/check modal via
 * the footer action.
 */
import { Button, ModalDialog, Tag } from "@universityrt/ui-kit";
import { Eye } from "lucide-react";
import { useTemplateDetails, type AdminTemplate } from "./use-admin-templates";
import { statusBadge, validationBadge, smokeBadge } from "./template-status";

export interface DetailsModalProps {
  open: boolean;
  onClose: () => void;
  template: AdminTemplate;
  onOpenPreview: () => void;
}

const LAYOUT_LABELS: Record<string, string> = {
  shell: "оболочка",
  start: "старт",
  content: "контент",
  question: "вопрос",
  results: "результаты",
  "results.adaptive": "результаты (адаптивные)",
  "system.blocked": "доступ ограничен",
  "system.transition": "переход",
};

function smokeJournal(template: AdminTemplate): string {
  const report = template.smokeTestJson;
  if (!report) return "Проверка работоспособности ещё не запускалась.";
  return report.routes
    .map((r) => {
      const tag = r.status === "pass" ? "[OK]" : r.status === "warn" ? "[WARN]" : "[FAIL]";
      const notes = [...r.errors, ...r.warnings];
      // Prefer the screen label so several render variants sharing one route
      // (e.g. two content.info) read distinctly in the journal.
      const name = r.label ?? r.route;
      return `${tag} ${name}${notes.length ? ": " + notes.join("; ") : ""}`;
    })
    .join("\n");
}

export function DetailsModal({ open, onClose, template, onOpenPreview }: DetailsModalProps) {
  const details = useTemplateDetails(template.id, open);
  const usageCount = details.data?.usageCount;

  const status = statusBadge(template.status);
  const completeness = validationBadge(template.validationJson);
  const health = smokeBadge(template.smokeTestJson);

  const layoutKeys = Object.keys(template.manifest.layouts ?? {});
  const params = template.manifest.params ?? [];

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="l"
      className="tpl-details-modal"
      title={`${template.name} — детали`}
      description={`${template.sourceType === "builtin" ? "Встроенный" : "Загруженный"} шаблон · версия ${template.version}`}
      footer={
        <div className="tpl-check-foot">
          <Button variant="secondary" size="m" leadingIcon={<Eye size={14} />} onClick={onOpenPreview}>
            Предпросмотр и проверка
          </Button>
          <Button variant="ghost" size="m" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      }
    >
      <dl className="tpl-detail-grid">
        <dt>Идентификатор</dt>
        <dd>
          <code>{template.id}</code>
        </dd>
        <dt>Версия / версия API</dt>
        <dd>
          {template.version} / {template.templateApiVersion}
        </dd>
        <dt>Статус</dt>
        <dd>
          <Tag tone={status.tone} size="s">
            {status.label}
          </Tag>
        </dd>
        <dt>Комплектность</dt>
        <dd>
          <Tag tone={completeness.tone} size="s">
            {completeness.label}
          </Tag>
        </dd>
        <dt>Работоспособность</dt>
        <dd>
          <Tag tone={health.tone} size="s">
            {health.label}
          </Tag>
        </dd>
        <dt>Используется тестами</dt>
        <dd>{usageCount == null ? "…" : usageCount}</dd>
      </dl>

      <div className="tpl-detail-section-title">Макеты экранов ({layoutKeys.length})</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--ou-space-2)" }}>
        {layoutKeys.map((k) => (
          <Tag key={k} tone="neutral" variant="outline" size="s">
            {LAYOUT_LABELS[k] ?? k}
          </Tag>
        ))}
      </div>

      <div className="tpl-detail-section-title">Параметры шаблона ({params.length})</div>
      {params.length > 0 ? (
        <div className="tpl-detail-code">
          {params.map((p) => `${p.label ?? p.key}${p.type ? ` (${p.type})` : ""}`).join(" · ")}
        </div>
      ) : (
        <div className="tpl-upload-hint">Параметры не объявлены.</div>
      )}

      <div className="tpl-detail-section-title">Журнал проверки работоспособности</div>
      <div className="tpl-detail-code">{smokeJournal(template)}</div>
    </ModalDialog>
  );
}

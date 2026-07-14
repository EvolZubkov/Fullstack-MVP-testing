/**
 * @module features/content-protection/content-impact-dialog
 *
 * PRD-15 block A content-impact dialog (T-12; wireframe
 * docs/wireframes/prd15-content-in-use.html). Renders three shapes from one
 * component, driven by `mode`:
 *
 * - `block`   — the operation is blocked by published dependents (server 409
 *   `content_in_use`). Author sees only «Понятно»; an administrator also gets
 *   «Удалить принудительно» (force override).
 * - `warn`    — no block, but draft/`drawAll` dependents are affected; a
 *   confirmation before the operation proceeds.
 * - `publish` — a test cannot be published (server 409 `publish_infeasible`):
 *   per-topic findings, with a shortcut into the test structure editor.
 *
 * Built on the DS `ModalDialog` + `Tag`/`Banner`/`Button`; the dependent-test
 * list is a token-only composition (no DS list component), matching the
 * approved wireframe.
 */
import { AlertTriangle } from "lucide-react";
import { Banner, Button, ModalDialog, Tag, type Tone, type ButtonVariant } from "@universityrt/ui-kit";
import type { TestFeasibility, PublishCheckFinding } from "./types";
import { describeIssue } from "./issue-text";
import "./content-impact-dialog.css";

export type ContentImpactMode = "block" | "warn" | "publish";

export interface ContentImpactDialogProps {
  open: boolean;
  mode: ContentImpactMode;
  title: string;
  description?: string;
  /** Dependent tests (block/warn modes). */
  tests?: TestFeasibility[];
  /** Per-topic findings (publish mode). */
  findings?: PublishCheckFinding[];
  /** Current user is an administrator/superadmin → may force a blocked op. */
  canForce?: boolean;
  /** Label of the warn-mode confirm action, e.g. «Удалить вопрос». */
  confirmLabel?: string;
  /** Variant of the warn-mode confirm button (delete → destructive, edit → primary). */
  confirmVariant?: ButtonVariant;
  pending?: boolean;
  onClose: () => void;
  /** Confirm the warn-mode operation. */
  onConfirm?: () => void;
  /** Force the blocked operation (admin only). */
  onForce?: () => void;
  /** Open the test structure editor (publish mode). */
  onOpenStructure?: () => void;
  /** Current user id — to label "Владелец: вы" on owned dependents. */
  currentUserId?: string;
}

/** Map a test status to a DS Tag tone, consistent with the tests list. */
function statusTone(status?: string): Tone {
  return status === "published" ? "success" : "neutral";
}

function statusLabel(status?: string): string {
  if (status === "published") return "Опубликован";
  if (status === "archived") return "В архиве";
  return "Черновик";
}

function DependentItem({ test, currentUserId }: { test: TestFeasibility; currentUserId?: string }) {
  const owner =
    test.ownerId && currentUserId && test.ownerId === currentUserId
      ? "Владелец: вы"
      : test.ownerId
        ? "Владелец теста"
        : null;
  return (
    <li className="cp-dep" role="listitem">
      <div className="cp-dep__head">
        <span className="cp-dep__title">{test.title ?? test.testId}</span>
        <Tag tone={statusTone(test.status)} size="s">
          {statusLabel(test.status)}
        </Tag>
        {owner && <span className="cp-dep__owner">{owner}</span>}
      </div>
      <ul className="cp-dep__reasons">
        {test.issues.map((issue, i) => (
          <li key={i}>{describeIssue(issue)}</li>
        ))}
      </ul>
    </li>
  );
}

export function ContentImpactDialog({
  open,
  mode,
  title,
  description,
  tests = [],
  findings = [],
  canForce = false,
  confirmLabel = "Продолжить",
  confirmVariant = "destructive",
  pending,
  onClose,
  onConfirm,
  onForce,
  onOpenStructure,
  currentUserId,
}: ContentImpactDialogProps) {
  const footer = (() => {
    if (mode === "warn") {
      return (
        <div className="cp-foot">
          <Button variant="ghost" size="m" onClick={onClose} disabled={pending}>
            Отмена
          </Button>
          <Button variant={confirmVariant} size="m" onClick={onConfirm} loading={pending}>
            {confirmLabel}
          </Button>
        </div>
      );
    }
    if (mode === "publish") {
      return (
        <div className="cp-foot">
          <Button variant="ghost" size="m" onClick={onClose}>
            Закрыть
          </Button>
          {onOpenStructure && (
            <Button variant="primary" size="m" onClick={onOpenStructure}>
              Открыть структуру теста
            </Button>
          )}
        </div>
      );
    }
    // block mode
    if (canForce && onForce) {
      return (
        <div className="cp-foot cp-foot--between">
          <Button variant="destructive" size="m" onClick={onForce} loading={pending}>
            Удалить принудительно
          </Button>
          <Button variant="ghost" size="m" onClick={onClose} disabled={pending}>
            Отмена
          </Button>
        </div>
      );
    }
    return (
      <div className="cp-foot">
        <Button variant="primary" size="m" onClick={onClose}>
          Понятно
        </Button>
      </div>
    );
  })();

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size={mode === "warn" || mode === "publish" ? "m" : "l"}
      icon={<AlertTriangle size={20} />}
      iconTone={mode === "warn" ? "warning" : "danger"}
      title={title}
      description={description}
      closeOnBackdrop={!pending}
      footer={footer}
    >
      {mode === "publish" ? (
        <ul className="cp-dep-list" role="list" aria-label="Темы с невыполнимой выдачей">
          {findings.map((f) => (
            <li className="cp-dep" role="listitem" key={f.topicId}>
              <div className="cp-dep__head">
                <span className="cp-dep__title">Тема «{f.topicName}»</span>
              </div>
              <ul className="cp-dep__reasons">
                {f.issues.map((issue, i) => (
                  <li key={i}>{describeIssue(issue)}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="cp-dep-list" role="list" aria-label="Затронутые тесты">
          {tests.map((t) => (
            <DependentItem key={t.testId} test={t} currentUserId={currentUserId} />
          ))}
        </ul>
      )}

      {mode === "block" && (
        <Banner
          tone={canForce ? "warning" : "info"}
          title={canForce ? "Принудительное удаление" : "Как разблокировать"}
          description={
            canForce
              ? "Перечисленные тесты начнут выдавать меньше вопросов или перестанут работать; вклады в шкалы и привязанные страницы будут удалены без возможности восстановления. Действие записывается в журнал."
              : "Исключите контент из перечисленных тестов (или снимите их с публикации) и повторите операцию. Принудительное удаление доступно администратору."
          }
        />
      )}
      {mode === "publish" && (
        <Banner
          tone="info"
          description="Уменьшите объём выдачи в настройках секций или добавьте вопросы в перечисленные темы, затем повторите публикацию."
        />
      )}
    </ModalDialog>
  );
}

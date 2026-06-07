/**
 * @module features/templates/confirm-dialog
 * @description Reusable confirmation dialog for the template lifecycle actions
 * (PRD-3 §5.3–5.4): deactivate (primary + cascade warning), delete (destructive),
 * and delete-blocked (confirm disabled + explanation). Built on the DS
 * `ModalDialog`; the optional banner carries the cascade/usage notice.
 */
import { Banner, Button, ModalDialog, type ButtonVariant, type BannerTone } from "@universityrt/ui-kit";

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  confirmIcon?: React.ReactNode;
  onConfirm: () => void;
  pending?: boolean;
  /** Disable confirm (e.g. delete blocked by usage). */
  confirmDisabled?: boolean;
  banner?: { tone: BannerTone; title: string; description?: string };
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  confirmVariant = "primary",
  confirmIcon,
  onConfirm,
  pending,
  confirmDisabled,
  banner,
}: ConfirmDialogProps) {
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="s"
      className="tpl-confirm-modal"
      title={title}
      description={description}
      closeOnBackdrop={!pending}
      footer={
        <div className="tpl-check-foot__actions" style={{ marginLeft: "auto" }}>
          <Button variant="ghost" size="m" onClick={onClose} disabled={pending}>
            Отмена
          </Button>
          <Button
            variant={confirmVariant}
            size="m"
            leadingIcon={confirmIcon}
            onClick={onConfirm}
            loading={pending}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {banner && <Banner tone={banner.tone} title={banner.title} description={banner.description} />}
    </ModalDialog>
  );
}

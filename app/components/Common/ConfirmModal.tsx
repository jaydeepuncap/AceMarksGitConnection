import React, { useId } from "react";
import { Button, Modal, Paragraph } from "../ui";

/**
 * Declarative confirm dialog. Replaces the imperative `showModal(id)` /
 * `hideModal(id)` pattern used by CategoryList / DesignsPage / FiltersPage.
 *
 * Usage:
 *   const [pendingDelete, setPendingDelete] = useState<Cat | null>(null);
 *   <ConfirmModal
 *     open={pendingDelete != null}
 *     heading="Delete category"
 *     message={`Delete "${pendingDelete?.title}"? This can't be undone.`}
 *     confirmLabel="Delete"
 *     destructive
 *     loading={deleting}
 *     onConfirm={() => deleteCategory(pendingDelete!.id)}
 *     onClose={() => setPendingDelete(null)}
 *   />
 */

type Props = {
  open: boolean;
  heading: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmModal({
  open,
  heading,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  loading = false,
  disabled = false,
  onConfirm,
  onClose,
}: Props) {
  const id = useId();
  return (
    <Modal
      id={id}
      open={open}
      heading={heading}
      size="small"
      onHide={onClose}
    >
      {typeof message === "string" ? <Paragraph>{message}</Paragraph> : message}
      {/* Actions go in the modal's footer slots, like every Polaris modal. */}
      <Button
        slot="primary-action"
        variant="primary"
        tone={destructive ? "critical" : "auto"}
        loading={loading}
        disabled={disabled}
        onClick={onConfirm}
      >
        {confirmLabel}
      </Button>
      <Button slot="secondary-actions" onClick={onClose} disabled={loading}>
        {cancelLabel}
      </Button>
    </Modal>
  );
}

export default ConfirmModal;

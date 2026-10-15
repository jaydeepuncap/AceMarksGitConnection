import React, { useId } from "react";
import { Box, Button, Modal, Paragraph, Stack } from "../ui";

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
      <Box padding="base">
        {typeof message === "string" ? <Paragraph>{message}</Paragraph> : message}
      </Box>
      <Stack
        direction="inline"
        gap="small"
        justifyContent="end"
        padding="base"
      >
        <Button onClick={onClose} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button
          variant="primary"
          tone={destructive ? "critical" : "auto"}
          loading={loading}
          disabled={disabled}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </Stack>
    </Modal>
  );
}

export default ConfirmModal;

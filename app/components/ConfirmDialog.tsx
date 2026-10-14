import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  id: string;
  open: boolean;
  heading: string;
  confirmLabel: string;
  tone?: 'critical' | 'auto';
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
}

/** Confirmation dialog (<s-modal>) for actions that change a theme. */
export function ConfirmDialog({ id, open, heading, confirmLabel, tone = 'auto', pending, onConfirm, onClose, children }: Props) {
  const ref = useRef<HTMLElementTagNameMap['s-modal']>(null);
  useEffect(() => {
    const modal = ref.current;
    if (!modal) return;
    // The methods exist once Polaris has upgraded the element.
    if (open) modal.showOverlay?.();
    else modal.hideOverlay?.();
  }, [open]);
  return (
    <s-modal ref={ref} id={id} heading={heading} onHide={onClose}>
      <s-stack gap="base">{children}</s-stack>
      <s-button slot="primary-action" variant="primary" tone={tone} loading={pending} onClick={onConfirm}>
        {confirmLabel}
      </s-button>
      <s-button slot="secondary-actions" disabled={pending} onClick={onClose}>
        Cancel
      </s-button>
    </s-modal>
  );
}

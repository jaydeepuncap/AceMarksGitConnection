/**
 * Small shared building blocks on top of Polaris web components, so pages
 * look and behave the same: cards, figures, labelled values and the
 * "branch → theme" title.
 */
import { Children, useEffect, useRef, type ReactNode } from 'react';
import { THEME_ROLE_BADGE, type Tone } from '../lib/format';
import type { ThemeRole } from '../lib/types';

/**
 * A bordered card whose sections are separated by dividers. With `onClick`
 * the WHOLE card is one clickable surface (pointer cursor and hover state) —
 * so it must not contain other buttons or links.
 */
export function Card({
  onClick,
  accessibilityLabel,
  children,
}: {
  onClick?: () => void;
  accessibilityLabel?: string;
  children: ReactNode;
}) {
  const sections = Children.toArray(children).filter(Boolean);
  const body = (
    <s-stack gap="none">
      {sections.map((section, i) => (
        <s-stack key={i} gap="none">
          {i > 0 && <s-divider />}
          {section}
        </s-stack>
      ))}
    </s-stack>
  );
  if (onClick) {
    return (
      <s-clickable
        onClick={onClick}
        accessibilityLabel={accessibilityLabel}
        border="base"
        borderRadius="large"
        background="base"
      >
        {body}
      </s-clickable>
    );
  }
  return (
    <s-box border="base" borderRadius="large" background="base">
      {body}
    </s-box>
  );
}

/** One section of a Card (header, body, footer). */
export function CardSection({ children, subdued = false }: { children: ReactNode; subdued?: boolean }) {
  return (
    <s-box padding="base" background={subdued ? 'subdued' : 'transparent'}>
      {children}
    </s-box>
  );
}

/** A labelled figure: "Updates waiting — 3". */
export function StatTile({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <s-box padding="base" border="base" borderRadius="base" background="base">
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        {children}
        {hint && <s-text color="subdued">{hint}</s-text>}
      </s-stack>
    </s-box>
  );
}

/** A label above its value, for detail panels inside cards. */
export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <s-stack gap="small-100">
      <s-text color="subdued">{label}</s-text>
      {children}
    </s-stack>
  );
}

/** "main → Live theme" with icons and the theme's role; `heading` makes it the larger card title. */
export function BranchThemeTitle({
  branch,
  themeName,
  role,
  themeMissing = false,
  heading = false,
}: {
  branch: string;
  themeName: string;
  role?: ThemeRole | null;
  themeMissing?: boolean;
  heading?: boolean;
}) {
  const badge = role ? THEME_ROLE_BADGE[role] : null;
  const name = (text: string) => (heading ? <s-heading>{text}</s-heading> : <s-text type="strong">{text}</s-text>);
  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      <s-icon type="git-branch" />
      {name(branch)}
      <s-icon type="arrow-right" />
      <s-icon type="theme" />
      {name(themeName)}
      {badge && <s-badge tone={badge.tone}>{badge.label}</s-badge>}
      {themeMissing && <s-badge tone="critical">Theme deleted</s-badge>}
    </s-stack>
  );
}

/** A status pill with a tone. */
export function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  return <s-badge tone={tone}>{label}</s-badge>;
}

/** Confirmation dialog for actions that change a mapping or a theme. */
export function ConfirmModal({
  id,
  open,
  heading,
  message,
  actionLabel,
  pending,
  onClose,
  onConfirm,
}: {
  id: string;
  open: boolean;
  heading: string;
  message: string;
  actionLabel: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLElementTagNameMap['s-modal']>(null);
  useEffect(() => {
    if (open) ref.current?.showOverlay?.();
    else ref.current?.hideOverlay?.();
  }, [open]);
  return (
    <s-modal ref={ref} id={id} heading={heading} onHide={onClose}>
      <s-paragraph>{message}</s-paragraph>
      <s-button slot="primary-action" variant="primary" tone="critical" loading={pending} onClick={onConfirm}>
        {actionLabel}
      </s-button>
      <s-button slot="secondary-actions" onClick={onClose}>
        Cancel
      </s-button>
    </s-modal>
  );
}

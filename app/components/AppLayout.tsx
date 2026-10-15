import type { ReactNode } from 'react';

export interface PageAction {
  content: string;
  onAction: () => void;
  loading?: boolean;
  disabled?: boolean;
  tone?: 'critical';
}

interface Props {
  title: string;
  subtitle?: string;
  primaryAction?: PageAction;
  secondaryActions?: PageAction[];
  /** Breadcrumb back to a parent page. */
  backAction?: { content: string; onAction: () => void };
  /** Banners rendered above the content (errors, warnings). */
  banners?: ReactNode;
  /** Page width: "large" for list and detail pages with wide cards and tables. */
  inlineSize?: 'small' | 'base' | 'large';
  children: ReactNode;
}

/**
 * Standard page frame built on <s-page>. Inside Shopify Admin, App Bridge
 * renders the page heading and the primary/secondary action slots in the
 * Admin title bar. App navigation is the <NavMenu> declared in App.tsx.
 */
export function AppLayout({
  title,
  subtitle,
  primaryAction,
  secondaryActions,
  backAction,
  banners,
  inlineSize = 'base',
  children,
}: Props) {
  return (
    <s-page heading={title} inlineSize={inlineSize}>
      {backAction && (
        <s-link
          slot="breadcrumb-actions"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            backAction.onAction();
          }}
        >
          {backAction.content}
        </s-link>
      )}
      {primaryAction && (
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={primaryAction.onAction}
          loading={primaryAction.loading}
          disabled={primaryAction.disabled}
          tone={primaryAction.tone}
        >
          {primaryAction.content}
        </s-button>
      )}
      {secondaryActions?.map((action) => (
        <s-button
          key={action.content}
          slot="secondary-actions"
          onClick={action.onAction}
          loading={action.loading}
          disabled={action.disabled}
          tone={action.tone}
        >
          {action.content}
        </s-button>
      ))}
      <s-stack gap="base">
        {subtitle && <s-text color="subdued">{subtitle}</s-text>}
        {banners}
        {children}
      </s-stack>
    </s-page>
  );
}

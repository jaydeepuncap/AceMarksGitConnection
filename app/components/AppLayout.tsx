import type { ReactNode } from 'react';
import { Page, Stack, Text } from './ui';

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
  /** Page width; defaults to the shared Page's width. */
  inlineSize?: 'small' | 'base' | 'large';
  children: ReactNode;
}

/**
 * Standard page frame, built on the shared <Page> (components/ui/page.jsx):
 * page heading, primary/secondary actions and breadcrumb (rendered by App
 * Bridge in the Admin title bar), the page width, and the help footer.
 * App navigation is the <NavMenu> declared in App.tsx.
 */
export function AppLayout({
  title,
  subtitle,
  primaryAction,
  secondaryActions,
  backAction,
  banners,
  inlineSize,
  children,
}: Props) {
  return (
    <Page
      heading={title}
      inlineSize={inlineSize}
      breadcrumbAction={
        backAction && {
          label: backAction.content,
          onClick: (event: Event) => {
            event.preventDefault();
            backAction.onAction();
          },
        }
      }
      primaryAction={
        primaryAction && {
          label: primaryAction.content,
          onClick: primaryAction.onAction,
          disabled: primaryAction.disabled,
          loading: primaryAction.loading,
        }
      }
      secondaryAction={secondaryActions?.map((action) => ({
        key: action.content,
        label: action.content,
        onClick: action.onAction,
        disabled: action.disabled || action.loading,
        tone: action.tone,
      }))}
    >
      <Stack gap="base">
        {subtitle && <Text color="subdued">{subtitle}</Text>}
        {banners}
        {children}
      </Stack>
    </Page>
  );
}

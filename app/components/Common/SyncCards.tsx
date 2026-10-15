import { Children, type ReactNode } from 'react';
import { Badge, Box, Clickable, Divider, Heading, Icon, Stack, Text } from '../ui';
import { THEME_ROLE_BADGE } from '../../lib/format';
import type { ThemeRole } from '../../lib/types';

/**
 * Cards and labelled values for the Git sync pages, built on the shared ui
 * wrappers (Polaris web components).
 */

/**
 * A bordered card whose sections are separated by dividers. With `onClick`
 * the WHOLE card is one clickable surface (pointer cursor and hover state),
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
    <Stack gap="none">
      {sections.map((section, i) => (
        <Stack key={i} gap="none">
          {i > 0 && <Divider />}
          {section}
        </Stack>
      ))}
    </Stack>
  );
  if (onClick) {
    return (
      <Clickable
        onClick={onClick}
        accessibilityLabel={accessibilityLabel}
        border="base"
        borderRadius="large"
        background="base"
        inlineSize="100%"
      >
        {body}
      </Clickable>
    );
  }
  return (
    <Box border="base" borderRadius="large" background="base">
      {body}
    </Box>
  );
}

/** One section of a Card (header, body, footer); `subdued` shades it. */
export function CardSection({ children, subdued = false }: { children: ReactNode; subdued?: boolean }) {
  return (
    <Box padding="base" background={subdued ? 'subdued' : 'transparent'}>
      {children}
    </Box>
  );
}

/** A labelled figure: "Updates waiting — 3". */
export function StatTile({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <Box padding="base" border="base" borderRadius="base" background="base">
      <Stack gap="small-200">
        <Text color="subdued">{label}</Text>
        {children}
        {hint && <Text color="subdued">{hint}</Text>}
      </Stack>
    </Box>
  );
}

/** A label above its value, for panels inside cards. */
export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack gap="small-100">
      <Text color="subdued">{label}</Text>
      {children}
    </Stack>
  );
}

/** "main → Live theme" with icons and the theme's role; `heading` makes it the (larger) card title. */
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
  const name = (text: string) => (heading ? <Heading>{text}</Heading> : <Text type="strong">{text}</Text>);
  return (
    <Stack direction="inline" gap="small-200" alignItems="center">
      <Icon type="git-branch" />
      {name(branch)}
      <Icon type="arrow-right" />
      <Icon type="theme" />
      {name(themeName)}
      {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
      {themeMissing && <Badge tone="critical">Theme deleted</Badge>}
    </Stack>
  );
}

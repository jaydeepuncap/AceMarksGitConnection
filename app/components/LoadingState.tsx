import { Page, Section, Spinner, Stack, Text } from './ui';
/** Page-level loading state built from Polaris web components. */
export function LoadingState({ title }: { title?: string }) {
  return (
    <Page heading={title}>
      <Section>
        <Stack direction="inline" gap="base" alignItems="center">
          <Spinner accessibilityLabel="Loading" size="large" />
          <Text color="subdued">Loading…</Text>
        </Stack>
      </Section>
    </Page>
  );
}

/** Inline loading indicator for a section. */
export function LoadingInline({ label = 'Loading…' }: { label?: string }) {
  return (
    <Stack direction="inline" gap="small-200" alignItems="center">
      <Spinner accessibilityLabel={label} />
      <Text color="subdued">{label}</Text>
    </Stack>
  );
}

/** Page-level loading state built from Polaris web components. */
export function LoadingState({ title }: { title?: string }) {
  return (
    <s-page heading={title}>
      <s-section>
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-spinner accessibilityLabel="Loading" size="large" />
          <s-text color="subdued">Loading…</s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}

/** Inline loading indicator for a section. */
export function LoadingInline({ label = 'Loading…' }: { label?: string }) {
  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      <s-spinner accessibilityLabel={label} />
      <s-text color="subdued">{label}</s-text>
    </s-stack>
  );
}

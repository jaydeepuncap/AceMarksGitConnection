import type { ShopifyTheme } from '../lib/types';

export function PublishedBadge({ theme }: { theme: Pick<ShopifyTheme, 'isLive'> | null }) {
  if (!theme) return <s-badge tone="critical">Missing</s-badge>;
  return theme.isLive ? (
    <s-badge tone="success" color="strong">
      Published
    </s-badge>
  ) : (
    <s-badge tone="neutral">Unpublished</s-badge>
  );
}

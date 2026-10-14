import { redirectTopLevel } from '../lib/app-bridge';
import { api } from '../lib/api-client';
import { useApiQuery } from '../lib/hooks';
import type { StoreSummary } from '../lib/types';

/**
 * Store name + selector. Each store runs its own copy of the app inside its own
 * Shopify Admin, so choosing another store opens the app there.
 */
export function StoreHeader({ store, subtitle }: { store: StoreSummary | null; subtitle?: string }) {
  const stores = useApiQuery(() => api.stores(), []);
  const others = (stores.data ?? []).filter((s) => !s.current);
  return (
    <s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="base">
      <s-stack gap="small-300">
        <s-heading>{store?.name ?? 'This store'}</s-heading>
        <s-text color="subdued">{subtitle ?? `Store: ${store?.shopDomain ?? ''}`}</s-text>
      </s-stack>
      {others.length > 0 && store && (
        <s-box inlineSize="220px">
          <s-select
            label="Store"
            value={store.shopDomain}
            onChange={(event) => {
              const target = (stores.data ?? []).find((s) => s.shopDomain === event.currentTarget.value);
              if (target && !target.current) redirectTopLevel(target.adminUrl);
            }}
          >
            {(stores.data ?? []).map((s) => (
              <s-option key={s.shopDomain} value={s.shopDomain} disabled={!s.installed}>
                {s.installed ? s.name : `${s.name} (not installed)`}
              </s-option>
            ))}
          </s-select>
        </s-box>
      )}
    </s-stack>
  );
}

/**
 * Resolve the storefront URL a list-page row should open. Two surfaces use
 * this (Categories, Diagrams), so the rules live here in one place.
 *
 * Two possible URL shapes per row:
 *   - Shopify Page URL — when the row's own `isPage="1"` flag is set and a
 *     pageHandle was stored. Always wins, because the merchant explicitly
 *     created that page for this content.
 *   - App-proxy URL — built from the merchant's settings template
 *     (categoryDetailsUrl / diagramDetailsUrl) by substituting the
 *     {...-handle-or-id} placeholder with the row's handle or numeric id.
 *
 * Diagrams without their own Shopify Page can't be resolved here: the
 * app-proxy URL template needs a category handle, which the diagram list
 * response doesn't carry. Callers should disable the "Open" affordance in
 * that case.
 */

export type StorefrontSettings = {
  categoryDetailsUrl?: string | null;
  diagramDetailsUrl?: string | null;
};

type CategoryRow = {
  id: number;
  handle?: string | null;
  isPage?: string | null;
  pageHandle?: string | null;
};

type DiagramRow = {
  id: number;
  isPage?: string | null;
  pageHandle?: string | null;
};

const DEFAULT_CATEGORY_URL = "/partsdiagram/{category-handle-or-id}";

function pageUrl(domain: string, pageHandle: string): string {
  return `https://${domain}/pages/${pageHandle}`;
}

function proxyUrl(
  domain: string,
  template: string,
  substitutions: Record<string, string>
): string {
  let path = template;
  for (const [token, value] of Object.entries(substitutions)) {
    path = path.replaceAll(`{${token}}`, value);
  }
  return `https://${domain}${path}`;
}

export function categoryStorefrontUrl(
  domain: string | undefined,
  row: CategoryRow,
  settings: StorefrontSettings | null | undefined
): string | null {
  if (!domain) return null;
  // 1. Shopify Page wins when the row has its own.
  if (row.isPage === "1" && row.pageHandle) {
    return pageUrl(domain, row.pageHandle);
  }
  // 2. Otherwise build the app-proxy URL from the merchant's template,
  //    substituting the category ID into the placeholder. ID (not handle)
  //    is used here because the proxy resolves both, and the ID is the
  //    canonical identifier — handles can be reassigned by the merchant
  //    in the future without breaking previously-opened tabs.
  const template = settings?.categoryDetailsUrl ?? DEFAULT_CATEGORY_URL;
  return proxyUrl(domain, template, { "category-handle-or-id": String(row.id) });
}

export function diagramStorefrontUrl(
  domain: string | undefined,
  row: DiagramRow
): string | null {
  if (!domain) return null;
  if (row.isPage === "1" && row.pageHandle) {
    return pageUrl(domain, row.pageHandle);
  }
  // Without a Shopify Page, we'd need the parent category's handle to
  // build the proxy URL — the diagram list response doesn't include it.
  // Callers should treat null as "can't open from here".
  return null;
}

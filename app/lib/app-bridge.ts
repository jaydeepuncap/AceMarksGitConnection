/**
 * App Bridge v4 integration.
 *
 * App Bridge v4 is loaded from Shopify's CDN by the <script> tag in index.html
 * (it must stay the first script and must not be bundled, async or deferred).
 * The <meta name="shopify-api-key"> tag, injected by the Worker, configures it.
 * It then exposes the `shopify` global; @shopify/app-bridge-react's components
 * (NavMenu, TitleBar…) and `useAppBridge()` are thin wrappers around it.
 *
 * Session tokens come from `shopify.idToken()`: short-lived (1 min) JWTs that
 * App Bridge refreshes for us. They are requested per API call and kept only in
 * memory — never in localStorage/sessionStorage/cookies.
 */

export function isEmbedded(): boolean {
  return typeof window !== 'undefined' && window.top !== window.self && typeof window.shopify !== 'undefined';
}

function shopifyGlobal(): typeof window.shopify | null {
  return typeof window !== 'undefined' && typeof window.shopify !== 'undefined' ? window.shopify : null;
}

/** Returns a fresh session token for Authorization: Bearer. */
export async function getSessionToken(): Promise<string> {
  const shopify = shopifyGlobal();
  if (!shopify) {
    throw new Error('App Bridge is not available. Open this app from Shopify Admin.');
  }
  return shopify.idToken();
}

export function showToast(message: string, options: { isError?: boolean; duration?: number } = {}): void {
  const shopify = shopifyGlobal();
  if (shopify) shopify.toast.show(message, options);
}

export function setLoading(loading: boolean): void {
  shopifyGlobal()?.loading(loading);
}

/** Navigates the top-level Admin window (e.g. to a re-authorization URL). */
export function redirectTopLevel(url: string): void {
  const target = new URL(url, window.location.origin);
  if (target.protocol !== 'https:' && target.hostname !== 'localhost') return;
  window.open(target.toString(), '_top');
}

/** The shop domain App Bridge was initialised for (display only — the server never trusts it). */
export function currentShopDomain(): string | null {
  return shopifyGlobal()?.config.shop ?? new URLSearchParams(window.location.search).get('shop');
}

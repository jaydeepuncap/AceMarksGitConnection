import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Stub the App Bridge `shopify` global and make the app believe it is embedded.
const shopifyStub = {
  idToken: vi.fn(async () => 'header.payload.signature'),
  toast: { show: vi.fn() },
  loading: vi.fn(),
  config: { apiKey: 'test', shop: 'demo.myshopify.com' },
};
Object.defineProperty(window, 'shopify', { value: shopifyStub, writable: true, configurable: true });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

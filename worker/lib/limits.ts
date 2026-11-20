/**
 * Cloudflare counts every outgoing request of one Worker invocation — fetch()
 * to GitHub or Shopify and calls to D1, KV and Queues — as a subrequest: at most
 * 50 on the Workers Free plan (thousands on Paid). Going over makes the next
 * request fail. Sync previews and sync steps keep within SUBREQUEST_BUDGET
 * (default: safe for the Free plan); a Paid deployment can raise it.
 */
import { THEME_WRITE_BATCH_LIMIT } from './shopify-graphql';

export const DEFAULT_SUBREQUEST_BUDGET = 45;

export function subrequestBudget(env: { SUBREQUEST_BUDGET?: string }): number {
  const value = Number(env.SUBREQUEST_BUDGET);
  return Number.isFinite(value) && value >= 20 ? Math.floor(value) : DEFAULT_SUBREQUEST_BUDGET;
}

/** A preview needs about 20 requests of its own; the rest may download files for its checks. */
export function previewDownloadBudget(budget: number): number {
  return Math.max(0, budget - 20);
}

/**
 * Files one sync step may write: each costs about 5 requests (GitHub download, backup read and
 * write, operation update, Shopify write share), plus about 12 for the step itself.
 */
export function filesPerStep(budget: number): number {
  return Math.max(1, Math.floor((budget - 12) / 5));
}

export { THEME_WRITE_BATCH_LIMIT };

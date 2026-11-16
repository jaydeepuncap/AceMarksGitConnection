/**
 * Turns a stored operation error ("CODE: message") into a plain-language reason
 * for the "Update incomplete" result (client guide, section 7).
 */
import type { FailureInfo } from '../../shared/api-types';

const TEMPORARY_SHOPIFY = /^(SHOPIFY_THROTTLED|SHOPIFY_ERROR|UPSTREAM_TIMEOUT|THROTTLED|INTERNAL_ERROR|INTERNAL_SERVER_ERROR|RATE_LIMITED)\b/;
const TEMPORARY_GITHUB = /^(GITHUB_RATE_LIMITED|GITHUB_ERROR)\b/;
const CHANGED = /^(CONFLICT|GITHUB_NOT_FOUND)\b/;
/** Shopify rejects invalid Liquid/JSON with a userError on the file. */
const CODE_MESSAGE = /liquid|syntax|invalid json|unexpected token|unknown tag|schema/i;

export function classifyFailure(error: string | null): FailureInfo {
  const detail = (error ?? 'Unknown error').trim();
  const message = detail.replace(/^[A-Z_]+:\s*/, '');
  if (/^CODE_ERRORS\b/.test(detail) || (!TEMPORARY_SHOPIFY.test(detail) && CODE_MESSAGE.test(message))) {
    return { kind: 'code', reason: 'Code error — needs a fix from your developer', detail: message };
  }
  if (TEMPORARY_SHOPIFY.test(detail)) {
    return { kind: 'temporary', reason: 'Temporary Shopify issue — can be retried', detail: message };
  }
  if (TEMPORARY_GITHUB.test(detail)) {
    return { kind: 'temporary', reason: 'Temporary GitHub issue — can be retried', detail: message };
  }
  if (CHANGED.test(detail)) {
    return { kind: 'changed', reason: 'The repository changed — run the full update again', detail: message };
  }
  return { kind: 'other', reason: 'Could not be updated', detail: message };
}

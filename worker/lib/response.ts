/**
 * Consistent JSON envelopes and the typed error used across all routes.
 *
 *   { "success": true,  "data": {...}, "message": "..." }
 *   { "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "requestId": "..." } }
 */
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiErrorBody, ApiErrorCode, ApiSuccess } from '@shared/api-types';

export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: ApiErrorCode;
  readonly details?: unknown;
  readonly retryAfter?: number;
  readonly headers?: Record<string, string>;

  constructor(
    status: ContentfulStatusCode,
    code: ApiErrorCode,
    message: string,
    options: { details?: unknown; retryAfter?: number; headers?: Record<string, string>; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.retryAfter = options.retryAfter;
    this.headers = options.headers;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'VALIDATION_ERROR', message, { details });
export const unauthorized = (message = 'Authentication required') =>
  new ApiError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Not allowed') => new ApiError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Resource not found') => new ApiError(404, 'NOT_FOUND', message);
export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, 'CONFLICT', message, { details });

export function ok<T>(c: Context, data: T, message?: string, status: ContentfulStatusCode = 200) {
  const body: ApiSuccess<T> = message ? { success: true, data, message } : { success: true, data };
  return c.json(body, status);
}

export function errorBody(err: ApiError, requestId?: string): ApiErrorBody {
  return {
    success: false,
    error: {
      code: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
      ...(err.retryAfter !== undefined ? { retryAfter: err.retryAfter } : {}),
      ...(requestId ? { requestId } : {}),
    },
  };
}

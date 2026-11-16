import { describe, expect, it } from 'vitest';
import { classifyFailure } from '../../worker/sync/failures';

describe('classifyFailure', () => {
  it('names code errors, temporary issues and repository changes in plain words', () => {
    expect(classifyFailure('CODE_ERRORS: Code error on line 3: Unclosed tag')).toMatchObject({ kind: 'code', detail: 'Code error on line 3: Unclosed tag' });
    expect(classifyFailure('INVALID: Liquid syntax error (line 2)')).toMatchObject({ kind: 'code' });
    expect(classifyFailure('SHOPIFY_THROTTLED: Throttled')).toMatchObject({ kind: 'temporary', reason: 'Temporary Shopify issue — can be retried' });
    expect(classifyFailure('UPSTREAM_TIMEOUT: Shopify did not finish processing these files in time')).toMatchObject({ kind: 'temporary' });
    expect(classifyFailure('GITHUB_RATE_LIMITED: slow down')).toMatchObject({ kind: 'temporary', reason: 'Temporary GitHub issue — can be retried' });
    expect(classifyFailure('CONFLICT: Integrity check failed')).toMatchObject({ kind: 'changed' });
    expect(classifyFailure('TOO_LARGE: File too big')).toMatchObject({ kind: 'other', detail: 'File too big' });
  });
});

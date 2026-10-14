import { describe, expect, it } from 'vitest';
import { DEFAULT_SYNC_PREFERENCES } from '../../shared/api-types';
import { checkJson, checkLiquid, checkThemeFile } from '../../worker/sync/code-check';
import { diffTrees, themeFilesFromTree, toIncludedFiles } from '../../worker/sync/plan';

const enc = (s: string) => new TextEncoder().encode(s);

describe('code check', () => {
  it('accepts valid Liquid, including liquid tags, raw blocks and whitespace control', () => {
    const ok = `{%- if product -%}
  {% for v in product.variants %}{{ v.title | escape }}{% else %}none{% endfor %}
{%- elsif collection -%}x{% endif %}
{% liquid
  assign a = 1
  if a == 1
    echo 'one'
  endif
%}
{% raw %}{% if %}{{ not liquid {% endraw %}
{% comment %}{% for %}{% endcomment %}
{% case x %}{% when 1 %}a{% else %}b{% endcase %}
{% schema %}{"name": "Cart", "settings": []}{% endschema %}
{% javascript %}if (a) { b() }{% endjavascript %}`;
    expect(checkLiquid('sections/a.liquid', ok)).toEqual([]);
  });

  it('reports unclosed and mismatched blocks with line numbers', () => {
    expect(checkLiquid('s.liquid', 'a\n{% if x %}\nb')).toEqual([
      { path: 's.liquid', line: 2, message: '{% if %} is never closed with {% endif %}' },
    ]);
    expect(checkLiquid('s.liquid', '{% for i in x %}{% endif %}')[0]?.message).toMatch(/endif %\} found, but \{% for %\}/);
    expect(checkLiquid('s.liquid', '{% endfor %}')[0]?.message).toMatch(/no matching/);
    expect(checkLiquid('s.liquid', '{{ product.title')[0]?.message).toMatch(/never closed with \}\}/);
    expect(checkLiquid('s.liquid', '{% when 1 %}')[0]?.message).toMatch(/outside a \{% case %\}/);
    expect(checkLiquid('s.liquid', '{% liquid\n  if a\n%}')[0]).toMatchObject({ line: 2 });
  });

  it('validates {% schema %} JSON', () => {
    const issues = checkLiquid('sections/x.liquid', 'x\n{% schema %}\n{"name": }\n{% endschema %}');
    expect(issues[0]).toMatchObject({ path: 'sections/x.liquid', message: expect.stringMatching(/Invalid JSON in \{% schema %\}/) });
  });

  it('JSON files may carry Shopify comment headers but must otherwise be valid', () => {
    expect(checkJson('templates/a.json', '/*\n * IMPORTANT: auto-generated\n */\n{"sections": {}, "order": []}')).toEqual([]);
    expect(checkJson('locales/en.json', '{"a": "http://x//y"}')).toEqual([]);
    expect(checkJson('locales/en.json', '{"a": 1,}')[0]?.message).toMatch(/Invalid JSON/);
  });

  it('ignores non-code files and rejects non-UTF-8 code files', () => {
    expect(checkThemeFile('assets/logo.png', new Uint8Array([0xff, 0xfe]))).toEqual([]);
    expect(checkThemeFile('snippets/a.liquid', new Uint8Array([0xff, 0xfe]))[0]?.message).toMatch(/UTF-8/);
    expect(checkThemeFile('assets/app.js', enc('{% if'))).toEqual([]);
  });
});

describe('planning helpers', () => {
  const tree = (files: Record<string, string>) =>
    themeFilesFromTree(
      Object.entries(files).map(([path, sha]) => ({ path, sha, mode: '100644', type: 'blob' as const })),
      DEFAULT_SYNC_PREFERENCES,
    );

  it('diffs two trees exactly; files changed and changed back are untouched', () => {
    const base = tree({ 'sections/a.liquid': 'a1', 'snippets/b.liquid': 'b1', 'snippets/same.liquid': 's', 'README.md': 'r1' });
    const target = tree({ 'sections/a.liquid': 'a2', 'snippets/c.liquid': 'c1', 'snippets/same.liquid': 's', 'README.md': 'r2', 'assets/theme-sync.json': 'x' });
    expect(diffTrees(base, target).map((c) => [c.path, c.action])).toEqual([
      ['sections/a.liquid', 'upsert'],
      ['snippets/b.liquid', 'delete'],
      ['snippets/c.liquid', 'upsert'],
    ]);
    // Without a base (first update) nothing is removed.
    expect(diffTrees(null, target).every((c) => c.action === 'upsert')).toBe(true);
  });

  it('marks protected and ignored files in per-commit lists', () => {
    const files = toIncludedFiles(
      [
        { filename: 'templates/product.json', previousFilename: null, status: 'modified', additions: 0, deletions: 0, changes: 0, blobSha: 'x', themePath: null, themePathError: null },
        { filename: 'snippets/new.liquid', previousFilename: 'snippets/old.liquid', status: 'renamed', additions: 0, deletions: 0, changes: 0, blobSha: 'x', themePath: null, themePathError: null },
        { filename: 'README.md', previousFilename: null, status: 'added', additions: 0, deletions: 0, changes: 0, blobSha: 'x', themePath: null, themePathError: null },
      ],
      DEFAULT_SYNC_PREFERENCES,
    );
    expect(files).toEqual([
      { path: 'templates/product.json', change: 'modified', protected: true, ignored: false },
      { path: 'snippets/new.liquid', change: 'added', protected: false, ignored: false },
      { path: 'snippets/old.liquid', change: 'removed', protected: false, ignored: false },
      { path: 'README.md', change: 'added', protected: false, ignored: true },
    ]);
  });
});

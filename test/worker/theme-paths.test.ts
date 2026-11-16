import { describe, expect, it } from 'vitest';
import {
  describeIgnorePattern,
  ignorePatternError,
  isIgnored,
  matchesGlob,
  normalizeThemeRoot,
  repoPathToThemePath,
  validateThemePath,
} from '../../shared/theme-paths';

describe('validateThemePath', () => {
  it.each([
    'sections/header.liquid',
    'sections/header-group.json',
    'templates/product.json',
    'templates/customers/account.liquid',
    'templates/metaobject/book.json',
    'snippets/price.liquid',
    'assets/base.css',
    'assets/logo@2x.png',
    'blocks/slide.liquid',
    'locales/en.default.json',
    'layout/theme.liquid',
    'config/settings_schema.json',
  ])('accepts %s', (path) => {
    expect(validateThemePath(path)).toEqual({ ok: true, path });
  });

  it.each([
    ['../secrets.liquid', /traversal|Not a Shopify/],
    ['sections/../../etc/passwd', /traversal/],
    ['/sections/header.liquid', /relative/],
    ['sections\\header.liquid', /backslash/],
    ['sections//header.liquid', /empty segment/],
    ['sections/%2e%2e/x.liquid', /percent/],
    ['sections/he\u0000ader.liquid', /control/],
    ['assets/nested/dir/file.css', /Not a Shopify theme file/],
    ['README.md', /Not a Shopify theme file/],
    ['config/other.json', /Not a Shopify theme file/],
    ['snippets/x.json', /Not a Shopify theme file/],
    ['sections/.hidden.liquid', /Unsupported characters/],
    ['', /empty/],
  ])('rejects %j', (path, reason) => {
    const result = validateThemePath(path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(reason);
  });
});

describe('theme root mapping', () => {
  it('normalizes and validates roots', () => {
    expect(normalizeThemeRoot('/theme/')).toEqual({ ok: true, root: 'theme' });
    expect(normalizeThemeRoot('')).toEqual({ ok: true, root: '' });
    expect(normalizeThemeRoot('../x').ok).toBe(false);
  });

  it('maps repository paths inside the root only', () => {
    expect(repoPathToThemePath('theme/sections/a.liquid', 'theme')).toBe('sections/a.liquid');
    expect(repoPathToThemePath('themes/sections/a.liquid', 'theme')).toBeNull();
    expect(repoPathToThemePath('sections/a.liquid', '')).toBe('sections/a.liquid');
  });
});

describe('ignore globs', () => {
  it('supports *, ** and literals', () => {
    expect(matchesGlob('config/settings_data.json', 'config/settings_data.json')).toBe(true);
    expect(matchesGlob('assets/a.css', 'assets/*.css')).toBe(true);
    expect(matchesGlob('assets/a.js', 'assets/*.css')).toBe(false);
    expect(matchesGlob('templates/customers/a.json', 'templates/**')).toBe(true);
    expect(matchesGlob('templates/customers/a.json', '**/a.json')).toBe(true);
    expect(isIgnored('locales/en.json', ['', 'locales/*'])).toBe('locales/*');
  });

  it('treats "folder/" and a bare folder name as everything inside it', () => {
    expect(matchesGlob('locales/en.default.json', 'locales/')).toBe(true);
    expect(matchesGlob('locales/en.default.json', 'locales')).toBe(true);
    expect(matchesGlob('localesx/en.json', 'locales')).toBe(false);
    expect(matchesGlob('sections/development-section.liquid', 'sections/development-section.liquid')).toBe(true);
    expect(matchesGlob('templates/product.json', 'templates/*.json')).toBe(true);
    expect(matchesGlob('templates/customers/account.json', 'templates/*.json')).toBe(false);
  });

  it('validates and explains patterns', () => {
    expect(ignorePatternError('assets/development.js')).toBeNull();
    expect(ignorePatternError('/assets/a.js')).toMatch(/relative/);
    expect(ignorePatternError('assets/../x')).toMatch(/not allowed/);
    expect(ignorePatternError('  ')).toMatch(/Enter/);
    expect(describeIgnorePattern('locales/')).toBe('Everything inside the locales/ folder');
    expect(describeIgnorePattern('config/settings_data.json')).toBe('Only the file config/settings_data.json');
    expect(describeIgnorePattern('templates/*.json')).toBe('Files named like "*.json" directly in templates/');
  });
});

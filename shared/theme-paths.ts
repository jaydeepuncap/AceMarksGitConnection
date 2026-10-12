/**
 * Theme file path rules shared by the backend (authoritative) and frontend
 * (instant feedback). The backend re-validates every path before it is planned
 * or written; the frontend copy is a convenience only.
 *
 * Shopify themes have a fixed directory layout:
 * https://shopify.dev/docs/storefronts/themes/architecture
 */

export const THEME_PATH_MAX_LENGTH = 255;

/** Files the app never deletes even when a commit removes them. */
export const PROTECTED_THEME_FILES: readonly string[] = [
  'layout/theme.liquid',
  'config/settings_schema.json',
  'config/settings_data.json',
];

const SAFE_SEGMENT = /^[A-Za-z0-9_@+\-][A-Za-z0-9._@+\-]*$/;

interface DirRule {
  /** Regex the full path must match. */
  pattern: RegExp;
  description: string;
}

const NAME = '[A-Za-z0-9_@+\\-][A-Za-z0-9._@+\\-]*';

const DIR_RULES: DirRule[] = [
  { pattern: new RegExp(`^assets/${NAME}$`), description: 'assets/<file>' },
  { pattern: new RegExp(`^blocks/${NAME}\\.liquid$`), description: 'blocks/<name>.liquid' },
  {
    pattern: /^config\/(settings_schema|settings_data)\.json$/,
    description: 'config/settings_schema.json or config/settings_data.json',
  },
  { pattern: new RegExp(`^layout/${NAME}\\.liquid$`), description: 'layout/<name>.liquid' },
  { pattern: new RegExp(`^locales/${NAME}\\.json$`), description: 'locales/<locale>.json' },
  { pattern: new RegExp(`^sections/${NAME}\\.(liquid|json)$`), description: 'sections/<name>.liquid|json' },
  { pattern: new RegExp(`^snippets/${NAME}\\.liquid$`), description: 'snippets/<name>.liquid' },
  {
    pattern: new RegExp(`^templates/((customers|metaobject)/)?${NAME}\\.(liquid|json)$`),
    description: 'templates/[customers/|metaobject/]<name>.liquid|json',
  },
];

export type PathCheck = { ok: true; path: string } | { ok: false; reason: string };

/**
 * Validates a Shopify theme filename. Rejects traversal (`..`), absolute paths,
 * backslashes, control characters, empty segments and anything outside the
 * standard theme directories.
 */
export function validateThemePath(input: string): PathCheck {
  if (typeof input !== 'string' || input.length === 0) {
    return { ok: false, reason: 'Path is empty' };
  }
  if (input.length > THEME_PATH_MAX_LENGTH) {
    return { ok: false, reason: `Path exceeds ${THEME_PATH_MAX_LENGTH} characters` };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(input)) {
    return { ok: false, reason: 'Path contains control characters' };
  }
  if (input.includes('\\')) return { ok: false, reason: 'Path contains a backslash' };
  if (input.startsWith('/')) return { ok: false, reason: 'Path must be relative' };
  if (input.includes('%')) return { ok: false, reason: 'Path contains percent-encoding' };

  const segments = input.split('/');
  for (const segment of segments) {
    if (segment === '') return { ok: false, reason: 'Path contains an empty segment' };
    if (segment === '.' || segment === '..') {
      return { ok: false, reason: 'Path traversal is not allowed' };
    }
    if (!SAFE_SEGMENT.test(segment)) {
      return { ok: false, reason: `Unsupported characters in "${segment}"` };
    }
  }

  if (!DIR_RULES.some((rule) => rule.pattern.test(input))) {
    return {
      ok: false,
      reason: `Not a Shopify theme file. Allowed: ${DIR_RULES.map((r) => r.description).join('; ')}`,
    };
  }
  return { ok: true, path: input };
}

export type RootCheck = { ok: true; root: string } | { ok: false; reason: string };

/** Normalizes a repository sub-directory ("theme", "/theme/", "") used as the theme root. */
export function normalizeThemeRoot(input: string | null | undefined): RootCheck {
  const trimmed = (input ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (trimmed === '') return { ok: true, root: '' };
  if (trimmed.length > 200) return { ok: false, reason: 'Theme root is too long' };
  for (const segment of trimmed.split('/')) {
    if (segment === '' || segment === '.' || segment === '..' || !SAFE_SEGMENT.test(segment)) {
      return { ok: false, reason: `Invalid theme root segment "${segment}"` };
    }
  }
  return { ok: true, root: trimmed };
}

/**
 * Maps a repository path to a theme filename given a normalized theme root.
 * Returns null when the file lives outside the theme root.
 */
export function repoPathToThemePath(repoPath: string, themeRoot: string): string | null {
  if (themeRoot === '') return repoPath;
  const prefix = `${themeRoot}/`;
  return repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : null;
}

export function themePathToRepoPath(themePath: string, themeRoot: string): string {
  return themeRoot === '' ? themePath : `${themeRoot}/${themePath}`;
}

/**
 * Minimal glob matcher for ignore patterns: `*` matches within a path segment,
 * `**` matches across segments, `?` matches one character. Everything else is literal.
 */
export function matchesGlob(path: string, pattern: string): boolean {
  let regex = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` matches zero or more directories
        if (pattern[i + 2] === '/') {
          regex += '(?:.*/)?';
          i += 2;
        } else {
          regex += '.*';
          i += 1;
        }
      } else {
        regex += '[^/]*';
      }
    } else if (ch === '?') {
      regex += '[^/]';
    } else {
      regex += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  regex += '$';
  return new RegExp(regex).test(path);
}

export function isIgnored(path: string, patterns: readonly string[]): string | null {
  for (const pattern of patterns) {
    if (pattern.trim() !== '' && matchesGlob(path, pattern.trim())) return pattern;
  }
  return null;
}

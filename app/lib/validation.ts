/**
 * Client-side form validation for instant feedback. The Worker re-validates
 * everything (worker/lib/validators.ts); these checks never replace that.
 */
export { validateThemePath, normalizeThemeRoot } from '../../shared/theme-paths';
import { normalizeThemeRoot } from '../../shared/theme-paths';

export function validateRepository(value: string): string | null {
  const trimmed = value.trim().replace(/\.git$/, '');
  if (!trimmed) return 'Enter a repository as owner/name';
  const parts = trimmed.split('/');
  if (parts.length !== 2) return 'Use the format owner/name';
  const [owner, name] = parts as [string, string];
  if (!/^(?!-)[A-Za-z0-9-]{1,39}(?<!-)$/.test(owner)) return 'Invalid owner name';
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name) || name === '.' || name === '..') return 'Invalid repository name';
  return null;
}

export function validateGithubToken(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Paste a GitHub personal access token';
  if (!/^(github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+)$/.test(trimmed)) {
    return 'Expected a token starting with github_pat_ (fine-grained) or ghp_ (classic)';
  }
  if (trimmed.length < 20) return 'Token looks too short';
  return null;
}

export function validateCommitSha(value: string): string | null {
  return /^[0-9a-f]{40}$/i.test(value.trim()) ? null : 'Use the full 40-character commit SHA';
}

export function validateThemeRootInput(value: string): string | null {
  const result = normalizeThemeRoot(value);
  return result.ok ? null : result.reason;
}

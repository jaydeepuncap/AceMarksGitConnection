import { useState } from 'react';
import { describeIgnorePattern, ignorePatternError, MAX_IGNORE_PATTERNS } from '../../shared/theme-paths';
import { api } from '../lib/api-client';
import { useMutation } from '../lib/hooks';
import type { IgnorePreviewResponse } from '../lib/types';
import { ErrorBanner } from './ErrorBanner';
import { Button, Grid, Paragraph, Stack, Text, TextField } from './ui';

const EXAMPLES = [
  'config/settings_data.json',
  'assets/development.js',
  'templates/*.json',
  'sections/development-section.liquid',
  'locales/',
];

/**
 * Add / edit / remove ignore patterns. Ignored files are never uploaded,
 * changed or deleted by any sync (full, single-commit or multi-commit).
 * "Check matching files" shows what each pattern matches on the selected branch.
 */
export function IgnorePatternsEditor({
  patterns,
  onChange,
  canPreview,
}: {
  patterns: string[];
  onChange: (patterns: string[]) => void;
  canPreview: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [draftTouched, setDraftTouched] = useState(false);
  const preview = useMutation(api.settings.ignorePreview);
  const [result, setResult] = useState<IgnorePreviewResponse | null>(null);

  const draftError = draftTouched ? ignorePatternError(draft) : null;
  const duplicate = patterns.includes(draft.trim());

  const add = () => {
    setDraftTouched(true);
    if (ignorePatternError(draft) || duplicate || patterns.length >= MAX_IGNORE_PATTERNS) return;
    onChange([...patterns, draft.trim()]);
    setDraft('');
    setDraftTouched(false);
    setResult(null);
  };
  const update = (index: number, value: string) => {
    onChange(patterns.map((p, i) => (i === index ? value : p)));
    setResult(null);
  };
  const remove = (index: number) => {
    onChange(patterns.filter((_, i) => i !== index));
    setResult(null);
  };
  const check = async () => {
    const valid = patterns.filter((p) => !ignorePatternError(p));
    const data = await preview.run(valid);
    if (data) setResult(data);
  };
  const matchFor = (pattern: string) => result?.patterns.find((m) => m.pattern === pattern.trim());

  return (
    <Stack gap="base">
      <Paragraph color="subdued">
        Files and folders listed here are never uploaded, changed or deleted in Shopify — by a full sync, a single
        commit or several commits. Use theme paths, for example{' '}
        {EXAMPLES.map((e, i) => (
          <span key={e}>
            <Text type="strong">{e}</Text>
            {i < EXAMPLES.length - 1 ? ', ' : '.'}
          </span>
        ))}{' '}
        <Text type="strong">*</Text> matches within a folder, <Text type="strong">**</Text> across folders, and a
        trailing <Text type="strong">/</Text> means everything inside the folder.
      </Paragraph>

      {patterns.length === 0 ? (
        <Text color="subdued">No files are ignored: every theme file in the repository can be synced.</Text>
      ) : (
        <Stack gap="small-200">
          {patterns.map((pattern, index) => {
            const error =
              ignorePatternError(pattern) ?? (patterns.indexOf(pattern) !== index ? 'Already in the list' : null);
            const match = matchFor(pattern);
            return (
              <Grid key={index} gridTemplateColumns="minmax(0, 1fr) auto" gap="small-200" alignItems="start">
                <TextField
                  label={`Ignore pattern ${index + 1}`}
                  labelAccessibilityVisibility="exclusive"
                  value={pattern}
                  error={error ?? undefined}
                  details={
                    error
                      ? undefined
                      : `${describeIgnorePattern(pattern)}${
                          match
                            ? ` · ${match.matches} file(s) on ${result!.branch}${match.examples.length ? `: ${match.examples.join(', ')}${match.matches > match.examples.length ? ', …' : ''}` : ''}`
                            : ''
                        }`
                  }
                  onInput={(event) => update(index, event.currentTarget.value)}
                />
                <Button
                  variant="tertiary"
                  tone="critical"
                  accessibilityLabel={`Remove ${pattern}`}
                  onClick={() => remove(index)}
                >
                  Remove
                </Button>
              </Grid>
            );
          })}
        </Stack>
      )}

      <Grid gridTemplateColumns="minmax(0, 1fr) auto" gap="small-200" alignItems="end">
        <TextField
          label="Add a file, folder or pattern"
          placeholder="e.g. templates/*.json or locales/"
          value={draft}
          error={draftError ?? (draftTouched && duplicate ? 'Already in the list' : undefined)}
          details={draft.trim() && !ignorePatternError(draft) ? describeIgnorePattern(draft) : undefined}
          onInput={(event) => setDraft(event.currentTarget.value)}
        />
        <Button disabled={patterns.length >= MAX_IGNORE_PATTERNS} onClick={add}>
          Add
        </Button>
      </Grid>

      <Stack direction="inline" gap="small-200" alignItems="center">
        <Button
          variant="secondary"
          disabled={!canPreview || patterns.length === 0}
          loading={preview.pending}
          onClick={check}
        >
          Check matching files
        </Button>
        {result && (
          <Text color="subdued">
            {`${result.ignoredFiles} of ${result.themeFiles} theme files on ${result.repository} · ${result.branch} are ignored`}
          </Text>
        )}
        {!canPreview && <Text color="subdued">Select a repository to check which files match.</Text>}
      </Stack>
      <ErrorBanner error={preview.error} heading="Matching files could not be checked" onDismiss={preview.clearError} />
    </Stack>
  );
}

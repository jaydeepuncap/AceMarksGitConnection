import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { UpdateList } from '../components/UpdateList';
import { LINE_LABEL } from '../lib/format';
import { useNavigateHandler } from '../lib/hooks';
import type { ThemeLine } from '../lib/types';

/** Step 02 (choose an update for Staging) and "Going back to an earlier version". */
export default function Updates({ mode }: { mode: 'update' | 'goback' }) {
  const navigate = useNavigate();
  const go = useNavigateHandler();
  const [line, setLine] = useState<ThemeLine>('staging');
  const activeLine: ThemeLine = mode === 'update' ? 'staging' : line;

  return (
    <AppLayout
      title={mode === 'update' ? 'Updates for Staging' : `Go back on ${LINE_LABEL[activeLine]}`}
      backAction={{ content: 'Themes', onAction: () => navigate('/themes') }}
    >
      {mode === 'goback' && (
        <s-section>
          <s-stack gap="base">
            <s-paragraph>
              Return Staging or Live to any earlier update. Every change made after it is fully undone, with the same review,
              checks and backup as any other update. Brand settings and theme-editor content are not affected.
            </s-paragraph>
            <s-box inlineSize="240px">
              <s-select label="Theme" value={line} onChange={(event) => setLine(event.currentTarget.value as ThemeLine)}>
                <s-option value="staging">Staging</s-option>
                <s-option value="live">Live</s-option>
              </s-select>
            </s-box>
          </s-stack>
        </s-section>
      )}
      <s-section>
        <UpdateList key={`${mode}:${activeLine}`} mode={mode} line={activeLine} />
      </s-section>
      {mode === 'update' && (
        <s-stack direction="inline">
          <s-button variant="tertiary" onClick={go('/go-back')}>
            Go back to an earlier update instead
          </s-button>
        </s-stack>
      )}
    </AppLayout>
  );
}

// The hashtag list of the 'block-ai-content' switch, which is Off's: rendered under that switch in Off's popup.

import { useState } from 'react';
import { usePopupT } from '../../i18n/react';
import { type BlockAiContentValue, DEFAULT_AI_BLOCKLIST_HASHTAGS, FWSettings, updateFeature } from '../../storage/settings';

// Inline chip-list under the `block-ai-content` toggle. Parents add /
// remove hashtags that hide matching posts at extract time (the blocker
// pairs this list with platform-applied AI labels like "Contains AI-
// generated media"). Re-introduced 2026-05-22 after a report flagged the
// missing editor frame; storage shape (FeatureToggle.value: BlockAi
// ContentValue) was already wired but no UI exposed it.
export function BlockAiHashtagEditor({
  settings, onChange,
}: {
  settings: FWSettings;
  onChange: () => Promise<void>;
}) {
  const t = usePopupT();
  // Exactly the list the blocker uses (ai-content-blocker.ts reads the
  // stored value as is): an empty stored list is shown empty, with a control
  // that writes the defaults back (P10). No display-only fallback.
  const stored = (settings.features?.['block-ai-content']?.value as BlockAiContentValue | undefined)?.hashtags;
  const hashtags: string[] = stored ?? [];
  const [draft, setDraft] = useState('');
  /** Why the last Add was refused, shown under the box. Empty when there is nothing to say. */
  const [hashtagError, setHashtagError] = useState('');
  // The default list is 36 chips, which pushed the switches below it (Reels, ads, breaks) far down Settings, so the
  // chips sit in a fold that starts closed. Adding a tag opens it, so the person sees the tag land.
  const [listOpen, setListOpen] = useState(false);

  const saveHashtags = async (next: string[]): Promise<void> => {
    // Merge the hashtag list onto a FRESH read of the block-ai-content feature
    // (POP-2) so a concurrent toggle in another window is not clobbered.
    await updateFeature('block-ai-content', cur => ({
      ...cur,
      value: { hashtags: next } satisfies BlockAiContentValue,
    }));
    await onChange();
  };

  const addHashtag = async (): Promise<void> => {
    const normalized = draft.trim().replace(/^#+/, '').toLowerCase();
    if (!normalized) return;
    // Unicode letters, and a sentence when it is refused (2026-09-19).
    //
    // This was `/^[a-z0-9_-]+$/`, which rejects every accented word, so
    // `#geracao` could be blocked and `#geração` could not, on a product that
    // ships in Romanian, Spanish and Brazilian Portuguese. And the refusal was
    // a bare `return`: the draft was left in the box, no message appeared, and
    // the Add button stayed lit and coloured. A parent typing the tag they can
    // see on the page pressed a working-looking button and nothing happened, as
    // many times as they cared to try.
    //
    // The page side could not have matched it either; `captionHashtags` in
    // ai-content-blocker.ts read `/#\w+/g`, which stops at the first accent.
    // Both halves moved together, or this would be a box that accepts a word
    // the filter can never act on.
    if (!/^[\p{L}\p{N}_-]+$/u.test(normalized)) {
      setHashtagError(t.hashtagNotAWord);
      return;
    }
    setHashtagError('');
    if (hashtags.includes(normalized)) {
      setDraft('');
      return;
    }
    setDraft('');
    await saveHashtags([...hashtags, normalized]);
    setListOpen(true);
  };

  const removeHashtag = async (tag: string): Promise<void> => {
    await saveHashtags(hashtags.filter(h => h !== tag));
  };

  return (
    <div style={{
      padding: '8px 0 4px',
    }}>
      <div style={{ fontSize: 11, color: 'var(--fw-muted)', marginBottom: 8 }}>
        {t.hashtagsHelp}
      </div>
      {hashtags.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--fw-muted)', marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{t.hashtagsEmpty}</span>
          <button type="button" className="iconbtn" style={{ fontSize: 11 }} onClick={() => { void saveHashtags([...DEFAULT_AI_BLOCKLIST_HASHTAGS]); }}>
            {t.hashtagsRestoreDefaults}
          </button>
        </div>
      )}
      {hashtags.length > 0 && (
      <details
        data-fw-hashtag-list
        open={listOpen}
        onToggle={(e) => setListOpen((e.currentTarget as HTMLDetailsElement).open)}
        style={{ marginBottom: 8 }}
      >
        <summary style={{ fontSize: 11, color: 'var(--fw-muted)', cursor: 'pointer', marginBottom: 6 }}>
          {t.hashtagsShowList(hashtags.length)}
        </summary>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {hashtags.map(tag => (
          <span
            key={tag}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 8px',
              borderRadius: 999,
              background: 'var(--fw-surface-2)',
              fontSize: 11,
              color: 'var(--fw-text)',
            }}
          >
            #{tag}
            <button
              type="button"
              aria-label={t.removeHashtagAria(tag)}
              onClick={() => { void removeHashtag(tag); }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--fw-muted)',
                cursor: 'pointer',
                fontSize: 14,
                padding: 0,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      </details>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); if (hashtagError) setHashtagError(''); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void addHashtag();
            }
          }}
          placeholder={t.addHashtagPlaceholder}
          aria-label={t.addHashtagAria}
          style={{
            flex: 1,
            padding: '4px 8px',
            borderRadius: 'var(--fw-r-md)',
            border: '1px solid var(--fw-border)',
            background: 'var(--fw-surface)',
            color: 'var(--fw-text)',
            fontSize: 12,
          }}
        />
        <button
          type="button"
          onClick={() => { void addHashtag(); }}
          disabled={!draft.trim()}
          style={{
            padding: '4px 12px',
            borderRadius: 'var(--fw-r-md)',
            border: '1px solid var(--fw-border)',
            background: draft.trim() ? 'var(--fw-accent)' : 'var(--fw-surface-2)',
            color: draft.trim() ? 'var(--fw-on-accent)' : 'var(--fw-muted)',
            fontSize: 12,
            cursor: draft.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          {t.add}
        </button>
      </div>
      {hashtagError && (
        <div
          role="status"
          style={{ fontSize: 11, color: 'var(--fw-red)', marginTop: 6, lineHeight: 1.4 }}
        >
          {hashtagError}
        </div>
      )}
    </div>
  );
}

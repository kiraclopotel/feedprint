// FeelingWise — the editor for the user's own word / phrase / account list.
//
// Until 2026-09-02 the `parent-blocklist` feature was matched by the pipeline
// and advertised on the store listing, but no surface let anyone type a rule
// into it. This is that surface. Each rule is a chip (in a plain list
// the added rules looked lost and cramped) with its own remove button,
// a new one is typed into the group and lands on Enter or comma, and every
// change is saved on the spot; there is no Save button to forget. The
// normalization (lowercase, diacritic fold, whole words) lives in
// core/parent-blocklist and is not repeated here.

import { useState, type KeyboardEvent } from 'react';
import type { FWSettings } from '../../storage/settings';
import { getFeatureValue, updateFeature } from '../../storage/settings';
import { readParentBlocklist, ruleTallyKey, type ParentBlocklistValue } from '../../core/parent-blocklist';
import { usePopupT } from '../../i18n/react';
import { StatusLine } from '../shared/StatusLine';
import { Info as InfoIcon } from '../shared/icons/lucide';

type Group = keyof ParentBlocklistValue;
const KIND: Record<Group, 'word' | 'phrase' | 'account'> = { words: 'word', phrases: 'phrase', accounts: 'account' };

function clean(group: Group, raw: string): string {
  const v = raw.trim();
  return group === 'accounts' ? v.replace(/^@+/, '') : v;
}

export function BlocklistEditor({
  settings, onChange, desc,
}: {
  settings: FWSettings;
  onChange: () => Promise<void>;
  /** The line under the title; Receipts passes its one-sentence line, Off keeps the default. */
  desc?: string;
}) {
  const t = usePopupT();
  const stored: ParentBlocklistValue = readParentBlocklist(getFeatureValue(settings, 'parent-blocklist'));
  const [drafts, setDrafts] = useState<Record<Group, string>>({ words: '', phrases: '', accounts: '' });
  const [saved, setSaved] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [query, setQuery] = useState('');
  const count = stored.words.length + stored.phrases.length + stored.accounts.length;
  // A search narrows the chips shown; the counts beside each group stay the stored ones.
  const needle = query.trim().replace(/^@+/, '').toLowerCase();
  const shown = (group: Group): string[] => needle === '' ? stored[group] : stored[group].filter(i => i.toLowerCase().includes(needle));
  const nothingMatches = needle !== '' && (['words', 'phrases', 'accounts'] as const).every(g => shown(g).length === 0);

  // The write reads the current list from storage, so a change made in
  // another window is kept (settings.ts updateFeature).
  const write = async (change: (cur: ParentBlocklistValue) => ParentBlocklistValue) => {
    await updateFeature('parent-blocklist', cur => ({
      ...cur, enabled: true, value: change(readParentBlocklist(cur.value)),
    }));
    await onChange();
    setSaved(true);
    // Widened from 1200ms (accessibility audit, 2026-09-18): the confirmation
    // below is now a status line a screen reader is expected to reach and
    // read, not only a word that flashed on and off screen.
    setTimeout(() => setSaved(false), 3000);
  };
  const add = (group: Group) => {
    const items = drafts[group].split(/[,\n]/).map(s => clean(group, s)).filter(Boolean);
    setDrafts(d => ({ ...d, [group]: '' }));
    if (items.length === 0) return;
    void write(cur => ({ ...cur, [group]: [...cur[group], ...items.filter(i => !cur[group].includes(i))] }));
  };
  const remove = (group: Group, item: string) => {
    void write(cur => ({ ...cur, [group]: cur[group].filter(i => i !== item) }));
  };
  const onKey = (group: Group) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(group); }
    else if (e.key === 'Backspace' && drafts[group] === '' && stored[group].length > 0) {
      remove(group, stored[group][stored[group].length - 1]);
    }
  };

  const groups: { key: Group; label: string; hint: string }[] = [
    { key: 'words', label: t.rulesWordsLabel, hint: t.rulesWordsHint },
    { key: 'phrases', label: t.rulesPhrasesLabel, hint: t.rulesPhrasesHint },
    { key: 'accounts', label: t.rulesAccountsLabel, hint: t.rulesAccountsHint },
  ];

  return (
    <div className="rules">
      <div className="fr-body" style={{ width: '100%' }}>
        <div className="fr-name">
          {t.rulesName} <span style={{ fontWeight: 400, color: 'var(--fw-muted)' }}>· {t.rulesCount(count)}</span>
          <button
            type="button"
            className="fr-info"
            aria-label={`${t.rowInfoAria}: ${t.rulesName}`}
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(o => !o)}
          >
            <InfoIcon size={13} />
          </button>
          {saved && <StatusLine as="span" tone="status" className="rules-saved">{t.rulesSaved}</StatusLine>}
        </div>
        <div className="fr-desc">{desc ?? t.rulesDesc}</div>
        {moreOpen && <div className="fr-desc">{t.rulesMore}</div>}
      </div>
      {count > 0 && (
        <input
          type="search"
          className="list-search"
          value={query}
          placeholder={t.rulesSearch}
          aria-label={t.rulesSearch}
          spellCheck={false}
          onChange={e => setQuery(e.target.value)}
        />
      )}
      {nothingMatches && <div className="fr-desc" role="status">{t.searchNoMatch}</div>}
      {groups.map(g => (
        <div className="rules-group" key={g.key}>
          <div className="rules-label">{g.label} <span className="rules-count">{stored[g.key].length}</span></div>
          <div className="chips" onClick={(e) => { (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus(); }}>
            {shown(g.key).map(item => (
              <span className={`chip${g.key === 'accounts' ? ' chip-account' : ''}`} key={item}>
                <span>{g.key === 'accounts' ? `@${item}` : item}</span>
                {(settings.hiddenByFeature?.[ruleTallyKey(KIND[g.key], item)] ?? 0) > 0 && (
                  <span className="pill-n" title={t.rulesHit(settings.hiddenByFeature?.[ruleTallyKey(KIND[g.key], item)] ?? 0)}>
                    ×{settings.hiddenByFeature?.[ruleTallyKey(KIND[g.key], item)]}
                  </span>
                )}
                <button type="button" className="chip-x" aria-label={t.rulesRemove(item)} onClick={() => remove(g.key, item)}>×</button>
              </span>
            ))}
            <input
              className="chip-input"
              value={drafts[g.key]}
              placeholder={stored[g.key].length === 0 ? g.hint : t.rulesAdd}
              aria-label={g.label}
              spellCheck={false}
              onChange={e => setDrafts(d => ({ ...d, [g.key]: e.target.value }))}
              onKeyDown={onKey(g.key)}
              onBlur={() => add(g.key)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

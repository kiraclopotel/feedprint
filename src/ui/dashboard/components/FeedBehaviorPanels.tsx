// FeelingWise — Feed behavior panels (the Patterns deep half).
//
// What the feed DID, at the five levels of the reader-lens contract
// (docs/design/READER_LENSES.md): unbroken runs and in-sitting position
// (level 1), the return after quiet (level 2), amplification and advertiser
// placement (level 3), technique hand-offs and recurring voices (level 4),
// and the rule-gated cautious reading (level 5, expressly labeled
// interpretation). A lens bar switches the per-panel "what this means"
// caption; the numbers themselves never change with the lens.
//
// Design source (browser-verified on the real chain, both themes):
// docs/redesign/mockups/2026-07-15/feed-behavior.html
// Fence honored: renders outside the virtualized feed; never touches
// FeedCard, virtual-scroll, or fc-timeline.

import { TONE } from '../house-tones';
import * as React from 'react';
import { useDashboardT, useUiLanguage } from '../../../i18n/react';
import { dayKeyAsLocalDate, formatDateLocal, formatTimeLocal } from '../../shared/format-time';
import type { FeedBehaviorLens } from '../../../i18n/dashboard-strings';
import type { Caution, ChainPair, FeedBehaviorModel } from './feed-behavior-data';
import { pct1 } from './feed-behavior-data';

const FEED_BEHAVIOR_LENSES: FeedBehaviorLens[] = ['parent', 'lawyer', 'analyst', 'self'];

const PLATFORM_COLOR: Record<string, string> = {
  twitter: 'var(--fw-platform-twitter)',
  facebook: 'var(--fw-platform-facebook)',
  instagram: 'var(--fw-platform-instagram)',
  tiktok: 'var(--fw-platform-tiktok)',
  youtube: 'var(--fw-platform-youtube)',
};
const PLATFORM_LABEL: Record<string, string> = {
  twitter: 'X', facebook: 'Facebook', instagram: 'Instagram',
  tiktok: 'TikTok', youtube: 'YouTube',
};

/** Fact/interpretation legend + the lens switcher (numbers never move). */
export function FeedBehaviorLensBar({ lens, onChange }: {
  lens: FeedBehaviorLens;
  onChange: (lens: FeedBehaviorLens) => void;
}) {
  const t = useDashboardT();
  return (
    <>
      <div className="fb-legend-strip">
        <span className="k"><span className="swatch fact" aria-hidden="true" /> {t.fbLegendFact}</span>
        <span className="k"><span className="swatch interp" aria-hidden="true" /> {t.fbLegendInterp}</span>
      </div>
      <div className="fb-lensbar">
        {FEED_BEHAVIOR_LENSES.map((l) => (
          <button
            key={l}
            type="button"
            className={`fb-lens${l === lens ? ' active' : ''}`}
            aria-pressed={l === lens}
            onClick={() => onChange(l)}
          >
            {t.fbLensLabel(l)}
          </button>
        ))}
        <span className="fb-lens-note">{t.fbLensNote}</span>
      </div>
    </>
  );
}

/**
 * A section of this tab. `empty` is the one-line negative finding when the
 * section has nothing to show, and it changes the shape of the card rather than
 * its content.
 *
 * Why: on a record with nothing flagged yet, which is every install in its first
 * days, eleven of the fourteen sections said "nothing in this window" and each
 * still cost a full card with a heading and a paragraph of explanation. The tab
 * was 3,239px of mostly-empty boxes at a 900px window (measured 2026-09-17), and
 * that is the first thing a new person sees here.
 *
 * What does NOT change: the negative itself. "No unbroken flagged runs in this
 * window" is a finding, not the absence of one, and this product says what it
 * did not find as plainly as what it did. So the negative sits in the summary
 * line, visible without opening anything; what folds away is the paragraph that
 * explains what the section would have shown, which is teaching for a reader who
 * has something to read.
 */
function FbCard({ title, span, interp, tag, empty, children }: {
  title: string;
  span: 5 | 6 | 7 | 12;
  interp?: boolean;
  tag?: string;
  empty?: string;
  children: React.ReactNode;
}) {
  if (empty) {
    return (
      <details className={`fb-card fb-card-empty span-${span}`}>
        <summary>
          <span className="fb-eyebrow-line">{title}</span>
          <span className="fb-empty-note">{empty}</span>
        </summary>
        <div className="fb-empty-body">{children}</div>
      </details>
    );
  }
  return (
    <section className={`fb-card span-${span}${interp ? ' interp' : ''}`}>
      <p className="fb-eyebrow">
        {title}
        {tag && <span className="fb-caution-tag">{tag}</span>}
      </p>
      {children}
    </section>
  );
}

function LensCap({ text }: { text: string }) {
  return <div className="fb-lens-cap">{text}</div>;
}

function Prov({ text }: { text: string }) {
  return <div className="fb-prov">{text}</div>;
}

function ChainRow({ pair, maxN, tag }: { pair: ChainPair; maxN: number; tag: string }) {
  const t = useDashboardT();
  return (
    <div className="fb-chain-row">
      <span className="fb-chip">{t.techniqueLabel(pair.a)}</span>
      {pair.sustained
        ? <span className="fb-chain-arrow">{t.fbChainRepeats}</span>
        : <>
            <span className="fb-chain-arrow">{t.fbChainThen}</span>
            <span className="fb-chip">{t.techniqueLabel(pair.b)}</span>
          </>}
      <span className="fb-chain-bar" style={{ width: `${Math.max(8, (pair.n / maxN) * 120)}px` }} aria-hidden="true" />
      <span className="fb-chain-n">{t.fbChainTimes(pair.n)} · {tag}</span>
    </div>
  );
}

export function FeedBehaviorPanels({ model, lens }: {
  model: FeedBehaviorModel;
  lens: FeedBehaviorLens;
}) {
  const t = useDashboardT();
  const lang = useUiLanguage();
  // rangeStart/rangeEnd are calendar-day keys, not instants: read back at local
  // noon and written in the reader's language, so the provenance line does not
  // print "2026-09-13" under a page that writes dates as "13 Sep 2026".
  const rangeFrom = formatDateLocal(dayKeyAsLocalDate(model.rangeStart), lang);
  const rangeTo = formatDateLocal(dayKeyAsLocalDate(model.rangeEnd), lang);
  const prov = t.fbProv('items', model.contentCount, rangeFrom, rangeTo);
  const { runs, skew, returns, amplification: amp, advertiser: adv, chains, voices, cautions } = model;

  const skewMax = Math.max(skew.openPct, skew.closePct, 1);
  const ampSegments = ([
    { key: 'high', n: amp.high, color: TONE.ink },
    { key: 'normal', n: amp.normal, color: TONE.mid },
    { key: 'low', n: amp.low, color: TONE.light },
    { key: 'unknown', n: amp.unknown, color: 'var(--fw-muted)' },
  ] as const).filter((s) => s.n > 0);
  const chainMax = Math.max(1, ...chains.handoffs.map((p) => p.n), ...chains.sustained.map((p) => p.n));

  const cautionLine = (c: Caution): { text: string; ev: string } => {
    switch (c.kind) {
      case 'run':
        return { text: t.fbCautionRun, ev: t.fbCautionRunEv(c.length, formatTimeLocal(c.endAt, lang)) };
      case 'return':
        return { text: t.fbCautionReturn, ev: t.fbCautionReturnEv(c.flagged, c.total, c.pct, c.basePct) };
      case 'amplification':
        return { text: t.fbCautionAmp, ev: t.fbCautionAmpEv(c.high, c.total, c.pct) };
      case 'chain':
        return { text: t.fbCautionChain, ev: t.fbCautionChainEv(t.techniqueLabel(c.a), t.techniqueLabel(c.b), c.n) };
    }
  };
  const predClause: Record<'run' | 'return', string> = {
    run: t.fbPredClauseRun,
    return: t.fbPredClauseReturn,
  };

  return (
    <div className="fb-grid">

      {/* ── Level 1a: unbroken runs ── */}
      <FbCard title={t.fbRunsTitle} span={7} empty={runs.length === 0 ? t.fbRunsNone : undefined}>
        <div className="fb-card-sub">{t.fbRunsSub}</div>
        {runs.length === 0 ? (
          <></>
        ) : (
          <>
            <div className="fb-stat-line">
              {t.fbRunsLead} <span className="hi">{t.fbRunsCount(runs.length)}</span>
              {runs.endAt ? t.fbRunsEnding(formatTimeLocal(runs.endAt, lang)) : '.'}
            </div>
            <div className="fb-stat-note">{t.fbRunsNote(model.baseRatePct)}</div>
            <LensCap text={t.fbRunsCap(lens, runs.length, model.baseRatePct)} />
          </>
        )}
        <Prov text={prov} />
      </FbCard>

      {/* ── Level 1b: in-sitting position skew ── */}
      <FbCard title={t.fbSkewTitle} span={5} empty={skew.bigSessions === 0 ? t.fbSkewNone : undefined}>
        <div className="fb-card-sub">{t.fbSkewSub(skew.bigSessions, skew.totalSessions)}</div>
        {skew.bigSessions === 0 ? (
          <></>
        ) : (
          <>
            {([
              [t.fbSkewOpen, skew.openPct, skew.openFlagged, skew.openTotal],
              [t.fbSkewClose, skew.closePct, skew.closeFlagged, skew.closeTotal],
            ] as const).map(([label, pct, f, n]) => (
              <div key={label} className="fb-skew-row">
                <span className="fb-skew-label">{label}</span>
                <span className="fb-skew-track">
                  <span className="fb-skew-fill" style={{ width: `${(pct / skewMax) * 100}%` }} />
                </span>
                <span className="fb-skew-num">{t.fbSkewNum(pct, f, n)}</span>
              </div>
            ))}
            <LensCap text={t.fbSkewCap(lens, skew.lean, skew.openPct, skew.closePct)} />
          </>
        )}
        {/* The rows above count the first and last thirds of long sittings; the caption gives only the days, since no set name fits that subset. */}
        <Prov text={t.fbProvRange(rangeFrom, rangeTo)} />
      </FbCard>

      {/* ── Level 2: the return after quiet ── */}
      <FbCard title={t.fbReturnTitle} span={6} empty={returns.total === 0 ? t.fbReturnNone : undefined}>
        <div className="fb-card-sub">{t.fbReturnSub}</div>
        {returns.total === 0 ? (
          <></>
        ) : (
          <>
            <div className="fb-stat-line">
              <span className="mid">{t.fbReturnStatN(returns.flagged, returns.total)}</span>
              {t.fbReturnStatTail(returns.pct)}
            </div>
            <div className="fb-stat-note">{t.fbReturnNote(model.baseRatePct, returns.total)}</div>
            <LensCap text={t.fbReturnCap(lens, returns.pct, model.baseRatePct, returns.total)} />
          </>
        )}
        <Prov text={t.fbProv('items', returns.total, rangeFrom, rangeTo)} />
      </FbCard>

      {/* ── Level 3: amplification + advertiser placement ── */}
      <FbCard title={t.fbAmpTitle} span={6} empty={amp.total === 0 && adv.total === 0 ? t.fbAmpNone : undefined}>
        <div className="fb-card-sub">{t.fbAmpSub}</div>
        {amp.total === 0 && adv.total === 0 ? (
          <></>
        ) : (
          <>
            {amp.total > 0 && (
              <>
                <div className="fb-segbar">
                  {ampSegments.map((s) => (
                    <div key={s.key} className="seg" title={`${t.fbAmpSeg(s.key)} ${s.n}`}
                      style={{ width: `${(s.n / amp.total) * 100}%`, background: s.color }} />
                  ))}
                </div>
                <div className="fb-seg-legend">
                  {ampSegments.map((s) => (
                    <span key={s.key}><span className="sw" style={{ background: s.color }} aria-hidden="true" />{t.fbAmpSeg(s.key)} {s.n}</span>
                  ))}
                </div>
              </>
            )}
            {adv.total > 0 && (
              <>
                <div className="fb-stat-line" style={{ marginTop: 12 }}>
                  <span className="mid">{t.fbAmpAdvN(adv.forYou, adv.total)}</span>
                  {t.fbAmpAdvTail}
                </div>
                <div className="fb-stat-note">{t.fbAmpAdvNote}</div>
              </>
            )}
            <LensCap text={t.fbAmpCap(lens, pct1(amp.high, amp.total), amp.total, pct1(adv.forYou, adv.total))} />
          </>
        )}
        <Prov text={`${t.fbAmpProvCounts(amp.total, adv.total)} · ${t.fbProvRange(rangeFrom, rangeTo)}`} />
      </FbCard>

      {/* ── Level 4a: technique hand-offs ── */}
      <FbCard title={t.fbChainsTitle} span={7} empty={chains.handoffs.length === 0 && chains.sustained.length === 0 ? t.fbChainsNone : undefined}>
        <div className="fb-card-sub">{t.fbChainsSub}</div>
        {chains.handoffs.length === 0 && chains.sustained.length === 0 ? (
          <></>
        ) : (
          <>
            {chains.handoffs.map((p) => (
              <ChainRow key={`${p.a}>${p.b}`} pair={p} maxN={chainMax} tag={t.fbChainHandoff} />
            ))}
            {chains.sustained.map((p) => (
              <ChainRow key={`${p.a}=${p.b}`} pair={p} maxN={chainMax} tag={t.fbChainSustained} />
            ))}
            <LensCap text={t.fbChainsCap(lens)} />
          </>
        )}
        {chains.unnamedPairs > 0 && (
          <div className="fb-stat-note">{t.fbChainsUnnamed(chains.unnamedPairs, chains.totalPairs)}</div>
        )}
        <Prov text={t.fbChainsProvPairs(chains.totalPairs)} />
      </FbCard>

      {/* ── Level 4b: recurring voices ── */}
      <FbCard title={t.fbVoicesTitle} span={5} empty={voices.length === 0 ? t.fbVoicesNone : undefined}>
        <div className="fb-card-sub">{t.fbVoicesSub}</div>
        {voices.length === 0 ? (
          <></>
        ) : (
          <>
            <table className="fb-plain">
              <thead>
                <tr>
                  <th>{t.fbVoicesColAccount}</th>
                  <th>{t.fbVoicesColDays}</th>
                  <th>{t.fbVoicesColSeen}</th>
                </tr>
              </thead>
              <tbody>
                {voices.map((v) => (
                  <tr key={`${v.platform}:${v.author}`}>
                    <td>
                      <span className="fb-pf-dot" title={PLATFORM_LABEL[v.platform] ?? v.platform}
                        style={{ background: PLATFORM_COLOR[v.platform] ?? 'var(--fw-muted)' }} />
                      {v.author}
                    </td>
                    <td className="num">{v.days}</td>
                    <td className="num">{v.seen}{v.flagged > 0 ? ` · ${t.fbVoicesFlaggedShort(v.flagged)}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <LensCap text={t.fbVoicesCap(lens)} />
          </>
        )}
        <Prov text={t.fbVoicesProv(voices.length, model.namedSources)} />
      </FbCard>

      {/* ── Level 5: the cautious reading (labeled interpretation) ── */}
      <FbCard title={t.fbCautionTitle} span={12} interp tag={t.fbCautionTag}>
        <div className="fb-card-sub">{t.fbCautionSub}</div>
        {cautions.length === 0 ? (
          <div className="fb-stat-note">{t.fbCautionNone}</div>
        ) : (
          cautions.map((c, i) => {
            const { text, ev } = cautionLine(c);
            return (
              <div key={c.kind} className="fb-caution-item">
                <span className="n" aria-hidden="true">{i + 1}</span>
                <div>{text}<div className="ev">{ev}</div></div>
              </div>
            );
          })
        )}
        {model.predictionClauses.length > 0 && (
          <div className="fb-pred">
            <span className="tag">{t.fbPredTag}</span>
            {t.fbPredLead}
            {model.predictionClauses.map((k) => predClause[k]).join(t.fbPredJoin)}
            {t.fbPredTail}
          </div>
        )}
        <LensCap text={t.fbCautionCap(lens)} />
      </FbCard>

    </div>
  );
}

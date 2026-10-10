// The tab body, and the thing that stops one bad panel taking the dashboard.
//
// A tester on a licensed install reported the Issues tab going blank with no
// way back (2026-09-18). That is what a React tree does when a render throws
// and nothing catches it: the WHOLE tree unmounts, so the tab strip, the header
// and every other panel go with it, and there is no control left to press. The
// dashboard had no error boundary anywhere, so this was true of all eight tabs
// and had been since the first one was written.
//
// A boundary here rather than one around the whole dashboard on purpose: the
// point is that the eight panels are independent, and a panel that cannot draw
// itself should cost the reader that panel and nothing else. The record is not
// at risk either way, and the fallback says so, because "something went wrong"
// on a product whose whole claim is an intact record reads as "your record is
// gone" to the person holding it.
//
// It also carries the tabpanel role and the `dash-panel-<id>` id that TabBtn's
// aria-controls has been pointing at since the accessibility pass of the same
// morning, where it pointed at nothing.

import React from 'react';
import type { ReactNode } from 'react';
import type { TabId } from './TabBtn';
import { useDashboardT } from '../../../i18n/react';

interface Props {
  id: TabId;
  children: ReactNode;
  /** Injected by the wrapper below so the class component can read the words. */
  t: ReturnType<typeof useDashboardT>;
}

interface State {
  /** The error's own message, or '' when the panel is drawing normally. */
  message: string;
  /** Bumped by Try again, to force a fresh subtree rather than a re-render. */
  attempt: number;
}

class TabPanelBoundary extends React.Component<Props, State> {
  state: State = { message: '', attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    const message = error instanceof Error && error.message ? error.message : String(error);
    // Capped: this line is rendered, and a stack-shaped message from a minified
    // bundle can be thousands of characters of noise over the sentence that
    // tells the reader their record is fine.
    return { message: message.slice(0, 300) };
  }

  componentDidCatch(error: unknown, info: unknown): void {
    // The console is where a session or a tester reading the report looks, and
    // it is the only place the stack survives. Never swallowed silently: a
    // panel that fails without a word is the defect this file exists to close.
    console.error('[fw] dashboard panel failed', this.props.id, error, info);
  }

  render(): ReactNode {
    const { t, id, children } = this.props;
    if (!this.state.message) return <React.Fragment key={this.state.attempt}>{children}</React.Fragment>;
    return (
      <div className="fw-panel-failed" role="alert">
        <h3>{t.tabCrashTitle}</h3>
        <p>{t.tabCrashBody}</p>
        <p className="fw-panel-failed-detail">{t.tabCrashDetail(this.state.message)}</p>
        <button
          type="button"
          className="btn"
          onClick={() => this.setState((s) => ({ message: '', attempt: s.attempt + 1 }))}
        >
          {t.tabCrashRetry}
        </button>
        <span className="fw-panel-failed-id">{id}</span>
      </div>
    );
  }
}

/**
 * One tab's body. Everything a tab renders goes inside one of these.
 *
 * The key on the boundary is the tab id, so moving to another tab and back
 * builds a fresh boundary: a panel that failed once is not held in its failed
 * state for the rest of the session.
 */
export function TabPanel({ id, children }: { id: TabId; children: ReactNode }) {
  const t = useDashboardT();
  return (
    <div id={`dash-panel-${id}`} role="tabpanel" aria-labelledby={`dash-tab-${id}`}>
      <TabPanelBoundary key={id} id={id} t={t}>{children}</TabPanelBoundary>
    </div>
  );
}

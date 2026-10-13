// Home's bottom row, where the owner asked for the look to be chosen, between the version
// and privacy: the version, the three style dots, one theme button, a small contact menu and privacy. The style and
// theme left Settings for this row, so the look is changed where it is seen. The contact menu holds the two mail links
// Home carried as lines ("Something still showing? Tell us" and "Write to the maker"); a Home with four things on it
// had no room for them as text.

import { useEffect, useRef, useState } from 'react';
import { usePopupT } from '../../i18n/react';
import { type DashboardTheme, type FWSettings, saveSettings } from '../../storage/settings';
import { Contrast, MessageCircle, Moon, Sun } from '../shared/icons/lucide';
import { applyTheme } from '../shared/theme';
import { getFwVersion } from './fw-version';
import { POPUP_LOOKS, type PopupLook, applyLook, isPopupLook } from '../shared/looks';
import { rovingGroup } from './controls';

/** The theme the one button moves to next: dark, light, then the browser's own. */
export const NEXT_THEME: Record<DashboardTheme, DashboardTheme> = { dark: 'light', light: 'system', system: 'dark' };

export function LookDots({ settings, onChange }: { settings: FWSettings; onChange?: () => Promise<void> | void }) {
  const t = usePopupT();
  const [look, setLook] = useState<PopupLook>(isPopupLook(settings.popupLook) ? settings.popupLook : 'a');
  const names: Record<PopupLook, string> = { a: t.lookA, b: t.lookB, c: t.lookC, d: t.lookD, e: t.lookE };
  const name = (l: PopupLook): string => names[l];
  const pick = async (next: PopupLook): Promise<void> => {
    applyLook(next);
    setLook(next);
    await saveSettings({ popupLook: next });
    await onChange?.();
  };
  // The dots are one Tab stop; the arrow keys move to the next look and show it, which is what pressing it does.
  const roving = rovingGroup(POPUP_LOOKS.indexOf(look), (i) => { void pick(POPUP_LOOKS[i]); });
  return (
    <span className="look-row" role="radiogroup" aria-label={t.lookAria} title={t.lookAria} onKeyDown={roving.onKeyDown}>
      {POPUP_LOOKS.map((l, i) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={look === l}
          tabIndex={roving.tabIndexOf(i)}
          aria-label={name(l)}
          title={name(l)}
          className="look-btn"
          onClick={() => { void pick(l); }}
        >
          <span className={'look-swatch ' + l} aria-hidden={true} />
        </button>
      ))}
    </span>
  );
}

export function ThemeButton({ settings, onChange }: { settings: FWSettings; onChange?: () => Promise<void> | void }) {
  const t = usePopupT();
  const [theme, setTheme] = useState<DashboardTheme>(settings.dashboardTheme ?? 'dark');
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Contrast;
  const label = `${t.themeAria}: ${theme === 'light' ? t.themeLight : theme === 'dark' ? t.themeDark : t.themeAuto}`;
  return (
    <button
      type="button"
      className="theme-icon-btn foot-theme"
      aria-label={label}
      title={label}
      onClick={() => { void (async () => {
        const next = NEXT_THEME[theme];
        applyTheme(next);
        setTheme(next);
        await saveSettings({ dashboardTheme: next });
        await onChange?.();
      })(); }}
    >
      <Icon size={14} aria-hidden={true} />
    </button>
  );
}

/** A small menu of the two mail links; it opens upward from the bottom row and closes on a click outside or Escape.
 *  Closed, it stays in the page as hidden, so the links exist for anything that reads the page without pressing. */
export function ContactMenu({ reportHref, makerHref }: { reportHref: string; makerHref: string }) {
  const t = usePopupT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  // A plain disclosure: a button that shows two links. Escape closes it and puts focus back on the button.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <span
      className="contact"
      ref={box}
      // A Tab out of the button or the last link closes the menu, so it never stays open behind the focus.
      onBlur={(e) => { if (open && !box.current?.contains(e.relatedTarget as Node | null)) setOpen(false); }}
    >
      <button
        ref={btn}
        type="button"
        className="theme-icon-btn"
        aria-label={t.contactAria}
        title={t.contactAria}
        aria-expanded={open}
        aria-controls="fw-contact-links"
        onClick={() => setOpen(o => !o)}
      >
        <MessageCircle size={14} aria-hidden={true} />
      </button>
      <span className="contact-menu" id="fw-contact-links" hidden={!open}>
        <a href={reportHref}>{t.contactReport}</a>
        <a href={makerHref}>{t.makerLink}</a>
      </span>
    </span>
  );
}

export function HomeFoot({ settings, onChange, reportHref, makerHref }: {
  settings: FWSettings;
  onChange?: () => Promise<void> | void;
  reportHref: string;
  makerHref: string;
}) {
  const t = usePopupT();
  return (
    <div className="foot home-foot">
      <span className="foot-version">{getFwVersion()}</span>
      <span className="foot-mid">
        <LookDots settings={settings} onChange={onChange} />
        <span className="foot-sep" aria-hidden={true} />
        <ThemeButton settings={settings} onChange={onChange} />
        <ContactMenu reportHref={reportHref} makerHref={makerHref} />
      </span>
      <a href="https://feelingwise.org/privacy" target="_blank" rel="noopener noreferrer">{t.privacy}</a>
    </div>
  );
}

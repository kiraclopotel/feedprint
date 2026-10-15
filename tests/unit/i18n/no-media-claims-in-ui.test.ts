// The media features were removed in 2.5.0, and the interface must not keep
// promising them. This exists because the removal sweep grepped for the
// provider names (Gemini, Whisper) and the setting keys, and therefore missed
// two strings that never named either: the popup's unlock line still offered
// "AI rewrites and media checks", and the master-breaker note still said no
// text, image OR VIDEO is sent. The owner found both in the shipped popup on
// 2026-09-04, in Romanian.
//
// Scope, deliberately narrow: strings that describe what the product CAN DO
// NOW. Dashboard strings that render historical records (a pre-2.5.0 record's
// videoContext scene, the media-status badges, the Images rail) are exempt by
// key name, because those records still exist and still have to be readable.

import { describe, expect, it } from 'vitest';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../src/i18n';

/**
 * Any media noun, in any of the four interface languages.
 *
 * Deliberately blunt rather than clever. Two earlier drafts tried to match the
 * SHAPE of the claim ("media checks", "reads the video") and both let the real
 * defect through: `\w` does not match `ă`, so "verificările media" slipped past
 * a stem pattern, and "Interprets the pictures in posts" matched no verb list.
 * A noun list plus an explicit key allowlist cannot be outflanked by phrasing,
 * and the cost of the bluntness is a short allowlist that a reviewer can read.
 */
const MEDIA_CLAIM = new RegExp(
  '(^|[^\\p{L}])(' + [
    'media', 'm[íi]dia', 'medios',
    'v[íi]deo', 'video(uri|clip|clipuri|s)?', 'v[íi]deos',
    'image', 'images', 'imagen', 'im[áa]genes', 'imagem', 'imagens',
    'imagine', 'imagini', 'imaginilor',
    'picture', 'pictures', 'foto', 'fotos', 'fotografii', 'fotografiile',
    'frame', 'frames', 'cadre', 'cadru', 'cadrele',
    'audio', '[áa]udio', 'sunet', 'sunetul',
    'transcri\\p{L}*',
  ].join('|') + ')([^\\p{L}]|$)',
  'iu',
);

/**
 * Keys whose value legitimately mentions video or images because it is about
 * something else entirely: blocking short-video surfaces, the platform-wide
 * timeout, or the mode descriptions. Listed one by one so a NEW key carrying a
 * media claim cannot hide behind a pattern.
 */
const ALLOWED_KEYS = new Set<string>([
  // "social media", the idiom, in the Off tagline.
  'offTagline',
  // Blocking short-video surfaces and the platform-wide timeout are live
  // features that legitimately name video.
  'featBlockReelsName', 'featBlockReelsDesc',
  'featMediaTimeoutName', 'featMediaTimeoutDesc',
  'featBlockAiContentName', 'featBlockAiContentDesc',
  // The YouTube switches hide the home grid of videos and the recommended videos: video is what they remove.
  'featHideHomeFeedDesc', 'featHideRecommendedName', 'featHideRecommendedDesc',
  // The consent screen's list of what is never sent to the AI provider.
  'consentWhatDoesNot',
  // Home's sentence that the videos a person watches are NOT counted: it names video to deny it.
  'homeReadNotCounted',
  // Silent's sentence that the videos listed on YouTube search pages are NOT checked: it names video to deny it.
  'levelSentenceChild',
]);

describe('the popup makes no claim the build cannot back', () => {
  for (const lang of UI_LANGUAGES) {
    it(`${lang}: no string offers video, audio or image reading`, () => {
      const table = POPUP_STRINGS[lang] as unknown as Record<string, unknown>;
      const offenders: string[] = [];
      for (const [key, value] of Object.entries(table)) {
        if (typeof value !== 'string') continue;
        if (ALLOWED_KEYS.has(key)) continue;
        if (MEDIA_CLAIM.test(value)) offenders.push(`${key}: ${value}`);
      }
      expect(offenders, `media claims left in ${lang}`).toEqual([]);
    });
  }

  it('every language says the same thing about what the AI reads', () => {
    for (const lang of UI_LANGUAGES) {
      const t = POPUP_STRINGS[lang];
      expect(t.featAiMasterOffNote.length, `${lang} featAiMasterOffNote`).toBeGreaterThan(0);
    }
  });

  // The measure is checked against the real defect before its passes are
  // believed. Every string below is verbatim what shipped before 2026-09-04,
  // in the language it shipped in. The first draft of MEDIA_CLAIM passed all
  // four language tables while failing to match the Romanian line the owner
  // actually reported, which is the failure mode this locks out.
  it.each([
    ['en unlock line', 'Add a license key to turn on AI rewrites and media checks.'],
    ['ro unlock line', 'Adăugați o cheie de licență pentru a porni rescrierile AI și verificările media.'],
    ['es unlock line', 'Añade una clave de licencia para activar las reescrituras con IA y las comprobaciones de medios.'],
    ['pt-BR unlock line', 'Adicione uma chave de licença para ligar as reescritas com IA e as verificações de mídia.'],
    ['en master-off note', 'AI checks are off: no text, image or video is sent anywhere and nothing is spent.'],
    ['ro master-off note', 'Verificările AI sunt oprite: niciun text, nicio imagine și niciun video nu este trimis nicăieri și nimic nu se cheltuiește.'],
    ['en video toggle', 'Interprets supported short videos: on-screen text and audio. Frames and ~20s of audio are sent for safety interpretation when on.'],
    ['en image toggle', 'Interprets the pictures in posts: text written on images and what they show.'],
  ])('would have caught the %s that shipped before the removal', (_label, shipped) => {
    expect(MEDIA_CLAIM.test(shipped)).toBe(true);
  });
});

// The topics a person can switch off (Topics U1, 13 Oct 2026). Lives in the types layer so the matcher
// (src/core/policy/topic-lexicon.ts), the words (src/i18n/marker-strings.ts), the record and the settings name the same ones.
// A topic is a written list of words, phrases and brands per language, matched with no model; each has one switch.

import type { FeatureId } from './feature-id';

export type TopicId = 'gambling';

export const TOPIC_IDS: readonly TopicId[] = ['gambling'];

/** The feature switch that turns each topic on. Off in every preset: a person turns a topic on, a level never does. */
export const TOPIC_FEATURE: Readonly<Record<TopicId, FeatureId>> = {
  gambling: 'topic-gambling',
};

/** The topic switches as feature ids: the person's own choices, which a level or a reset does not change. */
export const TOPIC_FEATURE_IDS: readonly FeatureId[] = TOPIC_IDS.map((t) => TOPIC_FEATURE[t]);

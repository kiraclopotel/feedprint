import { TechniqueClassifier } from './types';
import { fearAppealClassifier } from './fear-appeal';
import { shameAttackClassifier } from './shame-attack';
import { angerTriggerClassifier } from './anger-trigger';
import { falseUrgencyClassifier } from './false-urgency';
import { bandwagonClassifier } from './bandwagon';
import { scapegoatingClassifier } from './scapegoating';
import { fomoClassifier } from './fomo';
import { toxicPositivityClassifier } from './toxic-positivity';
import { misleadingFormatClassifier } from './misleading-format';
// Aimed at young users.
import { bodyComparisonPrimingClassifier } from './body-comparison-priming';
import { parasocialCoercionClassifier } from './parasocial-coercion';
import { consumerRapidFrameClassifier } from './consumer-rapid-frame';
import { hyperrealTraumaBaitClassifier } from './hyperreal-trauma-bait';
// Harm categories. They are not manipulation techniques; the harm floor scores on top of them.
import { combinedStackClassifier } from './combined-stack';
import { sexualClassifier } from './sexual';
import { violenceGraphicClassifier } from './violence-graphic';
import { selfHarmClassifier } from './self-harm';
import { drugPromotionClassifier } from './drug-promotion';
import { unsafeHealthExperimentClassifier } from './unsafe-health-experiment';
import { extremeToxicityClassifier } from './extreme-toxicity';

export { classifyCombined } from './combined';

// combined is not here: it scores the results of these.
export const classifiers: TechniqueClassifier[] = [
  fearAppealClassifier,
  shameAttackClassifier,
  angerTriggerClassifier,
  falseUrgencyClassifier,
  bandwagonClassifier,
  scapegoatingClassifier,
  fomoClassifier,
  toxicPositivityClassifier,
  misleadingFormatClassifier,
  bodyComparisonPrimingClassifier,
  parasocialCoercionClassifier,
  consumerRapidFrameClassifier,
  hyperrealTraumaBaitClassifier,
  combinedStackClassifier,
  sexualClassifier,
  violenceGraphicClassifier,
  selfHarmClassifier,
  drugPromotionClassifier,
  unsafeHealthExperimentClassifier,
  extremeToxicityClassifier,
];

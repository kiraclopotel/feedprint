import { filterProfanity } from './profanity-filter';
import { detectAdHominemToken } from './harm-floor';

/**
 * The last check on text a model wrote, before it is shown. A rewrite is FeelingWise speaking in
 * its own voice, so it may hold no profanity, slur or insult in any mode: the modes set what the
 * platform's content may say, never what FeelingWise says. The insult check is there because
 * "Un.idiot" came back as "Cred că persoana este un idiot." (I think the person is an idiot),
 * which is no profanity. Returns the first offending term, for the log, or null.
 */
export function detectUnsafeVisibleLanguage(text: string): string | null {
  const result = filterProfanity(text, 'teen');
  if (result.matches.length > 0) return result.matches[0];
  return detectAdHominemToken(text);
}

/**
 * Every reader of the flag verdict imports from here: carriesFlagVerdict, carriesHideVerdict, isRepeatMarkOnly and
 * isCountedFlagVerdict. They live in export-numbers.ts, the one file under src/ that compares a verdict to the flag
 * words (tests/repo/the-flag-verdict-has-one-reader.test.ts fails the build on any other, outside its named
 * exemptions), because that file has no runtime import and the chain analyzer loads it with plain node. A rule about
 * what counts as a flag is written once (the Head, 10 Oct 2026, after "seen a lot" had to be taken out of fifteen
 * places one by one).
 */
export { carriesFlagVerdict, carriesHideVerdict, isCountedFlagVerdict, isRepeatMarkOnly } from './export-numbers';

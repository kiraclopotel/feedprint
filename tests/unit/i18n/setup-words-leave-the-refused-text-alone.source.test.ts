// SETUP-WORDS check 5 (board/units/SETUP-WORDS.md): the text the head refused to touch stays byte for byte what master 3387e13e holds,
// in English and in the three other tables: the Welcome's sentences on who gets the fingerprint, the PIN paragraphs, the recovery body
// and its Off twin, the Moderate data paragraph with its heading and Strict twin, the consent screen. The license screen and its note left
// setup with the licence step: setup runs with no key, so it names no AI (a-free-setup-says-no-ai-word.test.tsx).
// Each row is the sha-256 of the key's source text (its line, or lines when the value runs on) in src/i18n/popup/<table>.ts.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { repoPath } from '../../helpers/repo-root';

const MASTER: Record<string, string> = {
  'en|setupWelcomeBody1': 'dedc8189a17be91bf1f05c9b231a41e9917ef37b2adf437f2d425eed96443e30', // 12 Oct 2026, packet 33: says what each level sends, and that the rephrasing needs a key for Live Rephrase
  'en|setupPinBody': 'b8b858d90607fabbeafcd1392b6c5f837b2cf9b909bce209c79ea5fb5a485bc2', // names the level Silent
  'en|setupPinBodyModerate': '420085cfecc3ba6e02d7ea69c30e8ccfd65b57e230061d399269e7425cbc4ae8',
  'en|setupRecoveryBody': 'f715b1c0bd13fd803b0d5efacc040c3b778e589777b1fe5ce35a30348576d9d8', // the release that names Receipts Feedprint
  'en|setupRecoveryBodyOff': 'cdb52104d7b2b89035989e1006799784e477fe6e0db737f454df0f5fd1259435',
  'en|setupWhereSecretsNote': 'f09ca11658af56e1a570b3420a695e5cfab85f88d7e1c57d2a8d3ce98b294759',
  'en|setupWhereSecretsTitle': '887e936bab17d9bea1af0f0736aeecba8777585e261c822c70c1dcd3d81ef959',
  'en|consentTitle': 'c9f9cec91ef4042fc742014f14b7d0a44125820000e5fcf2dfe885a4d8eac1f3', // 11 Oct 2026: the feature is named Live Rephrase (words method, crew/site/words-2026-10-11 packet 15)
  'en|consentWhy': 'cb403560cd1be11334331797485887564b1ab537c2c4821fceadf7664aa0cd8d',
  'en|consentWhatGoes': 'ca47e183b1007ebf96c2ef595a3e2c33e3da57d319ef962cb34376512bfb331c',
  'en|consentToWhom': '7af057fd42e34acd7e6f9ad2595da5ab44edf742823226bf4fdf6ce52e1f9387',
  'en|consentProviderUnknown': 'f90c742e3cbbc49ea4b04166516af1572572f9d583834a912f74d066073e1606', // 11 Oct 2026: the feature is named Live Rephrase (words method, crew/site/words-2026-10-11 packet 15)
  'en|consentWhatDoesNot': 'b31fec085513d16045d775fa3e54ada4c16d0c12586bd80dfa3ef73da06214ee',
  'en|consentMoney': 'f12c074904b4acabe8ec1efb3dfbd5bacdf6433b3392010300dfb8aba74918a1',
  'en|consentStart': '51723c1ae084c0ce9d1581a535d76f0a162a35be008510c2107809827e90bccf', // 11 Oct 2026: the feature is named Live Rephrase (words method, crew/site/words-2026-10-11 packet 15)
  'en|consentNotNow': '45d9b9d29f41c218b37a504768fc3f023e4dd25e877b43e95dd0d639ae75d326',
  'es|setupWelcomeBody1': '8c1b56286e32182247c97f56cb10fe3109a109d84f57df9807e32c061bc6dc1c', // 12 Oct 2026, packet 33: says what each level sends, and that the rephrasing needs a key for Live Rephrase
  'es|setupPinBody': '1d5c8ea10819ee531a5c9b8b233106063eaa9a62b9605a2528ac2d41c490ee26', // names the level Silencioso
  'es|setupPinBodyModerate': 'df1ca7daaa994941e6bda2db031553b1a9b94c7690fc503a3658159621850c74',
  'es|setupRecoveryBody': '396cfcada9d9a44c90cef084ca87cf2276063376f4a3ded303f95b31fd50d1dd', // the release that names Receipts Feedprint
  'es|setupRecoveryBodyOff': '65517129cff6818df765d1cd001d9f3b79e6f8ee15a320f50c4df449383e69cf',
  'es|setupWhereSecretsNote': 'e982b55936c69e0fb5f339dee29213cb34d1de05900c10b556fe98fb5a9a26d7',
  'es|setupWhereSecretsTitle': '679d99ee76e30109eeb5cd6cbc8ee29b95188836cc88ccffedb5f988faca1881',
  'es|consentTitle': '651fa1a323eb531406e6337c570061a2e1a3e76f1ba02e0bc97ce05bb405ed38', // 11 Oct 2026: the feature is named Live Rephrase (words method, crew/site/words-2026-10-11 packet 15)
  'es|consentWhy': '7198e7721061d94257f62dc87274e2c5a43bcb05d12e4f29eb0725fbb6616fe6',
  'es|consentWhatGoes': '0a724774364688b04b7b469775082c500db303045e11f21ce49d666b745d1484',
  'es|consentToWhom': 'cb87bebe2e248e0f0c68fa616eb3d323d286497e86b2ffcb14430a476b8fff28',
  'es|consentProviderUnknown': '2d6aec3aefa38c243681ccce2a031c58dd5cb70f628b3c85680375c6ba42fd23', // 11 Oct 2026: the feature is named Live Rephrase (words method, crew/site/words-2026-10-11 packet 15)
  'es|consentWhatDoesNot': 'e6829ec41066f11ddcd98841d8414b23cffdd062aff678faa6f3fedd079973b1',
  'es|consentMoney': 'c9874a0314daf16c29f36e6669609d2b05eeca1bce93e352622ea6286f031f0b',
  'es|consentStart': 'ce2bfc7da4ce756acc53d8dac92b6c2ae5e084294714b69a47845b7b8df31615', // 11 Oct 2026: the feature is named Live Rephrase (words method, crew/site/words-2026-10-11 packet 15)
  'es|consentNotNow': '230802ddcec8e8af0fba8cdf08d7052b5f0514b927c3978ba7a6dafb1c24501c',
  'pt-br|setupWelcomeBody1': 'd06efc1e8e51b8d8a2c2be2ce8494311ccea55b6fedc4cc57c963836377a29e2', // 12 Oct 2026, packet 33: says what each level sends, and that the rephrasing needs a key for Live Rephrase
  'pt-br|setupPinBody': 'df05219433fa75cfb4d8146f57c7853aac1392dbc96ad6b31d66cd6059559a58', // names the level Silencioso
  'pt-br|setupPinBodyModerate': 'e44bf2ee2e410115b2b21f0d454d4efe0de288e5c9050615ad5cfb8faf88079a',
  'pt-br|setupRecoveryBody': '539586709ae1957bc5b8b14a8c3073a656858d50437e2d0cfc2dfed83dd2048b', // the release that names Receipts Feedprint
  'pt-br|setupRecoveryBodyOff': '346b909cd0a86e077afee8f90bf3e2944f23b048e6e79a3e338feb594cf7e836',
  'pt-br|setupWhereSecretsNote': '91bab64d08fac9c80e6862ccc95b1a2986ed65bef2c4f7b22e564772efced29b',
  'pt-br|setupWhereSecretsTitle': 'e9b6aa3439fae5d6d8a935e0897f77533db4b60f554242fb727a5956e78ed1ec',
  'pt-br|consentTitle': 'bba2c265cb4edc378edfe193f99f5cc0c83d9eee09cb97f6bd931d4acf7e0a34', // 11 Oct 2026: the feature is named Live Rephrase (words method, crew/site/words-2026-10-11 packet 15)
  'pt-br|consentWhy': 'f2c3b41700a8cf9ff6341ab9555753d5136da7b7d16de12e8532554908790fc5',
  'pt-br|consentWhatGoes': '905418cb83a205a3c50cbacde6a0c12450941ad1c3bf1f54b5de920885eedcc9',
  'pt-br|consentToWhom': '10b07a37270af811b0859a191687c9365fb4df3eabcf093d6bd3a17351f2bbaf',
  'pt-br|consentProviderUnknown': 'c3285e27a6224fe8285e591ed5b03b275da18f30940d4140792df6911d3036d2', // 11 Oct 2026: the feature is named Live Rephrase (words method, crew/site/words-2026-10-11 packet 15)
  'pt-br|consentWhatDoesNot': '41214c47d9d0b911e6513351fc4ca58018b6c7fca8109b4601315e99c1b6a110',
  'pt-br|consentMoney': '258c9c604a3cc02e72a58a4f2b934c889e7728d12d22f55621954aabe6f02af7',
  'pt-br|consentStart': 'f5f7a72f7f77340194452c210e71b492c0ecdfee14c5afcf4be50a559889c5c5', // 11 Oct 2026: the feature is named Live Rephrase (words method, crew/site/words-2026-10-11 packet 15)
  'pt-br|consentNotNow': '450045b31e84df0d69147bb38ed6f6c5756d7f5d1c986e3bda63fc3b3aaa61e3',
  'ro|setupWelcomeBody1': '8113b6112adc70c9aaf707e8708b3bade124fa18aeedee84f246dbc8a5d693b1', // 12 Oct 2026, packet 33: says what each level sends, and that the rephrasing needs a key for Live Rephrase
  'ro|setupPinBody': '71f9b8fe5140e6cac4540d889a9ed97f08c004e42b75bb75e5e332a25d1382b1', // names the level Silențios
  'ro|setupPinBodyModerate': '2a39cd70d2839789f293248c7fc85d764d1f90c1e363037fa5d4a81918ce4685',
  'ro|setupRecoveryBody': '186991bc5d7af0d0e59a2d2d5beb1395bebda6962d63a220a3f5d183577fc604', // the release that names Receipts Feedprint
  'ro|setupRecoveryBodyOff': '2095373cd3131d39dac8409fbd4a22ecc345555dc6aceca08e7331ef17ec3c4b',
  'ro|setupWhereSecretsNote': 'fea258810987a384851d9097912cc70ad8530e832b83ae706e8dbbd954f120fc',
  'ro|setupWhereSecretsTitle': 'f580d602ed206379310cfe88bac9c543d0b724b21d9b08e8b7cbc62a2748cb6a',
  'ro|consentTitle': '2170ada428823eb72d7c4b0a664b979421dec4d04be786b41b5a7835a32ce30a', // 11 Oct 2026: the feature is named Live Rephrase (words method, crew/site/words-2026-10-11 packet 15)
  'ro|consentWhy': '761de0e1c9975940f613b22ed59eafb5648013f08d1c4eb2acfe65a57a18a0f6',
  'ro|consentWhatGoes': '61917a37bcf80332d397c98f5ad74b5139db90cf86ed891a15723c8b0e507bbd',
  'ro|consentToWhom': 'a5a2e06d6bad7129b3d6c916a1ecf079af8179345a696f3b14000e1fbb40ae0f',
  'ro|consentProviderUnknown': '5140b39652d7eda26bde52e2e2e31f286fc135a3753fa6a3de5aa3317a967561', // 11 Oct 2026: the feature is named Live Rephrase (words method, crew/site/words-2026-10-11 packet 15)
  'ro|consentWhatDoesNot': '698fffab7c2f89861f777ab4f1fb094b6a3e0149d22e261db751b10bbc745812',
  'ro|consentMoney': 'a9f03f992fcd9983bc9b8b948776e783b9d0dd151df42757101dca32ad5ed0e6',
  'ro|consentStart': 'd6ddb63c3f74ee608c87a9c6996c5e6bd67d7d096263063de2d0717a13bfddb8', // 11 Oct 2026: the feature is named Live Rephrase (words method, crew/site/words-2026-10-11 packet 15)
  'ro|consentNotNow': 'f12fc5ebba7874a12ee174a9568bc82bb2fcb5310813c14f3f9428df13c37718',
};

const KEY_LINE = /^  [A-Za-z0-9_]+:/;
function block(src: string, key: string): string {
  const lines = src.split('\n');
  const i = lines.findIndex(l => l.startsWith(`  ${key}:`));
  if (i < 0) return '';
  let j = i + 1;
  while (j < lines.length && !KEY_LINE.test(lines[j]) && !lines[j].startsWith('};')) j++;
  return lines.slice(i, j).join('\n');
}

describe('the text the head refused to change is unchanged', () => {
  for (const [id, sha] of Object.entries(MASTER)) {
    const [table, key] = id.split('|');
    it(`${table}: ${key}`, () => {
      const src = readFileSync(repoPath('src', 'i18n', 'popup', `${table}.ts`), 'utf8');
      expect(createHash('sha256').update(block(src, key), 'utf8').digest('hex')).toBe(sha);
    });
  }
});

import { isPrivateMessageSurface } from './platforms/adapter';
import { startDocumentStartShield } from './protection/document-start-shield';

async function readStoredMode(): Promise<unknown> {
  if (typeof chrome === 'undefined' || !chrome?.storage?.local?.get) {
    throw new Error('Extension storage unavailable');
  }
  const result = await chrome.storage.local.get('mode');
  return result.mode;
}

startDocumentStartShield({
  isPrivateSurface: isPrivateMessageSurface,
  readMode: readStoredMode,
});

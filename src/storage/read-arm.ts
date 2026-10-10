// "Read this for me" (Adult mode, the recorder). Since 9 Oct 2026 nothing in the popup arms it (the owner's word: the
// button came off Home); what follows is how it worked, and the key the page side still reads.
// The popup armed the reader
// with a timestamp in chrome.storage.local, the visible tab's content script
// takes the next click (content/read-this.ts). No permission is needed for
// this, and the key lives here so the popup (src/ui) never imports from the
// content layer.

export const READ_ARMED_KEY = 'fwReadArmedAt';


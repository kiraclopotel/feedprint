// Turns one of the Tester's saved Instagram element trees (outline of tags with text lengths) into an HTML fixture
// with the same structure: classes dropped, text filled to the recorded length, hrefs rebuilt from their kind and length.
// usage: node tests/fixtures/instagram/from-tree.mjs <tree.html> <out.html>
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inPath, outHtml] = process.argv;
const raw = readFileSync(inPath, 'utf8');

const pre = raw.slice(raw.indexOf('<pre>') + 5, raw.indexOf('</pre>'));
const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const lines = unescape(pre).split('\n').filter((l) => l.trim() !== '');

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'wbr']);
const KEEP = new Set(['role', 'dir', 'tabindex', 'datetime', 'aria-label', 'alt', 'title', 'href']);

let counter = 0;
const handleOf = (len) => ('h' + (++counter).toString(36) + 'abcdefghijklmnopqrstuvwxyz0123456789_.'.repeat(4)).slice(0, Math.max(len, 1));
const wordsOf = (len) => {
  const base = `body${++counter} lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor `.repeat(8);
  return base.slice(0, Math.max(len, 1)).trimEnd().padEnd(Math.max(len, 1), 'x');
};

let commentSeq = 0;
function hrefOf(value, tag) {
  const m = /^len(\d+):(\w+)$/.exec(value);
  if (!m) return value;
  const len = Number(m[1]);
  const kind = m[2];
  if (kind === 'profile') return '/' + 'u'.repeat(0) + handleOf(len - 2) + '/';
  if (kind === 'post') {
    // Long ones are a comment's own link (/p/<11 chars>/c/<17 digits>/ is 35 characters); short ones are a post link.
    if (len < 30) return ('/p/' + 'ZZZpostlink'.repeat(4)).slice(0, len - 1) + '/';
    commentSeq++;
    const idLen = Math.max(len - '/p/ExampleP0st/c//'.length, 1);
    const id = '1' + String(commentSeq).padStart(idLen - 1, '0');
    return '/p/ExampleP0st/c/' + id + '/';
  }
  if (kind === 'explore') return ('/explore/tags/' + 'tagname'.repeat(5)).slice(0, len - 1) + '/';
  return '/' + 'x'.repeat(Math.max(len - 1, 1));
}

const out = [];
const stack = []; // open tags
const roles = []; // the role of each open tag, parallel to stack
function closeTo(level) {
  while (stack.length > level) { out.push(`</${stack.pop()}>`); roles.pop(); }
}

const ancestorsAreProfileLink = [];
for (const line of lines) {
  const indent = line.length - line.trimStart().length;
  const level = indent / 2;
  const t = line.trim();
  closeTo(level);
  const textMatch = /^#text\((\d+)\)$/.exec(t);
  if (textMatch) {
    const len = Number(textMatch[1]);
    const insideLink = stack.includes('a');
    const insideButton = stack.includes('button') || roles.includes('button');
    const insideTime = stack.includes('time');
    // The page's own small words keep their real kind, because the reader tells chrome from a comment by what it says.
    const CHROME = { 5: 'Reply', 4: 'Like' };
    const AGE = { 2: '1w', 3: '12h' };
    if (insideButton && CHROME[len]) out.push(CHROME[len]);
    else if (insideTime && AGE[len]) out.push(AGE[len]);
    else out.push(insideLink ? handleOf(len) : wordsOf(len));
    continue;
  }
  const tagMatch = /^<([a-zA-Z0-9]+)((?:\s+[^>]*?)?)(\/?)>$/.exec(t);
  if (!tagMatch) throw new Error('unreadable line: ' + t.slice(0, 120));
  const [, tag, attrText, selfClose] = tagMatch;
  const attrs = [];
  for (const am of attrText.matchAll(/([a-zA-Z0-9_:-]+)(?:="([^"]*)")?/g)) {
    const [, name, value = ''] = am;
    if (name.startsWith('data-tester-')) { attrs.push(`${name}="${value}"`); continue; }
    if (!KEEP.has(name)) continue;
    let v = value;
    if (name === 'href') v = hrefOf(value, tag);
    else if (name === 'datetime') v = '2026-10-11T06:00:00.000Z';
    else if (name === 'dir') v = 'auto';
    else if (name === 'aria-label' || name === 'alt' || name === 'title') v = 'x'.repeat(Number(value) || 1);
    attrs.push(`${name}="${v}"`);
  }
  out.push(`<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`);
  if (VOID.has(tag) || selfClose) {
    if (!VOID.has(tag)) out.push(`</${tag}>`);
    continue;
  }
  stack.push(tag);
  roles.push((/role="([^"]*)"/.exec(attrText) ?? [])[1] ?? '');
}
closeTo(0);

// Drop the outer <body ...> wrapper: the fixture is what goes inside document.body.
let html = out.join('\n');
html = html.replace(/^<body[^>]*>/, '').replace(/<\/body>\s*$/, '');
writeFileSync(outHtml, html);
console.log(`${outHtml}: ${html.length} bytes`);

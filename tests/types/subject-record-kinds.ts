// A record's kind and its subject body belong together (src/types/record-subject.ts). This file is
// read only by the type checker (tsconfig.tests.json, run before every commit and in CI) and never by
// the test runner: each line below either compiles or is an expected error, so a type that let a kind
// carry another kind's body fails the type check, the one place such a mistake can be caught.

import type {
  ConsentSubject, DocumentSubject, NoteSubject, UnhashedSubjectRecord,
} from '../../src/types/record-subject';

declare const documentBody: DocumentSubject;
declare const consentBody: ConsentSubject;
declare const noteBody: NoteSubject;

const chain = { id: 'x', timestamp: 't', prevRecordHash: '', chainPosition: 0 };

// Each kind with its own body compiles.
export const fits: UnhashedSubjectRecord[] = [
  { ...chain, kind: 'document', subject: documentBody },
  { ...chain, kind: 'consent', subject: consentBody },
  { ...chain, kind: 'note', subject: noteBody },
];

// @ts-expect-error a document under kind 'consent'
export const documentAsConsent: UnhashedSubjectRecord = { ...chain, kind: 'consent', subject: documentBody };
// @ts-expect-error a document under kind 'note'
export const documentAsNote: UnhashedSubjectRecord = { ...chain, kind: 'note', subject: documentBody };
// @ts-expect-error a consent string under kind 'document'
export const consentAsDocument: UnhashedSubjectRecord = { ...chain, kind: 'document', subject: consentBody };
// @ts-expect-error a consent string under kind 'note'
export const consentAsNote: UnhashedSubjectRecord = { ...chain, kind: 'note', subject: consentBody };
// @ts-expect-error a note under kind 'document'
export const noteAsDocument: UnhashedSubjectRecord = { ...chain, kind: 'document', subject: noteBody };
// @ts-expect-error a note under kind 'consent'
export const noteAsConsent: UnhashedSubjectRecord = { ...chain, kind: 'consent', subject: noteBody };
// @ts-expect-error a feed kind with a subject
export const postWithSubject: UnhashedSubjectRecord = { ...chain, kind: 'post', subject: noteBody };

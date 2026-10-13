# Security

## Reporting a problem

Write to support@feelingwise.org with "Security" at the start of the subject. Say what you found, how to
reproduce it, and which version (the extension's version is on `chrome://extensions`; the relay's is at
https://api.feelingwise.org/health). Please do not open a public issue for it first.

FeelingWise is run by one person, so there is no bounty and no promised hour. You get an answer within
seven days, and you are told when the fix ships and whether you want to be named for it.

## What is in scope

- Feedprint and Off, the two Chrome extensions built from this repository (`src/`, both manifests).
- The record format and the independent checker (`verifier/`, and the copy served at feelingwise.org/check).
- The relay at api.feelingwise.org (`worker/`), which the paid reading goes through.
- The site feelingwise.org.

## Testing in good faith

Test against your own install, your own record and your own licence key. Do not read or change anyone
else's data, do not try to guess or use other people's licence keys, and do not load the relay or the
site with traffic meant to slow them down. Research done this way is welcome, and it will not be met
with a complaint.

## What a report should know first

`docs/spec/KNOWN-LIMITS.md` lists what a checked file does and does not establish, and the limits that
are known and accepted. The relay's page, `docs/spec/subsystems/worker.md`, lists its accepted risks.

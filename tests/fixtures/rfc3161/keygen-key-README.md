# keygen-key.json

A P-256 key pair, private half included, made with the key-date tests. No build ships its private half. `keygen-resp.der` beside it is a real time-stamp token over the SHA-256 of this
key's public half, so the tests check a genuine token against a key whose digest they can recompute.

Anyone who reads this folder can sign with this key, so a record signed by it proves nothing about who made it.

The file's own `note` names the commit that generated it and what it signs.

# pentacle-chat-core

The shared TypeScript reducer, transcript model and projections for Pentacle Web
and Mobile. Functions take data and return data; transport, persistence and
device presentation belong to the apps.

## Develop and verify

Use Node 22. From a clean checkout:

```sh
npm ci
npm test
npm run typecheck
python3 scripts/check_public_residue.py
```

There is no compiled package: the main and types entry points both point to
`src/index.ts`, and existing deep imports continue to use the TypeScript source.
`@noble/hashes` validates the existing daemon-notice body digest; it is a locked
runtime dependency. Tests and fixtures use synthetic data.

## Advance a consumer

1. Fix or add behavior here, add a synthetic regression and run the checks.
   Land it on public main first. Record the full commit ID.
2. From a clean consumer checkout, run
   `node pentacle-chat-core/scripts/verified-copy.cjs sync . FULL_UPSTREAM_COMMIT`.
   This replaces the distribution and regenerates `config/pentacle-chat-core-pin.json`
   together. Reinstall consumer dependencies from the lockfile before testing.
   If the shared package metadata changed, regenerate your consumer lockfile.
3. Commit the generated copy, pin and any needed adapter/lockfile changes
   together. Do not hand-edit the copy. Each client can advance independently.
   To roll back a consumer, revert its pin and distributed paths together.

`distribution.json` defines every installed path once, including package
metadata, license, shared source and test fixtures. Consumer-owned lockfiles,
renderers, native manifests and adapters stay outside this distribution.
`check .` verifies local hashes and modes offline. The apps' existing CI jobs
also run the verifier from public core main, independently resolve the pinned
commit on that main and compare its complete distribution. Replacing a local
hash cannot make a modified byte pass this second comparison. The consumer pin
cannot change the public repository. Normal npm builds never fetch upstream Git.

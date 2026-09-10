# Public core identity and validation

The core accepts host identity, order and theme through `setHostConfigProvider`. Without an injected provider, host order comes from stream state and labels are title-cased host IDs. Examples use neutral names; no fleet inventory is built into the package.

Run `npm ci`, `npm test`, `npm run typecheck`, and `python3 scripts/check_public_residue.py` from a clean checkout. Public CI runs the same checks.

The residue check scans tracked UTF-8 content, including its own implementation and configuration. [The exact fixture allowlist](../configs/public_fixture_allowlist.json) documents the only retained anonymizer-era identities: synthetic inputs exercising protocol, rendering and question formatting. They are not runtime defaults. Entries must name tracked test files with a rationale; directory patterns and production exemptions are rejected.

Pentacle's vendored `pentacle-chat-core/src/` is verified byte-for-byte against this repository's `src/` at the commit pinned in Pentacle's public release documentation. Repository-specific build tooling and test metadata are validated in their respective repositories.

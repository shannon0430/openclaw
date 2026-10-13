# Kanon CUA close lifecycle repair — retained canonical packages

These two unchanged tarballs were produced by the normal CUA SDK/native platform packaging workflow from source `db38f9ecbba21322bfee9b73dc7590dae70e6b57`.

Source: https://github.com/shannon0430/cua/pull/1
Build: https://github.com/shannon0430/cua/actions/runs/38452459341

They are retained here because CI artifacts expire, and this maintenance branch must reproduce the exact verified Windows dependency graph. They are not public npm releases or upstream inclusion. Normal pnpm lock resolution and normal whole-package npm installation use these complete packages; no DLL replacement is performed. Package license/NOTICE files remain in the unchanged archives.

SDK/package version is `0.28.2-kanon.20261014.2`; runtime ABI stays `0.28.2`. Only Windows x64 native code changes; other platform optional dependencies stay at stock `0.28.2`. The OpenClaw artifact manifest verifies the corresponding per-platform versions and native hashes.

SDK SHA256: `4270bc2f2d5f263447a9c6632548356688e6eee771d5318c56245f75dd50c3d2`
Windows x64 package SHA256: `456f5356f40ce22d1bf076859ffc7f7beaaf3359c80b82bb9e8eb052329d075f`
DLL SHA256: `c71de67d140485c7676f901b1f9cea8482a614594d40966bf42f1fe70f4e1356`
Unchanged addon SHA256: `93f220e8a5cbf25aff23321f20a868368a204f1026b8dce45c5a4f84290de09f`

Native gate: 24 unit/ABI cases plus one owned-window actual SendInput destruction fixture, followed by canonical Windows package import. These are component checks, not Excel customer acceptance. The code-hosting forks are public; no private/customer content is included. See `provenance.json`.

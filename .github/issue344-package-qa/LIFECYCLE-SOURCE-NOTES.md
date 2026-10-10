# QA-v3 required root lifecycle closure (no install run)

Owning source is exactOpenClaw eb377ac59e6c9fd6c7705028034812becf00271b;
the read-only f3eb source lease byte-equals it for the three recorded files.

`Test-NpmLifecycleCompleted` in scripts/install.ps1 requires ordinary expected
entry and absence of .openclaw-lifecycle-pending and dist/openclaw-install-guard.
The local QA slot is a private cwd envelope, so the measured package root is its
exact node_modules/openclaw, not a presumed global npm root. Root identity is
bound to the created package.json dependency file:artifacts/openclaw.tgz, its
sealed artifact digest and the installed package name, with ordinary path gates.

The owning Get-NpmLifecycleAllowArgument/update-global source selects npm11.16+
allow-scripts policy and exact resolved install-target identity. That global
single-target installer flag is NOT automatically applied to this cwd envelope.
QA-v3 leaves the original one normal npm11.17 install command unchanged; no
allowflag, wildcard permission, dependency blanket approval, npm configuration
write or install/postinstall replay is added.

Parent independently read pinned npm11.17 Arborist rebuild.js229–238: null
allow-scripts entries remain ADVISORY under default strict-allow-scripts=false.
Warnings naming four packages do not establish blocked scripts. Parent also
observed required pending-marker absence in the actual expanded old install,
while the marker was in its original tar. This is consistent with the owning
normal postinstall closure; it is not a per-package execution trace. Oldpackage
QA green is preserved with its explicit incomplete-lifecycle-assertion limit,
not relabelled a lifecycle failure or live eligibility.

QA-v3 adds three read-only exact-root closure checks: before the first public
probe, after the sole owned relocation before next probes, and immediately
before inventory/seal. Any marker type, dangling symlink, legacy guard, unknown
metadata/read denial, missing/unordinary entry, wrong root declaration, or digest
change refuses without any healing/replay. No marker contents are read/printed.
The finite own-synthetic production reader regression group has12cases. It does
not execute npm, OpenClaw scripts, package postinstall, node task, GUI or Excel.

Available local Node22.23.1/macOS validates source seams only. Actual future
WindowsQA remains pinned Node24.19.0/npm11.17.0 and mandatory own fixtures;
private helper-v3 semantics/live/native input/Excel acceptance stay excluded.
Successor native/package eligibility receipts are parent-bound separately; old
f3eb/601ade proofs do not certify the new native candidate. No actual new package
installation, workflow dispatch, source repo change or live action occurred.

# CUA Computer

Experimental computer control through CUA Driver. OpenClaw can observe and
interact with a Gateway desktop or a paired computer. Available actions depend
on the host, driver, and granted permissions.

Thrown native SDK failures reaching this boundary report a bounded
`COMPUTER_DRIVER_ERROR` with the lifecycle
phase and native error kind. Known lifecycle refusal codes are retained; other
codes are `unclassified`. Application messages, tool arguments, and session IDs
are not copied into this diagnostic. An earlier failed physical close retains
its cleanup phase when it blocks a later acquisition; this does not start another
execution, clear the owner, or retry input.

Action evidence is narrower than task completion. `value_readback` confirms the
addressed control's observed property, not application commit or file persistence.
Observe the application after committing an edit and independently verify the
saved file when persistence matters. `unverifiable` means there is no trusted
effect proof; it does not by itself mean delivery failed. If the returned screen
and the diagnostic disagree, preserve both facts and inspect the same action's
outcome before any further input. Do not blindly repeat a commit or text insertion.

The optional `mode` (`insert_text` or `keystrokes`) is forwarded only for
`browser_type`. Normal desktop `type`, including Excel, does not forward it or
select a native typing implementation with it. Diagnose desktop edits from the
observed edit state, exact target, call/result, and application effects; different
`mode` arguments alone are not evidence of a typing-mode change.

## Get started

On macOS, choose **CUA** under **Settings → This Mac → Capabilities** in the
OpenClaw app and grant Accessibility and Screen Recording access.

On a supported Windows or Linux host, enable the plugin and check its driver:

```bash
openclaw plugins enable cua-computer
openclaw doctor --lint --only cua-computer/driver-artifacts
```

You also need a vision-capable model and tool policy that permits computer use.
See the [computer use guide](https://docs.openclaw.ai/nodes/computer-use) for host
requirements, pairing, and permissions.

CUA window discovery returns `pid` alongside each opaque `windowRef`. Window
observations repeat that retained target as `details.windowRef` and `details.pid`.
The PID is metadata for matching the owning process, not an input target or proof
that the process is still alive. Inputs still require the current opaque
references; native window IDs remain private.

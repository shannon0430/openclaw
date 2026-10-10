---
summary: "Experimental CUA Driver computer control for macOS, Windows, and Linux node hosts."
read_when:
  - You are installing, configuring, or auditing the cua-computer plugin
title: "Cua Computer plugin reference"
---

<!-- Generated file. Do not edit by hand.
Run `pnpm plugins:inventory:gen` to rebuild it. Hand-written text survives only
between the openclaw-plugin-reference:manual-start and
openclaw-plugin-reference:manual-end comment markers. -->

Experimental CUA Driver computer control for macOS, Windows, and Linux node hosts.

## Distribution

- Package: `@openclaw/cua-computer`
- Install route: included in OpenClaw

## Surface

This plugin declares no channels, providers, commands, or contracts.

<!-- openclaw-plugin-reference:manual-start -->

## Windows retained-key focus diagnostics

For an element-bound foreground key, a compatible native driver can return a
versioned, content-free `keyboardFocusWitness`. Its 18-field shape does not add
an input action or change the requested target. Older drivers without the
witness remain compatible.

`uiaProcessMatchesTarget` reports proven ownership within the exact admitted
native window boundary. It can represent direct process-ID equality, or a
windowless Document fragment whose exact UIA-to-native-child-host relation has
been proved and refreshed by the native driver. It does not assert literal
frame-process equality for every virtual element. A process family, shared
ancestor, or unequal process IDs alone cannot establish this relation. The
adapter requires this field to be `true` on an admitted key and does not infer
ownership from an unproved or missing value.

Focus admission and an input-event count do not prove that the application
consumed the key, selected text, or replaced a value. The effect remains
unverifiable. A malformed or contradictory witness leaves the action outcome
unknown; observe the same target before retrying.

<!-- openclaw-plugin-reference:manual-end -->

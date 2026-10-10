import { z } from "zod";

// Versioned, content-free native diagnostic transport. No new action/actuator.
export const KEYBOARD_FOCUS_WITNESS_MARKER = "CUA_KEYBOARD_FOCUS_WITNESS_V1 ";
const MAX_WITNESS_BYTES = 2_048;
const FAILURE_CODES = [
  "target_unavailable",
  "target_unsupported",
  "preparation_failed",
  "uia_unavailable",
  "uia_focus_mismatch",
  "uia_process_mismatch",
  "uia_boundary_mismatch",
  "native_focus_unavailable",
  "native_focus_mismatch",
  "native_focus_changed",
  "input_partial",
] as const;
function invalidWitness(): never {
  // The diagnostic is never quoted, including on malformed/contradictory input.
  // Parsing happens after the native action; failure is not a no-input claim.
  throw new Error(
    "COMPUTER_DRIVER_ERROR: invalid keyboard focus witness; action outcome is unknown; observe the same target before any retry",
  );
}

const NativeKeyboardFocusWitnessSchema = z.strictObject({
  version: z.literal(1),
  nativeElementAdmitted: z.boolean(),
  elementReferenceKind: z.enum(["token", "index_snapshot"]),
  uiaHasKeyboardFocus: z.boolean().nullable(),
  uiaFocusedElementEqualsTarget: z.boolean().nullable(),
  // Native target-boundary ownership, not necessarily literal frame-PID
  // equality. A windowless Document may use a separately owned native child
  // only after the native driver proves and refreshes its exact UIA/Win32 host
  // mapping. Bare PID inequality, a process family, or a common ancestor is
  // not such proof. The adapter transports this admission fact; it neither
  // recreates the native proof nor confirms application input consumption.
  uiaProcessMatchesTarget: z.boolean().nullable(),
  nativeForegroundRelation: z.enum(["exact", "other", "unavailable"]),
  nativeForegroundStable: z.boolean().nullable(),
  nativeGuiInfoAvailable: z.boolean(),
  nativeActiveWithinBoundary: z.boolean().nullable(),
  nativeFocusWithinBoundary: z.boolean().nullable(),
  nativeFocusStable: z.boolean().nullable(),
  nativeElementCorrelation: z.enum(["exact_native_child", "shared_ancestor", "unavailable"]),
  valueChangedOnFocus: z.boolean().nullable(),
  inputAttempted: z.boolean(),
  insertedEventCount: z.number().int().min(0).max(64),
  providerFailureCode: z.number().int().min(-2_147_483_648).max(2_147_483_647).nullable(),
  failureCode: z.enum(FAILURE_CODES).nullable(),
});
export type KeyboardFocusWitness = z.infer<typeof NativeKeyboardFocusWitnessSchema>;
const FIELD_NAMES = new Set(Object.keys(NativeKeyboardFocusWitnessSchema.shape));

export function parseKeyboardFocusWitnessText(text: string): KeyboardFocusWitness | undefined {
  const offset = text.lastIndexOf(KEYBOARD_FOCUS_WITNESS_MARKER);
  if (offset < 0) {
    return undefined; // An older native driver remains exactly backward-compatible.
  }
  if (
    text.indexOf(KEYBOARD_FOCUS_WITNESS_MARKER) !== offset ||
    (offset !== 0 && text[offset - 1] !== "\n")
  ) {
    invalidWitness();
  }
  let payload = text.slice(offset + KEYBOARD_FOCUS_WITNESS_MARKER.length);
  if (payload.endsWith("\r\n")) {
    payload = payload.slice(0, -2);
  } else if (payload.endsWith("\n")) {
    payload = payload.slice(0, -1);
  }
  if (
    payload.length === 0 ||
    /[\r\n]/.test(payload) ||
    Buffer.byteLength(payload, "utf8") > MAX_WITNESS_BYTES
  ) {
    invalidWitness();
  }
  let value: unknown;
  try {
    value = JSON.parse(payload) as unknown;
  } catch {
    invalidWitness();
  }
  const parsed = NativeKeyboardFocusWitnessSchema.safeParse(value);
  if (!parsed.success) {
    invalidWitness();
  }
  // After strict scalar/closed-enum validation, strings cannot contain a
  // JSON-key fragment. This narrow scan rejects duplicate keys without a
  // competing JSON decoder; escaped keys are decoded by JSON.parse itself.
  const encodedKeys = [...payload.matchAll(/("(?:[^"\\]|\\.)*")\s*:/g)];
  const keys = encodedKeys.map((entry) => JSON.parse(entry[1]!) as string);
  if (
    keys.length !== FIELD_NAMES.size ||
    new Set(keys).size !== FIELD_NAMES.size ||
    keys.some((key) => !FIELD_NAMES.has(key))
  ) {
    invalidWitness();
  }
  const witness: KeyboardFocusWitness = parsed.data;
  if (witness.failureCode === null) {
    if (
      !witness.nativeElementAdmitted ||
      witness.uiaHasKeyboardFocus !== true ||
      witness.uiaFocusedElementEqualsTarget !== true ||
      witness.uiaProcessMatchesTarget !== true ||
      witness.nativeForegroundRelation !== "exact" ||
      witness.nativeForegroundStable !== true ||
      !witness.nativeGuiInfoAvailable ||
      witness.nativeActiveWithinBoundary !== true ||
      witness.nativeFocusWithinBoundary !== true ||
      witness.nativeFocusStable !== true ||
      witness.nativeElementCorrelation === "unavailable" ||
      !witness.inputAttempted ||
      witness.insertedEventCount < 2 ||
      witness.providerFailureCode !== null
    ) {
      invalidWitness();
    }
  } else if (
    (witness.failureCode === "input_partial" && !witness.inputAttempted) ||
    (witness.failureCode !== "input_partial" &&
      (witness.inputAttempted || witness.insertedEventCount !== 0))
  ) {
    invalidWitness();
  }
  return witness;
}

type NativeKeyResult = {
  text: string;
  action?: {
    effect: number;
    route: number;
    delivery?: { mode: number; deliveredCount?: number } | null;
  } | null;
};

export function keyboardFocusWitnessDetails(
  result: NativeKeyResult,
  context: {
    platform: string;
    action: string;
    deliveryMode?: string;
    element?: Record<string, unknown>;
  },
): { keyboardFocusWitness: KeyboardFocusWitness } | undefined {
  if (
    context.platform !== "win32" ||
    context.action !== "key" ||
    context.deliveryMode !== "foreground" ||
    !context.element
  ) {
    return undefined;
  }
  const witness = parseKeyboardFocusWitnessText(result.text);
  if (!witness) {
    return undefined;
  }
  const referenceKind = context.element.element_token ? "token" : "index_snapshot";
  // The pinned SDK uses numeric action enums; avoid loading the native library.
  // Admission/queue insertion never upgrades application consumption to confirmed.
  if (
    witness.failureCode !== null ||
    witness.elementReferenceKind !== referenceKind ||
    result.action?.effect !== 2 ||
    result.action.route !== 2 ||
    result.action.delivery?.mode !== 1 ||
    result.action.delivery.deliveredCount !== witness.insertedEventCount
  ) {
    invalidWitness();
  }
  return { keyboardFocusWitness: witness };
}

import assert from "node:assert/strict";
import {
  ComputerActResultSchema,
  compileComputerUseValidator,
  registerComputerUseProvider,
} from "openclaw/plugin-sdk/computer-use";
import { describe, it } from "vitest";
import { createCuaComputerProvider } from "./commands.js";
import {
  cuaToolResult,
  CUA_DRIVER_CONTRACT_FIXTURES,
} from "./cua-driver-contract.test-fixtures.js";
import type { CuaDriverSession, CuaToolResult } from "./driver-client.js";
import {
  KEYBOARD_FOCUS_WITNESS_MARKER as MARKER,
  keyboardFocusWitnessDetails,
  parseKeyboardFocusWitnessText,
  type KeyboardFocusWitness,
} from "./keyboard-focus-witness.js";

function witness(overrides: Partial<KeyboardFocusWitness> = {}): KeyboardFocusWitness {
  return {
    version: 1,
    nativeElementAdmitted: true,
    elementReferenceKind: "token",
    uiaHasKeyboardFocus: true,
    uiaFocusedElementEqualsTarget: true,
    uiaProcessMatchesTarget: true,
    nativeForegroundRelation: "exact",
    nativeForegroundStable: true,
    nativeGuiInfoAvailable: true,
    nativeActiveWithinBoundary: true,
    nativeFocusWithinBoundary: true,
    nativeFocusStable: true,
    nativeElementCorrelation: "shared_ancestor",
    valueChangedOnFocus: null,
    inputAttempted: true,
    insertedEventCount: 2,
    providerFailureCode: null,
    failureCode: null,
    ...overrides,
  };
}
const marked = (value: unknown) => `${MARKER}${JSON.stringify(value)}`;
const successAction = (count = 2) =>
  ({
    effect: 2,
    route: 2,
    delivery: { mode: 1, deliveredCount: count },
    evidence: [],
  }) as unknown as CuaToolResult["action"];
function result(text = marked(witness()), overrides: Partial<CuaToolResult> = {}): CuaToolResult {
  return cuaToolResult(
    {},
    {
      text,
      action: successAction(),
      ...overrides,
    },
  );
}
const context = {
  platform: "win32",
  action: "key",
  deliveryMode: "foreground",
  element: { element_token: "synthetic-token" },
};
function reject(text: string) {
  assert.throws(
    () => parseKeyboardFocusWitnessText(text),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /invalid keyboard focus witness/);
      assert.match(error.message, /outcome is unknown/);
      assert.ok(!error.message.includes("SYNTHETIC_PRIVATE_TEXT"));
      return true;
    },
  );
}

describe("native keyboard focus diagnostic allowlist", () => {
  it("preserves older driver text without inventing a witness", () => {
    assert.equal(parseKeyboardFocusWitnessText("Legacy success"), undefined);
    assert.equal(keyboardFocusWitnessDetails(result("Legacy success"), context), undefined);
  });
  for (const delta of [true, false, null]) {
    it(`admits private comparison ${String(delta)} without a value or mutation claim`, () => {
      const value = witness({ valueChangedOnFocus: delta });
      assert.deepEqual(parseKeyboardFocusWitnessText(`Diagnostic\n${marked(value)}\r\n`), value);
    });
  }
  it("admits exact child and snapshot-index classifications", () => {
    const value = witness({
      nativeElementCorrelation: "exact_native_child",
      elementReferenceKind: "index_snapshot",
      insertedEventCount: 64,
    });
    assert.deepEqual(
      keyboardFocusWitnessDetails(result(marked(value), { action: successAction(64) }), {
        ...context,
        element: { element_index: 0, snapshot_id: "synthetic-snapshot" },
      }),
      { keyboardFocusWitness: value },
    );
  });
  for (const field of [
    "title",
    "nativeId",
    "pointer",
    "runtimeId",
    "providerText",
    "value",
    "__proto__",
  ]) {
    it(`rejects private/unknown ${field} without copying diagnostic content`, () => {
      const payload = `${JSON.stringify(witness()).slice(0, -1)},"${field}":"SYNTHETIC_PRIVATE_TEXT"}`;
      reject(MARKER + payload);
    });
  }
  for (const [name, value] of [
    ["version", { ...witness(), version: 2 }],
    ["enum", { ...witness(), nativeForegroundRelation: "SYNTHETIC_PRIVATE_TEXT" }],
    ["boolean", { ...witness(), uiaHasKeyboardFocus: "true" }],
    ["nested", { ...witness(), valueChangedOnFocus: { value: "SYNTHETIC_PRIVATE_TEXT" } }],
    ["negative count", { ...witness(), insertedEventCount: -1 }],
    ["oversized count", { ...witness(), insertedEventCount: 65 }],
    ["fractional count", { ...witness(), insertedEventCount: 2.5 }],
    ["unsigned HRESULT", { ...witness(), providerFailureCode: 0x80070005 }],
    ["string HRESULT", { ...witness(), providerFailureCode: "0x80070005" }],
  ] as const) {
    it(`rejects invalid ${name}`, () => reject(marked(value)));
  }
  it("rejects missing fields and both ordinary and escaped duplicate keys", () => {
    const missing: Record<string, unknown> = { ...witness() };
    delete missing.nativeFocusStable;
    reject(marked(missing));
    reject(
      MARKER +
        JSON.stringify(witness()).replace(
          '"version":1',
          '"version":"SYNTHETIC_PRIVATE_TEXT","version":1',
        ),
    );
    reject(
      MARKER + JSON.stringify(witness()).replace('"version":1', '"version":1,"vers\\u0069on":1'),
    );
  });
  it("rejects truncation, misplaced/repeated markers, trailing lines and byte overflow", () => {
    for (const text of [
      MARKER + "{",
      "prefix " + marked(witness()),
      marked(witness()) + "\nextra",
      marked(witness()) + "\n" + marked(witness()),
      MARKER + " ".repeat(2049) + JSON.stringify(witness()),
      marked(witness()) + "\n\n",
    ]) {
      reject(text);
    }
  });
  it("rejects contradictory success rather than upgrading field consumption", () => {
    for (const change of [
      { inputAttempted: false },
      { insertedEventCount: 0 },
      { uiaHasKeyboardFocus: null },
      { uiaFocusedElementEqualsTarget: false },
      { nativeFocusStable: false },
      { nativeElementCorrelation: "unavailable" },
      { providerFailureCode: 0 },
    ]) {
      reject(marked({ ...witness(), ...change }));
    }
  });
  it("classifies pre-input failure and partial insertion without a no-action claim", () => {
    const failure = witness({
      failureCode: "uia_unavailable",
      inputAttempted: false,
      insertedEventCount: 0,
      providerFailureCode: -2147467259,
      uiaHasKeyboardFocus: null,
    });
    assert.deepEqual(parseKeyboardFocusWitnessText(marked(failure)), failure);
    assert.equal(
      parseKeyboardFocusWitnessText(
        marked(witness({ failureCode: "input_partial", insertedEventCount: 1 })),
      )?.inputAttempted,
      true,
    );
    reject(marked({ ...failure, inputAttempted: true }));
    reject(
      marked(
        witness({ failureCode: "input_partial", inputAttempted: false, insertedEventCount: 0 }),
      ),
    );
    assert.throws(
      () => keyboardFocusWitnessDetails(result(marked(failure)), context),
      /outcome is unknown/,
    );
  });
  it("projects no telemetry for sibling/background/pixel routes", () => {
    for (const sibling of [
      { ...context, platform: "linux" },
      { ...context, platform: "darwin" },
      { ...context, action: "type" },
      { ...context, action: "scroll" },
      { ...context, deliveryMode: "background" },
      { ...context, element: undefined },
    ]) {
      assert.equal(
        keyboardFocusWitnessDetails(result(MARKER + "SYNTHETIC_PRIVATE_TEXT"), sibling),
        undefined,
      );
    }
  });
  it("rejects contrary route/effect/delivery/count or target-kind metadata", () => {
    for (const action of [
      { effect: 0, route: 2, delivery: { mode: 1 } },
      { effect: 2, route: 0, delivery: { mode: 1 } },
      { effect: 2, route: 2, delivery: { mode: 0 } },
      undefined,
      { effect: 2, route: 2, delivery: { mode: 1 } },
      { effect: 2, route: 2, delivery: { mode: 1, deliveredCount: 4 } },
    ]) {
      assert.throws(
        () =>
          keyboardFocusWitnessDetails(
            result(marked(witness()), { action: action as CuaToolResult["action"] }),
            context,
          ),
        /outcome is unknown/,
      );
    }
    assert.throws(
      () =>
        keyboardFocusWitnessDetails(
          result(marked(witness({ elementReferenceKind: "index_snapshot" }))),
          context,
        ),
      /outcome is unknown/,
    );
  });
});

async function registeredFixture() {
  let next = result();
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const unexpected = async (): Promise<never> => {
    throw new Error("Unexpected external driver operation");
  };
  const session: CuaDriverSession = {
    generation: "synthetic-generation",
    isAvailable: () => true,
    resetAvailabilityCache: () => {},
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (name === "list_windows") return cuaToolResult(CUA_DRIVER_CONTRACT_FIXTURES.listWindows);
      if (name === "get_window_state")
        return cuaToolResult(CUA_DRIVER_CONTRACT_FIXTURES.windowState);
      if (name === "press_key" || name === "type_text") return next;
      return await unexpected();
    },
    getCursorPosition: unexpected,
    escalateScope: unexpected,
    getDesktopState: unexpected,
    getScreenSize: unexpected,
    click: unexpected,
    drag: unexpected,
    moveCursor: unexpected,
    scroll: unexpected,
    typeText: unexpected,
    pressKey: unexpected,
    dispose: async () => {},
  };
  const provider = createCuaComputerProvider({
    platform: "win32",
    env: {},
    driver: session,
    imageProcessor: { encode: unexpected },
  });
  type Command = Parameters<
    Parameters<typeof registerComputerUseProvider>[0]["registerNodeHostCommand"]
  >[0];
  const commands: Command[] = [];
  registerComputerUseProvider(
    {
      registerNodeHostCommand: (command) => {
        commands.push(command);
      },
    },
    provider,
  );
  const command = commands.find((entry) => entry.command === "computer.act")!;
  const send = async (input: Record<string, unknown>) =>
    JSON.parse(
      await command.handle(
        JSON.stringify({ executionId: "00000000-0000-4000-8000-000000000001", ...input }),
      ),
    );
  const listed = await send({ action: "list_windows" });
  const windowRef = listed.details.windows[0].windowRef as string;
  const fresh = async () => {
    const observed = await send({
      action: "get_window_state",
      windowRef,
      includeScreenshot: false,
    });
    return {
      windowRef,
      observationId: observed.observation.observationId as string,
      elementRef: observed.observation.elements[0].elementRef as string,
    };
  };
  return {
    calls,
    send,
    fresh,
    setResult: (value: CuaToolResult) => {
      next = value;
    },
  };
}

describe("registered computer.act retained-element key boundary", () => {
  it("carries allowlisted native text through real resolver/driver/actionEnvelope once", async () => {
    const fixture = await registeredFixture();
    const refs = await fixture.fresh();
    fixture.setResult(
      result(`SYNTHETIC_PRIVATE_TEXT\n${marked(witness({ valueChangedOnFocus: true }))}`),
    );
    const answer = await fixture.send({
      action: "key",
      ...refs,
      keys: "Home",
      deliveryMode: "foreground",
    });
    assert.equal(answer.ok, true);
    assert.equal(answer.effect, "unverifiable");
    assert.equal(answer.details.route, "global_input");
    assert.equal(answer.details.deliveryMode, "foreground");
    assert.deepEqual(answer.details.keyboardFocusWitness, witness({ valueChangedOnFocus: true }));
    assert.ok(compileComputerUseValidator(ComputerActResultSchema)(answer));
    const keyCalls = fixture.calls.filter((call) => call.name === "press_key");
    assert.equal(keyCalls.length, 1);
    assert.equal(keyCalls[0]!.args.pid, 4242);
    assert.equal(keyCalls[0]!.args.window_id, 99);
    assert.equal(keyCalls[0]!.args.key, "home"); // Existing canonical chord normalization is unchanged.
    assert.equal(keyCalls[0]!.args.delivery_mode, "foreground");
    assert.ok(keyCalls[0]!.args.element_token || keyCalls[0]!.args.snapshot_id);
    assert.ok(!JSON.stringify(answer).includes("SYNTHETIC_PRIVATE_TEXT"));
    assert.ok(!JSON.stringify(answer).includes("element_token"));
  });
  it("preserves legacy/background/type siblings and does not retry malformed results", async () => {
    const fixture = await registeredFixture();
    fixture.setResult(result("Legacy success", { action: undefined }));
    const legacy = await fixture.send({
      action: "key",
      ...(await fixture.fresh()),
      keys: "Home",
      deliveryMode: "foreground",
    });
    assert.deepEqual(legacy, { ok: true }); // Exact legacy envelope is preserved, not relabeled.
    fixture.setResult(result());
    assert.equal(
      (
        await fixture.send({
          action: "key",
          ...(await fixture.fresh()),
          keys: "Home",
          deliveryMode: "background",
        })
      ).details.keyboardFocusWitness,
      undefined,
    );
    assert.equal(
      (
        await fixture.send({
          action: "type",
          ...(await fixture.fresh()),
          text: "Synthetic",
          deliveryMode: "foreground",
        })
      ).details.keyboardFocusWitness,
      undefined,
    );
    fixture.setResult(result(MARKER + "SYNTHETIC_PRIVATE_TEXT"));
    const refs = await fixture.fresh();
    const before = fixture.calls.length;
    await assert.rejects(
      fixture.send({ action: "key", ...refs, keys: "Home", deliveryMode: "foreground" }),
      /outcome is unknown/,
    );
    assert.equal(fixture.calls.length, before + 1);
  });
  it("rejects stale refs before native dispatch and preserves existing native refusal", async () => {
    const fixture = await registeredFixture();
    const stale = await fixture.fresh();
    await fixture.fresh();
    const before = fixture.calls.length;
    await assert.rejects(
      fixture.send({ action: "key", ...stale, keys: "Home", deliveryMode: "foreground" }),
      /COMPUTER_STALE_OBSERVATION/,
    );
    assert.equal(fixture.calls.length, before);
    fixture.setResult(
      result("Content-free native refusal", {
        isError: true,
        errorCode: "keyboard_focus_unavailable",
      }),
    );
    await assert.rejects(
      fixture.send({
        action: "key",
        ...(await fixture.fresh()),
        keys: "Home",
        deliveryMode: "foreground",
      }),
      /COMPUTER_REFUSED_keyboard_focus_unavailable/,
    );
  });
});

// Source-only proposal: real generated SDK + DLL/addon, fake public remote
// carrier. No platform runtime/session, actuator, clipboard or capture.
import assert from 'node:assert/strict';
import { abi } from './package-qa-probe.mjs';
const [slot, bindings] = process.argv.slice(2);
const { sdk, receipt } = await abi(slot, bindings);
let calls = 0; let malformed = false; let closed = false;
const witness = { version: 1, nativeElementAdmitted: true, elementReferenceKind: 'token', uiaHasKeyboardFocus: true, uiaFocusedElementEqualsTarget: true, uiaProcessMatchesTarget: true, nativeForegroundRelation: 'exact', nativeForegroundStable: true, nativeGuiInfoAvailable: true, nativeActiveWithinBoundary: true, nativeFocusWithinBoundary: true, nativeFocusStable: true, nativeElementCorrelation: 'exact_native_child', valueChangedOnFocus: false, inputAttempted: true, insertedEventCount: 2, providerFailureCode: null, failureCode: null };
const marker = 'CUA_KEYBOARD_FOCUS_WITNESS_V1 ' + JSON.stringify(witness);
const carrier = {
  identity() { return { authenticatedPrincipal: 'owned-package-qa-loopback', connectionGeneration: 'owned-package-qa-generation' }; },
  async negotiate() { return { minimumEnvelopeVersion: 1, maximumEnvelopeVersion: 1, supportsCancellation: true }; },
  async exchange(request) {
    assert.equal(request.envelopeVersion, 1);
    assert.equal(request.operation, 'call'); assert.equal(request.name, 'press_key');
    assert.deepEqual(JSON.parse(request.argumentsJson), { key: 'Home' });
    assert.equal(typeof request.deadlineUnixMs, 'bigint');
    calls++;
    // This returns fixture bytes. It NEVER calls a platform/native tool.
    const structuredContent = malformed ? { effect: 'confirmed', route: 'global_input' } : { effect: 'unverifiable', route: 'global_input', delivery: { mode: 'foreground', delivered_count: 2 } };
    return { envelopeVersion: request.envelopeVersion, requestId: request.requestId, ok: true, resultJson: JSON.stringify({ content: [{ type: 'text', text: marker }], structuredContent, isError: false }), completionKnown: true };
  },
  async bindSession() { assert.fail('session_binding_forbidden'); },
  async cancel() {},
  async close() { closed = true; },
};
const driver = sdk.connectRemoteChannel(carrier);
try {
  const result = await driver.pressKey(sdk.PressKeyInput.create({ key: 'Home' }));
  assert.equal(result.isError, false); assert.equal(result.text, marker);
  assert.equal(result.action.effect, sdk.ActionEffect.Unverifiable);
  assert.equal(result.action.route, sdk.ActionRoute.GlobalInput);
  assert.equal(result.action.delivery.mode, sdk.ActionDeliveryMode.Foreground);
  assert.equal(result.action.delivery.deliveredCount, witness.insertedEventCount);
  assert.equal(result.action.delivery.deliveredCount, 2);
  assert.equal(JSON.parse(result.structuredJson).delivery.delivered_count, 2);
  assert.equal(Object.keys(JSON.parse(result.text.slice('CUA_KEYBOARD_FOCUS_WITNESS_V1 '.length))).length, 18);
  malformed = true;
  await assert.rejects(driver.pressKey(sdk.PressKeyInput.create({ key: 'Home' })));
  assert.equal(calls, 2);
} finally {
  await driver.shutdown();
  driver.uniffiDestroy();
}
assert(closed);
console.log(JSON.stringify({ ...receipt, typedInputAndToolResultFfiRoundtrip: true, markerFields: 18, deliveredCount: 2, rejectedUnsubstantiatedConfirmation: true, carrierCalls: calls, transport: 'existing_public_foreign_carrier_loopback', actualNativeInput: false, fieldConsumptionProved: false, nativeWitnessAuthenticityProved: false }));

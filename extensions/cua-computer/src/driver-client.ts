import { randomUUID } from "node:crypto";
import { verifyInstalledCuaDriverArtifacts } from "./driver-artifacts.js";

type DriverClickButton = import("@trycua/cua-driver").ClickButton;
type DriverEscalationReason = import("@trycua/cua-driver").EscalationReason;
type CuaDriverLike = import("@trycua/cua-driver").CuaDriverLike;
type CuaDriverSessionLike = import("@trycua/cua-driver").CuaDriverSessionLike;
type DriverScrollDirection = import("@trycua/cua-driver").ScrollDirection;
type CuaSessionState = import("@trycua/cua-driver").SessionStateOutput;
type CuaDriverSdk = Pick<
  typeof import("@trycua/cua-driver"),
  | "ActionTarget"
  | "ClickPosition"
  | "CuaDriver"
  | "DriverError"
  | "EscalationReason"
  | "InputDeliveryMode"
  | "ScrollBy"
  | "SessionPermissionMode"
  | "createTrustedSession"
>;

export type CuaToolResult = import("@trycua/cua-driver").ToolResult;

export const EscalationReason = {
  AxTreePixelMismatch: 0 as DriverEscalationReason,
  BackgroundDeliveryFailed: 1 as DriverEscalationReason,
  ForegroundIneffective: 2 as DriverEscalationReason,
  NoWindowTarget: 3 as DriverEscalationReason,
  Other: 4 as DriverEscalationReason,
} as const;
export type EscalationReason = (typeof EscalationReason)[keyof typeof EscalationReason];

// These numeric values are part of the pinned SDK contract. Keeping
// them local avoids loading the native library while OpenClaw is only
// registering the bundled plugin.
export const ClickButton = {
  Left: 0 as DriverClickButton,
  Right: 1 as DriverClickButton,
  Middle: 2 as DriverClickButton,
} as const;
export type ClickButton = (typeof ClickButton)[keyof typeof ClickButton];

export const ScrollDirection = {
  Up: 0 as DriverScrollDirection,
  Down: 1 as DriverScrollDirection,
  Left: 2 as DriverScrollDirection,
  Right: 3 as DriverScrollDirection,
} as const;
export type ScrollDirection = (typeof ScrollDirection)[keyof typeof ScrollDirection];

export interface CuaDriverSession {
  readonly generation: string;
  isAvailable(): boolean;
  prepareAvailability?(): Promise<void>;
  prepareForObservation?(allowSessionRotation: boolean): Promise<void>;
  resetAvailabilityCache(): void;
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CuaToolResult>;
  getCursorPosition(signal?: AbortSignal): Promise<CuaToolResult>;
  escalateScope(reason: EscalationReason, signal?: AbortSignal): Promise<CuaSessionState>;
  getDesktopState(signal?: AbortSignal): Promise<CuaToolResult>;
  getScreenSize(signal?: AbortSignal): Promise<CuaToolResult>;
  click(
    input: { x: number; y: number; button: ClickButton; count: number },
    signal?: AbortSignal,
  ): Promise<CuaToolResult>;
  drag(
    input: { fromX: number; fromY: number; toX: number; toY: number; durationMs?: bigint },
    signal?: AbortSignal,
  ): Promise<CuaToolResult>;
  moveCursor(input: { x: number; y: number }, signal?: AbortSignal): Promise<CuaToolResult>;
  scroll(
    input: { x: number; y: number; direction: ScrollDirection; amount: bigint },
    signal?: AbortSignal,
  ): Promise<CuaToolResult>;
  typeText(text: string, signal?: AbortSignal): Promise<CuaToolResult>;
  pressKey(
    input: { key: string; modifiers: string[] },
    signal?: AbortSignal,
  ): Promise<CuaToolResult>;
  dispose(): Promise<void>;
}

function asyncOptions(signal?: AbortSignal) {
  return signal ? { signal } : undefined;
}

// SDK Tool errors carry arbitrary strings, including application content. Keep
// only known lifecycle codes in the public diagnostic; retain the original error
// as the private cause rather than copying its message, tool, or arguments.
const DRIVER_LIFECYCLE_CODES = new Set([
  "invalid_capture_scope",
  "session_policy_conflict",
  "session_unavailable",
  "session_ended",
  "session_required",
  "session_not_started",
  "transport_lease_required",
  "desktop_unavailable",
  "foreground_unavailable",
  "target_identity_changed",
  "target_unavailable",
  "input_delivery_failed",
  "partial_input_delivery",
]);
const SESSION_AUTHORIZATION_FAILURE_CODES = new Set([
  "permission_denied",
  "authorization_required",
  "authorization_declined",
  "authorization_canceled",
  "authorization_scope_mismatch",
  "authorization_expired",
  "authorization_host_failed",
  "bounded_resource_outside_manifest",
  "protected_resource_scope_stale",
  "protected_resource_scope_invalid",
  "unbounded_operation_requires_unrestricted",
  "session_unavailable",
  "session_ended",
  "session_required",
  "session_not_started",
  "transport_lease_required",
]);
const DRIVER_TOOL_NAMES = new Set([
  "list_apps",
  "list_windows",
  "get_accessibility_tree",
  "get_window_state",
  "launch_app",
  "kill_app",
  "bring_to_front",
  "click",
  "drag",
  "scroll",
  "type_text",
  "press_key",
  "set_value",
  "zoom",
  "invoke_menu",
  "get_browser_state",
  "browser_prepare",
  "browser_navigate",
  "browser_click",
  "browser_type",
  "browser_dialog",
  "browser_set_input_files",
  "browser_download",
  "browser_pointer",
  "get_recording_state",
  "start_recording",
  "stop_recording",
  "replay_trajectory",
]);

type DriverPhase =
  | "session_start"
  | "operation"
  | "session_end"
  | "session_close"
  | "shutdown"
  | "destroy";

class NativeDriverFailure extends Error {
  constructor(
    readonly phase: DriverPhase,
    readonly nativeKind: string,
    readonly nativeCode: string | undefined,
    generation: string,
    subphase: string,
    cause: unknown,
    readonly actionCompletion?: string,
  ) {
    super(
      `COMPUTER_DRIVER_ERROR: phase=${phase} nativeKind=${nativeKind}${nativeCode ? ` nativeCode=${nativeCode}` : ""} subphase=${subphase} driverGeneration=${generation}${actionCompletion ? ` actionCompletion=${actionCompletion}` : ""}`,
      { cause },
    );
  }
}

class DriverCleanupFailure extends Error {}

export function driverFailureDiagnostic(error: unknown): string | undefined {
  return error instanceof NativeDriverFailure || error instanceof DriverCleanupFailure
    ? error.message
    : undefined;
}

class DirectCuaDriverSession {
  private readonly runtime: CuaDriverLike;
  private session: CuaDriverSessionLike;
  private publicSession = `openclaw-${randomUUID()}`;
  private readonly desktopTarget: import("@trycua/cua-driver").ActionTarget;
  private startPromise: Promise<void> | undefined;
  private started = false;
  private disposed = false;
  private readonly expiresAtMs: number;
  private lastAuthorizedDispatchMs: number;
  private rotationBlocked = false;
  private sessionUnavailable = false;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly sdk: CuaDriverSdk,
    private currentGeneration: string,
    private readonly now: () => number,
  ) {
    this.lastAuthorizedDispatchMs = now();
    this.expiresAtMs = this.lastAuthorizedDispatchMs + 3_600_000;
    const unrestricted = sdk.SessionPermissionMode.Unrestricted;
    // This is an OpenClaw-owned ceiling, not plugin configuration or tool input.
    // The model cannot select a session or widen this authorization after start.
    const authorization = {
      allowedModes: [unrestricted],
      compatibilityMode: unrestricted,
      unrestrictedAcknowledged: true,
      maxSessionTtlSeconds: 3_600n,
      maxIdleTtlSeconds: 300n,
    };
    // Never use CuaDriver.create(): configured creation fixes the authorization
    // ceiling before the lifecycle session is admitted.
    this.runtime = sdk.CuaDriver.createConfigured({
      claudeCodeCompatibility: false,
      authorization,
    });
    this.session = sdk.createTrustedSession(this.runtime, {
      mode: unrestricted,
      ttlSeconds: authorization.maxSessionTtlSeconds,
      idleTtlSeconds: authorization.maxIdleTtlSeconds,
      publicSession: this.publicSession,
    });
    // CUA 0.20 moves modality from session state to each action. Keep one
    // lifecycle/authority owner and make the desktop target explicit per call.
    this.desktopTarget = sdk.ActionTarget.Desktop.new({ displayId: "primary" });
  }

  get generation(): string {
    return this.currentGeneration;
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation);
    this.operationTail = result.then(
      () => {},
      () => {},
    );
    return await result;
  }

  private assertExecutionLive(): void {
    if (this.disposed) {
      throw new Error(
        "COMPUTER_DRIVER_UNAVAILABLE: cua-computer session is stopping or unavailable",
      );
    }
    if (this.now() >= this.expiresAtMs) {
      throw new Error(
        "COMPUTER_REFUSED_permission_denied: computer execution authorization expired",
      );
    }
  }

  private assertLive(): void {
    this.assertExecutionLive();
    if (this.sessionUnavailable) {
      throw new Error(
        "COMPUTER_DRIVER_UNAVAILABLE: cua-computer session is stopping or unavailable",
      );
    }
  }

  private idleBoundaryReached(): boolean {
    return this.now() - this.lastAuthorizedDispatchMs >= 300_000;
  }

  async prepareForObservation(allowSessionRotation: boolean): Promise<void> {
    await this.serialize(async () => {
      this.assertLive();
      if (!this.idleBoundaryReached()) {
        return;
      }
      // A native denial is never a request to mint replacement authority.
      // Only a fresh, ref-free observation may cross a known local idle
      // boundary, and never while execution-owned recording is active.
      if (this.rotationBlocked || !allowSessionRotation) {
        throw new Error(
          "COMPUTER_REFUSED_permission_denied: computer session authorization expired",
        );
      }
      this.sessionUnavailable = true;
      await this.nativeOperation("session_close", () => this.session.close());
      this.startPromise = undefined;
      this.started = false;
      this.assertExecutionLive();
      const remainingSeconds = BigInt(Math.floor((this.expiresAtMs - this.now()) / 1_000));
      if (remainingSeconds < 1n) {
        throw new Error(
          "COMPUTER_REFUSED_permission_denied: computer execution authorization expired",
        );
      }
      this.publicSession = `openclaw-${randomUUID()}`;
      this.session = this.sdk.createTrustedSession(this.runtime, {
        mode: this.sdk.SessionPermissionMode.Unrestricted,
        ttlSeconds: remainingSeconds,
        idleTtlSeconds: remainingSeconds < 300n ? remainingSeconds : 300n,
        publicSession: this.publicSession,
      });
      this.currentGeneration = randomUUID();
      this.lastAuthorizedDispatchMs = this.now();
      this.sessionUnavailable = false;
    });
  }

  private async ensureSessionStarted(signal?: AbortSignal): Promise<void> {
    if (this.disposed) {
      throw new Error("COMPUTER_DRIVER_UNAVAILABLE: cua-computer is stopping");
    }
    if (!this.startPromise) {
      const start = this.nativeOperation("session_start", () =>
        this.session.startSession({ session: this.publicSession }, asyncOptions(signal)),
      ).then(() => {
        this.started = true;
      });
      this.startPromise = start;
      try {
        await start;
      } catch (error) {
        if (this.startPromise === start) {
          this.startPromise = undefined;
        }
        throw error;
      }
      return;
    }
    await this.startPromise;
  }

  private async invoke<T>(
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
    subphase = "call_tool",
  ): Promise<T> {
    return await this.serialize(async () => {
      this.assertLive();
      if (this.idleBoundaryReached()) {
        throw new Error(
          "COMPUTER_STALE_OBSERVATION: take a fresh window list or screenshot after the computer session idle boundary",
        );
      }
      const dispatchedAt = this.now();
      await this.ensureSessionStarted(signal);
      this.assertLive();
      if (this.idleBoundaryReached()) {
        throw new Error(
          "COMPUTER_STALE_OBSERVATION: take a fresh window list or screenshot after the computer session idle boundary",
        );
      }
      const result = await this.nativeOperation("operation", operation, subphase);
      if (result && typeof result === "object" && "isError" in result && result.isError) {
        if (
          "errorCode" in result &&
          typeof result.errorCode === "string" &&
          SESSION_AUTHORIZATION_FAILURE_CODES.has(result.errorCode)
        ) {
          this.rotationBlocked = true;
        }
      } else {
        // Native idle time starts at authorized dispatch, not completion of a
        // possibly slow operation. A refusal must not refresh this lease.
        this.lastAuthorizedDispatchMs = dispatchedAt;
      }
      return result;
    });
  }

  private async nativeOperation<T>(
    phase: DriverPhase,
    operation: () => T | Promise<T>,
    subphase: string = phase,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error === null ||
        (typeof error !== "object" && typeof error !== "function") ||
        !this.sdk.DriverError.instanceOf(error)
      ) {
        if (phase === "operation" || phase === "session_start") {
          this.rotationBlocked = true;
        }
        throw error;
      }
      const nativeCode = this.sdk.DriverError.Tool.instanceOf(error)
        ? DRIVER_LIFECYCLE_CODES.has(error.inner.errorCode)
          ? error.inner.errorCode
          : "unclassified"
        : undefined;
      const knownResourceFailure =
        this.sdk.DriverError.Tool.instanceOf(error) &&
        DRIVER_LIFECYCLE_CODES.has(error.inner.errorCode) &&
        !SESSION_AUTHORIZATION_FAILURE_CODES.has(error.inner.errorCode);
      if ((phase === "operation" || phase === "session_start") && !knownResourceFailure) {
        this.rotationBlocked = true;
      }
      const actionCompletion =
        error.tag === "ActionInterrupted"
          ? ["not_started", "completed", "unknown"][error.inner.completion]
          : undefined;
      throw new NativeDriverFailure(
        phase,
        error.tag,
        nativeCode,
        this.generation,
        subphase,
        error,
        actionCompletion,
      );
    }
  }

  isAvailable(): boolean {
    return !this.disposed && this.runtime.isAvailable();
  }
  resetAvailabilityCache(): void {}
  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
    return await this.invoke(
      signal,
      () =>
        this.session.callTool(
          name,
          JSON.stringify({ ...args, session: this.publicSession }),
          asyncOptions(signal),
        ),
      DRIVER_TOOL_NAMES.has(name) ? name : "call_tool_unclassified",
    );
  }
  async getCursorPosition(signal?: AbortSignal) {
    return await this.invoke(
      signal,
      () => this.session.getCursorPosition({ session: this.publicSession }, asyncOptions(signal)),
      "get_cursor_position",
    );
  }
  async escalateScope(_reason: EscalationReason, signal?: AbortSignal) {
    return await this.invoke(
      signal,
      () => this.session.getSessionState({ session: this.publicSession }, asyncOptions(signal)),
      "get_session_state",
    );
  }
  async getDesktopState(signal?: AbortSignal) {
    return await this.invoke(
      signal,
      () => this.session.getDesktopState({}, asyncOptions(signal)),
      "get_desktop_state",
    );
  }
  async getScreenSize(signal?: AbortSignal) {
    return await this.invoke(
      signal,
      () => this.session.getScreenSize({}, asyncOptions(signal)),
      "get_screen_size",
    );
  }
  async click(
    input: { x: number; y: number; button: ClickButton; count: number },
    signal?: AbortSignal,
  ): Promise<CuaToolResult> {
    return await this.invoke(
      signal,
      async () => {
        // Typed clicks return ActionResult and throw tool refusals; other SDK
        // actions still use the shared ToolResult envelope.
        try {
          const action = await this.session.click(
            {
              position: this.sdk.ClickPosition.Coordinates.new({ x: input.x, y: input.y }),
              deliveryMode: this.sdk.InputDeliveryMode.Foreground,
              button: input.button,
              count: input.count,
              target: this.desktopTarget,
            },
            asyncOptions(signal),
          );
          return { text: "", images: [], isError: false, degraded: false, rawJson: "{}", action };
        } catch (error) {
          if (!this.sdk.DriverError.Tool.instanceOf(error)) {
            throw error;
          }
          return {
            text: error.inner.message,
            images: [],
            isError: true,
            degraded: false,
            rawJson: "{}",
            errorCode: error.inner.errorCode,
          };
        }
      },
      "click",
    );
  }
  async drag(
    input: { fromX: number; fromY: number; toX: number; toY: number; durationMs?: bigint },
    signal?: AbortSignal,
  ) {
    return await this.invoke(
      signal,
      () => this.session.drag({ ...input, target: this.desktopTarget }, asyncOptions(signal)),
      "drag",
    );
  }
  async moveCursor(input: { x: number; y: number }, signal?: AbortSignal) {
    return await this.invoke(
      signal,
      () => this.session.moveCursor({ ...input, target: this.desktopTarget }, asyncOptions(signal)),
      "move_cursor",
    );
  }
  async scroll(
    input: { x: number; y: number; direction: ScrollDirection; amount: bigint },
    signal?: AbortSignal,
  ) {
    return await this.invoke(
      signal,
      () =>
        this.session.scroll(
          {
            ...input,
            target: this.desktopTarget,
            by: this.sdk.ScrollBy.Line,
          },
          asyncOptions(signal),
        ),
      "scroll",
    );
  }
  async typeText(text: string, signal?: AbortSignal) {
    return await this.invoke(
      signal,
      () => this.session.typeText({ text, target: this.desktopTarget }, asyncOptions(signal)),
      "type_text",
    );
  }
  async pressKey(input: { key: string; modifiers: string[] }, signal?: AbortSignal) {
    return await this.invoke(
      signal,
      () => this.session.pressKey({ ...input, target: this.desktopTarget }, asyncOptions(signal)),
      "press_key",
    );
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    await this.operationTail;
    let failure: unknown;
    const cleanup: string[] = [];
    const cleanupFailures: {
      phase: DriverPhase;
      nativeKind: string;
      nativeCode?: string;
      actionCompletion?: string;
    }[] = [];
    const settle = async (phase: DriverPhase, operation: () => unknown | Promise<unknown>) => {
      try {
        await this.nativeOperation(phase, operation);
        cleanup.push(`${phase}=completed`);
      } catch (error) {
        failure ??= error;
        // Only the fixed phase/status enters the public record. Native Tool
        // errors do not carry HRESULT, count or partial fields in this SDK.
        cleanup.push(`${phase}=failed`);
        cleanupFailures.push({
          phase,
          nativeKind: error instanceof NativeDriverFailure ? error.nativeKind : "unclassified",
          ...(error instanceof NativeDriverFailure && error.nativeCode
            ? { nativeCode: error.nativeCode }
            : {}),
          ...(error instanceof NativeDriverFailure && error.actionCompletion
            ? { actionCompletion: error.actionCompletion }
            : {}),
        });
      }
    };
    try {
      await this.startPromise;
    } catch (error) {
      failure = error;
    }
    if (this.started) {
      await settle("session_end", () => this.session.endSession({ session: this.publicSession }));
    } else {
      cleanup.push("session_end=not_started");
    }
    await settle("session_close", () => this.session.close());
    await settle("shutdown", () => this.runtime.shutdown());
    const destroy = (this.runtime as CuaDriverLike & { uniffiDestroy?: () => void }).uniffiDestroy;
    if (destroy) {
      await settle("destroy", () => destroy.call(this.runtime));
    } else {
      cleanup.push("destroy=not_available");
    }
    if (failure) {
      const detail =
        failure instanceof NativeDriverFailure
          ? failure.message
          : `COMPUTER_DRIVER_ERROR: phase=cleanup nativeKind=unclassified driverGeneration=${this.generation}`;
      throw new DriverCleanupFailure(
        `${detail} cleanup=[${cleanup.join(",")}] cleanupFailures=${JSON.stringify(cleanupFailures)}`,
        { cause: failure },
      );
    }
  }
}

async function loadCuaDriverSdk(): Promise<CuaDriverSdk> {
  const artifactVerification = verifyInstalledCuaDriverArtifacts();
  if (!artifactVerification.ok) {
    throw new Error(artifactVerification.diagnostic);
  }
  return (await import("@trycua/cua-driver")) as CuaDriverSdk;
}

function unavailableError(failure: unknown): Error {
  if (failure instanceof Error && /^COMPUTER_DRIVER_[A-Z_]+:/u.test(failure.message)) {
    return failure;
  }
  const detail = failure instanceof Error ? failure.message : String(failure);
  return new Error(`COMPUTER_DRIVER_UNAVAILABLE: failed to load CUA Driver SDK: ${detail}`, {
    cause: failure,
  });
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T>).then === "function";
}

class LazyCuaDriverSession implements CuaDriverSession {
  // The execution owns this generation before and after its lazy runtime loads.
  private readonly initialGeneration = randomUUID();
  private runtime: DirectCuaDriverSession | undefined;
  private loadPromise: Promise<DirectCuaDriverSession> | undefined;
  private loadFailure: unknown;
  private hasLoadFailure = false;
  private disposed = false;

  constructor(
    private readonly loadSdk: () => CuaDriverSdk | Promise<CuaDriverSdk>,
    private readonly now: () => number,
  ) {}

  get generation(): string {
    return this.runtime?.generation ?? this.initialGeneration;
  }

  private resolveRuntime(): DirectCuaDriverSession | undefined {
    if (this.disposed || this.hasLoadFailure || this.loadPromise) {
      return undefined;
    }
    if (this.runtime) {
      return this.runtime;
    }
    try {
      const loadedSdk = this.loadSdk();
      if (!isPromise(loadedSdk)) {
        this.runtime = new DirectCuaDriverSession(loadedSdk, this.initialGeneration, this.now);
        return this.runtime;
      }

      const loadPromise = loadedSdk
        .then((sdk) => new DirectCuaDriverSession(sdk, this.initialGeneration, this.now))
        .then((runtime) => {
          this.runtime = runtime;
          return runtime;
        })
        .catch((error: unknown) => {
          this.loadFailure = error;
          this.hasLoadFailure = true;
          throw error;
        })
        .finally(() => {
          if (this.loadPromise === loadPromise) {
            this.loadPromise = undefined;
          }
        });
      this.loadPromise = loadPromise;
      // Availability is synchronous, so the first probe starts the ESM import
      // and reports unavailable until a later probe observes the loaded SDK.
      void loadPromise.catch(() => {});
      return this.runtime;
    } catch (error) {
      this.loadFailure = error;
      this.hasLoadFailure = true;
      return undefined;
    }
  }

  private async requireRuntime(): Promise<DirectCuaDriverSession> {
    const runtime = this.resolveRuntime();
    if (runtime) {
      return runtime;
    }
    if (this.loadPromise) {
      try {
        return await this.loadPromise;
      } catch (error) {
        throw unavailableError(this.loadFailure ?? error);
      }
    }
    throw unavailableError(
      this.disposed ? new Error("cua-computer is stopping") : this.loadFailure,
    );
  }

  isAvailable(): boolean {
    return this.resolveRuntime()?.isAvailable() ?? false;
  }

  async prepareAvailability(): Promise<void> {
    this.resolveRuntime();
    // Loading failure remains an unavailable capability with its original
    // diagnostic; an optional driver must not prevent the node from starting.
    await this.loadPromise?.catch(() => {});
  }

  resetAvailabilityCache(): void {
    if (this.runtime) {
      this.runtime.resetAvailabilityCache();
    } else if (!this.disposed && !this.loadPromise) {
      this.loadFailure = undefined;
      this.hasLoadFailure = false;
    }
  }

  async prepareForObservation(allowSessionRotation: boolean): Promise<void> {
    await (await this.requireRuntime()).prepareForObservation(allowSessionRotation);
  }

  async getDesktopState(signal?: AbortSignal) {
    return await (await this.requireRuntime()).getDesktopState(signal);
  }
  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
    return await (await this.requireRuntime()).callTool(name, args, signal);
  }
  async getCursorPosition(signal?: AbortSignal) {
    return await (await this.requireRuntime()).getCursorPosition(signal);
  }
  async escalateScope(reason: EscalationReason, signal?: AbortSignal) {
    return await (await this.requireRuntime()).escalateScope(reason, signal);
  }
  async getScreenSize(signal?: AbortSignal) {
    return await (await this.requireRuntime()).getScreenSize(signal);
  }
  async click(
    input: { x: number; y: number; button: ClickButton; count: number },
    signal?: AbortSignal,
  ) {
    return await (await this.requireRuntime()).click(input, signal);
  }
  async drag(
    input: { fromX: number; fromY: number; toX: number; toY: number; durationMs?: bigint },
    signal?: AbortSignal,
  ) {
    return await (await this.requireRuntime()).drag(input, signal);
  }
  async moveCursor(input: { x: number; y: number }, signal?: AbortSignal) {
    return await (await this.requireRuntime()).moveCursor(input, signal);
  }
  async scroll(
    input: { x: number; y: number; direction: ScrollDirection; amount: bigint },
    signal?: AbortSignal,
  ) {
    return await (await this.requireRuntime()).scroll(input, signal);
  }
  async typeText(text: string, signal?: AbortSignal) {
    return await (await this.requireRuntime()).typeText(text, signal);
  }
  async pressKey(input: { key: string; modifiers: string[] }, signal?: AbortSignal) {
    return await (await this.requireRuntime()).pressKey(input, signal);
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    try {
      await this.loadPromise;
    } catch {
      // A failed load has no native resources to release.
    }
    await this.runtime?.dispose();
  }
}

export function createCuaDriver(
  options: { loadSdk?: () => CuaDriverSdk | Promise<CuaDriverSdk>; now?: () => number } = {},
): CuaDriverSession {
  return new LazyCuaDriverSession(
    options.loadSdk ?? loadCuaDriverSdk,
    options.now ?? (() => performance.now()),
  );
}

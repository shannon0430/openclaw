import { registerComputerUseProvider } from "openclaw/plugin-sdk/computer-use";
import type { OpenClawPluginNodeHostCommand } from "openclaw/plugin-sdk/plugin-entry";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCuaComputerProvider } from "./commands.js";
import { execution } from "./commands.test-helpers.js";
import {
  CUA_DRIVER_CONTRACT_FIXTURES,
  cuaToolResult,
} from "./cua-driver-contract.test-fixtures.js";

const mocks = vi.hoisted(() => ({
  callTool: vi.fn<(name: string, argsJSON: string) => Promise<unknown>>(async () => ({})),
  click: vi.fn(async () => ({ effect: 0, route: 2 })),
  close: vi.fn(),
  create: vi.fn(),
  createConfigured: vi.fn(),
  createDesktopTarget: vi.fn(({ displayId }: { displayId: string }) => ({
    tag: "Desktop",
    inner: { displayId },
  })),
  createClickPosition: vi.fn(({ x, y }: { x: number; y: number }) => ({
    tag: "Coordinates",
    inner: { x, y },
  })),
  createTrustedSession: vi.fn(
    (
      _runtime: unknown,
      _options: { publicSession: string; ttlSeconds: bigint; idleTtlSeconds: bigint },
    ) => ({}),
  ),
  drag: vi.fn(async () => ({})),
  endSession: vi.fn(async () => ({})),
  escalateSession: vi.fn(async () => ({
    session: "openclaw-test",
    captureScope: "desktop",
    effectiveScope: "desktop",
    desktopCaptureAuthorized: true,
    desktopUnlocked: true,
  })),
  getCursorPosition: vi.fn(async () => ({})),
  getDesktopState: vi.fn(async () => ({})),
  getSessionState: vi.fn(async () => ({
    session: "openclaw-test",
    captureScope: "desktop",
    effectiveScope: "desktop",
    desktopCaptureAuthorized: true,
    desktopUnlocked: true,
  })),
  isAvailable: vi.fn(() => true),
  isToolError: vi.fn((_error: unknown) => false),
  moveCursor: vi.fn(async () => ({})),
  pressKey: vi.fn(async () => ({})),
  scroll: vi.fn(async () => ({})),
  startSession: vi.fn(async () => ({})),
  shutdown: vi.fn(async () => {}),
  destroy: vi.fn(),
  isDriverError: vi.fn((_error: unknown) => false),
  typeText: vi.fn(async () => ({})),
}));

const sdk = {
  ActionTarget: { Desktop: { new: mocks.createDesktopTarget } },
  ClickPosition: { Coordinates: { new: mocks.createClickPosition } },
  ClickButton: { Left: 0, Right: 1, Middle: 2 },
  CuaDriver: { create: mocks.create, createConfigured: mocks.createConfigured },
  EscalationReason: { Other: "other" },
  DriverError: { instanceOf: mocks.isDriverError, Tool: { instanceOf: mocks.isToolError } },
  InputDeliveryMode: { Foreground: 1 },
  ScrollBy: { Line: 0 },
  ScrollDirection: { Up: 0, Down: 1, Left: 2, Right: 3 },
  SessionPermissionMode: { Unrestricted: "unrestricted" },
  createTrustedSession: mocks.createTrustedSession,
};

import {
  ClickButton,
  createCuaDriver,
  EscalationReason,
  ScrollDirection,
} from "./driver-client.js";

const authorization = {
  allowedModes: ["unrestricted"],
  compatibilityMode: "unrestricted",
  unrestrictedAcknowledged: true,
  maxSessionTtlSeconds: 3_600n,
  maxIdleTtlSeconds: 300n,
};

function nativeSession() {
  return {
    callTool: mocks.callTool,
    click: mocks.click,
    close: mocks.close,
    drag: mocks.drag,
    endSession: mocks.endSession,
    escalateSession: mocks.escalateSession,
    getCursorPosition: mocks.getCursorPosition,
    getDesktopState: mocks.getDesktopState,
    getSessionState: mocks.getSessionState,
    moveCursor: mocks.moveCursor,
    pressKey: mocks.pressKey,
    scroll: mocks.scroll,
    startSession: mocks.startSession,
    typeText: mocks.typeText,
  };
}

describe("CUA Driver direct session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callTool.mockReset().mockResolvedValue({});
    mocks.isToolError.mockReturnValue(false);
    mocks.isDriverError.mockReturnValue(false);
    mocks.createConfigured.mockReturnValue({
      isAvailable: mocks.isAvailable,
      shutdown: mocks.shutdown,
      uniffiDestroy: mocks.destroy,
    });
    mocks.createTrustedSession.mockReturnValue(nativeSession());
  });

  it("admits a second job after idle through the registered command without reusing old target authority", async () => {
    let now = 0;
    const nativeLeases = new Map<string, number>();
    mocks.createTrustedSession.mockImplementation((_runtime, options) => {
      nativeLeases.set(options.publicSession, now);
      return nativeSession();
    });
    mocks.callTool.mockImplementation(async (name, argsJSON) => {
      const args = JSON.parse(argsJSON);
      const last = nativeLeases.get(args.session);
      if (last === undefined || now - last >= 300_000) {
        return cuaToolResult(
          {},
          { isError: true, errorCode: "permission_denied", text: "authorization context expired" },
        );
      }
      nativeLeases.set(args.session, now);
      return cuaToolResult(
        name === "list_windows"
          ? CUA_DRIVER_CONTRACT_FIXTURES.listWindows
          : name === "get_window_state"
            ? CUA_DRIVER_CONTRACT_FIXTURES.windowState
            : {},
      );
    });
    const driver = createCuaDriver({ loadSdk: () => sdk as never, now: () => now });
    const commands: OpenClawPluginNodeHostCommand[] = [];
    registerComputerUseProvider(
      { registerNodeHostCommand: (command) => commands.push(command) },
      createCuaComputerProvider({ platform: "win32", env: {}, driver }),
    );
    const command = commands.find((entry) => entry.command === "computer.act")!;
    const executionId = "00000000-0000-4000-8000-000000000003";
    const act = async (params: Record<string, unknown>) =>
      JSON.parse(await command.handle(JSON.stringify({ executionId, ...params })));
    try {
      const first = await act({ action: "list_windows" });
      const firstRef = first.details.windows[0].windowRef;
      await act({ action: "get_window_state", windowRef: firstRef, includeScreenshot: false });
      await act({ action: "type", windowRef: firstRef, text: "first synthetic job" });
      const firstGeneration = driver.generation;
      now = 301_000;
      const second = await act({ action: "list_windows" });
      expect(driver.generation).not.toBe(firstGeneration);
      const secondRef = second.details.windows[0].windowRef;
      expect(secondRef).not.toBe(firstRef);
      await expect(act({ action: "get_window_state", windowRef: firstRef })).rejects.toThrow(
        "COMPUTER_STALE_OBSERVATION",
      );
      await act({ action: "get_window_state", windowRef: secondRef, includeScreenshot: false });
      await act({ action: "type", windowRef: secondRef, text: "second synthetic job" });
      expect(mocks.createTrustedSession).toHaveBeenCalledTimes(2);
      expect(mocks.createTrustedSession.mock.calls[1]?.[1]).toMatchObject({
        ttlSeconds: 3_299n,
        idleTtlSeconds: 300n,
      });
      expect(mocks.close).toHaveBeenCalledOnce();
      expect(mocks.callTool.mock.calls.filter(([name]) => name === "type_text")).toHaveLength(2);
      expect(mocks.createConfigured).toHaveBeenCalledOnce();
    } finally {
      await command.handle(
        JSON.stringify({ action: "__close_execution", executionId, reason: "completion" }),
      );
    }
  });

  it("does not dispatch or replay an input-first request after idle", async () => {
    let now = 0;
    const driver = createCuaDriver({ loadSdk: () => sdk as never, now: () => now });
    const computer = await execution(driver, "win32");
    mocks.callTool.mockResolvedValue(cuaToolResult(CUA_DRIVER_CONTRACT_FIXTURES.listWindows));
    try {
      const first = JSON.parse(await computer.act('{"action":"list_windows"}'));
      now = 301_000;
      await expect(
        computer.act(
          JSON.stringify({
            action: "type",
            windowRef: first.details.windows[0].windowRef,
            text: "never replay",
          }),
        ),
      ).rejects.toThrow("COMPUTER_STALE_OBSERVATION");
      expect(mocks.callTool).toHaveBeenCalledOnce();
      expect(mocks.createTrustedSession).toHaveBeenCalledOnce();
    } finally {
      await computer.close("completion");
    }
  });

  it.each(["close", "start"])(
    "revalidates the original absolute deadline after an awaited native %s",
    async (phase) => {
      let now = 0;
      const driver = createCuaDriver({ loadSdk: () => sdk as never, now: () => now });
      const computer = await execution(driver, "win32");
      mocks.callTool.mockResolvedValue(cuaToolResult(CUA_DRIVER_CONTRACT_FIXTURES.listWindows));
      try {
        if (phase === "close") {
          await computer.act('{"action":"list_windows"}');
          now = 301_000;
          mocks.close.mockImplementationOnce(() => {
            now = 3_600_000;
          });
        } else {
          mocks.startSession.mockImplementationOnce(async () => {
            now = 3_600_000;
            return {};
          });
        }
        await expect(computer.act('{"action":"list_windows"}')).rejects.toThrow(
          "execution authorization expired",
        );
        expect(mocks.createTrustedSession).toHaveBeenCalledOnce();
        expect(mocks.callTool).toHaveBeenCalledTimes(phase === "close" ? 1 : 0);
      } finally {
        await computer.close("completion");
      }
    },
  );

  it("recomputes remaining TTL after a slow close without extending the original deadline", async () => {
    let now = 0;
    const driver = createCuaDriver({ loadSdk: () => sdk as never, now: () => now });
    const computer = await execution(driver, "win32");
    mocks.callTool.mockResolvedValue(cuaToolResult(CUA_DRIVER_CONTRACT_FIXTURES.listWindows));
    try {
      await computer.act('{"action":"list_windows"}');
      now = 301_000;
      mocks.close.mockImplementationOnce(() => {
        now = 321_000;
      });
      await computer.act('{"action":"list_windows"}');
      expect(mocks.createTrustedSession.mock.calls[1]?.[1]).toMatchObject({
        ttlSeconds: 3_279n,
        idleTtlSeconds: 300n,
      });
    } finally {
      await computer.close("completion");
    }
  });

  it("keeps the original absolute deadline across idle rotations", async () => {
    let now = 0;
    const driver = createCuaDriver({ loadSdk: () => sdk as never, now: () => now });
    const computer = await execution(driver, "win32");
    mocks.callTool.mockResolvedValue(cuaToolResult(CUA_DRIVER_CONTRACT_FIXTURES.listWindows));
    try {
      await computer.act('{"action":"list_windows"}');
      now = 3_550_500;
      await computer.act('{"action":"list_windows"}');
      expect(mocks.createTrustedSession.mock.calls[1]?.[1]).toMatchObject({
        ttlSeconds: 49n,
        idleTtlSeconds: 49n,
      });
      now = 3_600_000;
      await expect(computer.act('{"action":"list_windows"}')).rejects.toThrow(
        "execution authorization expired",
      );
      expect(mocks.createTrustedSession).toHaveBeenCalledTimes(2);
      expect(mocks.callTool).toHaveBeenCalledTimes(2);
    } finally {
      await computer.close("completion");
    }
  });

  it.each(["permission_denied", "authorization_declined", "authorization_expired", "unknown"])(
    "does not mint authority after a native %s failure",
    async (failure) => {
      let now = 0;
      const driver = createCuaDriver({ loadSdk: () => sdk as never, now: () => now });
      const computer = await execution(driver, "win32");
      if (failure !== "unknown") {
        mocks.callTool.mockResolvedValueOnce(
          cuaToolResult(
            {},
            {
              isError: true,
              errorCode: failure,
              text: "authorization context expired",
            },
          ),
        );
      } else {
        mocks.callTool.mockRejectedValueOnce(new Error("unknown native outcome"));
      }
      try {
        await expect(computer.act('{"action":"list_windows"}')).rejects.toThrow();
        now = 301_000;
        await expect(computer.act('{"action":"list_windows"}')).rejects.toThrow(
          "session authorization expired",
        );
        expect(mocks.createTrustedSession).toHaveBeenCalledOnce();
        expect(mocks.callTool).toHaveBeenCalledOnce();
      } finally {
        await computer.close("completion");
      }
    },
  );

  it.each(["target_unavailable", "foreground_unavailable"])(
    "does not turn known %s resource diagnostics into an authority lockout",
    async (errorCode) => {
      const { DriverError } = await import("@trycua/cua-driver");
      mocks.isDriverError.mockImplementation((error) => DriverError.instanceOf(error));
      mocks.isToolError.mockImplementation((error) => DriverError.Tool.instanceOf(error));
      let now = 0;
      const driver = createCuaDriver({ loadSdk: () => sdk as never, now: () => now });
      const computer = await execution(driver, "win32");
      mocks.callTool.mockRejectedValueOnce(
        DriverError.Tool.new({ tool: "list_windows", message: "resource changed", errorCode }),
      );
      try {
        await expect(computer.act('{"action":"list_windows"}')).rejects.toThrow(
          "COMPUTER_DRIVER_ERROR",
        );
        mocks.callTool.mockResolvedValue(cuaToolResult(CUA_DRIVER_CONTRACT_FIXTURES.listWindows));
        await computer.act('{"action":"list_windows"}');
        expect(mocks.createTrustedSession).toHaveBeenCalledOnce();
        now = 301_000;
        await computer.act('{"action":"list_windows"}');
        expect(mocks.createTrustedSession).toHaveBeenCalledTimes(2);
      } finally {
        await computer.close("completion");
      }
    },
  );

  it("does not rotate a recording owner's session at an idle observation boundary", async () => {
    let now = 0;
    const driver = createCuaDriver({ loadSdk: () => sdk as never, now: () => now });
    const computer = await execution(driver, "win32");
    mocks.callTool.mockResolvedValueOnce(
      cuaToolResult(CUA_DRIVER_CONTRACT_FIXTURES.recordingActive),
    );
    try {
      await computer.act('{"action":"start_recording","recordVideo":false}');
      now = 301_000;
      await expect(computer.act('{"action":"list_windows"}')).rejects.toThrow(
        "session authorization expired",
      );
      expect(mocks.createTrustedSession).toHaveBeenCalledOnce();
      expect(mocks.callTool).toHaveBeenCalledOnce();
    } finally {
      // Abort cleanup still closes the native session even though the expired
      // lease cannot dispatch stop_recording.
      await computer.close("cancel").catch(() => {});
      expect(mocks.close).toHaveBeenCalledOnce();
    }
  });

  it("measures idle at admission rather than completion of a slow operation", async () => {
    let now = 0;
    const driver = createCuaDriver({ loadSdk: () => sdk as never, now: () => now });
    const computer = await execution(driver, "win32");
    mocks.callTool.mockImplementationOnce(async () => {
      now = 301_000;
      return cuaToolResult(CUA_DRIVER_CONTRACT_FIXTURES.listWindows);
    });
    try {
      await computer.act('{"action":"list_windows"}');
      mocks.callTool.mockResolvedValueOnce(cuaToolResult(CUA_DRIVER_CONTRACT_FIXTURES.listWindows));
      await computer.act('{"action":"list_windows"}');
      expect(mocks.createTrustedSession).toHaveBeenCalledTimes(2);
      expect(mocks.close).toHaveBeenCalledOnce();
    } finally {
      await computer.close("completion");
    }
  });

  it("matches the installed CUA Driver desktop input enum contract", async () => {
    const driverSdk = await import("@trycua/cua-driver");

    expect(ClickButton).toEqual({
      Left: driverSdk.ClickButton.Left,
      Right: driverSdk.ClickButton.Right,
      Middle: driverSdk.ClickButton.Middle,
    });
    expect(ScrollDirection).toEqual({
      Up: driverSdk.ScrollDirection.Up,
      Down: driverSdk.ScrollDirection.Down,
      Left: driverSdk.ScrollDirection.Left,
      Right: driverSdk.ScrollDirection.Right,
    });
  });

  it("uses configured creation with one trusted lifecycle session", async () => {
    const driver = createCuaDriver({ loadSdk: () => sdk as never });

    expect(driver.isAvailable()).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.createConfigured).toHaveBeenCalledWith({
      claudeCodeCompatibility: false,
      authorization,
    });
    expect(mocks.createTrustedSession).toHaveBeenCalledOnce();
    expect(mocks.createTrustedSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        publicSession: expect.stringMatching(/^openclaw-/),
        mode: "unrestricted",
        ttlSeconds: authorization.maxSessionTtlSeconds,
        idleTtlSeconds: authorization.maxIdleTtlSeconds,
      }),
    );

    await driver.dispose();
    await driver.dispose();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.shutdown).toHaveBeenCalledOnce();
  });

  it.each(["sync", "async"])(
    "discovers windows on the first execution action with %s SDK loading",
    async (loading) => {
      const loadSdk = () => sdk as never;
      const driver = createCuaDriver({
        loadSdk: loading === "async" ? async () => loadSdk() : loadSdk,
      });
      const computer = await execution(driver);
      mocks.callTool.mockResolvedValueOnce(cuaToolResult(CUA_DRIVER_CONTRACT_FIXTURES.listWindows));

      const listed = JSON.parse(await computer.act('{"action":"list_windows"}'));
      expect(listed).toMatchObject({
        ok: true,
        details: {
          windows: [
            {
              windowRef: expect.stringMatching(/^cua:v2:window:/),
              appName: "Editor",
              title: "Notes",
            },
          ],
        },
      });

      await computer.close("completion");
    },
  );

  it("starts the shared lifecycle session once before using driver tools", async () => {
    const driver = createCuaDriver({ loadSdk: () => sdk as never });

    await Promise.all([driver.getDesktopState(), driver.callTool("list_windows", {})]);
    const sessionOptions = mocks.createTrustedSession.mock.calls[0]?.[1];
    if (!sessionOptions) {
      throw new Error("expected the native trusted session to have been created");
    }

    expect(mocks.startSession).toHaveBeenCalledOnce();
    expect(mocks.startSession).toHaveBeenCalledWith(
      { session: sessionOptions.publicSession },
      undefined,
    );
    expect(mocks.getDesktopState).toHaveBeenCalledOnce();
    expect(mocks.callTool).toHaveBeenCalledWith(
      "list_windows",
      JSON.stringify({ session: sessionOptions.publicSession }),
      undefined,
    );

    await driver.dispose();
    expect(mocks.endSession).toHaveBeenCalledOnce();
    expect(mocks.endSession).toHaveBeenCalledWith({ session: sessionOptions.publicSession });
  });

  it("targets desktop input while keeping the global cursor read untargeted", async () => {
    const driver = createCuaDriver({ loadSdk: () => sdk as never });

    const clicked = await driver.click({ x: 20, y: 30, button: ClickButton.Left, count: 1 });
    expect(clicked).toMatchObject({ isError: false, action: { effect: 0, route: 2 } });
    await driver.drag({ fromX: 1, fromY: 2, toX: 3, toY: 4, durationMs: 5n });
    await driver.moveCursor({ x: 6, y: 7 });
    await driver.scroll({ x: 8, y: 9, direction: ScrollDirection.Down, amount: 3n });
    await driver.typeText("hello");
    await driver.pressKey({ key: "a", modifiers: ["cmd"] });
    await driver.getCursorPosition();
    await driver.escalateScope(EscalationReason.Other);

    const sessionOptions = mocks.createTrustedSession.mock.calls[0]?.[1];
    if (!sessionOptions) {
      throw new Error("expected the native trusted session to have been created");
    }
    const target = { tag: "Desktop", inner: { displayId: "primary" } };
    expect(mocks.createDesktopTarget).toHaveBeenCalledOnce();
    expect(mocks.createDesktopTarget).toHaveBeenCalledWith({ displayId: "primary" });
    expect(mocks.click).toHaveBeenCalledWith(
      {
        position: { tag: "Coordinates", inner: { x: 20, y: 30 } },
        deliveryMode: 1,
        button: ClickButton.Left,
        count: 1,
        target,
      },
      undefined,
    );
    expect(mocks.drag).toHaveBeenCalledWith(
      { fromX: 1, fromY: 2, toX: 3, toY: 4, durationMs: 5n, target },
      undefined,
    );
    expect(mocks.moveCursor).toHaveBeenCalledWith({ x: 6, y: 7, target }, undefined);
    expect(mocks.scroll).toHaveBeenCalledWith(
      {
        x: 8,
        y: 9,
        direction: ScrollDirection.Down,
        amount: 3n,
        by: 0,
        target,
      },
      undefined,
    );
    expect(mocks.typeText).toHaveBeenCalledWith({ text: "hello", target }, undefined);
    expect(mocks.pressKey).toHaveBeenCalledWith(
      { key: "a", modifiers: ["cmd"], target },
      undefined,
    );
    expect(mocks.getCursorPosition).toHaveBeenCalledWith(
      { session: sessionOptions.publicSession },
      undefined,
    );
    expect(mocks.getSessionState).toHaveBeenCalledWith(
      { session: sessionOptions.publicSession },
      undefined,
    );
    expect(mocks.escalateSession).not.toHaveBeenCalled();

    await driver.dispose();
  });

  it("preserves typed SDK click refusals in the shared driver result", async () => {
    const { DriverError } = await import("@trycua/cua-driver");
    const refusal = DriverError.Tool.new({
      tool: "click",
      message: "desktop input is unavailable",
      errorCode: "desktop_unavailable",
    });
    mocks.isToolError.mockImplementation((error) => DriverError.Tool.instanceOf(error));
    mocks.click.mockRejectedValueOnce(refusal);
    const driver = createCuaDriver({ loadSdk: () => sdk as never });
    try {
      await expect(
        driver.click({ x: 20, y: 30, button: ClickButton.Left, count: 1 }),
      ).resolves.toMatchObject({
        isError: true,
        errorCode: "desktop_unavailable",
        text: "desktop input is unavailable",
      });
      const transportError = new Error("transport disconnected");
      mocks.click.mockRejectedValueOnce(transportError);
      await expect(driver.click({ x: 20, y: 30, button: ClickButton.Left, count: 1 })).rejects.toBe(
        transportError,
      );
    } finally {
      await driver.dispose();
    }
  });

  it.each(["session_start", "operation"] as const)(
    "reports the native %s failure through standard window discovery without exposing inner content",
    async (phase) => {
      const { DriverError } = await import("@trycua/cua-driver");
      const failure = DriverError.Tool.new({
        tool: "fixture-private-tool",
        message: "fixture-sensitive-message",
        errorCode: "session_unavailable",
      });
      mocks.isDriverError.mockImplementation((error) => DriverError.instanceOf(error));
      mocks.isToolError.mockImplementation((error) => DriverError.Tool.instanceOf(error));
      (phase === "session_start" ? mocks.startSession : mocks.callTool).mockRejectedValueOnce(
        failure,
      );
      const computer = await execution(createCuaDriver({ loadSdk: () => sdk as never }));
      try {
        const result = await computer
          .act('{"action":"list_windows"}')
          .catch((error: unknown) => error);
        expect(result).toMatchObject({
          message: expect.stringContaining(
            `COMPUTER_DRIVER_ERROR: phase=${phase} nativeKind=Tool nativeCode=session_unavailable`,
          ),
          cause: failure,
        });
        expect(String(result)).toMatch(
          /subphase=(session_start|list_windows) driverGeneration=[a-f0-9-]{36}/u,
        );
        expect(String(result)).not.toContain("fixture-private");
        expect(String(result)).not.toContain("fixture-sensitive");
        expect(mocks.callTool).toHaveBeenCalledTimes(phase === "session_start" ? 0 : 1);
      } finally {
        await computer.close("completion");
      }
    },
  );

  it("does not copy arbitrary SDK error codes into a public failure", async () => {
    const { DriverError } = await import("@trycua/cua-driver");
    const failure = DriverError.Tool.new({
      tool: "fixture-private-tool",
      message: "fixture-sensitive-message",
      errorCode: "fixture-sensitive-code",
    });
    mocks.isDriverError.mockImplementation((error) => DriverError.instanceOf(error));
    mocks.isToolError.mockImplementation((error) => DriverError.Tool.instanceOf(error));
    mocks.callTool.mockRejectedValueOnce(failure);
    const computer = await execution(createCuaDriver({ loadSdk: () => sdk as never }));
    try {
      await expect(computer.act('{"action":"list_windows"}')).rejects.toThrow(
        "COMPUTER_DRIVER_ERROR: phase=operation nativeKind=Tool nativeCode=unclassified",
      );
    } finally {
      await computer.close("completion");
    }
  });

  it.each([null, undefined, "fixture-non-sdk-rejection"])(
    "preserves non-SDK rejection identity (%s) through standard window discovery",
    async (failure) => {
      const { DriverError } = await import("@trycua/cua-driver");
      mocks.isDriverError.mockImplementation((error) => DriverError.instanceOf(error));
      mocks.callTool.mockRejectedValueOnce(failure);
      const computer = await execution(createCuaDriver({ loadSdk: () => sdk as never }));
      try {
        await expect(computer.act('{"action":"list_windows"}')).rejects.toBe(failure);
        expect(mocks.isDriverError).not.toHaveBeenCalled();
      } finally {
        await computer.close("completion");
      }
    },
  );

  it("distinguishes a retained physical-close failure from a new action through the registered command", async () => {
    const { DriverError } = await import("@trycua/cua-driver");
    const failure = DriverError.Tool.new({
      tool: "fixture-private-tool",
      message: "fixture-sensitive-message",
      errorCode: "session_unavailable",
    });
    mocks.isDriverError.mockImplementation((error) => DriverError.instanceOf(error));
    mocks.isToolError.mockImplementation((error) => DriverError.Tool.instanceOf(error));
    const commands: OpenClawPluginNodeHostCommand[] = [];
    registerComputerUseProvider(
      { registerNodeHostCommand: (command) => commands.push(command) },
      createCuaComputerProvider({
        platform: "win32",
        env: {},
        driver: createCuaDriver({ loadSdk: () => sdk as never }),
      }),
    );
    const command = commands.find((entry) => entry.command === "computer.act")!;
    const firstId = "00000000-0000-4000-8000-000000000001";
    mocks.callTool.mockResolvedValueOnce(cuaToolResult(CUA_DRIVER_CONTRACT_FIXTURES.listWindows));
    await command.handle(JSON.stringify({ action: "list_windows", executionId: firstId }));
    mocks.endSession.mockRejectedValueOnce(failure);
    const closeError = await command
      .handle(
        JSON.stringify({
          action: "__close_execution",
          executionId: firstId,
          reason: "completion",
        }),
      )
      .catch((error: unknown) => error);
    expect(closeError).toMatchObject({
      message: expect.stringContaining(
        "COMPUTER_DRIVER_ERROR: phase=session_end nativeKind=Tool nativeCode=session_unavailable",
      ),
      cause: { errors: [{ cause: { cause: failure } }] },
    });
    expect(String(closeError)).toContain(
      "cleanup=[session_end=failed,session_close=completed,shutdown=completed,destroy=completed]",
    );
    await expect(
      command.handle(
        JSON.stringify({
          action: "list_windows",
          executionId: "00000000-0000-4000-8000-000000000002",
        }),
      ),
    ).rejects.toBe(closeError);
    expect(command.hasActiveWork?.()).toBe(true);
    expect(mocks.startSession).toHaveBeenCalledOnce();
    expect(mocks.callTool).toHaveBeenCalledOnce();
    expect(mocks.endSession).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.shutdown).toHaveBeenCalledOnce();
  });

  it.each([
    ["session_end", "endSession"],
    ["session_close", "close"],
    ["shutdown", "shutdown"],
    ["destroy", "destroy"],
  ] as const)(
    "retains the native %s cleanup phase and still settles later cleanup",
    async (phase, method) => {
      const { DriverError } = await import("@trycua/cua-driver");
      const failure = DriverError.Tool.new({
        tool: "fixture-private-tool",
        message: "fixture-sensitive-message",
        errorCode: "session_unavailable",
      });
      if (!(failure instanceof Error)) {
        throw new Error("SDK fixture must extend Error");
      }
      const nativeError: Error = failure;
      mocks.isDriverError.mockImplementation((error) => DriverError.instanceOf(error));
      mocks.isToolError.mockImplementation((error) => DriverError.Tool.instanceOf(error));
      const computer = await execution(createCuaDriver({ loadSdk: () => sdk as never }));
      mocks.callTool.mockResolvedValueOnce(cuaToolResult(CUA_DRIVER_CONTRACT_FIXTURES.listWindows));
      await computer.act('{"action":"list_windows"}');
      mocks[method].mockImplementationOnce(() => {
        throw nativeError;
      });
      await expect(computer.close("completion")).rejects.toThrow(
        `COMPUTER_DRIVER_ERROR: phase=${phase} nativeKind=Tool nativeCode=session_unavailable`,
      );
      await expect(computer.close("completion")).rejects.toThrow(`phase=${phase}`);
      expect(mocks.endSession).toHaveBeenCalledOnce();
      expect(mocks.close).toHaveBeenCalledOnce();
      expect(mocks.shutdown).toHaveBeenCalledOnce();
      expect(mocks.destroy).toHaveBeenCalledOnce();
    },
  );

  it("records every failed cleanup step without copying non-SDK cleanup text", async () => {
    const { DriverError } = await import("@trycua/cua-driver");
    mocks.isDriverError.mockImplementation((error) => DriverError.instanceOf(error));
    mocks.isToolError.mockImplementation((error) => DriverError.Tool.instanceOf(error));
    const driver = createCuaDriver({ loadSdk: () => sdk as never });
    mocks.callTool.mockResolvedValueOnce(cuaToolResult(CUA_DRIVER_CONTRACT_FIXTURES.listWindows));
    await driver.callTool("list_windows", {});
    mocks.endSession.mockRejectedValueOnce(
      DriverError.Tool.new({
        tool: "fixture-private-tool",
        message: "fixture-sensitive-message",
        errorCode: "session_unavailable",
      }),
    );
    mocks.shutdown.mockRejectedValueOnce(
      new Error("COMPUTER_DRIVER_ERROR: fixture-sensitive-cleanup"),
    );
    const failure = await driver.dispose().catch((error: unknown) => error);
    expect(String(failure)).toContain(`driverGeneration=${driver.generation}`);
    expect(String(failure)).toContain(
      "cleanup=[session_end=failed,session_close=completed,shutdown=failed,destroy=completed]",
    );
    expect(String(failure)).toContain(
      'cleanupFailures=[{"phase":"session_end","nativeKind":"Tool","nativeCode":"session_unavailable"},{"phase":"shutdown","nativeKind":"unclassified"}]',
    );
    expect(String(failure)).not.toContain("fixture-sensitive");
    expect(String(failure)).not.toContain("fixture-private");
    expect(String(failure)).not.toContain("deliveredCount");
    expect(String(failure)).not.toContain("HRESULT");
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.shutdown).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("keeps native teardown diagnostics when recording cleanup also fails", async () => {
    const { DriverError } = await import("@trycua/cua-driver");
    mocks.isDriverError.mockImplementation((error) => DriverError.instanceOf(error));
    mocks.isToolError.mockImplementation((error) => DriverError.Tool.instanceOf(error));
    const computer = await execution(createCuaDriver({ loadSdk: () => sdk as never }));
    mocks.callTool.mockResolvedValueOnce(
      cuaToolResult(CUA_DRIVER_CONTRACT_FIXTURES.recordingActive),
    );
    await computer.act('{"action":"start_recording","recordVideo":false}');
    mocks.callTool.mockRejectedValueOnce(
      DriverError.Tool.new({
        tool: "fixture-private-tool",
        message: "fixture-sensitive-recording",
        errorCode: "desktop_unavailable",
      }),
    );
    mocks.endSession.mockRejectedValueOnce(
      DriverError.Tool.new({
        tool: "fixture-private-tool",
        message: "fixture-sensitive-message",
        errorCode: "session_unavailable",
      }),
    );
    mocks.shutdown.mockRejectedValueOnce(
      DriverError.Tool.new({
        tool: "fixture-private-tool",
        message: "fixture-sensitive-shutdown",
        errorCode: "transport_lease_required",
      }),
    );
    const failure = await computer.close("cancel").catch((error: unknown) => error);
    expect(String(failure)).toContain(
      "phase=session_end nativeKind=Tool nativeCode=session_unavailable",
    );
    expect(String(failure)).toContain("subphase=stop_recording");
    expect(String(failure)).toContain("nativeCode=desktop_unavailable");
    expect(String(failure)).toContain(
      '"phase":"shutdown","nativeKind":"Tool","nativeCode":"transport_lease_required"',
    );
    expect(String(failure)).toContain(
      "executionCleanup=[recording=failed,resources=completed,driver=failed]",
    );
    expect(String(failure)).not.toContain("fixture-sensitive");
    expect(String(failure)).not.toContain("fixture-private");
    await expect(computer.close("cancel")).rejects.toBe(failure);
    expect(mocks.endSession).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("identifies typed operation failure without using native argument content", async () => {
    const { DriverError } = await import("@trycua/cua-driver");
    mocks.isDriverError.mockImplementation((error) => DriverError.instanceOf(error));
    mocks.isToolError.mockImplementation((error) => DriverError.Tool.instanceOf(error));
    const driver = createCuaDriver({ loadSdk: () => sdk as never });
    mocks.getDesktopState.mockRejectedValueOnce(
      DriverError.Tool.new({
        tool: "fixture-private-tool",
        message: "fixture-sensitive-message",
        errorCode: "desktop_unavailable",
      }),
    );
    await expect(driver.getDesktopState()).rejects.toThrow(
      `subphase=get_desktop_state driverGeneration=${driver.generation}`,
    );
    await driver.dispose();
  });

  it.each([
    [0, "not_started"],
    [1, "completed"],
    [2, "unknown"],
  ] as const)(
    "preserves native interruption completion=%s without inferring input count",
    async (completion, expected) => {
      const { DriverError, ActionCompletion } = await import("@trycua/cua-driver");
      expect([
        ActionCompletion.NotStarted,
        ActionCompletion.Completed,
        ActionCompletion.Unknown,
      ]).toEqual([0, 1, 2]);
      mocks.isDriverError.mockImplementation((error) => DriverError.instanceOf(error));
      mocks.isToolError.mockImplementation((error) => DriverError.Tool.instanceOf(error));
      const driver = createCuaDriver({ loadSdk: () => sdk as never });
      mocks.callTool.mockRejectedValueOnce(
        DriverError.ActionInterrupted.new({ completion, reason: "fixture-sensitive-reason" }),
      );
      const failure = await driver.callTool("list_windows", {}).catch((error: unknown) => error);
      expect(String(failure)).toContain(`actionCompletion=${expected}`);
      expect(String(failure)).not.toContain("fixture-sensitive-reason");
      expect(String(failure)).not.toContain("deliveredCount");
      await driver.dispose();
    },
  );

  it("keeps a missing native desktop library behind command availability", async () => {
    const loadSdk = vi.fn(() => {
      throw new Error("libX11.so.6: cannot open shared object file");
    });
    const driver = createCuaDriver({ loadSdk });

    expect(loadSdk).not.toHaveBeenCalled();
    expect(driver.isAvailable()).toBe(false);
    expect(loadSdk).toHaveBeenCalledOnce();
    await expect(driver.getScreenSize()).rejects.toThrow(
      "COMPUTER_DRIVER_UNAVAILABLE: failed to load CUA Driver SDK: libX11.so.6",
    );

    driver.resetAvailabilityCache();
    expect(driver.isAvailable()).toBe(false);
    expect(loadSdk).toHaveBeenCalledTimes(2);
    await driver.dispose();
  });

  it("awaits an ESM driver before the first availability declaration without starting an execution", async () => {
    let resolveSdk: ((value: typeof sdk) => void) | undefined;
    const sdkPromise = new Promise<typeof sdk>((resolve) => {
      resolveSdk = resolve;
    });
    const loadSdk = vi.fn(() => sdkPromise as never);
    const driver = createCuaDriver({ loadSdk });

    const preparing = driver.prepareAvailability?.();
    expect(loadSdk).toHaveBeenCalledOnce();

    resolveSdk?.(sdk);
    await preparing;
    expect(driver.isAvailable()).toBe(true);
    expect(mocks.startSession).not.toHaveBeenCalled();
    await driver.getDesktopState();

    expect(loadSdk).toHaveBeenCalledOnce();
    expect(mocks.createConfigured).toHaveBeenCalledOnce();
    expect(mocks.getDesktopState).toHaveBeenCalledOnce();
    await driver.dispose();
  });

  it("retries an asynchronous ESM import failure after the availability cache resets", async () => {
    let attempt = 0;
    const loadSdk = vi.fn(() => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new Error("native module is temporarily unavailable"))
        : Promise.resolve(sdk as never);
    });
    const driver = createCuaDriver({ loadSdk });

    await driver.prepareAvailability?.();
    expect(driver.isAvailable()).toBe(false);
    await expect(driver.getDesktopState()).rejects.toThrow(
      "COMPUTER_DRIVER_UNAVAILABLE: failed to load CUA Driver SDK: native module is temporarily unavailable",
    );

    driver.resetAvailabilityCache();
    expect(driver.isAvailable()).toBe(false);
    await vi.waitFor(() => expect(driver.isAvailable()).toBe(true));

    expect(loadSdk).toHaveBeenCalledTimes(2);
    await driver.dispose();
  });
});

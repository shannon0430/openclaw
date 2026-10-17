import { createMessageReceiptFromOutboundResults } from "openclaw/plugin-sdk/channel-outbound";
import {
  addTestHook,
  createEmptyPluginRegistry,
  createTestRegistry,
  initializeGlobalHookRunner,
  resetGlobalHookRunner,
  resetPluginRuntimeStateForTest,
  setActivePluginRegistry,
} from "openclaw/plugin-sdk/channel-test-helpers";
import { drainPendingDeliveries } from "openclaw/plugin-sdk/delivery-queue-runtime";
import { PlatformMessageNotDispatchedError } from "openclaw/plugin-sdk/error-runtime";
import { getReplyPayloadMetadata } from "openclaw/plugin-sdk/reply-payload";
import { buildReplyPayloads } from "openclaw/plugin-sdk/reply-payload-testing";
import {
  dispatchInboundMessage,
  finalizeInboundContext,
  resetInboundDedupe,
  type ReplyPayload,
} from "openclaw/plugin-sdk/reply-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSlackAccount } from "../../accounts.js";
import { slackPlugin } from "../../channel.js";
import type { SlackStreamSession } from "../../streaming.js";
import { createInboundSlackTestContext } from "./prepare.test-helpers.js";
import type { PreparedSlackMessage } from "./types.js";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  reconcile: vi.fn(),
  legacySend: vi.fn(),
  observeFinal: vi.fn(),
  finalizeCard: vi.fn(),
  cleanup: vi.fn(),
  cancel: vi.fn(),
  error: vi.fn(),
}));
let expiredStream = false;
let useDraftCard = false;
let sourceReplyMode: "auto" | "message_tool_only" = "auto";
let finalPayload: ReplyPayload = { text: "Completed synthetic work." };
let sendBlock = false;
let observedFinal = false;
let useSourceDispatch = false;
const threadTs = "1790000000.000001";
const childTs = "1790000001.000002";
const sessionKey = `agent:main:slack:channel:c123:thread:${threadTs}`;

vi.mock("../../send.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../send.js")>()),
  sendMessageSlack: mocks.send,
  reconcileSlackUnknownSend: mocks.reconcile,
}));
vi.mock("../replies.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../replies.js")>()),
  deliverReplies: mocks.legacySend,
}));
vi.mock("../session-run-targets.js", () => ({ registerSlackSessionRun: () => () => {} }));
vi.mock("openclaw/plugin-sdk/channel-outbound", async (importOriginal) => ({
  ...(await importOriginal<typeof import("openclaw/plugin-sdk/channel-outbound")>()),
  createChannelMessageReplyPipeline: () => ({}),
  resolveChannelMessageSourceReplyDeliveryMode: () => sourceReplyMode,
}));
vi.mock("./dispatch-progress.js", () => ({
  createSlackProgressRuntime: ({
    delivery,
    setup,
  }: {
    delivery: ReturnType<
      typeof import("./dispatch-streaming.js").createSlackStreamingDeliveryRuntime
    >;
    setup: import("./dispatch-setup.js").SlackDispatchSetup;
  }) => {
    if (expiredStream) {
      delivery.streamSession = {
        channel: "C123",
        threadTs,
        stopped: true,
        stoppedBySlack: false,
        delivered: false,
        pendingText: "",
      } as SlackStreamSession;
    }
    return {
      useDraftProgressCard: useDraftCard,
      useNativeProgressStreaming: setup.slackStreaming.mode === "progress",
      isProgressMode: setup.slackStreaming.mode === "progress",
      nativeProgressCompletionSent: false,
      nativeProgressTerminalStatus: "complete",
      cancel: mocks.cancel,
      finalizeDraftProgressCard: mocks.finalizeCard,
      dropDetachedProgressCards: async () => {},
      buildNativeProgressCompletionChunks: () => undefined,
      progressDraft: {},
      previewLifecycle: {
        get finalStarted() {
          return observedFinal;
        },
        get finalDelivered() {
          return observedFinal;
        },
        previewFinalized: false,
        observeDelivery: mocks.observeFinal,
        cleanup: mocks.cleanup,
        deliver: async ({
          payload,
          deliverNormally,
        }: {
          payload: ReplyPayload;
          deliverNormally: (payload: ReplyPayload) => Promise<unknown>;
        }) => ({ deliveryResult: await deliverNormally(payload) }),
      },
      deliverNativeFinal: (payload: ReplyPayload, kind: "final") =>
        delivery.deliverNormally({ payload, kind }),
      appendNativeNarration: (payload: ReplyPayload, kind: "block") =>
        delivery.deliverNormally({ payload, kind }),
    };
  },
}));

import { dispatchPreparedSlackMessage } from "./dispatch.js";

function prepare(): PreparedSlackMessage {
  const cfg = {
    channels: {
      slack: {
        botToken: "xoxb-test",
        appToken: "xapp-test",
        streaming: {
          mode: "progress" as const,
          nativeTransport: true,
          progress: { style: "card" as const, nativeTaskCards: true },
        },
      },
    },
  };
  const ctx = createInboundSlackTestContext({ cfg, replyToMode: "all" });
  ctx.botToken = "xoxb-test";
  ctx.runtime.error = mocks.error;
  ctx.setSlackSessionStatus = async () => false;
  ctx.dispatchReplyFromConfig = async (params) => {
    if (useSourceDispatch) {
      return await dispatchInboundMessage({
        ...params,
        replyResolver: async (_ctx, options) => {
          options?.onAgentRunStart?.("synthetic-slack-final");
          return finalPayload;
        },
      });
    }
    const { dispatcher } = params;
    if (sendBlock) {
      dispatcher.sendBlockReply({ text: "Still working." });
    }
    if (sourceReplyMode === "message_tool_only") {
      return { queuedFinal: false, counts: dispatcher.getQueuedCounts() };
    }
    return {
      queuedFinal: dispatcher.sendFinalReply(finalPayload),
      counts: dispatcher.getQueuedCounts(),
    };
  };
  return {
    ctx,
    account: resolveSlackAccount({ cfg, accountId: "default" }),
    message: { type: "message", channel: "C123", ts: childTs, thread_ts: threadTs, user: "U123" },
    route: {
      agentId: "main",
      accountId: "default",
      channel: "slack",
      mainSessionKey: "agent:main:main",
      sessionKey,
      lastRoutePolicy: "session",
      matchedBy: "default",
    },
    ctxPayload: finalizeInboundContext({
      AgentId: "main",
      AccountId: "default",
      SessionKey: sessionKey,
      Provider: "slack",
      Surface: "slack",
      OriginatingChannel: "slack",
      OriginatingTo: "channel:C123",
      To: "channel:C123",
      From: "slack:C123",
      MessageThreadId: threadTs,
      ReplyToId: childTs,
      MessageSid: childTs,
      ChatType: "channel",
      SenderId: "U123",
      Body: "Complete the synthetic work.",
    }),
    replyTarget: "channel:C123",
    replyToMode: "all",
    channelConfig: null,
    turn: { storePath: "/tmp/slack-synthetic-sessions.json", record: {} },
    requireMention: false,
    isDirectMessage: false,
    isRoomish: true,
    preview: "",
    ackReactionValue: "eyes",
    ackReactionPromise: null,
  };
}

async function drain(
  prepared: PreparedSlackMessage,
  inspect: (entry: { id: string; recoveryState?: string }) => void,
) {
  await drainPendingDeliveries({
    cfg: prepared.ctx.cfg,
    drainKey: "slack-test-final",
    logLabel: "slack-test-final",
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    selectEntry: (entry) => {
      inspect(entry);
      return { match: true, bypassBackoff: true };
    },
  });
}

describe("Slack standalone automatic final custody", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetInboundDedupe();
    expiredStream = false;
    useDraftCard = false;
    sourceReplyMode = "auto";
    sendBlock = false;
    observedFinal = false;
    useSourceDispatch = false;
    finalPayload = { text: "Completed synthetic work." };
    mocks.cancel.mockResolvedValue(undefined);
    mocks.observeFinal.mockImplementation(async () => {
      observedFinal = true;
    });
    mocks.finalizeCard.mockResolvedValue(true);
    mocks.cleanup.mockResolvedValue(undefined);
    mocks.legacySend.mockResolvedValue({
      messageId: "legacy-1",
      channelId: "C123",
      receipt: createMessageReceiptFromOutboundResults({
        results: [{ channel: "slack", channelId: "C123", messageId: "legacy-1" }],
      }),
    });
    mocks.send.mockImplementation(async (_to, _text, options) => {
      await options.onPlatformSendDispatch?.();
      return {
        messageId: "1790000002.000003",
        channelId: "C123",
        threadTs,
        receipt: createMessageReceiptFromOutboundResults({
          results: [{ channel: "slack", channelId: "C123", messageId: "1790000002.000003" }],
          threadId: threadTs,
        }),
      };
    });
    mocks.reconcile.mockResolvedValue({ status: "unresolved", retryable: true });
    setActivePluginRegistry(
      createTestRegistry([{ pluginId: "slack", source: "test", plugin: slackPlugin }]),
    );
  });
  afterEach(() => {
    resetGlobalHookRunner();
    resetPluginRuntimeStateForTest();
  });

  it("runs shared final send modifiers and settlement hooks once", async () => {
    const registry = createEmptyPluginRegistry();
    const modifyingHook = vi.fn(async () => ({ content: "Accepted modified final." }));
    const sentHook = vi.fn();
    addTestHook({
      registry,
      pluginId: "synthetic-hooks",
      hookName: "message_sending",
      handler: modifyingHook,
    });
    addTestHook({
      registry,
      pluginId: "synthetic-hooks",
      hookName: "message_sent",
      handler: sentHook,
    });
    initializeGlobalHookRunner(registry);
    await dispatchPreparedSlackMessage(prepare());
    expect(modifyingHook).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
      "channel:C123",
      "Accepted modified final.",
      expect.objectContaining({ accountId: "default", threadTs }),
    );
    expect(sentHook).toHaveBeenCalledOnce();
    expect(mocks.legacySend).not.toHaveBeenCalled();
  });

  it("sends a durable final to the exact root with the same account and identity, then finalizes its card", async () => {
    useDraftCard = true;
    const prepared = prepare();
    prepared.relayIdentity = { username: "Synthetic agent", iconEmoji: ":robot_face:" };
    await dispatchPreparedSlackMessage(prepared);
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
      "channel:C123",
      finalPayload.text,
      expect.objectContaining({
        accountId: "default",
        threadTs,
        cfg: prepared.ctx.cfg,
        identity: prepared.relayIdentity,
        deliveryQueueId: expect.any(String),
      }),
    );
    expect(mocks.legacySend).not.toHaveBeenCalled();
    expect(mocks.observeFinal).toHaveBeenCalledOnce();
    expect(mocks.finalizeCard).toHaveBeenCalledExactlyOnceWith("success");
    const pending = vi.fn();
    await drain(prepared, pending);
    expect(pending).not.toHaveBeenCalled();
  });

  it.each([
    { name: "implicit current child", replyToId: undefined, expectedThreadTs: threadTs },
    {
      name: "explicit current child",
      replyToId: undefined,
      replyToCurrent: true,
      expectedThreadTs: threadTs,
    },
    {
      name: "explicit different target",
      replyToId: "1790000009.000009",
      expectedThreadTs: "1790000009.000009",
    },
  ])(
    "routes a normalized $name through the canonical durable thread",
    async ({ replyToId, replyToCurrent, expectedThreadTs }) => {
      useSourceDispatch = true;
      const { replyPayloads } = await buildReplyPayloads({
        payloads: [
          {
            text: "Completed synthetic work.",
            ...(replyToId ? { replyToId } : {}),
            ...(replyToCurrent ? { replyToCurrent } : {}),
          },
        ],
        isHeartbeat: false,
        didLogHeartbeatStrip: false,
        blockStreamingEnabled: false,
        blockReplyPipeline: null,
        replyToMode: "all",
        replyToChannel: "slack",
        currentMessageId: childTs,
        messageProvider: "slack",
        originatingChannel: "slack",
        originatingChatType: "channel",
        originatingTo: "channel:C123",
        originatingThreadId: threadTs,
        accountId: "default",
      });
      const normalized = replyPayloads[0];
      if (!normalized) {
        throw new Error("expected normalized synthetic final");
      }
      expect(normalized.replyToId).toBe(replyToId ?? childTs);
      expect(getReplyPayloadMetadata(normalized)?.replyToIdExplicit === true).toBe(
        Boolean(replyToId),
      );
      finalPayload = normalized;

      await dispatchPreparedSlackMessage(prepare());

      expect(mocks.send).toHaveBeenCalledOnce();
      expect(mocks.send.mock.calls[0]?.[0]).toBe("channel:C123");
      expect(mocks.send.mock.calls[0]?.[1]).toBe(finalPayload.text);
      expect(mocks.send.mock.calls[0]?.[2].threadTs).toBe(expectedThreadTs);
      expect(mocks.send.mock.calls[0]?.[2].accountId).toBe("default");
      expect(mocks.legacySend).not.toHaveBeenCalled();
    },
  );

  it("keeps an ambiguous failed final under one durable intent and reconciles without a second send", async () => {
    useSourceDispatch = true;
    const prepared = prepare();
    mocks.send.mockImplementationOnce(async (_to, _text, options) => {
      await options.onPlatformSendDispatch?.();
      throw new Error("fetch failed");
    });
    await expect(dispatchPreparedSlackMessage(prepared)).rejects.toThrow("fetch failed");
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.legacySend).not.toHaveBeenCalled();
    expect(mocks.observeFinal).not.toHaveBeenCalled();
    const pending = vi.fn();
    await drain(prepared, pending);
    expect(pending).toHaveBeenCalledWith(
      expect.objectContaining({
        id: mocks.send.mock.calls[0]?.[2].deliveryQueueId,
        recoveryState: "unknown_after_send",
      }),
    );
    expect(mocks.reconcile).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledOnce();
    mocks.reconcile.mockResolvedValue({ status: "sent", messageId: "1790000002.000003" });
    await drain(prepared, () => {});
    const remaining = vi.fn();
    await drain(prepared, remaining);
    expect(remaining).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it("retries a proven pre-dispatch failure through the native recovery owner", async () => {
    const prepared = prepare();
    mocks.send.mockImplementationOnce(async () => {
      throw new PlatformMessageNotDispatchedError("transport not opened", {
        cause: new Error("synthetic pre-dispatch connection failure"),
      });
    });
    await expect(dispatchPreparedSlackMessage(prepared)).rejects.toThrow("transport not opened");
    expect(mocks.send).toHaveBeenCalledOnce();
    const pending = vi.fn();
    await drain(prepared, pending);
    expect(pending).toHaveBeenCalledWith(
      expect.objectContaining({
        id: mocks.send.mock.calls[0]?.[2].deliveryQueueId,
      }),
    );
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send.mock.calls[1]?.[2].deliveryQueueId).toBe(
      mocks.send.mock.calls[0]?.[2].deliveryQueueId,
    );
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.legacySend).not.toHaveBeenCalled();
  });

  it("delivers the final after optional native progress expires without changing block delivery", async () => {
    expiredStream = true;
    sendBlock = true;
    await dispatchPreparedSlackMessage(prepare());
    expect(mocks.legacySend).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send.mock.calls[0]?.[2].threadTs).toBe(threadTs);
    expect(mocks.observeFinal).toHaveBeenCalledOnce();
  });

  it("keeps an off/first-mode final unthreaded after the block consumes the root", async () => {
    sendBlock = true;
    const prepared = prepare();
    prepared.replyToMode = "first";
    prepared.message.thread_ts = undefined;
    prepared.ctxPayload = finalizeInboundContext({
      ...prepared.ctxPayload,
      MessageThreadId: undefined,
      ReplyToId: undefined,
    });
    const slackConfig = prepared.ctx.cfg.channels?.slack;
    if (!slackConfig) {
      throw new Error("expected synthetic Slack config");
    }
    slackConfig.streaming = { mode: "off" };
    prepared.account = resolveSlackAccount({ cfg: prepared.ctx.cfg, accountId: "default" });
    await dispatchPreparedSlackMessage(prepared);
    expect(mocks.legacySend).toHaveBeenCalledOnce();
    expect(mocks.legacySend.mock.calls[0]?.[0].replyThreadTs).toBe(childTs);
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send.mock.calls[0]?.[2].threadTs).toBeUndefined();
  });

  it("preserves source-only silence and unsupported Slack metadata delivery", async () => {
    sourceReplyMode = "message_tool_only";
    await dispatchPreparedSlackMessage(prepare());
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.legacySend).not.toHaveBeenCalled();
    sourceReplyMode = "auto";
    const prepared = prepare();
    prepared.slackMessageMetadata = { event_type: "synthetic", event_payload: {} };
    await dispatchPreparedSlackMessage(prepared);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.legacySend).toHaveBeenCalledOnce();
  });
});

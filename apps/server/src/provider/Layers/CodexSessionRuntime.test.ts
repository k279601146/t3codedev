import assert from "node:assert/strict";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, it } from "vitest";
import { ThreadId } from "@t3tools/contracts";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as CodexRpc from "effect-codex-app-server/rpc";

import {
  buildT3BrowserDynamicTools,
  buildT3BrowserExternalDynamicTools,
  T3_BROWSER_EXTERNAL_TOOL_NAMESPACE,
  T3_BROWSER_TOOL_NAMESPACE,
} from "../browserTools.ts";
import { buildT3ComputerDynamicTools, T3_COMPUTER_TOOL_NAMESPACE } from "../computerTools.ts";
import {
  CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
} from "../CodexDeveloperInstructions.ts";
import {
  buildThreadSettingsUpdateParams,
  buildTurnStartParams,
  isRecoverableThreadResumeError,
  openCodexThread,
} from "./CodexSessionRuntime.ts";
const isCodexAppServerRequestError = Schema.is(CodexErrors.CodexAppServerRequestError);
type TestThreadOpenMethod = "thread/start" | "thread/resume" | "thread/settings/update";
const commercialThreadConfigOverrides = {
  model_provider: "myservice",
  "model_providers.myservice": {
    name: "MyService",
    base_url: "https://www.bahew.com/v1",
    env_key: "MYIDE_IDE_JWT",
    wire_api: "responses",
    requires_openai_auth: false,
    http_headers: {
      "x-openai-actor-authorization": "t3code-commercial-gateway",
    },
    supports_websockets: false,
  },
};

function makeThreadOpenResponse(
  threadId: string,
): CodexRpc.ClientRequestResponsesByMethod["thread/start"] {
  return {
    cwd: "/tmp/project",
    model: "gpt-5.3-codex",
    modelProvider: "openai",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: { type: "danger-full-access" },
    thread: {
      id: threadId,
      createdAt: "2026-04-18T00:00:00.000Z",
      source: { session: "cli" },
      turns: [],
      status: {
        state: "idle",
        activeFlags: [],
      },
    },
  } as unknown as CodexRpc.ClientRequestResponsesByMethod["thread/start"];
}

describe("buildTurnStartParams", () => {
  it.each([
    ["approval-required", { type: "readOnly" }, "untrusted"],
    ["auto-accept-edits", { type: "workspaceWrite" }, "on-request"],
    ["full-access", { type: "dangerFullAccess" }, "never"],
  ] as const)(
    "maps composer runtime mode %s to turn/start sandboxPolicy",
    (runtimeMode, sandboxPolicy, approvalPolicy) => {
      const params = Effect.runSync(
        buildTurnStartParams({
          threadId: "provider-thread-1",
          runtimeMode,
          prompt: "Check permissions",
        }),
      );

      assert.deepStrictEqual(params.sandboxPolicy, sandboxPolicy);
      assert.equal(params.approvalPolicy, approvalPolicy);
    },
  );

  it("passes personality through to turn/start", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Use the configured tone",
        personality: "friendly",
      }),
    );

    assert.equal(params.personality, "friendly");
  });

  it("includes plan collaboration mode when requested", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Make a plan",
        model: "gpt-5.3-codex",
        effort: "medium",
        interactionMode: "plan",
      }),
    );

    assert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "dangerFullAccess",
      },
      input: [
        {
          type: "text",
          text: "Make a plan",
        },
      ],
      model: "gpt-5.3-codex",
      effort: "medium",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
        },
      },
    });
  });

  it("includes default collaboration mode and image attachments", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "auto-accept-edits",
        prompt: "Implement it",
        model: "gpt-5.3-codex",
        interactionMode: "default",
        attachments: [
          {
            type: "image",
            url: "data:image/png;base64,abc",
          },
        ],
      }),
    );

    assert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "workspaceWrite",
      },
      input: [
        {
          type: "text",
          text: "Implement it",
        },
        {
          type: "image",
          url: "data:image/png;base64,abc",
        },
      ],
      model: "gpt-5.3-codex",
      collaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
        },
      },
    });
  });

  it("passes local image attachments through to turn/start", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Inspect this screenshot",
        attachments: [
          {
            type: "localImage",
            path: "C:\\tmp\\screen.png",
          },
        ],
      }),
    );

    assert.deepStrictEqual(params.input, [
      {
        type: "text",
        text: "Inspect this screenshot",
      },
      {
        type: "localImage",
        path: "C:\\tmp\\screen.png",
      },
    ]);
  });

  it("passes text elements through with text input", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Inspect @file",
        textElements: [
          {
            byteRange: { start: 8, end: 13 },
            placeholder: "@file",
          },
        ],
      }),
    );

    assert.deepStrictEqual(params.input, [
      {
        type: "text",
        text: "Inspect @file",
        text_elements: [
          {
            byteRange: { start: 8, end: 13 },
            placeholder: "@file",
          },
        ],
      },
    ]);
  });

  it("omits collaboration mode when interaction mode is absent", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "approval-required",
        prompt: "Review",
      }),
    );

    assert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "readOnly",
      },
      input: [
        {
          type: "text",
          text: "Review",
        },
      ],
    });
  });
});

describe("buildThreadSettingsUpdateParams", () => {
  it("maps auto-accept-edits to official thread settings sandbox semantics", () => {
    assert.deepStrictEqual(
      buildThreadSettingsUpdateParams({
        threadId: "provider-thread-1",
        runtimeMode: "auto-accept-edits",
        cwd: "/tmp/project",
        model: "gpt-5.3-codex",
        serviceTier: undefined,
      }),
      {
        threadId: "provider-thread-1",
        cwd: "/tmp/project",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxPolicy: {
          type: "workspaceWrite",
        },
        model: "gpt-5.3-codex",
      },
    );
  });

  it("keeps omitted fields unchanged and uses null to clear explicit overrides", () => {
    assert.deepStrictEqual(
      buildThreadSettingsUpdateParams({
        threadId: "provider-thread-1",
        model: null,
        serviceTier: null,
        effort: null,
        personality: null,
        summary: null,
      }),
      {
        threadId: "provider-thread-1",
        model: null,
        serviceTier: null,
        effort: null,
        personality: null,
        summary: null,
      },
    );
  });

  it("does not combine a permissions profile with sandboxPolicy", () => {
    assert.deepStrictEqual(
      buildThreadSettingsUpdateParams({
        threadId: "provider-thread-1",
        permissions: "trusted-write",
        sandboxPolicy: {
          type: "workspaceWrite",
        },
        runtimeMode: "auto-accept-edits",
      }),
      {
        threadId: "provider-thread-1",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        permissions: "trusted-write",
      },
    );
  });
});

describe("isRecoverableThreadResumeError", () => {
  it("matches missing thread errors", () => {
    assert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Thread does not exist",
        }),
      ),
      true,
    );
  });

  it("ignores non-recoverable resume errors", () => {
    assert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Permission denied",
        }),
      ),
      false,
    );
  });

  it("ignores unrelated missing-resource errors that do not mention threads", () => {
    assert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Config file not found",
        }),
      ),
      false,
    );
    assert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Model does not exist",
        }),
      ),
      false,
    );
  });
});

describe("openCodexThread", () => {
  it("omits T3 browser, external browser, and computer dynamic tools by default", async () => {
    let startPayload: CodexRpc.ClientRequestParamsByMethod["thread/start"] | undefined;
    let settingsPayload: CodexRpc.ClientRequestParamsByMethod["thread/settings/update"] | undefined;
    const client = {
      request: <M extends TestThreadOpenMethod>(
        method: M,
        payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        if (method === "thread/start") {
          startPayload = payload as CodexRpc.ClientRequestParamsByMethod["thread/start"];
        }
        if (method === "thread/settings/update") {
          settingsPayload =
            payload as CodexRpc.ClientRequestParamsByMethod["thread/settings/update"];
          return Effect.succeed({} as CodexRpc.ClientRequestResponsesByMethod[M]);
        }
        return Effect.succeed(
          makeThreadOpenResponse("fresh-thread") as CodexRpc.ClientRequestResponsesByMethod[M],
        );
      },
    };

    await Effect.runPromise(
      openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        requestedModelProvider: "myservice",
        requestedConfigOverrides: commercialThreadConfigOverrides,
        serviceTier: undefined,
        personality: undefined,
        resumeThreadId: undefined,
      }),
    );

    assert.ok(startPayload);
    assert.equal(startPayload.approvalsReviewer, "user");
    assert.equal(startPayload.modelProvider, "myservice");
    assert.deepStrictEqual(startPayload.config, commercialThreadConfigOverrides);
    assert.equal(startPayload.dynamicTools, undefined);
    assert.deepStrictEqual(settingsPayload, {
      threadId: "fresh-thread",
      cwd: "/tmp/project",
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "dangerFullAccess",
      },
      model: "gpt-5.3-codex",
    });
  });

  it("injects T3 dynamic tools only when explicitly enabled", async () => {
    let startPayload: CodexRpc.ClientRequestParamsByMethod["thread/start"] | undefined;
    const client = {
      request: <M extends TestThreadOpenMethod>(
        method: M,
        payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        if (method === "thread/start") {
          startPayload = payload as CodexRpc.ClientRequestParamsByMethod["thread/start"];
        }
        return Effect.succeed(
          (method === "thread/settings/update"
            ? {}
            : makeThreadOpenResponse("fresh-thread")) as CodexRpc.ClientRequestResponsesByMethod[M],
        );
      },
    };

    await Effect.runPromise(
      openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        requestedModelProvider: "myservice",
        requestedConfigOverrides: commercialThreadConfigOverrides,
        serviceTier: undefined,
        personality: undefined,
        enableT3DynamicTools: true,
        resumeThreadId: undefined,
      }),
    );

    assert.ok(startPayload);
    assert.deepStrictEqual(startPayload.dynamicTools, [
      ...buildT3BrowserDynamicTools(),
      ...buildT3BrowserExternalDynamicTools(),
      ...buildT3ComputerDynamicTools(),
    ]);
    const browserTools = buildT3BrowserDynamicTools();
    const externalTools = buildT3BrowserExternalDynamicTools();
    const computerTools = buildT3ComputerDynamicTools();
    assert.equal(startPayload.dynamicTools?.[0]?.type, "namespace");
    assert.equal(startPayload.dynamicTools?.[0]?.name, T3_BROWSER_TOOL_NAMESPACE);
    assert.equal(startPayload.dynamicTools?.[0]?.tools?.[0]?.type, "function");
    assert.equal(
      startPayload.dynamicTools?.[browserTools.length]?.name,
      T3_BROWSER_EXTERNAL_TOOL_NAMESPACE,
    );
    const externalToolNames =
      externalTools[0]?.type === "namespace" ? externalTools[0].tools.map((tool) => tool.name) : [];
    assert.equal(externalToolNames.includes("browser_set_viewport"), false);
    assert.equal(externalToolNames.includes("browser_reset_viewport"), false);
    assert.equal(externalToolNames.includes("browser_set_visibility"), false);
    assert.equal(startPayload.dynamicTools?.at(-1)?.name, T3_COMPUTER_TOOL_NAMESPACE);
    assert.deepStrictEqual(
      [browserTools.length, externalTools.length, computerTools.length],
      [1, 1, 1],
    );
  });

  it("injects only requested T3 dynamic tool namespaces", async () => {
    let startPayload: CodexRpc.ClientRequestParamsByMethod["thread/start"] | undefined;
    const client = {
      request: <M extends TestThreadOpenMethod>(
        method: M,
        payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        if (method === "thread/start") {
          startPayload = payload as CodexRpc.ClientRequestParamsByMethod["thread/start"];
        }
        return Effect.succeed(
          (method === "thread/settings/update"
            ? {}
            : makeThreadOpenResponse("fresh-thread")) as CodexRpc.ClientRequestResponsesByMethod[M],
        );
      },
    };

    await Effect.runPromise(
      openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: undefined,
        requestedModelProvider: undefined,
        requestedConfigOverrides: undefined,
        serviceTier: undefined,
        personality: undefined,
        enabledT3DynamicToolNamespaces: ["computer", "browser", "computer"],
        resumeThreadId: undefined,
      }),
    );

    assert.ok(startPayload);
    assert.deepStrictEqual(startPayload.dynamicTools, [
      ...buildT3BrowserDynamicTools(),
      ...buildT3ComputerDynamicTools(),
    ]);
  });

  it("prefers structured T3 dynamic tool namespaces over the legacy boolean", async () => {
    let startPayload: CodexRpc.ClientRequestParamsByMethod["thread/start"] | undefined;
    const client = {
      request: <M extends TestThreadOpenMethod>(
        method: M,
        payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        if (method === "thread/start") {
          startPayload = payload as CodexRpc.ClientRequestParamsByMethod["thread/start"];
        }
        return Effect.succeed(
          (method === "thread/settings/update"
            ? {}
            : makeThreadOpenResponse("fresh-thread")) as CodexRpc.ClientRequestResponsesByMethod[M],
        );
      },
    };

    await Effect.runPromise(
      openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: undefined,
        requestedModelProvider: undefined,
        requestedConfigOverrides: undefined,
        serviceTier: undefined,
        personality: undefined,
        enableT3DynamicTools: true,
        enabledT3DynamicToolNamespaces: ["browser"],
        resumeThreadId: undefined,
      }),
    );

    assert.ok(startPayload);
    assert.deepStrictEqual(startPayload.dynamicTools, buildT3BrowserDynamicTools());
  });

  it("falls back to thread/start when resume fails recoverably", async () => {
    const calls: Array<{ method: TestThreadOpenMethod; payload: unknown }> = [];
    const started = makeThreadOpenResponse("fresh-thread");
    const client = {
      request: <M extends TestThreadOpenMethod>(
        method: M,
        payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        calls.push({ method, payload });
        if (method === "thread/settings/update") {
          return Effect.succeed({} as CodexRpc.ClientRequestResponsesByMethod[M]);
        }
        if (method === "thread/resume") {
          return Effect.fail(
            new CodexErrors.CodexAppServerRequestError({
              code: -32603,
              errorMessage: "thread not found",
            }),
          );
        }
        return Effect.succeed(started as CodexRpc.ClientRequestResponsesByMethod[M]);
      },
    };

    const opened = await Effect.runPromise(
      openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        requestedModelProvider: "myservice",
        requestedConfigOverrides: commercialThreadConfigOverrides,
        serviceTier: undefined,
        personality: undefined,
        resumeThreadId: "stale-thread",
      }),
    );

    assert.equal(opened.thread.id, "fresh-thread");
    assert.deepStrictEqual(
      calls.map((call) => call.method),
      ["thread/resume", "thread/start", "thread/settings/update"],
    );
    assert.equal(
      (calls[0]?.payload as CodexRpc.ClientRequestParamsByMethod["thread/resume"]).modelProvider,
      "myservice",
    );
    assert.deepStrictEqual(
      (calls[0]?.payload as CodexRpc.ClientRequestParamsByMethod["thread/resume"]).config,
      commercialThreadConfigOverrides,
    );
    assert.equal(
      (calls[1]?.payload as CodexRpc.ClientRequestParamsByMethod["thread/start"]).modelProvider,
      "myservice",
    );
    assert.deepStrictEqual(
      (calls[1]?.payload as CodexRpc.ClientRequestParamsByMethod["thread/start"]).config,
      commercialThreadConfigOverrides,
    );
  });

  it("propagates non-recoverable resume failures", async () => {
    const client = {
      request: <M extends TestThreadOpenMethod>(
        method: M,
        _payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) => {
        if (method === "thread/settings/update") {
          return Effect.succeed({} as CodexRpc.ClientRequestResponsesByMethod[M]);
        }
        if (method === "thread/resume") {
          return Effect.fail(
            new CodexErrors.CodexAppServerRequestError({
              code: -32603,
              errorMessage: "timed out waiting for server",
            }),
          );
        }
        return Effect.succeed(
          makeThreadOpenResponse("fresh-thread") as CodexRpc.ClientRequestResponsesByMethod[M],
        );
      },
    };

    await assert.rejects(
      Effect.runPromise(
        openCodexThread({
          client,
          threadId: ThreadId.make("thread-1"),
          runtimeMode: "full-access",
          cwd: "/tmp/project",
          requestedModel: "gpt-5.3-codex",
          requestedModelProvider: undefined,
          requestedConfigOverrides: undefined,
          serviceTier: undefined,
          personality: undefined,
          resumeThreadId: "stale-thread",
        }),
      ),
      (error: unknown) =>
        isCodexAppServerRequestError(error) &&
        error.errorMessage === "timed out waiting for server",
    );
  });
});

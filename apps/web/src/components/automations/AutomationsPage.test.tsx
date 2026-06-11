import {
  AutomationId,
  AutomationRunId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type Automation,
  type AutomationListResult,
  type AutomationRun,
  type OrchestrationShellSnapshot,
} from "@t3tools/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useStore } from "~/store";
import { AutomationsPage } from "./AutomationsPage";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("~/environments/runtime", () => ({
  getPrimaryEnvironmentConnection: () => ({
    client: {
      automations: {
        list: vi.fn(),
        upsert: vi.fn(),
        delete: vi.fn(),
        runNow: vi.fn(),
        archiveRun: vi.fn(),
        markRunRead: vi.fn(),
        subscribe: vi.fn(() => () => undefined),
      },
    },
  }),
}));

const environmentId = EnvironmentId.make("environment-local");
const projectId = ProjectId.make("project-1");
const threadId = ThreadId.make("thread-1");
const createdAt = "2026-01-01T00:00:00.000Z";

function syncShellState() {
  const snapshot: OrchestrationShellSnapshot = {
    snapshotSequence: 1,
    updatedAt: createdAt,
    projects: [
      {
        id: projectId,
        title: "示例项目",
        workspaceRoot: "/tmp/project",
        repositoryIdentity: null,
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        scripts: [],
        createdAt,
        updatedAt: createdAt,
      },
    ],
    threads: [
      {
        id: threadId,
        projectId,
        title: "持续上下文线程",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        runtimeMode: "auto-accept-edits",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt,
        updatedAt: createdAt,
        archivedAt: null,
        session: null,
        latestUserMessageAt: null,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        hasActionableProposedPlan: false,
      },
    ],
  };
  useStore.setState({
    activeEnvironmentId: null,
    environmentStateById: {},
  });
  useStore.getState().syncServerShellSnapshot(snapshot, environmentId);
}

function renderPage(snapshot: AutomationListResult) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  queryClient.setQueryData(["automations", "snapshot"], snapshot);

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AutomationsPage />
    </QueryClientProvider>,
  );
}

function makeAutomation(): Automation {
  return {
    id: AutomationId.make("automation-1"),
    title: "每日简报",
    prompt: "总结最近一天的 git 活动。",
    status: "enabled",
    schedule: {
      kind: "daily",
      time: "09:00",
    },
    target: {
      kind: "project",
      projectId,
      runMode: "worktree",
    },
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    runtimeMode: "auto-accept-edits",
    interactionMode: "default",
    nextRunAt: "2026-01-02T09:00:00.000Z",
    lastRunAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function makeRun(): AutomationRun {
  return {
    id: AutomationRunId.make("run-1"),
    automationId: AutomationId.make("automation-1"),
    status: "completed",
    trigger: "scheduled",
    startedAt: "2026-01-01T09:00:00.000Z",
    completedAt: "2026-01-01T09:01:00.000Z",
    resultThreadId: threadId,
    summary: "运行完成。",
    error: null,
    archivedAt: null,
    readAt: null,
    createdAt: "2026-01-01T09:00:00.000Z",
    updatedAt: "2026-01-01T09:01:00.000Z",
  };
}

describe("AutomationsPage", () => {
  beforeEach(() => {
    syncShellState();
  });

  it("renders the real management empty state", async () => {
    const markup = renderPage({ automations: [], runs: [] });

    expect(markup).toContain("还没有自动化");
    expect(markup).toContain("创建自动化");
    expect(markup).toContain("Triage");
  });

  it("renders automations, inbox and run history", async () => {
    const markup = renderPage({
      automations: [makeAutomation()],
      runs: [makeRun()],
    });

    expect(markup).toContain("每日简报");
    expect(markup).toContain("每天 09:00");
    expect(markup).toContain("项目：project-1");
    expect(markup).toContain("运行历史");
    expect(markup).toContain("运行完成。");
  });
});

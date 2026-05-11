import { create } from "zustand";

const CURSOR_LAYOUT_STATE_KEY = "t3code:cursor-layout:v1";

interface PersistedCursorLayoutState {
  pinnedProjectKeys?: string[];
  collapsedPinnedProjectKeys?: Record<string, boolean>;
  projectDockCollapsed?: boolean;
}

interface CursorLayoutState {
  pinnedProjectKeys: string[];
  collapsedPinnedProjectKeys: Record<string, boolean>;
  projectDockCollapsed: boolean;
  pinProject: (projectKey: string) => void;
  unpinProject: (projectKey: string) => void;
  setPinnedProjects: (projectKeys: readonly string[]) => void;
  togglePinnedProject: (projectKey: string) => void;
  setProjectDockCollapsed: (collapsed: boolean) => void;
}

function readPersistedState(): Pick<
  CursorLayoutState,
  "pinnedProjectKeys" | "collapsedPinnedProjectKeys" | "projectDockCollapsed"
> {
  if (typeof window === "undefined") {
    return {
      pinnedProjectKeys: [],
      collapsedPinnedProjectKeys: {},
      projectDockCollapsed: false,
    };
  }

  try {
    const raw = window.localStorage.getItem(CURSOR_LAYOUT_STATE_KEY);
    if (!raw) {
      return {
        pinnedProjectKeys: [],
        collapsedPinnedProjectKeys: {},
        projectDockCollapsed: false,
      };
    }
    const parsed = JSON.parse(raw) as PersistedCursorLayoutState;
    return {
      pinnedProjectKeys: Array.isArray(parsed.pinnedProjectKeys)
        ? parsed.pinnedProjectKeys.filter((key) => typeof key === "string" && key.length > 0)
        : [],
      collapsedPinnedProjectKeys:
        parsed.collapsedPinnedProjectKeys && typeof parsed.collapsedPinnedProjectKeys === "object"
          ? Object.fromEntries(
              Object.entries(parsed.collapsedPinnedProjectKeys).filter(
                ([key, value]) => key.length > 0 && typeof value === "boolean",
              ),
            )
          : {},
      projectDockCollapsed: parsed.projectDockCollapsed === true,
    };
  } catch {
    return {
      pinnedProjectKeys: [],
      collapsedPinnedProjectKeys: {},
      projectDockCollapsed: false,
    };
  }
}

function persistCursorLayoutState(state: CursorLayoutState): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      CURSOR_LAYOUT_STATE_KEY,
      JSON.stringify({
        pinnedProjectKeys: state.pinnedProjectKeys,
        collapsedPinnedProjectKeys: state.collapsedPinnedProjectKeys,
        projectDockCollapsed: state.projectDockCollapsed,
      } satisfies PersistedCursorLayoutState),
    );
  } catch {
    // Ignore storage failures; the sidebar should stay usable.
  }
}

export const useCursorLayoutStore = create<CursorLayoutState>((set) => ({
  ...readPersistedState(),
  pinProject: (projectKey) =>
    set((state) => {
      if (state.pinnedProjectKeys.includes(projectKey)) {
        return state;
      }
      return {
        pinnedProjectKeys: [...state.pinnedProjectKeys, projectKey],
        collapsedPinnedProjectKeys: {
          ...state.collapsedPinnedProjectKeys,
          [projectKey]: false,
        },
      };
    }),
  unpinProject: (projectKey) =>
    set((state) => {
      const nextCollapsed = { ...state.collapsedPinnedProjectKeys };
      delete nextCollapsed[projectKey];
      return {
        pinnedProjectKeys: state.pinnedProjectKeys.filter((key) => key !== projectKey),
        collapsedPinnedProjectKeys: nextCollapsed,
      };
    }),
  setPinnedProjects: (projectKeys) =>
    set((state) => {
      const nextProjectKeys = [...new Set(projectKeys)];
      const retainedProjectKeys = new Set(nextProjectKeys);
      const nextCollapsed = Object.fromEntries(
        Object.entries(state.collapsedPinnedProjectKeys).filter(([key]) =>
          retainedProjectKeys.has(key),
        ),
      );
      return {
        pinnedProjectKeys: nextProjectKeys,
        collapsedPinnedProjectKeys: nextCollapsed,
      };
    }),
  togglePinnedProject: (projectKey) =>
    set((state) => ({
      collapsedPinnedProjectKeys: {
        ...state.collapsedPinnedProjectKeys,
        [projectKey]: !(state.collapsedPinnedProjectKeys[projectKey] ?? false),
      },
    })),
  setProjectDockCollapsed: (collapsed) => set({ projectDockCollapsed: collapsed }),
}));

useCursorLayoutStore.subscribe((state) => persistCursorLayoutState(state));

import { create } from "zustand";

const CURSOR_LAYOUT_STATE_KEY = "t3code:cursor-layout:v1";
export type CursorSidebarColumnId = "explorer" | "projects";
export type DefaultSidebarSectionId = "projects" | "conversations";
const DEFAULT_SIDEBAR_COLUMN_ORDER: readonly CursorSidebarColumnId[] = ["explorer", "projects"];
const DEFAULT_DEFAULT_SIDEBAR_SECTION_ORDER: readonly DefaultSidebarSectionId[] = [
  "projects",
  "conversations",
];

interface PersistedCursorLayoutState {
  pinnedProjectKeys?: string[];
  collapsedPinnedProjectKeys?: Record<string, boolean>;
  projectDockCollapsed?: boolean;
  sidebarColumnOrder?: CursorSidebarColumnId[];
  defaultSidebarSectionOrder?: DefaultSidebarSectionId[];
}

interface CursorLayoutState {
  pinnedProjectKeys: string[];
  collapsedPinnedProjectKeys: Record<string, boolean>;
  pendingPinnedProjectKeys: Record<string, number>;
  projectDockCollapsed: boolean;
  sidebarColumnOrder: CursorSidebarColumnId[];
  defaultSidebarSectionOrder: DefaultSidebarSectionId[];
  pinProject: (projectKey: string) => void;
  unpinProject: (projectKey: string) => void;
  setPinnedProjects: (projectKeys: readonly string[]) => void;
  togglePinnedProject: (projectKey: string) => void;
  setProjectDockCollapsed: (collapsed: boolean) => void;
  setSidebarColumnOrder: (order: readonly CursorSidebarColumnId[]) => void;
  setDefaultSidebarSectionOrder: (order: readonly DefaultSidebarSectionId[]) => void;
}

function sanitizeSidebarColumnOrder(value: unknown): CursorSidebarColumnId[] {
  const requested = Array.isArray(value)
    ? value.filter((entry): entry is CursorSidebarColumnId =>
        entry === "explorer" || entry === "projects",
      )
    : [];
  return [
    ...requested.filter((entry, index) => requested.indexOf(entry) === index),
    ...DEFAULT_SIDEBAR_COLUMN_ORDER.filter((entry) => !requested.includes(entry)),
  ];
}

function sanitizeDefaultSidebarSectionOrder(value: unknown): DefaultSidebarSectionId[] {
  const requested = Array.isArray(value)
    ? value.filter((entry): entry is DefaultSidebarSectionId =>
        entry === "projects" || entry === "conversations",
      )
    : [];
  return [
    ...requested.filter((entry, index) => requested.indexOf(entry) === index),
    ...DEFAULT_DEFAULT_SIDEBAR_SECTION_ORDER.filter((entry) => !requested.includes(entry)),
  ];
}

function readPersistedState(): Pick<
  CursorLayoutState,
  | "pinnedProjectKeys"
  | "collapsedPinnedProjectKeys"
  | "projectDockCollapsed"
  | "sidebarColumnOrder"
  | "defaultSidebarSectionOrder"
> {
  if (typeof window === "undefined") {
    return {
      pinnedProjectKeys: [],
      collapsedPinnedProjectKeys: {},
      projectDockCollapsed: false,
      sidebarColumnOrder: [...DEFAULT_SIDEBAR_COLUMN_ORDER],
      defaultSidebarSectionOrder: [...DEFAULT_DEFAULT_SIDEBAR_SECTION_ORDER],
    };
  }

  try {
    const raw = window.localStorage.getItem(CURSOR_LAYOUT_STATE_KEY);
    if (!raw) {
      return {
        pinnedProjectKeys: [],
        collapsedPinnedProjectKeys: {},
        projectDockCollapsed: false,
        sidebarColumnOrder: [...DEFAULT_SIDEBAR_COLUMN_ORDER],
        defaultSidebarSectionOrder: [...DEFAULT_DEFAULT_SIDEBAR_SECTION_ORDER],
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
      sidebarColumnOrder: sanitizeSidebarColumnOrder(parsed.sidebarColumnOrder),
      defaultSidebarSectionOrder: sanitizeDefaultSidebarSectionOrder(
        parsed.defaultSidebarSectionOrder,
      ),
    };
  } catch {
    return {
      pinnedProjectKeys: [],
      collapsedPinnedProjectKeys: {},
      projectDockCollapsed: false,
      sidebarColumnOrder: [...DEFAULT_SIDEBAR_COLUMN_ORDER],
      defaultSidebarSectionOrder: [...DEFAULT_DEFAULT_SIDEBAR_SECTION_ORDER],
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
        sidebarColumnOrder: state.sidebarColumnOrder,
        defaultSidebarSectionOrder: state.defaultSidebarSectionOrder,
      } satisfies PersistedCursorLayoutState),
    );
  } catch {
    // Ignore storage failures; the sidebar should stay usable.
  }
}

export const useCursorLayoutStore = create<CursorLayoutState>((set) => ({
  ...readPersistedState(),
  pendingPinnedProjectKeys: {},
  pinProject: (projectKey) =>
    set((state) => {
      if (state.pinnedProjectKeys.includes(projectKey)) {
        return state;
      }
      return {
        pinnedProjectKeys: [...state.pinnedProjectKeys, projectKey],
        pendingPinnedProjectKeys: {
          ...state.pendingPinnedProjectKeys,
          [projectKey]: Date.now(),
        },
        collapsedPinnedProjectKeys: {
          ...state.collapsedPinnedProjectKeys,
          [projectKey]: false,
        },
      };
    }),
  unpinProject: (projectKey) =>
    set((state) => {
      const nextCollapsed = { ...state.collapsedPinnedProjectKeys };
      const nextPending = { ...state.pendingPinnedProjectKeys };
      delete nextCollapsed[projectKey];
      delete nextPending[projectKey];
      return {
        pinnedProjectKeys: state.pinnedProjectKeys.filter((key) => key !== projectKey),
        collapsedPinnedProjectKeys: nextCollapsed,
        pendingPinnedProjectKeys: nextPending,
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
      const nextPending = Object.fromEntries(
        Object.entries(state.pendingPinnedProjectKeys).filter(([key]) =>
          retainedProjectKeys.has(key),
        ),
      );
      return {
        pinnedProjectKeys: nextProjectKeys,
        collapsedPinnedProjectKeys: nextCollapsed,
        pendingPinnedProjectKeys: nextPending,
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
  setSidebarColumnOrder: (order) => set({ sidebarColumnOrder: sanitizeSidebarColumnOrder(order) }),
  setDefaultSidebarSectionOrder: (order) =>
    set({ defaultSidebarSectionOrder: sanitizeDefaultSidebarSectionOrder(order) }),
}));

useCursorLayoutStore.subscribe((state) => persistCursorLayoutState(state));

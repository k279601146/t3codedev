import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "./lib/storage";

export const RIGHT_PANEL_SURFACES = [
  "home",
  "review",
  "file",
  "image",
  "artifacts",
  "browser",
  "computer",
  "terminal",
  "summary",
] as const;

export type RightPanelSurface = (typeof RIGHT_PANEL_SURFACES)[number];

export const RIGHT_PANEL_DEFAULT_WIDTH_PX = 480;
export const RIGHT_PANEL_MIN_WIDTH_PX = 280;
export const RIGHT_PANEL_MAX_WIDTH_PX = 960;

const RIGHT_PANEL_STORAGE_KEY = "t3code:right-panel:v1";

interface PersistedRightPanelState {
  activeSurface?: RightPanelSurface;
  widthPx?: number;
  lastSurfaceByThreadKey?: Record<string, RightPanelSurface>;
}

interface RightPanelState {
  open: boolean;
  activeSurface: RightPanelSurface;
  widthPx: number;
  lastSurfaceByThreadKey: Record<string, RightPanelSurface>;
  close: () => void;
  openSurface: (surface: RightPanelSurface, threadKey?: string | null) => void;
  setActiveSurface: (surface: RightPanelSurface, threadKey?: string | null) => void;
  setWidthPx: (widthPx: number) => void;
  restoreThreadSurface: (threadKey: string | null | undefined) => void;
  toggleSurface: (surface: RightPanelSurface, threadKey?: string | null) => void;
}

export function isRightPanelSurface(value: unknown): value is RightPanelSurface {
  return typeof value === "string" && RIGHT_PANEL_SURFACES.includes(value as RightPanelSurface);
}

export function clampRightPanelWidth(widthPx: number): number {
  if (!Number.isFinite(widthPx)) {
    return RIGHT_PANEL_DEFAULT_WIDTH_PX;
  }
  return Math.min(
    RIGHT_PANEL_MAX_WIDTH_PX,
    Math.max(RIGHT_PANEL_MIN_WIDTH_PX, Math.round(widthPx)),
  );
}

export function chooseDefaultRightPanelSurface(input: {
  diffOpen: boolean;
  hasReviewChanges: boolean;
  hasSummary: boolean;
  hasArtifacts: boolean;
  terminalOpen: boolean;
}): RightPanelSurface {
  if (input.diffOpen || input.hasReviewChanges) return "review";
  if (input.hasSummary) return "summary";
  if (input.hasArtifacts) return "artifacts";
  if (input.terminalOpen) return "terminal";
  return "browser";
}

function sanitizeLastSurfaceByThreadKey(
  value: PersistedRightPanelState["lastSurfaceByThreadKey"],
): Record<string, RightPanelSurface> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      ([threadKey, surface]) => threadKey.length > 0 && isRightPanelSurface(surface),
    ),
  ) as Record<string, RightPanelSurface>;
}

function rememberSurface(
  lastSurfaceByThreadKey: Record<string, RightPanelSurface>,
  threadKey: string | null | undefined,
  surface: RightPanelSurface,
): Record<string, RightPanelSurface> {
  if (!threadKey) {
    return lastSurfaceByThreadKey;
  }
  if (lastSurfaceByThreadKey[threadKey] === surface) {
    return lastSurfaceByThreadKey;
  }
  return {
    ...lastSurfaceByThreadKey,
    [threadKey]: surface,
  };
}

function createRightPanelStorage() {
  return resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined);
}

export const useRightPanelStore = create<RightPanelState>()(
  persist(
    (set) => ({
      open: false,
      activeSurface: "home",
      widthPx: RIGHT_PANEL_DEFAULT_WIDTH_PX,
      lastSurfaceByThreadKey: {},
      close: () => set({ open: false }),
      openSurface: (surface, threadKey) =>
        set((state) => ({
          open: true,
          activeSurface: surface,
          lastSurfaceByThreadKey: rememberSurface(state.lastSurfaceByThreadKey, threadKey, surface),
        })),
      setActiveSurface: (surface, threadKey) =>
        set((state) => ({
          activeSurface: surface,
          lastSurfaceByThreadKey: rememberSurface(state.lastSurfaceByThreadKey, threadKey, surface),
        })),
      setWidthPx: (widthPx) => set({ widthPx: clampRightPanelWidth(widthPx) }),
      restoreThreadSurface: (threadKey) =>
        set((state) => {
          const restoredSurface = threadKey ? state.lastSurfaceByThreadKey[threadKey] : undefined;
          return restoredSurface ? { activeSurface: restoredSurface } : state;
        }),
      toggleSurface: (surface, threadKey) =>
        set((state) => {
          const nextOpen = !(state.open && state.activeSurface === surface);
          return {
            open: nextOpen,
            activeSurface: surface,
            lastSurfaceByThreadKey: rememberSurface(
              state.lastSurfaceByThreadKey,
              threadKey,
              surface,
            ),
          };
        }),
    }),
    {
      name: RIGHT_PANEL_STORAGE_KEY,
      storage: createJSONStorage(createRightPanelStorage),
      partialize: (state): PersistedRightPanelState => ({
        activeSurface: state.activeSurface,
        widthPx: state.widthPx,
        lastSurfaceByThreadKey: state.lastSurfaceByThreadKey,
      }),
      merge: (persisted, current) => {
        const parsed = persisted as PersistedRightPanelState;
        return {
          ...current,
          open: false,
          activeSurface: isRightPanelSurface(parsed.activeSurface)
            ? parsed.activeSurface
            : current.activeSurface,
          widthPx: clampRightPanelWidth(parsed.widthPx ?? current.widthPx),
          lastSurfaceByThreadKey: sanitizeLastSurfaceByThreadKey(parsed.lastSurfaceByThreadKey),
        };
      },
    },
  ),
);

import { create } from "zustand";

interface CommandPaletteOpenIntent {
  kind: "add-project";
  requestId: number;
}

interface OpenAddProjectOptions {
  pinToCursorExplorer?: boolean;
}

interface CommandPaletteStore {
  open: boolean;
  openIntent: CommandPaletteOpenIntent | null;
  pinNextAddedProjectToCursorExplorer: boolean;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  openAddProject: (options?: OpenAddProjectOptions) => void;
  clearOpenIntent: () => void;
  consumePinNextAddedProjectToCursorExplorer: () => boolean;
}

export const useCommandPaletteStore = create<CommandPaletteStore>((set) => ({
  open: false,
  openIntent: null,
  pinNextAddedProjectToCursorExplorer: false,
  setOpen: (open) =>
    set({
      open,
      ...(open ? {} : { openIntent: null, pinNextAddedProjectToCursorExplorer: false }),
    }),
  toggleOpen: () =>
    set((state) => ({
      open: !state.open,
      ...(state.open ? { openIntent: null, pinNextAddedProjectToCursorExplorer: false } : {}),
    })),
  openAddProject: (options) =>
    set((state) => ({
      open: true,
      pinNextAddedProjectToCursorExplorer:
        state.pinNextAddedProjectToCursorExplorer || options?.pinToCursorExplorer === true,
      openIntent: {
        kind: "add-project",
        requestId: (state.openIntent?.requestId ?? 0) + 1,
      },
    })),
  clearOpenIntent: () => set({ openIntent: null }),
  consumePinNextAddedProjectToCursorExplorer: () => {
    let shouldPin = false;
    set((state) => {
      shouldPin = state.pinNextAddedProjectToCursorExplorer;
      return shouldPin ? { pinNextAddedProjectToCursorExplorer: false } : state;
    });
    return shouldPin;
  },
}));

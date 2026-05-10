import type { DesktopCommercialAuthState } from "@t3tools/contracts";
import { useEffect, useState } from "react";

const listeners = new Set<() => void>();
let currentState: DesktopCommercialAuthState | null = null;

export function publishDesktopCommercialAuthState(state: DesktopCommercialAuthState): void {
  currentState = state;
  for (const listener of listeners) {
    listener();
  }
}

export function readDesktopCommercialAuthStateSnapshot(): DesktopCommercialAuthState | null {
  return currentState;
}

export function subscribeDesktopCommercialAuthState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePublishedDesktopCommercialAuthState(): DesktopCommercialAuthState | null {
  const [state, setState] = useState(readDesktopCommercialAuthStateSnapshot);

  useEffect(
    () =>
      subscribeDesktopCommercialAuthState(() => {
        setState(readDesktopCommercialAuthStateSnapshot());
      }),
    [],
  );

  return state;
}

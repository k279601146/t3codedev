import React, { createContext, useContext } from 'react';
import type { FpsMetrics } from "../utils/fpsTracker.ts";

type FpsMetricsGetter = () => FpsMetrics | undefined;

const FpsMetricsContext = createContext<FpsMetricsGetter | undefined>(undefined);

type Props = {
  getFpsMetrics: FpsMetricsGetter;
  children: React.ReactNode;
};

export function FpsMetricsProvider({ getFpsMetrics, children }: Props): React.ReactNode {
  return <FpsMetricsContext.Provider value={getFpsMetrics}>{children}</FpsMetricsContext.Provider>;
}

export function useFpsMetrics(): FpsMetricsGetter | undefined {
  return useContext(FpsMetricsContext);
}

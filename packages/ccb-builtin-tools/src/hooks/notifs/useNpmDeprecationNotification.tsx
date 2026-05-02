import { isInBundledMode } from "@t3tools/ccb-engine/src/utils/bundledMode.ts";
import { getCurrentInstallationType } from "@t3tools/ccb-engine/src/utils/doctorDiagnostic.ts";
import { isEnvTruthy } from "@t3tools/ccb-engine/src/utils/envUtils.ts";
import { useStartupNotification } from "./useStartupNotification.ts";

const NPM_DEPRECATION_MESSAGE = '';

export function useNpmDeprecationNotification(): void {
  useStartupNotification(async () => {
    if (isInBundledMode() || isEnvTruthy(process.env.DISABLE_INSTALLATION_CHECKS)) {
      return null;
    }
    const installationType = await getCurrentInstallationType();
    if (installationType === 'development') return null;
    return {
      timeoutMs: 15000,
      key: 'npm-deprecation-warning',
      text: NPM_DEPRECATION_MESSAGE,
      color: 'warning',
      priority: 'high',
    };
  });
}


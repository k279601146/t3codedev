import { createFileRoute } from "@tanstack/react-router";

import { GeneralSettingsPanel } from "../components/settings/SettingsPanels";

function SettingsProvidersRoute() {
  return <GeneralSettingsPanel />;
}

export const Route = createFileRoute("/settings/providers")({
  component: SettingsProvidersRoute,
});

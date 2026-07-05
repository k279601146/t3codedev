import { createFileRoute } from "@tanstack/react-router";

import { RemoteControlSettingsPanel } from "../components/settings/RemoteControlSettings";

function SettingsRemoteControlRoute() {
  return <RemoteControlSettingsPanel />;
}

export const Route = createFileRoute("/settings/remote-control")({
  component: SettingsRemoteControlRoute,
});

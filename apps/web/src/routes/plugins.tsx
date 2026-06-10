import { createFileRoute, redirect } from "@tanstack/react-router";

import { PluginsPage } from "../components/plugins/PluginsPage";

function PluginsRouteView() {
  return <PluginsPage />;
}

export const Route = createFileRoute("/plugins")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: PluginsRouteView,
});

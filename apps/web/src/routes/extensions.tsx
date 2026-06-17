import { createFileRoute, redirect } from "@tanstack/react-router";

import { ExtensionsPage } from "../components/extensions/ExtensionsPage";

function ExtensionsRouteView() {
  return <ExtensionsPage />;
}

export const Route = createFileRoute("/extensions")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ExtensionsRouteView,
});

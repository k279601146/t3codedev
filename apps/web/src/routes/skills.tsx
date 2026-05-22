import { createFileRoute, redirect } from "@tanstack/react-router";

import { SkillsPage } from "../components/skills/SkillsPage";

function SkillsRouteView() {
  return <SkillsPage />;
}

export const Route = createFileRoute("/skills")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: SkillsRouteView,
});

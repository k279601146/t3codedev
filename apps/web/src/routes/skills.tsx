import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/skills")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
    throw redirect({ to: "/extensions", replace: true });
  },
});

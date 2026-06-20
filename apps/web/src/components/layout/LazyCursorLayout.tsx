import { lazy, Suspense } from "react";

import { SidebarInset } from "../ui/sidebar";

const CursorLayout = lazy(() =>
  import("./CursorLayout").then((module) => ({ default: module.CursorLayout })),
);

function CursorLayoutFallback() {
  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
        正在加载编辑器...
      </div>
    </SidebarInset>
  );
}

export function LazyCursorLayout() {
  return (
    <Suspense fallback={<CursorLayoutFallback />}>
      <CursorLayout />
    </Suspense>
  );
}

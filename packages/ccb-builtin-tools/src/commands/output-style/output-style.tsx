import type { LocalJSXCommandOnDone } from "@t3tools/ccb-engine/src/types/command.ts";

export async function call(onDone: LocalJSXCommandOnDone): Promise<undefined> {
  onDone(
    '/output-style has been deprecated. Use /config to change your output style, or set it in your settings file. Changes take effect on the next session.',
    { display: 'system' },
  );
}


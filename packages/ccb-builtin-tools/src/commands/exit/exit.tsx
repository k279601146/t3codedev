import {  feature  } from "../../featureFlags.ts";
import { spawnSync } from 'child_process';
import sample from "lodash-es/sample.js";
import * as React from 'react';
import { ExitFlow } from "@t3tools/ccb-engine/src/components/ExitFlow.ts";
import type { LocalJSXCommandOnDone } from "@t3tools/ccb-engine/src/types/command.ts";
import { isBgSession } from "@t3tools/ccb-engine/src/utils/concurrentSessions.ts";
import { gracefulShutdown } from "@t3tools/ccb-engine/src/utils/gracefulShutdown.ts";
import { getCurrentWorktreeSession } from "@t3tools/ccb-engine/src/utils/worktree.ts";

const GOODBYE_MESSAGES = ['Goodbye!', 'See ya!', 'Bye!', 'Catch you later!'];

function getRandomGoodbyeMessage(): string {
  return sample(GOODBYE_MESSAGES) ?? 'Goodbye!';
}

export async function call(onDone: LocalJSXCommandOnDone): Promise<React.ReactNode> {
  // Inside a `claude --bg` tmux session: detach instead of kill. The REPL
  // keeps running; `claude attach` can reconnect. Covers /exit, /quit,
  // ctrl+c, ctrl+d â€?all funnel through here via REPL's handleExit.
  if (feature('BG_SESSIONS') && isBgSession()) {
    onDone();
    spawnSync('tmux', ['detach-client'], { stdio: 'ignore' });
    return null;
  }

  const showWorktree = getCurrentWorktreeSession() !== null;

  if (showWorktree) {
    return <ExitFlow showWorktree={showWorktree} onDone={onDone} onCancel={() => onDone()} />;
  }

  onDone(getRandomGoodbyeMessage());
  await gracefulShutdown(0, 'prompt_input_exit');
  return null;
}


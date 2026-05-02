import * as React from 'react';
import type { LocalJSXCommandContext } from "../../commands.ts";
import { SkillsMenu } from "../../components/skills/SkillsMenu.ts";
import type { LocalJSXCommandOnDone } from "../../types/command.ts";

export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  return <SkillsMenu onExit={onDone} commands={context.options.commands} />;
}

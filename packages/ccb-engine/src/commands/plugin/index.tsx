import type { Command } from "../../commands.ts";

const plugin = {
  type: 'local-jsx',
  name: 'plugin',
  aliases: ['plugins', 'marketplace'],
  description: 'Manage Claude Code plugins',
  immediate: true,
  load: () => import('./plugin.tsx'),
} satisfies Command;

export default plugin;

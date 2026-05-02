export type {
  BgEngine,
  BgStartOptions,
  BgStartResult,
  SessionEntry,
} from "../engine.ts"

export async function selectEngine(): Promise<import('../engine.ts').BgEngine> {
  if (process.platform === 'win32') {
    const { DetachedEngine } = await import('./detached.ts')
    return new DetachedEngine()
  }

  const { TmuxEngine } = await import('./tmux.ts')
  const tmux = new TmuxEngine()
  if (await tmux.available()) {
    return tmux
  }

  const { DetachedEngine } = await import('./detached.ts')
  return new DetachedEngine()
}

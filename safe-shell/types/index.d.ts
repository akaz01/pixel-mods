export type Level = 'caution' | 'danger' | 'forbidden'

export type Counts = Record<Level, number>

declare module 'claude-code' {
  interface PluginState {
    'safe-shell': {
      allowOnce: boolean
      counts: Counts
    }
  }
}

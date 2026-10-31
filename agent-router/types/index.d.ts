export type Tier = 'haiku' | 'sonnet' | 'opus'

export type Level = 1 | 2 | 3

export type Source = 'explicit' | 'rule' | 'level' | 'none' | 'blocked'

export type Decision = {
  at: number
  type: string
  task: string
  why: string
  source: Source
  level?: Level
  tier?: Tier
  model?: string
  agentId?: string
  background: boolean
}

export type Hint = { at: number; tier: Tier; why: string; isFollowed: boolean }

export type Switches = { isRouting: boolean; isLevel: boolean; isHints: boolean }

export type Limits = { concurrent: number; background: number }

declare module 'claude-code' {
  interface PluginState {
    'agent-router': {
      decisions: Decision[]
      hints: Hint[]
      switches: Switches
      limits: Limits
    }
  }
}

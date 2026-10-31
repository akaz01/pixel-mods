export type AgentRow = {
  id: string
  type: string
  model?: string
  status: string
  tools: number
  lastAt: number
}

export type UsageRow = { name: string; count: number; lastAt: number }

export type MainRow = { status: 'idle' | 'working'; model?: string; tool?: string }

// A tool call of the main thread; `id` is its tool_use id. Full commands stay in the module's private memory, not here.
export type Step = { id: string; tool: string; target: string; at: number; status: 'running' | 'done' | 'blocked' | 'error' }

export type FileRow = { path: string; name: string; edits: number; reads: number; isNew: boolean; lastAt: number }

// One main-thread turn; `id` is the engine's turnId.
export type Turn = {
  id: string
  at: number
  prompt: string
  model?: string
  ms?: number
  tools: string[]
  steps: Step[]
  blocked: number
  status: 'running' | 'done' | 'error' | 'aborted'
}

export type Window = { pct: number; resetsAt?: string }

export type DayPct = { day: string; pct: number }

export type UsageInfo = {
  five?: Window
  weekly?: Window
  context?: number
  startFive?: number
  startWeekly?: number
  fiveRatePerMin?: number
  history: DayPct[]
}

export type PlanInfo = { name: string; tier?: string }

export type RamInfo = { usedBytes: number; totalBytes: number }

declare module 'claude-code' {
  interface PluginState {
    'work-board': {
      isOpen: boolean
      tab: number
      show5h: boolean
      plan: PlanInfo | null
      ram: RamInfo | null
      startedAt: number
      main: MainRow
      agents: AgentRow[]
      activeSkill: string | null
      skills: UsageRow[]
      plugins: UsageRow[]
      // Tagged, so a reload whose code reads them differently starts them fresh instead of drawing an old shape.
      turns: Shaped<Turn[]>
      usage: Shaped<UsageInfo>
      files: FileRow[]
      // The row unfolded in the timeline: `step:<tool_use id>` or `turn:<turnId>`.
      openRow: string | null
    }
  }
}

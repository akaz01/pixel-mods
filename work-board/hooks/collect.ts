import type { DayPct, FileRow, UsageRow, Window } from '../types'

export const MAX_ROWS = 30

export const short = (text: string, room = 40): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > room ? `${flat.slice(0, Math.max(1, room - 1))}…` : flat
}

export const bump = (rows: readonly UsageRow[], name: string, at: number): UsageRow[] => {
  const found = rows.some(row => row.name === name)
  const next = found ? rows.map(row => (row.name === name ? { ...row, count: row.count + 1, lastAt: at } : row)) : [...rows, { name, count: 1, lastAt: at }]
  return next.slice(-MAX_ROWS)
}

// "superpowers:brainstorming" → superpowers; a bare name is the user's own or built in.
export const pluginOfSkill = (skill: string): string => (skill.includes(':') ? (skill.split(':')[0] ?? skill) : 'built-in')

// mcp__plugin_context7_context7__query-docs → context7; mcp__claude_ai_Gmail__x → claude_ai_Gmail
export const pluginOfTool = (tool: string): string | undefined => {
  if (!tool.startsWith('mcp__')) return undefined
  const server = tool.slice(5).split('__')[0] ?? ''
  return server.startsWith('plugin_') ? (server.slice(7).split('_')[0] ?? server) : server
}

export const tierOf = (model: string | undefined): string | undefined =>
  model ? ['opus', 'sonnet', 'haiku'].find(tier => model.toLowerCase().includes(tier)) ?? model.replace(/^claude-/, '') : undefined

export const bar = (pct: number, cells: number): { on: string; off: string } => {
  const filled = Math.max(0, Math.min(cells, Math.round((pct * cells) / 100)))
  return { on: '█'.repeat(filled), off: '█'.repeat(cells - filled) }
}

export const duration = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`
}

export const untilText = (resetsAt: string | undefined, now: number): string | undefined => {
  if (!resetsAt) return undefined
  const at = Date.parse(resetsAt)
  return Number.isNaN(at) ? undefined : `${duration(at - now)} left`
}

// Time to a limit's refill in a fixed shape: '1H 05M' under a day, '3D 04H' from a day on.
export const refillText = (resetsAt: string | undefined, now: number): string | undefined => {
  if (!resetsAt) return undefined
  const at = Date.parse(resetsAt)
  if (Number.isNaN(at)) return undefined
  const minutes = Math.max(0, Math.floor((at - now) / 60_000))
  const two = (n: number) => String(n).padStart(2, '0')
  return minutes < 24 * 60
    ? `${Math.floor(minutes / 60)}H ${two(minutes % 60)}M`
    : `${Math.floor(minutes / (24 * 60))}D ${two(Math.floor(minutes / 60) % 24)}H`
}

export const clock = (at: number): string => {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

export const readWindows = (limits: readonly RateLimit[]): { five?: Window; weekly?: Window } => {
  const pick = (kind: string): Window | undefined => {
    const found = limits.find(l => l.kind === kind)
    return found ? { pct: found.percentUsed, resetsAt: found.resetsAt } : undefined
  }
  return { five: pick('five_hour'), weekly: pick('seven_day') }
}

const dayKey = (at: number): string => {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Keeps the highest weekly % seen each day, the last 7 days.
export const recordDay = (history: readonly DayPct[], at: number, pct: number): DayPct[] => {
  const day = dayKey(at)
  const rest = history.filter(h => h.day !== day)
  const today = Math.max(pct, history.find(h => h.day === day)?.pct ?? 0)
  return [...rest, { day, pct: today }].sort((a, b) => a.day.localeCompare(b.day)).slice(-7)
}

// Minutes until a window reaches 100% at the given rate; undefined when not rising.
export const minutesToFull = (pct: number, ratePerMin: number | undefined): number | undefined =>
  ratePerMin && ratePerMin > 0 && pct < 100 ? Math.round((100 - pct) / ratePerMin) : undefined

// Reads the plan from the account block of ~/.claude.json (never the credentials file).
// Accounts differ in what they carry: a display name, an organization type (claude_pro, claude_max, claude_team,
// claude_enterprise), rate-limit tiers on the user or the organization, a seat tier. Any one of them names the plan.
export const planOf = (account: unknown): { name: string; tier?: string } | undefined => {
  if (!account || typeof account !== 'object') return undefined
  const a = account as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  const rawTiers = [a.userRateLimitTier, a.organizationRateLimitTier].map(text).filter((t): t is string => !!t)
  const max = rawTiers.map(t => /max_(\d+)x/i.exec(t)).find(Boolean)
  const orgType = text(a.organizationType)?.replace(/^claude_/i, '').replace(/_/g, ' ')
  const tier = max ? `max ${max[1]}x` : text(a.seatTier) ?? (rawTiers.some(t => /pro/i.test(t)) ? 'pro' : undefined)
  const name = text(a.planDisplayName) ?? orgType ?? tier
  return name ? { name, tier: tier && tier !== name ? tier : undefined } : undefined
}

// What a step acted on, in a few characters: a file name, the start of a command, a pattern.
export const stepTarget = (tool: string, input: Record<string, unknown>): string => {
  const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')
  if (FILE_TOOLS[tool]) return baseName(text('file_path') || text('notebook_path'))
  if (tool === 'Bash' || tool === 'PowerShell') return short(text('command').split(/\s+/).slice(0, 3).join(' '), 24)
  if (tool === 'Grep' || tool === 'Glob') return text('pattern') ? short(`"${text('pattern')}"`, 24) : ''
  if (tool === 'Agent' || tool === 'Task') return text('subagent_type')
  if (tool === 'Skill') return text('skill').split(':').pop() ?? ''
  return ''
}

export const FILE_TOOLS: Record<string, 'read' | 'edit' | 'write'> = { Read: 'read', Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit', Write: 'write' }

export const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path

const MAX_FILES = 24

// A Write to a file not seen before counts as created.
export const touchFile = (rows: readonly FileRow[], path: string, kind: 'read' | 'edit' | 'write', now: number): FileRow[] => {
  const key = path.replace(/\\/g, '/').toLowerCase()
  const old = rows.find(r => r.path === key)
  const next: FileRow = {
    path: key,
    name: baseName(path),
    edits: (old?.edits ?? 0) + (kind === 'read' ? 0 : 1),
    reads: (old?.reads ?? 0) + (kind === 'read' ? 1 : 0),
    isNew: old ? old.isNew : kind === 'write',
    lastAt: now,
  }
  return [...rows.filter(r => r.path !== key), next].slice(-MAX_FILES)
}

const MAX_DETAIL = 600

// Masks what looks like a secret: bearer tokens, sk-/ghp_-style keys and KEY=/TOKEN=/PASSWORD= values.
export const redact = (text: string): string =>
  text
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1•••')
    .replace(/\b(?:sk|pk|rk|ghp|gho|ghs|xox[abp])[-_][A-Za-z0-9_-]{8,}/g, '•••')
    .replace(/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Z0-9_]*\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1•••')

// The whole of what a step was asked to do, for the expanded row: a full path, command or pattern, secrets masked.
export const stepDetail = (tool: string, input: Record<string, unknown>): string => {
  const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')
  const parts = FILE_TOOLS[tool] ? [text('file_path') || text('notebook_path')]
    : tool === 'Bash' || tool === 'PowerShell' ? [text('command'), text('description') && `# ${text('description')}`]
      : tool === 'Grep' || tool === 'Glob' ? [text('pattern'), text('path') && `in ${text('path')}`, text('glob') && `glob ${text('glob')}`]
        : tool === 'Agent' || tool === 'Task' ? [text('subagent_type'), text('description'), text('prompt')]
          : tool === 'Skill' ? [text('skill'), text('args')]
            // Other tools (MCP among them): argument names only, never their values.
            : [`ARGS: ${Object.keys(input).filter(k => !['tool', 'tool_use_id', 'agentId', 'consent', 'requestMeta'].includes(k)).join(', ') || 'none'}`]
  const joined = redact(parts.filter(Boolean).join('\n'))
  return joined.length > MAX_DETAIL ? `${joined.slice(0, MAX_DETAIL)}…` : joined
}

// Memory in use as bytes, read from each platform's own report; undefined when the text is not what was expected.
export type Ram = { usedBytes: number; totalBytes: number }

// PowerShell's "<TotalVisibleMemorySize> <FreePhysicalMemory>", both in KB.
export const parseWinMemory = (stdout: string): Ram | undefined => {
  const [total, free] = stdout.trim().split(/\s+/).map(Number)
  if (!total || free === undefined || Number.isNaN(free)) return undefined
  return { usedBytes: (total - free) * 1024, totalBytes: total * 1024 }
}

// macOS: `sysctl -n hw.memsize` gives the total; vm_stat's free, inactive and speculative pages are the room left.
export const parseVmStat = (vmStat: string, memSize: string): Ram | undefined => {
  const total = Number(memSize.trim())
  const pageSize = Number(/page size of (\d+) bytes/.exec(vmStat)?.[1] ?? 4096)
  const pages = (name: string) => Number(new RegExp(String.raw`Pages ${name}:\s+(\d+)`).exec(vmStat)?.[1] ?? 0)
  if (!total) return undefined
  const free = (pages('free') + pages('inactive') + pages('speculative')) * pageSize
  return { usedBytes: Math.max(0, total - free), totalBytes: total }
}

// Linux: /proc/meminfo's MemTotal and MemAvailable, in kB.
export const parseMeminfo = (text: string): Ram | undefined => {
  const kb = (name: string) => Number(new RegExp(String.raw`^${name}:\s+(\d+)`, 'm').exec(text)?.[1] ?? 0)
  const total = kb('MemTotal')
  if (!total) return undefined
  return { usedBytes: (total - kb('MemAvailable')) * 1024, totalBytes: total * 1024 }
}

// A finished agent stays in the party as DONE for 10 s, then leaves it.
export const DONE_LINGER_MS = 10_000
export const isGoneFromParty = (row: { doneAt?: number }, now: number): boolean => row.doneAt !== undefined && now - row.doneAt >= DONE_LINGER_MS

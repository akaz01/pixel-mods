import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { bump, FILE_TOOLS, isGoneFromParty, MAX_ROWS, parseMeminfo, parseVmStat, parseWinMemory, planOf, pluginOfSkill, pluginOfTool, readWindows, recordDay, redact, short, stepDetail, stepTarget, touchFile } from './collect'
import type { Ram, RateLimit } from './collect'
import { HELP_TAB, renderBoard } from './view'
import type { BoardData } from './view'
import type { AgentRow, DayPct, FileRow, MainRow, PlanInfo, Step, Turn, UsageInfo, UsageRow } from '../types'

const PANE = 'work-board'
const TITLE = 'Work Board'
const PANE_COLUMNS = 68
const AGENT_POLL_MS = 3000
const USAGE_POLL_MS = 60_000
// Memory is read by running a small command, so only every 20 s and only while the board is open.
const RAM_POLL_MS = 20_000
const RAM_TIMEOUT_MS = 5000
const RATE_WINDOW_MS = 30 * 60_000
const REOPEN_DELAY_MS = 400
const COMPACT_DELAY_MS = 500
const MAX_STEPS = 12
const MAX_PROMPT = 2000
const MAX_DETAILS = 200
// Bump when Turn or UsageInfo change shape: a reload then starts them fresh instead of drawing the old shape.
const SHAPE = 'v2'

const isOpen = atom({ plugin: 'work-board', key: 'isOpen' } as const, false)
const tab = atom({ plugin: 'work-board', key: 'tab' } as const, 1)
const show5h = atom({ plugin: 'work-board', key: 'show5h' } as const, true)
const plan = atom({ plugin: 'work-board', key: 'plan' } as const, null as PlanInfo | null)
const ram = atom({ plugin: 'work-board', key: 'ram' } as const, null as Ram | null)
const startedAt = atom({ plugin: 'work-board', key: 'startedAt' } as const, 0)
const main = atom({ plugin: 'work-board', key: 'main' } as const, { status: 'idle' } as MainRow)
const agents = atom({ plugin: 'work-board', key: 'agents' } as const, [] as AgentRow[])
const activeSkill = atom({ plugin: 'work-board', key: 'activeSkill' } as const, null as string | null)
const skills = atom({ plugin: 'work-board', key: 'skills' } as const, [] as UsageRow[])
const plugins = atom({ plugin: 'work-board', key: 'plugins' } as const, [] as UsageRow[])
const turns = atom({ plugin: 'work-board', key: 'turns' } as const, [] as Turn[], { shape: SHAPE })
const usage = atom({ plugin: 'work-board', key: 'usage' } as const, { history: [] } as UsageInfo, { shape: SHAPE })
const files = atom({ plugin: 'work-board', key: 'files' } as const, [] as FileRow[])
const openRow = atom({ plugin: 'work-board', key: 'openRow' } as const, null as string | null)

// Module memory, private to this plugin (other plugins can read $.state, not this):
// five-hour samples for the pace estimate, the turn now running, the full text behind each row,
// and a compact the user asked for mid-turn. A reload simply starts these over.
let samples: { at: number; pct: number }[] = []
let liveTurnId: string | undefined
const details = new Map<string, string>()
let isCompactQueued = false

const remember = (key: string, text: string) => {
  details.set(key, text)
  if (details.size > MAX_DETAILS) details.delete(details.keys().next().value ?? key)
}

const quietly = async ($: EngineInterface, what: string, work: () => Promise<unknown>): Promise<void> => {
  try {
    await work()
  } catch (error) {
    $.ui.log(`work-board: ${what} failed (${String(error)})`)
  }
}

const isDayPct = (value: unknown): value is DayPct =>
  !!value && typeof (value as DayPct).day === 'string' && typeof (value as DayPct).pct === 'number'

const applyUsage = async ($: EngineInterface, limits: readonly RateLimit[], context: number | undefined) => {
  const now = Date.now()
  const { five, weekly } = readWindows(limits)
  if (five) samples = [...samples.filter(s => now - s.at < RATE_WINDOW_MS), { at: now, pct: five.pct }]
  const first = samples[0]
  const span = first ? (now - first.at) / 60_000 : 0
  const rate = first && five && span >= 5 ? (five.pct - first.pct) / span : undefined
  const before = (await read($, usage)).history
  const history = weekly ? recordDay(before, now, weekly.pct) : before
  // Written to disk only when today's figure moved.
  if (JSON.stringify(history) !== JSON.stringify(before)) await $.store.set('history', history)
  await update($, usage, u => ({
    ...u, five, weekly, context: context ?? u.context, history, fiveRatePerMin: rate,
    // A new five-hour window restarts the session's starting point.
    startFive: u.five?.resetsAt !== five?.resetsAt ? five?.pct : u.startFive ?? five?.pct,
    startWeekly: u.startWeekly ?? weekly?.pct,
  }))
}

const refreshUsage = async ($: EngineInterface) => {
  const now = await $.session.usage()
  await applyUsage($, now.rateLimits, now.context.percent)
}

const LIVE = new Set(['pending', 'running', 'waiting'])

// Polled only while the board is open; a spawn updates the list even when it is closed.
const refreshAgents = async ($: EngineInterface) => {
  if (!(await read($, isOpen))) return
  const listed = await $.agent.list()
  const rows = await read($, agents)
  const known = new Map(rows.map(r => [r.id, r]))
  const now = Date.now()
  // A row that stopped running keeps the time it stopped, so the party can drop it a few seconds later.
  const stamped = (row: AgentRow): AgentRow => (LIVE.has(row.status) ? row : { ...row, doneAt: row.doneAt ?? now })
  const fresh = listed.map(info => {
    const old = known.get(info.id)
    return stamped({ id: info.id, type: info.type, model: old?.model, status: info.status, tools: old?.tools ?? 0, lastAt: old?.lastAt ?? now, doneAt: old?.doneAt })
  })
  // An agent the engine no longer lists has finished, whatever it last reported.
  const gone = rows.filter(r => !listed.some(info => info.id === r.id)).map(r => stamped(LIVE.has(r.status) ? { ...r, status: 'completed' } : r))
  const next = [...gone, ...fresh].filter(r => !isGoneFromParty(r, now)).slice(-MAX_ROWS)
  if (JSON.stringify(next) !== JSON.stringify(rows)) await update($, agents, () => next)
}

// Each platform's own report: PowerShell on Windows, sysctl and vm_stat on macOS, /proc/meminfo on Linux.
const readMemory = async ($: EngineInterface): Promise<Ram | undefined> => {
  if ((await $.env.get('OS')) === 'Windows_NT') {
    const { stdout } = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command',
      '$o = Get-CimInstance Win32_OperatingSystem; "$($o.TotalVisibleMemorySize) $($o.FreePhysicalMemory)"'], { timeoutMs: RAM_TIMEOUT_MS })
    return parseWinMemory(stdout)
  }
  if (await $.fs.exists('/proc/meminfo')) return parseMeminfo(await $.fs.read('/proc/meminfo'))
  const [vm, size] = await Promise.all([
    $.process.run(['vm_stat'], { timeoutMs: RAM_TIMEOUT_MS }),
    $.process.run(['sysctl', '-n', 'hw.memsize'], { timeoutMs: RAM_TIMEOUT_MS }),
  ])
  return parseVmStat(vm.stdout, size.stdout)
}

const refreshRam = async ($: EngineInterface) => {
  if (!(await read($, isOpen))) return
  const found = await readMemory($)
  if (found) await update($, ram, () => found)
}

const readPlan = async ($: EngineInterface) => {
  const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
  if (!home) return
  const text = await $.fs.read(`${home}/.claude.json`)
  const found = planOf((JSON.parse(String(text)) as { oauthAccount?: unknown }).oauthAccount)
  await update($, plan, () => found ?? null)
}

const openBoard = async ($: EngineInterface) => {
  await update($, isOpen, () => true)
  await $.store.set('autoOpen', true)
  void quietly($, 'memory read', () => refreshRam($))
  return $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
}

const closeBoard = async ($: EngineInterface) => {
  await update($, isOpen, () => false)
  await $.store.set('autoOpen', false)
  await $.ui.close({ id: PANE })
}

const runBoard = async ($: EngineInterface, args: string): Promise<string> => {
  const [first, second] = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!first) {
    if (await read($, isOpen)) {
      await closeBoard($)
      return 'Work Board closed.'
    }
    const opened = await openBoard($)
    return opened.isPlaced ? 'Work Board opened. Ctrl+X Tab focuses it, Esc returns to the terminal.' : 'Work Board opened. Widen the terminal to see it.'
  }
  if (first === 'close') {
    await closeBoard($)
    return 'Work Board closed.'
  }
  if (first === 'help') {
    await update($, tab, () => HELP_TAB)
    await openBoard($)
    return 'Work Board: command guide opened (? tab).'
  }
  if (first === '5h' && (second === 'on' || second === 'off')) {
    await update($, show5h, () => second === 'on')
    await $.store.set('show5h', second === 'on')
    return second === 'on' ? '5h window shown.' : '5h window hidden.'
  }
  if (first === 'clear') {
    await update($, turns, () => [])
    await update($, files, () => [])
    details.clear()
    return 'Timeline and files cleared.'
  }
  return 'Usage: /board [close|help|clear] | /board 5h on|off'
}

// A failing command answers with what went wrong instead of failing the run.
const boardCommand = async ($: EngineInterface, args: string) => {
  try {
    return { text: await runBoard($, args) }
  } catch (error) {
    return { text: `work-board: ${String(error)}` }
  }
}

// Compact runs only between turns. The engine is asked straight away; while a turn is still
// winding down it says so, and the board tries again a few times, then waits for the turn to end.
const COMPACT_RETRY_MS = 1000
const COMPACT_TRIES = 6

const isTurnBusy = (error: unknown) => /in flight|while a turn/i.test(String(error))

const compactNow = async ($: EngineInterface, tries = COMPACT_TRIES): Promise<void> => {
  try {
    if (tries === COMPACT_TRIES) $.ui.toast('Compacting the conversation…')
    const { skip } = await $.session.compact({})
    isCompactQueued = false
    if (skip) $.ui.toast(`Compact skipped: ${skip}`)
  } catch (error) {
    if (!isTurnBusy(error)) throw error
    if (tries > 1 && (await read($, main)).status !== 'working') {
      $.clock.after(COMPACT_RETRY_MS, () => void quietly($, 'compact', () => compactNow($, tries - 1)))
      return
    }
    if (!isCompactQueued) $.ui.toast('Compact queued: it runs when this turn ends.')
    isCompactQueued = true
  }
}

const gather = async ($: EngineInterface, columns: number, rows?: number): Promise<BoardData> => {
  const peek = async <T,>(get: () => Promise<{ value?: T }>): Promise<T | undefined> => {
    try {
      return (await get()).value
    } catch {
      return undefined
    }
  }
  const [decisions, limits, hints, switches, me, peers, threads, notices, counts] = await Promise.all([
    peek(() => $.state.get({ plugin: 'agent-router', key: 'decisions' } as const)),
    peek(() => $.state.get({ plugin: 'agent-router', key: 'limits' } as const)),
    peek(() => $.state.get({ plugin: 'agent-router', key: 'hints' } as const)),
    peek(() => $.state.get({ plugin: 'agent-router', key: 'switches' } as const)),
    peek(() => $.state.get({ plugin: 'collab-hub', key: 'me' } as const)),
    peek(() => $.state.get({ plugin: 'collab-hub', key: 'peers' } as const)),
    peek(() => $.state.get({ plugin: 'collab-hub', key: 'threads' } as const)),
    peek(() => $.state.get({ plugin: 'collab-hub', key: 'notices' } as const)),
    peek(() => $.state.get({ plugin: 'safe-shell', key: 'counts' } as const)),
  ])
  const [tabNow, show5hNow, startedNow, mainNow, agentsNow, skillNow, skillsNow, pluginsNow, turnsNow, usageNow, filesNow, openNow, planNow, ramNow, cwdNow] = await Promise.all([
    read($, tab), read($, show5h), read($, startedAt), read($, main), read($, agents), read($, activeSkill), read($, skills),
    read($, plugins), read($, turns), read($, usage), read($, files), read($, openRow), read($, plan), read($, ram),
    $.session.cwd().catch(() => ''),
  ])
  return {
    now: Date.now(), columns, rows,
    tab: tabNow, show5h: show5hNow, startedAt: startedNow, main: mainNow, agents: agentsNow, activeSkill: skillNow,
    skills: skillsNow, plugins: pluginsNow, turns: turnsNow, usage: usageNow, files: filesNow, openRow: openNow ?? undefined,
    blocked: (counts?.danger ?? 0) + (counts?.forbidden ?? 0),
    plan: planNow ?? undefined,
    project: cwdNow.replace(/\\/g, '/').split('/').filter(Boolean).pop(),
    ram: ramNow ?? undefined,
    router: decisions || limits ? { decisions, limits, hints, switches } : undefined,
    hub: me !== undefined || peers ? { me, peers, threads, notices } : undefined,
    detailOf: key => details.get(key),
    onTab: n => void quietly($, 'tab', () => update($, tab, () => n)),
    onRow: key => void quietly($, 'unfold', () => update($, openRow, open => (open === key ? null : key))),
    onCompact: () => void quietly($, 'compact', () => compactNow($)),
  }
}

// Each subcommand also gets its own menu entry, so picking it from the typeahead runs it directly.
const SHORTCUTS: readonly (readonly [string, string, string])[] = [
  ['board-clear', 'clear', 'Work Board: clear the timeline and files'],
  ['board-5h-on', '5h on', 'Work Board: show the 5h window'],
  ['board-5h-off', '5h off', 'Work Board: hide the 5h window'],
]

const withStep = (t: Turn, step: Step): Turn => ({
  ...t,
  tools: t.tools.at(-1) !== step.tool ? [...t.tools, step.tool].slice(-6) : t.tools,
  steps: [...t.steps, step].slice(-MAX_STEPS),
})

const settleStep = (t: Turn, id: string, status: Step['status']): Turn => ({
  ...t,
  blocked: status === 'blocked' ? t.blocked + 1 : t.blocked,
  steps: t.steps.map(s => (s.id === id && s.status === 'running' ? { ...s, status } : s)),
})

const endStatus = (reason: string): Turn['status'] => (reason === 'aborted' ? 'aborted' : reason === 'error' || reason === 'refusal' ? 'error' : 'done')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // When the session itself began, not when this module was last (re)loaded.
    const began = await $.session.usage().then(u => u.startedAt, () => Date.now())
    await update($, startedAt, () => began)
    await $.command.register({ name: 'board', description: 'Work Board: open or close it, clear its lists, show or hide the 5h window', argumentHint: '[close|help|clear] | 5h on|off' })
    for (const [name, , description] of SHORTCUTS) await $.command.register({ name, description })
    const [saved5h, autoOpen, history] = await Promise.all([$.store.get('show5h'), $.store.get('autoOpen'), $.store.get('history')])
    await quietly($, 'plan read', () => readPlan($))
    if (typeof saved5h === 'boolean') await update($, show5h, () => saved5h)
    if (Array.isArray(history)) await update($, usage, u => ({ ...u, history: history.filter(isDayPct) }))
    await quietly($, 'usage read', () => refreshUsage($))
    $.clock.every(AGENT_POLL_MS, () => void quietly($, 'agent list', () => refreshAgents($)))
    $.clock.every(USAGE_POLL_MS, () => void quietly($, 'usage read', () => refreshUsage($)))
    $.clock.every(RAM_POLL_MS, () => void quietly($, 'memory read', () => refreshRam($)))
    const started = await next(e)
    // Also after a hot reload, which closes the pane: reopen shortly once the session is drawn.
    // Open on every session start unless the person closed it last time with /board close; a new machine opens it too.
    if (autoOpen !== false && e.isInteractive !== false) {
      $.clock.after(REOPEN_DELAY_MS, () => void quietly($, 'reopen', () => openBoard($)))
    }
    return started
  })

  on('session.measure', async ($, e, next) => {
    await quietly($, 'usage update', () => applyUsage($, e.rateLimits, e.context.percent))
    return next(e)
  })

  on('command.run', { command: 'board' }, async ($, e) => boardCommand($, e.args)).catch(() => ({ text: 'work-board: the command failed.' }))
  for (const [name, args] of SHORTCUTS) on('command.run', { command: name }, async $ => boardCommand($, args)).catch(() => ({ text: 'work-board: the command failed.' }))

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await quietly($, 'close', () => update($, isOpen, () => false))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    const id = started.agentId
    if (started.deny === undefined && id) {
      await quietly($, 'agent', () => update($, agents, rows => [...rows.filter(r => r.id !== id), { id, type: e.subagentType, model: started.model, status: 'running', tools: 0, lastAt: Date.now() }].slice(-MAX_ROWS)))
    }
    return started
  }).catch(($, e, next) => next(e))

  on('skill.prompt', async ($, e, next) => {
    const now = Date.now()
    await quietly($, 'skill', async () => {
      await update($, activeSkill, () => e.skill)
      await update($, skills, rows => bump(rows, e.skill, now))
      await update($, plugins, rows => bump(rows, pluginOfSkill(e.skill), now))
    })
    return next(e)
  })

  // A turn is recorded when it starts, by the engine's turnId, so a prompt queued mid-turn never takes over the running one.
  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    const turnId = started.turnId
    const at = Date.now()
    liveTurnId = turnId
    remember(`turn:${turnId}`, redact(e.text.slice(0, MAX_PROMPT)))
    const prompt = e.text.trim() ? redact(short(e.text, 48)) : '(continued)'
    await quietly($, 'turn', () => update($, turns, list => [...list.filter(t => t.id !== turnId), { id: turnId, at, prompt, tools: [], steps: [], blocked: 0, status: 'running' as const }].slice(-MAX_ROWS)))
    return started
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const now = Date.now()
    const plugin = pluginOfTool(e.tool)
    const input = e as unknown as Record<string, unknown>
    const stepId = e.tool_use_id || `${now}-${Math.random().toString(36).slice(2, 8)}`
    const turnId = e.agentId ? undefined : liveTurnId
    await quietly($, 'tool', async () => {
      if (plugin) await update($, plugins, rows => bump(rows, plugin, now))
      if (e.agentId) {
        const id = e.agentId
        await update($, agents, rows => rows.map(r => (r.id === id ? { ...r, tools: r.tools + 1, lastAt: now } : r)))
        return
      }
      await update($, main, m => ({ ...m, tool: e.tool }))
      remember(`step:${stepId}`, stepDetail(e.tool, input))
      const step: Step = { id: stepId, tool: e.tool, target: redact(stepTarget(e.tool, input)), at: now, status: 'running' }
      if (turnId) await update($, turns, list => list.map(t => (t.id === turnId ? withStep(t, step) : t)))
    })
    const ran = await next(e)
    const status: Step['status'] = ran.deny !== undefined ? 'blocked' : ran.isError ? 'error' : 'done'
    await quietly($, 'tool end', async () => {
      // A file counts only once its tool actually ran.
      const kind = FILE_TOOLS[e.tool]
      const path = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : ''
      if (kind && path && status === 'done') await update($, files, rows => touchFile(rows, path, kind, now))
      if (turnId) await update($, turns, list => list.map(t => (t.id === turnId ? settleStep(t, stepId, status) : t)))
    })
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      await quietly($, 'main', async () => {
        await update($, main, m => ({ ...m, status: 'working' as const, model: e.model }))
        await update($, turns, list => list.map(t => (t.id === e.turnId && !t.model ? { ...t, model: e.model } : t)))
      })
    }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      const now = Date.now()
      if (liveTurnId === e.turnId) liveTurnId = undefined
      await quietly($, 'turn end', async () => {
        await update($, main, m => ({ ...m, status: 'idle' as const, tool: undefined }))
        await update($, activeSkill, () => null)
        await update($, turns, list => list.map(t => (t.id === e.turnId
          ? { ...t, ms: now - t.at, status: endStatus(e.reason), steps: t.steps.map(s => (s.status === 'running' ? { ...s, status: 'done' as const } : s)) }
          : t)))
      })
    }
    const done = await next(e)
    // A queued compact runs once, after a turn that ended on its own; Esc cancels it.
    if (!e.agentId && isCompactQueued) {
      isCompactQueued = false
      if (!e.isAborted) $.clock.after(COMPACT_DELAY_MS, () => void quietly($, 'compact', () => compactNow($)))
    }
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text>Work Board draws in the terminal.</Text>
    }
    const el = $.ui.resolve(e)
    return renderBoard(el, await gather($, e.props.bodyColumns, e.props.scroll.bodyRows))
  })
}

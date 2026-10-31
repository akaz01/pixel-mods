import type { Elements, PluginState, RenderChildren } from 'claude-code'

import { bar, clock, isGoneFromParty, duration, minutesToFull, refillText, short, tierOf, untilText } from './collect'
import type { Ram } from './collect'
import type { AgentRow, FileRow, MainRow, PlanInfo, Step, Turn, UsageInfo, UsageRow } from '../types'

// NOTE: never name anything `h` or `Fragment` in this file: JSX compiles to the global h().

type El = Elements['terminal']
type Router = PluginState['agent-router']
type Hub = PluginState['collab-hub']

export type BoardData = {
  now: number
  tab: number
  show5h: boolean
  columns: number
  rows?: number
  startedAt: number
  project?: string
  main: MainRow
  agents: AgentRow[]
  activeSkill: string | null
  skills: UsageRow[]
  plugins: UsageRow[]
  turns: Turn[]
  usage: UsageInfo
  files: FileRow[]
  blocked: number
  plan?: PlanInfo
  ram?: Ram
  router?: Partial<Router>
  hub?: Partial<Hub>
  onTab: (tab: number) => void
  // The unfolded timeline row (`step:<id>` or `turn:<id>`) and the full text behind a row.
  openRow?: string
  detailOf: (key: string) => string | undefined
  onRow: (key: string) => void
  onCompact: () => void
}

// Context percent at which the board offers a one-press compact, and where it turns red.
const CTX_WARN = 70
const CTX_DANGER = 85
// A peer whose heartbeat is older than this counts as gone.
const PEER_LIVE_MS = 5 * 60_000

// 8-bit palette from the pixel mockup.
const P = {
  white: '#fcfcfc', dim: '#9c9c9c', yellow: '#f8b800', green: '#58d854', red: '#f83800',
  cyan: '#3cbcfc', purple: '#b8b8f8', orange: '#fca044', black: '#000000', soft: '#bcbcbc',
  clay: '#d97757', empty: '#3a3a3a', term: '#0c0c0c',
}
const MODEL: Record<string, string> = { opus: P.purple, sonnet: P.yellow, haiku: P.cyan }
const LEVEL: Record<number, string> = { 1: P.cyan, 2: P.yellow, 3: P.red }
const TABS = ['RUNNING', 'ROUTING', 'COLLAB', 'TIMELINE', 'USAGE'] as const
export const HELP_TAB = 6
const LIVE = new Set(['pending', 'running', 'waiting'])

const up = (text: string) => text.toUpperCase()

const model = (el: El, id: string | undefined) => {
  const tier = tierOf(id)
  return <el.Text color={tier ? (MODEL[tier] ?? P.white) : P.dim}>[{up(tier ?? '—')}]</el.Text>
}

const row = (el: El, left: RenderChildren, right: RenderChildren) => (
  <el.Box width="100%" justifyContent="space-between"><el.Box flexShrink={1}>{left}</el.Box><el.Box flexShrink={0} paddingLeft={1}>{right}</el.Box></el.Box>
)

// An RPG window: white double border, the title as its first line.
const win = (el: El, title: string, note: RenderChildren | null, body: RenderChildren[], color: string = P.white, isGrow = false) => (
  <el.Box flexDirection="column" borderStyle="double" borderColor={color} paddingX={1} flexGrow={isGrow ? 1 : 0}>
    {row(el, <el.Text bold color={color}>{title}</el.Text>, note === null ? <el.Text> </el.Text> : <el.Text color={P.soft}>{note}</el.Text>)}
    {body.length ? body : [<el.Text color={P.dim}>NONE YET</el.Text>]}
  </el.Box>
)

const caption = (el: El, text: string) => <el.Text color={P.dim}>- - {text} - -</el.Text>

// A 3/4-height cell leaves a sliver above each gauge, so stacked gauges read as separate bars.
const CELL = '▆'

// Every STATUS gauge runs green → yellow → red as it gets worse; each has its own two steps (percent used).
type Steps = readonly [yellow: number, red: number]
const CTX_STEPS: Steps = [50, CTX_DANGER]
const LIMIT_STEPS: Steps = [50, 80]
const RAM_STEPS: Steps = [60, 85]
const hpColor = (pct: number, steps: Steps = CTX_STEPS) => (pct >= steps[1] ? P.red : pct >= steps[0] ? P.yellow : P.green)

const hp = (el: El, pct: number, cells: number, steps: Steps = CTX_STEPS) => {
  const b = bar(pct, cells)
  return <el.Text><el.Text color={hpColor(pct, steps)}>{CELL.repeat(b.on.length)}</el.Text><el.Text color={P.empty}>{CELL.repeat(b.off.length)}</el.Text></el.Text>
}

// Rate limits are shown as what remains, not what was used: a full bar means plenty left.
const leftOf = (usedPct: number) => Math.max(0, Math.round(100 - usedPct))
const mp = (el: El, usedPct: number, cells: number) => {
  const b = bar(100 - usedPct, cells)
  return <el.Text><el.Text color={hpColor(usedPct, LIMIT_STEPS)}>{CELL.repeat(b.on.length)}</el.Text><el.Text color={P.empty}>{CELL.repeat(b.off.length)}</el.Text></el.Text>
}
const leftText = (el: El, usedPct: number) => <el.Text><el.Text color={hpColor(usedPct, LIMIT_STEPS)}>{leftOf(usedPct)}%</el.Text> LEFT</el.Text>

const slots = (el: El, used: number, total: number, color: string) => (
  <el.Text><el.Text color={color}>{'■'.repeat(Math.min(used, total))}</el.Text><el.Text color={P.dim}>{'□'.repeat(Math.max(0, total - used))}</el.Text></el.Text>
)

// Shown under the context gauge once it runs high: one press compacts the conversation.
// The whole row is one hover scope, so the pointer anywhere on it lights the button white.
const COMPACT_HOVER = { color: P.black, backgroundColor: P.white, bold: true } as const

const compactRow = (el: El, d: BoardData, ctx: number) => {
  const color = ctx >= CTX_DANGER ? P.red : P.yellow
  return (
    <el.Box key="compact-row" width="100%" hover={{ backgroundColor: P.empty }}>
      {row(el,
        <el.Text color={color} wrap="truncate-end" hover={{ bold: true }}>⚠ {ctx >= CTX_DANGER ? 'CONTEXT CRITICAL' : 'CONTEXT HIGH'}</el.Text>,
        <el.Button key="compact" plain onPress={d.onCompact} hover={COMPACT_HOVER}>
          <el.Text color={P.black} backgroundColor={color} hover={COMPACT_HOVER}>{d.main.status === 'working' ? ' COMPACT AFTER TURN ' : ' ▶ COMPACT NOW '}</el.Text>
        </el.Button>)}
    </el.Box>
  )
}

const GB = 1024 ** 3
// The STATUS rows end in a percent and a word or two after it; a fixed width for both keeps the percents in one column.
const STATUS_TAIL = 8

// This computer's memory in use, read every few seconds while the board is open.
const ramRow = (el: El, ram: Ram, cells: number) => {
  const pct = Math.round((ram.usedBytes / ram.totalBytes) * 100)
  const gb = (bytes: number) => (bytes / GB).toFixed(bytes / GB < 10 ? 1 : 0)
  return row(el, <el.Text>{'RAM'.padEnd(8)}{hp(el, pct, cells, RAM_STEPS)}</el.Text>,
    <el.Text><el.Text color={hpColor(pct, RAM_STEPS)}>{`${pct}%`.padStart(4)}</el.Text> <el.Text color={P.dim}>{`${gb(ram.usedBytes)}/${gb(ram.totalBytes)}GB`.padEnd(STATUS_TAIL)}</el.Text></el.Text>)
}

const statusWin = (el: El, d: BoardData) => {
  const ctx = d.usage.context
  const cells = gaugeCells(d)
  const live = d.agents.filter(a => LIVE.has(a.status))
  const tiers = ['opus', 'sonnet', 'haiku'].filter(t => live.some(a => tierOf(a.model) === t))
  const peers = (d.hub?.peers ?? []).filter(p => !p.isEnded && d.now - p.beat < PEER_LIVE_MS).length
  const sep = <el.Text color={P.dim}> │ </el.Text>
  // RAM on top, context under it with its compact button, the party last. The limits sit by the hero.
  return win(el, 'STATUS', null, [
    ...(d.ram ? [ramRow(el, d.ram, cells)] : []),
    ...(ctx === undefined ? [] : [row(el, <el.Text>{'CONTEXT'.padEnd(8)}{hp(el, ctx, cells)}</el.Text>, <el.Text><el.Text color={hpColor(ctx)}>{`${Math.round(ctx)}%`.padStart(4)}</el.Text> {'USED'.padEnd(STATUS_TAIL)}</el.Text>)]),
    ...(ctx !== undefined && ctx >= CTX_WARN ? [compactRow(el, d, ctx)] : []),
    <el.Text color={P.dim} wrap="truncate-end">
      PARTY <el.Text color={P.white}>{live.length}</el.Text>{tiers.map(t => <el.Text color={MODEL[t] ?? P.white}> {up(t)}</el.Text>)}
      {d.hub ? <el.Text>{sep}SESSIONS <el.Text color={P.green}>{peers}</el.Text></el.Text> : null}
      {sep}BLOCKED <el.Text color={d.blocked ? P.red : P.white}>{d.blocked}</el.Text>
    </el.Text>,
  ], P.yellow)
}

// The plan's limits by the hero, aligned: what is left and the time to refill, the week first, then 5 hours.
// Only one-cell characters here: glyphs like ↻ or shaded bars draw at different widths in some fonts and break the line.
// The mod tells the plan by itself: a plan named Ultra, or one whose server reading has a weekly window and no
// 5-hour window, has no 5-hour limit. Such a plan shows no 5HR line; a bar of the week left takes its place.
export const hasFiveLimit = (planName: string | undefined, usage: { five?: unknown; weekly?: unknown }) =>
  !/ultra/i.test(planName ?? '') && !(usage.weekly && !usage.five)
// The week-left bar is the STATUS window's gauge, same glyph and same length, so the two read as one kind of bar.
const gaugeCells = (d: BoardData) => Math.max(6, Math.min(14, d.columns - 36))
const limitLines = (el: El, d: BoardData) => {
  const weekly = d.usage.weekly
  const five = d.usage.five
  const isFiveLimited = hasFiveLimit(d.plan?.name, d.usage)
  const noData = [<el.Text color={P.dim}>NO LIMIT DATA</el.Text>]
  if (!five && !weekly) return noData
  const line = (label: string, w: { pct: number; resetsAt?: string }) => {
    const refill = refillText(w.resetsAt, d.now)
    return (
      <el.Text color={P.dim} wrap="truncate-end">
        {label.padEnd(5)}<el.Text color={hpColor(w.pct, LIMIT_STEPS)}>{`${leftOf(w.pct)}%`.padStart(4)}</el.Text>{refill ? <el.Text color={P.cyan}>{`  ${refill}`}</el.Text> : ''}
      </el.Text>
    )
  }
  const lines = [
    ...(weekly ? [line('WEEK', weekly)] : []),
    ...(isFiveLimited && d.show5h && five ? [line('5HR', five)] : []),
    ...(weekly && !isFiveLimited ? [mp(el, weekly.pct, gaugeCells(d))] : []),
  ]
  // A 5-hour plan with its 5HR line hidden and no weekly reading has nothing to show.
  return lines.length ? lines : noData
}

// Lines of text beside the sprite: ANTHROPIC CLAUDE, the main model, the plan, then the limit lines.
const limitRows = (d: BoardData) => {
  if (!d.usage.five && !d.usage.weekly) return 1
  const isFiveLimited = hasFiveLimit(d.plan?.name, d.usage)
  return (d.usage.weekly ? 1 : 0) + (isFiveLimited ? (d.show5h && d.usage.five ? 1 : 0) : d.usage.weekly ? 1 : 0)
}
const heroTextRows = (d: BoardData) => 3 + Math.max(1, limitRows(d))
// The main model's name and version: claude-opus-5-5 reads OPUS 5.5, claude-sonnet-4-5-20250929 SONNET 4.5.
export const modelName = (model: string | undefined) => {
  if (!model) return '—'
  const parts = model.toLowerCase().replace(/\[.*\]$/, '').replace(/^claude-/, '').split('-')
  const tier = tierOf(model) ?? parts[0] ?? model
  const version = parts.filter(p => /^\d{1,2}$/.test(p)).join('.')
  return up(version ? `${tier} ${version}` : tier)
}

// Columns the text beside the sprite takes: its widest line, measured as the lines above are built.
const heroTextCols = (d: BoardData) => {
  const limitCols = (w: { resetsAt?: string } | undefined) => {
    if (!w) return 0
    const refill = refillText(w.resetsAt, d.now)
    return 5 + 4 + (refill ? 2 + refill.length : 0)
  }
  const hasLimits = d.usage.five || d.usage.weekly
  return Math.max(
    'ANTHROPIC CLAUDE'.length,
    6 + modelName(d.main.model).length,
    d.plan ? d.plan.name.length + 2 + (d.plan.tier ? d.plan.tier.length + 1 : 0) : 'PLAN NOT FOUND'.length,
    hasLimits
      ? Math.max(limitCols(d.usage.weekly), d.show5h ? limitCols(d.usage.five) : 0, hasFiveLimit(d.plan?.name, d.usage) ? 0 : gaugeCells(d))
      : 'NO LIMIT DATA'.length,
  )
}

// Pixel Claude in half blocks (two pixel rows per line): 10 cells by 4 lines.
const SPRITE = [' ▄██████▄ ', '██ ████ ██', '▀████████▀']
// The legs step on alternate seconds while the main thread works.
const LEGS = [' █ █  █ █ ', '█ █    █ █']

// A pixel speech bubble right of the sprite, level with its head, saying where the work is in one word: RUNNING,
// WRAPPING, DONE. Drawn like the sprite in half blocks: a filled body with its corners cut, the word in black on
// it, and a one-pixel tail on the left pointing back at the sprite.
//
//     ▄▄▄▄▄▄▄▄▄▄▄▄
//   ▄█  RUNNING  █
//     ▀▀▀▀▀▀▀▀▀▀▀▀
const BUBBLE_INNER = 12
// Deep inks for the word, so it reads strongly on the white bubble.
const INK = { work: '#a33f22', wrap: '#0038b0', done: '#14672a', stop: '#b02000' }
// Columns the row spends besides the text and the bubble: the pane's right padding, the text's left margin,
// the sprite with its left margin, and the bubble's margins.
const HERO_FIXED_COLS = 1 + 1 + 2 + 10 + 1 + 1
export const stateRoom = (columns: number, textCols: number) => columns - HERO_FIXED_COLS - textCols
// The bubble's parts for a word in the room it has: its body 12 wide when that fits, else as wide as the room
// allows, never narrower than the word with a space each side; one column less when that leaves the word's two
// sides unequal. Undefined when not even that fits.
export const bubbleParts = (word: string, room: number) => {
  const widest = Math.min(BUBBLE_INNER, room - 3)
  const inner = widest - ((widest - word.length) % 2)
  if (inner < word.length + 2) return undefined
  const pad = ' '.repeat((inner - word.length) / 2)
  return { top: `  ${'▄'.repeat(inner)}`, body: `${pad}${word}${pad}`, bottom: `  ${'▀'.repeat(inner)}`, width: inner + 3 }
}
const PHASES: Record<string, string> = {
  Read: 'READING', Grep: 'READING', Glob: 'READING', WebFetch: 'READING', WebSearch: 'READING',
  Edit: 'CODING', MultiEdit: 'CODING', Write: 'CODING', NotebookEdit: 'CODING',
  Bash: 'RUNNING', PowerShell: 'RUNNING', Agent: 'HELPERS', Task: 'HELPERS',
  TodoWrite: 'PLANNING', EnterPlanMode: 'PLANNING', ExitPlanMode: 'PLANNING',
}
// A command that tests, validates or type-checks reads as testing.
const CHECK_WORDS = /\b(test|validate|tsc|lint|check|verify)\b/i
// The phase of a working turn from its steps: nothing yet is thinking; every step done is wrapping up.
export const phaseOf = (steps: readonly Step[]) => {
  const running = [...steps].reverse().find(s => s.status === 'running')
  if (!running) return steps.length ? 'WRAPPING' : 'THINKING'
  if ((running.tool === 'Bash' || running.tool === 'PowerShell') && CHECK_WORDS.test(running.target)) return 'TESTING'
  return PHASES[running.tool] ?? 'WORKING'
}

// The bubble always says something while idle: HELLO before the first turn; for a minute after a turn how it
// ended; then READY; after half an hour with nothing to do, SLEEPING.
const DONE_SHOW_MS = 60_000
const SLEEP_AFTER_MS = 30 * 60_000
export const restWord = (last: Turn | undefined, now: number) => {
  if (!last) return 'HELLO!'
  const idle = now - (last.at + (last.ms ?? 0))
  if (idle >= SLEEP_AFTER_MS) return 'SLEEPING'
  if (idle >= DONE_SHOW_MS) return 'READY'
  return last.status === 'aborted' ? 'STOPPED' : last.status === 'error' ? 'FAILED' : 'DONE'
}

const stateView = (el: El, d: BoardData) => {
  const last = d.turns[d.turns.length - 1]
  const isWorking = d.main.status === 'working'
  const word = isWorking ? phaseOf(last?.steps ?? []) : restWord(last, d.now)
  // A white bubble like the CLAUDE beside it; the word's colour tells the state:
  // working in deep clay, wrapping up blue, done and idle deep green, stopped or failed red.
  const ink = isWorking ? (word === 'WRAPPING' ? INK.wrap : INK.work) : word === 'STOPPED' || word === 'FAILED' ? INK.stop : INK.done
  const room = stateRoom(d.columns, heroTextCols(d))
  const bubble = bubbleParts(word, room)
  // A board too narrow for any bubble still shows the word, by the sprite's mouth, cut to the room it has.
  if (!bubble) {
    return (
      <el.Box flexShrink={1} marginLeft={1} marginRight={1} paddingTop={3}>
        <el.Text color={P.white} bold wrap="truncate-end">{word}</el.Text>
      </el.Box>
    )
  }
  return (
    // Three lines from the sprite's first: the word and the tail land on its second line.
    <el.Box flexDirection="column" flexShrink={0} marginLeft={1} marginRight={1} paddingTop={1}>
      <el.Text color={P.white}>{bubble.top}</el.Text>
      <el.Text color={P.white}>▄█<el.Text color={ink} backgroundColor={P.white} bold>{bubble.body}</el.Text>█</el.Text>
      <el.Text color={P.white}>{bubble.bottom}</el.Text>
    </el.Box>
  )
}

const hero = (el: El, d: BoardData) => {
  const isWorking = d.main.status === 'working'
  const legs = isWorking ? LEGS[Math.floor(d.now / 1000) % 2] : LEGS[0]
  return (
    // The text on the left, the sprite in the middle, the bubble by its head; the sprite has an empty row above and below.
    <el.Box>
      {/* CLAUDE, the model, the plan and the limits, centred against the sprite. */}
      <el.Box flexDirection="column" alignSelf="center" flexShrink={0} marginLeft={1}>
        <el.Text><el.Text color={P.clay}>ANTHROPIC </el.Text><el.Text bold>CLAUDE</el.Text></el.Text>
        <el.Text color={P.dim}>{'MODEL'.padEnd(6)}<el.Text color={MODEL[tierOf(d.main.model) ?? ''] ?? P.white}>{modelName(d.main.model)}</el.Text></el.Text>
        {d.plan
          ? <el.Text wrap="truncate-end"><el.Text color={P.black} backgroundColor={P.clay}>{` ${up(d.plan.name)} `}</el.Text>{d.plan.tier ? <el.Text color={P.orange}> {up(d.plan.tier)}</el.Text> : null}</el.Text>
          : <el.Text color={P.dim}>PLAN NOT FOUND</el.Text>}
        {limitLines(el, d)}
      </el.Box>
      <el.Box flexDirection="column" flexShrink={0} marginLeft={2} paddingY={1} justifyContent="center">
        {[...SPRITE, legs ?? ''].map(line => <el.Text color={P.clay}>{line}</el.Text>)}
      </el.Box>
      {stateView(el, d)}
    </el.Box>
  )
}

// The board's name on a yellow band across the top.
// The board's name on the left of a yellow band; the project folder and session time on the right.
const titleBar = (el: El, d: BoardData) => {
  const since = d.startedAt ? up(duration(d.now - d.startedAt)).replace(/ /g, '') : undefined
  const tail = `${d.project && since ? ' · ' : ''}${since ?? ''} ★`
  // A long folder name loses its end, so its start stays readable; the time is never cut.
  return (
    <el.Box width="100%" backgroundColor={P.yellow} paddingX={1} justifyContent="space-between">
      <el.Box flexShrink={0}><el.Text color={P.black} bold>★ WORK-BOARD</el.Text></el.Box>
      <el.Box flexShrink={1} paddingLeft={1}>
        {d.project ? <el.Box flexShrink={1}><el.Text color={P.black} wrap="truncate-end">{up(d.project)}</el.Text></el.Box> : null}
        <el.Box flexShrink={0}><el.Text color={P.black}>{tail}</el.Text></el.Box>
      </el.Box>
    </el.Box>
  )
}

const tabBar = (el: El, d: BoardData) => {
  const tab = (n: number, name: string) => (
    <el.Button key={`tab-${n}`} plain onPress={() => d.onTab(n)}>
      {d.tab === n ? <el.Text color={P.yellow}>▶{name}</el.Text> : <el.Text color={P.dim}> {name}</el.Text>}
    </el.Button>
  )
  return (
    <el.Box columnGap={1} flexWrap="wrap">
      {TABS.map((name, i) => tab(i + 1, name))}
      {tab(HELP_TAB, '?')}
    </el.Box>
  )
}

const agentStatus = (el: El, a: AgentRow) =>
  a.status === 'running' ? <el.Text color={P.yellow}>▶ CAST {a.tools}</el.Text>
    : LIVE.has(a.status) ? <el.Text color={P.yellow}>… WAIT</el.Text>
      : a.status === 'completed' ? <el.Text color={P.green}>✓ DONE</el.Text>
        : <el.Text color={P.red}>✕ {up(a.status)}</el.Text>

const mmss = (ms: number) => {
  const sec = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

// Newest first; older rows drop off past these counts. RUNNING sizes its timeline to the rows left, its own tab shows the long one.
type TimelineSize = { steps: number; earlier: number; isGrow: boolean }
const LONG_TIMELINE: TimelineSize = { steps: 8, earlier: 5, isGrow: true }
const MAX_STEPS_SHOWN = 12
const MAX_FILES_SHOWN = 16
const DEFAULT_ROWS = 40

// A double-bordered window takes its two border rows and title row, plus its body (at least one row).
const winRows = (bodyRows: number) => 3 + Math.max(1, bodyRows)

// Rows above the tab body: title band, hero with its margins, the STATUS window and the tab bar.
const headRows = (d: BoardData) => {
  // The sprite's four lines with an empty row above and below, or the text beside it if that is taller.
  const heroRows = Math.max(SPRITE.length + 1 + 2, heroTextRows(d))
  const ctx = d.usage.context
  const statusBody = (ctx === undefined ? 0 : 1) + (ctx !== undefined && ctx >= CTX_WARN ? 1 : 0) + (d.ram ? 1 : 0) + 1
  return 1 + heroRows + winRows(statusBody) + 1
}

// Splits the rows left under the fixed RUNNING windows between the timeline and the files list.
const fitLists = (d: BoardData, usedRows: number) => {
  const openText = d.openRow ? d.detailOf(d.openRow) ?? '' : ''
  const wrapCols = Math.max(10, d.columns - 7)
  const openLines = openText ? openText.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(cellsWide(line) / wrapCols)), 0) : 0
  const budget = (d.rows ?? DEFAULT_ROWS) - usedRows - winRows(1) * 2 + 2
  const earlier = budget >= 14 ? 2 : budget >= 9 ? 1 : 0
  const earlierRows = earlier ? 1 + earlier * 2 : 0
  const timelineRows = Math.max(2, Math.round(budget * 0.55))
  const steps = Math.min(MAX_STEPS_SHOWN, Math.max(1, timelineRows - 1 - earlierRows - openLines))
  const files = Math.min(MAX_FILES_SHOWN, Math.max(1, budget - (1 + steps + earlierRows + openLines)))
  return { timeline: { steps, earlier, isGrow: false }, files }
}

const STEP_ICON: Record<string, readonly [string, string]> = { done: ['✓', P.green], blocked: ['✕', P.red], error: ['!', P.red], running: ['▶', P.yellow] }
const stepIcon = (status: string): readonly [string, string] => STEP_ICON[status] ?? ['·', P.dim]

// Columns a request row and a step row spend on everything but their text: marks, time, model, frame.
const PROMPT_ROW_COLS = 28
const STEP_ROW_COLS = 22

// Cells a character takes: wide (Hangul, CJK, full-width) characters take two.
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/
const cellsOf = (ch: string) => (WIDE.test(ch) ? 2 : 1)
const cellsWide = (text: string) => [...text].reduce((sum, ch) => sum + cellsOf(ch), 0)

// One line of at most `cols` cells: the first line of the text, cut with … when it runs longer.
const clip = (text: string, cols: number) => {
  const first = text.split('\n')[0] ?? ''
  const hasMore = first.trimEnd() !== text.trimEnd()
  const limit = Math.max(4, cols)
  let used = 0
  let out = ''
  for (const ch of first) {
    if (used + cellsOf(ch) > limit - 1) return `${out}…`
    used += cellsOf(ch)
    out += ch
  }
  return hasMore ? `${out}…` : out
}

// A request row is a button too: pressing it unfolds the request as it was typed.
const turnHead = (el: El, t: Turn, d: BoardData) => {
  const key = `turn:${t.id}`
  const isOpen = d.openRow === key
  return (
    <el.Box flexDirection="column">
      {row(el,
        <el.Button key={key} plain onPress={() => d.onRow(key)}>
          <el.Text wrap="truncate-end"><el.Text color={isOpen ? P.cyan : P.dim}>{isOpen ? '▾' : '▸'}{clock(t.at)} </el.Text><el.Text color={t.status === 'running' ? P.yellow : t.status === 'aborted' ? P.dim : t.status === 'error' || t.blocked ? P.red : P.green}>{t.status === 'running' ? '▶ ' : t.status === 'aborted' ? '■ ' : '● '}</el.Text><el.Text color={P.white}>{clip(d.detailOf(key) ?? t.prompt, d.columns - PROMPT_ROW_COLS)}</el.Text></el.Text>
        </el.Button>,
        <el.Text>{model(el, t.model)} <el.Text color={P.dim}>{t.ms === undefined ? 'RUN' : up(duration(t.ms))}</el.Text></el.Text>)}
      {isOpen ? (
        <el.Box paddingLeft={3} flexDirection="column">
          {(d.detailOf(key) ?? t.prompt).split('\n').map(text => <el.Text color={P.soft} wrap="wrap">{text || ' '}</el.Text>)}
        </el.Box>
      ) : null}
    </el.Box>
  )
}

// The latest request with its steps, newest first (press one to unfold it), then earlier requests in brief.
const timelineWin = (el: El, d: BoardData, size: TimelineSize) => {
  const latest = d.turns.at(-1)
  if (!latest) return win(el, 'TIMELINE', null, [<el.Text color={P.dim}>NO REQUESTS YET</el.Text>], P.cyan, size.isGrow)
  const steps = latest.steps ?? []
  const earlier = d.turns.slice(-1 - size.earlier, -1).reverse()
  return win(el, 'TIMELINE', `${steps.length} STEPS · LAST ${d.turns.length}`, [
    turnHead(el, latest, d),
    ...steps.slice(-size.steps).reverse().map(step => {
      const quest = latest
      const [icon, color] = stepIcon(step.status)
      const key = `step:${step.id}`
      const isOpen = d.openRow === key
      // A step row is a button: pressing it unfolds the step's full command, path or pattern.
      return (
        <el.Box key={key} flexDirection="column">
          {/* A Button holds only strings and Text, so it wraps the left text and the time sits beside it. */}
          {row(el,
            <el.Button key={key} plain onPress={() => d.onRow(key)}>
              <el.Text wrap="truncate-end"><el.Text color={isOpen ? P.cyan : P.dim}>{isOpen ? '▾' : '▸'}</el.Text><el.Text color={color}>{icon}</el.Text> {up(step.tool).padEnd(6)} <el.Text color={P.dim}>{clip(up(step.target), d.columns - STEP_ROW_COLS)}</el.Text>{step.status === 'blocked' ? <el.Text color={P.red}> BLOCKED</el.Text> : null}</el.Text>
            </el.Button>,
            step.status === 'running' ? <el.Text color={P.yellow}>NOW</el.Text> : <el.Text color={P.dim}>{mmss(step.at - quest.at)}</el.Text>)}
          {isOpen ? (
            <el.Box paddingLeft={3} flexDirection="column">
              {(d.detailOf(key) || 'NO DETAIL KEPT').split('\n').map(text => <el.Text color={P.soft} wrap="wrap">{text}</el.Text>)}
            </el.Box>
          ) : null}
        </el.Box>
      )
    }),
    ...(earlier.length ? [caption(el, 'EARLIER')] : []),
    ...earlier.map(t => (
      <el.Box flexDirection="column">
        {turnHead(el, t, d)}
        <el.Text color={t.blocked ? P.red : P.dim} wrap="truncate-end">      ⎿ {up(t.tools.join(' › ')) || 'NO TOOLS'}{t.blocked ? ` · BLOCKED ${t.blocked}` : ''}</el.Text>
      </el.Box>
    )),
  ], P.cyan, size.isGrow)
}

const timeline = (el: El, d: BoardData) => [timelineWin(el, d, LONG_TIMELINE)]

// Files this session read or changed; a file another session claims is flagged.
const filesWin = (el: El, d: BoardData, shown: number) => {
  const me = d.hub?.me
  const samePath = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
  const claimedBy = (path: string) => (d.hub?.peers ?? []).find(p => p.id !== me?.id && !p.isEnded && p.claims.some(c => samePath(c, path)))
  const rows = [...d.files].sort((a, b) => b.lastAt - a.lastAt).slice(0, shown)
  const most = Math.max(1, ...rows.map(f => f.edits + f.reads))
  const body = rows.map(f => {
    const owner = claimedBy(f.path)
    const count = f.edits + f.reads
    const isEdited = f.edits > 0
    const icon = owner ? ['⚑', P.purple] : f.isNew ? ['+', P.green] : isEdited ? ['✎', P.yellow] : ['◇', P.dim]
    return row(el,
      <el.Text wrap="truncate-end"><el.Text color={icon[1]}>{icon[0]}</el.Text> <el.Text color={isEdited || owner ? P.white : P.dim}>{up(f.name)}</el.Text>{owner ? <el.Text color={P.purple}> CLAIMED · {up(owner.name)}</el.Text> : null}</el.Text>,
      <el.Text>{f.isNew && !owner ? <el.Text color={P.green}>NEW </el.Text> : null}<el.Text color={isEdited ? P.orange : P.dim}>{'■'.repeat(Math.max(1, Math.round((count / most) * 8)))}</el.Text> <el.Text color={isEdited ? P.white : P.dim}>x{count}</el.Text></el.Text>)
  })
  return win(el, 'FILES', `${d.files.length} TOUCHED`, [
    ...(body.length ? body : [<el.Text color={P.dim}>NO FILES YET</el.Text>]),
  ], P.cyan)
}

const running = (el: El, d: BoardData) => {
  const live = d.agents.filter(a => LIVE.has(a.status))
  const limit = d.router?.limits?.concurrent ?? 4
  // A finished agent shows as DONE for 10 s, then leaves; the board may redraw before the next poll drops it.
  const party = d.agents.filter(a => !isGoneFromParty(a, d.now)).slice(-6).map(a => row(el,
    <el.Text color={LIVE.has(a.status) ? P.white : P.dim} wrap="truncate-end">{up(short(a.type, 18))}</el.Text>,
    <el.Text>{model(el, a.model)} {agentStatus(el, a)}</el.Text>))
  const top = [...d.plugins].sort((a, b) => b.count - a.count).slice(0, 4)
  const most = Math.max(1, ...top.map(p => p.count))
  const skills = [
    ...(d.activeSkill ? [row(el, <el.Text wrap="truncate-end">{up(d.activeSkill.split(':').pop() ?? d.activeSkill)}</el.Text>, <el.Text color={P.cyan}>♪ NOW</el.Text>)] : []),
    ...d.skills.filter(s => s.name !== d.activeSkill).slice(-2).map(s => row(el, <el.Text color={P.dim} wrap="truncate-end">{up(s.name.split(':').pop() ?? s.name)}</el.Text>, <el.Text color={P.dim}>✓ x{s.count}</el.Text>)),
    ...(top.length ? [caption(el, 'CALLS THIS SESSION')] : []),
    ...top.map(p => row(el, <el.Text>{up(short(p.name, 12)).padEnd(13)}<el.Text color={P.orange}>{'■'.repeat(Math.max(1, Math.round((p.count / most) * 10)))}</el.Text></el.Text>, <el.Text>x{p.count}</el.Text>)),
  ]
  const me = d.hub?.me
  const threads = d.hub?.threads ?? []
  const peers = (d.hub?.peers ?? []).filter(p => !p.isEnded && d.now - p.beat < PEER_LIVE_MS)
  const sessions = peers.map(p => {
    const asks = threads.filter(t => !t.isMine && t.type === 'QUESTION' && p.name.startsWith(t.peer.split('@')[0] ?? t.peer)).length
    return row(el,
      <el.Text><el.Text color={P.green}>● </el.Text>{up(p.name)}{me && p.id === me.id ? <el.Text color={P.dim}> (YOU)</el.Text> : null}</el.Text>,
      asks ? <el.Text color={P.yellow}>? {asks} QUESTION</el.Text> : <el.Text color={P.dim}>{p.claims.length ? `CLAIM ${up(p.claims[0]?.split(/[\\/]/).pop() ?? '')}` : ''}</el.Text>)
  })
  const usedRows = headRows(d) + winRows(1) + winRows(party.length) + winRows(skills.length) + (d.hub ? winRows(sessions.length) : 0)
  const fit = fitLists(d, usedRows)
  return [
    win(el, 'MAIN', up(tierOf(d.main.model) ?? '—'), [row(el,
      d.main.status === 'working' ? <el.Text color={P.yellow}>▶ WORKING</el.Text> : <el.Text color={P.dim}>· IDLE</el.Text>,
      <el.Text color={P.dim}>{d.main.tool ? `TOOL: ${up(d.main.tool)}` : ''}</el.Text>)]),
    win(el, 'PARTY', <el.Text>{live.length}/{limit} {slots(el, live.length, limit, P.white)}</el.Text>, party),
    win(el, 'SKILLS & PLUGINS', String(d.skills.length), skills),
    ...(d.hub ? [win(el, 'SESSIONS', `${peers.length} LINKED`, sessions)] : []),
    timelineWin(el, d, fit.timeline),
    filesWin(el, d, fit.files),
  ]
}

const routing = (el: El, d: BoardData) => {
  const r = d.router
  if (!r) return [win(el, 'AUTO ROUTING', 'OFF', [<el.Text color={P.dim}>AGENT-ROUTER NOT LOADED</el.Text>])]
  const on = r.switches
  const decisions = (r.decisions ?? []).slice(-6).map(x => row(el,
    <el.Text wrap="truncate-end"><el.Text color={x.source === 'explicit' ? P.dim : P.white}>{up(short(x.type, 12)).padEnd(13)}</el.Text><el.Text color={P.dim}>{x.source === 'level' ? short(x.why, 14) : up(x.source)}</el.Text></el.Text>,
    x.source === 'blocked' ? <el.Text color={P.red}>✕ BLOCKED</el.Text>
      : <el.Text>{x.level ? <el.Text color={LEVEL[x.level] ?? P.white}>LV{x.level} </el.Text> : <el.Text color={P.dim}>— </el.Text>}{model(el, x.tier ?? x.model)}</el.Text>))
  const live = d.agents.filter(a => LIVE.has(a.status)).length
  const limit = r.limits?.concurrent ?? 4
  const bgLimit = r.limits?.background ?? 2
  const blocked = (r.decisions ?? []).filter(x => x.source === 'blocked').slice(-2).map(x =>
    <el.Text color={P.red} wrap="truncate-end">✕ {clock(x.at)} {up(short(x.type, 12))} BLOCKED · LIMIT {limit}</el.Text>)
  const hints = (r.hints ?? []).slice(-3).map(hint => row(el,
    <el.Text>{clock(hint.at)} {model(el, hint.tier)}</el.Text>,
    hint.isFollowed ? <el.Text color={P.green}>✓ FOLLOWED</el.Text> : <el.Text color={P.dim}>— IGNORED</el.Text>))
  return [
    win(el, 'AUTO ROUTING', on?.isRouting === false ? <el.Text color={P.dim}>○ OFF</el.Text> : <el.Text color={P.green}>● ON</el.Text>, [...decisions, caption(el, 'EXPLICIT › RULES › LEVEL')]),
    win(el, 'LIMITS', `${live}/${limit} · BG ≤${bgLimit}`, [
      row(el, <el.Text>RUN {slots(el, live, limit, P.yellow)}</el.Text>, <el.Text>BG {slots(el, 0, bgLimit, P.cyan)}</el.Text>),
      ...blocked,
    ]),
    win(el, 'MAIN HINTS', `${(r.hints ?? []).filter(hint => hint.isFollowed).length}/${(r.hints ?? []).length} FOLLOWED`, hints),
    win(el, 'LEVELS', null, [
      <el.Text><el.Text color={P.cyan}>LV1</el.Text> <el.Text color={P.dim}>FIND · LIST · SUMMARY</el.Text></el.Text>,
      <el.Text><el.Text color={P.yellow}>LV2</el.Text> <el.Text color={P.dim}>EDIT · BUILD · TEST · REVIEW</el.Text></el.Text>,
      <el.Text><el.Text color={P.red}>LV3</el.Text> <el.Text color={P.dim}>DESIGN · MULTI-FILE · SECURITY</el.Text></el.Text>,
    ]),
  ]
}

const collab = (el: El, d: BoardData) => {
  const hub = d.hub
  if (!hub) return [win(el, 'BOARD', 'OFF', [<el.Text color={P.dim}>COLLAB-HUB NOT LOADED</el.Text>])]
  const all = (hub.peers ?? []).filter(p => !p.isEnded && d.now - p.beat < 24 * 3600_000)
  const board = all.map(p => {
    const isLive = d.now - p.beat < PEER_LIVE_MS
    return row(el,
      <el.Text><el.Text color={isLive ? P.green : P.dim}>{isLive ? '●' : '○'} </el.Text><el.Text color={isLive ? P.white : P.dim}>{up(p.name)}</el.Text><el.Text color={P.dim}> {up(duration(d.now - p.beat))}</el.Text></el.Text>,
      <el.Text color={P.dim} wrap="truncate-end">{p.claims.length ? `CLAIM ${up(p.claims.map(c => c.split(/[\\/]/).pop()).join(', '))}` : isLive ? '' : 'NO SIGNAL'}</el.Text>)
  })
  const threads = (hub.threads ?? []).slice(-4).map(t => row(el,
    <el.Text><el.Text color={P.yellow}>{up(t.id)}</el.Text> {t.isMine ? '→' : '←'} {up(short(t.peer, 14))}</el.Text>,
    <el.Text><el.Text color={P.dim}>{t.turn}/12 </el.Text><el.Text color={t.type === 'END' ? P.dim : P.yellow}>{t.type}</el.Text></el.Text>))
  const notices = (hub.notices ?? []).slice(0, 3).map(n =>
    <el.Text wrap="truncate-end"><el.Text color={P.purple}>◆ </el.Text><el.Text color={P.dim}>{clock(n.at)} {up(n.from)} </el.Text>{n.text}</el.Text>)
  const live = all.filter(p => d.now - p.beat < PEER_LIVE_MS).length
  return [win(el, 'BOARD', `THIS PC · ${live} LIVE`, board), win(el, 'THREADS', `${threads.length} OPEN`, threads), win(el, 'NOTICES', String(notices.length), notices)]
}

const resetText = (resetsAt: string | undefined) => {
  if (!resetsAt) return ''
  const at = new Date(resetsAt)
  if (Number.isNaN(at.getTime())) return ''
  const day = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][at.getDay()] ?? ''
  return `RESET ${day} ${clock(at.getTime())}`
}

const usage = (el: El, d: BoardData) => {
  const u = d.usage
  const five = d.show5h ? u.five : undefined
  const cells = Math.max(10, Math.min(24, d.columns - 10))
  const big = (title: string, note: string | null, pct: number, resetsAt: string | undefined) => win(el, title, note, [
    mp(el, pct, cells),
    row(el, leftText(el, pct), <el.Text color={P.dim}>{resetText(resetsAt)}</el.Text>),
    row(el, <el.Text color={P.dim}>REMAINING</el.Text>, <el.Text color={P.dim}>{up(untilText(resetsAt, d.now)?.replace(' left', '') ?? '—')}</el.Text>),
  ])
  const left = five ? minutesToFull(five.pct, u.fiveRatePerMin) : undefined
  const most = Math.max(1, ...u.history.map(day => day.pct))
  const days = u.history.map((day, i) => {
    const isToday = i === u.history.length - 1
    const filled = Math.max(1, Math.round((day.pct / most) * 12))
    return row(el, <el.Text color={isToday ? P.yellow : P.dim}>{isToday ? 'TODAY' : day.day.slice(5)}</el.Text>,
      <el.Text><el.Text color={isToday ? P.yellow : P.cyan}>{'■'.repeat(filled)}</el.Text><el.Text color={P.dim}>{'□'.repeat(12 - filled)}</el.Text></el.Text>)
  })
  return [
    ...(five ? [big('5H', null, five.pct, five.resetsAt)] : []),
    ...(u.weekly ? [big('WEEKLY', d.show5h ? null : '5H HIDDEN', u.weekly.pct, u.weekly.resetsAt)] : [win(el, 'WEEKLY', null, [<el.Text color={P.dim}>NO LIMIT DATA ON THIS PLAN</el.Text>])]),
    win(el, 'THIS SESSION', `SINCE ${clock(d.startedAt)}`, [
      ...(five && u.startFive !== undefined ? [row(el, <el.Text>5H LEFT</el.Text>, <el.Text>-{Math.round(five.pct - u.startFive)} <el.Text color={P.dim}>{leftOf(u.startFive)} › {leftOf(five.pct)}</el.Text></el.Text>)] : []),
      ...(u.weekly && u.startWeekly !== undefined ? [row(el, <el.Text>WEEKLY LEFT</el.Text>, <el.Text>-{Math.round(u.weekly.pct - u.startWeekly)} <el.Text color={P.dim}>{leftOf(u.startWeekly)} › {leftOf(u.weekly.pct)}</el.Text></el.Text>)] : []),
      ...(u.context !== undefined ? [row(el, <el.Text>CONTEXT</el.Text>, <el.Text>{Math.round(u.context)}/100</el.Text>)] : []),
      ...(left !== undefined ? [row(el, <el.Text>5H EMPTY IN</el.Text>, <el.Text color={P.yellow}>~{up(duration(left * 60_000))}</el.Text>)] : []),
    ]),
    win(el, 'LAST 7 DAYS', 'THIS PC', days),
    win(el, 'OPTIONS', null, [
      row(el, <el.Text>5H WINDOW</el.Text>, d.show5h
        ? <el.Text><el.Text color={P.yellow}>▶ON</el.Text> <el.Text color={P.dim}> OFF</el.Text></el.Text>
        : <el.Text><el.Text color={P.dim}> ON</el.Text> <el.Text color={P.yellow}>▶OFF</el.Text></el.Text>),
      <el.Text color={P.dim}>/board 5h {d.show5h ? 'off' : 'on'}</el.Text>,
    ]),
  ]
}

const HELP: readonly [string, readonly (readonly [string, string])[]][] = [
  ['BOARD', [['/board', 'OPEN · CLOSE'], ['/board clear', 'RESET TIMELINE · FILES'], ['/board 5h on|off', 'SHOW · HIDE 5H'],
    ['/board-clear', 'SAME AS /board clear'], ['/board-5h-on', 'SHOW 5H LINE'], ['/board-5h-off', 'HIDE 5H LINE']]],
  ['ROUTING', [['/routing', 'SUMMARY'], ['/routing on|off', 'AUTO ROUTING'],
    ['/routing level on|off', 'AUTO LEVEL LV1-3'], ['/routing hints on|off', 'MAIN HINTS'], ['/routing rules', 'RELOAD RULES.JSON']]],
  ['COLLAB', [['/collab', 'SESSION BOARD'], ['/collab <session> <task>', 'SEND REQUEST'], ['/collab name <name>', 'NAME SESSION'], ['/notice <text>', 'POST NOTICE'],
    ['/claim <file>', 'MARK A FILE'], ['/release <file> | all', 'UNMARK ONE · ALL']]],
  ['SHELL', [['/allow-once', 'NEXT DANGER RUNS ONCE'], ['/allow-once off', 'CANCEL IT'], ['/safe-shell', 'LEVELS · COUNTS']]],
]

const keycap = (el: El, key: string) => <el.Text color={P.black} backgroundColor={P.white}>{` ${key} `}</el.Text>

const help = (el: El) => [
  ...HELP.map(([title, items]) => win(el, title, null, items.map(([cmd, what]) =>
    <el.Box flexDirection="column"><el.Text color={P.white}>{cmd}</el.Text><el.Text color={P.dim}>  {what}</el.Text></el.Box>))),
  win(el, 'KEYS', null, [['ESC', 'BACK TO TERMINAL'], ['CTRL+X TAB', 'FOCUS BOARD'], ['TAB · ENTER', 'PICK A TAB'], ['↑ ↓', 'SCROLL']].map(([key, what]) =>
    row(el, keycap(el, key ?? ''), <el.Text color={P.dim}>{what}</el.Text>))),
  win(el, 'SYMBOLS', null, [
    ...[['✎', P.yellow, 'FILE EDITED'], ['+', P.green, 'FILE CREATED'], ['◇', P.dim, 'FILE READ ONLY'], ['⚑', P.purple, 'CLAIMED BY ANOTHER SESSION']].map(([mark, color, what]) =>
      <el.Text><el.Text color={color}>{mark}</el.Text> <el.Text color={P.dim}>{what}</el.Text></el.Text>),
    ...[['✓', P.green, 'STEP DONE'], ['✕', P.red, 'STEP BLOCKED'], ['▶', P.yellow, 'STEP RUNNING']].map(([mark, color, what]) =>
      <el.Text><el.Text color={color}>{mark}</el.Text> <el.Text color={P.dim}>{what}</el.Text></el.Text>),
  ]),
]

export const renderBoard = (el: El, d: BoardData) => {
  const body = d.tab === 2 ? routing(el, d) : d.tab === 3 ? collab(el, d) : d.tab === 4 ? timeline(el, d) : d.tab === 5 ? usage(el, d) : d.tab === HELP_TAB ? help(el) : running(el, d)
  return (
    // Paint the whole pane in the terminal's own black, down to its last row.
    <el.Box flexDirection="column" paddingRight={1} backgroundColor={P.term} minHeight={d.rows}>
      {titleBar(el, d)}
      {hero(el, d)}
      {statusWin(el, d)}
      {tabBar(el, d)}
      {body}
    </el.Box>
  )
}
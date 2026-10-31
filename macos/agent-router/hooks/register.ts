import { atom, read, update } from 'claude-code'
import type { AgentSpawnInput, EngineInterface, Register } from 'claude-code'

import { DEFAULT_RULES, decide, hintFor, LEVEL_TIER, mergeRules, tierOf } from './route'
import type { Rules } from './route'
import type { Decision, Hint, Switches, Tier } from '../types'

const MAX_DECISIONS = 40
const MAX_HINTS = 10
const FOLLOW_WINDOW_MS = 10 * 60 * 1000
const LIVE = new Set(['pending', 'running', 'waiting'])

const decisions = atom({ plugin: 'agent-router-macos', key: 'decisions' } as const, [] as Decision[])
const hints = atom({ plugin: 'agent-router-macos', key: 'hints' } as const, [] as Hint[])
const switches = atom({ plugin: 'agent-router-macos', key: 'switches' } as const, { isRouting: true, isLevel: true, isHints: true } as Switches)
const limits = atom({ plugin: 'agent-router-macos', key: 'limits' } as const, DEFAULT_RULES.limits)

let rules: Rules = DEFAULT_RULES

const short = (text: string, room = 48): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > room ? `${flat.slice(0, room - 1)}…` : flat
}

const loadRules = async ($: EngineInterface): Promise<void> => {
  try {
    rules = mergeRules(JSON.parse(await $.fs.read(`${$.plugin.root}/rules.json`)))
  } catch (error) {
    rules = DEFAULT_RULES
    $.ui.log(`agent-router: rules.json not read, defaults in use (${String(error)})`)
  }
  await update($, limits, () => rules.limits)
}

const record = ($: EngineInterface, decision: Decision) =>
  update($, decisions, list => [...list, decision].slice(-MAX_DECISIONS))

// Counts live agents; a background flag is known only for spawns this plugin saw.
const liveCounts = async ($: EngineInterface): Promise<{ all: number; background: number }> => {
  const listed = await $.agent.list()
  const live = new Set(listed.filter(agent => LIVE.has(agent.status)).map(agent => agent.id))
  const seen = await read($, decisions)
  const background = seen.filter(d => d.background && d.agentId !== undefined && live.has(d.agentId)).length
  return { all: live.size, background }
}

// Spawns still between this hook and the engine: several started in one reply all read the list
// before any of them is in it, so each takes a ticket first and counts the tickets ahead of it.
let inFlight = 0

const overLimit = async ($: EngineInterface, e: AgentSpawnInput, ahead: number): Promise<string | undefined> => {
  const counts = await liveCounts($)
  const all = counts.all + ahead
  if (all >= rules.limits.concurrent) {
    return `agent-router: ${all} agents are already running or starting (limit ${rules.limits.concurrent}). Wait for one to finish.`
  }
  if (e.background && counts.background >= rules.limits.background) {
    return `agent-router: ${counts.background} background agents are running (limit ${rules.limits.background}).`
  }
  return undefined
}

type SpawnNext = (e: AgentSpawnInput) => ReturnType<EngineInterface['agent']['spawn']>

// The concurrency limits hold whether or not routing is on; routing only decides the model.
const route = async ($: EngineInterface, e: AgentSpawnInput, next: SpawnNext) => {
  const ahead = inFlight
  inFlight += 1
  try {
    const on = await read($, switches)
    const base = { at: Date.now(), type: e.subagentType, task: short(e.description || e.prompt), background: e.background }
    const blocked = await overLimit($, e, ahead)
    if (blocked) {
      await record($, { ...base, source: 'blocked', why: blocked })
      $.ui.toast(blocked)
      return { deny: blocked }
    }
    const choice = !on.isRouting
      ? { source: 'none' as const, why: 'routing off' }
      : e.fork || e.workflow
        ? { source: 'none' as const, why: e.fork ? 'fork inherits' : 'workflow' }
        : decide(e, rules, { level: on.isLevel })
    const started = await next(choice.tier ? { ...e, model: choice.tier } : e)
    if (started.deny === undefined) {
      await record($, { ...base, ...choice, model: started.model, agentId: started.agentId })
    }
    return started
  } finally {
    inFlight -= 1
  }
}

const listText = async ($: EngineInterface): Promise<string> => {
  const on = await read($, switches)
  const list = await read($, decisions)
  const routed = list.filter(d => d.source !== 'blocked')
  const byTier = (tier: Tier) => routed.filter(d => (d.tier ?? tierOf(d.model)) === tier).length
  const head = `agent-router · routing ${on.isRouting ? 'on' : 'off'} · level ${on.isLevel ? 'on' : 'off'} · hints ${on.isHints ? 'on' : 'off'} · limit ${rules.limits.concurrent} (bg ${rules.limits.background})`
  const counts = `opus ${byTier('opus')} · sonnet ${byTier('sonnet')} · haiku ${byTier('haiku')} · blocked ${list.length - routed.length}`
  const rows = list.slice(-12).map(d => {
    const lv = d.level ? `L${d.level}` : '—'
    const model = d.source === 'blocked' ? 'blocked' : (d.tier ?? tierOf(d.model) ?? d.model ?? 'own')
    return `  ${d.type.padEnd(18)} ${lv.padEnd(3)} ${model.padEnd(8)} ${d.source.padEnd(8)} ${short(d.why, 36)}`
  })
  return [head, counts, ...(rows.length ? rows : ['  no agents routed yet'])].join('\n')
}

const USAGE = 'Usage: /routing [on|off] | level on|off | hints on|off | rules'

const runCommand = async ($: EngineInterface, args: string): Promise<string> => {
  const [first, second] = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const flip = (key: keyof Switches, value: boolean) => update($, switches, s => ({ ...s, [key]: value }))
  if (!first) return listText($)
  if (first === 'on' || first === 'off') {
    await flip('isRouting', first === 'on')
    return `agent-router: routing ${first}.`
  }
  if ((first === 'level' || first === 'hints') && (second === 'on' || second === 'off')) {
    await flip(first === 'level' ? 'isLevel' : 'isHints', second === 'on')
    return `agent-router: ${first} ${second}.`
  }
  if (first === 'rules') {
    await loadRules($)
    const types = Object.entries(rules.types).map(([type, tier]) => `  ${type.padEnd(20)} ${tier}`)
    const fallback = `  (other types)        L1 ${LEVEL_TIER[1]} · L2 ${LEVEL_TIER[2]} · L3 ${LEVEL_TIER[3]}`
    return [`agent-router rules · ${$.plugin.root}/rules.json (reloaded)`, ...types, fallback].join('\n')
  }
  return USAGE
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await loadRules($)
    await $.command.register({ name: 'routing', description: 'Agent routing summary and switches', argumentHint: '[on|off] | level on|off | hints on|off | rules' })
    return next(e)
  })

  on('command.run', { command: 'routing' }, async ($, e) => ({ text: await runCommand($, e.args) }))

  on('agent.spawn', async ($, e, next) => route($, e, next)).catch(($, e, next) => {
    // A failed check lets the spawn through rather than block work; the log says the limit was not applied.
    $.ui.log('agent-router: the spawn check failed, so this agent started without the limit check.')
    return next(e)
  })

  // Main thread: suggest only. The session model is never switched here.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer' || e.text.startsWith('/') || !(await read($, switches)).isHints) return next(e)
    const hint = hintFor(e.text, await $.session.model())
    if (hint) {
      $.ui.toast(`agent-router · hint: looks like a ${hint.tier} task (${hint.why}) · /model ${hint.tier}`)
      await update($, hints, list => [...list, { at: Date.now(), tier: hint.tier, why: hint.why, isFollowed: false }].slice(-MAX_HINTS))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PostModelSwitch', async ($, e, next) => {
    const now = Date.now()
    await update($, hints, list =>
      list.map(h => (!h.isFollowed && now - h.at < FOLLOW_WINDOW_MS && e.to_model.includes(h.tier) ? { ...h, isFollowed: true } : h)),
    )
    return next(e)
  })
}

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { classify, dangerCount, denyText, describeRules } from './levels'
import type { Counts } from '../types'

const allowOnce = atom({ plugin: 'safe-shell', key: 'allowOnce' } as const, false)
const counts = atom({ plugin: 'safe-shell', key: 'counts' } as const, { caution: 0, danger: 0, forbidden: 0 } as Counts)

const HELD = 'safe-shell: the check failed, so the command was held.'
// An allow-once left unused this long lapses on its own.
const ALLOW_ONCE_MS = 5 * 60_000

// The pass itself lives here, checked and cleared in one synchronous step, so two commands run in parallel
// cannot both use it. The atom only mirrors it for /safe-shell and the board. A reload drops an unused pass.
let passUntil = 0

const takePass = (): boolean => {
  if (Date.now() > passUntil) return false
  passUntil = 0
  return true
}

const quietly = async ($: EngineInterface, work: () => Promise<unknown>): Promise<void> => {
  try {
    await work()
  } catch (error) {
    $.ui.log(`safe-shell: could not record (${String(error)})`)
  }
}

// Answers a deny reason, or undefined when the command may run.
const judge = async ($: EngineInterface, command: string): Promise<string | undefined> => {
  const verdict = classify(command)
  if (!verdict) return undefined
  await quietly($, () => update($, counts, c => ({ ...c, [verdict.level]: c[verdict.level] + 1 })))
  if (verdict.level === 'caution') {
    $.ui.toast(`safe-shell CAUTION · ${verdict.reason}`)
    return undefined
  }
  if (verdict.level === 'danger' && dangerCount(command) === 1 && takePass()) {
    await quietly($, () => update($, allowOnce, () => false))
    $.ui.toast(`safe-shell · allowed once: ${verdict.match}`)
    return undefined
  }
  $.ui.toast(`safe-shell ${verdict.level.toUpperCase()} · blocked: ${verdict.match}`)
  return denyText(verdict)
}

const report = async ($: EngineInterface): Promise<string> => {
  const c = await read($, counts)
  const armed = Date.now() <= passUntil ? `armed (${Math.ceil((passUntil - Date.now()) / 60_000)}m left)` : 'off'
  return [`safe-shell · this session: caution ${c.caution} · danger ${c.danger} · forbidden ${c.forbidden} · allow-once ${armed}`, describeRules()].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'allow-once', description: 'Let the next DANGER shell command run once (off cancels)', argumentHint: '[off]' })
    await $.command.register({ name: 'safe-shell', description: 'Show safe-shell levels and this session\'s counts' })
    return next(e)
  })

  on('command.run', { command: 'allow-once' }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'off') {
      passUntil = 0
      await update($, allowOnce, () => false)
      return { text: 'safe-shell: allow-once cancelled. DANGER commands are blocked again.' }
    }
    passUntil = Date.now() + ALLOW_ONCE_MS
    await update($, allowOnce, () => true)
    return { text: 'safe-shell: the next DANGER command (one dangerous step) will run once, within 5 minutes. FORBIDDEN stays blocked. /allow-once off cancels.' }
  })

  on('command.run', { command: 'safe-shell' }, async $ => ({ text: await report($) }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const why = await judge($, e.command)
    return why === undefined ? next(e) : { deny: why }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: HELD }))

  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => {
    const why = await judge($, e.command)
    return why === undefined ? next(e) : { deny: why }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: HELD }))
}

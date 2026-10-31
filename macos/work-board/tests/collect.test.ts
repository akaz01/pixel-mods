import { describe, expect, test } from 'claude-code/testing'

import { bar, bump, isGoneFromParty, refillText, duration, minutesToFull, pluginOfSkill, pluginOfTool, readWindows, recordDay, parseVmStat, planOf, redact, short, stepDetail, stepTarget, tierOf, touchFile } from '../hooks/collect'

describe('collect', () => {
  test('short cuts long text with an ellipsis', async () => {
    expect(short('a   b')).toBe('a b')
    expect(short('abcdef', 4)).toBe('abc…')
  })

  test('bump counts by name', async () => {
    const once = bump([], 'x', 1)
    expect(bump(once, 'x', 2)).toEqual([{ name: 'x', count: 2, lastAt: 2 }])
  })

  test('plugin names come from skills and MCP tools', async () => {
    expect(pluginOfSkill('superpowers:brainstorming')).toBe('superpowers')
    expect(pluginOfSkill('plugin-authoring')).toBe('built-in')
    expect(pluginOfTool('mcp__plugin_context7_context7__query-docs')).toBe('context7')
    expect(pluginOfTool('mcp__claude_ai_Gmail__send')).toBe('claude_ai_Gmail')
    expect(pluginOfTool('Bash')).toBeUndefined()
  })

  test('tierOf shortens model ids', async () => {
    expect(tierOf('claude-opus-5-5')).toBe('opus')
    expect(tierOf('haiku')).toBe('haiku')
  })

  test('bar fills cells by percent', async () => {
    expect(bar(41, 10)).toEqual({ on: '████', off: '██████' })
    expect(bar(150, 4).on.length).toBe(4)
  })

  test('duration reads like the mockups', async () => {
    expect(duration(40_000)).toBe('40s')
    expect(duration(84 * 60_000)).toBe('1h 24m')
    expect(duration((3 * 24 + 14) * 3600_000)).toBe('3d 14h')
  })

  test('readWindows keeps only the windows the plan reports', async () => {
    const both = readWindows([{ kind: 'five_hour', percentUsed: 78 }, { kind: 'seven_day', percentUsed: 41 }])
    expect([both.five?.pct, both.weekly?.pct]).toEqual([78, 41])
    expect(readWindows([{ kind: 'seven_day', percentUsed: 41 }]).five).toBeUndefined()
  })

  test('recordDay keeps the day high and seven days', async () => {
    const day = (n: number) => new Date(2026, 9, n, 12).getTime()
    let history = recordDay([], day(1), 10)
    history = recordDay(history, day(1), 5)
    expect(history).toEqual([{ day: '2026-10-01', pct: 10 }])
    for (let n = 2; n <= 9; n++) history = recordDay(history, day(n), n)
    expect(history.length).toBe(7)
  })

  test('minutesToFull needs a rising rate', async () => {
    expect(minutesToFull(78, 0.88)).toBe(25)
    expect(minutesToFull(78, 0)).toBeUndefined()
  })
})

test('planOf reads the display name and the max tier', () => {
  expect(planOf({ planDisplayName: 'Ultra', organizationRateLimitTier: 'default_claude_max_20x' })).toEqual({ name: 'Ultra', tier: 'max 20x' })
  expect(planOf({ userRateLimitTier: 'default_claude_max_5x' })).toEqual({ name: 'max 5x', tier: undefined })
  expect(planOf(undefined)).toBeUndefined()
})

test('stepTarget names what a step acted on', () => {
  expect(stepTarget('Edit', { file_path: '/Users/me/mods/view.tsx' })).toBe('view.tsx')
  expect(stepTarget('Bash', { command: 'claude plugin test . --verbose' })).toBe('claude plugin test')
  expect(stepTarget('Agent', { subagent_type: 'Explore' })).toBe('Explore')
})

test('touchFile counts reads and edits and marks first writes as new', () => {
  const read = touchFile([], '/Users/me/a/View.tsx', 'read', 1)
  const edited = touchFile(read, '/Users/me/a/view.tsx', 'edit', 2)
  expect(edited).toHaveLength(1)
  expect(edited[0]).toMatchObject({ name: 'view.tsx', reads: 1, edits: 1, isNew: false })
  expect(touchFile([], 'b.ts', 'write', 3)[0]?.isNew).toBe(true)
})

test('stepDetail keeps the whole command and path', () => {
  expect(stepDetail('Bash', { command: 'claude plugin test . --verbose', description: 'Run tests' })).toBe('claude plugin test . --verbose\n# Run tests')
  expect(stepDetail('Edit', { file_path: '/Users/me/mods/work-board/hooks/view.tsx' })).toBe('/Users/me/mods/work-board/hooks/view.tsx')
  expect(stepDetail('Bash', { command: 'x'.repeat(700) }).length).toBeLessThan(700)
})

test('redact masks tokens and secret assignments but keeps the command readable', () => {
  expect(redact('curl -H "Authorization: Bearer abcdefghijk123"')).toBe('curl -H "Authorization: Bearer •••"')
  expect(redact('export API_KEY=supersecret && npm test')).toBe('export API_KEY=••• && npm test')
  expect(redact('git push origin main')).toBe('git push origin main')
})

test('stepDetail shows only argument names for other tools', () => {
  expect(stepDetail('mcp__x__send', { tool: 'mcp__x__send', to: 'a@b.c', body: 'hi', consent: 'Allow' })).toBe('ARGS: to, body')
})

test('vm_stat reads like Activity Monitor: app memory, wired and compressed are in use', () => {
  const vm = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:  1000.\nPages active: 5000.\nPages inactive: 2000.\n'
    + 'Pages speculative: 500.\nPages wired down: 3000.\nPages purgeable: 400.\nAnonymous pages: 6000.\nPages occupied by compressor: 700.\n'
  expect(parseVmStat(vm, '17179869184\n')).toEqual({ usedBytes: (6000 - 400 + 3000 + 700) * 16384, totalBytes: 17179869184 })
})

test('vm_stat without an Anonymous pages line falls back to total minus free, inactive and speculative', () => {
  const vm = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:  1000.\nPages active: 5000.\nPages inactive: 2000.\nPages speculative: 500.\n'
  expect(parseVmStat(vm, '17179869184\n')).toEqual({ usedBytes: 17179869184 - 3500 * 16384, totalBytes: 17179869184 })
})

test('vm_stat gives nothing when sysctl gave no total', () => {
  expect(parseVmStat('Pages free: 1.\n', '')).toBeUndefined()
})

test('refillText shows hours and minutes under a day, days and hours from a day on', () => {
  const now = Date.parse('2026-10-31T00:00:00Z')
  expect(refillText('2026-10-31T01:29:00Z', now)).toBe('1H 29M')
  expect(refillText('2026-10-31T00:05:00Z', now)).toBe('0H 05M')
  expect(refillText('2026-11-03T04:00:00Z', now)).toBe('3D 04H')
  expect(refillText(undefined, now)).toBeUndefined()
})

test('a finished agent leaves the party 10 s after it stopped', () => {
  const row = { id: 'a', type: 'Explore', status: 'completed', tools: 0, lastAt: 0, doneAt: 1000 }
  expect(isGoneFromParty(row, 5000)).toBe(false)
  expect(isGoneFromParty(row, 11_000)).toBe(true)
  expect(isGoneFromParty({ doneAt: undefined }, 99_000)).toBe(false)
})

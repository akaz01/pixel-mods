import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const RAN = 'ran'

// Stands for the engine: a command that reaches it "runs".
const engine = (on: On) => {
  on('tool.call', () => ({ result: RAN as never }))
}

const runCommand = ($: Engine, command: string) => $.command.run({ command, args: '' } as never)

// A blocked call comes back as { deny } or as an errored result carrying the reason.
const outcome = (r: { result?: unknown; deny?: string; text?: string }) =>
  r.result === RAN ? RAN : (r.deny ?? r.text ?? '')

test('a DANGER command is blocked with an alternative', async ($, on) => {
  engine(on)
  const said = outcome(await $.tool.call({ tool: 'Bash', command: 'git reset --hard' }))
  expect(said).toContain('DANGER')
  expect(said).toContain('git stash')
})

test('an everyday command runs', async ($, on) => {
  engine(on)
  expect(outcome(await $.tool.call({ tool: 'Bash', command: 'git status' }))).toBe(RAN)
})

test('a CAUTION command runs', async ($, on) => {
  engine(on)
  expect(outcome(await $.tool.call({ tool: 'PowerShell', command: 'Remove-Item .\\dist -Recurse' }))).toBe(RAN)
})

test('/allow-once lets exactly one DANGER command through', async ($, on) => {
  engine(on)
  await runCommand($, 'allow-once')
  const first = outcome(await $.tool.call({ tool: 'Bash', command: 'git push --force' }))
  const second = outcome(await $.tool.call({ tool: 'Bash', command: 'git push --force' }))
  expect(first).toBe(RAN)
  expect(second).toContain('DANGER')
})

test('/allow-once never opens a FORBIDDEN command', async ($, on) => {
  engine(on)
  await runCommand($, 'allow-once')
  expect(outcome(await $.tool.call({ tool: 'PowerShell', command: 'Remove-Item $env:USERPROFILE -Recurse' }))).toContain('FORBIDDEN')
})

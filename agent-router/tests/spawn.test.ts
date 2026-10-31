import { expect, test } from 'claude-code/testing'
import type { AgentSpawnInput, On } from 'claude-code'

const BASE: Omit<AgentSpawnInput, 'subagentType' | 'prompt'> = {
  tool_use_id: 't1',
  description: '',
  provider: { kind: 'builtin', tier: 'core' } as never,
  parentModel: 'claude-sonnet-5-5',
  background: false,
  fork: false,
}

// Stands for the engine: echoes the model it was asked to start with.
const engine = (on: On, running = 0) => {
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'inherit', agentId: `a-${e.tool_use_id}` }))
  on('agent.list', () => ({ value: Array.from({ length: running }, (_, i) => ({ id: `r${i}`, description: '', type: 'x', status: 'running' as const })) }))
}

test('a level 3 task without a rule starts on opus', async ($, on) => {
  engine(on)
  const started = await $.agent.spawn({ ...BASE, subagentType: 'general-purpose', prompt: '게시판 구조 설계' } as never)
  expect(started.model).toBe('opus')
})

test('a type rule wins over the level', async ($, on) => {
  engine(on)
  const started = await $.agent.spawn({ ...BASE, subagentType: 'Explore', prompt: '전체 구조 설계' } as never)
  expect(started.model).toBe('haiku')
})

test('an explicit model is kept', async ($, on) => {
  engine(on)
  const started = await $.agent.spawn({ ...BASE, subagentType: 'general-purpose', prompt: '설계', model: 'sonnet' } as never)
  expect(started.model).toBe('sonnet')
})

test('the concurrency limit blocks a fifth agent', async ($, on) => {
  engine(on, 4)
  const started = await $.agent.spawn({ ...BASE, subagentType: 'general-purpose', prompt: '파일 찾기' } as never)
  expect(started.deny).toContain('limit 4')
})

test('spawns started together still respect the limit', async ($, on) => {
  engine(on)
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => $.agent.spawn({ ...BASE, tool_use_id: `p${i}`, subagentType: 'Explore', prompt: 'find' } as never)))
  expect(results.filter(r => r.deny !== undefined).length).toBe(2)
})

test('the limit holds with routing off', async ($, on) => {
  engine(on, 4)
  await $.command.run({ command: 'routing', args: 'off' } as never)
  const started = await $.agent.spawn({ ...BASE, subagentType: 'Explore', prompt: 'find' } as never)
  expect(started.deny).toBeDefined()
})

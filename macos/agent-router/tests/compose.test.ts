import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// Stands for the engine: the system prompt it composes before the mod adds to it.
const engine = (on: On) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'intro', scope: 'shared' as const }] }))
}

// What the engine fills in on every render.
const render = (model: string, tools: string[]) => ({ model, promptModel: model, surfaces: [], tools, outputStyle: null, traits: [] })

test('an opus main thread gets the fable brief after the engine sections', async ($, on) => {
  engine(on)
  const composed = await $.prompt.compose(render('claude-opus-5-5', ['Agent', 'Read']))
  expect(composed.sections.map(s => s.id)).toEqual(['intro', 'agent-router:fable'])
  expect(composed.sections[1]?.scope).toBe('session')
})

test('a fable main thread keeps the prompt as the engine composed it', async ($, on) => {
  engine(on)
  const composed = await $.prompt.compose(render('claude-fable-5-2', ['Agent']))
  expect(composed.sections.map(s => s.id)).toEqual(['intro'])
})

test('a fable subagent started by opus keeps its model', async ($, on) => {
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'inherit', agentId: 'a1' }))
  on('agent.list', () => ({ value: [] }))
  const started = await $.agent.spawn({
    tool_use_id: 't1', description: '', provider: { kind: 'builtin', tier: 'core' } as never,
    parentModel: 'claude-opus-5-5', background: false, fork: false,
    subagentType: 'general-purpose', prompt: '로그인 장애 근본 원인 찾아 줘', model: 'fable',
  } as never)
  expect(started.model).toBe('fable')
})

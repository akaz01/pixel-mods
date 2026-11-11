import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_RULES, decide, hintFor, mergeRules, modelFor, scoreLevel } from '../hooks/route'

const spawn = (subagentType: string, text: string, model?: string) => ({ subagentType, description: '', prompt: text, model })

describe('scoreLevel', () => {
  test('light work is level 1', async () => {
    expect(scoreLevel('src 폴더에서 파일 이름 찾기').level).toBe(1)
    expect(scoreLevel('List every TODO and summarize').level).toBe(1)
  })

  test('ordinary edits are level 2', async () => {
    expect(scoreLevel('로그인 버그 수정하고 테스트 추가해 줘').level).toBe(2)
    expect(scoreLevel('implement the parser').level).toBe(2)
  })

  test('an everyday word alone does not make a task level 3', async () => {
    expect(scoreLevel('구조체 필드 이름 찾기').level).toBe(1)
    expect(scoreLevel('security 폴더 목록').level).toBe(1)
    expect(scoreLevel('보안 구조를 다시 짜 줘').level).toBe(3)
  })

  test('design, multi-file, root cause and security are level 3', async () => {
    expect(scoreLevel('게시판 구조 설계').level).toBe(3)
    expect(scoreLevel('여러 파일에 걸친 원인 추적').level).toBe(3)
    expect(scoreLevel('security review of auth').level).toBe(3)
  })

  test('the strongest signal wins and the words are reported', async () => {
    const scored = scoreLevel('파일 찾아서 구조 설계까지')
    expect(scored.level).toBe(3)
    expect(scored.words).toContain('설계')
  })

  test('no signal falls back to level 2', async () => {
    expect(scoreLevel('hello').level).toBe(2)
  })
})

describe('decide', () => {
  test('an explicitly chosen model is kept', async () => {
    const d = decide(spawn('general-purpose', '설계', 'haiku'), DEFAULT_RULES, { level: true })
    expect(d.source).toBe('explicit')
    expect(d.tier).toBeUndefined()
  })

  test('a type rule beats the level', async () => {
    const d = decide(spawn('Explore', '전체 구조 설계'), DEFAULT_RULES, { level: true })
    expect(d.source).toBe('rule')
    expect(d.tier).toBe('haiku')
  })

  test('the most important role goes to the strongest model', async () => {
    expect(decide(spawn('architect', 'x'), DEFAULT_RULES, { level: true }).tier).toBe('fable')
    expect(decide(spawn('planner', 'x'), DEFAULT_RULES, { level: true }).tier).toBe('opus')
    expect(decide(spawn('code-reviewer', 'x'), DEFAULT_RULES, { level: true }).tier).toBe('opus')
    expect(decide(spawn('tdd-guide', 'x'), DEFAULT_RULES, { level: true }).tier).toBe('sonnet')
    expect(decide(spawn('Explore', 'x'), DEFAULT_RULES, { level: true }).tier).toBe('haiku')
  })

  const tiersWith = (top: string) => {
    const rules = { ...DEFAULT_RULES, models: mergeRules({ top }).models }
    const tier = (type: string, text = 'x') => decide(spawn(type, text), rules, { level: true }).tier
    return [tier('architect'), tier('planner'), tier('security-reviewer'), tier('code-reviewer'), tier('Explore'), tier('general-purpose', '게시판 구조 설계')]
  }

  test('without fable, opus takes the design role and hands down only what sonnet can do', async () => {
    expect(tiersWith('opus')).toEqual(['opus', 'sonnet', 'opus', 'sonnet', 'haiku', 'opus'])
  })

  test('a role never drops below the weakest model that can do it while that model is present', async () => {
    expect(tiersWith('sonnet')).toEqual(['sonnet', 'sonnet', 'sonnet', 'sonnet', 'haiku', 'sonnet'])
    expect(tiersWith('haiku')).toEqual(['haiku', 'haiku', 'haiku', 'haiku', 'haiku', 'haiku'])
  })

  test('modelFor keeps the best fit while fable is present', async () => {
    expect(modelFor({ best: 'opus', min: 'sonnet' }, ['fable', 'opus', 'sonnet', 'haiku'])).toBe('opus')
    expect(modelFor({ best: 'fable', min: 'opus' }, ['fable', 'opus', 'sonnet', 'haiku'])).toBe('fable')
  })

  test('a rule is a model name or a best and min pair; a bad one is dropped', async () => {
    const types = mergeRules({ types: { a: 'fable', b: { best: 'opus', min: 'sonnet' }, c: { best: 'sonnet', min: 'opus' }, bad: 'gpt', worse: { min: 'opus' } } }).types
    expect(types).toEqual({ a: { best: 'fable', min: 'fable' }, b: { best: 'opus', min: 'sonnet' }, c: { best: 'sonnet', min: 'sonnet' } })
  })

  test('the rules file names the top model; the models under it are always present', async () => {
    expect(mergeRules({ top: 'opus' }).models).toEqual(['opus', 'sonnet', 'haiku'])
    expect(mergeRules({ top: 'gpt' }).models).toEqual(['fable', 'opus', 'sonnet', 'haiku'])
    expect(mergeRules({}).models).toEqual(['fable', 'opus', 'sonnet', 'haiku'])
  })

  test('without a rule the level picks the model', async () => {
    const heavy = decide(spawn('general-purpose', '게시판 구조 설계'), DEFAULT_RULES, { level: true })
    const light = decide(spawn('general-purpose', '파일 이름 찾기'), DEFAULT_RULES, { level: true })
    expect([heavy.source, heavy.tier, heavy.level]).toEqual(['level', 'opus', 3])
    expect([light.source, light.tier, light.level]).toEqual(['level', 'haiku', 1])
  })

  test('with level routing off an unknown type keeps its own model', async () => {
    const d = decide(spawn('general-purpose', '게시판 구조 설계'), DEFAULT_RULES, { level: false })
    expect(d.source).toBe('none')
    expect(d.tier).toBeUndefined()
  })
})

describe('hintFor', () => {
  test('suggests opus for heavy work on a lighter model', async () => {
    expect(hintFor('구조 설계를 다시 짜 줘', 'claude-sonnet-5-5')?.tier).toBe('opus')
  })

  test('stays quiet when the model already fits', async () => {
    expect(hintFor('구조 설계를 다시 짜 줘', 'claude-opus-5-5')).toBeUndefined()
    expect(hintFor('버그 수정', 'claude-sonnet-5-5')).toBeUndefined()
  })

  test('never suggests stepping down from fable for heavy work', async () => {
    expect(hintFor('구조 설계를 다시 짜 줘', 'claude-fable-5-2')).toBeUndefined()
    expect(hintFor('파일 이름 찾기', 'claude-fable-5-2')?.tier).toBe('haiku')
  })

  test('hints follow the models present', async () => {
    const present = ['opus', 'sonnet', 'haiku'] as const
    expect(hintFor('구조 설계를 다시 짜 줘', 'claude-sonnet-5-5', present)?.tier).toBe('opus')
    expect(hintFor('구조 설계를 다시 짜 줘', 'claude-haiku-5-5', ['sonnet', 'haiku'])?.tier).toBe('sonnet')
    expect(hintFor('구조 설계를 다시 짜 줘', 'claude-sonnet-5-5', ['sonnet', 'haiku'])).toBeUndefined()
  })

  test('suggests a lighter model for light work on opus', async () => {
    expect(hintFor('파일 이름 찾기', 'claude-opus-5-5')?.tier).toBe('haiku')
  })
})

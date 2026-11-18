import { describe, expect, test } from 'claude-code/testing'

import { briefFor, DEFAULT_RULES, decide, FABLE_BRIEF, hintFor, mergeRules, modelFor, scoreLevel, TIERS } from '../hooks/route'

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

  test('code review is level 3, so it runs on opus at least', async () => {
    expect(scoreLevel('이 변경 코드 리뷰해 줘').level).toBe(3)
    expect(scoreLevel('코드 검토 부탁해').level).toBe(3)
    expect(scoreLevel('review the diff').level).toBe(3)
    expect(scoreLevel('open the preview page').level).toBe(2)
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

  test('every reviewer type runs on opus at least, rule or not', async () => {
    const tier = (type: string, top = 'fable') =>
      decide(spawn(type, 'x'), { ...DEFAULT_RULES, models: mergeRules({ top }).models }, { level: true }).tier
    for (const type of ['code-reviewer', 'ecc:code-reviewer', 'typescript-reviewer', 'ecc:python-reviewer', 'Code Reviewer']) {
      expect(tier(type)).toBe('opus')
      expect(tier(type, 'opus')).toBe('opus')
    }
    expect(tier('typescript-reviewer', 'sonnet')).toBe('sonnet')
  })

  test('a heavy review steps up to fable; an ordinary one stays on opus', async () => {
    const tier = (type: string, text: string, top = 'fable') =>
      decide(spawn(type, text), { ...DEFAULT_RULES, models: mergeRules({ top }).models }, { level: true })
    expect(tier('code-reviewer', '로그인 버그 수정 리뷰').tier).toBe('opus')
    expect(tier('code-reviewer', '결제 모듈 아키텍처 리뷰').tier).toBe('fable')
    expect(tier('code-reviewer', '결제 모듈 아키텍처 리뷰').why).toContain('아키텍처')
    expect(tier('typescript-reviewer', 'x'.repeat(3001)).tier).toBe('fable')
    expect(tier('general-purpose', '여러 파일에 걸친 코드 리뷰').tier).toBe('fable')
    expect(tier('general-purpose', '여러 파일 수정').tier).toBe('opus')
    expect(tier('code-reviewer', '결제 모듈 아키텍처 리뷰', 'opus').tier).toBe('opus')
  })

  test('a rule may name an up stronger than its best fit; a weaker one is dropped', async () => {
    const types = mergeRules({ types: { a: { best: 'opus', min: 'opus', up: 'fable' }, b: { best: 'opus', up: 'haiku' } } }).types
    expect(types).toEqual({ a: { best: 'opus', min: 'opus', up: 'fable' }, b: { best: 'opus', min: 'opus' } })
  })

  test('a reviewer named in the rules file keeps that rule, heavy or not', async () => {
    const heavy = mergeRules({ types: { 'code-reviewer': 'sonnet' } })
    expect(decide(spawn('code-reviewer', '아키텍처 리뷰'), heavy, { level: true }).tier).toBe('sonnet')
  })

  test('a reviewer named in the rules file keeps that rule', async () => {
    const rules = mergeRules({ types: { 'typescript-reviewer': 'sonnet' } })
    expect(decide(spawn('typescript-reviewer', 'x'), rules, { level: true }).tier).toBe('sonnet')
  })

  const tiersWith = (top: string) => {
    const rules = { ...DEFAULT_RULES, models: mergeRules({ top }).models }
    const tier = (type: string, text = 'x') => decide(spawn(type, text), rules, { level: true }).tier
    return [tier('architect'), tier('planner'), tier('security-reviewer'), tier('code-reviewer'), tier('Explore'), tier('general-purpose', '게시판 구조 설계')]
  }

  test('without fable, opus takes the design role and hands down only what sonnet can do', async () => {
    expect(tiersWith('opus')).toEqual(['opus', 'sonnet', 'opus', 'opus', 'haiku', 'opus'])
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
    expect(hintFor('여러 파일에 걸친 마이그레이션', 'claude-opus-5-5')).toBeUndefined()
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

  test('suggests fable for architecture, root cause and outage work on opus', async () => {
    expect(hintFor('구조 설계를 다시 짜 줘', 'claude-opus-5-5')?.tier).toBe('fable')
    expect(hintFor('로그인 장애 근본 원인 찾아 줘', 'claude-opus-5-5')?.tier).toBe('fable')
    expect(hintFor('find the root cause of the outage', 'claude-opus-5-5')?.tier).toBe('fable')
  })

  test('does not suggest fable when the account has none', async () => {
    expect(hintFor('결제 모듈 아키텍처 결정', 'claude-opus-5-5', ['opus', 'sonnet', 'haiku'])).toBeUndefined()
  })

  test('suggests opus for ordinary edits on fable', async () => {
    expect(hintFor('로그인 버그 수정하고 테스트 추가해 줘', 'claude-fable-5-2')?.tier).toBe('opus')
    expect(hintFor('implement the parser', 'claude-fable-5-2')?.tier).toBe('opus')
  })

  test('stays on fable for fable work, heavy work and prompts with no signal', async () => {
    expect(hintFor('장애 원인 고쳐 줘', 'claude-fable-5-2')).toBeUndefined()
    expect(hintFor('여러 파일에 걸친 마이그레이션', 'claude-fable-5-2')).toBeUndefined()
    expect(hintFor('hello', 'claude-fable-5-2')).toBeUndefined()
  })

  test('sonnet still steps up one model at a time for heavy work', async () => {
    expect(hintFor('결제 모듈 아키텍처 결정', 'claude-sonnet-5-5')?.tier).toBe('opus')
  })
})

describe('briefFor', () => {
  test('a thread below fable that can start agents is told when to hand work to fable', async () => {
    expect(briefFor('claude-opus-5-5', ['Agent', 'Read'], TIERS)).toBe(FABLE_BRIEF)
    expect(briefFor('claude-sonnet-5-5', ['Agent'], TIERS)).toBe(FABLE_BRIEF)
    expect(FABLE_BRIEF.text).toContain('model: "fable"')
  })

  test('no brief on fable, without the Agent tool, or on an account without fable', async () => {
    expect(briefFor('claude-fable-5-2', ['Agent'], TIERS)).toBeUndefined()
    expect(briefFor('claude-opus-5-5', ['Read', 'Edit'], TIERS)).toBeUndefined()
    expect(briefFor('claude-opus-5-5', ['Agent'], ['opus', 'sonnet', 'haiku'])).toBeUndefined()
  })
})

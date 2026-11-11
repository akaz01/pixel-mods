import type { Level, Limits, Source, Tier } from '../types'

// What a role asks of a model: best is the model whose strengths fit the work, min the weakest one that can still
// do it well. Deep multi-step judgement is fable's, planning and hard analysis opus's, writing and reviewing code
// sonnet's, fast lookups haiku's.
export type Role = { best: Tier; min: Tier }

// models lists the ones present, from the rules file's "top" model down.
export type Rules = { types: Record<string, Role>; limits: Limits; models: readonly Tier[] }

export type SpawnFacts = { subagentType: string; description: string; prompt: string; model?: string }

export type Choice = { source: Source; why: string; level?: Level; tier?: Tier }

// Strongest first: the order roles are handed out in.
export const TIERS: readonly Tier[] = ['fable', 'opus', 'sonnet', 'haiku']

const only = (tier: Tier): Role => ({ best: tier, min: tier })

export const LEVEL_ROLE: Record<Level, Role> = { 1: only('haiku'), 2: only('sonnet'), 3: only('opus') }

const DESIGN: Role = { best: 'fable', min: 'opus' }
const PLANNING: Role = { best: 'opus', min: 'sonnet' }

export const DEFAULT_RULES: Rules = {
  types: {
    architect: DESIGN,
    'ecc:architect': DESIGN,
    planner: PLANNING,
    'ecc:planner': PLANNING,
    'security-reviewer': only('opus'),
    'ecc:security-reviewer': only('opus'),
    'code-reviewer': only('sonnet'),
    'ecc:code-reviewer': only('sonnet'),
    'tdd-guide': only('sonnet'),
    'ecc:tdd-guide': only('sonnet'),
    Explore: only('haiku'),
  },
  limits: { concurrent: 4, background: 2 },
  models: TIERS,
}

// A role runs on its best model when that one is present, else on the strongest one that is. A model standing in
// for a missing stronger one hands its own roles down as far as their min allows, and no further: a role never
// drops to a model that cannot do it just because the one above went missing.
export const modelFor = (role: Role, models: readonly Tier[]): Tier => {
  const top = models[0] ?? role.best
  if (!models.includes(role.best)) return top
  return role.best === top && top !== TIERS[0] ? role.min : role.best
}

// Korean is matched as a substring (no word boundaries), English on word boundaries.
// Level 3's words are the clear ones; everyday words that only sometimes mean a big task live in WEAK_L3.
const SIGNALS: Record<Level, { ko: readonly string[]; en: RegExp }> = {
  3: {
    ko: ['설계', '아키텍처', '여러 파일', '근본 원인', '보안 취약', '보안 점검', '마이그레이션'],
    en: /\b(architect(?:ure)?|multi-?file|multiple files|across files|root cause|security (?:review|audit)|vulnerabilit\w*|migration)\b/gi,
  },
  2: {
    ko: ['수정', '고쳐', '구현', '추가', '테스트', '리뷰', '리팩터', '버그'],
    en: /\b(fix|implement|add|test|review|refactor|bug|update|edit)\w*/gi,
  },
  1: {
    ko: ['찾', '검색', '목록', '요약', '이름', '개수', '위치'],
    en: /\b(find|search|list|summar\w*|rename|locate|count|grep|look up)\b/gi,
  },
}

// "구조체 이름 찾기" is not an architecture task: these count toward level 3 only two at a time.
const WEAK_L3 = { ko: ['구조', '원인', '보안'], en: /\b(design|security|structure)\b/gi }

const LONG_TASK = 3000

export const scoreLevel = (text: string): { level: Level; words: string[] } => {
  const weak = [...new Set([...WEAK_L3.ko.filter(word => text.includes(word)), ...[...text.matchAll(WEAK_L3.en)].map(m => m[0].toLowerCase())])]
  if (weak.length >= 2) return { level: 3, words: weak.slice(0, 3) }
  for (const level of [3, 2, 1] as const) {
    const { ko, en } = SIGNALS[level]
    const words = [...ko.filter(word => text.includes(word)), ...[...text.matchAll(en)].map(m => m[0].toLowerCase())]
    if (words.length > 0) {
      const bumped = level < 2 && text.length > LONG_TASK ? 2 : level
      return { level: bumped, words: [...new Set(words)].slice(0, 3) }
    }
  }
  return { level: text.length > LONG_TASK ? 3 : 2, words: [] }
}

export const tierOf = (model: string | undefined): Tier | undefined =>
  model ? TIERS.find(tier => model.toLowerCase().includes(tier)) : undefined

const quote = (words: string[]): string => (words.length ? words.map(w => `"${w}"`).join(', ') : 'no signal')

export const decide = (facts: SpawnFacts, rules: Rules, options: { level: boolean }): Choice => {
  if (facts.model) return { source: 'explicit', why: `explicit ${facts.model}` }
  const ruled = rules.types[facts.subagentType]
  if (ruled) return { source: 'rule', why: 'rule', tier: modelFor(ruled, rules.models) }
  if (!options.level) return { source: 'none', why: 'no rule' }
  const scored = scoreLevel(`${facts.description}\n${facts.prompt}`)
  return { source: 'level', why: quote(scored.words), level: scored.level, tier: modelFor(LEVEL_ROLE[scored.level], rules.models) }
}

// Heavy work on a model weaker than the one it asks for gets a hint up; light work on opus or stronger a hint down.
export const hintFor = (text: string, model: string, models: readonly Tier[] = TIERS): { tier: Tier; why: string } | undefined => {
  const scored = scoreLevel(text)
  const current = tierOf(model)
  const at = current ? TIERS.indexOf(current) : TIERS.length
  const seat = modelFor(LEVEL_ROLE[scored.level], models)
  if (scored.level === 3 && TIERS.indexOf(seat) < at) return { tier: seat, why: quote(scored.words) }
  if (scored.level === 1 && current && at <= TIERS.indexOf('opus') && seat !== current) return { tier: seat, why: quote(scored.words) }
  return undefined
}

const isTier = (value: unknown): value is Tier => typeof value === 'string' && (TIERS as readonly string[]).includes(value)

// A rule is a model name (best and min alike) or { best, min }; a min stronger than the best fit is the best fit.
const roleOf = (value: unknown): Role | undefined => {
  if (isTier(value)) return only(value)
  if (typeof value !== 'object' || value === null) return undefined
  const { best, min } = value as { best?: unknown; min?: unknown }
  if (!isTier(best)) return undefined
  return { best, min: isTier(min) && TIERS.indexOf(min) > TIERS.indexOf(best) ? min : best }
}

// Models go missing from the top only: the strongest one the account has, and every model under it.
const modelsFrom = (top: unknown): readonly Tier[] => (isTier(top) ? TIERS.slice(TIERS.indexOf(top)) : DEFAULT_RULES.models)

const positive = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback

// Reads rules.json loosely: a bad entry is dropped, a missing part keeps the default.
export const mergeRules = (raw: unknown): Rules => {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_RULES
  const given = raw as { types?: unknown; limits?: { concurrent?: unknown; background?: unknown }; top?: unknown }
  const types =
    typeof given.types === 'object' && given.types !== null
      ? Object.fromEntries(Object.entries(given.types).flatMap(([type, value]) => {
          const role = roleOf(value)
          return role ? [[type, role] as const] : []
        }))
      : DEFAULT_RULES.types
  return {
    types,
    limits: {
      concurrent: positive(given.limits?.concurrent, DEFAULT_RULES.limits.concurrent),
      background: positive(given.limits?.background, DEFAULT_RULES.limits.background),
    },
    models: modelsFrom(given.top),
  }
}

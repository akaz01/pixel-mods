import type { Level, Limits, Source, Tier } from '../types'

export type Rules = { types: Record<string, Tier>; limits: Limits }

export type SpawnFacts = { subagentType: string; description: string; prompt: string; model?: string }

export type Choice = { source: Source; why: string; level?: Level; tier?: Tier }

export const TIERS: readonly Tier[] = ['haiku', 'sonnet', 'opus']

export const LEVEL_TIER: Record<Level, Tier> = { 1: 'haiku', 2: 'sonnet', 3: 'opus' }

export const DEFAULT_RULES: Rules = {
  types: {
    Explore: 'haiku',
    'code-reviewer': 'sonnet',
    'ecc:code-reviewer': 'sonnet',
    'tdd-guide': 'sonnet',
    'ecc:tdd-guide': 'sonnet',
    architect: 'opus',
    'ecc:architect': 'opus',
    planner: 'opus',
    'ecc:planner': 'opus',
  },
  limits: { concurrent: 4, background: 2 },
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
  if (ruled) return { source: 'rule', why: 'rule', tier: ruled }
  if (!options.level) return { source: 'none', why: 'no rule' }
  const scored = scoreLevel(`${facts.description}\n${facts.prompt}`)
  return { source: 'level', why: quote(scored.words), level: scored.level, tier: LEVEL_TIER[scored.level] }
}

export const hintFor = (text: string, model: string): { tier: Tier; why: string } | undefined => {
  const scored = scoreLevel(text)
  const current = tierOf(model)
  if (scored.level === 3 && current !== 'opus') return { tier: 'opus', why: quote(scored.words) }
  if (scored.level === 1 && current === 'opus') return { tier: 'haiku', why: quote(scored.words) }
  return undefined
}

const isTier = (value: unknown): value is Tier => typeof value === 'string' && (TIERS as readonly string[]).includes(value)

const positive = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback

// Reads rules.json loosely: a bad entry is dropped, a missing part keeps the default.
export const mergeRules = (raw: unknown): Rules => {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_RULES
  const given = raw as { types?: unknown; limits?: { concurrent?: unknown; background?: unknown } }
  const types =
    typeof given.types === 'object' && given.types !== null
      ? Object.fromEntries(Object.entries(given.types).filter((entry): entry is [string, Tier] => isTier(entry[1])))
      : DEFAULT_RULES.types
  return {
    types,
    limits: {
      concurrent: positive(given.limits?.concurrent, DEFAULT_RULES.limits.concurrent),
      background: positive(given.limits?.background, DEFAULT_RULES.limits.background),
    },
  }
}

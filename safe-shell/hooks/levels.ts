import type { Level } from '../types'

export type Rule = {
  level: Level
  pattern: RegExp
  reason: string
  alternative?: string
}

export type Verdict = Omit<Rule, 'pattern'> & { match: string }

const RANK: Record<Level, number> = { caution: 1, danger: 2, forbidden: 3 }

// One shell segment: stops at a pipe, a separator or a newline.
const SEG = String.raw`[^|;&\n]*`
const END = String.raw`(?=[\s"'|;&)]|$)`
// An optional opening or closing quote around a path.
const Q = String.raw`["']?`
// Any run of options: short clusters (-rf), long options (--no-preserve-root) and the bare -- end marker.
const OPTS = String.raw`(?:(?:-[a-zA-Z]+|--[a-z][a-z-]*|--)\s+)*`
// The recursive switch in either spelling.
const RECURSIVE = String.raw`(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)`
// Root, home or a drive root, with an optional trailing slash and wildcard.
const UNIX_ROOT = String.raw`(?:\/\*?|~(?:\/\*?)?|\$\{?HOME\}?(?:\/\*?)?|[A-Za-z]:[\\/]?\*?)`
// git's own options before the subcommand: -C <dir>, -c <key=value>.
const GIT_OPTS = String.raw`(?:-[cC]\s+\S+\s+)*`
const WIN_ROOT =String.raw`(?:[A-Za-z]:\\?\*?|[A-Za-z]:\\Users\\[^\\\s"']+\\?\*?|\$env:USERPROFILE\\?\*?|~\\?\*?|\$HOME\\?\*?)`

export const RULES: readonly Rule[] = [
  {
    level: 'forbidden',
    pattern: new RegExp(String.raw`\brm\s+${OPTS}${RECURSIVE}\s+${OPTS}${Q}${UNIX_ROOT}${Q}${END}`),
    reason: 'deletes the root or home folder.',
  },
  {
    level: 'forbidden',
    pattern: new RegExp(String.raw`\b(?:Remove-Item|ri|rmdir|rd|del|erase)\b${SEG}?\s(?:-(?:Literal)?Path\s+)?${Q}${WIN_ROOT}${Q}${END}`, 'i'),
    reason: 'deletes a drive root or the user folder.',
  },
  { level: 'forbidden', pattern: /\bformat\s+[A-Za-z]:/i, reason: 'formats a drive.' },
  { level: 'forbidden', pattern: /\bmkfs(?:\.\w+)?\b|\bdd\b[^|;&\n]*\bof=\/dev\//, reason: 'overwrites a disk.' },
  {
    level: 'danger',
    pattern: new RegExp(String.raw`\bgit\s+${GIT_OPTS}reset\s+${SEG}--hard\b`),
    reason: 'drops every uncommitted change.',
    alternative: 'git stash push -m "backup"',
  },
  {
    level: 'danger',
    pattern: new RegExp(String.raw`\bgit\s+${GIT_OPTS}push\b${SEG}\s(?:--force(?!-with-lease)\b|-f\b|\+[\w/.-]+)`),
    reason: 'overwrites remote history.',
    alternative: 'git push --force-with-lease',
  },
  {
    level: 'danger',
    pattern: new RegExp(String.raw`\bgit\s+${GIT_OPTS}clean\b${SEG}\s(?:-[a-zA-Z]*f|--force\b)`),
    reason: 'deletes untracked files.',
    alternative: 'git clean -n (preview first)',
  },
  {
    level: 'danger',
    pattern: new RegExp(String.raw`\bgit\s+${GIT_OPTS}(?:checkout\s+(?:(?:-f|--force)\b|(?:--\s+)?\.(?=[\s"']|$))|restore\s+(?![^|;&\n]*--staged)(?:--\S+\s+)*(?:\.|:\/)(?=[\s"']|$))`),
    reason: 'discards unstaged edits.',
    alternative: 'git stash push -m "backup"',
  },
  {
    level: 'danger',
    pattern: /\bdrop\s+(?:table|database|schema)\b/i,
    reason: 'drops database objects.',
    alternative: 'take a backup first',
  },
  { level: 'caution', pattern: /\brm\s+(?:(?:-[a-zA-Z]+|--[a-z][a-z-]*)\s+)*(?:-[a-zA-Z]*[rR]|--recursive\b)/, reason: 'deletes a whole folder.' },
  { level: 'caution', pattern: new RegExp(String.raw`\b(?:Remove-Item|ri)\b${SEG}-Recurse\b`, 'i'), reason: 'deletes a whole folder.' },
  { level: 'caution', pattern: /\b(?:rmdir|rd)\s+\/s\b/i, reason: 'deletes a whole folder.' },
  { level: 'caution', pattern: new RegExp(String.raw`\bgit\s+branch\s+${SEG}?-D\b`), reason: 'force-deletes a branch.' },
  { level: 'caution', pattern: new RegExp(String.raw`\bgit\s+push\b${SEG}--force-with-lease\b`), reason: 'rewrites remote history (with lease).' },
]

// Text that is only printed or stored, never run: what follows echo/printf/Write-Host and a commit message.
// DANGER and CAUTION rules skip it, so `git commit -m "drop table users"` runs; FORBIDDEN rules still see everything.
const SPOKEN = /(\b(?:echo|printf|Write-Host|Write-Output)\s+|\s(?:-m|--message)(?:=|\s+))("[^"]*"|'[^']*')/gi
export const withoutSpokenText = (command: string): string => command.replace(SPOKEN, '$1""')

export const classify = (command: string): Verdict | undefined => {
  const runText = withoutSpokenText(command)
  let best: Verdict | undefined
  for (const rule of RULES) {
    const found = rule.pattern.exec(rule.level === 'forbidden' ? command : runText)
    if (!found) continue
    if (best && RANK[best.level] >= RANK[rule.level]) continue
    best = { level: rule.level, reason: rule.reason, alternative: rule.alternative, match: found[0].trim() }
  }
  return best
}

// Global copies of the DANGER patterns, so every match is counted, not just every rule.
const DANGER_GLOBAL: readonly RegExp[] = RULES.filter(rule => rule.level === 'danger').map(
  rule => new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`),
)

// How many dangerous steps a command holds: allow-once lets through one, not a chain of them.
export const dangerCount = (command: string): number => {
  const runText = withoutSpokenText(command)
  return DANGER_GLOBAL.reduce((total, re) => total + [...runText.matchAll(re)].length, 0)
}

// Kept short on purpose: a deny reason is sent to the model.
export const denyText = (verdict: Verdict): string => {
  const head = `safe-shell ${verdict.level.toUpperCase()}: ${verdict.reason}`
  if (verdict.level === 'forbidden') return `${head} Always blocked.`
  const instead = verdict.alternative ? ` Try: ${verdict.alternative}.` : ''
  return `${head}${instead} The user can run /allow-once to let it through once.`
}

export const describeRules = (): string =>
  (['forbidden', 'danger', 'caution'] as const)
    .map(level => {
      const reasons = [...new Set(RULES.filter(rule => rule.level === level).map(rule => rule.reason))]
      return `${level.toUpperCase().padEnd(9)} ${reasons.join(' · ')}`
    })
    .join('\n')

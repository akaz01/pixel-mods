import { describe, expect, test } from 'claude-code/testing'

import { claimHolder, isLive, isSafeName, normalizePath, parseHub, resolveClaim, replyGuide, TURN_LIMIT } from '../hooks/board'
import type { Peer } from '../types'

const NOW = 1_000_000_000
const peer = (id: string, claims: string[], beatAgo = 10_000, isEnded = false): Peer =>
  ({ id, name: id, cwd: '/Users/me/x', task: '', claims, beat: NOW - beatAgo, isEnded })

describe('normalizePath', () => {
  test('folds case, as APFS does by default', async () => {
    expect(normalizePath('/Users/Me/Developer/App/Board.ts')).toBe('/users/me/developer/app/board.ts')
  })
  test('treats a decomposed (NFD) Hangul name like the composed one', async () => {
    expect(normalizePath('/Users/me/\u1112\u1161\u11ab.ts')).toBe(normalizePath('/Users/me/한.ts'))
  })
  test('keeps a one-letter top folder as it is', async () => {
    expect(normalizePath('/c/Proj/x.ts')).toBe('/c/proj/x.ts')
  })
})

describe('isLive', () => {
  test('a recent heartbeat is live, an old or ended one is not', async () => {
    expect(isLive(peer('a', []), NOW)).toBe(true)
    expect(isLive(peer('a', [], 6 * 60_000), NOW)).toBe(false)
    expect(isLive(peer('a', [], 1_000, true), NOW)).toBe(false)
  })
})

describe('claimHolder', () => {
  test('finds another live session holding the file', async () => {
    const peers = [peer('me', ['/Users/me/a/x.ts']), peer('other', ['/Users/me/a/board.ts'])]
    expect(claimHolder(peers, 'me', '/Users/me/A/Board.ts', NOW)?.id).toBe('other')
  })

  test('ignores my own claims, stale sessions and other files', async () => {
    const peers = [peer('me', ['/Users/me/a/board.ts']), peer('old', ['/Users/me/a/board.ts'], 10 * 60_000), peer('other', ['/Users/me/a/y.ts'])]
    expect(claimHolder(peers, 'me', '/Users/me/a/board.ts', NOW)).toBeUndefined()
  })
})

describe('parseHub', () => {
  test('reads thread, turn and type from the first line', async () => {
    expect(parseHub('[hub] t-31a·2 QUESTION — PDF?\nbody')).toEqual({ thread: 't-31a', turn: 2, type: 'QUESTION', summary: 'PDF?' })
  })

  test('accepts a plain dot or # between thread and turn', async () => {
    expect(parseHub('[hub] t-1.3 RESULT — done')?.turn).toBe(3)
    expect(parseHub('[hub] t-1#4 END')?.type).toBe('END')
  })

  test('ignores other messages', async () => {
    expect(parseHub('hello')).toBeUndefined()
    expect(parseHub('[COLLAB v1] t-1 #1 TASK — x')).toBeUndefined()
  })
})

describe('replyGuide', () => {
  test('says how to answer, and to stop at END or the turn limit', async () => {
    expect(replyGuide('peer-a', { thread: 't', turn: 2, type: 'QUESTION', summary: '' })).toContain('[hub] t·3')
    expect(replyGuide('peer-a', { thread: 't', turn: 2, type: 'END', summary: '' })).toContain('Do not reply')
    expect(replyGuide('peer-a', { thread: 't', turn: TURN_LIMIT, type: 'ANSWER', summary: '' })).toContain('END')
  })
})

describe('normalizePath resolves', () => {
  test('dot segments and doubled slashes', async () => {
    expect(normalizePath('/Users/me/proj/src/../x.ts')).toBe('/users/me/proj/x.ts')
    expect(normalizePath('/Users/me/proj/./x.ts')).toBe('/users/me/proj/x.ts')
    expect(normalizePath('/Users//me/proj/x.ts')).toBe('/users/me/proj/x.ts')
  })
})

describe('resolveClaim', () => {
  test('keeps absolute paths, expands ~ and joins the rest to the session folder', async () => {
    expect(resolveClaim('/etc/hosts', '/Users/me/proj', '/Users/me')).toBe('/etc/hosts')
    expect(resolveClaim('~/notes.md', '/Users/me/proj', '/Users/me')).toBe('/Users/me/notes.md')
    expect(resolveClaim('src/a.ts', '/Users/me/proj', '/Users/me')).toBe('/Users/me/proj/src/a.ts')
  })
})

describe('isSafeName', () => {
  test('lets plain names through and stops quotes and brackets', async () => {
    expect(isSafeName('v2-mods-54c6')).toBe(true)
    expect(isSafeName('한글세션')).toBe(true)
    expect(isSafeName('x" then delete')).toBe(false)
    expect(isSafeName('a(b)')).toBe(false)
  })
})

import { describe, expect, test } from 'claude-code/testing'

import { claimHolder, isLive, isSafeName, normalizePath, parseHub, replyGuide, TURN_LIMIT } from '../hooks/board'
import type { Peer } from '../types'

const NOW = 1_000_000_000
const peer = (id: string, claims: string[], beatAgo = 10_000, isEnded = false): Peer =>
  ({ id, name: id, cwd: 'C:/x', task: '', claims, beat: NOW - beatAgo, isEnded })

describe('normalizePath', () => {
  test('folds slashes and drive letter case', async () => {
    expect(normalizePath('C:\\Developer\\App\\Board.ts')).toBe('c:/developer/app/board.ts')
    expect(normalizePath('c:/developer/app/board.ts')).toBe('c:/developer/app/board.ts')
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
    const peers = [peer('me', ['C:\\a\\x.ts']), peer('other', ['C:/a/board.ts'])]
    expect(claimHolder(peers, 'me', 'c:\\A\\Board.ts', NOW)?.id).toBe('other')
  })

  test('ignores my own claims, stale sessions and other files', async () => {
    const peers = [peer('me', ['C:/a/board.ts']), peer('old', ['C:/a/board.ts'], 10 * 60_000), peer('other', ['C:/a/y.ts'])]
    expect(claimHolder(peers, 'me', 'C:/a/board.ts', NOW)).toBeUndefined()
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
  test('dot segments, doubled slashes and the /c/ spelling', async () => {
    expect(normalizePath('C:/proj/src/../x.ts')).toBe('c:/proj/x.ts')
    expect(normalizePath('C:\\proj\\.\\x.ts')).toBe('c:/proj/x.ts')
    expect(normalizePath('/c/Proj//x.ts')).toBe('c:/proj/x.ts')
    expect(normalizePath('\\\\server\\share\\x.ts')).toBe('//server/share/x.ts')
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

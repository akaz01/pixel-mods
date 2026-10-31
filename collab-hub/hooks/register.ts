import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { boardText, claimHolder, isSafeName, normalizePath, parseHub, replyGuide, requestPrompt, threadId } from './board'
import type { Hub } from './board'
import type { Notice, Peer, Thread } from '../types'

const BEAT_MS = 60_000
const POLL_MS = 30_000
const KEEP_NOTICES = 10
const KEEP_THREADS = 10
const NOTICE_TTL_MS = 24 * 3600_000

const me = atom({ plugin: 'collab-hub', key: 'me' } as const, null as Peer | null)
const peers = atom({ plugin: 'collab-hub', key: 'peers' } as const, [] as Peer[])
const notices = atom({ plugin: 'collab-hub', key: 'notices' } as const, [] as Notice[])
const threads = atom({ plugin: 'collab-hub', key: 'threads' } as const, [] as Thread[])

let home = ''
const dir = (part: 'sessions' | 'notices') => `${home}/.claude/collab-hub/${part}`

const quietly = async ($: EngineInterface, what: string, work: () => Promise<unknown>): Promise<void> => {
  try {
    await work()
  } catch (error) {
    $.ui.log(`collab-hub: ${what} failed (${String(error)})`)
  }
}

const short = (text: string, room = 40) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > room ? `${flat.slice(0, room - 1)}…` : flat
}

let writing: Promise<unknown> = Promise.resolve()

const saveMe = ($: EngineInterface, change: (p: Peer) => Peer = p => p): Promise<void> => {
  const run = writing.then(async () => {
    await update($, me, p => (p ? change({ ...p, beat: Date.now() }) : p))
    const self = await read($, me)
    if (self && home) await $.fs.write(`${dir('sessions')}/${self.id}.json`, JSON.stringify(self))
  })
  writing = run.catch(() => undefined)
  return run
}

const NO_HOME = 'collab-hub: no home folder (USERPROFILE/HOME), so the shared board is off.'

const readJson = async <T>($: EngineInterface, path: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await $.fs.read(path)) as T
  } catch {
    return undefined
  }
}

const listDir = async ($: EngineInterface, path: string) => ((await $.fs.exists(path)) ? $.fs.list(path) : [])

// A session file that has not been written for this long belongs to a session long gone: not even read.
const SESSION_TTL_MS = 24 * 3600_000

// Another session's file is not trusted: a malformed one is dropped instead of breaking the claim check.
const isPeer = (value: unknown): value is Peer => {
  const p = value as Peer | undefined
  return !!p && typeof p.id === 'string' && typeof p.name === 'string' && isSafeName(p.name) && typeof p.beat === 'number' && Array.isArray(p.claims) && p.claims.every(c => typeof c === 'string')
}

// A notice file is shared too: its fields reach the toast, so the shape is checked.
const isNotice = (value: unknown): value is Notice => {
  const n = value as Notice | undefined
  return !!n && typeof n.id === 'string' && typeof n.at === 'number' && typeof n.from === 'string' && typeof n.text === 'string'
}

let hasPolled = false

const poll = async ($: EngineInterface) => {
  const now = Date.now()
  const sessionFiles = (await listDir($, dir('sessions'))).filter(f => f.name.endsWith('.json') && now - f.mtimeMs < SESSION_TTL_MS)
  const found = (await Promise.all(sessionFiles.map(f => readJson<unknown>($, `${dir('sessions')}/${f.name}`)))).filter(isPeer)
  await update($, peers, () => found)
  const noticeFiles = (await listDir($, dir('notices')))
    .filter(f => f.name.endsWith('.json') && now - f.mtimeMs < NOTICE_TTL_MS)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, KEEP_NOTICES)
  const fresh = (await Promise.all(noticeFiles.map(f => readJson<unknown>($, `${dir('notices')}/${f.name}`)))).filter(isNotice)
  const seen = new Set((await read($, notices)).map(n => n.id))
  const self = await read($, me)
  if (hasPolled) {
    for (const n of fresh) {
      if (!seen.has(n.id) && !(self && n.id.endsWith(self.id))) $.ui.toast(`collab-hub · notice from ${n.from}: ${short(n.text, 60)}`)
    }
  }
  hasPolled = true
  await update($, notices, () => fresh)
}

const noteThread = async ($: EngineInterface, hub: Hub, peer: string, isMine: boolean) =>
  update($, threads, list => {
    const rest = list.filter(t => t.id !== hub.thread)
    return [...rest, { id: hub.thread, peer, turn: hub.turn, type: hub.type, at: Date.now(), isMine }].slice(-KEEP_THREADS)
  })

const runCollab = async ($: EngineInterface, args: string): Promise<string> => {
  const text = args.trim()
  if (!home) return NO_HOME
  if (!text) {
    await poll($)
    return boardText(await read($, me), await read($, peers), Date.now())
  }
  const [first = '', ...rest] = text.split(/\s+/)
  if (first === 'name' && rest.length) {
    const name = rest.join('-')
    if (!isSafeName(name)) return 'collab-hub: use letters, digits, Hangul, . _ @ - (up to 40).'
    await saveMe($, p => ({ ...p, name }))
    return `collab-hub: this session is now "${name}".`
  }
  if (!rest.length) return 'Usage: /collab | /collab name <name> | /collab <session> <task>'
  const thread = threadId()
  await noteThread($, { thread, turn: 1, type: 'REQUEST', summary: '' }, first, true)
  await $.prompt.submit({ text: requestPrompt(first, rest.join(' '), thread) } as never)
  return `collab-hub: REQUEST ${thread} → ${first} queued.`
}

const claimCommand = async ($: EngineInterface, file: string, isClaim: boolean): Promise<string> => {
  if (!home) return NO_HOME
  if (!file.trim()) return isClaim ? 'Usage: /claim <file>' : 'Usage: /release <file> | all'
  if (!isClaim && file.trim().toLowerCase() === 'all') {
    const count = (await read($, me))?.claims.length ?? 0
    await saveMe($, p => ({ ...p, claims: [] }))
    return `collab-hub: released all ${count} claimed file(s).`
  }
  const cwd = await $.session.cwd()
  const path = /^[A-Za-z]:[\\/]|^[\\/]/.test(file.trim()) ? file.trim() : `${cwd}/${file.trim()}`
  const target = normalizePath(path)
  await saveMe($, p => ({
    ...p,
    claims: isClaim ? [...p.claims.filter(c => normalizePath(c) !== target), path] : p.claims.filter(c => normalizePath(c) !== target),
  }))
  return `collab-hub: ${isClaim ? 'claimed' : 'released'} ${path.split(/[\\/]/).pop()}.`
}

const guardEdit = async ($: EngineInterface, file: string): Promise<string | undefined> => {
  const self = await read($, me)
  if (!self) return undefined
  const holder = claimHolder(await read($, peers), self.id, file, Date.now())
  if (!holder) return undefined
  const since = new Date(holder.beat).toTimeString().slice(0, 5)
  $.ui.toast(`collab-hub · ${file.split(/[\\/]/).pop()} is claimed by ${holder.name}`)
  return `collab-hub: this file is claimed by session "${holder.name}" (seen ${since}). Ask them first (/collab) or wait for /release.`
}

const COMMANDS = [
  { name: 'collab', description: 'Session board, or send a [hub] request: /collab <session> <task>', argumentHint: '[name <name> | <session> <task>]' },
  { name: 'notice', description: 'Post a notice to every session on this PC', argumentHint: '<text>' },
  { name: 'claim', description: 'Mark a file as being edited by this session', argumentHint: '<file>' },
  { name: 'release', description: 'Release a claimed file, or all of them', argumentHint: '<file> | all' },
]

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
    const [id, cwd] = await Promise.all([$.session.id(), $.session.cwd()])
    const name = cwd.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? 'session'
    await update($, me, () => ({ id, name: `${name}-${id.slice(0, 4)}`, cwd, task: '', claims: [], beat: Date.now(), isEnded: false }))
    for (const command of COMMANDS) await $.command.register(command)
    if (home) {
      await quietly($, 'heartbeat', () => saveMe($))
      await quietly($, 'board read', () => poll($))
      $.clock.every(BEAT_MS, () => void quietly($, 'heartbeat', () => saveMe($)))
      $.clock.every(POLL_MS, () => void quietly($, 'board read', () => poll($)))
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await quietly($, 'sign-off', () => saveMe($, p => ({ ...p, isEnded: true })))
    return next(e)
  })

  on('command.run', { command: 'collab' }, async ($, e) => ({ text: await runCollab($, e.args) }))
  on('command.run', { command: 'claim' }, async ($, e) => ({ text: await claimCommand($, e.args, true) }))
  on('command.run', { command: 'release' }, async ($, e) => ({ text: await claimCommand($, e.args, false) }))
  on('command.run', { command: 'notice' }, async ($, e) => {
    const self = await read($, me)
    const text = e.args.trim()
    if (!home) return { text: NO_HOME }
    if (!text || !self) return { text: 'Usage: /notice <text>' }
    const at = Date.now()
    await $.fs.write(`${dir('notices')}/${at}-${self.id.slice(0, 8)}.json`, JSON.stringify({ id: `${at}-${self.id}`, at, from: self.name, text }))
    await quietly($, 'board read', () => poll($))
    return { text: `collab-hub: notice posted to every session on this PC.` }
  })

  // Keeps the board's "task" current without storing the prompt itself.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer' && !e.text.startsWith('/')) {
      await quietly($, 'task update', () => saveMe($, p => ({ ...p, task: short(e.text) })))
    }
    return next(e)
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const why = await guardEdit($, e.file_path)
    return why ? { deny: why } : next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const why = await guardEdit($, e.file_path)
    return why ? { deny: why } : next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const why = await guardEdit($, e.notebook_path)
    return why ? { deny: why } : next(e)
  }).catch(($, e, next) => next(e))

  on('session.receive', async ($, e, next) => {
    const body = e.text.replace(/^<cross-session-message[^>]*>\s*/, '')
    const hub = parseHub(body)
    if (!hub) return next(e)
    const from = /from="([^"]+)"/.exec(e.text)?.[1] ?? 'peer'
    if (!isSafeName(from) || !isSafeName(hub.thread)) return next(e)
    $.ui.toast(`collab-hub · [hub] ${hub.thread}·${hub.turn} ${hub.type} from ${from}`)
    await noteThread($, hub, from, false)
    return next({ ...e, text: `${e.text}\n${replyGuide(from, hub)}` })
  })

  on('session.send', async ($, e, next) => {
    const hub = parseHub(e.text)
    if (hub) await noteThread($, hub, e.to, true)
    return next(e)
  })
}

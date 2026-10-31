export type HubType = 'REQUEST' | 'QUESTION' | 'ANSWER' | 'RESULT' | 'DECLINE' | 'END'

export type Peer = {
  id: string
  name: string
  cwd: string
  task: string
  claims: string[]
  beat: number
  isEnded: boolean
}

export type Notice = { id: string; at: number; from: string; text: string }

export type Thread = { id: string; peer: string; turn: number; type: HubType; at: number; isMine: boolean }

declare module 'claude-code' {
  interface PluginState {
    'collab-hub': {
      me: Peer | null
      peers: Peer[]
      notices: Notice[]
      threads: Thread[]
    }
  }
}

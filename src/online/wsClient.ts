export type OnlineRole = 'white' | 'black'

export type WsStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export type OnlineSession = {
  gameId: string
  playerToken: string
  role: OnlineRole
}

export type ServerMessage =
  | {
      type: 'game_created'
      payload: { gameId: string; role: OnlineRole; playerToken: string }
    }
  | {
      type: 'game_joined'
      payload: { gameId: string; role: OnlineRole; playerToken: string }
    }
  | {
      type: 'reconnected'
      payload: { gameId: string; role: OnlineRole }
    }
  | {
      type: 'move_ack'
      payload: { clientMoveId?: string }
    }
  | {
      type: 'opponent_move'
      payload: { from: string; to: string; promotion?: string; clientMoveId?: string }
    }
  | {
      type: 'state_sync'
      payload: { fen: string }
    }
  | {
      type: 'opponent_chat'
      payload: { message: string }
    }
  | {
      type: 'opponent_joined'
      payload: Record<string, never>
    }
  | {
      type: 'opponent_left'
      payload: Record<string, never>
    }
  | {
      type: 'error'
      payload: { code: string; message: string }
    }

type ServerMessageType = ServerMessage['type']

type PayloadFor<T extends ServerMessageType> = Extract<ServerMessage, { type: T }>['payload']

type StatusHandler = (status: WsStatus, info?: { reason?: string; code?: number }) => void

const STORAGE_KEY = 'vibeChess.online.session'
const MAX_RECONNECT_ATTEMPTS = 5
const DISCONNECTED_POLL_INTERVAL = 5000
const MAX_MESSAGE_SIZE = 4 * 1024

const hasLocalStorage = () => {
  try {
    return typeof window !== 'undefined' && Boolean(window.localStorage)
  } catch {
    return false
  }
}

const loadSession = (): OnlineSession | null => {
  if (!hasLocalStorage()) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<OnlineSession>
    if (
      parsed &&
      typeof parsed.gameId === 'string' &&
      typeof parsed.playerToken === 'string' &&
      (parsed.role === 'white' || parsed.role === 'black')
    ) {
      return parsed as OnlineSession
    }
  } catch {
    return null
  }
  return null
}

const persistSession = (session: OnlineSession | null) => {
  if (!hasLocalStorage()) return
  try {
    if (!session) {
      window.localStorage.removeItem(STORAGE_KEY)
      return
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    // Ignore storage failures.
  }
}

export class WsClient {
  private socket: WebSocket | null = null
  private url: string | null = null
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private disconnectedTimer: ReturnType<typeof setTimeout> | null = null
  private forcedClose = false
  private status: WsStatus = 'idle'
  private queue: string[] = []
  private session: OnlineSession | null = loadSession()
  private handlers: Partial<Record<ServerMessageType, Set<(payload: never) => void>>> = {}
  private statusHandlers = new Set<StatusHandler>()

  getSession() {
    return this.session
  }

  clearSession() {
    this.session = null
    persistSession(null)
  }

  onStatus(handler: StatusHandler) {
    this.statusHandlers.add(handler)
    return () => {
      this.statusHandlers.delete(handler)
    }
  }

  on<T extends ServerMessageType>(type: T, handler: (payload: PayloadFor<T>) => void) {
    const existing = this.handlers[type] ?? new Set()
    existing.add(handler as (payload: never) => void)
    this.handlers[type] = existing
    return () => {
      existing.delete(handler as (payload: never) => void)
    }
  }

  connect(url: string) {
    this.url = url
    this.forcedClose = false
    this.reconnectAttempts = 0
    this.openSocket(false)
  }

  disconnect() {
    this.forcedClose = true
    this.clearReconnectTimer()
    this.clearDisconnectedTimer()
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
    this.updateStatus('idle')
  }

  send(type: string, payload: unknown) {
    const message = JSON.stringify({ type, payload })
    if (message.length > MAX_MESSAGE_SIZE) {
      this.updateStatus('disconnected', { reason: 'message_too_large' })
      return false
    }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.queue.push(message)
      if (this.url) {
        this.openSocket(true)
      }
      return false
    }
    this.socket.send(message)
    return true
  }

  private updateStatus(status: WsStatus, info?: { reason?: string; code?: number }) {
    this.status = status
    if (status === 'disconnected') {
      if (!this.forcedClose && info?.reason !== 'message_too_large') {
        this.scheduleDisconnectedProbe()
      }
    } else {
      this.clearDisconnectedTimer()
    }
    this.statusHandlers.forEach((handler) => handler(status, info))
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private clearDisconnectedTimer() {
    if (this.disconnectedTimer) {
      clearTimeout(this.disconnectedTimer)
      this.disconnectedTimer = null
    }
  }

  private scheduleDisconnectedProbe() {
    if (this.forcedClose || !this.url) return
    this.clearDisconnectedTimer()
    this.disconnectedTimer = setTimeout(() => {
      if (this.forcedClose || this.status !== 'disconnected') return
      this.openSocket(true)
    }, DISCONNECTED_POLL_INTERVAL)
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.updateStatus('disconnected', { reason: 'reconnect_failed' })
      return
    }
    this.updateStatus('reconnecting')
    const attempt = this.reconnectAttempts
    this.reconnectAttempts += 1
    const delay = Math.min(500 * Math.pow(2, attempt), 5000)
    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      this.openSocket(true)
    }, delay)
  }

  private openSocket(isReconnect: boolean) {
    if (!this.url) return
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return
    if (this.socket && this.socket.readyState === WebSocket.CONNECTING) return

    this.updateStatus(isReconnect ? 'reconnecting' : 'connecting')

    const ws = new WebSocket(this.url)
    this.socket = ws

    ws.onopen = () => {
      this.reconnectAttempts = 0
      this.updateStatus('connected')
      this.flushQueue()
      if (this.session) {
        this.send('reconnect', {
          gameId: this.session.gameId,
          playerToken: this.session.playerToken,
        })
      }
    }

    ws.onclose = (event) => {
      this.socket = null
      if (this.forcedClose) {
        this.updateStatus('disconnected', { reason: event.reason, code: event.code })
        return
      }
      this.scheduleReconnect()
    }

    ws.onerror = () => {
      if (this.status === 'connecting') {
        this.updateStatus('disconnected', { reason: 'connection_error' })
      }
    }

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      let parsed: ServerMessage
      try {
        parsed = JSON.parse(event.data) as ServerMessage
      } catch {
        return
      }
      if (!parsed || typeof parsed.type !== 'string') return
      this.handleServerMessage(parsed)
    }
  }

  private flushQueue() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    while (this.queue.length > 0) {
      const message = this.queue.shift()
      if (!message) continue
      this.socket.send(message)
    }
  }

  private setSession(session: OnlineSession) {
    this.session = session
    persistSession(session)
  }

  private handleServerMessage(message: ServerMessage) {
    if (message.type === 'game_created' || message.type === 'game_joined') {
      this.setSession({
        gameId: message.payload.gameId,
        playerToken: message.payload.playerToken,
        role: message.payload.role,
      })
    }
    if (message.type === 'reconnected') {
      if (this.session) {
        this.setSession({
          ...this.session,
          gameId: message.payload.gameId,
          role: message.payload.role,
        })
      }
    }
    const handlers = this.handlers[message.type]
    if (handlers) {
      handlers.forEach((handler) => {
        handler(message.payload as never)
      })
    }
  }
}

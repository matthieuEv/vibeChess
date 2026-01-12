export type EngineAssets = {
  stockfishJsUrl: string
  stockfishWasmUrl: string
  zerofishJsUrl: string
  zerofishWasmUrl: string
  maiaBaseUrl: string
}

export type EngineDownloadEvent =
  | { type: 'start'; totalFiles: number; totalBytes: number | null }
  | {
      type: 'progress'
      file: {
        id: string
        label: string
        index: number
        totalFiles: number
        receivedBytes: number
        totalBytes: number | null
      }
      overall: { receivedBytes: number; totalBytes: number | null }
    }
  | { type: 'done' }
  | { type: 'error'; message: string }

export type EnsureEngineAssetsResult = {
  assets: EngineAssets
  downloaded: boolean
}

const DEFAULT_ENGINE_ASSETS: EngineAssets = {
  stockfishJsUrl: './engine/stockfish-17.1-lite-single-03e3232.js',
  stockfishWasmUrl: './engine/stockfish-17.1-lite-single-03e3232.wasm',
  zerofishJsUrl: './engine/zerofishEngine.js',
  zerofishWasmUrl: './engine/zerofishEngine.wasm',
  maiaBaseUrl: './maia/',
}

const getIpcRenderer = () => {
  if (typeof window === 'undefined') return null
  const anyWindow = window as typeof window & { require?: (module: string) => any }
  if (!anyWindow?.process?.versions?.electron || !anyWindow.require) return null
  try {
    return anyWindow.require('electron').ipcRenderer as {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      on: (channel: string, listener: (event: unknown, payload: EngineDownloadEvent) => void) => void
      removeListener: (
        channel: string,
        listener: (event: unknown, payload: EngineDownloadEvent) => void,
      ) => void
    }
  } catch {
    return null
  }
}

export const ensureEngineAssets = async (
  onEvent?: (event: EngineDownloadEvent) => void,
): Promise<EnsureEngineAssetsResult> => {
  const ipc = getIpcRenderer()
  if (!ipc) {
    onEvent?.({ type: 'done' })
    return { assets: DEFAULT_ENGINE_ASSETS, downloaded: false }
  }

  const handler = (_event: unknown, payload: EngineDownloadEvent) => {
    onEvent?.(payload)
  }
  ipc.on('engine:download-event', handler)

  try {
    const result = (await ipc.invoke('engine:ensure-assets')) as EnsureEngineAssetsResult
    if (!result?.assets) {
      return { assets: DEFAULT_ENGINE_ASSETS, downloaded: false }
    }
    return result
  } finally {
    ipc.removeListener('engine:download-event', handler)
  }
}

export const getDefaultEngineAssets = () => DEFAULT_ENGINE_ASSETS

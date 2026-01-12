import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const publicDir = path.join(projectRoot, 'public')
const nodeModulesDir = path.join(projectRoot, 'node_modules')

const normalizeBaseUrl = (value) => (value.endsWith('/') ? value : `${value}/`)
const LEGACY_ENGINE_DOWNLOAD_BASE_URL =
  process.env.ENGINE_DOWNLOAD_BASE_URL ||
  process.env.VIBE_ENGINE_DOWNLOAD_BASE_URL ||
  process.env.VITE_ENGINE_DOWNLOAD_BASE_URL
const STOCKFISH_DOWNLOAD_BASE_URL = normalizeBaseUrl(
  process.env.VIBE_STOCKFISH_DOWNLOAD_BASE_URL ||
    process.env.STOCKFISH_DOWNLOAD_BASE_URL ||
    'https://unpkg.com/stockfish@17.1.0/src/',
)
const MAIA_DOWNLOAD_BASE_URL = normalizeBaseUrl(
  process.env.VIBE_MAIA_DOWNLOAD_BASE_URL ||
    process.env.MAIA_DOWNLOAD_BASE_URL ||
    'https://github.com/CSSLab/maia-chess/releases/download/v1.0/',
)

const MAIA_ELOS = [1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900]
const ENGINE_ASSETS = LEGACY_ENGINE_DOWNLOAD_BASE_URL
  ? [
      {
        label: 'Stockfish (JS)',
        baseUrl: normalizeBaseUrl(LEGACY_ENGINE_DOWNLOAD_BASE_URL),
        remotePath: 'engine/stockfish-17.1-lite-single-03e3232.js',
        dir: 'engine',
      },
      {
        label: 'Stockfish (WASM)',
        baseUrl: normalizeBaseUrl(LEGACY_ENGINE_DOWNLOAD_BASE_URL),
        remotePath: 'engine/stockfish-17.1-lite-single-03e3232.wasm',
        dir: 'engine',
      },
      ...MAIA_ELOS.map((elo) => ({
        label: `Maia ${elo}`,
        baseUrl: normalizeBaseUrl(LEGACY_ENGINE_DOWNLOAD_BASE_URL),
        remotePath: `maia/maia-${elo}.pb.gz`,
        dir: 'maia',
      })),
    ]
  : [
      {
        label: 'Stockfish (JS)',
        baseUrl: STOCKFISH_DOWNLOAD_BASE_URL,
        remotePath: 'stockfish-17.1-lite-single-03e3232.js',
        dir: 'engine',
      },
      {
        label: 'Stockfish (WASM)',
        baseUrl: STOCKFISH_DOWNLOAD_BASE_URL,
        remotePath: 'stockfish-17.1-lite-single-03e3232.wasm',
        dir: 'engine',
      },
      ...MAIA_ELOS.map((elo) => ({
        label: `Maia ${elo}`,
        baseUrl: MAIA_DOWNLOAD_BASE_URL,
        remotePath: `maia-${elo}.pb.gz`,
        dir: 'maia',
      })),
    ]

const fileExists = async (filePath) => {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK)
    return true
  } catch {
    return false
  }
}

const toNodeStream = (body) => {
  if (!body) return null
  if (typeof body.pipe === 'function') return body
  if (typeof Readable.fromWeb === 'function') return Readable.fromWeb(body)
  return null
}

const downloadFile = async (url, destPath) => {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
  }
  const tempPath = `${destPath}.tmp`
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true })

  const nodeStream = toNodeStream(response.body)
  if (!nodeStream) {
    throw new Error(`Unable to stream download for ${url}`)
  }

  try {
    await pipeline(nodeStream, fs.createWriteStream(tempPath))
    await fs.promises.rename(tempPath, destPath)
  } catch (err) {
    try {
      await fs.promises.unlink(tempPath)
    } catch {}
    throw err
  }
}

const copyFile = async (srcPath, destPath) => {
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true })
  await fs.promises.copyFile(srcPath, destPath)
}

const run = async () => {
  if (LEGACY_ENGINE_DOWNLOAD_BASE_URL) {
    console.info(`Engine base URL: ${normalizeBaseUrl(LEGACY_ENGINE_DOWNLOAD_BASE_URL)}`)
  } else {
    console.info(`Stockfish base URL: ${STOCKFISH_DOWNLOAD_BASE_URL}`)
    console.info(`Maia base URL: ${MAIA_DOWNLOAD_BASE_URL}`)
  }
  
  // Copy Zerofish files from node_modules to public/engine
  const zerofishFiles = ['zerofishEngine.js', 'zerofishEngine.wasm']
  for (const file of zerofishFiles) {
    const srcPath = path.join(nodeModulesDir, 'zerofish', 'dist', file)
    const destPath = path.join(publicDir, 'engine', file)
    if (await fileExists(destPath)) {
      console.info(`Skip Zerofish (${file.endsWith('.wasm') ? 'WASM' : 'JS'}) (already present)`)
      continue
    }
    if (await fileExists(srcPath)) {
      console.info(`Copying Zerofish (${file.endsWith('.wasm') ? 'WASM' : 'JS'})...`)
      await copyFile(srcPath, destPath)
    } else {
      console.warn(`Warning: ${srcPath} not found. Run npm install first.`)
    }
  }
  
  for (const asset of ENGINE_ASSETS) {
    const destPath = path.join(publicDir, asset.dir, path.basename(asset.remotePath))
    if (await fileExists(destPath)) {
      console.info(`Skip ${asset.label} (already present)`)
      continue
    }
    const url = new URL(asset.remotePath, asset.baseUrl).toString()
    console.info(`Downloading ${asset.label}...`)
    await downloadFile(url, destPath)
  }
  console.info('Engine download complete.')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})

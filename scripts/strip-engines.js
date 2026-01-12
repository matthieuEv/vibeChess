import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const distDir = path.join(projectRoot, 'dist')
const targets = [path.join(distDir, 'engine'), path.join(distDir, 'maia')]

const removeDir = async (dir) => {
  try {
    await fs.rm(dir, { recursive: true, force: true })
    return true
  } catch (err) {
    console.warn(`Failed to remove ${dir}:`, err)
    return false
  }
}

let removedCount = 0
for (const dir of targets) {
  const removed = await removeDir(dir)
  if (removed) removedCount += 1
}

console.info(`Engine assets stripped from dist (${removedCount}/${targets.length}).`)

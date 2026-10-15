import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join } from 'node:path'

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}
const inputs = files('dist')
const windows = inputs.find(path => path.endsWith('latest.json'))
if (!windows) throw new Error('Missing Windows updater feed')
const feed = JSON.parse(readFileSync(windows, 'utf8'))
for (const fragment of inputs.filter(path => /feed-(aarch64|x86_64)\.json$/.test(path))) {
  const entry = JSON.parse(readFileSync(fragment, 'utf8'))
  if (entry.version !== feed.version) throw new Error('Platform release versions differ')
  Object.assign(feed.platforms, entry.platforms)
}
if (!feed.platforms['darwin-aarch64'] || !feed.platforms['darwin-x86_64']) throw new Error('Missing macOS updater feeds')
mkdirSync('release-assets', { recursive: true })
const assets = inputs.filter(path => /\.(exe|apk|dmg|tar\.gz|sig)$/.test(path))
const names = new Set()
const checksums = []
for (const asset of assets) {
  const name = basename(asset)
  if (names.has(name)) throw new Error(`Duplicate release asset: ${name}`)
  names.add(name)
  copyFileSync(asset, join('release-assets', name))
  checksums.push(`${createHash('sha256').update(readFileSync(asset)).digest('hex')}  ${name}`)
}
writeFileSync(join('release-assets', 'SHA256SUMS.txt'), checksums.sort().join('\n') + '\n')
writeFileSync('latest.json', JSON.stringify(feed, null, 2))

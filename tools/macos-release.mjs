import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const target = process.env.RELEASE_TARGET
const tag = process.env.RELEASE_TAG
const repository = process.env.GITHUB_REPOSITORY
if (!['aarch64-apple-darwin', 'x86_64-apple-darwin'].includes(target) || !/^v\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(tag ?? '') || !repository) throw new Error('Invalid release environment')
const arch = target.split('-')[0]
const base = join('target', target, 'release', 'bundle')
mkdirSync('release-assets', { recursive: true })
const name = `Athanor_${tag.slice(1)}_${arch}.app.tar.gz`
const archive = join(base, 'macos', 'Athanor.app.tar.gz')
copyFileSync(archive, join('release-assets', name))
copyFileSync(`${archive}.sig`, join('release-assets', `${name}.sig`))
const images = readdirSync(join(base, 'dmg')).filter(name => name.endsWith('.dmg'))
if (images.length !== 1) throw new Error('Expected exactly one disk image')
for (const image of images) copyFileSync(join(base, 'dmg', image), join('release-assets', image))
const platforms = { [`darwin-${arch}`]: { signature: readFileSync(`${archive}.sig`, 'utf8').trim(), url: `https://github.com/${repository}/releases/download/${tag}/${name}` } }
writeFileSync(join('release-assets', `feed-${arch}.json`), JSON.stringify({ version: tag.slice(1), platforms }, null, 2))

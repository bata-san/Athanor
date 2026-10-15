import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const macos = resolve('tools/macos-release.mjs')
const collect = resolve('tools/collect-release.mjs')
function put(root, path, content) {
  const full = join(root, path)
  mkdirSync(resolve(full, '..'), { recursive: true })
  writeFileSync(full, content)
}
test('macOS archives have distinct names and merge with the Windows updater feed', () => {
  const root = mkdtempSync(join(tmpdir(), 'athanor-release-'))
  try {
    for (const arch of ['aarch64', 'x86_64']) {
      const target = `${arch}-apple-darwin`
      const job = join(root, target)
      const base = `target/${target}/release/bundle`
      put(job, `${base}/macos/Athanor.app.tar.gz`, `archive-${arch}`)
      put(job, `${base}/macos/Athanor.app.tar.gz.sig`, `signature-${arch}\n`)
      put(job, `${base}/dmg/Athanor_0.1.24_${arch}.dmg`, `image-${arch}`)
      const result = spawnSync(process.execPath, [macos], { cwd: job, env: { ...process.env, RELEASE_TAG: 'v0.1.24', RELEASE_TARGET: target, GITHUB_REPOSITORY: 'example/Athanor' }, encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
      // The artifact downloader places each job's assets in a separate directory.
      cpSync(join(job, 'release-assets'), join(root, 'dist', target), { recursive: true })
    }
    put(root, 'dist/windows/latest.json', JSON.stringify({ version: '0.1.24', platforms: { 'windows-x86_64': { signature: 'win', url: 'https://example.test/setup.exe' } } }))
    put(root, 'dist/windows/setup.exe', 'installer')
    put(root, 'dist/android/Athanor.apk', 'apk')
    const result = spawnSync(process.execPath, [collect], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const feed = JSON.parse(readFileSync(join(root, 'latest.json'), 'utf8'))
    assert.equal(Object.keys(feed.platforms).length, 3)
    assert.match(feed.platforms['darwin-aarch64'].url, /Athanor_0\.1\.24_aarch64\.app\.tar\.gz$/)
    assert.equal(feed.platforms['darwin-x86_64'].signature, 'signature-x86_64')
    const sums = readFileSync(join(root, 'release-assets/SHA256SUMS.txt'), 'utf8')
    assert.equal(sums.trim().split('\n').length, 8)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('feed collection refuses incomplete platform releases', () => {
  const root = mkdtempSync(join(tmpdir(), 'athanor-release-'))
  try {
    put(root, 'dist/windows/latest.json', JSON.stringify({ version: '0.1.24', platforms: {} }))
    const result = spawnSync(process.execPath, [collect], { cwd: root, encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Missing macOS updater feeds/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

import { isMockMode, mockAssetUrl } from './mock/backend'
import type { Platform } from './types'
export function assetUrl(hash: string, platform: Platform): string {
  if (isMockMode()) return mockAssetUrl(hash)
  return platform === 'windows' ? `http://athanor-asset.localhost/${hash}` : `athanor-asset://localhost/${hash}`
}

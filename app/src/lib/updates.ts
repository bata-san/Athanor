import { toast } from 'sonner'
import { api } from './api'
import type { UpdateInfo } from './types'

let staged: string | null = null

/** Check the release feed; when a newer version exists, download it in the background. Resolves with it, or null when up to date. */
export async function checkAndStage(): Promise<UpdateInfo | null> {
  const found = await api.checkUpdate()
  if (!found) return null
  await api.downloadUpdate()
  return { ...found, downloaded: true }
}

/** One toast per version: "ready" with a Restart button. Installing closes and reopens Athanor. */
export function offerRestart(update: UpdateInfo) {
  if (staged === update.version) return
  staged = update.version
  toast(`Athanor ${update.version} is ready`, {
    description: 'Restart to finish updating. Your tabs come back.',
    duration: Infinity,
    action: { label: 'Restart', onClick: () => { void api.installUpdate().catch((error) => toast.error(`Update failed: ${String(error)}`)) } },
  })
}

/** Start-up check: quiet unless an update was found; failures (offline, no feed yet) are ignored. */
export async function startupUpdateCheck() {
  try {
    const update = await checkAndStage()
    if (update) offerRestart(update)
  } catch { /* offline or no release feed: try again next start */ }
}

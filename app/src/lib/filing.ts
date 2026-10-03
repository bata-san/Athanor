import { toast } from 'sonner'
import { api } from './api'

/** One entry point for the toolbar, command bar, settings and sidebar. */
export async function fileTabs() {
  try {
    const result = await api.autoFileAll()
    if (!result.tabs) { toast('No unfiled tabs match your filing rules'); return }
    toast.success(`Filed ${result.tabs} ${result.tabs === 1 ? 'tab' : 'tabs'} into ${result.folders} ${result.folders === 1 ? 'folder' : 'folders'}`, {
      duration: 7000,
      action: { label: 'Undo', onClick: () => { void api.undoFileAll(result.undo).then((count) => toast(count ? `Restored ${count} ${count === 1 ? 'tab' : 'tabs'}` : 'Filing has already changed')) } },
    })
  } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
}

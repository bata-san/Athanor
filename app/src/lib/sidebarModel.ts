import type { Folder, Tab } from './types'
export interface SidebarGroups { pinned: Tab[]; folders: { folder: Folder; tabs: Tab[] }[]; root: Tab[]; archived: Tab[] }
export function groupSidebarTabs(tabs: Tab[], folders: Folder[], space: string): SidebarGroups {
  const visible = tabs.filter((tab) => tab.space === space)
  const pinned = visible.filter((tab) => tab.pinned && !tab.archived)
  const archived = visible.filter((tab) => tab.archived)
  const currentFolders = folders.filter((folder) => folder.space === space).map((folder) => ({ folder, tabs: visible.filter((tab) => tab.folder === folder.id && !tab.archived && !tab.pinned) }))
  const folderIds = new Set(currentFolders.map((group) => group.folder.id))
  const root = visible.filter((tab) => !tab.pinned && !tab.archived && (!tab.folder || !folderIds.has(tab.folder)))
  return { pinned, folders: currentFolders, root, archived }
}

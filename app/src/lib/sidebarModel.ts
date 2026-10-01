import type { Folder, Tab } from './types'
export interface SidebarGroups { pinned: Tab[]; folders: { folder: Folder; tabs: Tab[] }[]; root: Tab[]; archived: Tab[] }
/**
 * Ctrl+1..9: pinned tabs first, then down the sidebar (folders, then loose tabs). Tabs inside collapsed folders are
 * not counted - the numbers match the rows you can see. Ctrl+9 is always the last one. Mirrors `Workspace::numbered_tabs`.
 */
export function tabNumbers(groups: SidebarGroups): Map<string, number> {
  const rows = [...groups.pinned, ...groups.folders.filter(({ folder }) => !folder.collapsed).flatMap(({ tabs }) => tabs), ...groups.root]
  const numbers = new Map<string, number>()
  rows.forEach((tab, index) => { if (index < 8) numbers.set(tab.id, index + 1) })
  const last = rows[rows.length - 1]
  if (rows.length > 8 && last) numbers.set(last.id, 9)
  return numbers
}

export function groupSidebarTabs(tabs: Tab[], folders: Folder[], space: string): SidebarGroups {
  const visible = tabs.filter((tab) => tab.space === space)
  const pinned = visible.filter((tab) => tab.pinned && !tab.archived)
  const archived = visible.filter((tab) => tab.archived)
  const currentFolders = folders.filter((folder) => folder.space === space).map((folder) => ({ folder, tabs: visible.filter((tab) => tab.folder === folder.id && !tab.archived && !tab.pinned) }))
  const folderIds = new Set(currentFolders.map((group) => group.folder.id))
  const root = visible.filter((tab) => !tab.pinned && !tab.archived && (!tab.folder || !folderIds.has(tab.folder)))
  return { pinned, folders: currentFolders, root, archived }
}

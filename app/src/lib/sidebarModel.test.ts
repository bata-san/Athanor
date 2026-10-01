import { describe, expect, it } from 'vitest'
import { groupSidebarTabs } from './sidebarModel'
import type { Folder, Tab } from './types'

const tabs: Tab[] = [
  { id: 'root', title: 'Root', url: 'https://a.test', favicon: null, space: 's1', folder: null, pinned: false, parent: null, created: 0, lastActive: 0, archived: false, muted: false, autoFiled: false, softwareRendering: false },
  { id: 'pinned', title: 'Pin', url: 'https://b.test', favicon: null, space: 's1', folder: null, pinned: true, parent: null, created: 0, lastActive: 0, archived: false, muted: false, autoFiled: false, softwareRendering: false },
  { id: 'filed', title: 'Filed', url: 'https://c.test', favicon: null, space: 's1', folder: 'f1', pinned: false, parent: null, created: 0, lastActive: 0, archived: false, muted: false, autoFiled: true, softwareRendering: false },
  { id: 'archived', title: 'Old', url: 'https://d.test', favicon: null, space: 's1', folder: null, pinned: false, parent: null, created: 0, lastActive: 0, archived: true, muted: false, autoFiled: false, softwareRendering: false },
  { id: 'elsewhere', title: 'Other', url: 'https://e.test', favicon: null, space: 's2', folder: null, pinned: false, parent: null, created: 0, lastActive: 0, archived: false, muted: false, autoFiled: false, softwareRendering: false },
]
const folders: Folder[] = [{ id: 'f1', name: 'Development', space: 's1', collapsed: false, color: null, auto: true }]
describe('groupSidebarTabs', () => {
  it('keeps display order within pinned, folder, root, and archive groups', () => {
    const groups = groupSidebarTabs(tabs, folders, 's1')
    expect(groups.pinned.map((tab) => tab.id)).toEqual(['pinned'])
    expect(groups.folders[0]!.tabs.map((tab) => tab.id)).toEqual(['filed'])
    expect(groups.root.map((tab) => tab.id)).toEqual(['root'])
    expect(groups.archived.map((tab) => tab.id)).toEqual(['archived'])
  })
})

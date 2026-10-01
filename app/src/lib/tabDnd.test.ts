import { describe, expect, it } from 'vitest'
import { resolveDrop } from './tabDnd'
import type { Snapshot, Tab } from './types'

const tab = (id: string, extra: Partial<Tab> = {}): Tab => ({ id, url: `https://${id}.test`, title: id, favicon: null, space: 's1', folder: null, pinned: false, parent: null, created: 0, lastActive: 0, archived: false, muted: false, autoFiled: false, ...extra })
const snapshot = (tabs: Tab[]) => ({ workspace: { spaces: [], folders: [], tabs, activeSpace: 's1', activeTab: tabs[0]?.id ?? null, split: null } }) as unknown as Snapshot

describe('resolveDrop', () => {
  const tabs = [tab('a', { folder: 'f' }), tab('b', { folder: 'f' }), tab('c', { folder: 'f' }), tab('d'), tab('e'), tab('p', { pinned: true }), tab('q', { pinned: true })]
  const snap = snapshot(tabs)

  it('inserts before a target in its folder', () => {
    expect(resolveDrop(snap, 'd', { kind: 'before', target: 'b' })).toEqual({ tab: 'd', space: 's1', folder: 'f', pinned: false, before: 'b' })
  })
  it('inserts after a target by placing before the next tab of the same group', () => {
    expect(resolveDrop(snap, 'd', { kind: 'after', target: 'a' })?.before).toBe('b')
    expect(resolveDrop(snap, 'a', { kind: 'after', target: 'd' })?.before).toBe('e')
  })
  it('appends when the target is the last of its group', () => {
    expect(resolveDrop(snap, 'd', { kind: 'after', target: 'c' })?.before).toBeNull()
    expect(resolveDrop(snap, 'a', { kind: 'after', target: 'e' })?.before).toBeNull()
  })
  it('skips the moving tab itself when it is the next sibling', () => {
    expect(resolveDrop(snap, 'b', { kind: 'after', target: 'a' })?.before).toBe('c')
  })
  it('dropping on a pinned tile pins and clears the folder', () => {
    expect(resolveDrop(snap, 'd', { kind: 'before', target: 'q' })).toEqual({ tab: 'd', space: 's1', folder: null, pinned: true, before: 'q' })
  })
  it('ignores a drop on itself', () => {
    expect(resolveDrop(snap, 'b', { kind: 'before', target: 'b' })).toBeNull()
  })
  it('region drops', () => {
    expect(resolveDrop(snap, 'd', { kind: 'folder', folder: 'f' })).toMatchObject({ folder: 'f', pinned: false, before: null })
    expect(resolveDrop(snap, 'd', { kind: 'pin' })).toMatchObject({ pinned: true, folder: null })
    expect(resolveDrop(snap, 'a', { kind: 'unfile' })).toMatchObject({ folder: null, pinned: false })
    expect(resolveDrop(snap, 'a', { kind: 'space', space: 's2' })).toMatchObject({ space: 's2', folder: null })
  })
})

import { useState } from 'react'
import type * as React from 'react'
import { ContextMenu } from './ui/context-menu'
import { DropdownMenu } from './ui/dropdown-menu'
import { useOverlay } from '@/lib/overlay'

/** Menus that may extend over the native page area register as overlays while open (see lib/overlay.ts). */
export function OverlayContextMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  useOverlay(open, 'context-menu')
  return <ContextMenu onOpenChange={setOpen}>{children}</ContextMenu>
}

export function OverlayDropdownMenu({ children, onOpenChange, ...props }: React.ComponentProps<typeof DropdownMenu>) {
  const [open, setOpen] = useState(false)
  useOverlay(open, 'dropdown')
  return <DropdownMenu {...props} onOpenChange={(next) => { setOpen(next); onOpenChange?.(next) }}>{children}</DropdownMenu>
}

/** Stops a right-click on a row from also opening the menu of the area behind it. */
export const ownContextMenu = (event: React.MouseEvent) => event.stopPropagation()

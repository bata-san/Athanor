import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as React from 'react'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close
export const DialogTitle = DialogPrimitive.Title
export const DialogDescription = DialogPrimitive.Description
export function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--ath-dialog-dim)] data-[state=open]:animate-[ath-fade_160ms_ease_both] data-[state=closed]:animate-out" />
    <DialogPrimitive.Content className={cn('fixed top-[14vh] left-1/2 z-50 flex max-h-[72dvh] w-[min(42rem,calc(100vw-1.25rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-menu outline-none data-[state=open]:animate-[ath-rise_240ms_var(--ease-spring)_both] data-[state=closed]:animate-out', className)} {...props}>{children}</DialogPrimitive.Content>
  </DialogPrimitive.Portal>
}
export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn('flex flex-col gap-1.5 px-5 pt-5', className)} {...props} /> }
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn('flex justify-end gap-2 px-5 pb-5', className)} {...props} /> }

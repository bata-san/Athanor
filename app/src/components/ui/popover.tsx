import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/lib/utils'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor
export const PopoverClose = PopoverPrimitive.Close
export const PopoverContent = React.forwardRef<React.ElementRef<typeof PopoverPrimitive.Content>, React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>>(({ className, align = 'end', sideOffset = 8, ...props }, ref) => (
  <PopoverPrimitive.Portal><PopoverPrimitive.Content ref={ref} align={align} sideOffset={sideOffset} className={cn('z-[60] w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-border/80 bg-popover/85 p-4 backdrop-blur-2xl backdrop-saturate-150 text-popover-foreground origin-[var(--radix-popper-transform-origin)] shadow-menu outline-none data-[state=open]:animate-in data-[state=closed]:animate-out', className)} {...props} /></PopoverPrimitive.Portal>
))
PopoverContent.displayName = 'PopoverContent'

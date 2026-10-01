import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'
export const TooltipProvider = ({ delayDuration = 450, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) => <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />
export const Tooltip = TooltipPrimitive.Root
export const TooltipTrigger = TooltipPrimitive.Trigger
export const TooltipContent = React.forwardRef<React.ElementRef<typeof TooltipPrimitive.Content>, React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal><TooltipPrimitive.Content ref={ref} sideOffset={sideOffset} className={cn('z-[70] max-w-xs rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-medium text-background origin-[var(--radix-popper-transform-origin)] shadow-menu data-[state=delayed-open]:animate-in data-[state=instant-open]:animate-in', className)} {...props} /></TooltipPrimitive.Portal>
))
TooltipContent.displayName = 'TooltipContent'
/** Wraps a single child in a tooltip carrying a label and an optional shortcut. */
export function Tip({ label, shortcut, side = 'bottom', disabled = false, children }: { label: string; shortcut?: string; side?: 'top' | 'right' | 'bottom' | 'left'; disabled?: boolean; children: React.ReactElement }) {
  return <Tooltip open={disabled ? false : undefined}><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent side={side}>{label}{shortcut && <span className="ms-2 text-[11px] text-background/60">{shortcut}</span>}</TooltipContent></Tooltip>
}

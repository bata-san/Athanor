import * as React from 'react'
import * as Primitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { menuContent, menuItem } from './menu-styles'

export const Select = Primitive.Root
export const SelectGroup = Primitive.Group
export const SelectValue = Primitive.Value

export const SelectTrigger = React.forwardRef<React.ElementRef<typeof Primitive.Trigger>, React.ComponentPropsWithoutRef<typeof Primitive.Trigger>>(({ className, children, ...props }, ref) => (
  <Primitive.Trigger ref={ref} className={cn('flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-sm whitespace-nowrap text-foreground outline-none transition-colors hover:bg-accent/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground [&>span]:truncate', className)} {...props}>
    {children}<Primitive.Icon asChild><ChevronDown className="size-4 shrink-0 text-muted-foreground" /></Primitive.Icon>
  </Primitive.Trigger>
))
SelectTrigger.displayName = 'SelectTrigger'

export const SelectContent = React.forwardRef<React.ElementRef<typeof Primitive.Content>, React.ComponentPropsWithoutRef<typeof Primitive.Content>>(({ className, children, position = 'popper', ...props }, ref) => (
  <Primitive.Portal>
    <Primitive.Content ref={ref} position={position} sideOffset={6} className={cn(menuContent, position === 'popper' && 'w-[var(--radix-select-trigger-width)] min-w-[var(--radix-select-trigger-width)]', className)} {...props}>
      <Primitive.Viewport>{children}</Primitive.Viewport>
    </Primitive.Content>
  </Primitive.Portal>
))
SelectContent.displayName = 'SelectContent'

export const SelectItem = React.forwardRef<React.ElementRef<typeof Primitive.Item>, React.ComponentPropsWithoutRef<typeof Primitive.Item>>(({ className, children, ...props }, ref) => (
  <Primitive.Item ref={ref} className={cn(menuItem, 'pe-8', className)} {...props}>
    <Primitive.ItemText>{children}</Primitive.ItemText>
    <span className="absolute end-2.5 flex size-4 items-center justify-center"><Primitive.ItemIndicator><Check className="size-4" /></Primitive.ItemIndicator></span>
  </Primitive.Item>
))
SelectItem.displayName = 'SelectItem'

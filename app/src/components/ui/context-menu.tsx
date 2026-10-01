import * as React from 'react'
import * as Primitive from '@radix-ui/react-context-menu'
import { Check, ChevronRight, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { menuContent, menuItem, menuItemDestructive, menuLabel, menuSeparator, menuShortcut } from './menu-styles'

export const ContextMenu = Primitive.Root
export const ContextMenuTrigger = Primitive.Trigger
export const ContextMenuGroup = Primitive.Group
export const ContextMenuSub = Primitive.Sub
export const ContextMenuRadioGroup = Primitive.RadioGroup

export const ContextMenuContent = React.forwardRef<React.ElementRef<typeof Primitive.Content>, React.ComponentPropsWithoutRef<typeof Primitive.Content>>(({ className, ...props }, ref) => (
  <Primitive.Portal><Primitive.Content ref={ref} className={cn(menuContent, className)} data-part="context-menu" {...props} /></Primitive.Portal>
))
ContextMenuContent.displayName = 'ContextMenuContent'

export const ContextMenuSubContent = React.forwardRef<React.ElementRef<typeof Primitive.SubContent>, React.ComponentPropsWithoutRef<typeof Primitive.SubContent>>(({ className, ...props }, ref) => (
  <Primitive.Portal><Primitive.SubContent ref={ref} className={cn(menuContent, className)} {...props} /></Primitive.Portal>
))
ContextMenuSubContent.displayName = 'ContextMenuSubContent'

export const ContextMenuSubTrigger = React.forwardRef<React.ElementRef<typeof Primitive.SubTrigger>, React.ComponentPropsWithoutRef<typeof Primitive.SubTrigger>>(({ className, children, ...props }, ref) => (
  <Primitive.SubTrigger ref={ref} className={cn(menuItem, className)} {...props}>{children}<ChevronRight className="ms-auto size-4" /></Primitive.SubTrigger>
))
ContextMenuSubTrigger.displayName = 'ContextMenuSubTrigger'

export const ContextMenuItem = React.forwardRef<React.ElementRef<typeof Primitive.Item>, React.ComponentPropsWithoutRef<typeof Primitive.Item> & { destructive?: boolean }>(({ className, destructive, ...props }, ref) => (
  <Primitive.Item ref={ref} className={cn(menuItem, destructive && menuItemDestructive, className)} {...props} />
))
ContextMenuItem.displayName = 'ContextMenuItem'

export const ContextMenuCheckboxItem = React.forwardRef<React.ElementRef<typeof Primitive.CheckboxItem>, React.ComponentPropsWithoutRef<typeof Primitive.CheckboxItem>>(({ className, children, ...props }, ref) => (
  <Primitive.CheckboxItem ref={ref} className={cn(menuItem, 'ps-8', className)} {...props}><span className="absolute start-2.5 flex size-4 items-center justify-center"><Primitive.ItemIndicator><Check className="size-4" /></Primitive.ItemIndicator></span>{children}</Primitive.CheckboxItem>
))
ContextMenuCheckboxItem.displayName = 'ContextMenuCheckboxItem'

export const ContextMenuRadioItem = React.forwardRef<React.ElementRef<typeof Primitive.RadioItem>, React.ComponentPropsWithoutRef<typeof Primitive.RadioItem>>(({ className, children, ...props }, ref) => (
  <Primitive.RadioItem ref={ref} className={cn(menuItem, 'ps-8', className)} {...props}><span className="absolute start-2.5 flex size-4 items-center justify-center"><Primitive.ItemIndicator><Circle className="size-2 fill-current" /></Primitive.ItemIndicator></span>{children}</Primitive.RadioItem>
))
ContextMenuRadioItem.displayName = 'ContextMenuRadioItem'

export const ContextMenuLabel = React.forwardRef<React.ElementRef<typeof Primitive.Label>, React.ComponentPropsWithoutRef<typeof Primitive.Label>>(({ className, ...props }, ref) => <Primitive.Label ref={ref} className={cn(menuLabel, className)} {...props} />)
ContextMenuLabel.displayName = 'ContextMenuLabel'
export const ContextMenuSeparator = React.forwardRef<React.ElementRef<typeof Primitive.Separator>, React.ComponentPropsWithoutRef<typeof Primitive.Separator>>(({ className, ...props }, ref) => <Primitive.Separator ref={ref} className={cn(menuSeparator, className)} {...props} />)
ContextMenuSeparator.displayName = 'ContextMenuSeparator'
export const ContextMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span className={cn(menuShortcut, className)} {...props} />

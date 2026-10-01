import * as React from 'react'
import * as Primitive from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { menuContent, menuItem, menuItemDestructive, menuLabel, menuSeparator, menuShortcut } from './menu-styles'

export const DropdownMenu = Primitive.Root
export const DropdownMenuTrigger = Primitive.Trigger
export const DropdownMenuGroup = Primitive.Group
export const DropdownMenuSub = Primitive.Sub
export const DropdownMenuRadioGroup = Primitive.RadioGroup

export const DropdownMenuContent = React.forwardRef<React.ElementRef<typeof Primitive.Content>, React.ComponentPropsWithoutRef<typeof Primitive.Content>>(({ className, sideOffset = 6, ...props }, ref) => (
  <Primitive.Portal><Primitive.Content ref={ref} sideOffset={sideOffset} className={cn(menuContent, className)} {...props} /></Primitive.Portal>
))
DropdownMenuContent.displayName = 'DropdownMenuContent'

export const DropdownMenuSubContent = React.forwardRef<React.ElementRef<typeof Primitive.SubContent>, React.ComponentPropsWithoutRef<typeof Primitive.SubContent>>(({ className, ...props }, ref) => (
  <Primitive.Portal><Primitive.SubContent ref={ref} className={cn(menuContent, className)} {...props} /></Primitive.Portal>
))
DropdownMenuSubContent.displayName = 'DropdownMenuSubContent'

export const DropdownMenuSubTrigger = React.forwardRef<React.ElementRef<typeof Primitive.SubTrigger>, React.ComponentPropsWithoutRef<typeof Primitive.SubTrigger>>(({ className, children, ...props }, ref) => (
  <Primitive.SubTrigger ref={ref} className={cn(menuItem, className)} {...props}>{children}<ChevronRight className="ms-auto size-4" /></Primitive.SubTrigger>
))
DropdownMenuSubTrigger.displayName = 'DropdownMenuSubTrigger'

export const DropdownMenuItem = React.forwardRef<React.ElementRef<typeof Primitive.Item>, React.ComponentPropsWithoutRef<typeof Primitive.Item> & { destructive?: boolean }>(({ className, destructive, ...props }, ref) => (
  <Primitive.Item ref={ref} className={cn(menuItem, destructive && menuItemDestructive, className)} {...props} />
))
DropdownMenuItem.displayName = 'DropdownMenuItem'

export const DropdownMenuCheckboxItem = React.forwardRef<React.ElementRef<typeof Primitive.CheckboxItem>, React.ComponentPropsWithoutRef<typeof Primitive.CheckboxItem>>(({ className, children, ...props }, ref) => (
  <Primitive.CheckboxItem ref={ref} className={cn(menuItem, 'ps-8', className)} {...props}><span className="absolute start-2.5 flex size-4 items-center justify-center"><Primitive.ItemIndicator><Check className="size-4" /></Primitive.ItemIndicator></span>{children}</Primitive.CheckboxItem>
))
DropdownMenuCheckboxItem.displayName = 'DropdownMenuCheckboxItem'

export const DropdownMenuRadioItem = React.forwardRef<React.ElementRef<typeof Primitive.RadioItem>, React.ComponentPropsWithoutRef<typeof Primitive.RadioItem>>(({ className, children, ...props }, ref) => (
  <Primitive.RadioItem ref={ref} className={cn(menuItem, 'ps-8', className)} {...props}><span className="absolute start-2.5 flex size-4 items-center justify-center"><Primitive.ItemIndicator><Circle className="size-2 fill-current" /></Primitive.ItemIndicator></span>{children}</Primitive.RadioItem>
))
DropdownMenuRadioItem.displayName = 'DropdownMenuRadioItem'

export const DropdownMenuLabel = React.forwardRef<React.ElementRef<typeof Primitive.Label>, React.ComponentPropsWithoutRef<typeof Primitive.Label>>(({ className, ...props }, ref) => <Primitive.Label ref={ref} className={cn(menuLabel, className)} {...props} />)
DropdownMenuLabel.displayName = 'DropdownMenuLabel'
export const DropdownMenuSeparator = React.forwardRef<React.ElementRef<typeof Primitive.Separator>, React.ComponentPropsWithoutRef<typeof Primitive.Separator>>(({ className, ...props }, ref) => <Primitive.Separator ref={ref} className={cn(menuSeparator, className)} {...props} />)
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator'
export const DropdownMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span className={cn(menuShortcut, className)} {...props} />

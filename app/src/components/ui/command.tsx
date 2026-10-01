import { Command as CommandPrimitive } from 'cmdk'
import * as React from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Command = React.forwardRef<React.ElementRef<typeof CommandPrimitive>, React.ComponentPropsWithoutRef<typeof CommandPrimitive>>(({ className, ...props }, ref) => (
  <CommandPrimitive ref={ref} className={cn('flex min-h-0 flex-col overflow-hidden', className)} {...props} />
))
Command.displayName = 'Command'
export const CommandInput = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Input>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>>(({ className, ...props }, ref) => (
  <div className="flex items-center gap-3 border-b border-border px-4"><Search className="size-4 shrink-0 text-muted-foreground" /><CommandPrimitive.Input ref={ref} className={cn('h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground', className)} {...props} /></div>
))
CommandInput.displayName = 'CommandInput'
export const CommandList = React.forwardRef<React.ElementRef<typeof CommandPrimitive.List>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>>(({ className, ...props }, ref) => (
  <CommandPrimitive.List ref={ref} className={cn('max-h-[56dvh] overflow-y-auto overflow-x-hidden p-1', className)} {...props} />
))
CommandList.displayName = 'CommandList'
export const CommandEmpty = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Empty>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>>(({ className, ...props }, ref) => (
  <CommandPrimitive.Empty ref={ref} className={cn('py-10 text-center text-sm text-muted-foreground', className)} {...props} />
))
CommandEmpty.displayName = 'CommandEmpty'
export const CommandGroup = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Group>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group ref={ref} className={cn('overflow-hidden py-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground', className)} {...props} />
))
CommandGroup.displayName = 'CommandGroup'
export const CommandItem = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Item>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item ref={ref} className={cn("flex min-h-8 cursor-default items-center gap-2.5 rounded-md px-2 py-1 text-[13px] outline-none select-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground", className)} {...props} />
))
CommandItem.displayName = 'CommandItem'

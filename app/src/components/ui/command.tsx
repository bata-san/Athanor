import { Command as CommandPrimitive } from 'cmdk'
import * as React from 'react'
import { cn } from '@/lib/utils'
export const Command = React.forwardRef<React.ElementRef<typeof CommandPrimitive>, React.ComponentPropsWithoutRef<typeof CommandPrimitive>>(({ className, ...props }, ref) => <CommandPrimitive ref={ref} className={cn('command', className)} {...props} />)
Command.displayName = 'Command'
export const CommandInput = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Input>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>>(({ className, ...props }, ref) => <CommandPrimitive.Input ref={ref} className={cn('command-input', className)} {...props} />)
CommandInput.displayName = 'CommandInput'
export const CommandList = React.forwardRef<React.ElementRef<typeof CommandPrimitive.List>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>>(({ className, ...props }, ref) => <CommandPrimitive.List ref={ref} className={cn('command-list', className)} {...props} />)
CommandList.displayName = 'CommandList'
export const CommandEmpty = CommandPrimitive.Empty
export const CommandGroup = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Group>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>>(({ className, ...props }, ref) => <CommandPrimitive.Group ref={ref} className={cn('command-group', className)} {...props} />)
CommandGroup.displayName = 'CommandGroup'
export const CommandItem = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Item>, React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>>(({ className, ...props }, ref) => <CommandPrimitive.Item ref={ref} className={cn('command-item', className)} {...props} />)
CommandItem.displayName = 'CommandItem'

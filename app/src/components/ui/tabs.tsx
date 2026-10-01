import * as React from 'react'
import * as Primitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

export const Tabs = Primitive.Root
export const TabsList = React.forwardRef<React.ElementRef<typeof Primitive.List>, React.ComponentPropsWithoutRef<typeof Primitive.List>>(({ className, ...props }, ref) => (
  <Primitive.List ref={ref} className={cn('inline-flex items-center gap-0.5 rounded-lg bg-muted p-1', className)} {...props} />
))
TabsList.displayName = 'TabsList'
export const TabsTrigger = React.forwardRef<React.ElementRef<typeof Primitive.Trigger>, React.ComponentPropsWithoutRef<typeof Primitive.Trigger>>(({ className, ...props }, ref) => (
  <Primitive.Trigger ref={ref} className={cn('inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-3 text-[0.8667rem] font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm [&_svg]:size-4', className)} {...props} />
))
TabsTrigger.displayName = 'TabsTrigger'
export const TabsContent = Primitive.Content

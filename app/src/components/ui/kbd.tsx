import * as React from 'react'
import { cn } from '@/lib/utils'
export const Kbd = ({ className, ...props }: React.HTMLAttributes<HTMLElement>) => <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border bg-background px-1.5 font-sans text-[11px] font-medium text-muted-foreground', className)} {...props} />

import * as React from 'react'
import { cn } from '@/lib/utils'
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn('flex min-h-20 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-[0.8667rem] text-foreground outline-none transition-colors placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50', className)} {...props} />
))
Textarea.displayName = 'Textarea'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
const badgeVariants = cva('inline-flex items-center gap-1 rounded-full border px-2 py-px text-[11px] font-medium leading-4 whitespace-nowrap', {
  variants: { variant: { outline: 'border-border text-muted-foreground', secondary: 'border-transparent bg-secondary text-secondary-foreground', solid: 'border-transparent bg-primary text-primary-foreground' } },
  defaultVariants: { variant: 'outline' },
})
export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) { return <span className={cn(badgeVariants({ variant }), className)} {...props} /> }

import * as React from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
export const Kbd = ({ className, ...props }: React.HTMLAttributes<HTMLElement>) => <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border bg-background px-1.5 font-sans text-[0.7333rem] font-medium text-muted-foreground', className)} {...props} />
/** One key of a combo; the arrows are icons because the UI font has no arrow glyphs. */
export const KeyCap = ({ k }: { k: string }) => <Kbd aria-label={k === '←' ? 'Left' : k === '→' ? 'Right' : k}>{k === '←' ? <ArrowLeft className="size-3" /> : k === '→' ? <ArrowRight className="size-3" /> : k}</Kbd>

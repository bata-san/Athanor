import * as React from 'react'
import { cn } from '@/lib/utils'
import { AppIcon } from './Icons'
import { Card } from './ui/card'

/**
 * Building blocks for full-page screens (Settings, Extensions, Boards chrome...). They give every page the same
 * rhythm: a quiet header with a hairline under it, then bordered cards holding rows separated by hairlines.
 */

/** Scrolling page body. `title` renders the header; children are the cards. */
export function Page({ title, description, actions, children, className, ...props }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode } & Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>) {
  return <div className={cn('flex h-full min-w-0 flex-1 flex-col overflow-hidden', className)} {...props}>
    <header className="flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-8 py-3 max-md:px-4">
      <div className="min-w-0"><h1 className="m-0 truncate text-base font-semibold tracking-tight">{title}</h1>{description && <p className="m-0 mt-0.5 truncate text-[13px] text-muted-foreground">{description}</p>}</div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-8 py-6 max-md:px-4">{children}</div></div>
  </div>
}

/** A bordered card with an optional title row. Put `Row`s (or anything) inside. */
export function Section({ title, description, actions, children, className }: { title?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return <Card className={cn('overflow-hidden', className)}>
    {(title || actions) && <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-1"><div className="min-w-0"><h2 className="m-0 text-sm font-semibold">{title}</h2>{description && <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">{description}</p>}</div>{actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}</div>}
    <div className="px-5 py-1.5 [&>*+*]:border-t [&>*+*]:border-border">{children}</div>
  </Card>
}

/** A label/description on the left and a control on the right. Rows inside a `Section` get hairline dividers. */
export function Row({ title, description, children, className, htmlFor }: { title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode; className?: string; htmlFor?: string }) {
  return <div className={cn('flex min-h-14 items-center justify-between gap-6 py-3 max-sm:flex-col max-sm:items-stretch max-sm:gap-2', className)}>
    <div className="flex min-w-0 flex-col gap-0.5"><label htmlFor={htmlFor} className="text-sm font-medium leading-5">{title}</label>{description && <span className="text-[13px] leading-5 text-muted-foreground">{description}</span>}</div>
    {children !== undefined && <div className="flex shrink-0 items-center gap-2 max-sm:w-full">{children}</div>}
  </div>
}

/** Small rounded tile holding an icon (extension rows, empty states...). */
export function IconTile({ icon, className }: { icon: string; className?: string }) {
  return <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-foreground [&_svg]:size-4', className)}><AppIcon name={icon} /></span>
}

/** Big number with a muted label above it. */
export function Stat({ label, value, hint, className }: { label: React.ReactNode; value: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return <Card className={cn('flex flex-col gap-1 p-4', className)}><span className="text-xs text-muted-foreground">{label}</span><strong className="text-xl font-semibold tracking-tight tabular-nums">{value}</strong>{hint && <span className="text-xs text-muted-foreground">{hint}</span>}</Card>
}

/** Dashed call-out strip, used for hints and empty states. */
export function Callout({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex items-center gap-3 rounded-xl border border-dashed border-border px-4 py-3 text-[13px] text-muted-foreground', className)}>{children}</div>
}

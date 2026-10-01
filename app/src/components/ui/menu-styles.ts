/** Shared look for every popup menu (context menu, dropdown, select): one place to restyle them all. */
export const menuContent = 'z-[60] min-w-52 max-h-[var(--radix-popper-available-height)] overflow-y-auto overflow-x-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground origin-[var(--radix-popper-transform-origin)] shadow-menu outline-none data-[state=open]:animate-in data-[state=closed]:animate-out'
export const menuItem = "relative flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] leading-5 outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=open]:bg-accent [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground data-[highlighted]:[&_svg:not([class*='text-'])]:text-accent-foreground"
export const menuItemDestructive = 'text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive [&_svg:not([class*=text-])]:text-destructive!'
export const menuLabel = 'px-2.5 py-1.5 text-xs font-medium text-muted-foreground'
export const menuSeparator = '-mx-1.5 my-1.5 h-px bg-border'
export const menuShortcut = 'ms-auto ps-6 text-xs text-muted-foreground tracking-normal'

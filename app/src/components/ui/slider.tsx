import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { cn } from '@/lib/utils'
export const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root ref={ref} className={cn('relative flex h-5 w-full touch-none items-center select-none', className)} {...props}>
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-secondary"><SliderPrimitive.Range className="absolute h-full bg-primary" /></SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block size-4 rounded-full border border-primary bg-background shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40" />
  </SliderPrimitive.Root>
))
Slider.displayName = 'Slider'

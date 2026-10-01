import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { cn } from '@/lib/utils'
/**
 * The thumb is the element that carries `role="slider"`, so that is where the name and the spoken value belong: the root
 * is only a container, and a label left on it is never announced. `aria-valuetext` says the value in the units the person
 * reads beside it ("24 hours", "125%", "236 px"), so the value is not announced as a bare number.
 */
export const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>>(({ className, 'aria-label': ariaLabel, 'aria-valuetext': valueText, ...props }, ref) => (
  <SliderPrimitive.Root ref={ref} className={cn('relative flex h-5 w-full touch-none items-center select-none', className)} {...props}>
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-secondary"><SliderPrimitive.Range className="absolute h-full bg-primary" /></SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block size-4 rounded-full border border-primary bg-background shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40" aria-label={ariaLabel} aria-valuetext={valueText} />
  </SliderPrimitive.Root>
))
Slider.displayName = 'Slider'

import type { Transition } from 'motion/react'

/**
 * One motion vocabulary for the whole shell, tuned to feel immediate (Arc-like): short, stiff springs that
 * settle fast with almost no wobble. Layout moves use `snap`; entrances use `enter`; collapses use `fold`.
 */
export const snap: Transition = { type: 'spring', stiffness: 620, damping: 42, mass: 0.7 }
export const soft: Transition = { type: 'spring', stiffness: 380, damping: 34, mass: 0.8 }
export const enter: Transition = { duration: 0.16, ease: [0.2, 0.9, 0.25, 1] }
export const fold: Transition = { duration: 0.2, ease: [0.2, 0.9, 0.25, 1] }

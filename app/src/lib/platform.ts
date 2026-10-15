/** The host OS also applies before the first backend snapshot arrives. */
export const isMacOS = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
export const primaryModifier = isMacOS ? 'Cmd' : 'Ctrl'

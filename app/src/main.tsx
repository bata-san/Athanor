import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { LazyMotion, MotionConfig, domMax } from 'motion/react'
import { App } from './App'
import { NotificationSurface } from './components/Notifications'
import { useAppStore } from './lib/store'
import { useLocale } from './lib/i18n'
import './styles/app.css'

/**
 * Appearance preferences that follow the person, not the screen: interface size, Reduce Motion and Increase Contrast.
 * The system settings are honoured by CSS (`prefers-*`); these switches add to them.
 */
function Root() {
  const scale = useAppStore((state) => state.snapshot?.settings.uiScale ?? 100)
  const reduce = useAppStore((state) => state.snapshot?.settings.reduceMotion ?? false)
  const contrast = useAppStore((state) => state.snapshot?.settings.highContrast ?? false)
  const locale = useLocale()
  useEffect(() => {
    const root = document.documentElement
    root.lang = locale
    root.style.setProperty('--ath-ui-scale', String(scale / 100))
    if (reduce) root.dataset.reduceMotion = 'true'; else delete root.dataset.reduceMotion
    if (contrast) root.dataset.contrast = 'high'; else delete root.dataset.contrast
  }, [scale, reduce, contrast, locale])
  return <MotionConfig reducedMotion={reduce ? 'always' : 'user'}>{window.location.hash === '#/notifications' ? <NotificationSurface /> : <App />}</MotionConfig>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><LazyMotion features={domMax} strict><Root /></LazyMotion></React.StrictMode>)

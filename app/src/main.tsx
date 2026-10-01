import React from 'react'
import { createRoot } from 'react-dom/client'
import { LazyMotion, MotionConfig, domMax } from 'motion/react'
import { App } from './App'
import './styles/app.css'

createRoot(document.getElementById('root')!).render(<React.StrictMode><LazyMotion features={domMax} strict><MotionConfig reducedMotion="user"><App /></MotionConfig></LazyMotion></React.StrictMode>)

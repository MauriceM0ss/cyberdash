import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { initThemeSync, watchTheme } from './theme.js'
import './index.css'

// Stamp a theme synchronously before the first paint (avoids a light/dark
// flash), then hand off to the live desktop-driven source of truth.
initThemeSync()
watchTheme()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

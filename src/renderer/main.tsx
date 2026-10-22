import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './styles/main.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element missing')

// Guard for opening the renderer URL in a plain browser: the preload bridge
// only exists inside the Electron app.
if (!('openleaf' in window)) {
  container.innerHTML = `
    <div class="browser-guard">
      <div class="browser-guard-title">Verso</div>
      <div class="browser-guard-text">
        This interface only works inside the Verso app.<br/>
        Start it with <code>npm run dev</code> or launch the installed application.
      </div>
    </div>`
} else {
  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

import type { OpenLeafApi } from './index'

declare global {
  interface Window {
    openleaf: OpenLeafApi
  }
}

export {}

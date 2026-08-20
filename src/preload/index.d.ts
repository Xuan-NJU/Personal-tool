import type { PersonalToolAPI } from '../shared/types'

declare global {
  interface Window {
    personalTool: PersonalToolAPI
  }
}

export {}

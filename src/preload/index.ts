import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSnapshot,
  ManualEntryInput,
  DailyTodoInput,
  NotionSettingsInput,
  NotionTestInput,
  PersonalToolAPI,
  PresetInput,
  ReminderSettingsInput,
  ResearchIdeaInput,
  TimerStartInput
} from '../shared/types'

const api: PersonalToolAPI = {
  getSnapshot: () => ipcRenderer.invoke('app:get-snapshot'),
  timerStart: (input: TimerStartInput) => ipcRenderer.invoke('timer:start', input),
  timerPause: () => ipcRenderer.invoke('timer:pause'),
  timerResume: () => ipcRenderer.invoke('timer:resume'),
  timerFinish: () => ipcRenderer.invoke('timer:finish'),
  timerReset: () => ipcRenderer.invoke('timer:reset'),
  acknowledgeTimerCompletion: (id: string) => ipcRenderer.invoke('timer:acknowledge-completion', id),
  savePreset: (input: PresetInput) => ipcRenderer.invoke('preset:save', input),
  deletePreset: (id: string) => ipcRenderer.invoke('preset:delete', id),
  createEntry: (input: ManualEntryInput) => ipcRenderer.invoke('entry:create', input),
  deleteEntry: (id: string) => ipcRenderer.invoke('entry:delete', id),
  saveTodo: (input: DailyTodoInput) => ipcRenderer.invoke('todo:save', input),
  toggleTodo: (id: string) => ipcRenderer.invoke('todo:toggle', id),
  deleteTodo: (id: string) => ipcRenderer.invoke('todo:delete', id),
  saveIdea: (input: ResearchIdeaInput) => ipcRenderer.invoke('idea:save', input),
  deleteIdea: (id: string) => ipcRenderer.invoke('idea:delete', id),
  updateReminderSettings: (input: ReminderSettingsInput) => ipcRenderer.invoke('reminders:update-settings', input),
  updateNotionSettings: (input: NotionSettingsInput) => ipcRenderer.invoke('notion:update-settings', input),
  testNotion: (input: NotionTestInput) => ipcRenderer.invoke('notion:test', input),
  syncNotion: () => ipcRenderer.invoke('notion:sync'),
  onSnapshot: (callback: (snapshot: AppSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot): void => callback(snapshot)
    ipcRenderer.on('snapshot:changed', listener)
    return () => ipcRenderer.removeListener('snapshot:changed', listener)
  }
}

contextBridge.exposeInMainWorld('personalTool', api)

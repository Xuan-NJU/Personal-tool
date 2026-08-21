import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, session, Tray } from 'electron'
import { join } from 'node:path'
import type {
  AppSnapshot,
  CalendarEntry,
  DailyTodoInput,
  ManualEntryInput,
  NotionSettingsInput,
  NotionTestInput,
  PresetInput,
  ResearchIdeaInput,
  TimerStartInput
} from '../shared/types'
import { elapsedMs, isTimerDue } from '../shared/timer'
import {
  deleteCalendarEntry,
  deleteIdea as deleteIdeaMutation,
  deleteTodo as deleteTodoMutation,
  saveIdea as saveIdeaMutation,
  saveTodo as saveTodoMutation,
  toggleTodo as toggleTodoMutation
} from './content'
import { NotionService } from './notion'
import { AppStore } from './store'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let finishingTimer = false
let syncPromise: Promise<AppSnapshot> | null = null

const store = new AppStore(process.env.PERSONAL_TOOL_DATA_DIR)
const notion = new NotionService(store)

function notifyRenderer(snapshot: AppSnapshot): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('snapshot:changed', snapshot)
  }
}

async function broadcastCurrent(): Promise<void> {
  notifyRenderer(await store.getSnapshot())
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 760,
    minHeight: 640,
    show: false,
    title: 'Personal Tool',
    backgroundColor: '#f7f5f1',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window.show())
  window.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      window.hide()
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

function createTray(): void {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <circle cx="16" cy="17" r="12" fill="#d9573f"/>
      <path d="M16 7c-1.8-3.2-5.5-2.8-7-1 2.3.1 3.8 1.2 4.8 3.2C11 8.5 9 9.1 7.7 10.4c3.3.8 6.2.2 8.3-1.5 2.1 1.7 5 2.3 8.3 1.5C23 9.1 21 8.5 18.2 9.2c1-2 2.5-3.1 4.8-3.2-1.5-1.8-5.2-2.2-7 1Z" fill="#426b52"/>
    </svg>`
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('Personal Tool')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '显示 Personal Tool',
        click: () => {
          mainWindow?.show()
          mainWindow?.focus()
        }
      },
      { type: 'separator' },
      {
        label: '暂停 / 继续计时',
        click: async () => {
          const snapshot = await store.getSnapshot()
          if (!snapshot.activeTimer) return
          await (snapshot.activeTimer.status === 'running' ? pauseTimer() : resumeTimer())
        }
      },
      {
        label: '完成当前计时',
        click: () => void finishTimer(false)
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('double-click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
}

async function startTimer(input: TimerStartInput): Promise<AppSnapshot> {
  const title = input.title.trim() || '专注'
  const durationSeconds = input.durationSeconds ?? 0
  if (input.mode === 'countdown' && (!Number.isFinite(durationSeconds) || durationSeconds <= 0)) {
    throw new Error('倒计时需要大于 0 的时长。')
  }
  const snapshot = await store.update((draft) => {
    if (draft.activeTimer) throw new Error('已有一个正在进行的计时。')
    const now = new Date().toISOString()
    draft.activeTimer = {
      id: crypto.randomUUID(),
      mode: input.mode,
      status: 'running',
      title,
      presetId: input.presetId,
      plannedDurationMs: durationSeconds > 0 ? Math.round(durationSeconds * 1000) : null,
      startedAt: now,
      runningSince: now,
      accumulatedMs: 0,
      autoSync: input.autoSync ?? true
    }
  })
  notifyRenderer(snapshot)
  return snapshot
}

async function pauseTimer(): Promise<AppSnapshot> {
  const snapshot = await store.update((draft) => {
    const timer = draft.activeTimer
    if (!timer || timer.status === 'paused') return
    timer.accumulatedMs = elapsedMs(timer)
    timer.runningSince = null
    timer.status = 'paused'
  })
  notifyRenderer(snapshot)
  return snapshot
}

async function resumeTimer(): Promise<AppSnapshot> {
  const snapshot = await store.update((draft) => {
    const timer = draft.activeTimer
    if (!timer || timer.status === 'running') return
    timer.runningSince = new Date().toISOString()
    timer.status = 'running'
  })
  notifyRenderer(snapshot)
  return snapshot
}

async function finishTimer(automatic: boolean): Promise<AppSnapshot> {
  if (finishingTimer) return store.getSnapshot()
  finishingTimer = true
  try {
    let finishedTitle: string | undefined
    let shouldSync = false
    const snapshot = await store.update((draft) => {
      const timer = draft.activeTimer
      if (!timer) return
      const nowMs = Date.now()
      const measuredMs = elapsedMs(timer, nowMs)
      const reachedCountdownEnd =
        timer.mode === 'countdown' &&
        timer.plannedDurationMs !== null &&
        measuredMs >= timer.plannedDurationMs
      const focusMs = reachedCountdownEnd ? (timer.plannedDurationMs as number) : measuredMs
      const finishMs =
        automatic && reachedCountdownEnd ? nowMs - Math.max(0, measuredMs - focusMs) : nowMs
      const notionSettings = draft.settings.notion
      shouldSync =
        timer.autoSync &&
        notionSettings.autoSyncPomodoros &&
        notionSettings.tokenConfigured &&
        Boolean(notionSettings.databaseId)
      const now = new Date().toISOString()
      const entry: CalendarEntry = {
        id: crypto.randomUUID(),
        kind: 'pomodoro',
        source: 'local',
        title: timer.title,
        notes: '',
        startAt: timer.startedAt,
        endAt: new Date(Math.max(new Date(timer.startedAt).getTime() + 1000, finishMs)).toISOString(),
        focusMs,
        plannedDurationMs: timer.plannedDurationMs ?? undefined,
        timerMode: timer.mode,
        syncStatus: shouldSync ? 'pending' : 'local',
        ...(shouldSync ? { notionDatabaseId: notionSettings.databaseId } : {}),
        createdAt: now,
        updatedAt: now
      }
      draft.entries.push(entry)
      draft.activeTimer = null
      finishedTitle = entry.title
    })
    notifyRenderer(snapshot)
    if (finishedTitle && Notification.isSupported()) {
      new Notification({
        title: automatic ? '番茄钟完成' : '已记录本次专注',
        body: finishedTitle
      }).show()
    }
    if (shouldSync) syncInBackground()
    return snapshot
  } finally {
    finishingTimer = false
  }
}

async function resetTimer(): Promise<AppSnapshot> {
  const snapshot = await store.update((draft) => {
    draft.activeTimer = null
  })
  notifyRenderer(snapshot)
  return snapshot
}

async function savePreset(input: PresetInput): Promise<AppSnapshot> {
  const name = input.name.trim()
  const durationSeconds = Math.round(input.durationSeconds)
  if (!name) throw new Error('预设名称不能为空。')
  if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 24 * 60 * 60) {
    throw new Error('预设时长必须在 1 秒到 24 小时之间。')
  }
  const snapshot = await store.update((draft) => {
    const now = new Date().toISOString()
    const existing = input.id ? draft.presets.find((preset) => preset.id === input.id) : undefined
    if (input.isDefault) draft.presets.forEach((preset) => (preset.isDefault = false))
    if (existing) {
      existing.name = name
      existing.durationSeconds = durationSeconds
      existing.isDefault = input.isDefault ?? existing.isDefault
      existing.updatedAt = now
    } else {
      draft.presets.push({
        id: crypto.randomUUID(),
        name,
        durationSeconds,
        isDefault: input.isDefault ?? false,
        createdAt: now,
        updatedAt: now
      })
    }
    if (!draft.presets.some((preset) => preset.isDefault)) draft.presets[0]!.isDefault = true
  })
  notifyRenderer(snapshot)
  return snapshot
}

async function deletePreset(id: string): Promise<AppSnapshot> {
  const snapshot = await store.update((draft) => {
    if (draft.presets.length <= 1) throw new Error('至少需要保留一个常用时长。')
    const removed = draft.presets.find((preset) => preset.id === id)
    draft.presets = draft.presets.filter((preset) => preset.id !== id)
    if (removed?.isDefault && draft.presets[0]) draft.presets[0].isDefault = true
  })
  notifyRenderer(snapshot)
  return snapshot
}

async function createEntry(input: ManualEntryInput): Promise<AppSnapshot> {
  const title = input.title.trim()
  const startMs = new Date(input.startAt).getTime()
  const endMs = new Date(input.endAt).getTime()
  if (!title) throw new Error('活动标题不能为空。')
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error('活动结束时间必须晚于开始时间。')
  }
  const snapshot = await store.update((draft) => {
    const notionSettings = draft.settings.notion
    const shouldSync =
      notionSettings.autoSyncManual && notionSettings.tokenConfigured && Boolean(notionSettings.databaseId)
    const now = new Date().toISOString()
    draft.entries.push({
      id: crypto.randomUUID(),
      kind: 'manual',
      source: 'local',
      title,
      notes: input.notes.trim(),
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(endMs).toISOString(),
      syncStatus: shouldSync ? 'pending' : 'local',
      ...(shouldSync ? { notionDatabaseId: notionSettings.databaseId } : {}),
      createdAt: now,
      updatedAt: now
    })
  })
  notifyRenderer(snapshot)
  const created = snapshot.entries.at(-1)
  if (created?.syncStatus === 'pending') syncInBackground()
  return snapshot
}

async function deleteEntry(id: string): Promise<AppSnapshot> {
  let removed: CalendarEntry | undefined
  const snapshot = await store.update((draft) => {
    removed = deleteCalendarEntry(draft, id)
    if (removed && !removed.notionPageId && removed.syncStatus === 'local') {
      // A never-synced local entry has no remote side effect to retry.
      draft.notionDeletions = draft.notionDeletions.filter((deletion) => deletion.entryId !== removed?.id)
    }
  })
  if (!removed) return snapshot
  notifyRenderer(snapshot)
  if (
    snapshot.settings.notion.tokenConfigured &&
    snapshot.settings.notion.databaseId &&
    snapshot.notionDeletions.some(
      (deletion) =>
        deletion.entryId === removed?.id &&
        (!deletion.databaseId || deletion.databaseId === snapshot.settings.notion.databaseId)
    )
  ) {
    syncInBackground()
  }
  return snapshot
}

async function saveTodo(input: DailyTodoInput): Promise<AppSnapshot> {
  const snapshot = await store.update((draft) => {
    saveTodoMutation(draft, input)
  })
  notifyRenderer(snapshot)
  return snapshot
}

async function toggleTodo(id: string): Promise<AppSnapshot> {
  const snapshot = await store.update((draft) => {
    toggleTodoMutation(draft, id)
  })
  notifyRenderer(snapshot)
  return snapshot
}

async function deleteTodo(id: string): Promise<AppSnapshot> {
  const snapshot = await store.update((draft) => {
    deleteTodoMutation(draft, id)
  })
  notifyRenderer(snapshot)
  return snapshot
}

async function saveIdea(input: ResearchIdeaInput): Promise<AppSnapshot> {
  const snapshot = await store.update((draft) => {
    saveIdeaMutation(draft, input)
  })
  notifyRenderer(snapshot)
  return snapshot
}

async function deleteIdea(id: string): Promise<AppSnapshot> {
  const snapshot = await store.update((draft) => {
    deleteIdeaMutation(draft, id)
  })
  notifyRenderer(snapshot)
  return snapshot
}

function syncInBackground(): void {
  void syncNow()
    .then((snapshot) => notifyRenderer(snapshot))
    .catch(() => broadcastCurrent())
}

function syncNow(): Promise<AppSnapshot> {
  if (syncPromise) return syncPromise
  syncPromise = notion.syncAll().finally(() => {
    syncPromise = null
  })
  return syncPromise
}

function registerIpc(): void {
  ipcMain.handle('app:get-snapshot', () => store.getSnapshot())
  ipcMain.handle('timer:start', (_event, input: TimerStartInput) => startTimer(input))
  ipcMain.handle('timer:pause', () => pauseTimer())
  ipcMain.handle('timer:resume', () => resumeTimer())
  ipcMain.handle('timer:finish', () => finishTimer(false))
  ipcMain.handle('timer:reset', () => resetTimer())
  ipcMain.handle('preset:save', (_event, input: PresetInput) => savePreset(input))
  ipcMain.handle('preset:delete', (_event, id: string) => deletePreset(id))
  ipcMain.handle('entry:create', (_event, input: ManualEntryInput) => createEntry(input))
  ipcMain.handle('entry:delete', (_event, id: string) => deleteEntry(id))
  ipcMain.handle('todo:save', (_event, input: DailyTodoInput) => saveTodo(input))
  ipcMain.handle('todo:toggle', (_event, id: string) => toggleTodo(id))
  ipcMain.handle('todo:delete', (_event, id: string) => deleteTodo(id))
  ipcMain.handle('idea:save', (_event, input: ResearchIdeaInput) => saveIdea(input))
  ipcMain.handle('idea:delete', (_event, id: string) => deleteIdea(id))
  ipcMain.handle('notion:update-settings', async (_event, input: NotionSettingsInput) => {
    const snapshot = await notion.saveSettings(input)
    notifyRenderer(snapshot)
    return snapshot
  })
  ipcMain.handle('notion:test', async (_event, input: NotionTestInput) => {
    const result = await notion.testConnection(input)
    await broadcastCurrent()
    return result
  })
  ipcMain.handle('notion:sync', async () => {
    const snapshot = await syncNow()
    notifyRenderer(snapshot)
    return snapshot
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    await store.initialize()
    registerIpc()
    mainWindow = createMainWindow()
    createTray()

    const initial = await store.getSnapshot()
    if (initial.activeTimer && isTimerDue(initial.activeTimer)) await finishTimer(true)

    setInterval(async () => {
      const snapshot = await store.getSnapshot()
      if (snapshot.activeTimer && isTimerDue(snapshot.activeTimer)) void finishTimer(true)
    }, 1000).unref()

    setInterval(async () => {
      const snapshot = await store.getSnapshot()
      const notionSettings = snapshot.settings.notion
      const hasQueuedEntries = snapshot.entries.some(
        (entry) =>
          ['pending', 'error'].includes(entry.syncStatus) &&
          (!entry.notionDatabaseId || entry.notionDatabaseId === notionSettings.databaseId)
      )
      const hasQueuedDeletions = snapshot.notionDeletions.some(
        (deletion) => !deletion.databaseId || deletion.databaseId === notionSettings.databaseId
      )
      if (
        notionSettings.tokenConfigured &&
        notionSettings.databaseId &&
        (hasQueuedEntries || hasQueuedDeletions)
      ) {
        syncInBackground()
      }
    }, 60_000).unref()

    app.on('activate', () => {
      if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow()
      mainWindow.show()
    })
  })
}

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  // Keep the process alive for the tray timer on Windows and macOS.
})

import { app, BrowserWindow, ipcMain, Menu, nativeImage, net, Notification, powerMonitor, session, shell, Tray } from 'electron'
import { join } from 'node:path'
import type {
  AppSnapshot,
  CalendarEntry,
  DailyTodoInput,
  ManualEntryInput,
  NotionSettingsInput,
  NotionTestInput,
  PresetInput,
  ReminderSettingsInput,
  ResearchIdeaInput,
  TimerCompletion,
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
import { shouldRunNotionBackgroundSync } from './notion-background-sync'
import { NotionService } from './notion'
import { AppStore } from './store'
import { completeActiveTimer } from './timer-completion'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let finishingTimer = false
let syncPromise: Promise<AppSnapshot> | null = null
let syncPromiseKey: string | null = null
const liveNotifications = new Set<Notification>()

const store = new AppStore(process.env.PERSONAL_TOOL_DATA_DIR)
// Chromium's network stack follows the user's Windows proxy and certificate
// configuration more reliably than Node's built-in fetch in packaged Electron.
const notion = new NotionService(store, (input, init) => net.fetch(input, init))

function notifyRenderer(snapshot: AppSnapshot): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      try {
        window.webContents.send('snapshot:changed', snapshot)
      } catch {
        // A renderer can disappear between the destroyed check and send.
      }
    }
  }
}

async function broadcastCurrent(): Promise<void> {
  notifyRenderer(await store.getSnapshot())
}

function stopWindowAttention(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    mainWindow.flashFrame(false)
  } catch {
    // Window attention is a best-effort reminder only.
  }
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    stopWindowAttention()
  } catch {
    // The window may be closing while a notification is clicked.
  }
}

function keepNotificationAlive(notification: Notification): void {
  liveNotifications.add(notification)
  const release = (): void => {
    liveNotifications.delete(notification)
  }
  notification.once('close', release)
  notification.once('failed', release)
  setTimeout(release, 60 * 60_000).unref()
}

function focusDurationLabel(focusMs: number): string {
  const totalSeconds = Math.max(1, Math.round(focusMs / 1_000))
  if (totalSeconds < 60) return `${totalSeconds} 秒`
  const totalMinutes = Math.round(totalSeconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours && minutes) return `${hours} 小时 ${minutes} 分钟`
  if (hours) return `${hours} 小时`
  return `${totalMinutes} 分钟`
}

function presentTimerCompletion(completion: TimerCompletion, snapshot: AppSnapshot): void {
  const reminders = snapshot.settings.reminders
  try {
    if (reminders.showWindow && mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      if (!mainWindow.isFocused()) {
        mainWindow.showInactive()
        mainWindow.moveTop()
      }
    }
  } catch {
    // The persistent in-app completion remains available on the next render.
  }

  if (reminders.flashTaskbar) {
    try {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
        mainWindow.flashFrame(true)
      }
    } catch {
      // Some Windows configurations do not expose a flashable taskbar button.
    }
  }

  if (reminders.playSound) {
    try {
      shell.beep()
    } catch {
      // Sound must never affect saving the completed session.
    }
  }

  if (reminders.systemNotification) {
    try {
      if (!Notification.isSupported()) return
      const notification = new Notification({
        title: '番茄钟完成 · 该休息一下了',
        body: `${completion.title} · 已专注 ${focusDurationLabel(completion.focusMs)}`,
        silent: true,
        timeoutType: 'never',
        urgency: 'critical'
      })
      notification.on('click', showMainWindow)
      keepNotificationAlive(notification)
      notification.show()
    } catch {
      // The application modal, sound and taskbar attention remain as fallbacks.
    }
  }
}

function presentManualCompletion(title: string, snapshot: AppSnapshot): void {
  if (!snapshot.settings.reminders.systemNotification) return
  try {
    if (!Notification.isSupported()) return
    const notification = new Notification({
      title: '已记录本次专注',
      body: title,
      silent: true
    })
    notification.on('click', showMainWindow)
    keepNotificationAlive(notification)
    notification.show()
  } catch {
    // Renderer feedback already confirms manual completion.
  }
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
  window.on('focus', stopWindowAttention)
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
        click: showMainWindow
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
        click: () => void finishTimer(false).catch(() => undefined)
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
    showMainWindow()
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
  const completionBox: { value: ReturnType<typeof completeActiveTimer> } = { value: null }
  const snapshot = await store.update((draft) => {
    const timer = draft.activeTimer
    if (!timer || timer.status === 'paused') return
    const nowMs = Date.now()
    if (isTimerDue(timer, nowMs)) {
      completionBox.value = completeActiveTimer(draft, {
        automatic: true,
        nowMs,
        expectedTimerId: timer.id
      })
      return
    }
    timer.accumulatedMs = elapsedMs(timer, nowMs)
    timer.runningSince = null
    timer.status = 'paused'
  })
  notifyRenderer(snapshot)
  const completionResult = completionBox.value
  if (completionResult) presentCompletedTimer(snapshot, completionResult, true)
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
    const completionBox: { value: ReturnType<typeof completeActiveTimer> } = { value: null }
    const snapshot = await store.update((draft) => {
      completionBox.value = completeActiveTimer(draft, { automatic })
    })
    const completionResult = completionBox.value
    if (!completionResult) return snapshot
    notifyRenderer(snapshot)
    presentCompletedTimer(snapshot, completionResult, automatic)
    return snapshot
  } finally {
    finishingTimer = false
  }
}

function presentCompletedTimer(
  snapshot: AppSnapshot,
  completionResult: NonNullable<ReturnType<typeof completeActiveTimer>>,
  automatic: boolean
): void {
  if (completionResult.shouldSync) syncInBackground()
  if (automatic && snapshot.pendingTimerCompletion) {
    presentTimerCompletion(snapshot.pendingTimerCompletion, snapshot)
  } else {
    presentManualCompletion(completionResult.entry.title, snapshot)
  }
}

async function acknowledgeTimerCompletion(id: string): Promise<AppSnapshot> {
  const snapshot = await store.update((draft) => {
    if (draft.pendingTimerCompletion?.id === id) draft.pendingTimerCompletion = null
  })
  stopWindowAttention()
  notifyRenderer(snapshot)
  return snapshot
}

async function updateReminderSettings(input: ReminderSettingsInput): Promise<AppSnapshot> {
  const values = [input.systemNotification, input.playSound, input.showWindow, input.flashTaskbar]
  if (values.some((value) => typeof value !== 'boolean')) throw new Error('提醒设置格式不正确。')
  const snapshot = await store.update((draft) => {
    draft.settings.reminders = { ...input }
  })
  notifyRenderer(snapshot)
  return snapshot
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

async function syncConfiguredNotionInBackground(): Promise<void> {
  const snapshot = await store.getSnapshot()
  if (snapshot.settings.notion.tokenConfigured && snapshot.settings.notion.databaseId) {
    syncInBackground()
  }
}

async function syncNow(): Promise<AppSnapshot> {
  let requestedKey = await notion.getSyncKey()
  while (syncPromise) {
    if (syncPromiseKey === requestedKey) return syncPromise
    await syncPromise.catch(() => undefined)
    requestedKey = await notion.getSyncKey()
  }

  const promise = notion.syncAll()
  syncPromise = promise
  syncPromiseKey = requestedKey
  try {
    return await promise
  } finally {
    if (syncPromise === promise) {
      syncPromise = null
      syncPromiseKey = null
    }
  }
}

function registerIpc(): void {
  ipcMain.handle('app:get-snapshot', () => store.getSnapshot())
  ipcMain.handle('timer:start', (_event, input: TimerStartInput) => startTimer(input))
  ipcMain.handle('timer:pause', () => pauseTimer())
  ipcMain.handle('timer:resume', () => resumeTimer())
  ipcMain.handle('timer:finish', () => finishTimer(false))
  ipcMain.handle('timer:reset', () => resetTimer())
  ipcMain.handle('timer:acknowledge-completion', (_event, id: string) => acknowledgeTimerCompletion(id))
  ipcMain.handle('preset:save', (_event, input: PresetInput) => savePreset(input))
  ipcMain.handle('preset:delete', (_event, id: string) => deletePreset(id))
  ipcMain.handle('entry:create', (_event, input: ManualEntryInput) => createEntry(input))
  ipcMain.handle('entry:delete', (_event, id: string) => deleteEntry(id))
  ipcMain.handle('todo:save', (_event, input: DailyTodoInput) => saveTodo(input))
  ipcMain.handle('todo:toggle', (_event, id: string) => toggleTodo(id))
  ipcMain.handle('todo:delete', (_event, id: string) => deleteTodo(id))
  ipcMain.handle('idea:save', (_event, input: ResearchIdeaInput) => saveIdea(input))
  ipcMain.handle('idea:delete', (_event, id: string) => deleteIdea(id))
  ipcMain.handle('reminders:update-settings', (_event, input: ReminderSettingsInput) => updateReminderSettings(input))
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

app.setAppUserModelId('com.xuannju.personaltool')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    await store.initialize()
    registerIpc()
    mainWindow = createMainWindow()
    createTray()

    const initial = await store.getSnapshot()
    if (initial.activeTimer && isTimerDue(initial.activeTimer)) {
      await finishTimer(true)
    } else if (initial.pendingTimerCompletion) {
      presentTimerCompletion(initial.pendingTimerCompletion, initial)
    }

    setInterval(() => {
      void store.getSnapshot().then((snapshot) => {
        if (snapshot.activeTimer && isTimerDue(snapshot.activeTimer)) return finishTimer(true)
        return undefined
      }).catch(() => undefined)
    }, 1000).unref()

    setInterval(async () => {
      const snapshot = await store.getSnapshot()
      if (shouldRunNotionBackgroundSync(snapshot, Date.now())) syncInBackground()
    }, 60_000).unref()

    // Revalidate shortly after launch so an old transient "fetch failed" state
    // heals without asking the user to re-enter credentials.
    setTimeout(() => void syncConfiguredNotionInBackground(), 3_000).unref()
    powerMonitor.on('resume', () => {
      void store.getSnapshot().then((snapshot) => {
        if (snapshot.activeTimer && isTimerDue(snapshot.activeTimer)) return finishTimer(true)
        return undefined
      }).catch(() => undefined)
      setTimeout(() => void syncConfiguredNotionInBackground(), 3_000).unref()
    })

    app.on('activate', () => {
      if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow()
      showMainWindow()
    })
  })
}

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  // Keep the process alive for the tray timer on Windows and macOS.
})

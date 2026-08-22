import { describe, expect, it } from 'vitest'
import type { AppSnapshot, CalendarEntry } from '../shared/types'
import { deleteCalendarEntry, deleteIdea, deleteTodo, saveIdea, saveTodo, toggleTodo } from './content'

const firstTime = '2026-08-21T01:00:00.000Z'
const secondTime = '2026-08-21T02:00:00.000Z'

function createSnapshot(): AppSnapshot {
  return {
    version: 3,
    presets: [],
    activeTimer: null,
    pendingTimerCompletion: null,
    entries: [],
    todos: [],
    ideas: [],
    notionDeletions: [],
    settings: {
      reminders: {
        systemNotification: true,
        playSound: true,
        showWindow: true,
        flashTaskbar: true
      },
      notion: {
        databaseId: '',
        connected: false,
        tokenConfigured: false,
        autoSyncPomodoros: true,
        autoSyncManual: true
      }
    }
  }
}

describe('daily TODO mutations', () => {
  it('creates, updates, toggles and deletes a TODO', () => {
    const draft = createSnapshot()
    const created = saveTodo(
      draft,
      {
        dateKey: '2026-08-21',
        title: '  整理实验结果  ',
        notes: '  汇总三次运行  ',
        priority: 'high'
      },
      { now: firstTime, createId: () => 'todo-1' }
    )

    expect(created).toEqual({
      id: 'todo-1',
      dateKey: '2026-08-21',
      title: '整理实验结果',
      notes: '汇总三次运行',
      priority: 'high',
      completed: false,
      createdAt: firstTime,
      updatedAt: firstTime
    })

    const updated = saveTodo(
      draft,
      {
        id: created.id,
        dateKey: '2026-08-22',
        title: '整理消融实验',
        notes: '',
        priority: 'medium'
      },
      { now: secondTime }
    )
    expect(updated).toMatchObject({
      id: 'todo-1',
      dateKey: '2026-08-22',
      title: '整理消融实验',
      priority: 'medium',
      createdAt: firstTime,
      updatedAt: secondTime
    })

    expect(toggleTodo(draft, created.id, { now: secondTime })).toMatchObject({
      completed: true,
      completedAt: secondTime
    })
    expect(toggleTodo(draft, created.id, { now: secondTime })).toMatchObject({ completed: false })
    expect(draft.todos[0]).not.toHaveProperty('completedAt')

    expect(deleteTodo(draft, created.id)).toBe(true)
    expect(deleteTodo(draft, created.id)).toBe(false)
    expect(draft.todos).toEqual([])
  })

  it('rejects invalid dates, priorities and missing update targets', () => {
    const draft = createSnapshot()
    expect(() =>
      saveTodo(draft, { dateKey: '2026-02-30', title: '任务', notes: '', priority: 'low' })
    ).toThrow('计划日期不是有效日期')
    expect(() =>
      saveTodo(draft, {
        dateKey: '2026-08-21',
        title: '任务',
        notes: '',
        priority: 'urgent' as 'high'
      })
    ).toThrow('待办优先级不正确')
    expect(() =>
      saveTodo(draft, {
        id: 'missing',
        dateKey: '2026-08-21',
        title: '任务',
        notes: '',
        priority: 'low'
      })
    ).toThrow('没有找到要更新的待办事项')
  })
})

describe('research IDEA mutations', () => {
  it('creates, normalizes, updates and deletes an IDEA', () => {
    const draft = createSnapshot()
    const created = saveIdea(
      draft,
      {
        title: '  自适应采样  ',
        summary: '  根据不确定性分配采样预算。  ',
        tags: [' sensing ', 'ML', 'SENSING', ''],
        status: 'seed'
      },
      { now: firstTime, createId: () => 'idea-1' }
    )

    expect(created).toEqual({
      id: 'idea-1',
      title: '自适应采样',
      summary: '根据不确定性分配采样预算。',
      tags: ['sensing', 'ML'],
      status: 'seed',
      createdAt: firstTime,
      updatedAt: firstTime
    })

    const updated = saveIdea(
      draft,
      {
        id: created.id,
        title: created.title,
        summary: '先做合成数据验证。',
        tags: ['simulation'],
        status: 'validated'
      },
      { now: secondTime }
    )
    expect(updated).toMatchObject({
      id: 'idea-1',
      summary: '先做合成数据验证。',
      tags: ['simulation'],
      status: 'validated',
      createdAt: firstTime,
      updatedAt: secondTime
    })

    expect(deleteIdea(draft, created.id)).toBe(true)
    expect(deleteIdea(draft, created.id)).toBe(false)
    expect(draft.ideas).toEqual([])
  })

  it('rejects unsupported statuses', () => {
    expect(() =>
      saveIdea(createSnapshot(), {
        title: '想法',
        summary: '',
        tags: [],
        status: 'published' as 'seed'
      })
    ).toThrow('IDEA 状态不正确')
  })
})

describe('calendar entry deletion', () => {
  it('removes the entry and records a Notion deletion tombstone', () => {
    const draft = createSnapshot()
    draft.settings.notion.databaseId = 'database-1'
    const entry: CalendarEntry = {
      id: 'entry-1',
      kind: 'manual',
      source: 'local',
      title: '组会',
      notes: '',
      startAt: '2026-08-21T02:00:00.000Z',
      endAt: '2026-08-21T03:00:00.000Z',
      syncStatus: 'synced',
      notionPageId: 'page-1',
      notionDatabaseId: 'database-1',
      createdAt: firstTime,
      updatedAt: firstTime
    }
    draft.entries.push(entry)

    expect(
      deleteCalendarEntry(draft, entry.id, { now: secondTime, createId: () => 'deletion-1' })
    ).toEqual(entry)
    expect(draft.entries).toEqual([])
    expect(draft.notionDeletions).toEqual([
      {
        id: 'deletion-1',
        entryId: 'entry-1',
        notionPageId: 'page-1',
        databaseId: 'database-1',
        title: '组会',
        startAt: entry.startAt,
        endAt: entry.endAt,
        requestedAt: secondTime
      }
    ])

    expect(deleteCalendarEntry(draft, entry.id)).toBeUndefined()
    expect(draft.notionDeletions).toHaveLength(1)
  })

  it('keeps a fingerprint tombstone when the entry has no remote page id yet', () => {
    const draft = createSnapshot()
    draft.settings.notion.databaseId = 'database-1'
    draft.entries.push({
      id: 'entry-pending',
      kind: 'manual',
      source: 'local',
      title: '待同步记录',
      notes: '',
      startAt: '2026-08-21T04:00:00.000Z',
      endAt: '2026-08-21T05:00:00.000Z',
      syncStatus: 'pending',
      notionDatabaseId: 'database-1',
      createdAt: firstTime,
      updatedAt: firstTime
    })

    deleteCalendarEntry(draft, 'entry-pending', { now: secondTime, createId: () => 'deletion-2' })
    expect(draft.notionDeletions[0]).toMatchObject({
      id: 'deletion-2',
      entryId: 'entry-pending',
      databaseId: 'database-1',
      title: '待同步记录'
    })
    expect(draft.notionDeletions[0]).not.toHaveProperty('notionPageId')
  })

  it('does not create a tombstone for a purely local entry', () => {
    const draft = createSnapshot()
    draft.entries.push({
      id: 'entry-local',
      kind: 'manual',
      source: 'local',
      title: '本地记录',
      notes: '',
      startAt: '2026-08-21T06:00:00.000Z',
      endAt: '2026-08-21T07:00:00.000Z',
      syncStatus: 'local',
      createdAt: firstTime,
      updatedAt: firstTime
    })

    deleteCalendarEntry(draft, 'entry-local', { now: secondTime, createId: () => 'unused' })
    expect(draft.entries).toEqual([])
    expect(draft.notionDeletions).toEqual([])
  })
})

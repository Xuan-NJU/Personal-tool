import { randomUUID } from 'node:crypto'
import type {
  AppSnapshot,
  CalendarEntry,
  DailyTodo,
  DailyTodoInput,
  ResearchIdea,
  ResearchIdeaInput,
  ResearchIdeaStatus,
  TodoPriority
} from '../shared/types'

const TODO_PRIORITIES = new Set<TodoPriority>(['low', 'medium', 'high'])
const IDEA_STATUSES = new Set<ResearchIdeaStatus>(['seed', 'exploring', 'validated', 'archived'])
const TODO_TITLE_LIMIT = 120
const TODO_NOTES_LIMIT = 2_000
const IDEA_TITLE_LIMIT = 160
const IDEA_SUMMARY_LIMIT = 12_000
const IDEA_TAG_LIMIT = 12
const IDEA_TAG_LENGTH_LIMIT = 30

export interface ContentMutationContext {
  now?: string
  createId?: () => string
}

function mutationTime(context: ContentMutationContext): string {
  return context.now ?? new Date().toISOString()
}

function nextId(context: ContentMutationContext): string {
  return context.createId?.() ?? randomUUID()
}

function normalizedText(value: unknown, label: string, maximum: number, required: boolean): string {
  if (typeof value !== 'string') throw new Error(`${label}格式不正确。`)
  const normalized = value.trim()
  if (required && !normalized) throw new Error(`${label}不能为空。`)
  if (normalized.length > maximum) throw new Error(`${label}不能超过 ${maximum} 个字符。`)
  return normalized
}

function normalizedDateKey(value: unknown): string {
  if (typeof value !== 'string') throw new Error('计划日期格式不正确。')
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error('计划日期必须使用 YYYY-MM-DD 格式。')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    year < 1900 ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error('计划日期不是有效日期。')
  }
  return value
}

function normalizedPriority(value: unknown): TodoPriority {
  if (!TODO_PRIORITIES.has(value as TodoPriority)) throw new Error('待办优先级不正确。')
  return value as TodoPriority
}

function normalizedIdeaStatus(value: unknown): ResearchIdeaStatus {
  if (!IDEA_STATUSES.has(value as ResearchIdeaStatus)) throw new Error('IDEA 状态不正确。')
  return value as ResearchIdeaStatus
}

function normalizedTags(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('IDEA 标签格式不正确。')
  const tags: string[] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    if (typeof candidate !== 'string') throw new Error('IDEA 标签格式不正确。')
    const tag = candidate.trim()
    if (!tag) continue
    if (tag.length > IDEA_TAG_LENGTH_LIMIT) {
      throw new Error(`单个 IDEA 标签不能超过 ${IDEA_TAG_LENGTH_LIMIT} 个字符。`)
    }
    const key = tag.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
  }
  if (tags.length > IDEA_TAG_LIMIT) throw new Error(`每条 IDEA 最多使用 ${IDEA_TAG_LIMIT} 个标签。`)
  return tags
}

export function saveTodo(
  draft: AppSnapshot,
  input: DailyTodoInput,
  context: ContentMutationContext = {}
): DailyTodo {
  const dateKey = normalizedDateKey(input.dateKey)
  const title = normalizedText(input.title, '待办标题', TODO_TITLE_LIMIT, true)
  const notes = normalizedText(input.notes, '待办备注', TODO_NOTES_LIMIT, false)
  const priority = normalizedPriority(input.priority)
  const now = mutationTime(context)

  if (input.id !== undefined) {
    const id = normalizedText(input.id, '待办 ID', 200, true)
    const existing = draft.todos.find((todo) => todo.id === id)
    if (!existing) throw new Error('没有找到要更新的待办事项。')
    Object.assign(existing, { dateKey, title, notes, priority, updatedAt: now })
    return existing
  }

  const todo: DailyTodo = {
    id: nextId(context),
    dateKey,
    title,
    notes,
    priority,
    completed: false,
    createdAt: now,
    updatedAt: now
  }
  if (draft.todos.some((candidate) => candidate.id === todo.id)) throw new Error('待办 ID 重复，请重试。')
  draft.todos.push(todo)
  return todo
}

export function toggleTodo(
  draft: AppSnapshot,
  id: string,
  context: ContentMutationContext = {}
): DailyTodo {
  const existing = draft.todos.find((todo) => todo.id === id)
  if (!existing) throw new Error('没有找到要切换的待办事项。')
  const now = mutationTime(context)
  existing.completed = !existing.completed
  existing.updatedAt = now
  if (existing.completed) existing.completedAt = now
  else delete existing.completedAt
  return existing
}

export function deleteTodo(draft: AppSnapshot, id: string): boolean {
  const length = draft.todos.length
  draft.todos = draft.todos.filter((todo) => todo.id !== id)
  return draft.todos.length !== length
}

export function saveIdea(
  draft: AppSnapshot,
  input: ResearchIdeaInput,
  context: ContentMutationContext = {}
): ResearchIdea {
  const title = normalizedText(input.title, 'IDEA 标题', IDEA_TITLE_LIMIT, true)
  const summary = normalizedText(input.summary, 'IDEA 内容', IDEA_SUMMARY_LIMIT, false)
  const tags = normalizedTags(input.tags)
  const status = normalizedIdeaStatus(input.status)
  const now = mutationTime(context)

  if (input.id !== undefined) {
    const id = normalizedText(input.id, 'IDEA ID', 200, true)
    const existing = draft.ideas.find((idea) => idea.id === id)
    if (!existing) throw new Error('没有找到要更新的 IDEA。')
    Object.assign(existing, { title, summary, tags, status, updatedAt: now })
    return existing
  }

  const idea: ResearchIdea = {
    id: nextId(context),
    title,
    summary,
    tags,
    status,
    createdAt: now,
    updatedAt: now
  }
  if (draft.ideas.some((candidate) => candidate.id === idea.id)) throw new Error('IDEA ID 重复，请重试。')
  draft.ideas.push(idea)
  return idea
}

export function deleteIdea(draft: AppSnapshot, id: string): boolean {
  const length = draft.ideas.length
  draft.ideas = draft.ideas.filter((idea) => idea.id !== id)
  return draft.ideas.length !== length
}

export function deleteCalendarEntry(
  draft: AppSnapshot,
  id: string,
  context: ContentMutationContext = {}
): CalendarEntry | undefined {
  const index = draft.entries.findIndex((entry) => entry.id === id)
  if (index < 0) return undefined
  const entry = draft.entries[index]
  if (!entry) return undefined

  draft.entries.splice(index, 1)
  const needsNotionDeletion =
    Boolean(entry.notionPageId) ||
    entry.source === 'notion' ||
    entry.syncStatus === 'pending' ||
    entry.syncStatus === 'error'
  if (!needsNotionDeletion) return entry

  const databaseId = entry.notionDatabaseId || draft.settings.notion.databaseId || undefined
  const existingDeletion = draft.notionDeletions.find((deletion) => deletion.entryId === entry.id)
  if (!existingDeletion) {
    draft.notionDeletions.push({
      id: nextId(context),
      entryId: entry.id,
      ...(entry.notionPageId ? { notionPageId: entry.notionPageId } : {}),
      ...(databaseId ? { databaseId } : {}),
      title: entry.title,
      startAt: entry.startAt,
      endAt: entry.endAt,
      requestedAt: mutationTime(context)
    })
  } else {
    existingDeletion.notionPageId ??= entry.notionPageId
    existingDeletion.databaseId ??= databaseId
  }
  return entry
}

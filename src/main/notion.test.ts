import { describe, expect, it } from 'vitest'
import { inspectDatabase, normalizeDatabaseId, notionPageToEntry } from './notion'

describe('Notion helpers', () => {
  it('extracts a database id from a Notion URL', () => {
    expect(normalizeDatabaseId('https://www.notion.so/team/Tasks-0123456789abcdef0123456789abcdef?v=abc')).toBe(
      '01234567-89ab-cdef-0123-456789abcdef'
    )
  })

  it('discovers the title and date properties', () => {
    const info = inspectDatabase({
      id: 'db',
      title: [{ plain_text: 'Focus log' }],
      properties: {
        Name: { id: 'title', name: 'Name', type: 'title' },
        When: { id: 'date', name: 'When', type: 'date' }
      }
    })
    expect(info).toMatchObject({ name: 'Focus log', titleProperty: 'Name', dateProperty: 'When' })
  })

  it('converts a dated Notion page into an external calendar entry', () => {
    const entry = notionPageToEntry(
      {
        id: 'page-1',
        created_time: '2026-08-20T00:00:00.000Z',
        last_edited_time: '2026-08-20T01:00:00.000Z',
        properties: {
          Name: { title: [{ plain_text: 'Meeting' }] },
          When: { date: { start: '2026-08-20T02:00:00.000Z', end: '2026-08-20T03:00:00.000Z' } }
        }
      },
      { id: 'db', name: 'Calendar', titleProperty: 'Name', dateProperty: 'When' }
    )
    expect(entry).toMatchObject({ title: 'Meeting', kind: 'external', source: 'notion' })
  })
})

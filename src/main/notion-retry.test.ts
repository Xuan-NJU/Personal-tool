import { describe, expect, it } from 'vitest'
import { calculateNotionRetryDelay, classifyNotionError, planNotionRetry } from './notion-retry'

describe('Notion error classification', () => {
  it.each([
    [401, 'authentication'],
    [403, 'permission'],
    [404, 'configuration']
  ] as const)('classifies HTTP %s as a permanent credentials or configuration error', (status, category) => {
    expect(classifyNotionError({ name: 'NotionRequestError', status, code: 'notion_code' })).toEqual({
      category,
      retryable: false,
      status,
      code: 'notion_code'
    })
  })

  it.each([
    [408, 'timeout'],
    [429, 'rate-limit'],
    [500, 'server'],
    [503, 'server']
  ] as const)('classifies HTTP %s as temporary', (status, category) => {
    expect(classifyNotionError({ status })).toMatchObject({ category, retryable: true, status })
  })

  it('recognizes timeout codes nested under a fetch error cause', () => {
    const error = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect timed out'), { code: 'UND_ERR_CONNECT_TIMEOUT' })
    })
    expect(classifyNotionError(error)).toMatchObject({
      category: 'timeout',
      retryable: true,
      code: 'UND_ERR_CONNECT_TIMEOUT'
    })
  })

  it('recognizes ordinary fetch and DNS failures as network errors', () => {
    expect(classifyNotionError(new TypeError('fetch failed'))).toMatchObject({ category: 'network', retryable: true })
    expect(classifyNotionError(Object.assign(new Error('lookup failed'), { code: 'ENOTFOUND' }))).toMatchObject({
      category: 'network',
      retryable: true,
      code: 'ENOTFOUND'
    })
  })

  it('does not retry other client errors or unknown programming errors', () => {
    expect(classifyNotionError({ status: 400 })).toMatchObject({ category: 'request', retryable: false })
    expect(classifyNotionError(new Error('unexpected state'))).toMatchObject({ category: 'unknown', retryable: false })
  })
})

describe('Notion retry planning', () => {
  it('uses exponential delays with a short upper bound', () => {
    const options = { baseDelayMs: 500, maxDelayMs: 4_000, jitterRatio: 0, random: () => 0.5 }
    expect([0, 1, 2, 3, 4, 8].map((retry) => calculateNotionRetryDelay(retry, options))).toEqual([
      500,
      1_000,
      2_000,
      4_000,
      4_000,
      4_000
    ])
  })

  it('adds bounded jitter without exceeding the configured cap', () => {
    const base = { baseDelayMs: 1_000, maxDelayMs: 1_500, jitterRatio: 0.2 }
    expect(calculateNotionRetryDelay(0, { ...base, random: () => 0 })).toBe(800)
    expect(calculateNotionRetryDelay(0, { ...base, random: () => 1 })).toBe(1_200)
    expect(calculateNotionRetryDelay(1, { ...base, random: () => 1 })).toBe(1_500)
  })

  it('stops after the retry budget and never schedules permanent errors', () => {
    const retryable = { status: 503 }
    expect(planNotionRetry(retryable, 0, { maxRetries: 2, jitterRatio: 0, random: () => 0.5 })).toMatchObject({
      shouldRetry: true,
      delayMs: 500
    })
    expect(planNotionRetry(retryable, 2, { maxRetries: 2 })).toMatchObject({ shouldRetry: false })
    expect(planNotionRetry({ status: 403 }, 0)).toEqual({
      category: 'permission',
      retryable: false,
      status: 403,
      shouldRetry: false
    })
  })
})

export type NotionErrorCategory =
  | 'authentication'
  | 'permission'
  | 'configuration'
  | 'rate-limit'
  | 'server'
  | 'timeout'
  | 'network'
  | 'request'
  | 'unknown'

export interface NotionErrorClassification {
  category: NotionErrorCategory
  retryable: boolean
  status?: number
  code?: string
}

export interface NotionRetryOptions {
  /** Delay before the first retry. */
  baseDelayMs?: number
  /** Upper bound for the exponential delay. */
  maxDelayMs?: number
  /** Number of retries after the original request. */
  maxRetries?: number
  /** Symmetric jitter ratio, from 0 (none) to 1. */
  jitterRatio?: number
  /** Injectable for deterministic tests. */
  random?: () => number
}

export interface NotionRetryPlan extends NotionErrorClassification {
  shouldRetry: boolean
  delayMs?: number
}

const DEFAULT_BASE_DELAY_MS = 500
const DEFAULT_MAX_DELAY_MS = 8_000
const DEFAULT_MAX_RETRIES = 4
const DEFAULT_JITTER_RATIO = 0.2

const TIMEOUT_CODES = new Set([
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'ABORT_ERR'
])

const NETWORK_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'UND_ERR_SOCKET'
])

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}

function errorChain(error: unknown): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && !seen.has(current) && result.length < 5) {
    seen.add(current)
    const currentRecord = record(current)
    if (!currentRecord) break
    result.push(currentRecord)
    current = currentRecord.cause
  }
  return result
}

function numericStatus(error: unknown): number | undefined {
  const root = record(error)
  const response = record(root?.response)
  for (const candidate of [root?.status, root?.statusCode, response?.status]) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 100 && candidate <= 599) {
      return candidate
    }
  }
  return undefined
}

function firstCode(chain: Array<Record<string, unknown>>): string | undefined {
  for (const item of chain) {
    if (typeof item.code === 'string' && item.code.trim()) return item.code.trim()
  }
  return undefined
}

function chainText(chain: Array<Record<string, unknown>>): string {
  return chain
    .flatMap((item) => [item.name, item.message, item.code])
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
}

export function classifyNotionError(error: unknown): NotionErrorClassification {
  const status = numericStatus(error)
  const chain = errorChain(error)
  const code = firstCode(chain)
  const withDetails = (category: NotionErrorCategory, retryable: boolean): NotionErrorClassification => ({
    category,
    retryable,
    ...(status === undefined ? {} : { status }),
    ...(code ? { code } : {})
  })

  if (status === 401) return withDetails('authentication', false)
  if (status === 403) return withDetails('permission', false)
  if (status === 404) return withDetails('configuration', false)
  if (status === 408) return withDetails('timeout', true)
  if (status === 429) return withDetails('rate-limit', true)
  if (status !== undefined && status >= 500) return withDetails('server', true)
  if (status !== undefined && status >= 400) return withDetails('request', false)

  const normalizedCodes = new Set(
    chain
      .map((item) => (typeof item.code === 'string' ? item.code.toUpperCase() : ''))
      .filter(Boolean)
  )
  const text = chainText(chain)
  if (
    [...normalizedCodes].some((candidate) => TIMEOUT_CODES.has(candidate)) ||
    /timeout|timed out|time-out|aborterror|timeouterror/.test(text)
  ) {
    return withDetails('timeout', true)
  }
  if (
    [...normalizedCodes].some((candidate) => NETWORK_CODES.has(candidate)) ||
    error instanceof TypeError ||
    /fetch failed|network|socket|connection reset|dns/.test(text)
  ) {
    return withDetails('network', true)
  }
  return withDetails('unknown', false)
}

function finiteNumber(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, value))
}

/** `retryNumber` is zero for the first retry after the original request. */
export function calculateNotionRetryDelay(
  retryNumber: number,
  options: NotionRetryOptions = {}
): number {
  const baseDelayMs = finiteNumber(options.baseDelayMs, DEFAULT_BASE_DELAY_MS, 1, 60_000)
  const maxDelayMs = finiteNumber(options.maxDelayMs, DEFAULT_MAX_DELAY_MS, 1, 60_000)
  const jitterRatio = finiteNumber(options.jitterRatio, DEFAULT_JITTER_RATIO, 0, 1)
  const normalizedRetry = Math.max(0, Math.floor(Number.isFinite(retryNumber) ? retryNumber : 0))
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.min(normalizedRetry, 30))
  const sample = finiteNumber(options.random ? options.random() : Math.random(), 0.5, 0, 1)
  const jittered = exponential * (1 + (sample * 2 - 1) * jitterRatio)
  return Math.min(maxDelayMs, Math.max(0, Math.round(jittered)))
}

/** Produces a bounded retry decision without sleeping or performing I/O. */
export function planNotionRetry(
  error: unknown,
  retryNumber: number,
  options: NotionRetryOptions = {}
): NotionRetryPlan {
  const classification = classifyNotionError(error)
  const maxRetries = Math.floor(finiteNumber(options.maxRetries, DEFAULT_MAX_RETRIES, 0, 20))
  const normalizedRetry = Math.max(0, Math.floor(Number.isFinite(retryNumber) ? retryNumber : 0))
  const shouldRetry = classification.retryable && normalizedRetry < maxRetries
  return {
    ...classification,
    shouldRetry,
    ...(shouldRetry ? { delayMs: calculateNotionRetryDelay(normalizedRetry, options) } : {})
  }
}

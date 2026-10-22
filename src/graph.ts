const LEGACY_SEPARATOR = '===================='

export interface GraphFunction {
  id: string
  name: string
  file: string
  before: string
  after: string
}

export interface GraphCall {
  from: string
  to: string
  label: string
}

export interface Graph {
  title: string
  functions: GraphFunction[]
  calls: GraphCall[]
}

export type DiffLineType = 'unchanged' | 'removed' | 'added'

export interface DiffLine {
  text: string
  type: DiffLineType
  group: number
  pair: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizePseudocode(value: unknown, field: string, id: string): string {
  if (value == null) return ''
  if (Array.isArray(value)) value = value.join('\n')
  if (typeof value !== 'string') {
    throw new Error(`Function ${id}: ${field} must be a string or array.`)
  }
  return value.split('\n')
    .filter((line) => line.trim() !== LEGACY_SEPARATOR)
    .join('\n')
    .trim()
}

export function normalizeGraph(input: unknown): Graph {
  if (!isRecord(input)) {
    throw new Error('Graph must be an object.')
  }
  if (!Array.isArray(input.functions)) {
    throw new Error('Graph must contain a functions array.')
  }
  if (input.title != null && typeof input.title !== 'string') {
    throw new Error('Graph title must be a string.')
  }
  if (input.calls != null && !Array.isArray(input.calls)) {
    throw new Error('Graph calls must be an array.')
  }

  const ids = new Set<string>()
  const functions = input.functions.map((entry: unknown, index): GraphFunction => {
    if (!isRecord(entry)) {
      throw new Error(`Function ${index + 1} must be an object.`)
    }
    if (typeof entry.id !== 'string' || !entry.id.trim()) {
      throw new Error(`Function ${index + 1} needs a string id.`)
    }
    if (ids.has(entry.id)) {
      throw new Error(`Duplicate function id: ${entry.id}`)
    }
    ids.add(entry.id)
    if (entry.name != null && typeof entry.name !== 'string') {
      throw new Error(`Function ${entry.id}: name must be a string.`)
    }
    if (entry.file != null && typeof entry.file !== 'string') {
      throw new Error(`Function ${entry.id}: file must be a string.`)
    }

    const before = normalizePseudocode(entry.before, 'before', entry.id)
    const after = normalizePseudocode(entry.after, 'after', entry.id)
    if (!before && !after) {
      throw new Error(`Function ${entry.id} needs before or after behavior.`)
    }
    return {
      id: entry.id,
      name: entry.name || entry.id,
      file: entry.file || '',
      before,
      after,
    }
  })

  const calls = (input.calls || []).map((call: unknown, index): GraphCall => {
    if (!isRecord(call)) {
      throw new Error(`Call ${index + 1} must be an object.`)
    }
    if (typeof call.from !== 'string' || !ids.has(call.from)) {
      throw new Error(`Call ${index + 1} has an unknown caller: ${call.from}`)
    }
    if (typeof call.to !== 'string' || !ids.has(call.to)) {
      throw new Error(`Call ${index + 1} has an unknown callee: ${call.to}`)
    }
    if (call.label != null && typeof call.label !== 'string') {
      throw new Error(`Call ${index + 1}: label must be a string.`)
    }
    return { from: call.from, to: call.to, label: call.label || '' }
  })

  return { title: input.title || 'Untitled call graph', functions, calls }
}

export function parseGraph(source: string): Graph {
  return normalizeGraph(JSON.parse(source))
}

export function firstValidGraph(sources: Record<string, string>): { path: string | null; graph: Graph | null } {
  const paths = Object.keys(sources).sort()
  for (const path of paths) {
    try {
      return { path, graph: parseGraph(sources[path]) }
    } catch {
      // Invalid files remain selectable so their error can be shown on demand.
    }
  }
  return { path: null, graph: null }
}

interface Hunk {
  removed: DiffLine[]
  added: DiffLine[]
}

export function diffPseudocode(before: string, after: string): { before: DiffLine[]; after: DiffLine[] } {
  const beforeLines = before ? before.split('\n') : []
  const afterLines = after ? after.split('\n') : []
  const n = beforeLines.length
  const m = afterLines.length
  const matrix = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0))

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      matrix[i][j] = beforeLines[i] === afterLines[j]
        ? matrix[i + 1][j + 1] + 1
        : Math.max(matrix[i + 1][j], matrix[i][j + 1])
    }
  }

  // A group is either one unchanged pair or one run of changes between unchanged
  // lines. Lines sharing a pair id are the same line on both sides.
  const beforeDiff: DiffLine[] = []
  const afterDiff: DiffLine[] = []
  const hunks: Hunk[] = []
  let group = -1
  let nextPair = 0
  let hunk: Hunk | null = null
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && beforeLines[i] === afterLines[j]) {
      group++
      hunk = null
      const pair = nextPair++
      beforeDiff.push({ text: beforeLines[i++], type: 'unchanged', group, pair })
      afterDiff.push({ text: afterLines[j++], type: 'unchanged', group, pair })
      continue
    }
    if (!hunk) {
      group++
      hunk = { removed: [], added: [] }
      hunks.push(hunk)
    }
    if (j >= m || (i < n && matrix[i + 1][j] >= matrix[i][j + 1])) {
      const line: DiffLine = { text: beforeLines[i++], type: 'removed', group, pair: null }
      beforeDiff.push(line)
      hunk.removed.push(line)
    } else {
      const line: DiffLine = { text: afterLines[j++], type: 'added', group, pair: null }
      afterDiff.push(line)
      hunk.added.push(line)
    }
  }

  for (const { removed, added } of hunks) {
    for (const [r, a] of pairSimilarLines(removed, added)) {
      r.pair = a.pair = nextPair++
    }
  }

  return { before: beforeDiff, after: afterDiff }
}

const MIN_PAIR_SIMILARITY = 0.5

function lineWords(text: string): Set<string> {
  return new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? [])
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const word of a) if (b.has(word)) shared++
  return (2 * shared) / (a.size + b.size)
}

// Order-preserving alignment that maximizes total similarity, so pairs never
// cross and each line pairs at most once.
function pairSimilarLines(removed: DiffLine[], added: DiffLine[]): Array<[DiffLine, DiffLine]> {
  const removedWords = removed.map((line) => lineWords(line.text))
  const addedWords = added.map((line) => lineWords(line.text))
  const score = (r: number, a: number): number => {
    const value = similarity(removedWords[r], addedWords[a])
    return value >= MIN_PAIR_SIMILARITY ? value : 0
  }
  const best = Array.from({ length: removed.length + 1 }, () => Array<number>(added.length + 1).fill(0))
  for (let r = removed.length - 1; r >= 0; r--) {
    for (let a = added.length - 1; a >= 0; a--) {
      const matched = score(r, a) > 0 ? score(r, a) + best[r + 1][a + 1] : 0
      best[r][a] = Math.max(matched, best[r + 1][a], best[r][a + 1])
    }
  }

  const pairs: Array<[DiffLine, DiffLine]> = []
  let r = 0
  let a = 0
  while (r < removed.length && a < added.length) {
    if (score(r, a) > 0 && best[r][a] === score(r, a) + best[r + 1][a + 1]) {
      pairs.push([removed[r++], added[a++]])
    } else if (best[r][a] === best[r + 1][a]) {
      r++
    } else {
      a++
    }
  }
  return pairs
}

// A callee's bare name is its name up to the parameter list, after any
// qualifier, so "Payments.chargeCard(card)" is looked up as "chargeCard".
export function calleeIdentifier(func: Pick<GraphFunction, 'id' | 'name'>): string {
  const bare = func.name.split('(')[0].trim()
  const member = bare.split('.').pop()
  return member || bare || func.id
}

export function callSiteLines(lines: string[], callee: Pick<GraphFunction, 'id' | 'name'>): number[] {
  const identifier = calleeIdentifier(callee).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?<![\\w$])${identifier}(?![\\w$])`)
  return lines.flatMap((text, index) => (pattern.test(text) ? [index] : []))
}

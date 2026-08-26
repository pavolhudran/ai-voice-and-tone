/**
 * Minimal YAML subset, sufficient for .voice-and-tone/config.yml.
 * Zero dependencies by design (see spec section 9).
 *
 * Supported: nested block maps (2-space indent), block sequences of scalars,
 * inline flow sequences [a, b], block scalars (| literal, > folded),
 * single/double-quoted strings, integers, true/false, null (~ or empty),
 * # comments, blank lines.
 *
 * Block scalars are in the subset because Claude Code skill and agent
 * frontmatter uses `description: >`, and this plugin parses its own frontmatter.
 *
 * Unsupported and rejected with a line number: anchors and aliases, multiple
 * documents, sequences of maps, tab indentation.
 */

const UNSUPPORTED = [
  [/^\s*---\s*$/, 'multiple documents'],
  [/^\s*\.\.\.\s*$/, 'document end marker'],
  [/:\s*[&*]\S/, 'anchors and aliases']
]

const BLOCK_SCALAR = /^([|>])([-+])?\d*\s*$/

function fail (lineNo, message) {
  throw new Error(`yaml: line ${lineNo}: ${message}`)
}

function stripComment (raw) {
  let out = ''
  let quote = null
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (quote) {
      out += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; continue }
    if (ch === '#' && (i === 0 || /\s/.test(raw[i - 1]))) break
    out += ch
  }
  return out.replace(/\s+$/, '')
}

function parseScalar (raw, lineNo) {
  const text = raw.trim()
  if (text === '') return null
  if (text === '~' || text === 'null') return null
  if (text === 'true') return true
  if (text === 'false') return false
  if (/^-?\d+$/.test(text)) return Number(text)
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) fail(lineNo, 'unterminated flow sequence')
    const inner = text.slice(1, -1).trim()
    if (inner === '') return []
    return inner.split(',').map((part) => parseScalar(part, lineNo))
  }
  if (text.startsWith('{')) fail(lineNo, 'flow mappings are not supported')
  const quoted = /^"(.*)"$|^'(.*)'$/.exec(text)
  if (quoted) return quoted[1] !== undefined ? quoted[1] : quoted[2]
  return text
}

export function parseYaml (source) {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n')
  const root = {}
  // Each frame owns a container and the indent its children sit at.
  const stack = [{ indent: -1, container: root }]
  // Lines already swallowed by a block scalar; skipped rather than re-parsed.
  let consumeUntil = -1

  lines.forEach((raw, index) => {
    if (index <= consumeUntil) return
    const lineNo = index + 1
    if (raw.includes('\t')) fail(lineNo, 'tab indentation is not supported')
    for (const [pattern, what] of UNSUPPORTED) {
      if (pattern.test(raw)) fail(lineNo, `${what} are not supported`)
    }

    const line = stripComment(raw)
    if (line.trim() === '') return

    const indent = line.length - line.trimStart().length
    if (indent % 2 !== 0) fail(lineNo, 'indentation must be a multiple of two spaces')
    const body = line.trim()

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop()
    const parent = stack[stack.length - 1].container

    if (body.startsWith('- ') || body === '-') {
      if (!Array.isArray(parent)) fail(lineNo, 'sequence item outside a sequence')
      const item = body === '-' ? null : body.slice(2)
      if (item !== null && /:\s/.test(item)) fail(lineNo, 'sequences of maps are not supported')
      parent.push(parseScalar(item ?? '', lineNo))
      return
    }

    const split = /^([^:]+):(.*)$/.exec(body)
    if (!split) fail(lineNo, `cannot parse "${body}"`)
    const key = split[1].trim().replace(/^["']|["']$/g, '')
    const rest = split[2].trim()

    if (Array.isArray(parent)) fail(lineNo, 'mapping key inside a sequence')

    const block = BLOCK_SCALAR.exec(rest)
    if (block) {
      // Consume every following line indented deeper than this key.
      const collected = []
      let end = index + 1
      let blockIndent = null
      for (; end < lines.length; end++) {
        const candidate = lines[end]
        if (candidate.trim() === '') { collected.push(''); continue }
        const candidateIndent = candidate.length - candidate.trimStart().length
        if (candidateIndent <= indent) break
        if (blockIndent === null) blockIndent = candidateIndent
        collected.push(candidate.slice(blockIndent))
      }
      while (collected.length && collected[collected.length - 1] === '') collected.pop()

      const value = block[1] === '|'
        ? collected.join('\n')
        : collected.reduce((acc, line) => {
            if (line === '') return `${acc}\n`
            if (acc === '' || acc.endsWith('\n')) return acc + line
            return `${acc} ${line}`
          }, '')

      parent[key] = block[2] === '+' ? `${value}\n` : value
      consumeUntil = end - 1
      return
    }

    if (rest === '') {
      // Empty scalar, a nested map, or a block sequence. Decide by peeking ahead.
      let next = null
      for (let j = index + 1; j < lines.length; j++) {
        const peek = stripComment(lines[j])
        if (peek.trim() === '') continue
        next = peek
        break
      }
      const nextIndent = next ? next.length - next.trimStart().length : -1
      if (next === null || nextIndent <= indent) {
        // Nothing deeper follows this key, so it is an empty scalar (null).
        parent[key] = null
        return
      }
      const isSequence = next.trim().startsWith('-')
      const container = isSequence ? [] : {}
      parent[key] = container
      stack.push({ indent, container })
      return
    }

    parent[key] = parseScalar(rest, lineNo)
  })

  return root
}

function stringifyScalar (value) {
  if (value === null || value === undefined) return '~'
  if (typeof value === 'string' && value.includes('\n')) {
    throw new Error('yaml: use stringifyYaml for multi-line strings, not a scalar position')
  }
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  const text = String(value)
  const needsQuotes =
    text === '' ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(text) ||
    /:\s|\s#/.test(text) ||
    /^(true|false|null|~)$/.test(text) ||
    /^-?\d+$/.test(text)
  return needsQuotes ? `"${text.replace(/"/g, '\\"')}"` : text
}

export function stringifyYaml (value, depth = 0) {
  const pad = '  '.repeat(depth)
  let out = ''
  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child)) {
      if (child.length === 0) { out += `${pad}${key}: []\n`; continue }
      out += `${pad}${key}:\n`
      for (const item of child) out += `${pad}  - ${stringifyScalar(item)}\n`
      continue
    }
    if (child && typeof child === 'object') {
      out += `${pad}${key}:\n${stringifyYaml(child, depth + 1)}`
      continue
    }
    if (typeof child === 'string' && child.includes('\n')) {
      out += `${pad}${key}: |\n`
      for (const line of child.split('\n')) out += `${pad}  ${line}\n`
      continue
    }
    out += `${pad}${key}: ${stringifyScalar(child)}\n`
  }
  return out
}

/**
 * Minimal YAML subset, sufficient for .voice-and-tone/config.yml.
 * Zero dependencies by design (see spec section 9).
 *
 * Supported: nested block maps (2-space indent), block sequences of scalars,
 * block sequences of maps (`- key: value` opening an item, with its other
 * fields as plain `key: value` lines indented under it), inline flow
 * sequences [a, b], block scalars (| literal, > folded) with an optional
 * chomping indicator, single/double-quoted strings, integers, true/false,
 * null (~ or empty), # comments, blank lines.
 *
 * Chomping: | and > set the block style - literal keeps newlines, folded
 * joins lines with spaces. A trailing + appends a single trailing newline.
 * Bare and - behave identically: this subset has no clip/strip distinction,
 * unlike standard YAML, where bare clips to one trailing newline and - strips
 * it entirely.
 *
 * Block scalars are in the subset because Claude Code skill and agent
 * frontmatter uses `description: >` (and sometimes `description: >-`), and
 * this plugin parses its own frontmatter.
 *
 * Sequences of maps are in the subset because config.yml's `sources:` list
 * (register.mjs) is exactly that shape once /voice-and-tone:connect writes
 * to it - task-11 is the first caller that round-trips it through
 * saveConfig/loadConfig rather than only ever building it as a literal JS
 * object, and that is where the gap first had to be closed.
 *
 * Unsupported and rejected with a line number: anchors and aliases, multiple
 * documents, tab indentation.
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

// True if text contains a colon-space pair outside of quotes - the marker of
// a "- key: value" sequence-of-maps item, as opposed to a plain scalar
// sequence item. A quoted scalar like "note: important" must not trip this.
function hasUnquotedColonSpace (text) {
  let quote = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === ':' && /\s/.test(text[i + 1] || '')) return true
  }
  return false
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
    let body = line.trim()

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop()
    let parent = stack[stack.length - 1].container

    if (body.startsWith('- ') || body === '-') {
      if (!Array.isArray(parent)) fail(lineNo, 'sequence item outside a sequence')
      const item = body === '-' ? null : body.slice(2)

      if (item !== null && hasUnquotedColonSpace(item)) {
        // "- key: value" opens a block map as a sequence item. The dash's
        // own indent becomes that map's threshold: every later line more
        // deeply indented than the dash belongs to it (a continuation field
        // lines up two columns further right, exactly where content after
        // "- " sits), and anything back at the dash's indent or shallower -
        // a sibling item, or a dedent out of the sequence - ends it.
        // Repointing `parent` at the new map and `body` at the part after
        // "- ", then falling through to the ordinary key: value handling
        // below (rather than returning), is what makes that work: every
        // later check in this function reads the CURRENT line's `indent`
        // against the stack, and the dash's indent is exactly what gets
        // pushed here.
        const map = {}
        parent.push(map)
        stack.push({ indent, container: map })
        parent = map
        body = item
      } else {
        parent.push(parseScalar(item ?? '', lineNo))
        return
      }
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

// One item of a block sequence, at the indent depth the dash itself sits at
// (one deeper than the key introducing the sequence). A plain scalar item
// renders as `- value`, unchanged. An object item renders as a block map
// whose first field shares the dash's line and whose remaining fields are
// indented two columns further right, under it - the mirror image of how
// parseYaml reads that same shape back: stringifyYaml(item, depth + 1)
// already produces every field at that deeper indent, so the first line
// only needs its own leading indent swapped for "- ".
function stringifySequenceItem (item, depth) {
  const itemPad = '  '.repeat(depth)
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    return `${itemPad}- ${stringifyScalar(item)}\n`
  }
  const rendered = stringifyYaml(item, depth + 1)
  const lines = rendered.split('\n').filter((line) => line !== '')
  const stripLen = itemPad.length + 2
  const withDash = lines.map((line, i) => (i === 0 ? `${itemPad}- ${line.slice(stripLen)}` : line))
  return `${withDash.join('\n')}\n`
}

export function stringifyYaml (value, depth = 0) {
  const pad = '  '.repeat(depth)
  let out = ''
  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child)) {
      if (child.length === 0) { out += `${pad}${key}: []\n`; continue }
      out += `${pad}${key}:\n`
      for (const item of child) out += stringifySequenceItem(item, depth + 1)
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

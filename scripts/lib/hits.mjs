const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function patternFor (rule) {
  const explicit = rule.cells?.Pattern
  if (explicit) {
    try { return new RegExp(explicit, 'gi') } catch { return null } // a broken pattern scores 0
  }
  const avoid = rule.cells?.Avoid
  if (!avoid || avoid === '—' || avoid === '-') return null
  // Unicode-aware word boundaries: \b would mis-handle diacritics.
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(avoid)}(?![\\p{L}\\p{N}])`, 'giu')
}

export function countHits (corpusStrings, rules) {
  const text = corpusStrings.join('\n')
  const hits = new Map()
  for (const rule of rules) {
    const pattern = patternFor(rule)
    hits.set(rule.id, pattern ? (text.match(pattern) || []).length : 0)
  }
  return hits
}

export function rankRules (rules, hits) {
  return [...rules].sort((a, b) => {
    const byHits = (hits.get(b.id) ?? 0) - (hits.get(a.id) ?? 0)
    if (byHits !== 0) return byHits
    const aConfirmed = a.confidence === 'confirmed' ? 0 : 1
    const bConfirmed = b.confidence === 'confirmed' ? 0 : 1
    if (aConfirmed !== bConfirmed) return aConfirmed - bConfirmed
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

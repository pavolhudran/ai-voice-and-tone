import { splitSentences, splitWords, splitParagraphs, countSyllablesEn } from './text.mjs'

/**
 * Pronoun markers per locale. Spec section 5.3 lists person-marker rates as
 * universal, but a rate needs a marker set. A locale with no entry reports null
 * rather than a number derived from the wrong language's pronouns.
 */
export const PERSON_MARKERS = {
  en: {
    first: ['i', 'me', 'my', 'mine', 'we', 'us', 'our', 'ours'],
    second: ['you', 'your', 'yours', "you're", "you'll", "you've"]
  },
  cs: {
    first: ['ja', 'me', 'mne', 'muj', 'moje', 'my', 'nas', 'nam', 'nase'],
    second: ['ty', 'tebe', 'tvuj', 'tvoje', 'vy', 'vas', 'vam', 'vase']
  },
  de: {
    first: ['ich', 'mich', 'mir', 'mein', 'wir', 'uns', 'unser'],
    second: ['du', 'dich', 'dir', 'dein', 'ihr', 'euch', 'euer', 'sie', 'ihnen']
  }
}

// 'just' and 'could' are high-frequency and inflate this rate on their own -
// that's fine, because hedgePer1000Words is only ever compared against the
// brand's own baseline, never an absolute threshold. Do not trim them to
// make the number look smaller; doing so would break comparability against
// baselines already computed with the full list.
const EN_HEDGES = new Set([
  'maybe', 'perhaps', 'might', 'could', 'somewhat', 'fairly', 'rather', 'seems',
  'appears', 'generally', 'usually', 'often', 'probably', 'possibly', 'just',
  'simply', 'basically', 'essentially', 'quite', 'slightly'
])
// Intensifiers only - words that amplify a neighboring word (very good,
// really fast). Evaluative adjectives like "amazing"/"awesome"/"huge" are
// not intensifiers and are covered separately by the lexicon rules; mixing
// them in here would mislabel what intensifierPer1000Words counts.
const EN_INTENSIFIERS = new Set([
  'very', 'really', 'extremely', 'incredibly', 'super', 'totally', 'absolutely',
  'highly', 'completely', 'definitely', 'literally'
])
const EN_IMPERATIVE_OPENERS = new Set([
  'add', 'browse', 'check', 'choose', 'click', 'connect', 'copy', 'create',
  'delete', 'download', 'edit', 'enable', 'enter', 'explore', 'find', 'get',
  'go', 'install', 'join', 'learn', 'log', 'make', 'open', 'pick', 'read',
  'remove', 'rename', 'reset', 'review', 'save', 'schedule', 'select', 'send',
  'set', 'share', 'sign', 'start', 'stop', 'switch', 'try', 'turn', 'update',
  'upgrade', 'upload', 'use', 'view', 'visit', 'write'
])
const PASSIVE = /\b(?:am|is|are|was|were|be|been|being)\s+(?:\w+ed|born|done|made|given|taken|seen|known|written|shown|held|sent|built|kept|found|put|set|read)\b/i
const CONTRACTION = /\b\w+['’](?:t|s|re|ve|ll|d|m)\b/gi
const SERIAL_LIST = /[\w'’-]+\s*,\s*[\w'’-]+(?:\s*,)?\s+(?:and|or)\s+[\w'’-]+/gi
const OXFORD = /,\s+(?:and|or)\s+/i

const round = (value, places) =>
  value === null || !Number.isFinite(value) ? null : Number(value.toFixed(places))
const share = (count, total) => (total > 0 ? round(count / total, 3) : null)
const per1000 = (count, words) => (words > 0 ? round((count * 1000) / words, 2) : null)
const countMatches = (text, pattern) => (text.match(pattern) || []).length

function median (numbers) {
  if (numbers.length === 0) return null
  const sorted = [...numbers].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function stdDev (numbers) {
  if (numbers.length === 0) return null
  const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length
  const variance = numbers.reduce((sum, n) => sum + (n - mean) ** 2, 0) / numbers.length
  return Math.sqrt(variance)
}

function isTitleCase (heading) {
  const words = splitWords(heading)
  if (words.length < 2) return null
  const minor = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'of', 'in', 'on', 'to', 'for', 'with'])
  const significant = words.filter((w, i) => i === 0 || !minor.has(w.toLowerCase()))
  return significant.every((w) => /^[\p{Lu}\p{N}]/u.test(w))
}

export function universalMetrics ({ strings = [], headings = [], locale = 'en' } = {}) {
  const text = strings.join('\n\n')
  const sentences = strings.flatMap((s) => splitSentences(s))
  const words = splitWords(text)
  const paragraphs = splitParagraphs(text)
  const sentenceLengths = sentences.map((s) => splitWords(s).length)
  const wordCount = words.length

  const markers = PERSON_MARKERS[String(locale).slice(0, 2).toLowerCase()] ?? null
  const lowerWords = words.map((w) => w.toLowerCase())
  const countIn = (set) => lowerWords.filter((w) => set.includes(w)).length

  // Title Case is a stylistic choice only in languages that don't already
  // capitalize by grammar. German capitalizes every noun regardless of
  // styling, so a heading list of ordinary nouns with no brand styling at
  // all ("Berichte", "Einstellungen") scores 1.0 under the raw heuristic -
  // a false signal. Czech doesn't title-case headings at all, so the same
  // heuristic trends to 0 for an axis that doesn't exist in the language.
  // Gate this the same way PERSON_MARKERS gates person rates: compute only
  // where title case is a real editorial decision (English), null elsewhere.
  const isEnglishLocale = String(locale).toLowerCase().startsWith('en')
  const headingVerdicts = isEnglishLocale ? headings.map(isTitleCase).filter((v) => v !== null) : []

  return {
    sentenceCount: sentences.length,
    wordCount,
    paragraphCount: paragraphs.length,
    meanSentenceLength: sentences.length ? round(sentenceLengths.reduce((a, b) => a + b, 0) / sentences.length, 2) : null,
    medianSentenceLength: round(median(sentenceLengths), 2),
    sentenceLengthSd: round(stdDev(sentenceLengths), 2),
    meanParagraphLength: paragraphs.length
      ? round(paragraphs.reduce((sum, p) => sum + splitSentences(p).length, 0) / paragraphs.length, 2)
      : null,
    meanWordLength: wordCount ? round(words.reduce((sum, w) => sum + w.length, 0) / wordCount, 2) : null,
    exclamationRate: share(sentences.filter((s) => /!\p{P}*$/u.test(s)).length, sentences.length),
    questionRate: share(sentences.filter((s) => /\?\p{P}*$/u.test(s)).length, sentences.length),
    emojiPer1000Words: per1000(countMatches(text, /\p{Extended_Pictographic}/gu), wordCount),
    emDashPer1000Words: per1000(countMatches(text, /—|\s-\s/g), wordCount),
    semicolonPer1000Words: per1000(countMatches(text, /;/g), wordCount),
    headingTitleCaseRatio: isEnglishLocale ? share(headingVerdicts.filter(Boolean).length, headingVerdicts.length) : null,
    firstPersonPer1000Words: markers ? per1000(countIn(markers.first), wordCount) : null,
    secondPersonPer1000Words: markers ? per1000(countIn(markers.second), wordCount) : null
  }
}

export function englishMetrics ({ strings = [] } = {}) {
  const text = strings.join('\n\n')
  const sentences = strings.flatMap((s) => splitSentences(s))
  const words = splitWords(text)
  const wordCount = words.length
  const lowerWords = words.map((w) => w.toLowerCase())
  const syllables = words.reduce((sum, w) => sum + countSyllablesEn(w), 0)

  const listCandidates = text.match(SERIAL_LIST) || []
  const oxfordCount = listCandidates.filter((candidate) => OXFORD.test(candidate)).length

  const imperativeOpeners = sentences.filter((sentence) => {
    const first = (splitWords(sentence)[0] || '').toLowerCase()
    return EN_IMPERATIVE_OPENERS.has(first)
  }).length

  return {
    contractionPer1000Words: per1000(countMatches(text, CONTRACTION), wordCount),
    readingGrade: sentences.length && wordCount
      ? round(0.39 * (wordCount / sentences.length) + 11.8 * (syllables / wordCount) - 15.59, 2)
      : null,
    passiveRate: share(sentences.filter((s) => PASSIVE.test(s)).length, sentences.length),
    imperativeOpenerRate: share(imperativeOpeners, sentences.length),
    hedgePer1000Words: per1000(lowerWords.filter((w) => EN_HEDGES.has(w)).length, wordCount),
    intensifierPer1000Words: per1000(lowerWords.filter((w) => EN_INTENSIFIERS.has(w)).length, wordCount),
    oxfordCommaRate: share(oxfordCount, listCandidates.length),
    longWordRate: share(words.filter((w) => countSyllablesEn(w) > 3).length, wordCount)
  }
}

export function computeFingerprint ({ strings = [], headings = [], locale = 'en' } = {}) {
  const isEnglish = String(locale).toLowerCase().startsWith('en')
  return {
    locale,
    sample: {
      strings: strings.length,
      words: splitWords(strings.join('\n\n')).length,
      sentences: strings.flatMap((s) => splitSentences(s)).length
    },
    universal: universalMetrics({ strings, headings, locale }),
    english: isEnglish ? englishMetrics({ strings }) : null
  }
}

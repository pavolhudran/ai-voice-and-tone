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

function isTitleCase (heading) {
  const words = splitWords(heading)
  if (words.length < 2) return null
  const minor = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'of', 'in', 'on', 'to', 'for', 'with'])
  const significant = words.filter((w, i) => i === 0 || !minor.has(w.toLowerCase()))
  return significant.every((w) => /^[\p{Lu}\p{N}]/u.test(w))
}

/**
 * Sentence-length buckets. Coarse on purpose: the median they reconstruct is
 * only ever compared against the brand's own baseline, never an absolute
 * threshold, so bucket accuracy is enough. Spec section 6.3.
 */
export const SENT_LEN_BUCKETS = ['1-5', '6-10', '11-20', '21-40', '41+']
const BUCKET_MIDPOINT = { '1-5': 3, '6-10': 8, '11-20': 15.5, '21-40': 30.5, '41+': 41 }

function bucketFor (n) {
  if (n <= 5) return '1-5'
  if (n <= 10) return '6-10'
  if (n <= 20) return '11-20'
  if (n <= 40) return '21-40'
  return '41+'
}

const NUMERIC_KEYS = [
  'strings', 'words', 'sentences', 'paragraphs',
  'sumWordLen', 'sumSentLen', 'sumSentLenSq', 'sumParaSent',
  'exclamations', 'questions', 'emoji', 'emDash', 'semicolon',
  'firstPerson', 'secondPerson', 'headingsTotal', 'headingsTitleCase'
]
const ENGLISH_KEYS = [
  'syllables', 'contractions', 'passiveSentences', 'imperativeOpeners',
  'hedges', 'intensifiers', 'oxfordLists', 'oxfordHits', 'longWords'
]

export function emptyStats () {
  const out = { sentLenHist: {}, personMarkers: true, english: null }
  for (const key of NUMERIC_KEYS) out[key] = 0
  for (const bucket of SENT_LEN_BUCKETS) out.sentLenHist[bucket] = 0
  return out
}

function emptyEnglish () {
  const out = {}
  for (const key of ENGLISH_KEYS) out[key] = 0
  return out
}

/**
 * Counts for ONE unit - one file, one PDF, one fetched page. Never for a
 * concatenation of several.
 *
 * Measuring per unit and merging counts is what makes the index a sufficient
 * statistic (spec section 6). It is also more correct than the join-then-
 * measure approach it replaces: joining two unrelated documents let text-level
 * patterns such as SERIAL_LIST match across the seam between them, inventing a
 * hit that exists in neither document.
 */
export function statsFor ({ strings = [], headings = [], locale = 'en' } = {}) {
  const out = emptyStats()
  const text = strings.join('\n\n')
  const sentences = strings.flatMap((s) => splitSentences(s))
  const words = splitWords(text)
  const paragraphs = splitParagraphs(text)
  const lowerWords = words.map((w) => w.toLowerCase())

  out.strings = strings.length
  out.words = words.length
  out.sentences = sentences.length
  out.paragraphs = paragraphs.length
  out.sumWordLen = words.reduce((sum, w) => sum + w.length, 0)
  out.sumParaSent = paragraphs.reduce((sum, p) => sum + splitSentences(p).length, 0)

  for (const sentence of sentences) {
    const n = splitWords(sentence).length
    out.sumSentLen += n
    out.sumSentLenSq += n * n
    out.sentLenHist[bucketFor(n)] += 1
  }

  out.exclamations = sentences.filter((s) => /!\p{P}*$/u.test(s)).length
  out.questions = sentences.filter((s) => /\?\p{P}*$/u.test(s)).length
  out.emoji = countMatches(text, /\p{Extended_Pictographic}/gu)
  out.emDash = countMatches(text, /—|\s-\s/g)
  out.semicolon = countMatches(text, /;/g)

  const markers = PERSON_MARKERS[String(locale).slice(0, 2).toLowerCase()] ?? null
  out.personMarkers = markers !== null
  if (markers) {
    out.firstPerson = lowerWords.filter((w) => markers.first.includes(w)).length
    out.secondPerson = lowerWords.filter((w) => markers.second.includes(w)).length
  }

  // Title case is only an editorial decision in languages that do not
  // capitalize by grammar. Outside English no verdicts are recorded, which
  // leaves headingsTotal at 0 and makes the ratio null by construction.
  if (String(locale).toLowerCase().startsWith('en')) {
    for (const verdict of headings.map(isTitleCase)) {
      if (verdict === null) continue
      out.headingsTotal += 1
      if (verdict) out.headingsTitleCase += 1
    }

    const en = emptyEnglish()
    en.syllables = words.reduce((sum, w) => sum + countSyllablesEn(w), 0)
    en.contractions = countMatches(text, CONTRACTION)
    en.passiveSentences = sentences.filter((s) => PASSIVE.test(s)).length
    en.imperativeOpeners = sentences.filter((sentence) => {
      const first = (splitWords(sentence)[0] || '').toLowerCase()
      return EN_IMPERATIVE_OPENERS.has(first)
    }).length
    en.hedges = lowerWords.filter((w) => EN_HEDGES.has(w)).length
    en.intensifiers = lowerWords.filter((w) => EN_INTENSIFIERS.has(w)).length

    const listCandidates = text.match(SERIAL_LIST) || []
    en.oxfordLists = listCandidates.length
    en.oxfordHits = listCandidates.filter((candidate) => OXFORD.test(candidate)).length
    en.longWords = words.filter((w) => countSyllablesEn(w) > 3).length
    out.english = en
  }

  return out
}

/** Associative and commutative. Merge only within one locale (spec 5.3). */
export function mergeStats (statsList) {
  const items = (statsList || []).filter(Boolean)
  const out = emptyStats()
  if (items.length === 0) return out

  out.personMarkers = items.every((s) => s.personMarkers !== false)
  if (items.some((s) => s.english)) out.english = emptyEnglish()

  for (const item of items) {
    for (const key of NUMERIC_KEYS) out[key] += item[key] ?? 0
    for (const bucket of SENT_LEN_BUCKETS) {
      out.sentLenHist[bucket] += item.sentLenHist?.[bucket] ?? 0
    }
    if (item.english && out.english) {
      for (const key of ENGLISH_KEYS) out.english[key] += item.english[key] ?? 0
    }
  }
  return out
}

function sdFromSums (sum, sumSq, n) {
  if (!n) return null
  const variance = sumSq / n - (sum / n) ** 2
  return round(Math.sqrt(Math.max(variance, 0)), 2)
}

function medianFromHist (hist, n) {
  if (!n) return null
  const target = n / 2
  let seen = 0
  for (const bucket of SENT_LEN_BUCKETS) {
    seen += hist[bucket] ?? 0
    if (seen >= target) return BUCKET_MIDPOINT[bucket]
  }
  return BUCKET_MIDPOINT['41+']
}

/** Arithmetic only. Every input comes from a Stats block; no text is needed. */
export function fingerprintFromStats (stats, locale = 'en') {
  const s = stats ?? emptyStats()
  const isEnglish = String(locale).toLowerCase().startsWith('en')
  const en = isEnglish && s.english ? s.english : null

  return {
    locale,
    // Stated rather than hidden: the median is reconstructed from a bucketed
    // histogram because a median cannot be merged from sums. Spec 6.3.
    approximations: ['medianSentenceLength'],
    sample: { strings: s.strings, words: s.words, sentences: s.sentences },
    universal: {
      sentenceCount: s.sentences,
      wordCount: s.words,
      paragraphCount: s.paragraphs,
      meanSentenceLength: s.sentences ? round(s.sumSentLen / s.sentences, 2) : null,
      medianSentenceLength: medianFromHist(s.sentLenHist, s.sentences),
      sentenceLengthSd: sdFromSums(s.sumSentLen, s.sumSentLenSq, s.sentences),
      meanParagraphLength: s.paragraphs ? round(s.sumParaSent / s.paragraphs, 2) : null,
      meanWordLength: s.words ? round(s.sumWordLen / s.words, 2) : null,
      exclamationRate: share(s.exclamations, s.sentences),
      questionRate: share(s.questions, s.sentences),
      emojiPer1000Words: per1000(s.emoji, s.words),
      emDashPer1000Words: per1000(s.emDash, s.words),
      semicolonPer1000Words: per1000(s.semicolon, s.words),
      headingTitleCaseRatio: isEnglish ? share(s.headingsTitleCase, s.headingsTotal) : null,
      firstPersonPer1000Words: s.personMarkers ? per1000(s.firstPerson, s.words) : null,
      secondPersonPer1000Words: s.personMarkers ? per1000(s.secondPerson, s.words) : null
    },
    english: en
      ? {
          contractionPer1000Words: per1000(en.contractions, s.words),
          readingGrade: s.sentences && s.words
            ? round(0.39 * (s.words / s.sentences) + 11.8 * (en.syllables / s.words) - 15.59, 2)
            : null,
          passiveRate: share(en.passiveSentences, s.sentences),
          imperativeOpenerRate: share(en.imperativeOpeners, s.sentences),
          hedgePer1000Words: per1000(en.hedges, s.words),
          intensifierPer1000Words: per1000(en.intensifiers, s.words),
          oxfordCommaRate: share(en.oxfordHits, en.oxfordLists),
          longWordRate: share(en.longWords, s.words)
        }
      : null
  }
}

/** Kept for callers that hold the text and want a fingerprint in one step. */
export function computeFingerprint ({ strings = [], headings = [], locale = 'en' } = {}) {
  return fingerprintFromStats(statsFor({ strings, headings, locale }), locale)
}

/**
 * Kept as thin wrappers over the statistics layer rather than removed:
 * test/metrics.test.mjs asserts against them directly, and those assertions
 * are the regression net proving this refactor preserves behaviour.
 */
export function universalMetrics ({ strings = [], headings = [], locale = 'en' } = {}) {
  return fingerprintFromStats(statsFor({ strings, headings, locale }), locale).universal
}

export function englishMetrics ({ strings = [], headings = [], locale = 'en' } = {}) {
  return fingerprintFromStats(statsFor({ strings, headings, locale }), locale).english
}

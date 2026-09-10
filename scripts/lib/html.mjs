/**
 * HTML rendering for the status dashboard - the second renderer over the same
 * state object lib/render.mjs draws in ASCII.
 *
 * Pure string functions, no filesystem access of any kind - test/html.test.mjs
 * asserts the absence of a node:fs import, exactly as render.test.mjs does for
 * the ASCII renderer, and for the same reason: the collector (lib/state.mjs)
 * owns every read, and a renderer that could read a file could render
 * something the state object never carried.
 *
 * Why a second renderer rather than a model-written page. The status screen's
 * whole claim is that it is computed rather than described. A page assembled
 * by a model from --json output would be a description of the numbers, free to
 * drift from them and to look equally authoritative while doing it. Rendering
 * it here keeps the page a function of the state: same input, same bytes.
 *
 * Why HTML at all, when the ASCII screen already exists. The ASCII palette is
 * '+', '-', '|' and '=' because Windows console codepages mangle everything
 * else, and every column is pre-padded to a measured width. That is careful
 * work in a terminal and dead weight in a browser, where the tone matrix wants
 * to be a grid and a drift delta wants to be a bar with a threshold on it. The
 * two renderers are not rival views of the state; they are the same reading,
 * set for two different surfaces.
 *
 * The output is a FRAGMENT - no doctype, no <html>, no <head>, no <body>. The
 * Claude Code Artifact host supplies that skeleton at publish time, and every
 * browser renders a fragment correctly when the file is opened straight off
 * disk, so one output serves both without a mode flag.
 */

/** Contexts and states arrive on the state object; nothing here hardcodes them. */
const SHORT_STATE = {
  delighted: 'del',
  curious: 'cur',
  focused: 'foc',
  uncertain: 'unc',
  confused: 'con',
  frustrated: 'fru',
  'anxious-at-risk': 'anx',
  'disappointed-leaving': 'dis'
}

const CONFIDENCE_CONSEQUENCE = {
  confirmed: 'blocks in review',
  derived: 'warns',
  assumed: 'nit',
  disputed: 'never enforced'
}

const STAGE_ORDER = ['scan', 'ingest', 'measure', 'draft', 'interview', 'canonize']

/**
 * Escape before interpolation, never after. Every value on the state object is
 * user-authored somewhere - a brand name, a rule id, a validation message
 * quoting a file's own text - and this renderer's output is published to a URL
 * a colleague opens. `&` first, or it would double-escape the entities the
 * later replacements introduce.
 */
export function escapeHtml (value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** A number a reader can scan: no trailing zeros, no exponent, never NaN. */
function num (value, fallback = '-') {
  if (value === null || value === undefined) return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return String(Math.round(n * 100) / 100)
}

function pct (part, whole) {
  if (!whole) return 0
  return Math.round((part / whole) * 100)
}

/**
 * Naive on purpose, but not so naive it prints "4 ledger entrys". Only the two
 * rules this page's own vocabulary actually needs: a consonant + y takes -ies,
 * everything else takes -s. A word that needs more than that should be passed
 * in already plural rather than teaching this function English.
 */
const plural = (n, word) => {
  if (n === 1) return `${n} ${word}`
  if (/[^aeiou]y$/.test(word)) return `${n} ${word.slice(0, -1)}ies`
  return `${n} ${word}s`
}

/**
 * "0d", "4d", "3mo". Age is the one number on this page a reader converts in
 * their head if it is not converted for them, and "97 days" is exactly the
 * shape that gets misread as "recent".
 */
function age (days) {
  if (days === null || days === undefined) return 'unknown'
  if (days === 0) return 'today'
  if (days < 31) return `${days}d ago`
  if (days < 365) return `${Math.round(days / 30)}mo ago`
  return `${Math.round(days / 365)}y ago`
}

// ---------------------------------------------------------------- components

function statTile ({ label, value, unit = '', note = '', tone = 'plain' }) {
  return `<div class="tile tile--${escapeHtml(tone)}">
      <p class="tile__label">${escapeHtml(label)}</p>
      <p class="tile__value">${escapeHtml(value)}${unit ? `<span class="tile__unit">${escapeHtml(unit)}</span>` : ''}</p>
      ${note ? `<p class="tile__note">${escapeHtml(note)}</p>` : ''}
    </div>`
}

function section (id, title, lede, body) {
  return `<section class="section" id="${escapeHtml(id)}">
      <header class="section__head">
        <h2>${escapeHtml(title)}</h2>
        ${lede ? `<p class="section__lede">${escapeHtml(lede)}</p>` : ''}
      </header>
      ${body}
    </section>`
}

// ----------------------------------------------------------------------- hero

/**
 * The one full-bleed yellow field on the page.
 *
 * The deck's signature move, borrowed exactly: box-shadow plus a clip-path
 * that lets a band inside a max-width wrapper bleed to both edges without a
 * second wrapper element. It carries the brand, the one-line reading of where
 * this knowledge base stands, and the facts a reader checks before believing
 * any number below - which profile, which locales, and when it was measured.
 *
 * A stale page is the failure mode this hero exists to prevent: the same
 * screenshot is still legible six months later and says nothing about its own
 * age, so the measured date sits in the band rather than in a footer nobody
 * scrolls to.
 */
function hero (state) {
  const kb = state.kb ?? {}
  const coverage = state.coverage ?? {}
  const rules = state.rules ?? {}
  const errors = Number(state.integrity?.errors) || 0
  const blockers = (state.gaps ?? []).filter((g) => g.severity === 'blocker').length

  // The headline is a reading, not a number: a page whose first line is a
  // statistic makes the reader do the interpreting, and the interpreting is
  // exactly what the plugin is for.
  // Coerced, not trusted: a knowledge base that has never been built carries no
  // coverage block at all, and `undefined === 0` is false - which sent the empty
  // case down the branch that assumes there is something to count and put
  // "undefined cells authored of 0" in the largest text on the page.
  const authored = Number(coverage.authored) || 0
  const possible = Number(coverage.possible) || 0

  const headline = errors > 0
    ? `${plural(errors, 'validation error')} to clear before the card can be trusted.`
    : blockers > 0
      ? `${plural(blockers, 'blocker')} between here and a guide that can be enforced.`
      : authored === 0
        ? 'Nothing authored yet. Every cell below is arithmetic, not a decision anyone made.'
        : `${plural(authored, 'cell')} authored of ${possible}, and ${plural(Number(rules.total) || 0, 'rule')} that can be checked.`

  const speaking = kb.role === 'speaker'
  const speakers = state.speakers ?? []
  const specs = [
    ['profile', kb.profile ?? 'default'],
    ['locales', (kb.locales ?? []).join(', ') || 'none'],
    ['kb', kb.version ?? '-'],
    ['card', `${num(state.cardTokens, '0')} tokens`],
    // The chip appears only once a speaker exists, so a speaker-free page is
    // the page it always was.
    ...(!speaking && speakers.length ? [['speakers', String(speakers.length)]] : [])
  ].map(([k, v]) => `<span class="spec">${escapeHtml(k)} <b>${escapeHtml(v)}</b></span>`).join('\n        ')

  const eyebrow = speaking
    ? `Voice and tone, speaking as ${escapeHtml(kb.speaker?.name ?? kb.profile ?? '')}`
    : 'Voice and tone, knowledge base state'

  return `<header class="hero">
      <p class="eyebrow">${eyebrow}</p>
      <h1>${escapeHtml(kb.brand ?? 'Unnamed')}</h1>
      <p class="lede">${escapeHtml(headline)}</p>
      <div class="specs">
        ${specs}
        <span class="spec spec--headline">measured ${escapeHtml(String(state.generated ?? '').slice(0, 10) || 'never')}</span>
      </div>
    </header>`
}

// ----------------------------------------------------------------- attention

/**
 * Gaps lead the page, where the ASCII screen ends with them.
 *
 * That is not an inconsistency between the two renderers, it is the same
 * ranking read for a different surface. A terminal reader finishes at the
 * bottom with the gaps freshest in mind; a page reader scans from the top and
 * may never reach the bottom at all. The one thing this page exists to answer
 * is "what should I do next", so it is answered first.
 */
function attention (gaps) {
  if (!gaps || gaps.length === 0) {
    return `<p class="empty">Nothing outstanding. Every gap the catalogue checks for is closed.</p>`
  }
  const rows = gaps.map((gap) => `<li class="gap gap--${escapeHtml(gap.severity)}">
        <span class="gap__severity" aria-label="severity ${escapeHtml(gap.severity)}">${escapeHtml(gap.severity)}</span>
        <span class="gap__id">${escapeHtml(gap.id)}</span>
        <span class="gap__body">
          <span class="gap__what">${escapeHtml(gap.what)}</span>
          <span class="gap__why">${escapeHtml(gap.why)}</span>
        </span>
        <code class="gap__fix">${escapeHtml(gap.fix)}</code>
      </li>`).join('\n      ')
  return `<ol class="gaps">\n      ${rows}\n    </ol>`
}

// ------------------------------------------------------------------ pipeline

function pipeline (stage) {
  const reached = stage?.reached ?? {}
  const steps = STAGE_ORDER.map((name, i) => {
    const done = Boolean(reached[name])
    const here = stage?.at === name
    return `<li class="step ${done ? 'is-done' : 'is-todo'}${here ? ' is-here' : ''}">
          <span class="step__ord">${i + 1}</span>
          <span class="step__name">${escapeHtml(name)}</span>
          <span class="step__state">${done ? 'done' : 'not yet'}</span>
        </li>`
  }).join('\n        ')
  return `<ol class="pipeline">\n        ${steps}\n      </ol>`
}

// -------------------------------------------------------------- tone matrix

/**
 * The proof sheet.
 *
 * An authored cell is printed in ink. A computed cell is printed in non-photo
 * blue - the colour a print shop marks a sheet up in precisely because it does
 * not reproduce. That is the whole legend in one material fact: the pale cells
 * are on the sheet and are not yet real, which is exactly what "interpolated
 * from the dial arithmetic, never written or approved by a person" means.
 *
 * Identity is never carried by colour alone: an authored cell also carries a
 * filled mark and its own aria-label, and the humor gate is drawn as a rule
 * under the three columns it applies to rather than as a fourth colour.
 */
function matrix (coverage) {
  const states = coverage?.states ?? []
  const gated = new Set(coverage?.humorGated ?? [])
  const contexts = coverage?.byContext ?? []
  const maxTraffic = Math.max(1, ...contexts.map((c) => Number(c.traffic) || 0))

  const head = states.map((s) => `<th scope="col" class="${gated.has(s) ? 'is-gated' : ''}">
            <abbr title="${escapeHtml(s)}">${escapeHtml(SHORT_STATE[s] ?? s.slice(0, 3))}</abbr>
          </th>`).join('\n          ')

  const rows = contexts.map((row) => {
    const cells = (row.cells ?? []).map((cell, i) => {
      const state = states[i] ?? `state ${i + 1}`
      const authored = cell === 'authored'
      const label = `${row.context} / ${state}: ${authored ? 'authored' : 'computed'}`
      return `<td class="cell cell--${authored ? 'authored' : 'computed'}${gated.has(state) ? ' is-gated' : ''}">
              <span class="mark" role="img" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"></span>
            </td>`
    }).join('\n            ')
    const traffic = Number(row.traffic) || 0
    const bare = row.authored === 0 && traffic > 0
    return `<tr class="${bare ? 'row--bare' : ''}">
          <th scope="row" class="matrix__context">${escapeHtml(row.context)}${bare ? '<span class="row__flag" title="corpus traffic, but no authored cells">unwritten</span>' : ''}</th>
          ${cells}
          <td class="matrix__count"><span>${row.authored}</span>/${row.of}</td>
          <td class="matrix__traffic">
            <span class="traffic__pair">
              <span class="traffic" style="--w:${pct(traffic, maxTraffic)}%" title="${escapeHtml(`${traffic} words of corpus traffic`)}"></span>
              <span class="traffic__n">${traffic}</span>
            </span>
          </td>
        </tr>`
  }).join('\n        ')

  return `<div class="matrix__scroll">
        <table class="matrix">
          <caption class="sr-only">Tone matrix: which context and reader-state cells are authored</caption>
          <thead>
            <tr>
              <th scope="col" class="matrix__corner">context</th>
              ${head}
              <th scope="col" class="matrix__corner">authored</th>
              <th scope="col" class="matrix__corner">traffic</th>
            </tr>
          </thead>
          <tbody>
        ${rows}
          </tbody>
        </table>
      </div>
      <div class="matrix__legend">
        <span class="key"><span class="mark mark--authored"></span> authored by a person</span>
        <span class="key"><span class="mark mark--computed"></span> computed from the dials</span>
        <span class="key"><span class="key__rule"></span> humor forced to 0, authored or not</span>
      </div>`
}

// ---------------------------------------------------------------- confidence

/**
 * A single-hue ramp, deliberately - confidence is an ordered scale, not four
 * unrelated categories, and the order IS the consequence: what blocks a review,
 * what merely warns, what is a nit, what is never enforced at all. Every row
 * carries that consequence in words, so the ramp reinforces the reading rather
 * than being the only thing that carries it.
 */
function confidence (rules, role = 'house') {
  const by = rules?.byConfidence ?? {}
  const total = Number(rules?.total) || 0
  const rows = Object.keys(CONFIDENCE_CONSEQUENCE).map((level) => {
    const n = Number(by[level]) || 0
    return `<li class="conf conf--${escapeHtml(level)}">
          <span class="conf__name">${escapeHtml(level)}</span>
          <span class="conf__track"><span class="conf__fill" style="--w:${pct(n, total)}%"></span></span>
          <span class="conf__n">${n}</span>
          <span class="conf__use">${escapeHtml(CONFIDENCE_CONSEQUENCE[level])}</span>
        </li>`
  }).join('\n        ')
  if (role !== 'speaker') return `<ul class="confs">\n        ${rows}\n      </ul>`
  // A speaker's rules are the house's plus its own, minus what it replaced.
  // Which is which is the reading a speaker page owes its reader.
  const origin = rules?.byOrigin ?? {}
  const originRows = [['house', origin.house], ['speaker', origin.speaker], ['overrides', origin.overrides], ['locked', origin.locked]]
    .map(([k, v]) => `<tr><th scope="row">${escapeHtml(k)}</th><td class="n">${num(v, '0')}</td></tr>`).join('\n          ')
  return `<ul class="confs">\n        ${rows}\n      </ul>
      <div class="table__scroll">
        <table class="data data--head">
          <caption class="sr-only">Rules by origin</caption>
          <thead><tr><th scope="col">origin</th><th scope="col">rules</th></tr></thead>
          <tbody>
          ${originRows}
          </tbody>
        </table>
      </div>`
}

// ----------------------------------------------------------------- speakers

/**
 * House view only: one row per declared speaker, the same columns the ASCII
 * panel prints. Drift and lock state are carried in words inside a pill, not
 * in colour alone, for the same reason the matrix marks authored cells with
 * a shape.
 */
function speakersSection (state) {
  const rows = (state.speakers ?? []).map((s) => {
    const drift = !s.driftBaseline
      ? '<span class="pill pill--soft">n/a</span>'
      : s.driftFlagged ? '<span class="pill pill--warn">FLAG</span>' : '<span class="pill pill--good">ok</span>'
    return `<tr>
            <th scope="row">${escapeHtml(s.slug)}</th>
            <td>${escapeHtml(s.name)}</td>
            <td class="n">${num(s.voiceRules, '0')}</td>
            <td class="n">${num(s.authoredCells, '0')}</td>
            <td class="n">${num(s.overrides, '0')}</td>
            <td class="n">${s.lockViolations ? `<span class="pill pill--warn">${num(s.lockViolations)}</span>` : '-'}</td>
            <td>${drift}</td>
            <td class="n">${num(s.draftsPending, '0')}</td>
          </tr>`
  }).join('\n          ')
  return `<div class="table__scroll">
        <table class="data data--head">
          <caption class="sr-only">Speakers declared on this house</caption>
          <thead><tr><th scope="col">slug</th><th scope="col">name</th><th scope="col">voice</th><th scope="col">cells</th><th scope="col">overrides</th><th scope="col">locks broken</th><th scope="col">drift</th><th scope="col">drafts</th></tr></thead>
          <tbody>
          ${rows}
          </tbody>
        </table>
      </div>`
}

// --------------------------------------------------------------------- drift

/**
 * A diverging bar around a zero axis, with the flag threshold drawn on the
 * track rather than stated beside it.
 *
 * The scale is per locale and never smaller than twice the threshold, so the
 * threshold ticks always sit inside the track and a locale whose every metric
 * is flat still shows what "flat" is being measured against. Without that floor
 * a single 2% wobble would fill the bar and read as a crisis.
 */
function driftTrack (deltaPct, scale, threshold) {
  const d = Number(deltaPct)
  if (!Number.isFinite(d)) {
    return `<span class="track track--na"><span class="track__axis"></span><span class="track__na">no baseline</span></span>`
  }
  const half = Math.max(0.001, scale)
  const reach = Math.min(50, Math.abs(d) / half * 50)
  const side = d < 0 ? 'left' : 'right'
  const tick = Math.min(50, threshold / half * 50)
  return `<span class="track">
            <span class="track__tick" style="--x:${50 - tick}%"></span>
            <span class="track__tick" style="--x:${50 + tick}%"></span>
            <span class="track__axis"></span>
            <span class="track__fill track__fill--${side}" style="--w:${reach}%"></span>
          </span>`
}

function drift (state) {
  const threshold = Number(state.drift?.thresholdPct) || 25
  const byLocale = state.drift?.byLocale ?? {}
  const locales = Object.keys(byLocale)
  if (locales.length === 0) {
    return `<p class="empty">No fingerprint yet, so nothing to compare. Run <code>/voice-and-tone:status --refresh</code>.</p>`
  }

  return locales.map((locale) => {
    const block = byLocale[locale] ?? {}
    const metrics = block.metrics ?? []
    if (!block.baseline) {
      return `<div class="locale">
        <h3 class="locale__name">${escapeHtml(locale)}</h3>
        <p class="empty">No baseline frozen for this locale, so drift cannot be measured here.</p>
      </div>`
    }
    const scale = Math.max(threshold * 2, ...metrics.map((m) => Math.abs(Number(m.deltaPct) || 0)))
    const rows = metrics.map((m) => `<tr class="${m.flagged ? 'is-flagged' : ''}">
            <th scope="row">${escapeHtml(m.label)}</th>
            <td class="n">${num(m.from)}</td>
            <td class="arrow" aria-hidden="true">&rarr;</td>
            <td class="n">${num(m.to)}</td>
            <td class="n delta">${m.deltaPct === null || m.deltaPct === undefined ? '-' : `${num(m.deltaPct)}%`}</td>
            <td class="trackcell">${driftTrack(m.deltaPct, scale, threshold)}</td>
            <td class="flag">${m.flagged ? '<span class="pill pill--warn">past threshold</span>' : ''}</td>
          </tr>`).join('\n          ')
    return `<div class="locale">
        <h3 class="locale__name">${escapeHtml(locale)}<span class="locale__base">baseline ${escapeHtml(String(block.baseline).slice(0, 10))}</span></h3>
        <div class="table__scroll">
          <table class="data">
            <caption class="sr-only">Drift for ${escapeHtml(locale)} against its frozen baseline</caption>
            <tbody>
          ${rows}
            </tbody>
          </table>
        </div>
      </div>`
  }).join('\n      ')
}

// ----------------------------------------------------------------- integrity

function integrity (state) {
  const int = state.integrity ?? {}
  const findings = int.findings ?? []
  const fresh = state.freshness ?? {}
  const card = fresh.card
  const cardLine = !card
    ? 'CONTEXT.md has never been compiled.'
    : card.staleAgainst?.length
      ? `CONTEXT.md is behind ${card.staleAgainst.join(', ')}.`
      : `CONTEXT.md is current, compiled ${age(card.ageDays)}.`

  const notes = `<ul class="notes">
        <li><span class="notes__k">card</span> ${escapeHtml(cardLine)}</li>
        <li><span class="notes__k">manifest</span> ${escapeHtml(fresh.manifest ? `${age(fresh.manifest.ageDays)}, ${fresh.manifest.changedSince} of ${fresh.manifest.checked} listed files changed since` : 'never built')}</li>
        <li><span class="notes__k">fingerprint</span> ${escapeHtml(fresh.fingerprint ? age(fresh.fingerprint.ageDays) : 'never built')}</li>
      </ul>`

  if (findings.length === 0) {
    return `${notes}<p class="empty">Validation is clean: no errors, no warnings.</p>`
  }
  const rows = findings.map((f) => `<li class="finding finding--${escapeHtml(f.severity)}">
          <span class="finding__sev">${escapeHtml(f.severity)}</span>
          <code class="finding__code">${escapeHtml(f.code)}</code>
          <span class="finding__msg">${escapeHtml(f.message)}</span>
          <span class="finding__at">${escapeHtml(f.file ?? '')}${f.line ? `:${escapeHtml(f.line)}` : ''}</span>
        </li>`).join('\n        ')
  return `${notes}<ul class="findings">\n        ${rows}\n      </ul>`
}

// ------------------------------------------------------------------- corpus

function corpus (state) {
  const c = state.corpus ?? {}
  const byLocale = c.byLocale ?? {}
  const fidelity = c.fidelity ?? {}
  const locales = Object.keys(byLocale)
  const maxWords = Math.max(1, ...locales.map((l) => Number(byLocale[l]?.words) || 0))
  const rows = locales.map((l) => {
    const b = byLocale[l] ?? {}
    const est = fidelity[l] === 'estimated'
    return `<tr>
            <th scope="row">${escapeHtml(l)}${est ? '<span class="pill pill--soft" title="at least one contributing source was transcribed by the model tier">estimated</span>' : ''}</th>
            <td class="n">${num(b.files, '0')}</td>
            <td class="n">${num(b.strings, '0')}</td>
            <td class="n">${num(b.words, '0')}</td>
            <td class="trackcell"><span class="track track--mag"><span class="track__fill track__fill--mag" style="--w:${pct(Number(b.words) || 0, maxWords)}%"></span></span></td>
          </tr>`
  }).join('\n          ')

  if (locales.length === 0) return `<p class="empty">No copy measured yet.</p>`

  return `<div class="table__scroll">
        <table class="data data--head">
          <caption class="sr-only">Corpus by locale</caption>
          <thead><tr><th scope="col">locale</th><th scope="col">files</th><th scope="col">strings</th><th scope="col">words</th><th scope="col"></th></tr></thead>
          <tbody>
          ${rows}
          </tbody>
        </table>
      </div>`
}

// ------------------------------------------------------------------ sources

function sources (state) {
  const s = state.sources ?? {}
  const register = state.settings?.register ?? []
  const counts = [
    ['registered', s.registered],
    ['analysed', s.analysed],
    ['missing', s.missing],
    ['not ingested', s.unindexed]
  ].map(([k, v]) => `<div class="minitile"><span class="minitile__n">${num(v, '0')}</span><span class="minitile__k">${escapeHtml(k)}</span></div>`).join('\n        ')

  const freshnessNote = s.freshness === 'unchecked'
    ? 'Freshness not checked on this run - hashing every registered source is real I/O, so a read-only glance skips it. Use --refresh.'
    : `${plural(Number(s.fresh) || 0, 'source')} current, ${plural(Number(s.stale) || 0, 'source')} stale.`

  const rows = register.map((entry) => `<li class="reg">
          <code class="reg__id">${escapeHtml(entry.id)}</code>
          <span class="pill pill--soft">${escapeHtml(entry.kind)}</span>
          <span class="reg__label">${escapeHtml(entry.label ?? '')}</span>
        </li>`).join('\n        ')

  return `<div class="minitiles">\n        ${counts}\n      </div>
      <p class="note">${escapeHtml(freshnessNote)}</p>
      ${register.length ? `<ul class="regs">\n        ${rows}\n      </ul>` : ''}
      ${(Number(s.missing) || 0) > 0 ? `<p class="note">Absent sources keep their statistics; a fresh clone has none of them on disk. This is ordinary, not a warning.</p>` : ''}`
}

// ----------------------------------------------------------------- evidence

function evidence (state) {
  const e = state.evidence ?? {}
  const byType = e.byType ?? {}
  const rows = Object.entries(byType).map(([type, n]) => `<div class="minitile"><span class="minitile__n">${num(n, '0')}</span><span class="minitile__k">${escapeHtml(type)}</span></div>`).join('\n        ')
  return `<div class="minitiles">\n        ${rows}\n      </div>
      <p class="note">${escapeHtml(`${plural(Number(e.total) || 0, 'ledger entry')}, ${plural(Number(e.conflicts) || 0, 'open dispute')}, ${plural(Number(e.drafts) || 0, 'retained draft')}.`)}</p>`
}

// ----------------------------------------------------------------- settings

function settings (state) {
  const set = state.settings ?? {}
  const th = set.thresholds ?? {}
  const rows = [
    ['corroboration', th.corroboration, 'independent corrections before an edit becomes a rule'],
    ['derived min samples', th.derived_min_samples, 'corpus samples before a rule may be derived'],
    ['stale months', th.stale_months, 'age at which a rule is flagged for re-checking'],
    ['drift threshold', th.drift_pct === undefined ? null : `${th.drift_pct}%`, 'change past which a metric is flagged']
  ].map(([k, v, why]) => `<tr><th scope="row">${escapeHtml(k)}</th><td class="n">${escapeHtml(v ?? '-')}</td><td class="why">${escapeHtml(why)}</td></tr>`).join('\n          ')

  const vendor = (set.vendor ?? []).map((v) => `<li><code>${escapeHtml(v.name)}</code> ${escapeHtml(v.version)}</li>`).join('')
  const packs = state.localePacks ?? []

  return `<div class="table__scroll">
        <table class="data data--head">
          <caption class="sr-only">Thresholds</caption>
          <thead><tr><th scope="col">threshold</th><th scope="col">value</th><th scope="col">what it governs</th></tr></thead>
          <tbody>
          ${rows}
          </tbody>
        </table>
      </div>
      <p class="note">Locale packs: ${packs.length ? escapeHtml(packs.join(', ')) : 'none authored'}. Extractors: ${vendor ? `<ul class="inline">${vendor}</ul>` : 'none'}</p>${locksNote(state)}`
}

/** Present only once locks could govern something: a speaker view, or a house that declares any. */
function locksNote (state) {
  const declared = state.locks?.declared ?? []
  if (state.kb?.role !== 'speaker' && declared.length === 0) return ''
  const list = declared.length ? declared.map((id) => `<code>${escapeHtml(id)}</code>`).join(' ') : 'none declared'
  return `\n      <p class="note">Locks: ${list}</p>`
}

// -------------------------------------------------------------------- styles

/**
 * The project's own visual system, taken from docs/presentation/index.html
 * rather than invented alongside it: white paper, the yellow band, cream
 * plates with no outlines, Fraunces over Archivo over IBM Plex Mono. A status
 * page that looked like a different product would undo the thing the deck is
 * for.
 *
 * Light only, deliberately. The deck commits to one visual world and this page
 * is part of it; a dark variant would be a second design to keep in step with
 * the first, and the yellow band is the identity - it does not survive being
 * re-stepped for a dark ground without becoming a different colour. So there
 * is no prefers-color-scheme block and no data-theme block: every colour is
 * painted explicitly from a token defined once, and `body` sets its own
 * background so the page never borrows the host's ground.
 *
 * Two things a deck does not need and a data page does are added on top. A
 * reserved status set (good / caution / warn) kept away from the accent, so
 * severity never borrows the brand colour. And `--ghost`, a non-photo blue:
 * the colour a print shop marks a sheet up in because it does not reproduce,
 * used for exactly the cells that are on the sheet without being real yet.
 *
 * The band appears once, on the hero. It is the loudest thing the brand owns,
 * and spending it twice on one page would leave nothing to mean "start here".
 */const STYLES = `
:root {
  --paper:      #ffffff;
  --band:       #ffe01b;
  --on-band:    #241c15;
  --cream:      #fbf7ec;
  --grey:       #f0efe9;
  --mist:       #eef3f4;
  --ink:        #241c15;
  --ink-soft:   #5b5147;
  --ink-faint:  #8b8177;
  --edge:       #e4dccb;
  --edge-soft:  #efe9dc;
  --rule-soft:  #ece7db;
  --accent:     #007c89;
  --accent-ink: #005b64;
  --warn:       #b8341f;
  --warn-bg:    #fbeae4;
  --good:       #2f6f4f;
  --caution:    #8a5a12;
  --ghost:      #8ec6d8;
  --ghost-soft: #dff0f5;

  --display: "Fraunces", "Iowan Old Style", Georgia, serif;
  --body: "Archivo", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;

  /* One definition of the vertical rhythm between top-level blocks. Both
     .section and .grid take it: a plate row is a block like any other, and
     when only .section carried the margin those rows butted straight against
     the matrix legend and the drift table above them. */
  --rhythm: clamp(2.75rem, 5vw, 4rem);
  --r-lg: 20px;
  --r-md: 14px;
  --step--1: clamp(.88rem, .855rem + .12vw, .95rem);
  --step-0:  clamp(1.02rem, .99rem + .16vw, 1.12rem);
  --step-1:  clamp(1.25rem, 1.16rem + .4vw, 1.5rem);
  --step-2:  clamp(1.75rem, 1.5rem + 1.15vw, 2.6rem);
  --step-3:  clamp(2.5rem, 1.9rem + 2.9vw, 4.5rem);
}

* { box-sizing: border-box; }
body {
  margin: 0; background: var(--paper); color: var(--ink);
  font-family: var(--body); font-size: var(--step-0); line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
.wrap { width: min(100% - 2.5rem, 76rem); margin-inline: auto; padding-bottom: 4rem; }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; border-radius: 4px; }
h1, h2, h3 { font-family: var(--display); text-wrap: balance; margin: 0; line-height: 1.08; }
h1 { font-size: var(--step-3); font-weight: 700; letter-spacing: -.02em; }
h2 { font-size: var(--step-2); font-weight: 700; letter-spacing: -.015em; }
h3 { font-size: var(--step-1); font-weight: 600; line-height: 1.25; }
p { margin: 0; text-wrap: pretty; }
code, .mono { font-family: var(--mono); font-size: .9em; }
code { background: var(--cream); padding: .1em .34em; border-radius: 4px; }
.n, .num { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.eyebrow {
  font-family: var(--body); font-size: var(--step--1); font-weight: 700;
  text-transform: uppercase; letter-spacing: .12em; color: var(--ink-soft); margin: 0 0 1.25rem;
}
.note { font-size: var(--step--1); color: var(--ink-soft); line-height: 1.6; max-width: 68ch; }
.empty { font-size: var(--step--1); color: var(--ink-faint); font-style: italic; margin: 0; }

/* ---------- hero: the one full-bleed yellow field ---------- */
.hero {
  padding-block: clamp(3rem, 6vw, 4.5rem) clamp(2.5rem, 5vw, 3.5rem);
  background: var(--band); color: var(--on-band);
  box-shadow: 0 0 0 100vmax var(--band); clip-path: inset(0 -100vmax);
  margin-bottom: clamp(2.5rem, 5vw, 4rem);
}
.hero .eyebrow { color: var(--on-band); opacity: .78; }
.hero h1 { color: var(--on-band); max-width: 15ch; }
.hero .lede {
  font-size: var(--step-1); line-height: 1.45; color: var(--on-band);
  opacity: .82; max-width: 48ch; margin-top: 1.35rem;
}
.specs { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: 2.25rem; }
.spec {
  font-size: var(--step--1); font-weight: 500; background: var(--paper); color: var(--ink);
  border-radius: 999px; padding: .38rem .95rem; font-variant-numeric: tabular-nums;
}
.spec b { font-weight: 700; }
.spec--headline { background: var(--on-band); color: var(--band); font-weight: 600; }

/* ---------- sections ---------- */
.section, .grid { margin-top: var(--rhythm); }
.section__head { margin-bottom: 1.15rem; }
.section__lede { font-size: var(--step--1); color: var(--ink-soft); max-width: 68ch; margin-top: .4rem; }
.grid { display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); }
/* A section nested inside a plate is the plate's own heading, not a new block. */
.plate .section, .plate .grid { margin-top: 0; }
.plate { background: var(--cream); border-radius: var(--r-lg); padding: clamp(1.35rem, 3vw, 2rem); }
.inline { display: inline; list-style: none; padding: 0; margin: 0; }
.inline li { display: inline; }
.inline li + li::before { content: " / "; color: var(--ink-faint); }

/* ---------- tiles: flat fields, no outlines ---------- */
.tiles { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); }
.tile { background: var(--cream); border-radius: var(--r-md); padding: 1rem 1.15rem; }
.tile__label {
  font-family: var(--body); font-size: .72rem; font-weight: 700; letter-spacing: .11em;
  text-transform: uppercase; color: var(--ink-faint); margin: 0 0 .35rem;
}
.tile__value {
  font-family: var(--display); font-size: 2.1rem; font-weight: 700; line-height: 1;
  margin: 0; font-variant-numeric: tabular-nums; letter-spacing: -.02em;
}
.tile__unit { font-family: var(--body); font-size: .8rem; font-weight: 500; color: var(--ink-faint); margin-left: .3rem; }
.tile__note { margin: .5rem 0 0; font-size: .78rem; color: var(--ink-soft); line-height: 1.45; }
.tile--good .tile__value { color: var(--good); }
.tile--warn .tile__value { color: var(--warn); }
.tile--caution .tile__value { color: var(--caution); }

.minitiles { display: grid; gap: .5rem; grid-template-columns: repeat(auto-fit, minmax(6rem, 1fr)); }
.minitile { background: var(--paper); border-radius: var(--r-md); padding: .6rem .8rem; }
.minitile__n { display: block; font-family: var(--mono); font-size: 1.2rem; font-variant-numeric: tabular-nums; }
.minitile__k { display: block; font-size: .68rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-faint); }

/* ---------- gaps ---------- */
.gaps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .55rem; }
.gap {
  display: grid; gap: .25rem .9rem; align-items: baseline;
  grid-template-columns: 5.5rem 2.75rem 1fr auto;
  background: var(--cream); border-radius: var(--r-md); padding: .9rem 1.1rem;
}
.gap--blocker { background: var(--warn-bg); }
.gap__severity { font-size: .68rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
.gap--blocker .gap__severity { color: var(--warn); }
.gap--warning .gap__severity { color: var(--caution); }
.gap--nit .gap__severity { color: var(--ink-faint); }
.gap__id { font-family: var(--mono); font-size: .75rem; color: var(--ink-faint); }
.gap__body { display: flex; flex-direction: column; }
.gap__what { font-weight: 600; }
.gap__why { color: var(--ink-soft); font-size: var(--step--1); }
.gap__fix {
  font-family: var(--mono); font-size: .78rem; background: var(--paper);
  padding: .25rem .6rem; border-radius: 6px; white-space: nowrap; color: var(--accent-ink);
}

/* ---------- pipeline ---------- */
.pipeline { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: .5rem; }
.step {
  display: flex; align-items: center; gap: .5rem; padding: .45rem .9rem;
  border-radius: 999px; background: var(--grey); font-size: var(--step--1);
}
.step__ord {
  font-family: var(--mono); font-size: .7rem; width: 1.3rem; height: 1.3rem; border-radius: 50%;
  display: grid; place-items: center; background: var(--paper); color: var(--ink-faint);
}
.step__state { font-size: .68rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-faint); }
.step.is-done { background: var(--ink); color: var(--paper); }
.step.is-done .step__ord { background: var(--band); color: var(--on-band); }
.step.is-done .step__state { color: var(--paper); opacity: .7; }
.step.is-here { box-shadow: 0 0 0 3px var(--band); }

/* ---------- tone matrix: the proof sheet ---------- */
.matrix__scroll, .table__scroll { overflow-x: auto; }
.matrix { border-collapse: collapse; font-size: .82rem; width: 100%; }
.matrix th, .matrix td { padding: .3rem .4rem; text-align: center; }
.matrix thead th {
  font-family: var(--body); font-size: .66rem; font-weight: 700; letter-spacing: .09em;
  text-transform: uppercase; color: var(--ink-faint); border-bottom: 1px solid var(--edge);
  padding-bottom: .55rem;
}
.matrix thead th.is-gated { color: var(--ink-soft); border-bottom: 2px solid var(--ink-faint); }
.matrix thead th abbr { text-decoration: none; border: 0; }
.matrix__context {
  text-align: left; font-weight: 400; font-family: var(--mono); font-size: .78rem;
  white-space: nowrap; padding-right: .9rem; color: var(--ink-soft);
}
.row--bare .matrix__context { color: var(--ink); }
.row__flag {
  margin-left: .5rem; font-family: var(--body); font-size: .6rem; font-weight: 700;
  letter-spacing: .08em; text-transform: uppercase; color: var(--on-band);
  background: var(--band); border-radius: 4px; padding: .1rem .35rem;
}
.mark { display: inline-block; width: 15px; height: 15px; border-radius: 3px; vertical-align: middle; }
.cell--authored .mark, .mark--authored { background: var(--ink); }
.cell--computed .mark, .mark--computed { background: var(--ghost-soft); border: 1.5px solid var(--ghost); }
.matrix__count { font-family: var(--mono); font-size: .78rem; color: var(--ink-faint); white-space: nowrap; padding-left: .8rem; }
.matrix__count span { color: var(--ink); font-weight: 500; }
.matrix__traffic { padding-left: .7rem; }
.traffic__pair { display: flex; align-items: center; gap: .5rem; }
.traffic { display: block; height: 6px; width: 4.5rem; border-radius: 3px; background: var(--grey); position: relative; }
.traffic::after {
  content: ""; position: absolute; inset: 0 auto 0 0; width: var(--w);
  background: var(--accent); border-radius: 3px; opacity: .6;
}
.traffic__n { font-family: var(--mono); font-size: .72rem; color: var(--ink-faint); min-width: 2.4rem; text-align: right; }
.matrix__legend { display: flex; flex-wrap: wrap; gap: .5rem 1.4rem; margin-top: 1rem; font-size: var(--step--1); color: var(--ink-soft); }
.key { display: inline-flex; align-items: center; gap: .45rem; }
.key__rule { display: inline-block; width: 15px; height: 0; border-bottom: 2px solid var(--ink-faint); }

/* ---------- confidence ---------- */
.confs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .6rem; }
.conf { display: grid; grid-template-columns: 5.75rem 1fr 2.1rem 8rem; gap: .75rem; align-items: center; }
.conf__name { font-family: var(--mono); font-size: .8rem; }
.conf__track { height: 10px; background: var(--paper); border-radius: 5px; overflow: hidden; }
.conf__fill { display: block; height: 100%; width: var(--w); background: var(--accent); border-radius: 5px; }
.conf--derived .conf__fill { opacity: .72; }
.conf--assumed .conf__fill { opacity: .44; }
.conf--disputed .conf__fill { background: repeating-linear-gradient(45deg, var(--ink-faint) 0 3px, transparent 3px 6px); }
.conf__n { font-family: var(--mono); font-variant-numeric: tabular-nums; text-align: right; }
.conf__use { font-size: .78rem; color: var(--ink-faint); }

/* ---------- data tables ---------- */
.data { width: 100%; border-collapse: collapse; font-size: var(--step--1); }
.data th, .data td { padding: .4rem .65rem; text-align: left; border-bottom: 1px solid var(--rule-soft); }
.data--head thead th {
  font-family: var(--body); font-size: .66rem; font-weight: 700; letter-spacing: .09em;
  text-transform: uppercase; color: var(--ink-faint);
}
.data th[scope="row"] { font-weight: 400; color: var(--ink-soft); white-space: nowrap; }
.data td.n, .data .n { font-family: var(--mono); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
.data .arrow { color: var(--ink-faint); padding: 0 .1rem; text-align: center; }
.data .why { color: var(--ink-faint); font-size: .78rem; }
.data tr.is-flagged .delta { color: var(--warn); font-weight: 700; }
.trackcell { width: 12rem; }
.locale { margin-top: 1.15rem; }
.locale__name { display: flex; flex-wrap: wrap; align-items: baseline; gap: .75rem; margin: 0 0 .4rem; font-size: var(--step-1); }
.locale__base {
  font-family: var(--body); font-size: .68rem; font-weight: 700; letter-spacing: .09em;
  text-transform: uppercase; color: var(--ink-faint);
}

/* ---------- tracks ---------- */
.track { position: relative; display: block; height: 12px; width: 100%; min-width: 7rem; background: var(--grey); border-radius: 6px; }
.track__axis { position: absolute; top: 0; bottom: 0; left: 50%; width: 1px; background: var(--ink-faint); opacity: .55; }
.track__tick { position: absolute; top: 2px; bottom: 2px; left: var(--x); width: 1px; background: var(--ink-faint); opacity: .3; }
.track__fill { position: absolute; top: 2px; bottom: 2px; width: var(--w); background: var(--accent); border-radius: 3px; }
.track__fill--right { left: 50%; }
.track__fill--left { right: 50%; }
.track--na { background: transparent; }
.track__na { font-family: var(--mono); font-size: .72rem; color: var(--ink-faint); }
.track--mag { min-width: 5.5rem; }
.track--mag .track__fill--mag { left: 0; opacity: .6; }
tr.is-flagged .track__fill { background: var(--warn); }

/* ---------- findings, register, notes ---------- */
.findings, .regs, .notes { list-style: none; margin: .9rem 0 0; padding: 0; display: flex; flex-direction: column; gap: .45rem; }
.finding { display: grid; grid-template-columns: 4rem auto 1fr auto; gap: .25rem .7rem; align-items: baseline; font-size: .82rem; }
.finding__sev { font-size: .66rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.finding--error .finding__sev { color: var(--warn); }
.finding--warning .finding__sev { color: var(--caution); }
.finding__code { font-family: var(--mono); font-size: .72rem; color: var(--ink-faint); background: none; padding: 0; }
.finding__msg { color: var(--ink-soft); }
.finding__at { font-family: var(--mono); font-size: .72rem; color: var(--ink-faint); white-space: nowrap; }
.notes li { font-size: var(--step--1); color: var(--ink-soft); }
.notes__k { font-size: .66rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-faint); margin-right: .55rem; }
.reg { display: flex; align-items: center; gap: .6rem; font-size: var(--step--1); }
.reg__id { font-family: var(--mono); font-size: .75rem; color: var(--ink-faint); background: none; padding: 0; }
.reg__label { color: var(--ink-soft); }

.pill {
  font-family: var(--body); font-size: .64rem; font-weight: 700; letter-spacing: .08em;
  text-transform: uppercase; padding: .12rem .5rem; border-radius: 999px;
  border: 1px solid currentColor; white-space: nowrap;
}
.pill--warn { color: var(--warn); background: var(--warn-bg); }
.pill--soft { color: var(--ink-faint); }
.pill--good { color: var(--good); }

.colophon {
  margin-top: clamp(3rem, 6vw, 4.5rem); padding-top: 1.15rem; border-top: 2px solid var(--ink);
  font-size: .78rem; color: var(--ink-faint); display: flex; flex-wrap: wrap; gap: .4rem 1.4rem;
}

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
@media (max-width: 640px) {
  .gap { grid-template-columns: 1fr; }
  .conf { grid-template-columns: 5rem 1fr 1.9rem; }
  .conf__use { grid-column: 1 / -1; }
  .finding { grid-template-columns: 1fr; }
}
`

// --------------------------------------------------------------------- page

/**
 * The whole state object as one page. There is no --panel equivalent here and
 * that is deliberate: --panel exists because a terminal cannot scroll back
 * usefully and a full screen buries the panel you came for. A page scrolls,
 * and slicing it would only hide the cross-reading the page is for - a drift
 * flag next to the corpus that moved, a validation error next to the rule it
 * names.
 */
export function renderHtml (state) {
  const kb = state.kb ?? {}
  const coverage = state.coverage ?? {}
  const rules = state.rules ?? {}
  const int = state.integrity ?? {}
  const totals = state.corpus?.totals ?? {}
  const blockers = (state.gaps ?? []).filter((g) => g.severity === 'blocker').length

  const tiles = [
    statTile({ label: 'stage', value: state.stage?.at ?? '-', note: 'furthest step the pipeline has reached' }),
    statTile({
      label: 'tone matrix',
      value: `${num(coverage.authored, '0')}/${num(coverage.possible, '0')}`,
      note: `${pct(coverage.authored, coverage.possible)}% of cells authored by a person`
    }),
    statTile({ label: 'rules', value: num(rules.total, '0'), note: `${num(rules.byConfidence?.confirmed, '0')} confirmed, ${num(rules.byConfidence?.disputed, '0')} disputed` }),
    statTile({
      label: 'validation',
      value: num(int.errors, '0'),
      unit: int.errors === 1 ? 'error' : 'errors',
      note: `${plural(Number(int.warnings) || 0, 'warning')}`,
      tone: int.errors > 0 ? 'warn' : int.warnings > 0 ? 'caution' : 'good'
    }),
    statTile({ label: 'corpus', value: num(totals.words, '0'), unit: 'words', note: `${plural(Number(totals.files) || 0, 'file')} measured` }),
    statTile({
      label: 'blockers',
      value: num(blockers, '0'),
      note: blockers ? 'must clear before the card is trustworthy' : 'nothing blocking',
      tone: blockers ? 'warn' : 'good'
    })
  ].join('\n        ')

  return `<title>${kb.brand ? `${escapeHtml(kb.brand)} Voice State` : 'Voice and Tone State'}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Archivo:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>${STYLES}</style>
<div class="wrap">
  ${hero(state)}

  <div class="tiles">
        ${tiles}
  </div>

  ${section('attention', 'What to do next', 'Ranked by leverage: the change that unblocks the most other work sits at the top.', attention(state.gaps))}

  ${section('pipeline', 'Pipeline', 'Which steps of discovery this knowledge base has actually been through.', pipeline(state.stage))}
${kb.role !== 'speaker' && (state.speakers ?? []).length
    ? `\n  ${section('speakers', 'Speakers', 'Each speaker inherits the house and replaces its voice. Locked house rules apply to all of them.', speakersSection(state))}\n`
    : ''}
  ${section('matrix', 'Tone matrix', 'Ten contexts against eight reader states. An authored cell was written and approved by a person; a computed cell is interpolated from the dial arithmetic and never carries humor.', matrix(coverage))}

  <div class="grid">
    <div class="plate">${section('rules', 'Rules by confidence', 'Confidence is not a rating of the rule. It is what happens when the rule is broken.', confidence(rules, kb.role))}</div>
    <div class="plate">${section('evidence', 'Evidence', 'Every rule points back to entries here. Nothing is asserted without one.', evidence(state))}</div>
  </div>

  ${section('integrity', 'Integrity', 'Whether the compiled card still matches the files it was compiled from, and what validation found.', integrity(state))}

  ${section('drift', 'Drift', `How far the corpus has moved from its frozen baseline. Flagged past ${escapeHtml(num(state.drift?.thresholdPct, '25'))}%.`, drift(state))}

  <div class="grid">
    <div class="plate">${section('corpus', 'Corpus', 'What was measured, per locale. Locales are never averaged together.', corpus(state))}</div>
    <div class="plate">${section('sources', 'Sources', 'Registered material and what has been analysed.', sources(state))}</div>
  </div>

  ${section('settings', 'Settings', 'The numbers that govern promotion, staleness, and flagging.', settings(state))}

  <footer class="colophon">
    <span>Generated by /voice-and-tone:status from ${escapeHtml(kb.root ?? 'the knowledge base')}</span>
    <span>Measured ${escapeHtml(String(state.generated ?? ''))}</span>
    <span>Built on Mailchimp's Voice and Tone framework (CC BY-NC 4.0). Not affiliated with or endorsed by Mailchimp.</span>
  </footer>
</div>
`
}

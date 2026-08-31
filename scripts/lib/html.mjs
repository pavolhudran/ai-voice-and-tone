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

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

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
        <h2 class="section__title">${escapeHtml(title)}</h2>
        ${lede ? `<p class="section__lede">${escapeHtml(lede)}</p>` : ''}
      </header>
      ${body}
    </section>`
}

// ------------------------------------------------------------------- masthead

function masthead (state) {
  const kb = state.kb ?? {}
  const locales = (kb.locales ?? []).map((l) => escapeHtml(l)).join(' &middot; ')
  const facts = [
    ['profile', kb.profile ?? 'default'],
    ['kb version', kb.version ?? '-'],
    ['locales', locales || '-'],
    ['card', `${num(state.cardTokens, '0')} tokens`],
    ['measured', String(state.generated ?? '').slice(0, 10) || '-']
  ]
  return `<header class="masthead">
      <p class="masthead__eyebrow">Voice &amp; tone &mdash; knowledge base state</p>
      <h1 class="masthead__brand">${escapeHtml(kb.brand ?? 'Unnamed')}</h1>
      <dl class="masthead__facts">
        ${facts.map(([k, v]) => `<div class="fact"><dt>${escapeHtml(k)}</dt><dd>${v === locales ? v : escapeHtml(v)}</dd></div>`).join('\n        ')}
      </dl>
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
function confidence (rules) {
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
  return `<ul class="confs">\n        ${rows}\n      </ul>`
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
      <p class="note">Locale packs: ${packs.length ? escapeHtml(packs.join(', ')) : 'none authored'}. Extractors: ${vendor ? `<ul class="inline">${vendor}</ul>` : 'none'}</p>`
}

// -------------------------------------------------------------------- styles

/**
 * The palette is the project's own, taken from docs/presentation/index.html so
 * this page reads as part of the same plugin rather than as a stranger: warm
 * ink, cream, the teal accent, Fraunces/Archivo/IBM Plex Mono.
 *
 * Two things a deck does not need and a data page does are added here. The
 * first is a reserved status set (good / caution / warn) kept separate from
 * the accent, so severity never has to borrow the brand colour. The second is
 * `--ghost`, a non-photo blue: the colour a print shop marks a sheet up in
 * because it does not reproduce, used for exactly the cells that are on the
 * sheet without being real yet.
 *
 * Theming covers all three viewer states. `:root` carries the complete light
 * palette; the dark tokens are redefined once under prefers-color-scheme
 * (guarded so an explicit light choice still wins) and once under an explicit
 * dark stamp. No colour is ever declared only inside one of those blocks - a
 * token defined only behind a media query never applies in the unstamped
 * default, which is the classic unreadable-artifact bug.
 */
const STYLES = `
:root {
  --paper:      #fbf7ec;
  --card:       #ffffff;
  --mist:       #f2efe9;
  --ink:        #241c15;
  --ink-soft:   #5b5147;
  --ink-faint:  #8b8177;
  --edge:       #e4dccb;
  --edge-soft:  #efe9dc;
  --accent:     #007c89;
  --accent-ink: #005b64;
  --ghost:      #8ec6d8;
  --ghost-soft: #d5eaf1;
  --good:       #2f6f4f;
  --caution:    #9a6b12;
  --warn:       #b8341f;
  --warn-bg:    #fbeae4;

  --display: "Fraunces", "Iowan Old Style", Georgia, serif;
  --body: "Archivo", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;

  --gap: 14px;
  --r: 10px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper:      #16130f;
    --card:       #1d1913;
    --mist:       #221d16;
    --ink:        #f3ece1;
    --ink-soft:   #b8ac9b;
    --ink-faint:  #8a7f70;
    --edge:       #362e23;
    --edge-soft:  #2a241b;
    --accent:     #46bcc7;
    --accent-ink: #7fd6de;
    --ghost:      #4e8496;
    --ghost-soft: #23343a;
    --good:       #6fbe93;
    --caution:    #d9a441;
    --warn:       #e8785f;
    --warn-bg:    #3a201a;
  }
}
:root[data-theme="dark"] {
  --paper:      #16130f;
  --card:       #1d1913;
  --mist:       #221d16;
  --ink:        #f3ece1;
  --ink-soft:   #b8ac9b;
  --ink-faint:  #8a7f70;
  --edge:       #362e23;
  --edge-soft:  #2a241b;
  --accent:     #46bcc7;
  --accent-ink: #7fd6de;
  --ghost:      #4e8496;
  --ghost-soft: #23343a;
  --good:       #6fbe93;
  --caution:    #d9a441;
  --warn:       #e8785f;
  --warn-bg:    #3a201a;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--body);
  font-size: 15px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1120px; margin: 0 auto; padding: 40px 24px 80px; }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
code, .n, .mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }

/* masthead */
.masthead { border-bottom: 2px solid var(--ink); padding-bottom: 18px; margin-bottom: 28px; }
.masthead__eyebrow {
  font-family: var(--mono); font-size: 11px; letter-spacing: .14em;
  text-transform: uppercase; color: var(--ink-faint); margin: 0 0 6px;
}
.masthead__brand {
  font-family: var(--display); font-weight: 600; font-size: clamp(2rem, 1.4rem + 2.4vw, 3.2rem);
  line-height: 1.05; margin: 0 0 14px; text-wrap: balance;
}
.masthead__facts { display: flex; flex-wrap: wrap; gap: 6px 28px; margin: 0; }
.fact { display: flex; gap: 8px; align-items: baseline; }
.fact dt {
  font-family: var(--mono); font-size: 11px; letter-spacing: .1em;
  text-transform: uppercase; color: var(--ink-faint);
}
.fact dd { margin: 0; font-family: var(--mono); font-size: 13px; color: var(--ink-soft); }

/* sections */
.section { margin-top: 40px; }
.section__head { margin-bottom: 14px; }
.section__title {
  font-family: var(--display); font-weight: 600; font-size: 1.5rem;
  margin: 0; letter-spacing: -.01em;
}
.section__lede { margin: 4px 0 0; color: var(--ink-soft); max-width: 68ch; }
.grid { display: grid; gap: 24px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
.panel {
  background: var(--card); border: 1px solid var(--edge); border-radius: var(--r); padding: 18px 20px;
}
.empty { color: var(--ink-faint); font-style: italic; margin: 0; }
.note { color: var(--ink-soft); font-size: 13.5px; margin: 12px 0 0; }
.inline { display: inline; list-style: none; padding: 0; margin: 0; }
.inline li { display: inline; }
.inline li + li::before { content: " / "; color: var(--ink-faint); }

/* tiles */
.tiles { display: grid; gap: var(--gap); grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
.tile { background: var(--card); border: 1px solid var(--edge); border-radius: var(--r); padding: 14px 16px; }
.tile__label {
  font-family: var(--mono); font-size: 11px; letter-spacing: .1em; text-transform: uppercase;
  color: var(--ink-faint); margin: 0 0 4px;
}
.tile__value {
  font-family: var(--display); font-size: 2rem; font-weight: 600; line-height: 1;
  margin: 0; font-variant-numeric: tabular-nums;
}
.tile__unit { font-family: var(--mono); font-size: .8rem; font-weight: 400; color: var(--ink-faint); margin-left: 5px; }
.tile__note { margin: 6px 0 0; font-size: 12.5px; color: var(--ink-soft); }
.tile--good .tile__value { color: var(--good); }
.tile--warn .tile__value { color: var(--warn); }
.tile--caution .tile__value { color: var(--caution); }

.minitiles { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(88px, 1fr)); }
.minitile { border: 1px solid var(--edge-soft); border-radius: 8px; padding: 8px 10px; }
.minitile__n { display: block; font-family: var(--mono); font-size: 1.25rem; font-variant-numeric: tabular-nums; }
.minitile__k { display: block; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-faint); }

/* gaps */
.gaps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.gap {
  display: grid; gap: 4px 12px; align-items: baseline; padding: 12px 14px;
  grid-template-columns: 84px 44px 1fr auto;
  background: var(--card); border: 1px solid var(--edge); border-left-width: 4px; border-radius: var(--r);
}
.gap--blocker { border-left-color: var(--warn); }
.gap--warning { border-left-color: var(--caution); }
.gap--nit { border-left-color: var(--ink-faint); }
.gap__severity {
  font-family: var(--mono); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase;
}
.gap--blocker .gap__severity { color: var(--warn); }
.gap--warning .gap__severity { color: var(--caution); }
.gap--nit .gap__severity { color: var(--ink-faint); }
.gap__id { font-family: var(--mono); font-size: 12px; color: var(--ink-faint); }
.gap__body { display: flex; flex-direction: column; }
.gap__what { font-weight: 600; }
.gap__why { color: var(--ink-soft); font-size: 13.5px; }
.gap__fix {
  font-size: 12.5px; background: var(--mist); border: 1px solid var(--edge-soft);
  padding: 3px 8px; border-radius: 6px; white-space: nowrap; color: var(--accent-ink);
}

/* pipeline */
.pipeline { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.step {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  border: 1px solid var(--edge); border-radius: 999px; background: var(--card);
}
.step__ord {
  font-family: var(--mono); font-size: 11px; width: 18px; height: 18px; border-radius: 50%;
  display: grid; place-items: center; background: var(--mist); color: var(--ink-faint);
}
.step__name { font-size: 13.5px; }
.step__state { font-family: var(--mono); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-faint); }
.step.is-done { border-color: var(--accent); }
.step.is-done .step__ord { background: var(--accent); color: var(--card); }
.step.is-done .step__state { color: var(--accent-ink); }
.step.is-here { box-shadow: 0 0 0 3px var(--ghost-soft); }

/* matrix */
.matrix__scroll, .table__scroll { overflow-x: auto; }
.matrix { border-collapse: collapse; font-size: 13px; width: 100%; }
.matrix th, .matrix td { padding: 5px 6px; text-align: center; }
.matrix__corner, .matrix thead th {
  font-family: var(--mono); font-size: 10.5px; font-weight: 500; letter-spacing: .08em;
  text-transform: uppercase; color: var(--ink-faint); border-bottom: 1px solid var(--edge);
  padding-bottom: 8px;
}
.matrix thead th.is-gated { color: var(--ink-soft); border-bottom: 2px solid var(--ink-faint); }
.matrix thead th abbr { text-decoration: none; border: 0; }
.matrix__context {
  text-align: left; font-weight: 400; font-family: var(--mono); font-size: 12px;
  white-space: nowrap; padding-right: 14px; color: var(--ink-soft);
}
.row--bare .matrix__context { color: var(--ink); }
.row__flag {
  margin-left: 8px; font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase;
  color: var(--caution); border: 1px solid var(--caution); border-radius: 4px; padding: 1px 4px;
}
.mark { display: inline-block; width: 15px; height: 15px; border-radius: 3px; vertical-align: middle; }
.cell--authored .mark, .mark--authored { background: var(--ink); }
.cell--computed .mark, .mark--computed { background: var(--ghost-soft); border: 1.5px solid var(--ghost); }
.matrix__count { font-family: var(--mono); font-size: 12px; color: var(--ink-faint); white-space: nowrap; padding-left: 12px; }
.matrix__count span { color: var(--ink); }
/* The cell stays a table-cell - display:flex on a <td> takes it out of the
   table's column algorithm and the header stops lining up over it. The flex
   box is an inner wrapper instead. */
.matrix__traffic { padding-left: 10px; }
.traffic__pair { display: flex; align-items: center; gap: 8px; }
.traffic { display: block; height: 6px; width: 72px; border-radius: 3px; background: var(--mist); position: relative; }
.traffic::after {
  content: ""; position: absolute; inset: 0 auto 0 0; width: var(--w);
  background: var(--accent); border-radius: 3px; opacity: .55;
}
.traffic__n { font-family: var(--mono); font-size: 11px; color: var(--ink-faint); min-width: 34px; text-align: right; }
.matrix__legend { display: flex; flex-wrap: wrap; gap: 8px 22px; margin-top: 14px; font-size: 12.5px; color: var(--ink-soft); }
.key { display: inline-flex; align-items: center; gap: 7px; }
.key__rule { display: inline-block; width: 15px; height: 0; border-bottom: 2px solid var(--ink-faint); }

/* confidence */
.confs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.conf { display: grid; grid-template-columns: 92px 1fr 34px 130px; gap: 12px; align-items: center; }
.conf__name { font-family: var(--mono); font-size: 12.5px; }
.conf__track { height: 10px; background: var(--mist); border-radius: 5px; overflow: hidden; }
.conf__fill { display: block; height: 100%; width: var(--w); background: var(--accent); border-radius: 5px; }
.conf--derived .conf__fill { opacity: .72; }
.conf--assumed .conf__fill { opacity: .44; }
.conf--disputed .conf__fill { opacity: 1; background: repeating-linear-gradient(45deg, var(--ink-faint) 0 3px, transparent 3px 6px); }
.conf__n { font-family: var(--mono); font-variant-numeric: tabular-nums; text-align: right; }
.conf__use { font-size: 12.5px; color: var(--ink-faint); }

/* data tables */
.data { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.data th, .data td { padding: 6px 10px; text-align: left; border-bottom: 1px solid var(--edge-soft); }
.data--head thead th {
  font-family: var(--mono); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase;
  color: var(--ink-faint); font-weight: 500;
}
.data th[scope="row"] { font-weight: 400; color: var(--ink-soft); white-space: nowrap; }
.data td.n, .data .n { font-family: var(--mono); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
.data .arrow { color: var(--ink-faint); padding: 0 2px; text-align: center; }
.data .delta { color: var(--ink); }
.data .why { color: var(--ink-faint); font-size: 12.5px; }
.data tr.is-flagged .delta { color: var(--warn); font-weight: 600; }
.trackcell { width: 190px; }

/* drift + magnitude tracks */
.track { position: relative; display: block; height: 12px; width: 100%; min-width: 120px; background: var(--mist); border-radius: 6px; }
.track__axis { position: absolute; top: 0; bottom: 0; left: 50%; width: 1px; background: var(--ink-faint); opacity: .55; }
.track__tick { position: absolute; top: 2px; bottom: 2px; left: var(--x); width: 1px; background: var(--ink-faint); opacity: .3; }
.track__fill { position: absolute; top: 2px; bottom: 2px; width: var(--w); background: var(--accent); border-radius: 3px; }
.track__fill--right { left: 50%; }
.track__fill--left { right: 50%; }
.track--na { background: transparent; }
.track__na { font-family: var(--mono); font-size: 11px; color: var(--ink-faint); }
.track--mag { min-width: 90px; }
.track--mag .track__fill--mag { left: 0; background: var(--accent); opacity: .55; }
tr.is-flagged .track__fill { background: var(--warn); }

/* findings, register, notes */
.findings, .regs, .notes { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
.finding { display: grid; grid-template-columns: 64px auto 1fr auto; gap: 4px 10px; align-items: baseline; font-size: 13px; }
.finding__sev { font-family: var(--mono); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; }
.finding--error .finding__sev { color: var(--warn); }
.finding--warning .finding__sev { color: var(--caution); }
.finding__code { font-size: 11.5px; color: var(--ink-faint); }
.finding__msg { color: var(--ink-soft); }
.finding__at { font-family: var(--mono); font-size: 11.5px; color: var(--ink-faint); white-space: nowrap; }
.notes li { font-size: 13.5px; color: var(--ink-soft); }
.notes__k {
  font-family: var(--mono); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase;
  color: var(--ink-faint); margin-right: 8px;
}
.reg { display: flex; align-items: center; gap: 10px; font-size: 13.5px; }
.reg__id { font-size: 12px; color: var(--ink-faint); }
.reg__label { color: var(--ink-soft); }

.pill {
  font-family: var(--mono); font-size: 10px; letter-spacing: .08em; text-transform: uppercase;
  padding: 2px 7px; border-radius: 999px; border: 1px solid currentColor; white-space: nowrap;
}
.pill--warn { color: var(--warn); background: var(--warn-bg); }
.pill--soft { color: var(--ink-faint); }

.colophon {
  margin-top: 52px; padding-top: 18px; border-top: 1px solid var(--edge);
  font-size: 12.5px; color: var(--ink-faint); display: flex; flex-wrap: wrap; gap: 6px 20px;
}

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
@media (max-width: 640px) {
  .gap { grid-template-columns: 1fr; }
  .conf { grid-template-columns: 80px 1fr 30px; }
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

  return `<title>${escapeHtml(kb.brand ?? 'Voice')} Voice State</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Archivo:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>${STYLES}</style>
<div class="wrap">
  ${masthead(state)}

  <div class="tiles">
        ${tiles}
  </div>

  ${section('attention', 'What to do next', 'Ranked by leverage: the change that unblocks the most other work sits at the top.', attention(state.gaps))}

  ${section('pipeline', 'Pipeline', 'Which steps of discovery this knowledge base has actually been through.', pipeline(state.stage))}

  ${section('matrix', 'Tone matrix', 'Ten contexts against eight reader states. An authored cell was written and approved by a person; a computed cell is interpolated from the dial arithmetic and never carries humor.', matrix(coverage))}

  <div class="grid">
    <div class="panel">${section('rules', 'Rules by confidence', 'Confidence is not a rating of the rule. It is what happens when the rule is broken.', confidence(rules))}</div>
    <div class="panel">${section('evidence', 'Evidence', 'Every rule points back to entries here. Nothing is asserted without one.', evidence(state))}</div>
  </div>

  ${section('integrity', 'Integrity', 'Whether the compiled card still matches the files it was compiled from, and what validation found.', integrity(state))}

  ${section('drift', 'Drift', `How far the corpus has moved from its frozen baseline. Flagged past ${escapeHtml(num(state.drift?.thresholdPct, '25'))}%.`, drift(state))}

  <div class="grid">
    <div class="panel">${section('corpus', 'Corpus', 'What was measured, per locale. Locales are never averaged together.', corpus(state))}</div>
    <div class="panel">${section('sources', 'Sources', 'Registered material and what has been analysed.', sources(state))}</div>
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

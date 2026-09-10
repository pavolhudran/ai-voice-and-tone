import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeTextFile, toPosix, displayPath} from './lib/fsx.mjs'
import { activeProfile, artifactRoot } from './lib/config.mjs'
import { gatherAll } from './lib/corpus.mjs'
import { resolveKb, defaultDialsOf, DIALS, HUMOR_ZERO_STATES, CONTEXTS, STATES } from './lib/kb.mjs'
import { countHits, rankRules } from './lib/hits.mjs'
import { parseCliArgs, resolveRoots, nowIso, die, printHelp, writeOut } from './lib/cli.mjs'

const ATTRIBUTION =
  'Built on Mailchimp\'s Voice and Tone framework (CC BY-NC 4.0). ' +
  'Not affiliated with or endorsed by Mailchimp.'

// Synthetic no-data fallback (no authored **Default dials:** line, or a
// malformed one). humor is pinned to 0, not the neutral 2 the other five
// dials get - gate 1 (kb.mjs interpolate()) forces humor 0 on every
// computed cell, so a KB that has never authored a tone cell can never
// resolve a nonzero humor value. Printing "humor 2" here would contradict
// the card's own Humor gate section two headings down.
const NEUTRAL_DIALS = { ...Object.fromEntries(DIALS.map((dial) => [dial, 2])), humor: 0 }

export function estimateTokens (text) {
  return Math.ceil(String(text).length / 4)
}

function renderDials (dials) {
  return DIALS.map((dial) => `${dial} ${dials[dial] ?? 2}`).join(' · ')
}

function defaultDials (toneMd) {
  const authored = defaultDialsOf(toneMd)
  return authored ? { ...NEUTRAL_DIALS, ...authored } : NEUTRAL_DIALS
}

/**
 * A `disputed` rule is never enforced (severity.md), but CONTEXT.md is loaded
 * at step 1 of every write, long before any review runs. Compiling a disputed
 * entry into the card puts it in front of the applier as a rule to obey - and
 * rankRules would float it above a `confirmed` rule if the corpus violates it
 * more often. The invariant has to hold at draft time, not only at review
 * time, so the card never carries one.
 */
const notDisputed = (rule) => rule.confidence !== 'disputed'

export function compileContext (kb, { corpusStrings = [], generated, profileName = 'default' } = {}) {
  // A resolved knowledge base (resolveKb) or a raw one (loadKb): both carry
  // every rule on kb.rules with file and kind, so the card reads rules from
  // there rather than re-parsing table text. For the house the list is the
  // same list parseTableRules produced, in the same order - byte identity
  // holds - and for a speaker it is the merged set, overrides included.
  const speaking = kb.role === 'speaker'
  const profile = activeProfile(kb.config, profileName)
  const brand = activeProfile(kb.config, 'default')
  const tableRules = (file) => kb.rules.filter((r) => r.file === file && r.kind === 'table' && notDisputed(r))
  const voiceRules = kb.rules.filter((r) => r.file === 'voice' && r.id.startsWith('V') && notDisputed(r))
  // On a speaker card the locked house voice moves to the guardrails list.
  const shownVoice = speaking ? voiceRules.filter((r) => !r.locked) : voiceRules
  const lexicon = tableRules('lexicon')
  const mechanics = tableRules('mechanics')
  const overriddenIn = (file) => (kb.overrides ?? []).filter((r) => r.file === file).map((r) => r.id)

  const topLexicon = rankRules(lexicon, countHits(corpusStrings, lexicon)).slice(0, 8)
  const topMechanics = rankRules(mechanics, countHits(corpusStrings, mechanics)).slice(0, 6)

  const lines = []
  lines.push('<!-- GENERATED FILE - do not edit by hand. Rebuild with /voice-and-tone:sync -->')
  lines.push('')
  lines.push('# Voice & Tone - compiled card')
  lines.push('')
  lines.push(`> ${ATTRIBUTION}`)
  lines.push('')
  lines.push(
    (speaking
      ? `**Brand:** ${brand.name} · **Speaker:** ${kb.speaker.name} (${kb.speaker.slug}) · `
      : `**Brand:** ${profile.name} · **Profile:** ${profileName} · `) +
    `**Locales:** ${(profile.locales ?? []).join(', ') || profile.primary_locale} · ` +
    `**KB version:** ${kb.config.kb_version} · **Generated:** ${generated}`
  )
  lines.push('')

  lines.push('## Voice - constant')
  lines.push('')
  if (shownVoice.length === 0) {
    lines.push(speaking
      ? '_None yet. Run `/voice-and-tone:speaker add` to discover them._'
      : '_None yet. Run `/voice-and-tone:init` to discover them._')
  } else {
    for (const rule of shownVoice.slice(0, 6)) {
      lines.push(`- **${rule.name ?? rule.id}** (\`${rule.confidence}\`) - ${rule.fields.Means ?? ''}`)
      lines.push(`  - Rules out: ${rule.fields['Rules out'] ?? '(unspecified)'}`)
    }
  }
  lines.push('')

  if (speaking) {
    // Spec 2026-09-10 §5: every locked house rule, whatever file it lives
    // in, listed where a writer will see it. A prose rule shows its
    // "Rules out" line; a table row shows what to avoid and what to prefer.
    const locked = kb.rules.filter((r) => r.locked && notDisputed(r))
    lines.push('## House guardrails (locked)')
    lines.push('')
    if (locked.length === 0) lines.push('_None declared - see `locks:` in config.yml._')
    for (const rule of locked) {
      if (rule.kind === 'prose') {
        lines.push(`- **${rule.name ?? rule.id}** (\`${rule.confidence}\`) - Rules out: ${rule.fields['Rules out'] ?? rule.fields.Means ?? '(unspecified)'}`)
      } else {
        const avoid = rule.cells.Avoid ?? rule.cells.Rule ?? Object.values(rule.cells)[0] ?? ''
        lines.push(`- **${rule.id}** (\`${rule.confidence}\`) - ${avoid}${rule.cells.Prefer ? ` -> ${rule.cells.Prefer}` : ''}`)
      }
    }
    lines.push('')
  }

  lines.push('## Default dials')
  lines.push('')
  lines.push(renderDials(defaultDials(kb.tone)))
  lines.push('')

  lines.push('## Lexicon - most-violated first')
  lines.push('')
  if (topLexicon.length === 0) {
    lines.push('_None yet._')
  } else {
    lines.push('| Avoid | Prefer | Conf |')
    lines.push('|---|---|---|')
    for (const rule of topLexicon) {
      lines.push(`| ${rule.cells.Avoid ?? ''} | ${rule.cells.Prefer ?? ''} | ${rule.confidence ?? ''} |`)
    }
  }
  lines.push('')
  if (speaking && overriddenIn('lexicon').length) {
    lines.push(`Overrides: ${overriddenIn('lexicon').join(', ')} (house rule replaced)`)
    lines.push('')
  }

  lines.push('## Mechanics - most-violated first')
  lines.push('')
  if (topMechanics.length === 0) {
    lines.push('_None yet._')
  } else {
    for (const rule of topMechanics) {
      lines.push(`- ${rule.cells.Rule ?? Object.values(rule.cells)[0] ?? rule.id} (\`${rule.confidence}\`)`)
    }
  }
  lines.push('')
  if (speaking && overriddenIn('mechanics').length) {
    lines.push(`Overrides: ${overriddenIn('mechanics').join(', ')} (house rule replaced)`)
    lines.push('')
  }

  lines.push('## Humor gate')
  lines.push('')
  lines.push('Humor requires an **authored** tone cell. An interpolated cell never carries humor.')
  lines.push(`These states force \`humor 0\` whatever the dials say: ${HUMOR_ZERO_STATES.join(' · ')}.`)
  lines.push('')

  lines.push('## Where to look next')
  lines.push('')
  lines.push('| Need | Load |')
  lines.push('|---|---|')
  // Paths are knowledge-base relative, as every row here always was. On a
  // speaker card a file the overlay defines points at the overlay; one it
  // inherits points at the house.
  const overlayPrefix = speaking ? `profiles/${kb.speaker.slug}/` : ''
  const inOverlay = (dir, name) => speaking && kb.overlay?.[dir]?.[name] !== undefined
  lines.push(`| A tone cell | \`${overlayPrefix}tone.md\` - ${kb.cells.length} authored of ${CONTEXTS.length * STATES.length} |`)
  const channelNames = Object.keys(kb.channels)
  const localeNames = Object.keys(kb.locales)
  lines.push(`| A channel playbook | ${channelNames.length ? channelNames.map((n) => `\`${inOverlay('channels', n) ? overlayPrefix : ''}channels/${n}.md\``).join(', ') : '_none yet_'} |`)
  lines.push(`| A locale pack | ${localeNames.length ? localeNames.map((n) => `\`${inOverlay('locales', n) ? overlayPrefix : ''}locales/${n}.md\``).join(', ') : '_none yet_'} |`)
  lines.push(`| Who we write for | \`${speaking && kb.overlay?.audience ? overlayPrefix : ''}audience.md\` |`)
  lines.push('| Why a rule exists | `evidence/ledger.md` |')
  if (speaking) {
    lines.push('| The house card | `CONTEXT.md` |')
    lines.push('| The house voice, persona and self-reference rules | `voice.md` |')
  }
  lines.push('')

  return `${lines.join('\n')}\n`
}

function main (argv) {
  const { values } = parseCliArgs(argv, { profile: { type: 'string' } })
  if (values.help) {
    printHelp('scripts/compile-context.mjs', [
      'Regenerates <kb>/CONTEXT.md from the knowledge base. Never edit CONTEXT.md by hand.',
      '',
      '  --root <dir>      project root (default: cwd)',
      '  --kb <dir>        knowledge base dir',
      '  --profile <name>  config profile (default: default)',
      '  --now <iso>       fixed timestamp',
      '  --json            print the summary as JSON'
    ])
    return
  }

  const { projectRoot, kbRoot } = resolveRoots(values)
  const profileName = values.profile ?? 'default'
  const kb = resolveKb(kbRoot, profileName)
  const config = kb.config
  // gatherAll, not the older gatherCorpus: gatherCorpus reads config.scan
  // directly, a key the register (config.sources) has superseded everywhere
  // else in this pipeline. Using it here let CONTEXT.md - the always-loaded
  // runtime card - rank its lexicon and mechanics off a corpus the
  // fingerprint no longer measures, and see project files only, never an
  // inbox or local source's register entry. gatherAll agrees with
  // scan.mjs/fingerprint.mjs on what the corpus is: the register, with
  // `scan` read only as loadRegister's own migration fallback.
  const corpusStrings = gatherAll({ projectRoot, kbRoot, config, profileName }).files.flatMap((f) => f.strings)

  const md = compileContext(kb, { corpusStrings, generated: nowIso(values), profileName })
  // A declared speaker's card lives under its overlay; the house card, and
  // any undeclared profile name, keep writing where they always did.
  const out = values.out ? path.resolve(values.out) : path.join(artifactRoot(kbRoot, profileName, config), 'CONTEXT.md')
  writeTextFile(out, md)

  const tokens = estimateTokens(md)
  if (values.json) {
    writeOut(`${JSON.stringify({ tokens, bytes: md.length })}\n`)
    return
  }
  const lines = [`compile-context: wrote ${displayPath(projectRoot, out)} (~${tokens} tokens)`]
  if (tokens > 900) lines.push('compile-context: WARNING over the ~600 token target; trim rules or shorten Means lines')
  writeOut(`${lines.join('\n')}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)) } catch (error) { die(error.message) }
}

export { main }

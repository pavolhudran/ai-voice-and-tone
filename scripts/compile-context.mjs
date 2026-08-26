import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeTextFile, toPosix } from './lib/fsx.mjs'
import { loadConfig, activeProfile } from './lib/config.mjs'
import { gatherCorpus } from './lib/corpus.mjs'
import { loadKb, parseDials, parseTableRules, DIALS, HUMOR_ZERO_STATES, CONTEXTS, STATES } from './lib/kb.mjs'
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
  const line = /^\*\*Default dials:\*\*\s*(.+)$/m.exec(toneMd || '')
  return line ? { ...NEUTRAL_DIALS, ...parseDials(line[1]) } : NEUTRAL_DIALS
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
  const profile = activeProfile(kb.config, profileName)
  const voiceRules = kb.rules.filter((r) => r.file === 'voice' && r.id.startsWith('V') && notDisputed(r))
  const lexicon = parseTableRules(kb.lexicon || '').filter(notDisputed)
  const mechanics = parseTableRules(kb.mechanics || '').filter(notDisputed)

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
    `**Brand:** ${profile.name} · **Profile:** ${profileName} · ` +
    `**Locales:** ${(profile.locales ?? []).join(', ') || profile.primary_locale} · ` +
    `**KB version:** ${kb.config.kb_version} · **Generated:** ${generated}`
  )
  lines.push('')

  lines.push('## Voice - constant')
  lines.push('')
  if (voiceRules.length === 0) {
    lines.push('_None yet. Run `/voice-and-tone:init` to discover them._')
  } else {
    for (const rule of voiceRules.slice(0, 6)) {
      lines.push(`- **${rule.name ?? rule.id}** (\`${rule.confidence}\`) - ${rule.fields.Means ?? ''}`)
      lines.push(`  - Rules out: ${rule.fields['Rules out'] ?? '(unspecified)'}`)
    }
  }
  lines.push('')

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

  lines.push('## Humor gate')
  lines.push('')
  lines.push('Humor requires an **authored** tone cell. An interpolated cell never carries humor.')
  lines.push(`These states force \`humor 0\` whatever the dials say: ${HUMOR_ZERO_STATES.join(' · ')}.`)
  lines.push('')

  lines.push('## Where to look next')
  lines.push('')
  lines.push('| Need | Load |')
  lines.push('|---|---|')
  lines.push(`| A tone cell | \`tone.md\` - ${kb.cells.length} authored of ${CONTEXTS.length * STATES.length} |`)
  const channelNames = Object.keys(kb.channels)
  const localeNames = Object.keys(kb.locales)
  lines.push(`| A channel playbook | ${channelNames.length ? channelNames.map((n) => `\`channels/${n}.md\``).join(', ') : '_none yet_'} |`)
  lines.push(`| A locale pack | ${localeNames.length ? localeNames.map((n) => `\`locales/${n}.md\``).join(', ') : '_none yet_'} |`)
  lines.push('| Who we write for | `audience.md` |')
  lines.push('| Why a rule exists | `evidence/ledger.md` |')
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
  const kb = loadKb(kbRoot)
  const config = loadConfig(kbRoot)
  const profileName = values.profile ?? 'default'
  const corpusStrings = gatherCorpus(projectRoot, config, profileName).flatMap((f) => f.strings)

  const md = compileContext(kb, { corpusStrings, generated: nowIso(values), profileName })
  const out = values.out ? path.resolve(values.out) : path.join(kbRoot, 'CONTEXT.md')
  writeTextFile(out, md)

  const tokens = estimateTokens(md)
  if (values.json) {
    writeOut(`${JSON.stringify({ tokens, bytes: md.length })}\n`)
    return
  }
  const lines = [`compile-context: wrote ${toPosix(path.relative(projectRoot, out))} (~${tokens} tokens)`]
  if (tokens > 900) lines.push('compile-context: WARNING over the ~600 token target; trim rules or shorten Means lines')
  writeOut(`${lines.join('\n')}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)) } catch (error) { die(error.message) }
}

export { main }

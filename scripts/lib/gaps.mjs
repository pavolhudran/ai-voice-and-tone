/**
 * The gap catalogue: what is missing, ranked, with the command that closes it.
 *
 * Every detector is a pure predicate over the state object lib/state.mjs
 * produces. No filesystem access, no config reads - which is what lets
 * test/gaps.test.mjs drive all of them against hand-built states.
 *
 * Ranked by leverage before severity, the same rule the interview already
 * uses (skills/voice-discovery/references/gap-analysis.md): what unlocks the
 * most goes first, because a blocker nobody can act on yet is not the most
 * useful line on the screen.
 *
 * See the header of DETECTORS for what deliberately is NOT a gap.
 */

export const SEVERITY_RANK = { blocker: 0, warning: 1, nit: 2 }

/**
 * The rendered list is capped. The audit report's own rule applies: "An audit
 * that ends in a 300-item list ends in nothing."
 */
export const MAX_GAPS = 10

/** Words in a context's corpus below which "traffic" is not meaningful. */
const TRAFFIC_FLOOR = 500

/**
 * Detectors, in id order. Five things are deliberately absent and must stay
 * absent - test/gaps.test.mjs asserts each produces nothing:
 *
 *   1. Sources absent from this machine. They are deliberately uncommitted, so
 *      a fresh clone has none; warning would only teach people to commit them.
 *   2. Coverage below 80/80. Nobody is expected to reach it; interpolation is
 *      the design, not a shortfall.
 *   3. A computed cell. The matrix filling itself along the paths you actually
 *      write is the intended behaviour.
 *   4. Files skipped for having no extractor. Expected, and already reported
 *      by scan.
 *   5. The existence of a disputed rule as such. G10 fires because it is
 *      UNRESOLVED, never because conflict is a fault. Conflict is information.
 */
export const DETECTORS = [
  {
    id: 'G01',
    severity: 'blocker',
    leverage: 5,
    detect: (state) => state.kb.exists
      ? null
      : {
          what: 'no knowledge base',
          why: 'there is nothing to observe yet',
          fix: '/voice-and-tone:init'
        }
  },
  {
    id: 'G02',
    severity: 'blocker',
    leverage: 5,
    detect: (state) => state.integrity.errors > 0
      ? {
          what: `${state.integrity.errors} validation error(s)`,
          why: 'a card compiled from a broken knowledge base is worse than a stale one',
          fix: '/voice-and-tone:sync'
        }
      : null
  },
  {
    id: 'G03',
    severity: 'blocker',
    leverage: 4,
    detect: (state) => {
      const unbaselined = Object.entries(state.drift.byLocale)
        .filter(([, value]) => value.baseline === null)
        .map(([locale]) => locale)
      return unbaselined.length
        ? {
            what: `locale ${unbaselined.join(', ')} has no drift baseline`,
            why: 'drift can never be measured there',
            fix: 'node scripts/fingerprint.mjs --set-baseline, or finish /voice-and-tone:init'
          }
        : null
    }
  },
  {
    id: 'G04',
    severity: 'blocker',
    leverage: 4,
    detect: (state) => state.sources.unindexed > 0
      ? {
          what: `${state.sources.unindexed} registered source(s) never ingested`,
          why: 'their words are in no fingerprint and behind no rule',
          fix: '/voice-and-tone:connect --ingest'
        }
      : null
  },
  {
    id: 'G05',
    severity: 'warning',
    leverage: 4,
    // Guarded on total > 0: "every rule is assumed" over zero rules is
    // vacuously true and would fire on a bare knowledge base, where the draft
    // stage is the real story.
    detect: (state) => state.rules.total > 0 && state.rules.byConfidence.assumed === state.rules.total
      ? {
          what: 'every rule is still assumed',
          why: 'the interview has never run, so nothing is confirmed and nothing blocks',
          fix: '/voice-and-tone:init'
        }
      : null
  },
  {
    id: 'G06',
    severity: 'warning',
    leverage: 3,
    detect: (state) => {
      const hot = state.coverage.byContext.filter((c) => c.authored === 0 && c.traffic >= TRAFFIC_FLOOR)
      return hot.length
        ? {
            what: `${hot.map((c) => c.context).join(', ')}: corpus traffic, 0 authored cells`,
            why: 'every write there is interpolated, so it can never be humorous',
            fix: `/voice-and-tone:write ${hot[0].context} ...`
          }
        : null
    }
  },
  {
    id: 'G07',
    severity: 'warning',
    leverage: 3,
    detect: (state) => state.freshness.card?.staleAgainst?.length
      ? {
          what: `CONTEXT.md is behind ${state.freshness.card.staleAgainst.join(', ')}`,
          why: 'the always-loaded card does not reflect the current knowledge base',
          fix: '/voice-and-tone:sync'
        }
      : null
  },
  {
    id: 'G08',
    severity: 'warning',
    leverage: 2,
    detect: (state) => {
      if (!state.freshness.manifest) {
        return state.kb.exists
          ? { what: 'no manifest', why: 'nothing has ever been scanned', fix: '/voice-and-tone:status --refresh' }
          : null
      }
      const { changedSince, checked } = state.freshness.manifest
      return changedSince > 0
        ? {
            what: `${changedSince} of ${checked} scanned file(s) changed since the manifest`,
            why: 'the corpus numbers on this screen are behind the files on disk',
            fix: '/voice-and-tone:status --refresh'
          }
        : null
    }
  },
  {
    id: 'G09',
    severity: 'warning',
    leverage: 2,
    detect: (state) => {
      const flagged = []
      for (const [locale, value] of Object.entries(state.drift.byLocale)) {
        for (const metric of value.metrics) if (metric.flagged) flagged.push(`${locale}/${metric.label}`)
      }
      return flagged.length
        ? {
            what: `${flagged.length} metric(s) past the ${state.drift.thresholdPct}% drift threshold`,
            why: 'either the voice moved, or the corpus changed shape - the numbers cannot tell you which',
            fix: '/voice-and-tone:audit --section drift'
          }
        : null
    }
  },
  {
    id: 'G10',
    severity: 'warning',
    leverage: 2,
    detect: (state) => state.rules.byConfidence.disputed > 0
      ? {
          what: `${state.rules.byConfidence.disputed} disputed rule(s) unresolved`,
          why: 'a disputed rule is never enforced until you decide: channel split, or drift',
          fix: '/voice-and-tone:audit'
        }
      : null
  },
  {
    id: 'G11',
    severity: 'warning',
    leverage: 2,
    detect: (state) => state.sources.freshness === 'checked' && state.sources.stale > 0
      ? {
          what: `${state.sources.stale} source(s) changed since they were analysed`,
          why: 'their recorded statistics describe an older version of the document',
          fix: '/voice-and-tone:connect --ingest'
        }
      : null
  },
  {
    id: 'G12',
    severity: 'nit',
    leverage: 3,
    detect: (state) => {
      const packs = new Set(state.localePacks ?? [])
      const missing = (state.kb.locales ?? []).filter((locale) => !packs.has(locale))
      return missing.length
        ? {
            what: `locale ${missing.join(', ')} has no locale pack`,
            why: 'register and typography fall back to the primary locale',
            fix: `/voice-and-tone:localize ${missing[0]}`
          }
        : null
    }
  },
  {
    id: 'G13',
    severity: 'nit',
    leverage: 2,
    detect: (state) => state.evidence.drafts > 0
      ? {
          what: `${state.evidence.drafts} draft(s) awaiting :learn`,
          why: 'edits you made to them are not evidence until they are read',
          fix: '/voice-and-tone:learn'
        }
      : null
  },
  {
    id: 'G14',
    severity: 'nit',
    leverage: 1,
    detect: (state) => (state.integrity.byCode.W_STALE_EXTRACTOR ?? 0) > 0
      ? {
          what: `${state.integrity.byCode.W_STALE_EXTRACTOR} source(s) extracted by an unpinned library version`,
          why: 'their statistics can drift under the baseline with nothing saying why',
          fix: '/voice-and-tone:connect --ingest'
        }
      : null
  },
  {
    id: 'G15',
    severity: 'nit',
    leverage: 1,
    detect: (state) => (state.integrity.byCode.W_NO_EVIDENCE ?? 0) > 0
      ? {
          what: `${state.integrity.byCode.W_NO_EVIDENCE} rule(s) cite no evidence`,
          why: 'a rule that cannot be traced cannot be retired when its source is retracted',
          fix: null
        }
      : null
  },
  {
    id: 'G16',
    severity: 'nit',
    leverage: 1,
    detect: (state) => (state.cardTokens ?? 0) > 900
      ? {
          what: `CONTEXT.md is about ${state.cardTokens} tokens, over the 600 target`,
          why: 'the card loads on every write, so its size is paid on every draft',
          fix: null
        }
      : null
  }
]

export function detectGaps (state) {
  const found = []
  for (const detector of DETECTORS) {
    const hit = detector.detect(state)
    if (!hit) continue
    found.push({ id: detector.id, severity: detector.severity, leverage: detector.leverage, ...hit })
    // G01 means there is nothing to observe. Every other detector would then
    // report on an empty state object, producing a wall of noise whose single
    // real remedy is already on screen.
    if (detector.id === 'G01') return found
  }

  return found.sort((a, b) =>
    b.leverage - a.leverage ||
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    (a.id < b.id ? -1 : 1)
  )
}

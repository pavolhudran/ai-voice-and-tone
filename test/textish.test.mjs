import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractRtf, extractSubtitles, extractDelimited } from '../scripts/lib/textish.mjs'

test('rtf control words are dropped and text survives', () => {
  const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}}
\f0\fs24 Your campaign is scheduled.\par
Nice work.\par}`
  assert.deepEqual(extractRtf(rtf), ['Your campaign is scheduled.', 'Nice work.'])
})

test('rtf hex escapes and unicode escapes decode', () => {
  // \'e9 is e-acute in the ANSI codepage; \u283? is a unicode escape with an
  // ASCII fallback character that must be discarded, not kept.
  assert.deepEqual(extractRtf(String.raw`{\rtf1 caf\'e9\par}`), ['café'])
  assert.deepEqual(extractRtf(String.raw`{\rtf1 \u283?ivot\par}`), ['ěivot'])
})

test('rtf groups marked ignorable are skipped entirely', () => {
  const rtf = String.raw`{\rtf1{\*\generator Word}Real copy.\par}`
  assert.deepEqual(extractRtf(rtf), ['Real copy.'])
})

test('rtf cp1252 hex escapes decode to their real glyph, not a raw control character', () => {
  // Fix round 2, Important 1: RTF_CP1252_HIGH used to cover only 7 of the
  // ~25 defined codepoints in the 0x80-0x9F range; everything else fell
  // through to String.fromCharCode(code), emitting the raw C1 control byte.
  // These are exactly the coordinator's reproduction cases - an ellipsis, a
  // trademark sign, a euro sign, and a dagger, all common in brand copy.
  assert.deepEqual(extractRtf(String.raw`{\rtf1 Wait for it\'85\par}`), ['Wait for it…'])
  assert.deepEqual(extractRtf(String.raw`{\rtf1 Acme\'99\par}`), ['Acme™'])
  assert.deepEqual(extractRtf(String.raw`{\rtf1 Costs \'80 50\par}`), ['Costs € 50'])
  assert.deepEqual(extractRtf(String.raw`{\rtf1 Note\'86 here\par}`), ['Note† here'])
})

test('the five cp1252-undefined bytes in 0x80-0x9F are dropped, never emitted as a control character', () => {
  // 0x81, 0x8D, 0x8F, 0x90, 0x9D have no cp1252 glyph. Decided: drop the
  // byte entirely rather than substitute a replacement character, matching
  // this parser's existing convention of discarding rather than keeping a
  // fallback (the \u escape's ASCII fallback character is discarded the
  // same way, a few lines up).
  for (const hex of ['81', '8d', '8f', '90', '9d']) {
    assert.deepEqual(extractRtf(String.raw`{\rtf1 A\'` + hex + String.raw`B\par}`), ['AB'], `0x${hex}`)
  }
})

// Task 16 carried item: only 4 of the 27 mapped cp1252 codepoints (0x80,
// 0x86, 0x85, 0x99) had a behavioural test before this. RTF_CP1252_HIGH maps
// each \'hh escape to a fixed Unicode codepoint via a direct lookup, with no
// arithmetic connecting a byte to its glyph - so nothing about the shape of
// the map lets a test for four codepoints stand in for the other twenty-odd.
// Because stripControlChars only ever absorbs a byte the map failed to
// resolve at all (see the five-undefined-bytes test above), an entry whose
// VALUE gets quietly changed - or dropped, sending its byte through the same
// "undefined" branch as a genuinely unmapped one - produces a plausible,
// non-garbage string with one glyph swapped for another or missing outright.
// No other test in this suite would notice: the specific-codepoint tests
// above name only four bytes, and a generic "output looks like text" guard
// cannot tell a correct glyph from a wrong (or absent) one.
//
// The expected codepoints below are transcribed independently from the
// Windows-1252 standard (verified against Python's built-in cp1252 codec,
// which decodes each byte via its own table, not this file's), never
// imported from textish.mjs's RTF_CP1252_HIGH - importing it would make
// this test compare the table to itself and pass no matter what the table
// said. Codepoints are numeric, per this file's own escaping convention: a
// literal curly quote, dash, or bullet pasted into source is the exact
// authoring trap the comment above RTF_CP1252_HIGH warns about.
test('every mapped cp1252 codepoint in 0x80-0x9F decodes to its real glyph', () => {
  const table = [
    [0x80, 0x20ac], // EURO SIGN
    [0x82, 0x201a], // SINGLE LOW-9 QUOTATION MARK
    [0x83, 0x0192], // LATIN SMALL LETTER F WITH HOOK
    [0x84, 0x201e], // DOUBLE LOW-9 QUOTATION MARK
    [0x85, 0x2026], // HORIZONTAL ELLIPSIS
    [0x86, 0x2020], // DAGGER
    [0x87, 0x2021], // DOUBLE DAGGER
    [0x88, 0x02c6], // MODIFIER LETTER CIRCUMFLEX ACCENT
    [0x89, 0x2030], // PER MILLE SIGN
    [0x8a, 0x0160], // LATIN CAPITAL LETTER S WITH CARON
    [0x8b, 0x2039], // SINGLE LEFT-POINTING ANGLE QUOTATION MARK
    [0x8c, 0x0152], // LATIN CAPITAL LIGATURE OE
    [0x8e, 0x017d], // LATIN CAPITAL LETTER Z WITH CARON
    [0x91, 0x2018], // LEFT SINGLE QUOTATION MARK
    [0x92, 0x2019], // RIGHT SINGLE QUOTATION MARK
    [0x93, 0x201c], // LEFT DOUBLE QUOTATION MARK
    [0x94, 0x201d], // RIGHT DOUBLE QUOTATION MARK
    [0x95, 0x2022], // BULLET
    [0x96, 0x2013], // EN DASH
    [0x97, 0x2014], // EM DASH
    [0x98, 0x02dc], // SMALL TILDE
    [0x99, 0x2122], // TRADE MARK SIGN
    [0x9a, 0x0161], // LATIN SMALL LETTER S WITH CARON
    [0x9b, 0x203a], // SINGLE RIGHT-POINTING ANGLE QUOTATION MARK
    [0x9c, 0x0153], // LATIN SMALL LIGATURE OE
    [0x9e, 0x017e], // LATIN SMALL LETTER Z WITH CARON
    [0x9f, 0x0178] // LATIN CAPITAL LETTER Y WITH DIAERESIS
  ]
  for (const [byte, codepoint] of table) {
    const hex = byte.toString(16).padStart(2, '0')
    const expected = String.fromCodePoint(codepoint)
    assert.deepEqual(
      extractRtf(String.raw`{\rtf1 A\'` + hex + String.raw`B\par}`),
      [`A${expected}B`],
      `0x${hex} should decode to U+${codepoint.toString(16).padStart(4, '0')}`
    )
  }
})

test('vtt cues are extracted and timing lines dropped', () => {
  const vtt = [
    'WEBVTT', '', '1', '00:00:01.000 --> 00:00:04.000',
    'Welcome to the session.', '', '2', '00:00:04.500 --> 00:00:07.000',
    'We keep things short.', ''
  ].join('\n')
  assert.deepEqual(extractSubtitles(vtt), ['Welcome to the session.', 'We keep things short.'])
})

test('srt cues are extracted and a multi-line cue becomes one string', () => {
  const srt = [
    '1', '00:00:01,000 --> 00:00:04,000',
    'Welcome to the session,', 'and thanks for joining.', ''
  ].join('\n')
  assert.deepEqual(extractSubtitles(srt), ['Welcome to the session, and thanks for joining.'])
})

test('vtt cue settings and speaker tags do not leak into the text', () => {
  const vtt = [
    'WEBVTT', '', '00:00:01.000 --> 00:00:04.000 align:start position:10%',
    '<v Speaker>Hello there</v>', ''
  ].join('\n')
  assert.deepEqual(extractSubtitles(vtt), ['Hello there'])
})

test('multi-line NOTE and STYLE blocks are swallowed whole, not just their opening line', () => {
  // Fix round 2, Important 2: only the opening line was recognised, so
  // continuation lines - including a whole multi-line CSS block - fell
  // straight through into cue text.
  const vtt = [
    'WEBVTT',
    'NOTE', 'This is a comment.', 'Still part of the note.', '',
    'STYLE', '::cue {', '  color: yellow;', '}', '',
    '00:00:01.000 --> 00:00:04.000', 'Real cue text.'
  ].join('\n')
  assert.deepEqual(extractSubtitles(vtt), ['Real cue text.'])
})

test('a bare NOTE opener with no trailing space is recognised', () => {
  // startsWith('NOTE ') requires a trailing space, so the spec's primary
  // bare "NOTE" form (a comment with no same-line text) was not recognised
  // as an opener at all.
  const vtt = ['NOTE', 'a comment', '', '00:00:01.000 --> 00:00:02.000', 'Hi.'].join('\n')
  assert.deepEqual(extractSubtitles(vtt), ['Hi.'])
})

test('a NOTE block runs until a blank line even if a real cue follows with none', () => {
  // Per the WebVTT spec, a comment block's body runs until a blank line or
  // end of file - full stop, regardless of what the following lines look
  // like. There is no "this line looks like a cue timing, so end the
  // comment early" special case; a cue with no blank line separating it
  // from a preceding NOTE is, per spec, still inside that comment's body.
  const vtt = ['NOTE', 'This is a comment.', '00:00:01.000 --> 00:00:04.000', 'Real cue text.'].join('\n')
  assert.deepEqual(extractSubtitles(vtt), [])
})

test('a named (non-numeric) cue identifier is dropped, not kept as text', () => {
  // CUE_INDEX only matched a bare number, so a named identifier like
  // "intro-cue" leaked into the corpus as if it were cue text. WebVTT
  // allows any non-blank identifier line that does not contain "-->".
  const vtt = ['intro-cue', '00:00:01.000 --> 00:00:02.000', 'Hello.'].join('\n')
  assert.deepEqual(extractSubtitles(vtt), ['Hello.'])
})

test('delimited files yield cell values, not the numbers between them', () => {
  const csv = 'name,label,count\nsave,Save changes,12\ncancel,Discard and close,3\n'
  assert.deepEqual(
    extractDelimited(csv, ','),
    ['name', 'label', 'count', 'save', 'Save changes', 'cancel', 'Discard and close']
  )
})

test('quoted csv cells containing the delimiter stay whole', () => {
  const csv = 'a,b\n"Save, then close",Discard\n'
  assert.deepEqual(extractDelimited(csv, ','), ['a', 'b', 'Save, then close', 'Discard'])
})

test('tab-separated files work through the same path', () => {
  assert.deepEqual(extractDelimited('one\ttwo\n', '\t'), ['one', 'two'])
})

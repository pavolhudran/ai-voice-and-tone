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

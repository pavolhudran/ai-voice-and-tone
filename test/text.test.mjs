import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeEol, splitParagraphs, splitSentences, splitWords, countSyllablesEn
} from '../scripts/lib/text.mjs'

test('normalizeEol folds CRLF and lone CR', () => {
  assert.equal(normalizeEol('a\r\nb\rc\n'), 'a\nb\nc\n')
})

test('paragraphs split on blank lines and drop empties', () => {
  assert.deepEqual(splitParagraphs('one\nstill one\n\n\ntwo\n\n'), ['one\nstill one', 'two'])
})

test('sentences keep their terminator', () => {
  assert.deepEqual(
    splitSentences('Your campaign is scheduled. Nice work! Ready?'),
    ['Your campaign is scheduled.', 'Nice work!', 'Ready?']
  )
})

test('sentences do not split on abbreviations or initials', () => {
  assert.deepEqual(splitSentences('Ask Dr. Smith about it.'), ['Ask Dr. Smith about it.'])
  assert.deepEqual(splitSentences('Contact J. Smith today.'), ['Contact J. Smith today.'])
  assert.deepEqual(
    splitSentences('Use commas, semicolons, etc. Then stop.'),
    ['Use commas, semicolons, etc. Then stop.']
  )
})

test('sentences absorb a trailing closing quote', () => {
  assert.deepEqual(
    splitSentences('She said "go." Then she left.'),
    ['She said "go."', 'Then she left.']
  )
})

test('words are Unicode-aware and keep internal punctuation', () => {
  assert.deepEqual(splitWords("Don't over-promise, prosím."), ["Don't", 'over-promise', 'prosím'])
  assert.deepEqual(splitWords('--- *** 42'), ['42'])
})

test('English syllable counting is close enough for a reading grade', () => {
  assert.equal(countSyllablesEn('the'), 1)
  assert.equal(countSyllablesEn('campaign'), 2)
  assert.equal(countSyllablesEn('scheduled'), 3)
  assert.equal(countSyllablesEn('accessibility'), 6)
  assert.equal(countSyllablesEn(''), 0)
})

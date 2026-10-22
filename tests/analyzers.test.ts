import { expect, test } from 'vitest'
import { analyzers, selectAnalyzers, splitLanguageOption } from '../bin/analyzers.mts'

test('no --lang keeps every argument and selects all analyzers', () => {
  const { languages, rest } = splitLanguageOption(['repo', '--base', 'HEAD~1'])
  expect(languages).toBeNull()
  expect(rest).toEqual(['repo', '--base', 'HEAD~1'])
  expect(selectAnalyzers(null)).toEqual(analyzers)
})

test('--lang accepts separate and inline forms and comma lists', () => {
  expect(splitLanguageOption(['--lang', 'python', 'repo'])).toEqual({ languages: ['python'], rest: ['repo'] })
  expect(splitLanguageOption(['repo', '--lang=python'])).toEqual({ languages: ['python'], rest: ['repo'] })
  expect(splitLanguageOption(['--lang', 'Python, python'])).toEqual({ languages: ['python'], rest: [] })
})

test('--lang without a value or with an unknown language fails loudly', () => {
  expect(() => splitLanguageOption(['repo', '--lang'])).toThrow(/--lang/)
  expect(() => splitLanguageOption(['--lang='])).toThrow(/--lang/)
  expect(() => selectAnalyzers(['cobol'])).toThrow(/cobol/)
})

test('every analyzer declares a language and a command', () => {
  for (const analyzer of analyzers) {
    expect(analyzer.language).toMatch(/^[a-z]+$/)
    expect(analyzer.command).toBeTruthy()
    expect(analyzer.script).toMatch(/^scripts\//)
  }
})

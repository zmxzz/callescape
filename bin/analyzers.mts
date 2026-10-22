// Each analyzer is a program that reads a Git repository and prints a JSON
// object {repository, graph} for the arguments documented in
// skills/callescape/references/json-format.md. Language-specific call
// resolution lives entirely inside the analyzer; the CLI only merges graphs.
export interface Analyzer {
  language: string
  command: string
  script: string
}

export const analyzers: Analyzer[] = [
  { language: 'python', command: 'python3', script: 'scripts/generate_python_diff.py' },
]

export function splitLanguageOption(arguments_: string[]): { languages: string[] | null; rest: string[] } {
  const rest: string[] = []
  let value: string | null = null
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index]
    if (argument === '--lang') {
      value = arguments_[++index] ?? ''
    } else if (argument.startsWith('--lang=')) {
      value = argument.slice('--lang='.length)
    } else {
      rest.push(argument)
      continue
    }
    if (!value.trim()) throw new Error('--lang needs a comma-separated list of languages')
  }
  if (value === null) return { languages: null, rest }
  const languages = [...new Set(value.split(',').map((part) => part.trim().toLowerCase()).filter(Boolean))]
  return { languages, rest }
}

export function selectAnalyzers(languages: string[] | null): Analyzer[] {
  if (!languages) return analyzers
  return languages.map((language) => {
    const analyzer = analyzers.find((candidate) => candidate.language === language)
    if (!analyzer) {
      throw new Error(`No analyzer for ${language}. Available: ${analyzers.map((candidate) => candidate.language).join(', ')}`)
    }
    return analyzer
  })
}

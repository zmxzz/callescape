#!/usr/bin/env node

import { stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeGraphs, normalizeGraph, type Graph } from '../src/graph.ts'
import type { AnalyzeReviewMode, ReviewFilters } from '../vite.config.ts'
import { selectAnalyzers, splitLanguageOption, type Analyzer } from './analyzers.mts'

const usage = `Usage: callescape [folder]
       callescape review [repo] [--base REV] [--head REV|worktree] [--include GLOBS] [--exclude GLOBS] [--lang LANGS]

Start Callescape for graph JSON files, or review a Git diff in memory.
Review compares HEAD with the working tree by default and runs every language
analyzer unless --lang narrows it. The Python analyzer requires Python 3.9+.`

interface ReviewSession {
  graph: Graph
  initialMode: string
  initialFilters: ReviewFilters
  analyzeMode: AnalyzeReviewMode
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

async function runCommand(command: string, arguments_: string[]) {
  const child = spawn(command, arguments_, { stdio: ['ignore', 'pipe', 'pipe'] })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', resolve)
  })
  return {
    code,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
  }
}

async function runAnalyzer(analyzer: Analyzer, arguments_: string[]): Promise<{ repository: string; graph: Graph }> {
  const script = fileURLToPath(new URL(`../${analyzer.script}`, import.meta.url))
  const result = await runCommand(analyzer.command, [script, ...arguments_])
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.code !== 0) throw new Error(result.stderr.trim() || `${analyzer.language} analysis exited with status ${result.code}`)
  const payload: unknown = JSON.parse(result.stdout)
  if (typeof payload !== 'object' || payload === null || typeof (payload as Record<string, unknown>).repository !== 'string') {
    throw new Error(`${analyzer.language} analysis returned an unexpected result`)
  }
  const { repository, graph } = payload as { repository: string; graph: unknown }
  return { repository, graph: normalizeGraph(graph) }
}

async function analyze(analyzers: Analyzer[], arguments_: string[]): Promise<{ repository: string; graph: Graph }> {
  const results = await Promise.all(analyzers.map((analyzer) => runAnalyzer(analyzer, arguments_)))
  const repository = results[0].repository
  const disagreeing = results.find((result) => result.repository !== repository)
  if (disagreeing) throw new Error(`Analyzers disagree about the repository: ${repository} vs ${disagreeing.repository}`)
  return { repository, graph: mergeGraphs(results.map((result) => result.graph)) }
}

async function mainBase(repository: string): Promise<string> {
  for (const ref of ['refs/heads/main', 'refs/remotes/origin/main']) {
    const result = await runCommand('git', ['-C', repository, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    if (result.code === 0) {
      const mergeBase = await runCommand('git', ['-C', repository, 'merge-base', 'HEAD', result.stdout.trim()])
      if (mergeBase.code !== 0) throw new Error(mergeBase.stderr.trim() || 'Could not find a merge base with main')
      return mergeBase.stdout.trim()
    }
  }
  throw new Error('No main or origin/main branch found in this repository')
}

async function review(rawArguments: string[]) {
  if (rawArguments.length === 1 && ['--help', '-h'].includes(rawArguments[0])) {
    console.log(usage)
    return
  }
  const { languages, rest: arguments_ } = splitLanguageOption(rawArguments)
  const analyzers = selectAnalyzers(languages)
  const initial = await analyze(analyzers, arguments_)
  const initialMode = arguments_.some((argument) =>
    ['--base', '--head', '--include', '--exclude'].includes(argument) ||
    ['--base=', '--head=', '--include=', '--exclude='].some((option) => argument.startsWith(option))
  ) ? 'custom' : 'uncommitted'
  const initialFilters: ReviewFilters = { include: '', exclude: '' }
  for (const [index, argument] of arguments_.entries()) {
    for (const name of ['include', 'exclude'] as const) {
      if (argument === `--${name}`) initialFilters[name] = arguments_[index + 1] || ''
      if (argument.startsWith(`--${name}=`)) initialFilters[name] = argument.slice(name.length + 3)
    }
  }
  const analyzeMode: AnalyzeReviewMode = async (mode, { include = '', exclude = '' } = { include: '', exclude: '' }) => {
    const filters = ['--include', include, '--exclude', exclude]
    if (mode === 'custom' && initialMode === 'custom') return (await analyze(analyzers, [...arguments_, ...filters])).graph
    if (mode === 'uncommitted') return (await analyze(analyzers, [initial.repository, ...filters])).graph
    if (mode === 'last-commit') return (await analyze(analyzers, [initial.repository, '--base', 'HEAD~1', '--head', 'HEAD', ...filters])).graph
    if (mode === 'against-main') {
      const base = await mainBase(initial.repository)
      return (await analyze(analyzers, [initial.repository, '--base', base, ...filters])).graph
    }
    throw new Error('Unknown review comparison')
  }
  await startServer(initial.repository, { graph: initial.graph, initialMode, initialFilters, analyzeMode })
}

async function startServer(graphRoot: string, review: ReviewSession | null = null) {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const { createServer } = await import('vite')
  const { createCallscapeConfig } = await import('../vite.config.ts')
  const server = await createServer({
    root: appRoot,
    configFile: false,
    ...createCallscapeConfig({ graphRoot, reviewGraph: review?.graph, reviewMode: review?.initialMode, reviewFilters: review?.initialFilters, analyzeReviewMode: review?.analyzeMode }),
    server: { open: true },
  })
  await server.listen()

  console.log(review ? `Reviewing changes in ${graphRoot} (in memory)` : `Graph folder: ${graphRoot}`)
  server.printUrls()

  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    await server.close()
    process.exit(0)
  }
  process.on('SIGINT', close)
  process.on('SIGTERM', close)
}

async function main() {
  const arguments_ = process.argv.slice(2)

  if (arguments_[0] === 'review') {
    await review(arguments_.slice(1))
    return
  }

  if (arguments_.length === 1 && ['--help', '-h'].includes(arguments_[0])) {
    console.log(usage)
    return
  }

  if (arguments_.length > 1 || arguments_[0]?.startsWith('-')) {
    throw new Error('Expected at most one folder argument.')
  }

  const graphRoot = path.resolve(process.cwd(), arguments_[0] || '.')
  let directory
  try {
    directory = await stat(graphRoot)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new Error(`Folder does not exist: ${graphRoot}`)
    }
    throw error
  }

  if (!directory.isDirectory()) {
    throw new Error(`Not a directory: ${graphRoot}`)
  }

  await startServer(graphRoot)
}

main().catch((error: unknown) => {
  console.error(`Callescape startup error: ${error instanceof Error ? error.message : String(error)}`)
  console.error(usage)
  process.exitCode = 1
})

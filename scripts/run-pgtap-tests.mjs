import { readFile, readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const testsDirectory = resolve('supabase/tests')
const sqlFiles = (await readdir(testsDirectory))
  .filter((name) => name.endsWith('.sql'))
  .sort()

const pgTapFiles = []
for (const file of sqlFiles) {
  const testPath = resolve(testsDirectory, file)
  const source = await readFile(testPath, 'utf8')
  if (/select\s+plan\s*\(/i.test(source)) pgTapFiles.push(testPath)
}

if (pgTapFiles.length === 0) {
  throw new Error('No pgTAP test files containing select plan(...) were found.')
}

process.stdout.write(`Running ${pgTapFiles.length} pgTAP test files.\n`)

const supabaseCli = resolve('node_modules/supabase/dist/supabase.js')
const exitCode = await new Promise((resolveExitCode, reject) => {
  const child = spawn(process.execPath, [supabaseCli, 'test', 'db', ...pgTapFiles], {
    stdio: 'inherit',
    windowsHide: true,
  })
  child.once('error', reject)
  child.once('exit', (code) => resolveExitCode(code ?? 1))
})

process.exit(exitCode)

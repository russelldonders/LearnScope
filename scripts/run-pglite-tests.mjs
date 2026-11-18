import { readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const testsDirectory = resolve('supabase/tests')
const pgliteModule = resolve('node_modules/@electric-sql/pglite/dist/index.js')
const testFiles = (await readdir(testsDirectory))
  .filter((name) => name.endsWith('.mjs'))
  .sort()

for (const file of testFiles) {
  const testPath = resolve(testsDirectory, file)
  process.stdout.write(`\n[PGlite] ${file}\n`)

  const exitCode = await new Promise((resolveExitCode, reject) => {
    const child = spawn(process.execPath, [testPath, pgliteModule], {
      stdio: 'inherit',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('exit', (code) => resolveExitCode(code ?? 1))
  })

  if (exitCode !== 0) process.exit(exitCode)
}

process.stdout.write(`\n${testFiles.length} PGlite database test files passed.\n`)

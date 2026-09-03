import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
const outputName = 'stage_bootstrap_consolidated.sql'
const names = (await readdir(migrationsDir))
  .filter((name) => name.endsWith('.sql') && name !== outputName)
  .sort()

const sections = await Promise.all(names.map(async (name) => {
  const sql = (await readFile(join(migrationsDir, name), 'utf8')).trim()
  return `-- =============================================================================\n-- ${name}\n-- =============================================================================\n\n${sql}`
}))

await writeFile(join(migrationsDir, outputName), `${sections.join('\n\n\n\n')}\n`, 'utf8')

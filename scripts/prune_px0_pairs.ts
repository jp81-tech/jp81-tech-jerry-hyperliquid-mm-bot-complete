import * as hl from '@nktkas/hyperliquid'
import * as fs from 'fs'
import * as path from 'path'

const effPath = path.join(process.cwd(), 'runtime', 'effective_active_pairs.json')
const markPath = path.join(process.cwd(), 'runtime', '.px0_marks.json')

type Marks = Record<string, number>

function loadJSON<T>(p: string, def: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return def
  }
}

;(async () => {
  const transport = new hl.HttpTransport()
  const info = new hl.InfoClient({ transport })
  const meta = await info.meta()

  const caseMap: Record<string, string> = {}
  for (const u of meta.universe) {
    caseMap[u.name.toLowerCase()] = u.name
  }

  const eff = loadJSON<{ pairs: string[] }>(effPath, { pairs: [] })
  const marks = loadJSON<Marks>(markPath, {})
  const keep: string[] = []

  for (const c0 of eff.pairs || []) {
    const lower = String(c0).toLowerCase()
    const c = caseMap[lower] || String(c0).toUpperCase()
    const flagFile = path.join(process.cwd(), 'runtime', `.px0_${c}`)
    const flag = fs.existsSync(flagFile)

    if (flag) {
      marks[c] = (marks[c] || 0) + 1
      console.log(`[${c}] px0 mark ${marks[c]}/3`)
    } else {
      marks[c] = 0
    }

    if ((marks[c] || 0) < 3) {
      keep.push(c)
    } else {
      console.log(`[${c}] REMOVED after 3 consecutive px0 cycles`)
    }
  }

  for (const c in marks) {
    if (!keep.includes(c)) delete marks[c]
  }

  fs.writeFileSync(markPath, JSON.stringify(marks, null, 2))
  fs.writeFileSync(
    effPath,
    JSON.stringify(
      {
        ts: new Date().toISOString(),
        pairs: keep
      },
      null,
      2
    )
  )

  console.log('Kept pairs:', keep.join(' '))
})()


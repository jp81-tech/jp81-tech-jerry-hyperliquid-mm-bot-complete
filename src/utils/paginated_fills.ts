/**
 * Paginated fill fetcher for Hyperliquid userFillsByTime API.
 *
 * The API returns a maximum of 2000 fills per request (oldest first within the window).
 * When the limit is hit, this utility paginates forward by advancing startTime
 * past the last fill's timestamp until all fills are retrieved.
 */

const HL_INFO_URL = 'https://api.hyperliquid.xyz/info'
const PAGE_LIMIT = 2000

export interface HlFill {
  coin: string
  px: string
  sz: string
  side: 'B' | 'A'
  time: number
  startPosition: string
  dir: string
  closedPnl: string
  hash: string
  oid: number
  crossed: boolean
  fee: string
  tid: number
  cloid?: string
  liquidation?: {
    liquidatedUser: string
    markPx: string
    method: 'market' | 'backstop'
  }
  feeToken: string
  twapId: number | null
}

/**
 * Fetch ALL fills for a wallet in a time window, handling the 2000-fill API limit.
 * Paginates forward from startTime until endTime is reached or page returns < 2000 fills.
 *
 * @param user     - Wallet address (0x...)
 * @param startTime - Start of window (ms since epoch)
 * @param endTime   - End of window (ms since epoch). Defaults to Date.now()
 * @param opts.maxPages - Safety limit on number of pages (default: 10 = max 20K fills)
 */
export async function fetchAllFillsByTime(
  user: string,
  startTime: number,
  endTime?: number,
  opts?: { maxPages?: number }
): Promise<HlFill[]> {
  const resolvedEnd = endTime ?? Date.now()
  const maxPages = opts?.maxPages ?? 10
  const allFills: HlFill[] = []
  const seenTids = new Set<number>()

  let currentStart = startTime
  let page = 0

  while (page < maxPages) {
    page++

    const response = await fetch(HL_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'userFillsByTime',
        user,
        startTime: currentStart,
        endTime: resolvedEnd,
      }),
    })

    if (!response.ok) {
      console.warn(`[FILLS] HTTP ${response.status} fetching fills page ${page}`)
      break
    }

    const fills = (await response.json()) as HlFill[]

    if (!fills || fills.length === 0) break

    // Deduplicate by tid
    let added = 0
    for (const fill of fills) {
      if (!seenTids.has(fill.tid)) {
        seenTids.add(fill.tid)
        allFills.push(fill)
        added++
      }
    }

    // If we got fewer than the limit, we have all fills in this window
    if (fills.length < PAGE_LIMIT) break

    // Paginate forward: advance startTime past the newest fill in this batch
    const lastTime = fills[fills.length - 1].time
    currentStart = lastTime + 1

    // Safety: if startTime exceeded endTime, stop
    if (currentStart >= resolvedEnd) break
  }

  // Sort ascending by time
  allFills.sort((a, b) => a.time - b.time)

  if (page > 1) {
    console.log(`[FILLS] Fetched ${allFills.length} fills in ${page} pages for ${user.slice(0, 8)}...`)
  }

  return allFills
}

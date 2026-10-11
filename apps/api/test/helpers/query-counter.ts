import pg from 'pg'

export interface QueryCounter {
  getCount: () => number
  reset: () => void
  restore: () => void
}

export function createQueryCounter(): QueryCounter {
  let count = 0
  const originalClientQuery = pg.Client.prototype.query

  /* eslint-disable @typescript-eslint/no-explicit-any */
  pg.Client.prototype.query = function (this: any, ...args: any[]) {
    count++
    return (originalClientQuery as any).apply(this, args)
  } as any
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return {
    getCount: () => count,
    reset: () => {
      count = 0
    },
    restore: () => {
      pg.Client.prototype.query = originalClientQuery
    },
  }
}

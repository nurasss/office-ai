export interface Clock {
  now(): Date
}

export function truncateToMillis(d: Date): Date {
  return new Date(Math.floor(d.getTime()))
}

export const systemClock: Clock = {
  now(): Date {
    return truncateToMillis(new Date())
  },
}

export function createFixedClock(start: Date): Clock & { advance(ms: number): void } {
  let currentTime = truncateToMillis(start)
  return {
    now(): Date {
      return new Date(currentTime.getTime())
    },
    advance(ms: number): void {
      currentTime = new Date(currentTime.getTime() + ms)
    },
  }
}

import { uuidv7 } from 'uuidv7'

export interface IdGenerator {
  next(): string
}

export const realIdGenerator: IdGenerator = {
  next(): string {
    return uuidv7()
  },
}

export function createFixedIdGenerator(ids: string[]): IdGenerator {
  if (ids.length === 0) {
    throw new Error('createFixedIdGenerator: ids array must not be empty')
  }
  let index = 0
  return {
    next(): string {
      const id = ids[index % ids.length]!
      index += 1
      return id
    },
  }
}

import http from 'node:http'
import type { AddressInfo } from 'node:net'

export interface RecordedRequest {
  method: string
  url: string
  headers: http.IncomingHttpHeaders
  rawBody: string
  body: Record<string, unknown> | null
}

export type MockHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  recorded: RecordedRequest,
) => void | Promise<void>

export interface MockServer {
  baseUrl: string
  port: number
  server: http.Server
  setHandler: (handler: MockHandler) => void
  getRequestCount: () => number
  resetRequests: () => void
  getLastRequest: () => RecordedRequest | null
  getRequests: () => RecordedRequest[]
  close: () => Promise<void>
}

export async function createMockServer(initialHandler?: MockHandler): Promise<MockServer> {
  const requests: RecordedRequest[] = []
  let currentHandler: MockHandler =
    initialHandler ||
    ((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'msg_default',
          type: 'message',
          role: 'assistant',
          model: 'claude-3-5-haiku-20241022',
          content: [{ type: 'text', text: 'Hello from mock server' }],
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 10,
            output_tokens: 5,
          },
        }),
      )
    })

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', async () => {
      const rawBody = Buffer.concat(chunks).toString('utf-8')
      let body: Record<string, unknown> | null = null
      try {
        body = JSON.parse(rawBody)
      } catch {
        body = null
      }

      const recorded: RecordedRequest = {
        method: req.method || 'GET',
        url: req.url || '/',
        headers: req.headers,
        rawBody,
        body,
      }
      requests.push(recorded)

      try {
        await currentHandler(req, res, recorded)
      } catch (err: unknown) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            type: 'error',
            error: { type: 'server_error', message: (err as Error).message },
          }),
        )
      }
    })
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address() as AddressInfo
  const port = address.port
  const baseUrl = `http://127.0.0.1:${port}`

  return {
    baseUrl,
    port,
    server,
    setHandler: (handler: MockHandler) => {
      currentHandler = handler
    },
    getRequestCount: () => requests.length,
    resetRequests: () => {
      requests.length = 0
    },
    getLastRequest: () => (requests.length > 0 ? requests[requests.length - 1]! : null),
    getRequests: () => [...requests],
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}

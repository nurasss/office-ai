import type { FastifyPluginAsync } from 'fastify'
import { z } from '@ai-company/shared'
import type { AppDeps } from '../deps.js'
import { AuthService } from '../services/auth-service.js'

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10).max(200),
  name: z.string().trim().min(1).max(100),
  organizationName: z.string().trim().min(1).max(100),
})

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
})

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
})

const logoutSchema = z.object({
  refreshToken: z.string().min(1),
})

export interface AuthRoutesOptions {
  deps: AppDeps
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (fastify, opts) => {
  const { deps } = opts
  const authService = new AuthService(deps)

  fastify.post(
    '/v1/auth/register',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: 60 * 1000,
        },
      },
    },
    async (req, reply) => {
      const parsed = registerSchema.parse(req.body)
      const meta = {
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      }

      const result = await authService.register(parsed, meta)
      return reply.status(201).send(result)
    },
  )

  fastify.post(
    '/v1/auth/login',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: 60 * 1000,
        },
      },
    },
    async (req, reply) => {
      const parsed = loginSchema.parse(req.body)
      const meta = {
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      }

      const result = await authService.login(parsed, meta)
      return reply.status(200).send(result)
    },
  )

  fastify.post(
    '/v1/auth/refresh',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: 60 * 1000,
        },
      },
    },
    async (req, reply) => {
      const parsed = refreshSchema.parse(req.body)
      const meta = {
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      }

      const result = await authService.refresh(parsed.refreshToken, meta)
      return reply.status(200).send(result)
    },
  )

  fastify.post('/v1/auth/logout', async (req, reply) => {
    const parsed = logoutSchema.parse(req.body)
    await authService.logout(parsed.refreshToken)
    return reply.status(200).send({ success: true })
  })

  fastify.post(
    '/v1/auth/logout-all',
    { preHandler: [fastify.requireAuth] },
    async (req, reply) => {
      await authService.logoutAll(req.ctx!.userId)
      return reply.status(200).send({ success: true })
    },
  )
}

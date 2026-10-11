import type { FastifyPluginAsync } from 'fastify'
import { z, assertRole, paginationQuerySchema } from '@ai-company/shared'
import type { AppDeps } from '../deps.js'
import { AgentService } from '../services/agent-service.js'

const createAgentBodySchema = z.object({
  companyId: z.string().uuid(),
  departmentId: z.string().uuid().nullable().optional(),
  managerId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(255),
  role: z.string().min(1).max(255),
  title: z.string().min(1).max(255),
  systemPrompt: z.string().min(1),
  systemPromptVersion: z.number().int().min(1).optional(),
  maxAutonomyLevel: z.number().int().min(0).max(3).optional(),
  monthlyBudgetUsd: z.string().optional(),
  status: z.enum(['draft', 'active', 'paused', 'retired']).optional(),
  avatarUrl: z.string().url().nullable().optional(),
})

const updateAgentBodySchema = z.object({
  departmentId: z.string().uuid().nullable().optional(),
  managerId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(255).optional(),
  role: z.string().min(1).max(255).optional(),
  title: z.string().min(1).max(255).optional(),
  systemPrompt: z.string().min(1).optional(),
  systemPromptVersion: z.number().int().min(1).optional(),
  maxAutonomyLevel: z.number().int().min(0).max(3).optional(),
  monthlyBudgetUsd: z.string().optional(),
  status: z.enum(['draft', 'active', 'paused', 'retired']).optional(),
  avatarUrl: z.string().url().nullable().optional(),
})

const listAgentsQuerySchema = z.object({
  companyId: z.string().uuid().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  status: z.enum(['draft', 'active', 'paused', 'retired']).optional(),
  managerId: z.string().uuid().nullable().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

const agentParamsSchema = z.object({
  id: z.string().uuid(),
})

const setModelsBodySchema = z.object({
  models: z.array(
    z.object({
      modelKey: z.string().min(1),
      role: z.enum(['preferred', 'fallback']),
      priority: z.number().int().min(0).optional(),
      temperature: z.string().nullable().optional(),
      maxOutputTokens: z.number().int().positive().nullable().optional(),
    }),
  ),
})

const setToolsBodySchema = z.object({
  tools: z.array(
    z.object({
      toolKey: z.string().min(1),
      scopes: z.array(z.string()).optional(),
      enabled: z.boolean().optional(),
    }),
  ),
})

const setSkillsBodySchema = z.object({
  skills: z.array(
    z.object({
      skillKey: z.string().min(1),
      level: z.enum(['basic', 'proficient', 'expert']).optional(),
    }),
  ),
})

export interface AgentsRouteOptions {
  deps: AppDeps
}

export const agentsRoute: FastifyPluginAsync<AgentsRouteOptions> = async (fastify, opts) => {
  const { deps } = opts
  const agentService = new AgentService(deps)

  fastify.post('/v1/agents', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    assertRole(req.ctx!, ['owner', 'admin', 'member'])
    const body = createAgentBodySchema.parse(req.body)
    const agent = await agentService.create(req.ctx!, {
      companyId: body.companyId,
      departmentId: body.departmentId,
      managerId: body.managerId,
      name: body.name,
      role: body.role,
      title: body.title,
      systemPrompt: body.systemPrompt,
      systemPromptVersion: body.systemPromptVersion,
      maxAutonomyLevel: body.maxAutonomyLevel,
      monthlyBudgetUsd: body.monthlyBudgetUsd,
      status: body.status,
      avatarUrl: body.avatarUrl,
    })
    return reply.status(201).send(agent)
  })

  fastify.get('/v1/agents', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    const query = listAgentsQuerySchema.parse(req.query)
    const pagination = paginationQuerySchema.parse({
      cursor: query.cursor,
      limit: query.limit,
    })
    const page = await agentService.list(
      req.ctx!,
      {
        companyId: query.companyId,
        departmentId: query.departmentId,
        status: query.status,
        managerId: query.managerId,
      },
      pagination,
    )
    return reply.status(200).send(page)
  })

  fastify.get('/v1/agents/:id', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    const params = agentParamsSchema.parse(req.params)
    const agent = await agentService.get(req.ctx!, params.id)
    return reply.status(200).send(agent)
  })

  fastify.patch('/v1/agents/:id', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    assertRole(req.ctx!, ['owner', 'admin', 'member'])
    const params = agentParamsSchema.parse(req.params)
    const body = updateAgentBodySchema.parse(req.body)
    const updated = await agentService.update(req.ctx!, params.id, {
      departmentId: body.departmentId,
      managerId: body.managerId,
      name: body.name,
      role: body.role,
      title: body.title,
      systemPrompt: body.systemPrompt,
      systemPromptVersion: body.systemPromptVersion,
      maxAutonomyLevel: body.maxAutonomyLevel,
      monthlyBudgetUsd: body.monthlyBudgetUsd,
      status: body.status,
      avatarUrl: body.avatarUrl,
    })
    return reply.status(200).send(updated)
  })

  fastify.put(
    '/v1/agents/:id/models',
    { preHandler: [fastify.requireAuth] },
    async (req, reply) => {
      assertRole(req.ctx!, ['owner', 'admin', 'member'])
      const params = agentParamsSchema.parse(req.params)
      const body = setModelsBodySchema.parse(req.body)
      const updated = await agentService.setModels(req.ctx!, params.id, body.models)
      return reply.status(200).send(updated)
    },
  )

  fastify.put('/v1/agents/:id/tools', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    assertRole(req.ctx!, ['owner', 'admin', 'member'])
    const params = agentParamsSchema.parse(req.params)
    const body = setToolsBodySchema.parse(req.body)
    const updated = await agentService.setTools(req.ctx!, params.id, body.tools)
    return reply.status(200).send(updated)
  })

  fastify.put(
    '/v1/agents/:id/skills',
    { preHandler: [fastify.requireAuth] },
    async (req, reply) => {
      assertRole(req.ctx!, ['owner', 'admin', 'member'])
      const params = agentParamsSchema.parse(req.params)
      const body = setSkillsBodySchema.parse(req.body)
      const updated = await agentService.setSkills(req.ctx!, params.id, body.skills)
      return reply.status(200).send(updated)
    },
  )

  fastify.post(
    '/v1/agents/:id/pause',
    { preHandler: [fastify.requireAuth] },
    async (req, reply) => {
      assertRole(req.ctx!, ['owner', 'admin', 'member'])
      const params = agentParamsSchema.parse(req.params)
      const updated = await agentService.pause(req.ctx!, params.id)
      return reply.status(200).send(updated)
    },
  )

  fastify.post(
    '/v1/agents/:id/activate',
    { preHandler: [fastify.requireAuth] },
    async (req, reply) => {
      assertRole(req.ctx!, ['owner', 'admin', 'member'])
      const params = agentParamsSchema.parse(req.params)
      const updated = await agentService.activate(req.ctx!, params.id)
      return reply.status(200).send(updated)
    },
  )

  fastify.post(
    '/v1/agents/:id/retire',
    { preHandler: [fastify.requireAuth] },
    async (req, reply) => {
      assertRole(req.ctx!, ['owner', 'admin'])
      const params = agentParamsSchema.parse(req.params)
      const updated = await agentService.retire(req.ctx!, params.id)
      return reply.status(200).send(updated)
    },
  )
}

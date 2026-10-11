import type { FastifyPluginAsync } from 'fastify'
import { z, assertRole, paginationQuerySchema } from '@ai-company/shared'
import type { AppDeps } from '../deps.js'
import { CompanyService } from '../services/company-service.js'

const createCompanyBodySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  mission: z.string().nullable().optional(),
  mode: z.enum(['assistant', 'copilot', 'autonomous']).optional(),
  monthlyBudgetUsd: z.string().optional(),
  settings: z.record(z.unknown()).optional(),
})

const updateCompanyBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  mission: z.string().nullable().optional(),
  mode: z.enum(['assistant', 'copilot', 'autonomous']).optional(),
  monthlyBudgetUsd: z.string().optional(),
  settings: z.record(z.unknown()).optional(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
})

const listCompaniesQuerySchema = z.object({
  status: z.enum(['active', 'paused', 'archived']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

const companyParamsSchema = z.object({
  id: z.string().uuid(),
})

export interface CompaniesRouteOptions {
  deps: AppDeps
}

export const companiesRoute: FastifyPluginAsync<CompaniesRouteOptions> = async (
  fastify,
  opts,
) => {
  const { deps } = opts
  const companyService = new CompanyService(deps)

  fastify.post('/v1/companies', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    assertRole(req.ctx!, ['owner', 'admin', 'member'])
    const body = createCompanyBodySchema.parse(req.body)
    const company = await companyService.create(req.ctx!, {
      name: body.name,
      description: body.description,
      mission: body.mission,
      mode: body.mode,
      monthlyBudgetUsd: body.monthlyBudgetUsd,
      settings: body.settings,
    })
    return reply.status(201).send(company)
  })

  fastify.get('/v1/companies', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    const query = listCompaniesQuerySchema.parse(req.query)
    const pagination = paginationQuerySchema.parse({
      cursor: query.cursor,
      limit: query.limit,
    })
    const page = await companyService.list(
      req.ctx!,
      query.status !== undefined ? { status: query.status } : undefined,
      pagination,
    )
    return reply.status(200).send(page)
  })

  fastify.get('/v1/companies/:id', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    const params = companyParamsSchema.parse(req.params)
    const company = await companyService.get(req.ctx!, params.id)
    return reply.status(200).send(company)
  })

  fastify.patch('/v1/companies/:id', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    assertRole(req.ctx!, ['owner', 'admin', 'member'])
    const params = companyParamsSchema.parse(req.params)
    const body = updateCompanyBodySchema.parse(req.body)
    const updated = await companyService.update(req.ctx!, params.id, {
      name: body.name,
      description: body.description,
      mission: body.mission,
      mode: body.mode,
      monthlyBudgetUsd: body.monthlyBudgetUsd,
      settings: body.settings,
      status: body.status,
    })
    return reply.status(200).send(updated)
  })

  fastify.post(
    '/v1/companies/:id/archive',
    { preHandler: [fastify.requireAuth] },
    async (req, reply) => {
      assertRole(req.ctx!, ['owner', 'admin'])
      const params = companyParamsSchema.parse(req.params)
      const archived = await companyService.archive(req.ctx!, params.id)
      return reply.status(200).send(archived)
    },
  )

  fastify.get(
    '/v1/companies/:id/org-chart',
    { preHandler: [fastify.requireAuth] },
    async (req, reply) => {
      const params = companyParamsSchema.parse(req.params)
      const chart = await companyService.getOrgChart(req.ctx!, params.id)
      return reply.status(200).send(chart)
    },
  )
}

import type { FastifyPluginAsync } from 'fastify'
import { z, assertRole, paginationQuerySchema } from '@ai-company/shared'
import type { AppDeps } from '../deps.js'
import { DepartmentService } from '../services/department-service.js'

const createDepartmentBodySchema = z.object({
  companyId: z.string().uuid(),
  parentDepartmentId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(64),
  monthlyBudgetUsd: z.string().nullable().optional(),
})

const updateDepartmentBodySchema = z.object({
  parentDepartmentId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(255).optional(),
  code: z.string().min(1).max(64).optional(),
  monthlyBudgetUsd: z.string().nullable().optional(),
})

const listDepartmentsQuerySchema = z.object({
  companyId: z.string().uuid().optional(),
  parentId: z.string().uuid().nullable().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

const departmentParamsSchema = z.object({
  id: z.string().uuid(),
})

export interface DepartmentsRouteOptions {
  deps: AppDeps
}

export const departmentsRoute: FastifyPluginAsync<DepartmentsRouteOptions> = async (
  fastify,
  opts,
) => {
  const { deps } = opts
  const departmentService = new DepartmentService(deps)

  fastify.post('/v1/departments', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    assertRole(req.ctx!, ['owner', 'admin', 'member'])
    const body = createDepartmentBodySchema.parse(req.body)
    const dept = await departmentService.create(req.ctx!, {
      companyId: body.companyId,
      parentDepartmentId: body.parentDepartmentId,
      name: body.name,
      code: body.code,
      monthlyBudgetUsd: body.monthlyBudgetUsd,
    })
    return reply.status(201).send(dept)
  })

  fastify.get('/v1/departments', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    const query = listDepartmentsQuerySchema.parse(req.query)
    const pagination = paginationQuerySchema.parse({
      cursor: query.cursor,
      limit: query.limit,
    })
    const page = await departmentService.list(
      req.ctx!,
      {
        companyId: query.companyId,
        parentDepartmentId: query.parentId,
      },
      pagination,
    )
    return reply.status(200).send(page)
  })

  fastify.get('/v1/departments/:id', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    const params = departmentParamsSchema.parse(req.params)
    const dept = await departmentService.get(req.ctx!, params.id)
    return reply.status(200).send(dept)
  })

  fastify.patch('/v1/departments/:id', { preHandler: [fastify.requireAuth] }, async (req, reply) => {
    assertRole(req.ctx!, ['owner', 'admin', 'member'])
    const params = departmentParamsSchema.parse(req.params)
    const body = updateDepartmentBodySchema.parse(req.body)
    const updated = await departmentService.update(req.ctx!, params.id, {
      parentDepartmentId: body.parentDepartmentId,
      name: body.name,
      code: body.code,
      monthlyBudgetUsd: body.monthlyBudgetUsd,
    })
    return reply.status(200).send(updated)
  })

  fastify.delete(
    '/v1/departments/:id',
    { preHandler: [fastify.requireAuth] },
    async (req, reply) => {
      assertRole(req.ctx!, ['owner', 'admin', 'member'])
      const params = departmentParamsSchema.parse(req.params)
      await departmentService.remove(req.ctx!, params.id)
      return reply.status(200).send({ success: true })
    },
  )
}

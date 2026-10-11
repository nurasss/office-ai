import type { FastifyPluginAsync, preHandlerHookHandler } from 'fastify'
import fp from 'fastify-plugin'
import {
  AppError,
  ERROR_CODES,
  unauthorized,
  forbidden,
  type OrgRole,
  type RequestContext,
} from '@ai-company/shared'
import type { AppDeps } from '../deps.js'
import { TokenService } from '../services/token-service.js'

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: preHandlerHookHandler
  }
}

export interface AuthPluginOptions {
  deps: AppDeps
}

const authPluginCallback: FastifyPluginAsync<AuthPluginOptions> = async (fastify, opts) => {
  const { deps } = opts
  const tokenService = new TokenService(deps)

  const requireAuth: preHandlerHookHandler = async (req) => {
    const authHeader = req.headers['authorization']
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      throw unauthorized(ERROR_CODES.UNAUTHORIZED)
    }

    const token = authHeader.slice(7).trim()
    if (!token) {
      throw unauthorized(ERROR_CODES.UNAUTHORIZED)
    }

    // 1. Verify access token signature and expiration
    const { sub: userId } = await tokenService.verifyAccessToken(token)

    // 2. Load user and check active status
    const user = await deps.repos.auth.findUserById(userId)
    if (!user || user.status !== 'active') {
      throw unauthorized(ERROR_CODES.UNAUTHORIZED)
    }

    // 3. Resolve organization membership from DB
    const userOrgs = await deps.repos.auth.listUserOrganizations(user.id)
    const rawHeaderOrgId = req.headers['x-org-id']
    const requestedOrgId = typeof rawHeaderOrgId === 'string' ? rawHeaderOrgId.trim() : undefined

    let selectedOrg: (typeof userOrgs)[number] | undefined

    if (requestedOrgId) {
      selectedOrg = userOrgs.find((o) => o.id === requestedOrgId)
      if (!selectedOrg) {
        throw forbidden('You are not a member of the requested organization')
      }
    } else {
      if (userOrgs.length === 1) {
        selectedOrg = userOrgs[0]
      } else {
        throw new AppError({
          code: ERROR_CODES.ORG_NOT_SELECTED,
          httpStatus: 400,
          message: 'Organization not selected. Specify X-Org-Id header.',
        })
      }
    }

    if (!selectedOrg) {
      throw new AppError({
        code: ERROR_CODES.ORG_NOT_SELECTED,
        httpStatus: 400,
        message: 'Organization not selected. Specify X-Org-Id header.',
      })
    }

    // 4. Populate RequestContext
    const ctx: RequestContext = {
      requestId: req.requestId,
      orgId: selectedOrg.id,
      userId: user.id,
      role: selectedOrg.memberRole as OrgRole,
      clock: deps.clock,
      ids: deps.ids,
      logger: deps.logger.child({
        requestId: req.requestId,
        orgId: selectedOrg.id,
        userId: user.id,
      }),
    }

    req.ctx = ctx
  }

  fastify.decorate('requireAuth', requireAuth)
}

export const authPlugin = fp(authPluginCallback, {
  name: 'auth-plugin',
})

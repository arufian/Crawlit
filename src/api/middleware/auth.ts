import type { FastifyRequest, FastifyReply } from 'fastify'
import { config } from '../../lib/config.js'

export async function authMiddleware(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  // If no API keys configured, allow all (open mode)
  if (config.API_KEYS.length === 0) return

  const authHeader = req.headers.authorization ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  if (!token || !config.API_KEYS.includes(token)) {
    await reply.status(401).send({ success: false, error: 'Unauthorized' })
  }
}

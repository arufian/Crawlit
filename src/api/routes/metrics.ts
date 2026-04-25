import type { FastifyInstance } from 'fastify'
import { registry } from '../../lib/metrics.js'

export async function metricsRoute(app: FastifyInstance): Promise<void> {
  app.get('/metrics', async (_req, reply) => {
    const output = await registry.metrics()
    return reply
      .header('Content-Type', registry.contentType)
      .send(output)
  })
}

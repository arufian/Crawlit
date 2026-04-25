import type { FastifyInstance } from 'fastify'

export async function healthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok', version: '1.0.0' }))
}

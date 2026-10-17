import type { FastifyInstance } from 'fastify'
import { searchStatus } from '../../core/search/web-search.js'

export async function healthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok', version: '1.1.0', search: searchStatus() }))
}

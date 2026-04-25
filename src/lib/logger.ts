import pino from 'pino'
import { config } from './config.js'

export const logger = process.env.NODE_ENV !== 'production'
  ? pino({
      level: config.LOG_LEVEL,
      transport: { target: 'pino-pretty', options: { colorize: true } },
    })
  : pino({ level: config.LOG_LEVEL })

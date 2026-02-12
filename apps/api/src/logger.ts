// ============================================================
// OrgsLedger API — Logger (Winston)
// ============================================================

import winston from 'winston';
import { config } from './config';

export const logger = winston.createLogger({
  level: config.env === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    config.env === 'production'
      ? winston.format.json()
      : winston.format.combine(winston.format.colorize(), winston.format.simple())
  ),
  defaultMeta: { service: 'orgsledger-api' },
  transports: [
    new winston.transports.Console(),
  ],
});

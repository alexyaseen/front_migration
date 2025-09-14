import * as dotenv from 'dotenv';
import { LogLevel } from './utils/logger_ascii';

dotenv.config();

export interface Config {
  front: {
    apiKey: string;
    baseUrl: string;
  };
  migration: {
    batchSize: number;
    dryRun: boolean;
    logLevel: LogLevel;
    skipArchived: boolean;
    inboxId?: string;
  };
}

function getLogLevel(levelStr: string | undefined): LogLevel {
  switch (levelStr?.toLowerCase()) {
    case 'error': return LogLevel.ERROR;
    case 'warn': return LogLevel.WARN;
    case 'debug': return LogLevel.DEBUG;
    case 'info':
    default: return LogLevel.INFO;
  }
}

export function loadConfig(): Config {
  const config: Config = {
    front: {
      apiKey: process.env.FRONT_API_KEY || '',
      baseUrl: process.env.FRONT_API_BASE_URL || 'https://api2.frontapp.com',
    },
    migration: {
      batchSize: parseInt(process.env.BATCH_SIZE || '10', 10),
      dryRun: (process.env.DRY_RUN || '').toLowerCase() !== 'false',
      logLevel: getLogLevel(process.env.LOG_LEVEL),
      skipArchived: process.env.SKIP_ARCHIVED === 'true',
      inboxId: process.env.FRONT_INBOX_ID,
    },
  };

  // Validate required config
  if (!config.front.apiKey) {
    throw new Error('FRONT_API_KEY is required. Please set it in your .env file.');
  }

  return config;
}

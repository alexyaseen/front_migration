export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

export class Logger {
  private level: LogLevel;
  private prefix: string;

  constructor(prefix: string = '', level: LogLevel = LogLevel.INFO) {
    this.prefix = prefix;
    this.level = level;
  }

  setLevel(level: LogLevel) {
    this.level = level;
  }

  error(message: string, ...args: any[]) {
    if (this.level >= LogLevel.ERROR) {
      console.error(`[ERROR]${this.prefix ? ` [${this.prefix}]` : ''} ${message}`, ...args);
    }
  }

  warn(message: string, ...args: any[]) {
    if (this.level >= LogLevel.WARN) {
      console.warn(`[WARN]${this.prefix ? ` [${this.prefix}]` : ''} ${message}`, ...args);
    }
  }

  info(message: string, ...args: any[]) {
    if (this.level >= LogLevel.INFO) {
      console.log(`[INFO]${this.prefix ? ` [${this.prefix}]` : ''} ${message}`, ...args);
    }
  }

  debug(message: string, ...args: any[]) {
    if (this.level >= LogLevel.DEBUG) {
      console.log(`[DEBUG]${this.prefix ? ` [${this.prefix}]` : ''} ${message}`, ...args);
    }
  }

  progress(current: number, total: number, message?: string) {
    const percentage = Math.round((current / total) * 100);
    const bar = 'ˆ'.repeat(Math.floor(percentage / 2)) + '‘'.repeat(50 - Math.floor(percentage / 2));
    process.stdout.write(`\r[${bar}] ${percentage}% (${current}/${total})${message ? ` - ${message}` : ''}`);
    if (current === total) {
      process.stdout.write('\n');
    }
  }
}
import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import { FeishuErrorTransport } from './FeishuErrorTransport';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// 定义日志格式
const logFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} ${level}: ${stack || message}`;
});

const logsDir = path.join(process.cwd(), 'logs');
const LOG_RETENTION_DAYS = '7d';
const LOG_MAX_FILE_SIZE = '20m';

// 动态判断是否为 Serverless 环境 (Vercel 或 FC)
const isServerless = process.env.VERCEL || process.env.SERVERLESS;

const transportsList: winston.transport[] = [
  // 控制台输出
  new winston.transports.Console({
    format: combine(
      colorize(),
      logFormat
    )
  }),
  // 飞书错误日志通知
  new FeishuErrorTransport({ level: 'error' })
];

// 如果不是 Serverless 环境，才开启本地文件持久化 (因为 Serverless 下 /logs 目录不可写)
if (!isServerless) {
  transportsList.push(
    new winston.transports.DailyRotateFile({
      filename: path.join(logsDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: LOG_MAX_FILE_SIZE,
      maxFiles: LOG_RETENTION_DAYS,
      zippedArchive: true,
      format: logFormat
    }),
    new winston.transports.DailyRotateFile({
      filename: path.join(logsDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: LOG_MAX_FILE_SIZE,
      maxFiles: LOG_RETENTION_DAYS,
      zippedArchive: true,
      format: logFormat
    })
  );
}

// 配置日志
export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' })
  ),
  transports: transportsList
});

// 重写全局 console 使得现有的 console.log/error 也走 winston（按需开启）
// 这里为了平滑过渡，我们提供一个 logger 对象供新代码使用，
// 同时也可以把旧的 console.log 替换一下
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const originalInfo = console.info;

export const overrideConsole = () => {
  const formatArgs = (args: any[]) => args.map(arg => (arg instanceof Error ? arg.stack || arg.message : typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' ');
  console.log = (...args) => logger.info(formatArgs(args));
  console.error = (...args) => logger.error(formatArgs(args));
  console.warn = (...args) => logger.warn(formatArgs(args));
  console.info = (...args) => logger.info(formatArgs(args));
};

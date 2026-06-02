import process from "process";

// Minimal leveled logger (no dependency), in the spirit of env.js. Threshold is
// controlled by LOG_LEVEL (debug|info|warn|error, default info). There is a
// single console call site below: to go structured/production-grade later, swap
// that one line for pino without touching any call sites.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.LOG_LEVEL || "info").toLowerCase()] ?? LEVELS.info;

const emit = (level, message, meta) => {
  if (LEVELS[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
  const sink = level === "error" || level === "warn" ? console.error : console.log;
  // Single point of output: replace with pino here to get structured JSON logs.
  if (meta === undefined) sink(line);
  else sink(line, meta);
};

export const log = {
  debug: (message, meta) => emit("debug", message, meta),
  info: (message, meta) => emit("info", message, meta),
  warn: (message, meta) => emit("warn", message, meta),
  error: (message, meta) => emit("error", message, meta),
};

// Express middleware: one info line per request with method, path, status and
// duration in ms. Mount before the routes.
export const requestLogger = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    log.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
  });
  next();
};

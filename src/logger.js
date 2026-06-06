// Minimal, dependency-free leveled logger with timestamps.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const activeLevel = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

function ts() {
  return new Date().toISOString();
}

function emit(level, stream, args) {
  if (LEVELS[level] < activeLevel) return;
  stream(`[${ts()}] [${level.toUpperCase()}]`, ...args);
}

export const log = {
  debug: (...a) => emit('debug', console.error, a),
  info: (...a) => emit('info', console.error, a),
  warn: (...a) => emit('warn', console.error, a),
  error: (...a) => emit('error', console.error, a),
};

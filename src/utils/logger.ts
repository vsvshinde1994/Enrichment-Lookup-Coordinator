export const logger = {
  info: (msg: string, meta?: any) => {
    console.log(JSON.stringify({ level: 'INFO', time: new Date().toISOString(), message: msg, ...(meta ? { meta } : {}) }));
  },
  warn: (msg: string, meta?: any) => {
    console.warn(JSON.stringify({ level: 'WARN', time: new Date().toISOString(), message: msg, ...(meta ? { meta } : {}) }));
  },
  error: (msg: string, error?: any) => {
    console.error(JSON.stringify({ 
      level: 'ERROR', 
      time: new Date().toISOString(), 
      message: msg, 
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error 
    }));
  }
};


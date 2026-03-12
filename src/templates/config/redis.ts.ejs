import { createClient } from 'redis';
import { env } from './env.js';

const client = createClient({
  url: env.REDIS_URL ?? 'redis://localhost:6379',
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) return new Error('Redis: max reconnect retries exceeded');
      return Math.min(retries * 100, 3000);
    },
  },
});

client.on('error', (err) => {
  console.error('[redis] connection error:', err.message);
});

client.on('reconnecting', () => {
  console.warn('[redis] reconnecting...');
});

// Connect at startup — await this in server.ts or let it be lazy
export const redisConnect = () => client.connect();

export { client as redis };

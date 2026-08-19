import { Pool } from 'pg';
import type { Config } from '../config';

export function createPool(config: Config): Pool {
  if (config.db.socketPath) {
    return new Pool({
      host: config.db.socketPath,
      database: config.db.name,
      user: config.db.user,
      password: config.db.password,
      max: 5,
    });
  }
  return new Pool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.name,
    user: config.db.user,
    password: config.db.password,
    max: 5,
  });
}

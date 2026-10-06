export interface AppConfig {
  databaseUrl: string;
  appUrl: string;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    databaseUrl: env.DATABASE_URL ?? '',
    appUrl: env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  };
}

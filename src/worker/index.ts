import { createApp } from './app';
import { betterAuthSessionUser } from './auth';

const app = createApp({ getSessionUser: betterAuthSessionUser, now: () => new Date() });

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;

import { createApp } from './app';

const app = createApp({ getSessionUser: async () => null, now: () => new Date() });

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;

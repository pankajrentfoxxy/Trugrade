import { z } from 'zod';

export const devSqlBodySchema = z.object({
  query: z.string().trim().min(1, 'Send a SQL query.'),
});

export type DevSqlBodyDto = z.infer<typeof devSqlBodySchema>;

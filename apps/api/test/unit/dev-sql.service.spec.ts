import { DevSqlService } from '../../src/platform/dev/dev-sql.service';
import type { PrismaService } from '../../src/shared/db/prisma.service';

describe('DevSqlService', () => {
  const prisma = {
    $queryRawUnsafe: jest.fn(),
    $executeRawUnsafe: jest.fn(),
  } as unknown as PrismaService;

  const service = new DevSqlService(prisma);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns rows for SELECT', async () => {
    (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValue([
      { id: '1', count: BigInt(3), created_at: new Date('2026-01-01T00:00:00.000Z') },
    ]);

    const result = await service.run('SELECT id, count, created_at FROM identity.organization LIMIT 1');

    expect(result.command).toBe('SELECT');
    expect(result.rowCount).toBe(1);
    expect(result.columns).toEqual(['id', 'count', 'created_at']);
    expect(result.rows[0]).toEqual({
      id: '1',
      count: '3',
      created_at: '2026-01-01T00:00:00.000Z',
    });
  });

  it('returns affected rows for UPDATE', async () => {
    (prisma.$executeRawUnsafe as jest.Mock).mockResolvedValue(2);

    const result = await service.run('UPDATE identity.organization SET status = status');

    expect(result.command).toBe('UPDATE');
    expect(result.rowCount).toBe(2);
    expect(result.rows).toEqual([]);
  });
});

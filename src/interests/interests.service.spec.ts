jest.mock('prisma/prisma.service', () => ({ PrismaService: class {} }));
import { InterestsService } from './interests.service';
import { INTEREST_CATALOG } from './interest-catalog';

describe('required shopping interests', () => {
  const prisma = {
    interest: { createMany: jest.fn(), findMany: jest.fn() },
    user: { findUnique: jest.fn() },
  };
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.interest.createMany.mockResolvedValue({ count: 9 });
    prisma.interest.findMany.mockResolvedValue([
      { id: 'existing-fashion', name: 'Fashion', slug: 'fashion' },
    ]);
  });

  it('initializes reference data once for concurrent requests without changing existing rows', async () => {
    const service = new InterestsService(prisma as never);
    const [first, second] = await Promise.all([
      service.findAll(),
      service.findAll(),
    ]);
    expect(prisma.interest.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.interest.createMany).toHaveBeenCalledWith({
      data: [...INTEREST_CATALOG],
      skipDuplicates: true,
    });
    expect(first).toEqual(second);
    expect(first[0].id).toBe('existing-fashion');
  });

  it('preserves the buyer’s selected interests and rejects unknown accounts', async () => {
    const service = new InterestsService(prisma as never);
    prisma.user.findUnique
      .mockResolvedValueOnce({ interests: [{ id: 'existing-fashion' }] })
      .mockResolvedValueOnce(null);
    expect(await service.findAllForUser('buyer')).toEqual([
      {
        id: 'existing-fashion',
        name: 'Fashion',
        slug: 'fashion',
        isSelected: true,
      },
    ]);
    await expect(service.findAllForUser('missing')).rejects.toThrow(
      'User not found.',
    );
    expect(prisma.interest.createMany).toHaveBeenCalledTimes(1);
  });

  it('retries initialization after a temporary database failure', async () => {
    const service = new InterestsService(prisma as never);
    prisma.interest.createMany.mockRejectedValueOnce(
      new Error('Database unavailable'),
    );
    await expect(service.findAll()).rejects.toThrow('Database unavailable');
    expect(await service.findAll()).toHaveLength(1);
    expect(prisma.interest.createMany).toHaveBeenCalledTimes(2);
  });
});

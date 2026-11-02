import { InterestsService } from './interests.service';
import { isolatedInvoiceDatabase } from '../../test/helpers/isolated-invoice-database';
import type { PrismaService } from '../../prisma/prisma.service';

const databaseTests = process.env.RUN_INTERESTS_DATABASE_TESTS === '1' ? describe : describe.skip;
databaseTests('shopping interests in an unseeded deployment database', () => {
  jest.setTimeout(180000);
  let prisma: PrismaService;
  let cleanup: () => Promise<void>;
  beforeAll(async () => { ({ prisma, cleanup } = await isolatedInvoiceDatabase()); });
  afterAll(async () => { await cleanup?.(); });

  it('creates all nine options on an empty database, once across concurrent instances, and retains buyer selections', async () => {
    expect(await prisma.interest.count()).toBe(0);
    const buyer = await prisma.user.create({ data: { firstName: 'Existing buyer', registrationType: 'BUYER' } });
    const first = new InterestsService(prisma);
    const second = new InterestsService(prisma);
    const [catalog, forBuyer] = await Promise.all([first.findAll(), second.findAllForUser(buyer.id)]);
    expect(catalog).toHaveLength(9);
    expect(forBuyer).toHaveLength(9);
    expect(forBuyer.every((interest) => !interest.isSelected)).toBe(true);
    expect(await prisma.interest.count()).toBe(9);
    const fashion = catalog.find((interest) => interest.slug === 'fashion')!;
    await prisma.user.update({ where: { id: buyer.id }, data: { interests: { connect: { id: fashion.id } } } });
    const afterRestart = await new InterestsService(prisma).findAllForUser(buyer.id);
    expect(afterRestart.find((interest) => interest.slug === 'fashion')).toMatchObject({ id: fashion.id, isSelected: true });
    expect(await prisma.user.count()).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).firstName).toBe('Existing buyer');
    expect(await prisma.vendorProfile.count()).toBe(0);
  });
});

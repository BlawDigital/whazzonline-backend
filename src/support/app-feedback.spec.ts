import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PrismaService } from 'prisma/prisma.service';
import { PrismaModule } from 'prisma/prisma.module';
import { SupportService } from './support.service';
import { SupportModule } from './support.module';
jest.mock('prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

type Ticket = {
  id: string;
  ownerUserId: string;
  category: string;
  subject: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};
type Message = {
  id: string;
  ticketId: string;
  senderUserId: string;
  senderRole: string;
  text: string | null;
  attachments: unknown[];
  createdAt: Date;
  sender: { firstName: string; lastName: string };
};
describe('App feedback HTTP contract (mock database)', () => {
  let app: NestExpressApplication, jwt: JwtService, service: SupportService;
  const rows = new Map<string, Ticket>(),
    messages = new Map<string, Message>();
  const whereMatches = (ticket: Ticket, where: Partial<Ticket>) =>
    Object.entries(where).every(
      ([key, value]) => ticket[key as keyof Ticket] === value,
    );
  const tickets = {
    findFirst: jest.fn(
      async ({ where }: { where: Partial<Ticket> }) =>
        [...rows.values()].find((row) => whereMatches(row, where)) ?? null,
    ),
    create: jest.fn(
      async ({
        data,
      }: {
        data: Partial<Ticket> & { messages?: { create: Partial<Message> } };
      }) => {
        const id = data.id ?? randomUUID();
        if (rows.has(id))
          throw Object.assign(new Error('Duplicate'), { code: 'P2002' });
        const now = new Date();
        const ticket: Ticket = {
          id,
          ownerUserId: data.ownerUserId!,
          category: data.category!,
          subject: data.subject!,
          status: 'open',
          createdAt: now,
          updatedAt: now,
        };
        rows.set(id, ticket);
        if (data.messages)
          await messageTable.create({
            data: { ...data.messages.create, ticketId: id },
          });
        return ticket;
      },
    ),
    findMany: jest.fn(
      async ({
        where,
        skip,
        take,
      }: {
        where: Partial<Ticket>;
        skip: number;
        take: number;
      }) =>
        [...rows.values()]
          .filter((row) => whereMatches(row, where))
          .slice(skip, skip + take),
    ),
    count: jest.fn(
      async ({ where }: { where: Partial<Ticket> }) =>
        [...rows.values()].filter((row) => whereMatches(row, where)).length,
    ),
    update: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<Ticket>;
      }) => {
        const ticket = rows.get(where.id)!;
        Object.assign(ticket, data);
        return ticket;
      },
    ),
  };
  const messageTable = {
    create: jest.fn(async ({ data }: { data: Partial<Message> }) => {
      const message: Message = {
        id: randomUUID(),
        ticketId: data.ticketId!,
        senderUserId: data.senderUserId!,
        senderRole: data.senderRole!,
        text: data.text ?? null,
        attachments: data.attachments ?? [],
        createdAt: new Date(),
        sender: {
          firstName: data.senderRole === 'admin' ? 'Support' : 'Member',
          lastName: '',
        },
      };
      messages.set(message.id, message);
      return message;
    }),
    findMany: jest.fn(async ({ where }: { where: { ticketId: string } }) =>
      [...messages.values()].filter(
        (message) => message.ticketId === where.ticketId,
      ),
    ),
  };
  const db = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({
        isActive: where.id !== 'inactive',
        role: where.id === 'admin' ? 'ADMIN' : 'CUSTOMER',
        vendorProfile: where.id === 'seller' ? { id: 'vendor' } : null,
      })),
    },
    supportTicket: tickets,
    supportMessage: messageTable,
    $transaction: jest.fn(async (input: unknown) =>
      Array.isArray(input)
        ? Promise.all(input)
        : (
            input as (tx: {
              supportTicket: typeof tickets;
              supportMessage: typeof messageTable;
            }) => Promise<unknown>
          )({ supportTicket: tickets, supportMessage: messageTable }),
    ),
  };
  const auth = (user = 'buyer') => `Bearer ${jwt.sign({ sub: user })}`;
  const feedback = () => ({
    requestId: randomUUID(),
    category: 'app_issue',
    subject: 'Checkout problem',
    text: 'The checkout closes when I select an address.',
  });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        PrismaModule,
        JwtModule.register({
          global: true,
          secret: 'local-feedback-test-only',
        }),
        SupportModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    jwt = module.get(JwtService);
    service = module.get(SupportService);
    await app.init();
  });
  beforeEach(() => {
    rows.clear();
    messages.clear();
    jest.clearAllMocks();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('keeps contact public but rejects missing, invalid and expired tokens for reports', async () => {
    await request(app.getHttpServer()).get('/support/contact').expect(200);
    await request(app.getHttpServer())
      .post('/support/tickets')
      .send(feedback())
      .expect(401);
    await request(app.getHttpServer())
      .post('/support/tickets')
      .set('Authorization', 'Bearer invalid')
      .send(feedback())
      .expect(401);
    await request(app.getHttpServer())
      .post('/support/tickets')
      .set(
        'Authorization',
        `Bearer ${jwt.sign({ sub: 'buyer' }, { expiresIn: -1 })}`,
      )
      .send(feedback())
      .expect(401);
    expect(rows.size).toBe(0);
  });
  it.each(['buyer', 'seller'])(
    'allows %s feedback with one persisted first message',
    async (user) => {
      const body = feedback();
      await request(app.getHttpServer())
        .post('/support/tickets')
        .set('Authorization', auth(user))
        .send(body)
        .expect(201)
        .expect(
          ({ body: result }: { body: { id: string; status: string } }) => {
            expect(result).toMatchObject({
              id: body.requestId,
              status: 'open',
            });
          },
        );
      expect(rows.get(body.requestId)).toMatchObject({
        ownerUserId: user,
        category: 'app_issue',
      });
      expect([...messages.values()]).toMatchObject([
        { senderUserId: user, senderRole: 'user', text: body.text },
      ]);
    },
  );
  it('accepts feature requests and trims titles and text', async () => {
    const body = {
      ...feedback(),
      category: 'feature_request',
      subject: '  More filters  ',
      text: '  Filter products by delivery speed.  ',
    };
    await request(app.getHttpServer())
      .post('/support/tickets')
      .set('Authorization', auth())
      .send(body)
      .expect(201);
    expect(rows.get(body.requestId)).toMatchObject({
      category: 'feature_request',
      subject: 'More filters',
    });
    expect([...messages.values()][0].text).toBe(
      'Filter products by delivery speed.',
    );
  });
  it.each([
    { subject: '  ' },
    { text: 'short' },
    { category: 'admin' },
    { requestId: 'invalid' },
    { ownerUserId: 'other' },
    { text: 'x'.repeat(4001) },
  ])('rejects invalid or forged request %j', async (invalid) => {
    await request(app.getHttpServer())
      .post('/support/tickets')
      .set('Authorization', auth())
      .send({ ...feedback(), ...invalid })
      .expect(400);
    expect(rows.size).toBe(0);
  });
  it('rejects inactive accounts', async () => {
    await request(app.getHttpServer())
      .post('/support/tickets')
      .set('Authorization', auth('inactive'))
      .send(feedback())
      .expect(403);
  });
  it('deduplicates retry and concurrent submissions using the same request ID', async () => {
    const body = feedback();
    await Promise.all([
      service.feedback(
        'buyer',
        body as Parameters<SupportService['feedback']>[1],
      ),
      service.feedback(
        'buyer',
        body as Parameters<SupportService['feedback']>[1],
      ),
    ]);
    await request(app.getHttpServer())
      .post('/support/tickets')
      .set('Authorization', auth())
      .send(body)
      .expect(201);
    expect(rows.size).toBe(1);
    expect(messages.size).toBe(1);
  });
  it('scopes history, details, messages, and attachments to their owner', async () => {
    const body = feedback();
    await request(app.getHttpServer())
      .post('/support/tickets')
      .set('Authorization', auth())
      .send(body)
      .expect(201);
    await request(app.getHttpServer())
      .get('/support/tickets')
      .set('Authorization', auth('other'))
      .expect(200)
      .expect(({ body: result }: { body: { total: number } }) =>
        expect(result.total).toBe(0),
      );
    await request(app.getHttpServer())
      .get(`/support/tickets/${body.requestId}`)
      .set('Authorization', auth('other'))
      .expect(404);
    await request(app.getHttpServer())
      .post(`/support/tickets/${body.requestId}/messages`)
      .set('Authorization', auth('other'))
      .send({ text: 'Tampering' })
      .expect(404);
    await request(app.getHttpServer())
      .get(
        `/support/tickets/${body.requestId}/messages/message/attachments/file`,
      )
      .set('Authorization', auth('other'))
      .expect(404);
    await request(app.getHttpServer())
      .post('/support/tickets')
      .set('Authorization', auth('other'))
      .send(body)
      .expect(409);
    expect(messages.size).toBe(1);
  });
  it('delivers buyer requests to the existing admin inbox, preserves seller restrictions, and reopens on reply', async () => {
    const body = feedback();
    await request(app.getHttpServer())
      .post('/support/tickets')
      .set('Authorization', auth())
      .send(body)
      .expect(201);
    await request(app.getHttpServer())
      .get('/seller/support/tickets')
      .set('Authorization', auth())
      .expect(403);
    await request(app.getHttpServer())
      .get('/admin/support/tickets')
      .set('Authorization', auth())
      .expect(403);
    await request(app.getHttpServer())
      .get('/admin/support/tickets')
      .set('Authorization', auth('admin'))
      .expect(200)
      .expect(({ body: result }: { body: { total: number } }) =>
        expect(result.total).toBe(1),
      );
    await request(app.getHttpServer())
      .post(`/admin/support/tickets/${body.requestId}/messages`)
      .set('Authorization', auth('admin'))
      .send({ text: 'We are reviewing this.' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/admin/support/tickets/${body.requestId}/status`)
      .set('Authorization', auth('admin'))
      .send({ status: 'resolved' })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/support/tickets/${body.requestId}`)
      .set('Authorization', auth())
      .expect(200)
      .expect(
        ({
          body: result,
        }: {
          body: { messages: { text: string; direction: string }[] };
        }) =>
          expect(result.messages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                text: 'We are reviewing this.',
                direction: 'incoming',
              }),
            ]),
          ),
      );
    await request(app.getHttpServer())
      .post(`/support/tickets/${body.requestId}/messages`)
      .set('Authorization', auth())
      .send({ text: 'It still happens.' })
      .expect(201);
    expect(rows.get(body.requestId)?.status).toBe('open');
  });
});

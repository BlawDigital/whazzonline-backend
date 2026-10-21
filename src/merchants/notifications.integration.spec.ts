import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../app.module';
import { PrismaService } from '../../prisma/prisma.service';
const isolated = /^postgresql:\/\/[^@]+@localhost:5433\/seller_web_verification(?:_notifications)?(?:\?|$)/.test(process.env.DATABASE_URL ?? '');
(isolated ? describe : describe.skip)('Notification HTTP persistence and privacy', () => {
 jest.setTimeout(60000); let app: NestExpressApplication, db: PrismaService; const seller=randomUUID(),buyer=randomUUID(),outsider=randomUUID();let token:string,outsiderToken:string;let noticeId:string;
 beforeAll(async()=>{
  const module=await Test.createTestingModule({imports:[AppModule]}).compile();app=module.createNestApplication<NestExpressApplication>({logger:false});app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true,forbidNonWhitelisted:true}));await app.init();db=module.get(PrismaService);const jwt=module.get(JwtService);token=await jwt.signAsync({sub:buyer});outsiderToken=await jwt.signAsync({sub:outsider});
  for(const id of [seller,buyer,outsider])await db.user.create({data:{id,firstName:'Notification fixture',registrationType:id===seller?'SELLER':'BUYER',role:id===seller?'VENDOR':'CUSTOMER'}});
  const profile=await db.vendorProfile.create({data:{userId:seller,storeName:'Notification verification',category:'Fashion',subCategory:'Clothes',city:'Lagos',state:'Lagos',lga:'Ikeja',address:'Isolated fixture',description:'Private fixture',setupCompleted:true,reviewStatus:'APPROVED'}});
  await db.merchantContact.create({data:{userId:buyer,merchantId:profile.id}});
  for(let i=0;i<7;i++)await db.merchantContent.create({data:{merchantId:profile.id,kind:'SCROLL',topic:i===0?'OFFER':'ANNOUNCEMENT',title:`Update ${i}`,mediaType:'IMAGE',mediaUrl:'https://example.test/fixture.png',createdAt:new Date(Date.now()-i*60000)}});
  await db.offer.create({data:{vendorProfileId:profile.id,type:'PRICE_DISCOUNT',status:'ACTIVE',name:'Fixture offer',discountType:'PERCENTAGE',discountValue:10,startsAt:new Date(Date.now()-1000),endsAt:new Date(Date.now()+3600000)}});
 });
 afterAll(async()=>{if(db)await db.user.deleteMany({where:{id:{in:[seller,buyer,outsider]}}});await app?.close();});
 it('protects the feed, validates filters, returns only the newest five and exposes the remaining page',async()=>{
  await request(app.getHttpServer()).get('/merchants/notifications').expect(401);
  await request(app.getHttpServer()).get('/merchants/notifications?limit=101').auth(token,{type:'bearer'}).expect(400);
  await request(app.getHttpServer()).get('/merchants/notifications?category=private').auth(token,{type:'bearer'}).expect(400);
  const response=await request(app.getHttpServer()).get('/merchants/notifications?limit=5').auth(token,{type:'bearer'}).expect(200);
  const feed=response.body as {notifications:{id:string;createdAt:string;category:string}[];hasMore:boolean;unreadCount:number;total:number};expect(feed.notifications).toHaveLength(5);expect(feed.hasMore).toBe(true);expect(feed.total).toBe(8);expect(feed.unreadCount).toBe(8);noticeId=feed.notifications[0].id;
  expect(feed.notifications.map(n=>n.createdAt)).toEqual(feed.notifications.map(n=>n.createdAt).sort((a,b)=>Date.parse(b)-Date.parse(a)));
  const next=await request(app.getHttpServer()).get('/merchants/notifications?limit=5&offset=5').auth(token,{type:'bearer'}).expect(200);expect((next.body as {notifications:unknown[]}).notifications).toHaveLength(3);
  const offers=await request(app.getHttpServer()).get('/merchants/notifications?category=offers').auth(token,{type:'bearer'}).expect(200);expect((offers.body as {notifications:{category:string}[]}).notifications).toEqual([expect.objectContaining({category:'offers'})]);
  const promotions=await request(app.getHttpServer()).get('/merchants/notifications?category=promotions').auth(token,{type:'bearer'}).expect(200);expect((promotions.body as {notifications:unknown[]}).notifications).toHaveLength(1);
 });
 it('saves individual reads, rejects another account notification, then marks all categories read idempotently',async()=>{
  await request(app.getHttpServer()).post(`/merchants/notifications/${encodeURIComponent(noticeId)}/read`).auth(outsiderToken,{type:'bearer'}).expect(404);
  expect(await db.sellerNotificationRead.count({where:{userId:outsider}})).toBe(0);
  for(let i=0;i<2;i++)await request(app.getHttpServer()).post(`/merchants/notifications/${encodeURIComponent(noticeId)}/read`).auth(token,{type:'bearer'}).expect(201);
  let response=await request(app.getHttpServer()).get('/merchants/notifications').auth(token,{type:'bearer'}).expect(200);expect((response.body as {unreadCount:number}).unreadCount).toBe(7);
  expect(await db.sellerNotificationRead.count({where:{userId:buyer,key:noticeId}})).toBe(1);
  await request(app.getHttpServer()).post('/merchants/notifications/read-all').auth(token,{type:'bearer'}).expect(201);
  response=await request(app.getHttpServer()).get('/merchants/notifications').auth(token,{type:'bearer'}).expect(200);expect((response.body as {unreadCount:number}).unreadCount).toBe(0);
 });
});

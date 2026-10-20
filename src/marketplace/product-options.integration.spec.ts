import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { isolatedInvoiceDatabase } from '../../test/helpers/isolated-invoice-database';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductsController } from './products.controller';
import { CommerceService } from '../commerce/commerce.service';
import { GoodsInvoicesService } from '../invoices/goods-invoices.service';
import { VendorsService } from '../vendors/vendors.service';
import { storedVariants } from '../common/product-options';
jest.setTimeout(180000);
const databaseTests=process.env.RUN_INVOICE_DATABASE_TESTS === '1' ? describe : describe.skip;
databaseTests('product choices and comment persistence',()=>{
  let prisma:PrismaService,cleanup:()=>Promise<void>,controller:ProductsController,commerce:CommerceService,invoices:GoodsInvoicesService;
  let buyer:string,vendor:string,product:string,otherProduct:string;
  const choices=[{color:'Rose gold',size:'6.7 inches',type:'With charger',options:{Storage:'256 GB'},imageIndexes:[1],quantity:2},{color:'Space black',size:'6.7 inches',type:'With case',options:{Storage:'512 GB'},imageIndexes:[0],quantity:2}];
  const selection=(index:number)=>({Color:choices[index].color,Size:choices[index].size,Option:choices[index].type,...choices[index].options});
  const address={label:'QA delivery',latitude:6.5,longitude:3.3};
  beforeAll(async()=>{
    const db=await isolatedInvoiceDatabase();prisma=db.prisma;cleanup=db.cleanup;
    controller=new ProductsController(prisma);invoices=new GoodsInvoicesService(prisma);commerce=new CommerceService(prisma,invoices);
    buyer=(await prisma.user.create({data:{email:'buyer@example.test',firstName:'Buyer'}})).id;
    vendor=(await prisma.user.create({data:{email:'seller@example.test',firstName:'Seller',role:'VENDOR',registrationType:'SELLER'}})).id;
    const profile=await prisma.vendorProfile.create({data:{userId:vendor,storeName:'Option store',setupCompleted:true,category:'Electronics',subCategory:'Phones',state:'Lagos',city:'Lagos',lga:'Yaba',address:'QA store',description:'QA store',bankName:'QA bank',bankAccountName:'QA seller',bankAccountNumber:'1234567890'}});
    product=(await prisma.product.create({data:{vendorProfileId:profile.id,name:'Option phone',category:'Phones',unitPrice:10000,quantity:4,imageUrls:['https://example.test/black.jpg','https://example.test/gold.jpg'],variants:choices}})).id;
    otherProduct=(await prisma.product.create({data:{vendorProfileId:profile.id,name:'No options',category:'General',unitPrice:1000,quantity:10,imageUrls:[]}})).id;
  },240000);
  afterAll(async()=>{if(cleanup)await cleanup();});
  it('applies the additive schema patch repeatedly without losing existing data',async()=>{
    const client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();try{const sql=readFileSync(resolve('prisma/patches/20261020_product_comment_threads.sql'),'utf8');await client.query(sql);await client.query(sql);}finally{await client.end();}expect(await prisma.product.count()).toBe(2);
  });
  it('persists arbitrary specifications and optional photo mapping through seller creation',async()=>{
    const created=await new VendorsService(prisma).createProduct(vendor,{name:'Projector',category:'Electronics',unitPrice:5000,quantity:1,subCategories:[],specifications:{'COLORS':'Lilac','SCREEN_SIZE':'120 inches'},variants:[{quantity:1,imageIndexes:[1],options:{'finish':'Matte'},colorHex:'#c8a2c8'}]},['a.jpg','b.jpg']);
    expect(created.specifications).toEqual({Color:'Lilac','Screen size':'120 inches'});expect(created.variants).toEqual([expect.objectContaining({options:{Finish:'Matte'},imageIndexes:[1],colorHex:'#c8a2c8'})]);
  });
  it('persists replies, flattens nested replies, counts likes, and enforces ownership',async()=>{
    const request={user:{sub:buyer}} as never, seller={user:{sub:vendor}} as never;
    const root=await controller.createProductComment(product,'Is the charger included?',request);
    const child=await controller.createProductComment(product,'Yes, choose With charger.',seller,root.id);
    await controller.createProductComment(product,'Thank you',request,child.id);
    await controller.likeComment(product,root.id,request);await controller.likeComment(product,root.id,request);
    const comments=await controller.getProductComments(product);expect(comments).toHaveLength(1);expect(comments[0]._count).toEqual({likes:1,replies:2});expect(await controller.likedComments(product,request)).toEqual([root.id]);
    expect(await controller.getCommentReplies(product,root.id)).toHaveLength(2);
    await expect(controller.createProductComment(otherProduct,'Wrong product',request,root.id)).rejects.toThrow(/removed/);
    await expect(controller.deleteComment(product,root.id,seller)).rejects.toThrow(/not found/);
    await controller.unlikeComment(product,root.id,request);await controller.deleteComment(product,root.id,request);
    expect(await prisma.productComment.count()).toBe(0);expect(await prisma.productCommentLike.count()).toBe(0);
  });
  it('checks out two options of one product for guests, reserves stock and releases it exactly once',async()=>{
    const receipt=await commerce.guestCheckout({firstName:'QA',lastName:'Buyer',email:'qa@example.test',phone:'08000000000',address,paymentMethod:'bank',idempotencyKey:randomUUID(),items:[0,1].map(index=>({productId:product,quantity:1,selectedVariants:selection(index)}))});
    const lines=await prisma.commerceOrderItem.findMany({where:{orderId:receipt.id}});expect(lines).toHaveLength(2);expect(lines.find(l=>l.selectedColor === null && (l.selectedVariants as Record<string,string>).Color === 'Rose gold')?.imageUri).toBe('https://example.test/gold.jpg');
    expect(storedVariants((await prisma.product.findUniqueOrThrow({where:{id:product}})).variants).map(v=>v.quantity)).toEqual([1,1]);
    await invoices.void(receipt.invoices[0].id,vendor);await invoices.void(receipt.invoices[0].id,vendor);
    const restored=await prisma.product.findUniqueOrThrow({where:{id:product}});expect(restored.quantity).toBe(4);expect(storedVariants(restored.variants).map(v=>v.quantity)).toEqual([2,2]);
  });
  it('keeps authenticated cart choices separate and rejects exhausted option stock atomically',async()=>{
    const first=await commerce.addItem(buyer,{productId:product,quantity:2,deliveryAddress:address.label,selectedVariants:selection(0)});
    const second=await commerce.addItem(buyer,{productId:product,quantity:1,deliveryAddress:address.label,selectedVariants:selection(1)});
    expect(first.id).not.toBe(second.id);expect(first.imageUri).toBe('https://example.test/gold.jpg');
    const receipt=await commerce.checkout(buyer,{address,paymentMethod:'bank',cartSelection:[{cartItemId:first.id,quantity:2},{cartItemId:second.id,quantity:1}],idempotencyKey:randomUUID()});expect(receipt.invoices).toHaveLength(1);
    await expect(commerce.guestCheckout({firstName:'QA',lastName:'Buyer',email:'qa@example.test',phone:'08000000000',address,paymentMethod:'bank',items:[{productId:product,quantity:1,selectedVariants:selection(0)}]})).rejects.toThrow(/enough stock/);
    expect((await prisma.product.findUniqueOrThrow({where:{id:product}})).quantity).toBe(1);
  });
});


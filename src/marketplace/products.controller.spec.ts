jest.mock('prisma/prisma.service',()=>({PrismaService:class {}}));
import { ProductsController } from './products.controller';
const user={user:{sub:'buyer'}} as never;
describe('product comment threads',()=>{
  const prisma={product:{findFirst:jest.fn()},productComment:{findFirst:jest.fn(),findMany:jest.fn(),create:jest.fn(),deleteMany:jest.fn()},productCommentLike:{upsert:jest.fn(),deleteMany:jest.fn(),findMany:jest.fn()}};
  const controller=new ProductsController(prisma as never);
  beforeEach(()=>{jest.clearAllMocks();prisma.product.findFirst.mockResolvedValue({id:'p'});prisma.productComment.create.mockResolvedValue({id:'new'});});
  it('rejects empty and overlong comments',async()=>{await expect(controller.createProductComment('p',' ',user)).rejects.toThrow(/empty/);await expect(controller.createProductComment('p','a'.repeat(2001),user)).rejects.toThrow(/2000/);expect(prisma.productComment.create).not.toHaveBeenCalled();});
  it('keeps replies attached to the root conversation',async()=>{prisma.productComment.findFirst.mockResolvedValue({id:'child',parentId:'root'});await controller.createProductComment('p',' Hello ',user,'child');expect(prisma.productComment.findFirst).toHaveBeenCalledWith({where:{id:'child',productId:'p'}});expect(prisma.productComment.create).toHaveBeenCalledWith(expect.objectContaining({data:{productId:'p',userId:'buyer',content:'Hello',parentId:'root'}}));});
  it('rejects replies to a missing or other-product comment',async()=>{prisma.productComment.findFirst.mockResolvedValue(null);await expect(controller.createProductComment('p','hello',user,'other')).rejects.toThrow(/removed/);expect(prisma.productComment.create).not.toHaveBeenCalled();});
  it('makes likes idempotent and scoped to the product',async()=>{prisma.productComment.findFirst.mockResolvedValue({id:'c'});await controller.likeComment('p','c',user);expect(prisma.productCommentLike.upsert).toHaveBeenCalledWith({where:{commentId_userId:{commentId:'c',userId:'buyer'}},create:{commentId:'c',userId:'buyer'},update:{}});});
  it('only deletes comments owned by the signed-in user',async()=>{prisma.productComment.deleteMany.mockResolvedValue({count:0});await expect(controller.deleteComment('p','c',user)).rejects.toThrow(/not found/);expect(prisma.productComment.deleteMany).toHaveBeenCalledWith({where:{id:'c',productId:'p',userId:'buyer'}});});
});

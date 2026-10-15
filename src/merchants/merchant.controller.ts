import { ReviewVoteDto } from '../vendors/dto/store-community.dto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/guards/authenticated-request';
import {
  AisleDto,
  AssignAisleDto,
  ContentDto,
  FeedDto,
  ProductReviewDto,
  ProductReviewsQuery,
  UpdateContentDto,
} from './merchant.dto';
import { MerchantService } from './merchant.service';

@Controller('merchants')
@UseGuards(JwtAuthGuard)
export class MerchantController {
  constructor(private readonly service: MerchantService) {}
  @Get('contacts') contacts(@Req() req: AuthenticatedRequest) {
    return this.service.contacts(req.user.sub);
  }
  @Post(':merchantId/contact') save(
    @Req() req: AuthenticatedRequest,
    @Param('merchantId') id: string,
  ) {
    return this.service.saveContact(req.user.sub, id);
  }
  @Delete(':merchantId/contact') unsave(
    @Req() req: AuthenticatedRequest,
    @Param('merchantId') id: string,
  ) {
    return this.service.removeContact(req.user.sub, id);
  }
  @Get('feed') feed(@Req() req: AuthenticatedRequest, @Query() query: FeedDto) {
    return this.service.feed(req.user.sub, query);
  }
  @Get('offers') offers(@Req() req: AuthenticatedRequest) {
    return this.service.offers(req.user.sub);
  }
  @Get('offers/explore') exploreOffers(@Req() req: AuthenticatedRequest) {
    return this.service.offers(req.user.sub, true);
  }
  @Get('notifications') notifications(@Req() req: AuthenticatedRequest) {
    return this.service.notifications(req.user.sub);
  }
  @Post('notifications/read-all') readAll(@Req() req: AuthenticatedRequest) {
    return this.service.readNotifications(req.user.sub);
  }
  @Post('content')
  @UseInterceptors(
    FileInterceptor('media', {
      limits: { fileSize: 50 * 1024 * 1024, files: 1 },
    }),
  )
  create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ContentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.service.createContent(req.user.sub, dto, file);
  }
  @Patch('content/:id')
  @UseInterceptors(
    FileInterceptor('media', {
      limits: { fileSize: 50 * 1024 * 1024, files: 1 },
    }),
  )
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateContentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.service.updateContent(req.user.sub, id, dto, file);
  }
  @Delete('content/:id') remove(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.service.removeContent(req.user.sub, id);
  }
  @Post('aisles') aisle(
    @Req() req: AuthenticatedRequest,
    @Body() dto: AisleDto,
  ) {
    return this.service.createAisle(req.user.sub, dto);
  }
  @Delete('aisles/:id') removeAisle(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.service.removeAisle(req.user.sub, id);
  }
  @Patch('products/:id/aisle') assign(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: AssignAisleDto,
  ) {
    return this.service.assignAisle(req.user.sub, id, dto.aisleId);
  }
  @Get('products/:id/reviews/viewer') reviewViewer(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.service.reviewViewer(req.user.sub, id);
  }
  @Post('products/:id/reviews/:reviewId/vote') reviewVote(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('reviewId') reviewId: string,
    @Body() dto: ReviewVoteDto,
  ) {
    return this.service.voteProductReview(
      req.user.sub,
      id,
      reviewId,
      dto.helpful ?? null,
    );
  }
  @Post('products/:id/reviews')
  @UseInterceptors(
    FileInterceptor('media', {
      limits: { fileSize: 50 * 1024 * 1024, files: 1 },
    }),
  )
  review(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ProductReviewDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.service.review(req.user.sub, id, dto, file);
  }
}

@Controller('merchants')
export class MerchantPublicController {
  constructor(private readonly service: MerchantService) {}
  @Get('stories') stories(@Query() query: FeedDto) {
    return this.service.feed(undefined, {
      ...query,
      kind: 'STORY',
      savedOnly: 'false',
    });
  }
  @Get(':merchantId/content') content(
    @Param('merchantId') id: string,
    @Query() query: FeedDto,
  ) {
    return this.service.feed(undefined, {
      ...query,
      merchantId: id,
      savedOnly: 'false',
    });
  }
  @Get(':merchantId/aisles') aisles(@Param('merchantId') id: string) {
    return this.service.aisles(id);
  }
  @Get('products/:id/reviews') reviews(
    @Param('id') id: string,
    @Query() query: ProductReviewsQuery,
  ) {
    return this.service.reviews(id, query);
  }
}

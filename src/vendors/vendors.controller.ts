import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Patch,
  Put,
  UploadedFiles,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  FileFieldsInterceptor,
  FilesInterceptor,
} from '@nestjs/platform-express';

import { CreateVendorProductDto } from './dto/create-vendor-product.dto';
import { CreateVendorWithdrawalDto } from './dto/create-vendor-withdrawal.dto';
import { CreateVendorCategoryDto } from './dto/create-vendor-category.dto';
import { CreateProductOfferDto } from './dto/create-product-offer.dto';
import { CreateOfferDto } from './dto/create-offer.dto';
import { SaveVendorBankDto } from './dto/save-vendor-bank.dto';
import { SaveVendorProfileDto } from './dto/save-vendor-profile.dto';
import { SubmitVendorProfileDto } from './dto/submit-vendor-profile.dto';
import { UpdateStorefrontContentDto } from './dto/update-storefront-content.dto';
import { UpdateVendorProductDto } from './dto/update-vendor-product.dto';
import {
  publicVendorUploadUrl,
  removeUploadedFiles,
  vendorUploadOptions,
} from './vendor-upload.config';
import { VendorsService } from './vendors.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/guards/authenticated-request';
import {
  productUploadOptions,
  publicProductUploadUrl,
  removeProductUploads,
} from './product-upload.config';

type IdentityFiles = {
  banner?: Express.Multer.File[];
  cac?: Express.Multer.File[];
  logo?: Express.Multer.File[];
};

@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get(':userId/profile')
  findProfile(@Param('userId') userId: string) {
    return this.vendorsService.findProfile(userId);
  }

  @Get(':userId/storefront')
  findStorefront(@Param('userId') userId: string) {
    return this.vendorsService.findStorefront(userId);
  }

  @Get(':userId/products')
  findProducts(@Param('userId') userId: string) {
    return this.vendorsService.findProducts(userId);
  }

  @Get(':userId/trust-reviews')
  findTrustReviews(@Param('userId') userId: string) {
    return this.vendorsService.findTrustReviews(userId);
  }

  @Get(':userId/finance')
  @UseGuards(JwtAuthGuard)
  finance(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
  ) {
    this.requireOwner(request, userId);
    return this.vendorsService.finance(userId);
  }

  @Post(':userId/finance/withdrawals')
  @UseGuards(JwtAuthGuard)
  withdraw(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: CreateVendorWithdrawalDto,
  ) {
    this.requireOwner(request, userId);
    return this.vendorsService.requestWithdrawal(userId, dto.amount);
  }

  @Post(':userId/products')
  @UseInterceptors(FilesInterceptor('images', 5, productUploadOptions))
  async createProduct(
    @Param('userId') userId: string,
    @Body() dto: CreateVendorProductDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const images = files ?? [];
    if (images.length === 0) {
      throw new BadRequestException('Add at least one product image.');
    }

    try {
      return await this.vendorsService.createProduct(
        userId,
        dto,
        images.map(publicProductUploadUrl),
      );
    } catch (error) {
      removeProductUploads(images);
      throw error;
    }
  }

  @Post(':userId/products/:productId/offer')
  @UseGuards(JwtAuthGuard)
  createProductOffer(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Param('productId') productId: string,
    @Body() dto: CreateProductOfferDto,
  ) {
    if (request.user.sub !== userId)
      throw new ForbiddenException('You can only manage your own offers.');
    return this.vendorsService.createProductOffer(userId, productId, dto);
  }

  @Get(':userId/offers')
  @UseGuards(JwtAuthGuard)
  findOffers(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
  ) {
    if (request.user.sub !== userId)
      throw new ForbiddenException('You can only view your own offers.');
    return this.vendorsService.findOffers(userId);
  }

  @Post(':userId/offers')
  @UseGuards(JwtAuthGuard)
  createOffer(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: CreateOfferDto,
  ) {
    if (request.user.sub !== userId)
      throw new ForbiddenException('You can only manage your own offers.');
    return this.vendorsService.createOffer(userId, dto);
  }

  @Patch(':userId/products/:productId')
  @UseGuards(JwtAuthGuard)
  updateProduct(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Param('productId') productId: string,
    @Body() dto: UpdateVendorProductDto,
  ) {
    if (request.user.sub !== userId)
      throw new ForbiddenException('You can only manage your own products.');
    return this.vendorsService.updateProduct(userId, productId, dto);
  }

  @Post(':userId/products/:productId/archive')
  @UseGuards(JwtAuthGuard)
  archiveProduct(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Param('productId') productId: string,
  ) {
    if (request.user.sub !== userId)
      throw new ForbiddenException('You can only manage your own products.');
    return this.vendorsService.archiveProduct(userId, productId);
  }

  @Delete(':userId/products/:productId')
  @UseGuards(JwtAuthGuard)
  deleteProduct(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Param('productId') productId: string,
  ) {
    if (request.user.sub !== userId)
      throw new ForbiddenException('You can only manage your own products.');
    return this.vendorsService.deleteProduct(userId, productId);
  }

  @Patch(':userId/storefront')
  @UseGuards(JwtAuthGuard)
  updateStorefront(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: UpdateStorefrontContentDto,
  ) {
    if (request.user.sub !== userId)
      throw new ForbiddenException('You can only manage your own storefront.');
    return this.vendorsService.updateStorefront(userId, dto);
  }

  @Post(':userId/categories')
  @UseGuards(JwtAuthGuard)
  createCategory(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: CreateVendorCategoryDto,
  ) {
    if (request.user.sub !== userId)
      throw new ForbiddenException('You can only manage your own categories.');
    return this.vendorsService.createCategory(userId, dto);
  }

  @Delete(':userId/categories/:categoryId')
  @UseGuards(JwtAuthGuard)
  deleteCategory(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Param('categoryId') categoryId: string,
  ) {
    if (request.user.sub !== userId)
      throw new ForbiddenException('You can only manage your own categories.');
    return this.vendorsService.deleteCategory(userId, categoryId);
  }

  @Put(':userId/profile')
  saveProfile(
    @Param('userId') userId: string,
    @Body() dto: SaveVendorProfileDto,
  ) {
    return this.vendorsService.saveProfile(userId, dto);
  }

  @Post(':userId/identity')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'logo', maxCount: 1 },
        { name: 'banner', maxCount: 1 },
        { name: 'cac', maxCount: 1 },
      ],
      vendorUploadOptions,
    ),
  )
  async saveIdentity(
    @Param('userId') userId: string,
    @UploadedFiles() files: IdentityFiles,
  ) {
    const logo = files?.logo?.[0];
    const banner = files?.banner?.[0];
    const cac = files?.cac?.[0];
    if (!logo && !banner && !cac) {
      throw new BadRequestException('Select an identity image to upload.');
    }

    const uploaded = [logo, banner, cac].filter(
      Boolean,
    ) as Express.Multer.File[];
    try {
      return await this.vendorsService.saveIdentity(userId, {
        bannerUrl: banner ? publicVendorUploadUrl(banner) : undefined,
        cacUrl: cac ? publicVendorUploadUrl(cac) : undefined,
        logoUrl: logo ? publicVendorUploadUrl(logo) : undefined,
      });
    } catch (error) {
      removeUploadedFiles(uploaded);
      throw error;
    }
  }

  @Put(':userId/bank')
  saveBank(@Param('userId') userId: string, @Body() dto: SaveVendorBankDto) {
    return this.vendorsService.saveBank(userId, dto);
  }

  @Post(':userId/submit')
  submitProfile(
    @Param('userId') userId: string,
    @Body() dto: SubmitVendorProfileDto,
  ) {
    return this.vendorsService.submitProfile(userId, dto);
  }

  private requireOwner(request: AuthenticatedRequest, userId: string) {
    if (request.user.sub !== userId) {
      throw new ForbiddenException('You can only view your own finances.');
    }
  }
}

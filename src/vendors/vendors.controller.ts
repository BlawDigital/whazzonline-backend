import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import {
  FileFieldsInterceptor,
  FilesInterceptor,
} from '@nestjs/platform-express';

import { CreateVendorProductDto } from './dto/create-vendor-product.dto';
import { CreateProductOfferDto } from './dto/create-product-offer.dto';
import { SaveVendorBankDto } from './dto/save-vendor-bank.dto';
import { SaveVendorProfileDto } from './dto/save-vendor-profile.dto';
import { SubmitVendorProfileDto } from './dto/submit-vendor-profile.dto';
import {
  publicVendorUploadUrl,
  removeUploadedFiles,
  vendorUploadOptions,
} from './vendor-upload.config';
import { VendorsService } from './vendors.service';
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
  createProductOffer(
    @Param('userId') userId: string,
    @Param('productId') productId: string,
    @Body() dto: CreateProductOfferDto,
  ) {
    return this.vendorsService.createProductOffer(userId, productId, dto);
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
}

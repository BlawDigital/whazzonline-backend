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
import { FileFieldsInterceptor } from '@nestjs/platform-express';

import { SaveVendorProfileDto } from './dto/save-vendor-profile.dto';
import { SaveVendorBankDto } from './dto/save-vendor-bank.dto';
import { SubmitVendorProfileDto } from './dto/submit-vendor-profile.dto';
import {
  publicVendorUploadUrl,
  removeUploadedFiles,
  vendorUploadOptions,
} from './vendor-upload.config';
import { VendorsService } from './vendors.service';

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

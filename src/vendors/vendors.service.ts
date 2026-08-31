import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';

import { SaveVendorProfileDto } from './dto/save-vendor-profile.dto';
import { SaveVendorBankDto } from './dto/save-vendor-bank.dto';
import { SubmitVendorProfileDto } from './dto/submit-vendor-profile.dto';
import { removeVendorUploadUrl } from './vendor-upload.config';

@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireVendorUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    if (user.role !== 'VENDOR' && user.role !== 'BUSINESS') {
      throw new ForbiddenException(
        'This account cannot create a vendor profile.',
      );
    }
    return user;
  }

  async findProfile(userId: string) {
    await this.requireVendorUser(userId);
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Vendor profile not found.');
    return profile;
  }

  async saveProfile(userId: string, dto: SaveVendorProfileDto) {
    await this.requireVendorUser(userId);
    return this.prisma.vendorProfile.upsert({
      where: { userId },
      create: { ...dto, userId },
      update: {
        ...dto,
        reviewStatus: 'DRAFT',
        setupCompleted: false,
        submittedAt: null,
        termsAcceptedAt: null,
      },
    });
  }

  async saveIdentity(
    userId: string,
    uploads: { bannerUrl?: string; cacUrl?: string; logoUrl?: string },
  ) {
    await this.requireVendorUser(userId);
    const existing = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!existing) {
      throw new NotFoundException(
        'Save the vendor profile before uploading images.',
      );
    }

    const updated = await this.prisma.vendorProfile.update({
      where: { userId },
      data: {
        ...uploads,
        reviewStatus: 'DRAFT',
        setupCompleted: false,
        submittedAt: null,
        termsAcceptedAt: null,
      },
    });

    if (uploads.logoUrl && existing.logoUrl !== uploads.logoUrl) {
      removeVendorUploadUrl(existing.logoUrl);
    }
    if (uploads.bannerUrl && existing.bannerUrl !== uploads.bannerUrl) {
      removeVendorUploadUrl(existing.bannerUrl);
    }
    if (uploads.cacUrl && existing.cacUrl !== uploads.cacUrl) {
      removeVendorUploadUrl(existing.cacUrl);
    }

    return updated;
  }

  async saveBank(userId: string, dto: SaveVendorBankDto) {
    await this.requireVendorUser(userId);
    const existing = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!existing) {
      throw new NotFoundException(
        'Save the vendor profile before adding payout details.',
      );
    }
    return this.prisma.vendorProfile.update({
      where: { userId },
      data: {
        bankAccountName: dto.accountName,
        bankAccountNumber: dto.accountNumber,
        bankCode: dto.bankCode,
        bankName: dto.bankName,
        reviewStatus: 'DRAFT',
        setupCompleted: false,
        submittedAt: null,
        termsAcceptedAt: null,
      },
    });
  }

  async submitProfile(userId: string, dto: SubmitVendorProfileDto) {
    await this.requireVendorUser(userId);
    const existing = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!existing) throw new NotFoundException('Vendor profile not found.');

    const identityComplete = Boolean(
      existing.logoUrl && existing.bannerUrl && existing.cacUrl,
    );
    const bankComplete = Boolean(
      existing.bankName &&
      existing.bankCode &&
      existing.bankAccountNumber &&
      existing.bankAccountName,
    );
    if (!identityComplete || !bankComplete) {
      throw new BadRequestException(
        'Complete store identity and payout details before submitting.',
      );
    }

    const submittedAt = new Date();
    return this.prisma.vendorProfile.update({
      where: { userId },
      data: {
        reviewStatus: 'PENDING',
        sellerType: dto.sellerType,
        setupCompleted: true,
        submittedAt,
        termsAcceptedAt: submittedAt,
      },
    });
  }
}

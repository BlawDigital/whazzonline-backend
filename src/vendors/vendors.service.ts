import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';

import { SaveVendorProfileDto } from './dto/save-vendor-profile.dto';
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
      update: { ...dto, setupCompleted: false },
    });
  }

  async saveIdentity(
    userId: string,
    uploads: { bannerUrl?: string; logoUrl?: string },
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

    const logoUrl = uploads.logoUrl ?? existing.logoUrl;
    const bannerUrl = uploads.bannerUrl ?? existing.bannerUrl;
    const updated = await this.prisma.vendorProfile.update({
      where: { userId },
      data: {
        ...uploads,
        setupCompleted: Boolean(logoUrl && bannerUrl),
      },
    });

    if (uploads.logoUrl && existing.logoUrl !== uploads.logoUrl) {
      removeVendorUploadUrl(existing.logoUrl);
    }
    if (uploads.bannerUrl && existing.bannerUrl !== uploads.bannerUrl) {
      removeVendorUploadUrl(existing.bannerUrl);
    }

    return updated;
  }
}

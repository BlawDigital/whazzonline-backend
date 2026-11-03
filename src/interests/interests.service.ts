import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { INTEREST_CATALOG } from './interest-catalog';

@Injectable()
export class InterestsService {
  private catalogInitialization?: Promise<unknown>;

  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    this.catalogInitialization ??= this.prisma.interest
      .createMany({ data: [...INTEREST_CATALOG], skipDuplicates: true })
      .catch((error: unknown) => {
        this.catalogInitialization = undefined;
        throw error;
      });
    await this.catalogInitialization;
    return this.prisma.interest.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true },
    });
  }

  async findAllForUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { interests: { select: { id: true } } },
    });
    if (!user) throw new NotFoundException('User not found.');
    const selectedIds = new Set(user.interests.map((interest) => interest.id));
    return (await this.findAll()).map((interest) => ({
      ...interest,
      isSelected: selectedIds.has(interest.id),
    }));
  }
}

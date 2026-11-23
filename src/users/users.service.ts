import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  normalizePhone,
  phoneLookupCandidates,
} from '../auth/phone/normalize-phone';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async createUser(createUserDto: CreateUserDto) {
    const { email, phone } = createUserDto;
    const normalizedEmail = email?.trim().toLowerCase();
    const normalizedPhone = phone ? normalizePhone(phone) : undefined;

    if (normalizedEmail) {
      const existingEmail = await this.prisma.user.findUnique({
        where: {
          email: normalizedEmail,
        },
      });
      if (existingEmail) {
        throw new ConflictException(
          'An account with this email already exists.',
        );
      }
    }
    if (normalizedPhone) {
      const existingPhone = await this.prisma.user.findFirst({
        where: {
          phone: { in: phoneLookupCandidates(normalizedPhone) },
        },
      });
      if (existingPhone) {
        throw new ConflictException(
          'An account with this phone number already exists.',
        );
      }
    }
    const user = await this.prisma.user.create({
      data: {
        ...createUserDto,
        email: normalizedEmail,
        phone: normalizedPhone,
      },
    });
    return this.toPublicUser(user);
  }

  async findAllUsers() {
    const users = await this.prisma.user.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: { vendorProfile: { select: { setupCompleted: true } } },
    });
    return users.map((user) => this.toPublicUser(user));
  }
  async findUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id,
      },
      include: { vendorProfile: { select: { setupCompleted: true } } },
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    return this.toPublicUser(user);
  }
  async findByEmail(email: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        email: email.trim().toLowerCase(),
      },
      include: { vendorProfile: { select: { setupCompleted: true } } },
    });
    return user ? this.toPublicUser(user) : null;
  }

  async findByPhone(phone: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        phone: { in: phoneLookupCandidates(phone) },
      },
      include: { vendorProfile: { select: { setupCompleted: true } } },
    });
    return user ? this.toPublicUser(user) : null;
  }

  async updateUser(id: string, updateUserDto: UpdateUserDto) {
    await this.findUser(id);
    // A referral code is permanent, whatever the request body contains.
    const { referralCode: _locked, ...changes } = updateUserDto as typeof updateUserDto & {
      referralCode?: string;
    };
    void _locked;

    const user = await this.prisma.user.update({
      where: {
        id,
      },
      data: {
        ...changes,
        email: updateUserDto.email?.trim().toLowerCase(),
        phone: updateUserDto.phone
          ? normalizePhone(updateUserDto.phone)
          : undefined,
      },
      include: { vendorProfile: { select: { setupCompleted: true } } },
    });
    return this.toPublicUser(user);
  }
  async saveAvatar(id: string, avatarUrl: string) {
    const existing = await this.findUser(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: { avatarUrl },
      include: { vendorProfile: { select: { setupCompleted: true } } },
    });
    return {
      previousAvatarUrl: existing.avatarUrl,
      user: this.toPublicUser(user),
    };
  }
  async removeUser(id: string) {
    await this.findUser(id);
    const user = await this.prisma.user.delete({
      where: {
        id,
      },
    });
    return this.toPublicUser(user);
  }

  private toPublicUser<
    T extends {
      passwordHash: unknown;
      vendorProfile?: { setupCompleted: boolean } | null;
    },
  >(user: T) {
    const { passwordHash: _passwordHash, vendorProfile, ...publicUser } = user;
    return {
      ...publicUser,
      vendorSetupCompleted: vendorProfile?.setupCompleted ?? false,
    };
  }
}

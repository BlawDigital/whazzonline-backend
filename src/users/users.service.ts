import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "prisma/prisma.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";

@Injectable()
export class UsersService {
    constructor(private readonly prisma: PrismaService) { }

    async createUser(createUserDto: CreateUserDto) {
        const { email, phone } = createUserDto;

        if (email) {
            const existingEmail = await this.prisma.user.findUnique({
                where: {
                    email,
                },
            });
            if (existingEmail) {
                throw new ConflictException(
                    "An account with this email already exists.",
                );
            }

        }
        if (phone) {
            const existingPhone = await this.prisma.user.findUnique({
                where: {
                    phone,
                },
            });
            if (existingPhone) {
                throw new ConflictException(
                    "An account with this phone number a;ready exists.",
                );
            }
        }
        const user = await this.prisma.user.create({
            data: createUserDto,
        });
        return this.toPublicUser(user);
    }

    async findAllUsers() {
        const users = await this.prisma.user.findMany({
            orderBy: {
                createdAt: "desc",
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
            throw new NotFoundException("User not found.");
        }
        return this.toPublicUser(user);
    }
    async findByEmail(email: string) {
        const user = await this.prisma.user.findUnique({
            where: {
                email,
            },
            include: { vendorProfile: { select: { setupCompleted: true } } },
        });
        return user ? this.toPublicUser(user) : null;
    }

    async findByPhone(phone: string) {
        const user = await this.prisma.user.findUnique({
            where: {
                phone,
            },
            include: { vendorProfile: { select: { setupCompleted: true } } },
        });
        return user ? this.toPublicUser(user) : null;
    }

    async updateUser(id: string, UpdateUserDto: UpdateUserDto,) {
        await this.findUser(id);

        const user = await this.prisma.user.update({
            where: {
                id,
            },
            data: UpdateUserDto,
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
        return { previousAvatarUrl: existing.avatarUrl, user: this.toPublicUser(user) };
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

    private toPublicUser<T extends {
        passwordHash: unknown;
        vendorProfile?: { setupCompleted: boolean } | null;
    }>(user: T) {
        const { passwordHash: _passwordHash, vendorProfile, ...publicUser } = user;
        return {
            ...publicUser,
            vendorSetupCompleted: vendorProfile?.setupCompleted ?? false,
        };
    }
}

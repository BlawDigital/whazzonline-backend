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
        });
        return users.map((user) => this.toPublicUser(user));
    }
    async findUser(id: string) {
        const user = await this.prisma.user.findUnique({
            where: {
                id,
            },
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
        });
        return user ? this.toPublicUser(user) : null;
    }

    async findByPhone(phone: string) {
        const user = await this.prisma.user.findUnique({
            where: {
                phone,
            },
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
        });
        return this.toPublicUser(user);
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

    private toPublicUser<T extends { passwordHash: unknown }>(user: T) {
        const { passwordHash: _passwordHash, ...publicUser } = user;
        return publicUser;
    }
}

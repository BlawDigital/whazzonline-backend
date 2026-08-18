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
        return this.prisma.user.create({
            data: createUserDto,
        });
    }

    async findAllUsers() {
        return this.prisma.user.findMany({
            orderBy: {
                createdAt: "desc",
            },
        });
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
        return user;
    }
    async findByEmail(email: string) {
        return this.prisma.user.findUnique({
            where: {
                email,
            },
        });
    }

    async findByPhone(phone: string) {
        return this.prisma.user.findUnique({
            where: {
                phone,
            },
        });
    }

    async updateUser(id: string, UpdateUserDto: UpdateUserDto,) {
        await this.findUser(id);

        return this.prisma.user.update({
            where: {
                id,
            },
            data: UpdateUserDto,
        });
    }
    async removeUser(id: string) {
        await this.findUser(id);
        return this.prisma.user.delete({
            where: {
                id,
            },
        });
    }
}
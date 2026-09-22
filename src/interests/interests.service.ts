import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "prisma/prisma.service";

@Injectable()
export class InterestsService {
    constructor(private readonly prisma: PrismaService) { }

    async findAll() {
        return this.prisma.interest.findMany({
            orderBy: {
                name: "asc",
            },
            select: {
                id: true,
                name: true,
                slug: true,
            },
        });
    }
    
    async findAllForUser(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                interests: {
                    select: {
                        id: true,
                    },
                },
            },
        });
        if (!user) {
            throw new NotFoundException("User not found.");
        }
        const selectedIds = new Set(user.interests.map((interest) => interest.id),);


        const interest = await this.prisma.interest.findMany({
            orderBy: {
                name: "asc",
            },
            select: {
                id: true,
                name: true,
                slug: true,
            },
        });

        return interest.map((interest) => ({
            ...interest, isSelected: selectedIds.has(interest.id),
        }));
    }
}
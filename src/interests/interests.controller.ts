import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { InterestsService } from "./interests.service";
import { JwtAuthGuard } from "src/auth/guards/jwt-auth.guard";

@Controller("interests")
export class InterestsController {
    constructor(private readonly interestsService: InterestsService,) { }

    @Get()
    async findAll() {
        return this.interestsService.findAll();
    }
    @UseGuards(JwtAuthGuard)
    @Get("me")
    async findAllForUser(@Req() req: any) {

        return this.interestsService.findAllForUser(req.user.sub);
    }
}
import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { UsersService } from "./users.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";

@Controller("users")
export class UsersController {
    constructor(private readonly userService: UsersService,) { }
    @Post()
    createUser(@Body() CreateUserDto: CreateUserDto) {
        return this.userService.createUser(CreateUserDto);
    }

    @Get()
    findAllUsers() {
        return this.userService.findAllUsers();
    }

    @Get(":id")
    findUser(@Param("id") id: string) {
        return this.userService.findUser(id);
    }

    @Patch(":id")
    updateUser(@Param("id") id: string, @Body() updateUserDto: UpdateUserDto) {
        return this.userService.updateUser(id, updateUserDto,);
    }
    @Delete(":id")
    remove(@Param("id") id: string) {
        return this.userService.removeUser(id);
    }
}
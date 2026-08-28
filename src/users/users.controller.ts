import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { UsersService } from "./users.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { publicUserUploadUrl, removeUploadedFile, removeUserUploadUrl, userUploadOptions } from "./user-upload.config";

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
    @Post(":id/avatar")
    @UseInterceptors(FileInterceptor("avatar", userUploadOptions))
    async uploadAvatar(@Param("id") id: string, @UploadedFile() file?: Express.Multer.File) {
        if (!file) throw new BadRequestException("Select a profile image to upload.");
        try {
            const result = await this.userService.saveAvatar(id, publicUserUploadUrl(file));
            removeUserUploadUrl(result.previousAvatarUrl);
            return result.user;
        } catch (error) {
            removeUploadedFile(file);
            throw error;
        }
    }
    @Delete(":id")
    remove(@Param("id") id: string) {
        return this.userService.removeUser(id);
    }
}

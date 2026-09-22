import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import type { AuthenticatedRequest } from '../auth/guards/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SendMessageDto } from './dto/send-message.dto';
import { StartConversationDto } from './dto/start-conversation.dto';
import { ConversationTypingDto } from './dto/conversation-typing.dto';
import { UpdateConversationStatusDto } from './dto/update-conversation-status.dto';
import { MessagingService } from './messaging.service';
import { chatUploadOptions, publicChatUploadUrl } from './chat-upload.config';

@Controller(['buyer/conversations', 'seller/conversations'])
@UseGuards(JwtAuthGuard)
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.messaging.list(
      request.user.sub,
      request.path.startsWith('/seller/'),
    );
  }

  @Post()
  start(
    @Req() request: AuthenticatedRequest,
    @Body() dto: StartConversationDto,
  ) {
    return this.messaging.start(request.user.sub, dto.vendorId, dto);
  }

  @Get(':conversationId/messages')
  messages(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
  ) {
    return this.messaging.messages(request.user.sub, conversationId);
  }

  @Post(':conversationId/messages')
  send(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messaging.send(request.user.sub, conversationId, dto);
  }

  @Post(':conversationId/uploads')
  @UseInterceptors(FileInterceptor('file', chatUploadOptions))
  async upload(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    await this.messaging.assertParticipant(request.user.sub, conversationId);
    if (!file) throw new BadRequestException('Choose an image to upload.');
    return { url: publicChatUploadUrl(file) };
  }

  @Post(':conversationId/read')
  read(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId') id: string,
  ) {
    return this.messaging.read(request.user.sub, id);
  }

  @Patch(':conversationId/status')
  status(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
    @Body() dto: UpdateConversationStatusDto,
  ) {
    return this.messaging.updateStatus(
      request.user.sub,
      conversationId,
      dto.status,
    );
  }

  @Post(':conversationId/typing')
  typing(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId') conversationId: string,
    @Body() dto: ConversationTypingDto,
  ) {
    return this.messaging.typing(request.user.sub, conversationId, dto.typing);
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import type { AuthenticatedRequest } from '../auth/guards/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SendMessageDto } from './dto/send-message.dto';
import { StartConversationDto } from './dto/start-conversation.dto';
import { MessagingService } from './messaging.service';

@Controller('buyer/conversations')
@UseGuards(JwtAuthGuard)
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.messaging.list(request.user.sub);
  }

  @Post()
  start(
    @Req() request: AuthenticatedRequest,
    @Body() dto: StartConversationDto,
  ) {
    return this.messaging.start(request.user.sub, dto.vendorId);
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
}

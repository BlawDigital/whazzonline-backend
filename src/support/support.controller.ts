import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';

import type { AuthenticatedRequest } from '../auth/guards/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateSupportTicketDto,
  SupportListDto,
  SupportMessageDto,
  SupportStatusDto,
} from './dto/support.dto';
import { SupportService, type SupportAudience } from './support.service';
import { supportUploadOptions } from './support-upload';

abstract class SupportControllerBase {
  protected abstract readonly audience: SupportAudience;
  constructor(protected readonly support: SupportService) {}

  list(request: AuthenticatedRequest, query: SupportListDto) {
    return this.support.list(request.user.sub, query, this.audience);
  }

  detail(request: AuthenticatedRequest, ticketId: string) {
    return this.support.detail(request.user.sub, ticketId, this.audience);
  }

  send(
    request: AuthenticatedRequest,
    ticketId: string,
    dto: SupportMessageDto,
    files: Express.Multer.File[] = [],
  ) {
    return this.support.send(
      request.user.sub,
      ticketId,
      dto,
      files,
      this.audience,
    );
  }

  attachment(
    request: AuthenticatedRequest,
    ticketId: string,
    messageId: string,
    attachmentId: string,
  ) {
    return this.support.attachment(
      request.user.sub,
      ticketId,
      messageId,
      attachmentId,
      this.audience,
    );
  }
}

@Controller('seller/support')
@UseGuards(JwtAuthGuard)
export class SellerSupportController extends SupportControllerBase {
  protected readonly audience = 'seller' as const;

  @Get('contact')
  contact(@Req() request: AuthenticatedRequest) {
    return this.support.contact(request.user.sub);
  }

  @Get('tickets')
  tickets(
    @Req() request: AuthenticatedRequest,
    @Query() query: SupportListDto,
  ) {
    return this.list(request, query);
  }

  @Post('tickets')
  create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateSupportTicketDto,
  ) {
    return this.support.create(request.user.sub, dto);
  }

  @Get('tickets/:ticketId')
  ticket(
    @Req() request: AuthenticatedRequest,
    @Param('ticketId') ticketId: string,
  ) {
    return this.detail(request, ticketId);
  }

  @Post('tickets/:ticketId/messages')
  @UseInterceptors(FilesInterceptor('attachments', 3, supportUploadOptions))
  message(
    @Req() request: AuthenticatedRequest,
    @Param('ticketId') ticketId: string,
    @Body() dto: SupportMessageDto,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    return this.send(request, ticketId, dto, files);
  }

  @Get('tickets/:ticketId/messages/:messageId/attachments/:attachmentId')
  file(
    @Req() request: AuthenticatedRequest,
    @Param('ticketId') ticketId: string,
    @Param('messageId') messageId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.attachment(request, ticketId, messageId, attachmentId);
  }
}

@Controller('admin/support')
@UseGuards(JwtAuthGuard)
export class AdminSupportController extends SupportControllerBase {
  protected readonly audience = 'admin' as const;

  @Get('tickets')
  tickets(
    @Req() request: AuthenticatedRequest,
    @Query() query: SupportListDto,
  ) {
    return this.list(request, query);
  }

  @Get('tickets/:ticketId')
  ticket(
    @Req() request: AuthenticatedRequest,
    @Param('ticketId') ticketId: string,
  ) {
    return this.detail(request, ticketId);
  }

  @Post('tickets/:ticketId/messages')
  @UseInterceptors(FilesInterceptor('attachments', 3, supportUploadOptions))
  message(
    @Req() request: AuthenticatedRequest,
    @Param('ticketId') ticketId: string,
    @Body() dto: SupportMessageDto,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    return this.send(request, ticketId, dto, files);
  }

  @Patch('tickets/:ticketId/status')
  status(
    @Req() request: AuthenticatedRequest,
    @Param('ticketId') ticketId: string,
    @Body() dto: SupportStatusDto,
  ) {
    return this.support.status(request.user.sub, ticketId, dto);
  }

  @Get('tickets/:ticketId/messages/:messageId/attachments/:attachmentId')
  file(
    @Req() request: AuthenticatedRequest,
    @Param('ticketId') ticketId: string,
    @Param('messageId') messageId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.attachment(request, ticketId, messageId, attachmentId);
  }
}

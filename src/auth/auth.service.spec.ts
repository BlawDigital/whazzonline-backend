import { ConflictException, UnauthorizedException } from '@nestjs/common';

jest.mock('prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { AuthService } from './auth.service';

describe('AuthService contact credentials', () => {
  const prisma = {
    emailOtp: { update: jest.fn() },
    phoneOtp: { updateMany: jest.fn() },
    user: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const otpService = {
    consumeVerifiedEmailOtp: jest.fn(),
    sendEmailOtp: jest.fn(),
    sendPhoneOtp: jest.fn(),
    verifyEmailOtp: jest.fn(),
    verifyPhoneOtp: jest.fn(),
  };
  const jwtService = {
    signAsync: jest.fn(),
  };
  const service = new AuthService(
    prisma as never,
    otpService as never,
    jwtService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jwtService.signAsync.mockResolvedValue('signed-access-token');
  });

  it('creates merchant email accounts for connected payment and invoice workflows', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'seller-email',
      phone: null,
      email: 'seller@example.com',
      role: 'VENDOR',
      registrationType: 'SELLER',
      isActive: true,
      isVerified: true,
    });
    const result = await service.register({
      email: 'seller@example.com',
      password: 'example-password',
      registrationType: 'SELLER',
    });
    expect(result.accessToken).toBe('signed-access-token');
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: 'VENDOR',
          registrationType: 'SELLER',
        }),
      }),
    );
  }, 20000);

  it('issues a token when phone verification restores an existing user', async () => {
    otpService.verifyPhoneOtp.mockResolvedValue({
      message: 'Phone number verified successfully.',
      verified: true,
    });
    prisma.user.findFirst.mockResolvedValue({
      email: null,
      id: 'user-1',
      passwordHash: null,
      phone: '+2348012345678',
      vendorProfile: null,
    });

    const result = await service.verifyPhoneOtp('+2348012345678', '123456');

    expect(jwtService.signAsync).toHaveBeenCalledWith({
      email: null,
      phone: '+2348012345678',
      sub: 'user-1',
    });
    expect(result).toMatchObject({
      accessToken: 'signed-access-token',
      user: { id: 'user-1' },
      verified: true,
    });
  });

  it('does not send an email change code for a credential already in use', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ email: 'old@example.com', id: 'user-1' })
      .mockResolvedValueOnce({ id: 'user-2' });

    await expect(
      service.requestEmailChange('user-1', 'new@example.com'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(otpService.sendEmailOtp).not.toHaveBeenCalled();
  });

  it('verifies and persists an email change before returning the public user', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    otpService.verifyEmailOtp.mockResolvedValue('otp-1');
    prisma.user.update.mockResolvedValue({
      email: 'new@example.com',
      id: 'user-1',
      passwordHash: 'hidden',
      vendorProfile: null,
    });

    const user = await service.confirmEmailChange(
      'user-1',
      'New@Example.com',
      '123456',
    );

    expect(otpService.verifyEmailOtp).toHaveBeenCalledWith(
      'new@example.com',
      '123456',
      'EMAIL_CHANGE',
      'user-1',
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { email: 'new@example.com' },
        where: { id: 'user-1' },
      }),
    );
    expect(user).toMatchObject({ email: 'new@example.com', id: 'user-1' });
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('consumes a verified password-reset OTP before replacing the hash', async () => {
    prisma.user.findUnique.mockResolvedValue({
      email: 'member@example.com',
      id: 'user-1',
    });
    prisma.user.update.mockResolvedValue({ id: 'user-1' });

    await service.resetPassword('member@example.com', '123456', 'Valid#123');

    expect(otpService.consumeVerifiedEmailOtp).toHaveBeenCalledWith(
      'member@example.com',
      '123456',
      'PASSWORD_RESET',
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
      }),
    );
  });

  it('rejects an incorrect email password and never returns a session', async () => {
    prisma.user.findUnique.mockResolvedValue({
      email: 'member@example.com',
      id: 'user-1',
      passwordHash:
        '$2b$12$rGa.SrWmAXUGaoTzD86fUO2lnx9XzUcw.7efzHWttLL8vVYZ7.BgS',
      vendorProfile: null,
    });

    await expect(
      service.login({ email: 'MEMBER@example.com', password: 'Wrong#123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'member@example.com' } }),
    );
  });
});

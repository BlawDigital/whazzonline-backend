import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpProvider } from './otp.provider';

interface TermiiGenerateResponse {
    phone_number_other?: string;
    phone_number?: string;
    otp?: string;
    pin_id?: string;
    message?: string;
}

interface TermiiVerifyResponse {
    pinId?: string;
    verified?: string | boolean;
    msisdn?: string;
    message?: string;
}

@Injectable()
export class TermiiOtpProvider implements OtpProvider {
    constructor(private readonly config: ConfigService) { }

    private getApiKey(): string {
        const apiKey = this.config.get<string>('TERMII_API_KEY')?.trim();

        if (!apiKey) {
            throw new InternalServerErrorException(
                'TERMII_API_KEY is not configured.',
            );
        }

        return apiKey;
    }

    private getBaseUrl(): string {
        const baseUrl = this.config
            .get<string>('TERMII_BASE_URL')
            ?.trim()
            .replace(/\/+$/, '');

        if (!baseUrl) {
            throw new InternalServerErrorException(
                'TERMII_BASE_URL is not configured.',
            );
        }

        return baseUrl;
    }

    async sendOtp(phone: string): Promise<{ pinId: string }> {
        const response = await fetch(
            `${this.getBaseUrl()}/api/sms/otp/generate`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    api_key: this.getApiKey(),
                    pin_type: 'NUMERIC',
                    phone_number: phone.replace(/^\+/, ''),
                    pin_attempts: 5,
                    pin_time_to_live: 2,
                    pin_length: 6,
                }),
            },
        );

        const data = (await response.json().catch(() => ({}))) as TermiiGenerateResponse;

        console.log('TERMII STATUS:', response.status);
        console.log('TERMII RESPNSE:', data);

        if (!response.ok || !data.pin_id) {
            throw new InternalServerErrorException(
                data.message || 'Unable to send verification code.',
            );
        }

        return {
            pinId: data.pin_id,
        };
    }

    async verifyOtp(pinId: string, code: string): Promise<boolean> {
        const response = await fetch(
            `${this.getBaseUrl()}/api/sms/otp/verify`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    api_key: this.getApiKey(),
                    pin_id: pinId,
                    pin: code,
                }),
            },
        );

        const data = (await response.json().catch(() => ({}))) as TermiiVerifyResponse;

        if (!response.ok) {
            return false;
        }

        return String(data.verified).toLowerCase() === 'true';
    }
}
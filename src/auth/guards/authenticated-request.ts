import { Request } from "express";

export interface AuthenticatedRequest extends Request {
    user: {
        sub: string;
        phone: string | null;
        email: string | null;
    };
}
import { cloudinaryImageOptions } from '../storage/cloudinary-storage';
export const chatUploadOptions = cloudinaryImageOptions('chat', 1);
export const publicChatUploadUrl = (file: Express.Multer.File) => file.path;

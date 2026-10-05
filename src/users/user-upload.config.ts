import {
  cloudinaryImageOptions,
  removeCloudinaryUrl,
} from '../storage/cloudinary-storage';
export const userUploadOptions = cloudinaryImageOptions('users', 1);
export const publicUserUploadUrl = (file: Express.Multer.File) => file.path;
export const removeUploadedFile = (file: Express.Multer.File) =>
  removeCloudinaryUrl(file.path);
export const removeUserUploadUrl = removeCloudinaryUrl;

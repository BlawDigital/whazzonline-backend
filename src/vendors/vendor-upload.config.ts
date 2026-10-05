import {
  cloudinaryImageOptions,
  removeCloudinaryUrl,
} from '../storage/cloudinary-storage';
export const vendorUploadOptions = cloudinaryImageOptions('vendors', 3);
export const publicVendorUploadUrl = (file: Express.Multer.File) => file.path;
export const removeUploadedFiles = (files: Express.Multer.File[]) =>
  Promise.all(files.map((file) => removeCloudinaryUrl(file.path)));
export const removeVendorUploadUrl = removeCloudinaryUrl;

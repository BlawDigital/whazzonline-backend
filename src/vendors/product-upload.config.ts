import {
  cloudinaryImageOptions,
  removeCloudinaryUrl,
} from '../storage/cloudinary-storage';
export const productUploadOptions = cloudinaryImageOptions('products', 5, 50);
export const productMediaUploadOptions = cloudinaryImageOptions('products', 6, 50, true);
export const publicProductUploadUrl = (file: Express.Multer.File) => file.path;
export const removeProductUploads = (files: Express.Multer.File[]) =>
  Promise.all(files.map((file) => removeCloudinaryUrl(file.path)));

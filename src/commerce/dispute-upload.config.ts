import { cloudinaryImageOptions } from '../storage/cloudinary-storage';
export const disputeUploadOptions = cloudinaryImageOptions('disputes', 5);
export const publicDisputeUrl = (file: Express.Multer.File) => file.path;

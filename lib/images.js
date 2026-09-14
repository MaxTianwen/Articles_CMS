const sharp = require('sharp');
const { HttpError } = require('./validation');
function createImageService(env = process.env) {
    const cloudinary = require('cloudinary').v2;
    const configured =
        env.CLOUDINARY_CLOUD_NAME &&
        env.CLOUDINARY_API_KEY &&
        env.CLOUDINARY_API_SECRET;
    if (configured)
        cloudinary.config({
            cloud_name: env.CLOUDINARY_CLOUD_NAME,
            api_key: env.CLOUDINARY_API_KEY,
            api_secret: env.CLOUDINARY_API_SECRET,
            secure: true,
        });
    return {
        async upload(buffer) {
            if (!configured)
                throw new HttpError(
                    503,
                    'Image uploads are not configured. You can save the article without a new image.',
                );
            return new Promise((resolve, reject) => {
                cloudinary.uploader
                    .upload_stream(
                        { resource_type: 'image', folder: 'web322/articles' },
                        (error, result) => {
                            if (error)
                                return reject(
                                    new HttpError(
                                        502,
                                        'Image upload failed. Your article has not been saved.',
                                    ),
                                );
                            resolve({
                                url: result.secure_url,
                                publicId: result.public_id,
                            });
                        },
                    )
                    .end(buffer);
            });
        },
        async remove(publicId) {
            if (configured && publicId)
                await cloudinary.uploader.destroy(publicId, {
                    resource_type: 'image',
                });
        },
    };
}
async function prepareImage(file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
        throw new HttpError(400, 'Use a JPEG, PNG or WebP image.', {
            featureImage: 'Unsupported image type.',
        });
    try {
        const source = sharp(file.buffer, {
            limitInputPixels: 20000000,
            animated: false,
        });
        const metadata = await source.metadata();
        if (
            !['jpeg', 'png', 'webp'].includes(metadata.format) ||
            (metadata.pages || 1) > 1
        )
            throw new Error('Unsupported image');
        return await source
            .rotate()
            .resize({
                width: 2400,
                height: 2400,
                fit: 'inside',
                withoutEnlargement: true,
            })
            .webp({ quality: 85 })
            .toBuffer();
    } catch {
        throw new HttpError(
            400,
            'This image is invalid or too large to process.',
            {
                featureImage:
                    'Choose a valid JPEG, PNG or WebP image (up to 20 megapixels).',
            },
        );
    }
}
module.exports = { createImageService, prepareImage };

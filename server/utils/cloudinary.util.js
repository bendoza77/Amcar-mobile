const { v2: cloudinary } = require("cloudinary");

/**
 * Central image storage. Both the mobile app (base64 uploads) and the
 * website funnel their images through here so every stored reference is
 * an absolute Cloudinary URL — visible identically on phone and web, and
 * safe from Render's ephemeral disk (which wipes /uploads on redeploy).
 *
 * Config comes from either the single CLOUDINARY_URL env var
 * (cloudinary://<key>:<secret>@<cloud>) or the three discrete vars. The
 * SDK auto-reads CLOUDINARY_URL; we also honour the discrete trio.
 */
const {
    CLOUDINARY_URL,
    CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET
} = process.env;

if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
    cloudinary.config({
        cloud_name: CLOUDINARY_CLOUD_NAME,
        api_key: CLOUDINARY_API_KEY,
        api_secret: CLOUDINARY_API_SECRET,
        secure: true
    });
} else if (CLOUDINARY_URL) {
    // The SDK parses CLOUDINARY_URL from the environment on its own; just
    // make sure https URLs are returned.
    cloudinary.config({ secure: true });
}

/** True once credentials are present (mirrors email.util's pattern). */
const isConfigured = () =>
    Boolean(
        CLOUDINARY_URL ||
        (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET)
    );

/**
 * Upload raw image bytes to Cloudinary and return the absolute secure_url.
 *
 * @param {Buffer} buffer   validated image bytes (caller checks size/type)
 * @param {object} opts
 * @param {string} opts.folder     e.g. "amcar/mechanics"
 * @param {string} [opts.publicId] stable id → re-uploads overwrite (avatars)
 * @returns {Promise<string>} the https delivery URL (includes a version)
 */
const uploadImage = async (buffer, { folder, publicId } = {}) => {
    const dataUri = `data:image/jpeg;base64,${buffer.toString("base64")}`;
    const result = await cloudinary.uploader.upload(dataUri, {
        folder,
        // When a publicId is given we overwrite in place and invalidate the
        // CDN cache so the new image shows immediately (avatars). Without
        // one, Cloudinary assigns a unique id (gallery photos never clash).
        ...(publicId ? { public_id: publicId, overwrite: true, invalidate: true } : {}),
        resource_type: "image"
    });
    return result.secure_url;
};

module.exports = { cloudinary, isConfigured, uploadImage };

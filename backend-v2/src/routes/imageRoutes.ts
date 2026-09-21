import { NextFunction, Request, Response, Router } from 'express';
import { ImageController } from '../controllers/ImageController';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';
import { IpUtils } from '../utils/IpUtils';

const router = Router();
const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
const acceptedClientMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  // Some desktop editors use this generic MIME type. The controller still
  // verifies the actual image signature before anything reaches OSS.
  'application/octet-stream',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_UPLOAD_BYTES,
    files: 1,
    fields: 5,
    parts: 6,
    fieldNameSize: 100,
    fieldSize: 1024,
  },
  fileFilter: (_req, file, callback) => {
    if (!acceptedClientMimeTypes.has(file.mimetype.toLowerCase())) {
      return callback(new Error('UNSUPPORTED_UPLOAD_MIME'));
    }
    callback(null, true);
  },
});

const imageUploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // Authentication runs first, so the limit follows the admin account rather
  // than a client-controlled forwarding header.
  keyGenerator: (req) => `admin:${req.user!.id}`,
  message: { success: false, message: '上传过于频繁，请稍后再试' },
});

// 评论图片上传：面向已登录的普通用户，额度更保守
const MAX_COMMENT_IMAGE_BYTES = 2 * 1024 * 1024;
const commentImageMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const commentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_COMMENT_IMAGE_BYTES,
    files: 1,
    fields: 2,
    parts: 3,
    fieldNameSize: 100,
    fieldSize: 1024,
  },
  fileFilter: (_req, file, callback) => {
    if (!commentImageMimeTypes.has(file.mimetype.toLowerCase())) {
      return callback(new Error('UNSUPPORTED_UPLOAD_MIME'));
    }
    callback(null, true);
  },
});

const commentImageUploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `comment-user:${req.user!.id}`,
  message: { success: false, message: '上传过于频繁，请稍后再试' },
});

const parseCommentImageUpload = (req: Request, res: Response, next: NextFunction) => {
  commentUpload.single('file')(req, res, (error: unknown) => {
    if (!error) return next();

    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          message: '图片不能超过 2 MB',
        });
      }
      return res.status(400).json({ success: false, message: '上传请求格式无效' });
    }

    if (error instanceof Error && error.message === 'UNSUPPORTED_UPLOAD_MIME') {
      return res.status(415).json({
        success: false,
        message: '仅支持 JPEG、PNG、GIF 或 WebP 图片',
      });
    }

    next(error);
  });
};

const imageReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => IpUtils.getClientIp(req),
  message: 'Too many image requests',
});

const parseImageUpload = (req: Request, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, (error: unknown) => {
    if (!error) return next();

    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          message: '图片不能超过 5 MiB',
        });
      }
      return res.status(400).json({ success: false, message: '上传请求格式无效' });
    }

    if (error instanceof Error && error.message === 'UNSUPPORTED_UPLOAD_MIME') {
      return res.status(415).json({
        success: false,
        message: '仅支持 JPEG、PNG、GIF 或 WebP 图片',
      });
    }

    next(error);
  });
};

// 上传接口，接收第三方编辑器(PicGo/Typora)的文件上传
// 编辑器需在请求头中配置 Authorization: Bearer <管理员 JWT>
router.post(
  '/upload',
  AuthMiddleware.requireAdmin,
  imageUploadLimiter,
  parseImageUpload,
  ImageController.uploadImage,
);

// 评论图片上传，登录用户可用；存储与校验复用 uploadImage（OSS 优先，魔数检测）
router.post(
  '/comment-upload',
  AuthMiddleware.requireAuth,
  commentImageUploadLimiter,
  parseCommentImageUpload,
  ImageController.uploadImage,
);

// Must precede the token and legacy wildcard routes below.
router.get('/uploads/:fileName', imageReadLimiter, ImageController.getUploadedImage);
router.get('/:imageToken', imageReadLimiter, ImageController.handleGet0);
router.get('/:docId/:imageToken', imageReadLimiter, ImageController.handleGet0); // 兼容旧接口

export default router;

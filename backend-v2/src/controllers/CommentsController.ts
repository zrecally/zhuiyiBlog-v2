import { CommentActionController } from './comments/CommentActionController';
import { CommentReadController } from './comments/CommentReadController';
import { CommentWriteController } from './comments/CommentWriteController';

export class CommentsController {
  public static handleGet0 = CommentReadController.handleGet0;
  public static handleStreamComments = CommentReadController.handleStreamComments;
  public static handlePost1 = CommentWriteController.handlePost1;
  public static handleDeleteComment = CommentWriteController.handleDeleteComment;
  public static handleGet2 = CommentReadController.handleGet2;
  public static handlePost3 = CommentActionController.handlePost3;
}

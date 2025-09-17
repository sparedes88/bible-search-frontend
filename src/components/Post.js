import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from '../firebase';
import postAnalyticsService from '../services/postAnalytics';
import './Post.css';

const Post = ({ post, churchId, currentUser, showFullContent = false }) => {
  const navigate = useNavigate();
  const [isLiked, setIsLiked] = useState(false);
  const [comment, setComment] = useState('');
  const [showComments, setShowComments] = useState(false);

  useEffect(() => {
    // Check if the current user has liked this post
    if (currentUser && post.likedBy) {
      setIsLiked(post.likedBy.includes(currentUser.uid));
    }

    // Log a view when the post is rendered
    // Only log views when showing the full post to avoid duplicate counts
    if (showFullContent && currentUser) {
      postAnalyticsService.logView(churchId, post.id, currentUser.uid);
    } else if (showFullContent) {
      postAnalyticsService.logView(churchId, post.id);
    }
  }, [post, churchId, currentUser, showFullContent]);

  const handlePostClick = () => {
    if (!showFullContent) {
      navigate(`/church/${churchId}/posts/${post.id}`);
    }
  };

  const handleLikeClick = async (e) => {
    e.stopPropagation();
    
    if (!currentUser) {
      // Redirect to login if not logged in
      navigate('/login');
      return;
    }

    try {
      const postRef = doc(db, `churches/${churchId}/posts/${post.id}`);
      
      if (isLiked) {
        // Unlike post
        await updateDoc(postRef, {
          likedBy: arrayRemove(currentUser.uid),
          likeCount: post.likeCount - 1
        });
        setIsLiked(false);
      } else {
        // Like post
        await updateDoc(postRef, {
          likedBy: arrayUnion(currentUser.uid),
          likeCount: (post.likeCount || 0) + 1
        });
        setIsLiked(true);
        
        // Log the like analytics
        postAnalyticsService.logLike(churchId, post.id, currentUser.uid);
      }
    } catch (error) {
      console.error('Error updating like status:', error);
    }
  };

  const handleCommentSubmit = async (e) => {
    e.preventDefault();
    
    if (!comment.trim() || !currentUser) return;
    
    try {
      const postRef = doc(db, `churches/${churchId}/posts/${post.id}`);
      const newComment = {
        id: Date.now().toString(),
        text: comment,
        createdAt: new Date(),
        author: {
          id: currentUser.uid,
          name: currentUser.displayName || 'Anonymous',
          photoURL: currentUser.photoURL
        }
      };
      
      await updateDoc(postRef, {
        comments: arrayUnion(newComment),
        commentCount: (post.commentCount || 0) + 1
      });
      
      // Log the comment analytics
      postAnalyticsService.logComment(
        churchId, 
        post.id, 
        currentUser.uid, 
        newComment.id
      );
      
      setComment('');
    } catch (error) {
      console.error('Error adding comment:', error);
    }
  };

  const handleShare = async (platform) => {
    try {
      const shareUrl = `${window.location.origin}/church/${churchId}/posts/${post.id}`;
      
      let shareWindow;
      switch (platform) {
        case 'facebook':
          shareWindow = window.open(
            `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
            'facebook-share',
            'width=580,height=296'
          );
          break;
        case 'twitter':
          shareWindow = window.open(
            `https://twitter.com/intent/tweet?text=${encodeURIComponent(post.title || 'Check out this post!')}&url=${encodeURIComponent(shareUrl)}`,
            'twitter-share',
            'width=550,height=235'
          );
          break;
        case 'whatsapp':
          shareWindow = window.open(
            `https://wa.me/?text=${encodeURIComponent(`${post.title || 'Check out this post!'} ${shareUrl}`)}`,
            'whatsapp-share',
            'width=580,height=296'
          );
          break;
        case 'email':
          window.location.href = `mailto:?subject=${encodeURIComponent(post.title || 'Check out this post!')}&body=${encodeURIComponent(`I thought you might be interested in this: ${shareUrl}`)}`;
          break;
        default:
          // Copy to clipboard
          await navigator.clipboard.writeText(shareUrl);
          alert('Link copied to clipboard!');
          break;
      }
      
      // Log the share analytics
      postAnalyticsService.logShare(
        churchId, 
        post.id, 
        currentUser?.uid || null, 
        platform
      );
      
      if (shareWindow) {
        shareWindow.focus();
      }
    } catch (error) {
      console.error('Error sharing post:', error);
    }
  };

  const formatDate = (date) => {
    if (!date) return '';
    const postDate = date instanceof Date ? date : date.toDate();
    return postDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className={`post-card ${showFullContent ? 'full-post' : ''}`} onClick={handlePostClick}>
      {post.imageUrl && (
        <div className="post-image-container">
          <img 
            src={post.imageUrl} 
            alt={post.title || 'Post'} 
            className="post-image"
          />
        </div>
      )}
      
      <div className="post-content">
        <h2 className="post-title">{post.title}</h2>
        <div className="post-meta">
          <span className="post-date">{formatDate(post.createdAt)}</span>
          {post.author && (
            <span className="post-author">
              by {post.author.name || 'Anonymous'}
            </span>
          )}
        </div>
        
        <div className="post-body">
          {showFullContent ? (
            <div dangerouslySetInnerHTML={{ __html: post.content }} />
          ) : (
            <p>
              {post.content && post.content.length > 150
                ? `${post.content.slice(0, 150)}...`
                : post.content}
            </p>
          )}
        </div>
        
        <div className="post-stats">
          <div className={`post-stat ${isLiked ? 'liked' : ''}`} onClick={handleLikeClick}>
            <span className="stat-icon">👍</span>
            <span className="stat-count">{post.likeCount || 0}</span>
          </div>
          
          <div className="post-stat" onClick={() => setShowComments(!showComments)}>
            <span className="stat-icon">💬</span>
            <span className="stat-count">{post.commentCount || 0}</span>
          </div>
          
          <div className="post-stat share-dropdown">
            <span className="stat-icon">🔄</span>
            <span className="stat-count">{post.shareCount || 0}</span>
            <div className="share-options">
              <button onClick={() => handleShare('facebook')}>Facebook</button>
              <button onClick={() => handleShare('twitter')}>Twitter</button>
              <button onClick={() => handleShare('whatsapp')}>WhatsApp</button>
              <button onClick={() => handleShare('email')}>Email</button>
              <button onClick={() => handleShare('copy')}>Copy Link</button>
            </div>
          </div>
          
          {showFullContent && (
            <div className="post-views">
              <span className="stat-icon">👁️</span>
              <span className="stat-count">{post.viewCount || 0} views</span>
            </div>
          )}
        </div>
        
        {showFullContent && showComments && (
          <div className="post-comments">
            <h3>Comments ({post.comments?.length || 0})</h3>
            
            {currentUser ? (
              <form className="comment-form" onSubmit={handleCommentSubmit}>
                <textarea
                  placeholder="Add a comment..."
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  required
                />
                <button type="submit">Post</button>
              </form>
            ) : (
              <p className="login-prompt">
                <a href="/login">Log in</a> to leave a comment
              </p>
            )}
            
            <div className="comments-list">
              {post.comments?.length > 0 ? (
                post.comments.map((comment) => (
                  <div key={comment.id} className="comment">
                    <div className="comment-header">
                      {comment.author?.photoURL ? (
                        <img 
                          src={comment.author.photoURL} 
                          alt={comment.author.name} 
                          className="comment-avatar" 
                        />
                      ) : (
                        <div className="comment-avatar-placeholder">
                          {comment.author?.name?.charAt(0).toUpperCase() || 'A'}
                        </div>
                      )}
                      <div className="comment-author-info">
                        <span className="comment-author-name">
                          {comment.author?.name || 'Anonymous'}
                        </span>
                        <span className="comment-date">
                          {formatDate(comment.createdAt)}
                        </span>
                      </div>
                    </div>
                    <div className="comment-text">{comment.text}</div>
                  </div>
                ))
              ) : (
                <p className="no-comments">No comments yet. Be the first to comment!</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Post;
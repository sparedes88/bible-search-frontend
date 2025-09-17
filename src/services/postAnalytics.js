import { db } from '../firebase';
import { 
  doc, 
  setDoc, 
  updateDoc, 
  increment, 
  arrayUnion, 
  serverTimestamp, 
  collection,
  query,
  where,
  orderBy,
  getDocs
} from 'firebase/firestore';

/**
 * Service for tracking and analyzing post interactions
 */
const postAnalyticsService = {
  /**
   * Log a view on a post
   * @param {string} churchId - The ID of the church
   * @param {string} postId - The ID of the post
   * @param {string} userId - Optional user ID of the viewer
   * @returns {Promise}
   */
  async logView(churchId, postId, userId = null) {
    try {
      // Update post view count
      const postRef = doc(db, `churches/${churchId}/posts/${postId}`);
      await updateDoc(postRef, {
        viewCount: increment(1)
      });
      
      // Add detailed analytics record
      const analyticsRef = doc(collection(db, `churches/${churchId}/posts/${postId}/analytics`));
      await setDoc(analyticsRef, {
        type: 'view',
        timestamp: serverTimestamp(),
        userId: userId,
        deviceInfo: {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language
        }
      });
      
      return true;
    } catch (error) {
      console.error('Error logging post view:', error);
      return false;
    }
  },
  
  /**
   * Log a like on a post
   * @param {string} churchId - The ID of the church
   * @param {string} postId - The ID of the post
   * @param {string} userId - User ID of the person who liked the post
   * @returns {Promise}
   */
  async logLike(churchId, postId, userId) {
    try {
      const analyticsRef = doc(collection(db, `churches/${churchId}/posts/${postId}/analytics`));
      await setDoc(analyticsRef, {
        type: 'like',
        timestamp: serverTimestamp(),
        userId: userId,
        deviceInfo: {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language
        }
      });
      
      return true;
    } catch (error) {
      console.error('Error logging post like:', error);
      return false;
    }
  },
  
  /**
   * Log a comment on a post
   * @param {string} churchId - The ID of the church
   * @param {string} postId - The ID of the post
   * @param {string} userId - User ID of the commenter
   * @param {string} commentId - ID of the comment
   * @returns {Promise}
   */
  async logComment(churchId, postId, userId, commentId) {
    try {
      const analyticsRef = doc(collection(db, `churches/${churchId}/posts/${postId}/analytics`));
      await setDoc(analyticsRef, {
        type: 'comment',
        timestamp: serverTimestamp(),
        userId: userId,
        commentId: commentId,
        deviceInfo: {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language
        }
      });
      
      return true;
    } catch (error) {
      console.error('Error logging post comment:', error);
      return false;
    }
  },
  
  /**
   * Log a share of a post
   * @param {string} churchId - The ID of the church
   * @param {string} postId - The ID of the post
   * @param {string} userId - Optional user ID of the sharer
   * @param {string} platform - The platform the post was shared on
   * @returns {Promise}
   */
  async logShare(churchId, postId, userId, platform) {
    try {
      // Update post share count
      const postRef = doc(db, `churches/${churchId}/posts/${postId}`);
      await updateDoc(postRef, {
        shareCount: increment(1)
      });
      
      // Add detailed analytics record
      const analyticsRef = doc(collection(db, `churches/${churchId}/posts/${postId}/analytics`));
      await setDoc(analyticsRef, {
        type: 'share',
        timestamp: serverTimestamp(),
        userId: userId,
        platform: platform,
        deviceInfo: {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language
        }
      });
      
      return true;
    } catch (error) {
      console.error('Error logging post share:', error);
      return false;
    }
  },
  
  /**
   * Get analytics data for a specific post
   * @param {string} churchId - The ID of the church
   * @param {string} postId - The ID of the post
   * @returns {Promise<Array>} - Analytics data
   */
  async getPostAnalytics(churchId, postId) {
    try {
      const analyticsQuery = query(
        collection(db, `churches/${churchId}/posts/${postId}/analytics`),
        orderBy('timestamp', 'desc')
      );
      
      const snapshot = await getDocs(analyticsQuery);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error fetching post analytics:', error);
      return [];
    }
  },
  
  /**
   * Get aggregated analytics data for all posts in a church
   * @param {string} churchId - The ID of the church
   * @param {number} days - Number of days to look back (default: 30)
   * @returns {Promise<Object>} - Aggregated analytics data
   */
  async getChurchPostsAnalytics(churchId, days = 30) {
    try {
      // Get all posts for the church
      const postsQuery = query(
        collection(db, `churches/${churchId}/posts`)
      );
      
      const postsSnapshot = await getDocs(postsQuery);
      const posts = postsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      // Calculate the date for the lookback period
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - days);
      
      // Gather analytics for each post
      const analyticsPromises = posts.map(async post => {
        const postId = post.id;
        
        // Get analytics records for this post
        const analyticsQuery = query(
          collection(db, `churches/${churchId}/posts/${postId}/analytics`),
          where('timestamp', '>=', lookbackDate),
          orderBy('timestamp', 'desc')
        );
        
        const analyticsSnapshot = await getDocs(analyticsQuery);
        const analytics = analyticsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        
        // Count by type
        const views = analytics.filter(a => a.type === 'view').length;
        const likes = analytics.filter(a => a.type === 'like').length;
        const comments = analytics.filter(a => a.type === 'comment').length;
        const shares = analytics.filter(a => a.type === 'share').length;
        
        // Count unique users
        const uniqueViewers = new Set(
          analytics
            .filter(a => a.type === 'view' && a.userId)
            .map(a => a.userId)
        ).size;
        
        // Engagement rate (likes + comments + shares) / views
        const engagementRate = views > 0 
          ? ((likes + comments + shares) / views) * 100 
          : 0;
        
        return {
          postId,
          title: post.title,
          createdAt: post.createdAt,
          metrics: {
            views,
            likes,
            comments,
            shares,
            uniqueViewers,
            engagementRate
          },
          rawAnalytics: analytics
        };
      });
      
      const analyticsResults = await Promise.all(analyticsPromises);
      
      // Calculate daily metrics for the period
      const dailyMetrics = {};
      
      analyticsResults.forEach(postAnalytics => {
        postAnalytics.rawAnalytics.forEach(record => {
          if (record.timestamp) {
            // Convert server timestamp to js date
            const date = record.timestamp.toDate ? 
              record.timestamp.toDate() : new Date(record.timestamp);
            
            const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
            
            if (!dailyMetrics[dateStr]) {
              dailyMetrics[dateStr] = {
                views: 0,
                likes: 0,
                comments: 0,
                shares: 0
              };
            }
            
            if (record.type === 'view') dailyMetrics[dateStr].views++;
            if (record.type === 'like') dailyMetrics[dateStr].likes++;
            if (record.type === 'comment') dailyMetrics[dateStr].comments++;
            if (record.type === 'share') dailyMetrics[dateStr].shares++;
          }
        });
      });
      
      // Convert to array for charting
      const dailyMetricsArray = Object.keys(dailyMetrics).map(date => ({
        date,
        ...dailyMetrics[date]
      })).sort((a, b) => a.date.localeCompare(b.date));
      
      // Calculate totals
      const totalViews = analyticsResults.reduce((sum, post) => sum + post.metrics.views, 0);
      const totalLikes = analyticsResults.reduce((sum, post) => sum + post.metrics.likes, 0);
      const totalComments = analyticsResults.reduce((sum, post) => sum + post.metrics.comments, 0);
      const totalShares = analyticsResults.reduce((sum, post) => sum + post.metrics.shares, 0);
      
      // Sort posts by various metrics
      const topPostsByViews = [...analyticsResults].sort((a, b) => b.metrics.views - a.metrics.views);
      const topPostsByEngagement = [...analyticsResults].sort((a, b) => b.metrics.engagementRate - a.metrics.engagementRate);
      
      return {
        totalMetrics: {
          views: totalViews,
          likes: totalLikes,
          comments: totalComments,
          shares: totalShares,
          postsCount: posts.length,
          averageViewsPerPost: posts.length > 0 ? totalViews / posts.length : 0,
          averageEngagementRate: totalViews > 0 
            ? ((totalLikes + totalComments + totalShares) / totalViews) * 100 
            : 0
        },
        dailyMetrics: dailyMetricsArray,
        postAnalytics: analyticsResults,
        topPosts: {
          byViews: topPostsByViews.slice(0, 5),
          byEngagement: topPostsByEngagement.slice(0, 5)
        }
      };
    } catch (error) {
      console.error('Error fetching church posts analytics:', error);
      return {
        totalMetrics: {
          views: 0,
          likes: 0,
          comments: 0,
          shares: 0,
          postsCount: 0,
          averageViewsPerPost: 0,
          averageEngagementRate: 0
        },
        dailyMetrics: [],
        postAnalytics: [],
        topPosts: {
          byViews: [],
          byEngagement: []
        }
      };
    }
  }
};

export default postAnalyticsService;
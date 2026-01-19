import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, getDocs, doc, getDoc, where, orderBy, limit, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler } from 'chart.js';
import './BusinessIntelligence.css';

// Register ChartJS components
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler);

const BusinessIntelligence = ({ churchId }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [posts, setPosts] = useState([]);
  const [analytics, setAnalytics] = useState({});
  const [timeRange, setTimeRange] = useState('month'); // week, month, quarter, year
  const [selectedMetric, setSelectedMetric] = useState('views');
  const [growthMetrics, setGrowthMetrics] = useState({});
  const [dateLabels, setDateLabels] = useState([]);

  useEffect(() => {
    fetchPostsData();
  }, [churchId]);

  useEffect(() => {
    if (posts.length > 0) {
      processAnalytics();
    }
  }, [posts, timeRange]);

  const fetchPostsData = async () => {
    setLoading(true);
    try {
      const postsRef = collection(db, `churches/${churchId}/posts`);
      const q = query(postsRef, orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      const postsData = [];
      
      for (const docSnap of querySnapshot.docs) {
        const postData = { id: docSnap.id, ...docSnap.data() };
        
        // Fetch analytics for this post
        const analyticsRef = collection(db, `churches/${churchId}/posts/${docSnap.id}/analytics`);
        const analyticsSnapshot = await getDocs(analyticsRef);
        
        const analyticsData = analyticsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          date: doc.data().date?.toDate() || new Date()
        }));
        
        postData.analytics = analyticsData;
        postsData.push(postData);
      }
      
      setPosts(postsData);
      setLoading(false);
    } catch (err) {
      console.error("Error fetching posts data:", err);
      setError("Failed to load posts data. Please try again later.");
      setLoading(false);
    }
  };

  const processAnalytics = () => {
    if (!posts.length) return;
    
    // Calculate date range based on timeRange selection
    const endDate = new Date();
    let startDate = new Date();
    
    switch(timeRange) {
      case 'week':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(endDate.getMonth() - 1);
        break;
      case 'quarter':
        startDate.setMonth(endDate.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(endDate.getFullYear() - 1);
        break;
      default:
        startDate.setMonth(endDate.getMonth() - 1);
    }
    
    // Generate date labels for the chart
    const labels = generateDateLabels(startDate, endDate, timeRange);
    setDateLabels(labels);
    
    // Initialize data structure for analytics
    const metrics = {
      views: Array(labels.length).fill(0),
      likes: Array(labels.length).fill(0),
      shares: Array(labels.length).fill(0),
      comments: Array(labels.length).fill(0),
      engagement: Array(labels.length).fill(0)
    };
    
    // Initialize data for growth metrics
    const growth = {
      views: { current: 0, previous: 0 },
      likes: { current: 0, previous: 0 },
      shares: { current: 0, previous: 0 },
      comments: { current: 0, previous: 0 },
      engagement: { current: 0, previous: 0 },
      postCount: { current: 0, previous: 0 }
    };
    
    // Count posts in current and previous period
    const midPoint = new Date((startDate.getTime() + endDate.getTime()) / 2);
    
    posts.forEach(post => {
      const postDate = post.createdAt?.toDate() || new Date();
      
      if (postDate >= startDate && postDate <= endDate) {
        growth.postCount.current++;
      } else if (postDate >= new Date(startDate.getTime() - (endDate.getTime() - startDate.getTime())) && postDate < startDate) {
        growth.postCount.previous++;
      }
      
      // Process analytics entries for each post
      post.analytics?.forEach(entry => {
        const entryDate = entry.date instanceof Date ? entry.date : new Date(entry.date);
        
        // Categorize metrics into current or previous period
        if (entryDate >= startDate && entryDate <= endDate) {
          growth.views.current += entry.views || 0;
          growth.likes.current += entry.likes || 0;
          growth.shares.current += entry.shares || 0;
          growth.comments.current += entry.comments || 0;
          growth.engagement.current += (entry.likes || 0) + (entry.shares || 0) + (entry.comments || 0);
          
          // Add to the appropriate day in the metrics arrays
          const dayIndex = findDateIndex(entryDate, startDate, endDate, labels);
          if (dayIndex !== -1) {
            metrics.views[dayIndex] += entry.views || 0;
            metrics.likes[dayIndex] += entry.likes || 0;
            metrics.shares[dayIndex] += entry.shares || 0;
            metrics.comments[dayIndex] += entry.comments || 0;
            metrics.engagement[dayIndex] += (entry.likes || 0) + (entry.shares || 0) + (entry.comments || 0);
          }
        } else if (entryDate >= new Date(startDate.getTime() - (endDate.getTime() - startDate.getTime())) && entryDate < startDate) {
          growth.views.previous += entry.views || 0;
          growth.likes.previous += entry.likes || 0;
          growth.shares.previous += entry.shares || 0;
          growth.comments.previous += entry.comments || 0;
          growth.engagement.previous += (entry.likes || 0) + (entry.shares || 0) + (entry.comments || 0);
        }
      });
    });
    
    // Calculate growth percentages
    const calculateGrowth = (current, previous) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous) * 100;
    };
    
    const growthPercentages = {
      views: calculateGrowth(growth.views.current, growth.views.previous),
      likes: calculateGrowth(growth.likes.current, growth.likes.previous),
      shares: calculateGrowth(growth.shares.current, growth.shares.previous),
      comments: calculateGrowth(growth.comments.current, growth.comments.previous),
      engagement: calculateGrowth(growth.engagement.current, growth.engagement.previous),
      postCount: calculateGrowth(growth.postCount.current, growth.postCount.previous)
    };
    
    setAnalytics(metrics);
    setGrowthMetrics({
      raw: growth,
      percentages: growthPercentages
    });
  };

  const generateDateLabels = (start, end, range) => {
    const labels = [];
    const current = new Date(start);
    
    switch(range) {
      case 'week':
        while (current <= end) {
          labels.push(current.toLocaleDateString('en-US', { weekday: 'short' }));
          current.setDate(current.getDate() + 1);
        }
        break;
      case 'month':
        while (current <= end) {
          labels.push(current.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
          current.setDate(current.getDate() + 2); // Every 2 days for month view
        }
        break;
      case 'quarter':
        while (current <= end) {
          labels.push(current.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
          current.setDate(current.getDate() + 7); // Weekly for quarter view
        }
        break;
      case 'year':
        while (current <= end) {
          labels.push(current.toLocaleDateString('en-US', { month: 'short' }));
          current.setMonth(current.getMonth() + 1);
        }
        break;
      default:
        while (current <= end) {
          labels.push(current.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
          current.setDate(current.getDate() + 2);
        }
    }
    
    return labels;
  };

  const findDateIndex = (date, start, end, labels) => {
    const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    const daysPassed = Math.ceil((date - start) / (1000 * 60 * 60 * 24));
    
    // Calculate the appropriate index based on the time range
    let index;
    switch(timeRange) {
      case 'week':
        index = daysPassed;
        break;
      case 'month':
        index = Math.floor(daysPassed / 2);
        break;
      case 'quarter':
        index = Math.floor(daysPassed / 7);
        break;
      case 'year':
        const monthsPassed = (date.getMonth() - start.getMonth()) + 
          (12 * (date.getFullYear() - start.getFullYear()));
        index = monthsPassed;
        break;
      default:
        index = Math.floor(daysPassed / 2);
    }
    
    // Ensure index is within bounds
    if (index >= 0 && index < labels.length) {
      return index;
    }
    
    return -1;
  };

  // Chart data for the selected metric
  const chartData = {
    labels: dateLabels,
    datasets: [
      {
        label: selectedMetric.charAt(0).toUpperCase() + selectedMetric.slice(1),
        data: analytics[selectedMetric] || [],
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        tension: 0.4,
        fill: true
      }
    ]
  };

  // Post distribution by engagement
  const postEngagementData = {
    labels: ['Low', 'Medium', 'High'],
    datasets: [
      {
        label: 'Post Engagement',
        data: [
          posts.filter(p => getPostEngagementLevel(p) === 'low').length,
          posts.filter(p => getPostEngagementLevel(p) === 'medium').length,
          posts.filter(p => getPostEngagementLevel(p) === 'high').length
        ],
        backgroundColor: [
          'rgba(255, 99, 132, 0.2)',
          'rgba(255, 206, 86, 0.2)',
          'rgba(75, 192, 192, 0.2)',
        ],
        borderColor: [
          'rgba(255, 99, 132, 1)',
          'rgba(255, 206, 86, 1)',
          'rgba(75, 192, 192, 1)',
        ],
        borderWidth: 1,
      },
    ],
  };

  // Top performing posts
  const getTopPosts = (count = 5) => {
    return [...posts].sort((a, b) => {
      const aEngagement = getTotalEngagement(a);
      const bEngagement = getTotalEngagement(b);
      return bEngagement - aEngagement;
    }).slice(0, count);
  };

  const getTotalEngagement = (post) => {
    return post.analytics?.reduce((total, entry) => {
      return total + (entry.likes || 0) + (entry.comments || 0) + (entry.shares || 0);
    }, 0) || 0;
  };

  const getPostEngagementLevel = (post) => {
    const engagement = getTotalEngagement(post);
    if (engagement >= 50) return 'high';
    if (engagement >= 20) return 'medium';
    return 'low';
  };

  // Helper function to format numbers
  const formatNumber = (num) => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  };

  // Format growth as a string with sign
  const formatGrowth = (value) => {
    if (value > 0) {
      return `+${value.toFixed(1)}%`;
    } else if (value < 0) {
      return `${value.toFixed(1)}%`;
    }
    return '0%';
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Loading analytics data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <h2>Error</h2>
        <p>{error}</p>
        <button onClick={fetchPostsData}>Try Again</button>
      </div>
    );
  }

  return (
    <div className="bi-dashboard-container">
      <div className="dashboard-header">
        <div className="header-left">
          <button className="back-button" onClick={() => navigate(-1)}>
            <span>←</span> Back
          </button>
          <h1>Post Analytics Dashboard</h1>
        </div>
        <div className="header-actions">
          <button className="refresh-btn" onClick={fetchPostsData}>
            <span>⟳</span> Refresh Data
          </button>
          <select 
            value={timeRange} 
            onChange={(e) => setTimeRange(e.target.value)}
            className="time-range-select"
          >
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
            <option value="quarter">Last 90 Days</option>
            <option value="year">Last 12 Months</option>
          </select>
        </div>
      </div>

      <div className="dashboard-metrics">
        <div className="metric-card">
          <div className="metric-icon visitors">
            <span>👁️</span>
          </div>
          <div className="metric-content">
            <div className="metric-value">
              {formatNumber(growthMetrics.raw?.views.current || 0)}
              <span className={`growth ${growthMetrics.percentages?.views >= 0 ? 'positive' : 'negative'}`}>
                {formatGrowth(growthMetrics.percentages?.views || 0)}
              </span>
            </div>
            <div className="metric-label">Total Views</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon retention">
            <span>👍</span>
          </div>
          <div className="metric-content">
            <div className="metric-value">
              {formatNumber(growthMetrics.raw?.likes.current || 0)}
              <span className={`growth ${growthMetrics.percentages?.likes >= 0 ? 'positive' : 'negative'}`}>
                {formatGrowth(growthMetrics.percentages?.likes || 0)}
              </span>
            </div>
            <div className="metric-label">Total Likes</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon members">
            <span>💬</span>
          </div>
          <div className="metric-content">
            <div className="metric-value">
              {formatNumber(growthMetrics.raw?.comments.current || 0)}
              <span className={`growth ${growthMetrics.percentages?.comments >= 0 ? 'positive' : 'negative'}`}>
                {formatGrowth(growthMetrics.percentages?.comments || 0)}
              </span>
            </div>
            <div className="metric-label">Total Comments</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon conversion">
            <span>🔄</span>
          </div>
          <div className="metric-content">
            <div className="metric-value">
              {formatNumber(growthMetrics.raw?.shares.current || 0)}
              <span className={`growth ${growthMetrics.percentages?.shares >= 0 ? 'positive' : 'negative'}`}>
                {formatGrowth(growthMetrics.percentages?.shares || 0)}
              </span>
            </div>
            <div className="metric-label">Total Shares</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon local">
            <span>📝</span>
          </div>
          <div className="metric-content">
            <div className="metric-value">
              {formatNumber(growthMetrics.raw?.postCount.current || 0)}
              <span className={`growth ${growthMetrics.percentages?.postCount >= 0 ? 'positive' : 'negative'}`}>
                {formatGrowth(growthMetrics.percentages?.postCount || 0)}
              </span>
            </div>
            <div className="metric-label">Total Posts</div>
          </div>
        </div>
      </div>

      <div className="dashboard-main">
        <div className="dashboard-section">
          <div className="section-header">
            <h2>Growth Analysis</h2>
            <div className="section-filters">
              <select 
                value={selectedMetric} 
                onChange={(e) => setSelectedMetric(e.target.value)}
              >
                <option value="views">Views</option>
                <option value="likes">Likes</option>
                <option value="comments">Comments</option>
                <option value="shares">Shares</option>
                <option value="engagement">Overall Engagement</option>
              </select>
            </div>
          </div>
          <div className="visitor-stats-grid">
            <div className="visitor-chart">
              <h3>{selectedMetric.charAt(0).toUpperCase() + selectedMetric.slice(1)} Over Time</h3>
              <div className="chart-container">
                <Line data={chartData} options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  scales: {
                    y: {
                      beginAtZero: true
                    }
                  },
                  plugins: {
                    tooltip: {
                      callbacks: {
                        label: function(context) {
                          return `${context.dataset.label}: ${context.parsed.y}`;
                        }
                      }
                    }
                  }
                }} />
              </div>
            </div>
            <div className="visitor-chart">
              <h3>Post Engagement Distribution</h3>
              <div className="doughnut-container">
                <Doughnut data={postEngagementData} options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      position: 'bottom',
                    }
                  }
                }} />
              </div>
            </div>
            <div className="visitor-stats">
              <h3>Top Performing Posts</h3>
              <div className="top-posts-grid">
                {getTopPosts(5).map((post, index) => (
                  <div key={post.id} className="top-post-card">
                    <div className="rank">{index + 1}</div>
                    <div className="post-info">
                      <h4>{post.title || 'Untitled Post'}</h4>
                      <p className="post-date">
                        {post.createdAt?.toDate().toLocaleDateString('en-US', { 
                          year: 'numeric', month: 'short', day: 'numeric' 
                        }) || 'Unknown Date'}
                      </p>
                      <div className="post-stats">
                        <span className="stat"><span className="icon">👁️</span> {formatNumber(post.analytics?.reduce((sum, item) => sum + (item.views || 0), 0) || 0)}</span>
                        <span className="stat"><span className="icon">👍</span> {formatNumber(post.analytics?.reduce((sum, item) => sum + (item.likes || 0), 0) || 0)}</span>
                        <span className="stat"><span className="icon">💬</span> {formatNumber(post.analytics?.reduce((sum, item) => sum + (item.comments || 0), 0) || 0)}</span>
                        <span className="stat"><span className="icon">🔄</span> {formatNumber(post.analytics?.reduce((sum, item) => sum + (item.shares || 0), 0) || 0)}</span>
                      </div>
                    </div>
                    <div className={`engagement-badge ${getPostEngagementLevel(post)}`}>
                      {getPostEngagementLevel(post).charAt(0).toUpperCase() + getPostEngagementLevel(post).slice(1)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="dashboard-section ai-section">
          <div className="section-header">
            <h2>Content Performance Insights</h2>
            <div className="section-actions">
              <button>Generate AI Recommendations</button>
            </div>
          </div>
          <div className="ai-placeholder">
            <h3>Want content strategy recommendations?</h3>
            <p>
              Our AI can analyze your post performance data and provide actionable insights to improve engagement.
              Click the "Generate AI Recommendations" button to get started.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BusinessIntelligence;
import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { db, storage } from '../firebase';
import { 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  getDocs, 
  query, 
  orderBy, 
  where,
  serverTimestamp,
  getDoc
} from 'firebase/firestore';
import { 
  ref, 
  uploadBytes, 
  getDownloadURL, 
  deleteObject 
} from 'firebase/storage';
import { FaPlus, FaEdit, FaTrash, FaImage, FaFacebook, FaTwitter, FaInstagram, FaYoutube, FaCalendarAlt, FaClock, FaKey, FaWhatsapp, FaLinkedin, FaTiktok, FaDownload, FaThumbsUp, FaShare, FaEye, FaCalendarWeek, FaFilter, FaLock, FaArrowLeft } from 'react-icons/fa';
import { toast } from 'react-toastify';
import ChurchHeader from './ChurchHeader';
import './SocialMedia.css';
import { useAuth } from '../contexts/AuthContext'; // Import the auth context

// Default image for social media posts
const DEFAULT_MEDIA_IMAGE = '/img/social-media-default.jpg';
// Fallback to this if the default image doesn't exist
const FALLBACK_MEDIA_IMAGE = 'https://via.placeholder.com/600x400?text=Social+Media+Post';

const SocialMedia = () => {
  const { id } = useParams();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [currentPost, setCurrentPost] = useState(null);
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    platforms: [],
    scheduledDate: '',
    scheduledTime: '',
    status: 'draft',
    category: [],
    ministry: [],
    postStatus: [],
    postingDate: '',
    recordingDate: '',
    publishDate: '',
    analytics: {
      likes: 0,
      shares: 0,
      views: 0
    }
  });
  const [mediaPreview, setMediaPreview] = useState(null);
  const [mediaFile, setMediaFile] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPlatform, setFilterPlatform] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterMinistry, setFilterMinistry] = useState('all');
  const [dateFilterType, setDateFilterType] = useState('none');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortByDate, setSortByDate] = useState(false);
  const [newTag, setNewTag] = useState({ category: '', ministry: '', postStatus: '' });
  const fileInputRef = useRef(null);

  // Use the auth context to get user information
  const { user, isAdmin, isGlobalAdmin } = useAuth();

  const [dateRange, setDateRange] = useState({
    startDate: '',
    endDate: ''
  });
  const [showSchedule, setShowSchedule] = useState(true);
  const [scheduleDateType, setScheduleDateType] = useState('recordingDate');

  const statusOptions = [
    { value: 'draft', label: 'Draft', color: '#6B7280' },
    { value: 'scheduled', label: 'Scheduled', color: '#F59E0B' },
    { value: 'published', label: 'Published', color: '#10B981' },
    { value: 'create', label: 'Create', color: '#8B5CF6' },
    { value: 'failed', label: 'Failed', color: '#EF4444' }
  ];

  const platformOptions = [
    { value: 'facebook', label: 'Facebook', icon: <FaFacebook /> },
    { value: 'twitter', label: 'Twitter', icon: <FaTwitter /> },
    { value: 'instagram', label: 'Instagram', icon: <FaInstagram /> },
    { value: 'youtube', label: 'YouTube', icon: <FaYoutube /> },
    { value: 'whatsapp', label: 'WhatsApp', icon: <FaWhatsapp /> },
    { value: 'linkedin', label: 'LinkedIn', icon: <FaLinkedin /> },
    { value: 'tiktok', label: 'TikTok', icon: <FaTiktok /> }
  ];

  useEffect(() => {
    fetchPosts();
  }, [id]);

  const fetchPosts = async () => {
    try {
      setLoading(true);
      const postsRef = collection(db, `churches/${id}/socialMedia`);
      const q = query(postsRef, orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      const postsData = [];
      querySnapshot.forEach((doc) => {
        postsData.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      setPosts(postsData);
    } catch (error) {
      console.error('Error fetching social media posts:', error);
      toast.error('Failed to load social media posts');
    } finally {
      setLoading(false);
    }
  };

  const getToday = () => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  };

  const getNextWeek = () => {
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    return nextWeek.toISOString().split('T')[0];
  };

  const getNextTwoWeeks = () => {
    const nextTwoWeeks = new Date();
    nextTwoWeeks.setDate(nextTwoWeeks.getDate() + 14);
    return nextTwoWeeks.toISOString().split('T')[0];
  };

  const getNextMonth = () => {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    return nextMonth.toISOString().split('T')[0];
  };

  const getNextQuarter = () => {
    const nextQuarter = new Date();
    nextQuarter.setMonth(nextQuarter.getMonth() + 3);
    return nextQuarter.toISOString().split('T')[0];
  };

  const dateRangeOptions = [
    { label: 'This Week', start: getToday, end: getNextWeek },
    { label: 'Next 2 Weeks', start: getToday, end: getNextTwoWeeks },
    { label: 'Next Month', start: getToday, end: getNextMonth },
    { label: 'Next Quarter', start: getToday, end: getNextQuarter },
  ];

  const handlePresetDateRange = (option) => {
    setDateRange({
      startDate: option.start(),
      endDate: option.end()
    });
  };

  useEffect(() => {
    setDateRange({
      startDate: getToday(),
      endDate: getNextWeek()
    });
  }, []);

  const handleDateRangeChange = (e) => {
    const { name, value } = e.target;
    setDateRange(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const getScheduledPosts = () => {
    if (!dateRange.startDate || !dateRange.endDate) return [];
    
    const startDate = new Date(dateRange.startDate);
    startDate.setHours(0, 0, 0, 0); // Set to beginning of day
    
    const endDate = new Date(dateRange.endDate);
    endDate.setHours(23, 59, 59, 999); // Set to end of day
    
    return posts.filter(post => {
      // Use the selected date type for filtering
      if (scheduleDateType === 'scheduledDate' && post.scheduledDate) {
        const postDate = new Date(post.scheduledDate + 'T00:00:00');
        return postDate >= startDate && postDate <= endDate;
      }
      
      if (scheduleDateType === 'publishDate' && post.publishDate) {
        const publishDate = new Date(post.publishDate + 'T00:00:00');
        return publishDate >= startDate && publishDate <= endDate;
      }
      
      if (scheduleDateType === 'recordingDate' && post.recordingDate) {
        const recordDate = new Date(post.recordingDate + 'T00:00:00');
        return recordDate >= startDate && recordDate <= endDate;
      }
      
      if (scheduleDateType === 'postingDate' && post.postingDate) {
        const postingDate = new Date(post.postingDate + 'T00:00:00');
        return postingDate >= startDate && postingDate <= endDate;
      }
      
      return false;
    }).sort((a, b) => {
      // Use the selected date type for sorting
      const dateA = new Date(a[scheduleDateType] || '2099-12-31' + 'T00:00:00');
      const dateB = new Date(b[scheduleDateType] || '2099-12-31' + 'T00:00:00');
      
      return dateA - dateB;
    });
  };

  const scheduledPosts = getScheduledPosts();

  const formatDate = (dateString) => {
    // Create a date using specific time to avoid timezone issues
    const date = new Date(dateString + 'T12:00:00');
    const options = { weekday: 'short', month: 'short', day: 'numeric' };
    return date.toLocaleDateString(undefined, options);
  };

  const getDateForDisplay = (dateString) => {
    if (!dateString) return null;
    
    // Create date at noon to avoid timezone issues
    const date = new Date(dateString + 'T12:00:00');
    return date.toISOString().split('T')[0]; // Format as YYYY-MM-DD
  };

  const groupPostsByDate = (posts) => {
    const grouped = {};
    
    posts.forEach(post => {
      // Use the selected date type for grouping
      const dateToUse = post[scheduleDateType];
      
      if (!dateToUse) return;
      
      // Ensure consistent date formatting for grouping
      const dateForGrouping = getDateForDisplay(dateToUse);
      
      if (!grouped[dateForGrouping]) {
        grouped[dateForGrouping] = [];
      }
      grouped[dateForGrouping].push(post);
    });
    
    return grouped;
  };

  const groupedScheduledPosts = groupPostsByDate(scheduledPosts);

  const isPublishing = (post) => {
    return !post.scheduledDate && post.publishDate;
  };

  const getPostDisplayTime = (post) => {
    if (post.scheduledTime) return post.scheduledTime;
    return isPublishing(post) ? 'Publishing' : '00:00';
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handlePlatformChange = (platform) => {
    if (formData.platforms.includes(platform)) {
      setFormData(prev => ({
        ...prev,
        platforms: prev.platforms.filter(p => p !== platform)
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        platforms: [...prev.platforms, platform]
      }));
    }
  };

  const handleMediaChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setMediaFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setMediaPreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const resetForm = () => {
    setFormData({
      title: '',
      content: '',
      platforms: [],
      scheduledDate: '',
      scheduledTime: '',
      status: 'draft',
      category: [],
      ministry: [],
      postStatus: [],
      postingDate: '',
      recordingDate: '',
      publishDate: '',
      analytics: {
        likes: 0,
        shares: 0,
        views: 0
      }
    });
    setMediaPreview(null);
    setMediaFile(null);
    setCurrentPost(null);
  };

  const openModal = (post = null) => {
    if (post) {
      setCurrentPost(post);
      setFormData({
        title: post.title || '',
        content: post.content || '',
        platforms: post.platforms || [],
        scheduledDate: post.scheduledDate || '',
        scheduledTime: post.scheduledTime || '',
        status: post.status || 'draft',
        category: post.category || [],
        ministry: post.ministry || [],
        postStatus: post.postStatus || [],
        postingDate: post.postingDate || '',
        recordingDate: post.recordingDate || '',
        publishDate: post.publishDate || '',
        analytics: post.analytics || {
          likes: 0,
          shares: 0,
          views: 0
        }
      });
      setMediaPreview(post.mediaUrl || null);
    } else {
      resetForm();
    }
    setShowModal(true);
  };

  const validateForm = () => {
    if (!formData.title.trim()) {
      toast.error('Title is required');
      return false;
    }
    if (!formData.content.trim()) {
      toast.error('Content is required');
      return false;
    }
    if (formData.platforms.length === 0) {
      toast.error('At least one platform must be selected');
      return false;
    }
    if (formData.status === 'scheduled' && (!formData.scheduledDate || !formData.scheduledTime)) {
      toast.error('Scheduled date and time are required for scheduled posts');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    try {
      setLoading(true);
      
      let mediaUrl = currentPost?.mediaUrl || null;
      
      if (mediaFile) {
        try {
          if (currentPost?.mediaUrl) {
            const oldMediaRef = ref(storage, currentPost.mediaUrl);
            try {
              await deleteObject(oldMediaRef);
            } catch (error) {
              console.error('Error deleting old media:', error);
            }
          }
          
          const storageRef = ref(storage, `coursecategories/${id}/socialMedia/${Date.now()}_${mediaFile.name}`);
          const metadata = {
            contentType: mediaFile.type,
            customMetadata: {
              'uploadedBy': 'socialMediaManager',
              'churchId': id
            }
          };
          
          const uploadTask = await uploadBytes(storageRef, mediaFile, metadata);
          console.log('Upload successful:', uploadTask);
          
          mediaUrl = await getDownloadURL(storageRef);
          console.log('Media URL obtained:', mediaUrl);
        } catch (uploadError) {
          console.error('Error during media upload:', uploadError);
          toast.error(`Media upload failed: ${uploadError.message}. Post will be saved without media.`);
          mediaUrl = null;
        }
      }
      
      const postData = {
        title: formData.title,
        content: formData.content,
        platforms: formData.platforms,
        scheduledDate: formData.scheduledDate,
        scheduledTime: formData.scheduledTime,
        status: formData.status,
        category: formData.category || [],
        ministry: formData.ministry || [],
        postStatus: formData.postStatus || [],
        postingDate: formData.postingDate,
        recordingDate: formData.recordingDate,
        publishDate: formData.publishDate,
        analytics: formData.analytics || {
          likes: 0,
          shares: 0,
          views: 0
        },
        mediaUrl,
        updatedAt: serverTimestamp()
      };
      
      ['category', 'ministry', 'postStatus'].forEach(field => {
        if (!Array.isArray(postData[field])) {
          postData[field] = [];
        }
      });
      
      if (currentPost) {
        await updateDoc(doc(db, `churches/${id}/socialMedia`, currentPost.id), postData);
        toast.success('Social media post updated successfully');
      } else {
        postData.createdAt = serverTimestamp();
        await addDoc(collection(db, `churches/${id}/socialMedia`), postData);
        toast.success('Social media post created successfully');
      }
      
      setShowModal(false);
      resetForm();
      fetchPosts();
    } catch (error) {
      console.error('Error saving social media post:', error);
      toast.error(`Failed to save social media post: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (postId) => {
    if (window.confirm('Are you sure you want to delete this social media post?')) {
      try {
        setLoading(true);
        
        const postRef = doc(db, `churches/${id}/socialMedia`, postId);
        const postSnap = await getDoc(postRef);
        
        if (postSnap.exists() && postSnap.data().mediaUrl) {
          const mediaRef = ref(storage, postSnap.data().mediaUrl);
          try {
            await deleteObject(mediaRef);
          } catch (error) {
            console.error('Error deleting media:', error);
          }
        }
        
        await deleteDoc(postRef);
        toast.success('Social media post deleted successfully');
        fetchPosts();
      } catch (error) {
        console.error('Error deleting social media post:', error);
        toast.error('Failed to delete social media post');
      } finally {
        setLoading(false);
      }
    }
  };

  const handleAddTag = (tagType) => {
    const tagValue = newTag[tagType].trim();
    if (!tagValue) return;
    
    if (!formData[tagType].includes(tagValue)) {
      setFormData(prev => ({
        ...prev,
        [tagType]: [...prev[tagType], tagValue]
      }));
    }
    setNewTag(prev => ({...prev, [tagType]: ''}));
  };

  const handleRemoveTag = (tagType, tag) => {
    setFormData(prev => ({
      ...prev,
      [tagType]: prev[tagType].filter(t => t !== tag)
    }));
  };

  const handleTagInputChange = (e) => {
    const { name, value } = e.target;
    setNewTag(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleAnalyticsChange = (e) => {
    const { name, value } = e.target;
    const numValue = value === '' ? 0 : parseInt(value, 10);
    
    setFormData(prev => ({
      ...prev,
      analytics: {
        ...prev.analytics,
        [name]: isNaN(numValue) ? 0 : numValue
      }
    }));
  };

  const getUniqueTags = (field) => {
    const allTags = posts.reduce((acc, post) => {
      if (post[field] && Array.isArray(post[field])) {
        return [...acc, ...post[field]];
      }
      return acc;
    }, []);
    return [...new Set(allTags)];
  };

  const uniqueCategories = getUniqueTags('category');
  const uniqueMinistries = getUniqueTags('ministry');
  const uniquePostStatuses = getUniqueTags('postStatus');

  const getFilteredAndSortedPosts = () => {
    let result = posts.filter(post => {
      if (filterStatus !== 'all' && post.status !== filterStatus) return false;
      if (filterPlatform !== 'all' && !post.platforms.includes(filterPlatform)) return false;
      if (filterCategory !== 'all' && !post.category.includes(filterCategory)) return false;
      if (filterMinistry !== 'all' && !post.ministry.includes(filterMinistry)) return false;
      
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const titleMatch = post.title?.toLowerCase().includes(searchLower);
        const contentMatch = post.content?.toLowerCase().includes(searchLower);
        const categoryMatch = post.category?.some(cat => cat.toLowerCase().includes(searchLower));
        const ministryMatch = post.ministry?.some(min => min.toLowerCase().includes(searchLower));
        const platformMatch = post.platforms?.some(platform => {
          const platformLabel = platformOptions.find(opt => opt.value === platform)?.label;
          return platformLabel?.toLowerCase().includes(searchLower);
        });
        
        if (!(titleMatch || contentMatch || categoryMatch || ministryMatch || platformMatch)) {
          return false;
        }
      }
      
      return true;
    });
    
    if (dateFilterType !== 'none') {
      const today = new Date();
      
      result = result.filter(post => post[dateFilterType] && post[dateFilterType].trim() !== '');
      
      result = result.sort((a, b) => {
        const dateA = new Date(a[dateFilterType]);
        const dateB = new Date(b[dateFilterType]);
        
        if (sortByDate) {
          const diffA = Math.abs(today - dateA) / (1000 * 60 * 60 * 24);
          const diffB = Math.abs(today - dateB) / (1000 * 60 * 60 * 24);
          return diffA - diffB;
        } else {
          return dateA - dateB;
        }
      });
    }
    
    return result;
  };

  const filteredPosts = getFilteredAndSortedPosts();

  // Enhanced function to generate a stable color class based on post properties
  const getColorClass = (post) => {
    // If the post has platforms, use the first platform for coloring
    if (post.platforms && post.platforms.length > 0) {
      return `platform-${post.platforms[0]}`;
    }
    
    // For posts without platforms, use a stable hash based on ID
    if (post.id) {
      // Simple modulo hash that will be consistent between renders
      const numericHash = post.id.split('').reduce((acc, char, i) => {
        return acc + char.charCodeAt(0) * (i + 1);
      }, 0);
      
      const colorNumber = (numericHash % 12) + 1;
      return `color-${colorNumber}`;
    }
    
    // Fallback to a consistent default
    return 'color-1';
  };

  const dateTypeOptions = [
    { value: 'recordingDate', label: 'Recorded' },
    { value: 'postingDate', label: 'Posted' },
    { value: 'publishDate', label: 'Publishing' },
    { value: 'scheduledDate', label: 'Scheduled' }
  ];

  return (
    <div className="social-media-container">
      <ChurchHeader id={id} />
      
      <div className="back-button-container">
        <Link to={`/church/${id}/mi-organizacion`} className="back-button">
          <FaArrowLeft /> Back to Mi Organización
        </Link>
      </div>
      
      {!user ? (
        <div className="loading-container">
          <p>Loading user data...</p>
        </div>
      ) : !isAdmin() ? (
        <div className="permission-denied">
          <div className="permission-icon">
            <FaLock size={48} />
          </div>
          <h2>Access Restricted</h2>
          <p>You need to be an admin to access the Social Media Manager.</p>
          <p>Please contact your church administrator for access.</p>
          <Link to={`/church/${id}/dashboard`} className="back-button">
            Return to Dashboard
          </Link>
        </div>
      ) : (
        <>
          <div className="page-header">
            <div className="header-content">
              <h1>Social Media Manager</h1>
              <p>Schedule and manage social media posts across multiple platforms</p>
            </div>
            
            <div className="header-actions">
              <Link to={`/church/${id}/social-media-accounts`} className="secondary-button">
                <FaKey /> Manage Account Access
              </Link>
              <button className="create-button" onClick={() => openModal()}>
                <FaPlus /> Create Post
              </button>
            </div>
          </div>
          
          <div className="schedule-section">
            <div className="schedule-header">
              <div className="schedule-title">
                <h2>
                  <FaCalendarWeek /> Upcoming Schedule
                  <span className="schedule-count">{scheduledPosts.length}</span>
                </h2>
                <button 
                  className="toggle-schedule-button"
                  onClick={() => setShowSchedule(!showSchedule)}
                >
                  {showSchedule ? 'Hide' : 'Show'}
                </button>
              </div>
              
              <div className="date-range-filter">
                <div className="date-filter-types">
                  <label>View by:</label>
                  <div className="date-type-toggle">
                    {dateTypeOptions.map(option => (
                      <button
                        key={option.value}
                        type="button"
                        className={`date-type-btn ${scheduleDateType === option.value ? 'active' : ''}`}
                        onClick={() => setScheduleDateType(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                
                <div className="date-inputs-container">
                  <div className="date-range-input">
                    <label>From:</label>
                    <input
                      type="date"
                      name="startDate"
                      value={dateRange.startDate}
                      onChange={handleDateRangeChange}
                    />
                  </div>
                  
                  <div className="date-range-input">
                    <label>To:</label>
                    <input
                      type="date"
                      name="endDate"
                      value={dateRange.endDate}
                      onChange={handleDateRangeChange}
                    />
                  </div>
                </div>
                
                <div className="date-range-presets">
                  {dateRangeOptions.map((option, index) => (
                    <button 
                      key={index}
                      className="date-range-preset-btn"
                      onClick={() => handlePresetDateRange(option)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            
            {showSchedule && (
              <div className="schedule-content">
                {scheduledPosts.length === 0 ? (
                  <div className="empty-schedule">
                    <p>No posts scheduled or publishing for this date range.</p>
                  </div>
                ) : (
                  <div className="schedule-timeline">
                    {Object.keys(groupedScheduledPosts).sort().map(date => (
                      <div key={date} className="schedule-day">
                        <div className="schedule-date">{formatDate(date)}</div>
                        <div className="schedule-posts">
                          {groupedScheduledPosts[date].map(post => (
                            <div 
                              key={post.id} 
                              className={`schedule-post ${isPublishing(post) ? 'publishing' : ''} platform-${post.platforms[0] || 'default'}`}
                              onClick={() => openModal(post)}
                            >
                              <div className="schedule-time">
                                {getPostDisplayTime(post)}
                              </div>
                              <div className="schedule-post-content">
                                <div className="schedule-post-title">
                                  {post.title}
                                  {isPublishing(post) && <span className="publishing-badge">Publishing</span>}
                                </div>
                                <div className="schedule-platforms">
                                  {post.platforms.map(platform => {
                                    const platformOption = platformOptions.find(opt => opt.value === platform);
                                    return platformOption ? (
                                      <span key={platform} className={`platform-icon platform-${platform}`}>
                                        {platformOption.icon}
                                      </span>
                                    ) : null;
                                  })}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          
          {loading ? (
            <div className="loading">Loading...</div>
          ) : filteredPosts.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📱</div>
              <h3>No Social Media Posts Found</h3>
              <p>Create your first post by clicking the "Create Post" button above.</p>
            </div>
          ) : (
            <div className="posts-grid">
              {filteredPosts.map(post => (
                <div key={post.id} className={`post-card status-${post.status}`}>
                  {post.mediaUrl ? (
                    <div className={`post-media media-with-image ${getColorClass(post)}`}>
                      <div className="media-overlay"></div>
                      <img 
                        src={post.mediaUrl} 
                        alt={post.title}
                        onError={(e) => {
                          e.target.onerror = null; 
                          e.target.src = FALLBACK_MEDIA_IMAGE;
                        }} 
                      />
                      <a 
                        href={post.mediaUrl} 
                        download 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="media-download-button"
                      >
                        <FaDownload /> Download
                      </a>
                    </div>
                  ) : (
                    <div className={`post-media default-media ${getColorClass(post)}`}>
                      <div className="media-placeholder">
                        {post.platforms && post.platforms.length > 0 ? (
                          <>
                            {(() => {
                              const platform = post.platforms[0];
                              const PlatformIcon = platformOptions.find(p => p.value === platform)?.icon;
                              return PlatformIcon ? PlatformIcon : <FaImage />
                            })()}
                          </>
                        ) : (
                          <FaImage />
                        )}
                      </div>
                    </div>
                  )}
                  
                  <div className="post-content">
                    <h3>{post.title}</h3>
                    <p>{post.content}</p>
                    
                    <div className="post-platforms">
                      {post.platforms.map(platform => {
                        const platformOption = platformOptions.find(opt => opt.value === platform);
                        return (
                          <span key={platform} className={`platform-badge platform-${platform}`}>
                            {platformOption?.icon} {platformOption?.label}
                          </span>
                        );
                      })}
                    </div>
                    
                    <div className="post-meta">
                      <div className="post-status">
                        <span className={`status-badge status-${post.status}`}>
                          {statusOptions.find(opt => opt.value === post.status)?.label || post.status}
                        </span>
                      </div>
                      
                      {post.scheduledDate && (
                        <div className="post-schedule">
                          <FaCalendarAlt /> {post.scheduledDate}
                          {post.scheduledTime && <><FaClock /> {post.scheduledTime}</>}
                        </div>
                      )}
                    </div>

                    {post.analytics && (
                      <div className="post-analytics">
                        <div className="analytics-item">
                          <FaThumbsUp /> <span>{post.analytics.likes || 0}</span> Likes
                        </div>
                        <div className="analytics-item">
                          <FaShare /> <span>{post.analytics.shares || 0}</span> Shares
                        </div>
                        <div className="analytics-item">
                          <FaEye /> <span>{post.analytics.views || 0}</span> Views
                        </div>
                      </div>
                    )}

                    {(post.recordingDate || post.postingDate || post.publishDate) && (
                      <div className="post-dates">
                        {post.recordingDate && (
                          <div className="date-item">
                            <span className="date-label">Recorded:</span> {post.recordingDate}
                          </div>
                        )}
                        {post.postingDate && (
                          <div className="date-item">
                            <span className="date-label">Posted:</span> {post.postingDate}
                          </div>
                        )}
                        {post.publishDate && (
                          <div className="date-item">
                            <span className="date-label">Publishing:</span> {post.publishDate}
                          </div>
                        )}
                      </div>
                    )}
                    
                    <div className="post-tags">
                      {post.category && post.category.map(tag => (
                        <span key={`cat-${tag}`} className="tag-badge category-tag">{tag}</span>
                      ))}
                      
                      {post.ministry && post.ministry.map(tag => (
                        <span key={`min-${tag}`} className="tag-badge ministry-tag">{tag}</span>
                      ))}
                      
                      {post.postStatus && post.postStatus.map(tag => (
                        <span key={`status-${tag}`} className="tag-badge post-status-tag">{tag}</span>
                      ))}
                    </div>
                  </div>
                  
                  <div className="post-actions">
                    <button className="edit-button" onClick={() => openModal(post)}>
                      <FaEdit /> Edit
                    </button>
                    <button className="delete-button" onClick={() => handleDelete(post.id)}>
                      <FaTrash /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          
          {showModal && (
            <div className="modal-overlay">
              <div className="modal-content">
                <div className="modal-header">
                  <h2>{currentPost ? 'Edit Social Media Post' : 'Create Social Media Post'}</h2>
                  <button className="close-button" onClick={() => setShowModal(false)}>×</button>
                </div>
                
                <form onSubmit={handleSubmit}>
                  <div className="form-group">
                    <label>Title *</label>
                    <input
                      type="text"
                      name="title"
                      value={formData.title}
                      onChange={handleInputChange}
                      placeholder="Enter post title"
                      required
                    />
                  </div>
                  
                  <div className="form-group">
                    <label>Content *</label>
                    <textarea
                      name="content"
                      value={formData.content}
                      onChange={handleInputChange}
                      placeholder="Enter post content"
                      rows={4}
                      required
                    />
                  </div>
                  
                  <div className="form-group">
                    <label>Platforms *</label>
                    <div className="platform-options">
                      {platformOptions.map(platform => (
                        <button
                          key={platform.value}
                          type="button"
                          className={`platform-option ${formData.platforms.includes(platform.value) ? 'selected' : ''}`}
                          onClick={() => handlePlatformChange(platform.value)}
                        >
                          {platform.icon} {platform.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  <div className="form-row">
                    <div className="form-group">
                      <label>Status</label>
                      <select
                        name="status"
                        value={formData.status}
                        onChange={handleInputChange}
                      >
                        {statusOptions.map(option => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    
                    {formData.status === 'scheduled' && (
                      <>
                        <div className="form-group">
                          <label>Date</label>
                          <input
                            type="date"
                            name="scheduledDate"
                            value={formData.scheduledDate}
                            onChange={handleInputChange}
                          />
                        </div>
                        
                        <div className="form-group">
                          <label>Time</label>
                          <input
                            type="time"
                            name="scheduledTime"
                            value={formData.scheduledTime}
                            onChange={handleInputChange}
                          />
                        </div>
                      </>
                    )}
                  </div>
                  
                  <div className="form-group">
                    <label>Media</label>
                    <div className="media-upload">
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleMediaChange}
                        accept="*/*"
                        style={{ display: 'none' }}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current.click()}
                        className="upload-button"
                      >
                        <FaImage /> {mediaPreview ? 'Change Media' : 'Upload Media'}
                      </button>
                      
                      {mediaPreview ? (
                        <div className="media-preview">
                          <img 
                            src={mediaPreview} 
                            alt="Preview" 
                            onError={(e) => {
                              e.target.onerror = null; 
                              e.target.src = FALLBACK_MEDIA_IMAGE;
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setMediaPreview(null);
                              setMediaFile(null);
                            }}
                            className="remove-media"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <div className="media-preview default-preview">
                          <img 
                            src={DEFAULT_MEDIA_IMAGE} 
                            alt="Default preview" 
                            onError={(e) => {
                              e.target.onerror = null; 
                              e.target.src = FALLBACK_MEDIA_IMAGE;
                            }}
                          />
                          <span className="default-preview-text">Default image will be used</span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="form-section">
                    <h3 className="form-section-title">Date Information</h3>
                    
                    <div className="form-row">
                      <div className="form-group">
                        <label>Recording Date</label>
                        <input
                          type="date"
                          name="recordingDate"
                          value={formData.recordingDate}
                          onChange={handleInputChange}
                          placeholder="Date content was recorded"
                        />
                      </div>
                      
                      <div className="form-group">
                        <label>Posting Date</label>
                        <input
                          type="date"
                          name="postingDate"
                          value={formData.postingDate}
                          onChange={handleInputChange}
                          placeholder="Date content was posted"
                        />
                      </div>
                      
                      <div className="form-group">
                        <label>Publish Date</label>
                        <input
                          type="date"
                          name="publishDate"
                          value={formData.publishDate}
                          onChange={handleInputChange}
                          placeholder="Date content should be published"
                        />
                      </div>
                    </div>
                  </div>
                  
                  <div className="form-group">
                    <label>Categories</label>
                    <div className="tag-input-container">
                      <div className="tag-input-wrapper">
                        <input
                          type="text"
                          name="category"
                          value={newTag.category}
                          onChange={handleTagInputChange}
                          placeholder="Add a category"
                          className="tag-input"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddTag('category')}
                          className="add-tag-button"
                        >
                          Add
                        </button>
                      </div>
                      
                      {uniqueCategories.length > 0 && (
                        <div className="existing-tags">
                          <label className="existing-tags-label">Existing categories:</label>
                          <div className="existing-tags-list">
                            {uniqueCategories.map(tag => (
                              <button
                                key={tag}
                                type="button"
                                className={`existing-tag ${formData.category.includes(tag) ? 'selected' : ''}`}
                                onClick={() => {
                                  if (formData.category.includes(tag)) {
                                    handleRemoveTag('category', tag);
                                  } else {
                                    setFormData(prev => ({
                                      ...prev,
                                      category: [...prev.category, tag]
                                    }));
                                  }
                                }}
                              >
                                {tag}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      <div className="selected-tags">
                        {formData.category.map(tag => (
                          <div key={tag} className="selected-tag">
                            <span>{tag}</span>
                            <button 
                              type="button" 
                              onClick={() => handleRemoveTag('category', tag)}
                              className="remove-tag-button"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  <div className="form-group">
                    <label>Ministries</label>
                    <div className="tag-input-container">
                      <div className="tag-input-wrapper">
                        <input
                          type="text"
                          name="ministry"
                          value={newTag.ministry}
                          onChange={handleTagInputChange}
                          placeholder="Add a ministry"
                          className="tag-input"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddTag('ministry')}
                          className="add-tag-button"
                        >
                          Add
                        </button>
                      </div>
                      
                      {uniqueMinistries.length > 0 && (
                        <div className="existing-tags">
                          <label className="existing-tags-label">Existing ministries:</label>
                          <div className="existing-tags-list">
                            {uniqueMinistries.map(tag => (
                              <button
                                key={tag}
                                type="button"
                                className={`existing-tag ${formData.ministry.includes(tag) ? 'selected' : ''}`}
                                onClick={() => {
                                  if (formData.ministry.includes(tag)) {
                                    handleRemoveTag('ministry', tag);
                                  } else {
                                    setFormData(prev => ({
                                      ...prev,
                                      ministry: [...prev.ministry, tag]
                                    }));
                                  }
                                }}
                              >
                                {tag}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      <div className="selected-tags">
                        {formData.ministry.map(tag => (
                          <div key={tag} className="selected-tag">
                            <span>{tag}</span>
                            <button 
                              type="button" 
                              onClick={() => handleRemoveTag('ministry', tag)}
                              className="remove-tag-button"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  <div className="form-group">
                    <label>Post Status Tags</label>
                    <div className="tag-input-container">
                      <div className="tag-input-wrapper">
                        <input
                          type="text"
                          name="postStatus"
                          value={newTag.postStatus}
                          onChange={handleTagInputChange}
                          placeholder="Add a status tag"
                          className="tag-input"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddTag('postStatus')}
                          className="add-tag-button"
                        >
                          Add
                        </button>
                      </div>
                      
                      {uniquePostStatuses.length > 0 && (
                        <div className="existing-tags">
                          <label className="existing-tags-label">Existing status tags:</label>
                          <div className="existing-tags-list">
                            {uniquePostStatuses.map(tag => (
                              <button
                                key={tag}
                                type="button"
                                className={`existing-tag ${formData.postStatus.includes(tag) ? 'selected' : ''}`}
                                onClick={() => {
                                  if (formData.postStatus.includes(tag)) {
                                    handleRemoveTag('postStatus', tag);
                                  } else {
                                    setFormData(prev => ({
                                      ...prev,
                                      postStatus: [...prev.postStatus, tag]
                                    }));
                                  }
                                }}
                              >
                                {tag}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      <div className="selected-tags">
                        {formData.postStatus.map(tag => (
                          <div key={tag} className="selected-tag">
                            <span>{tag}</span>
                            <button 
                              type="button" 
                              onClick={() => handleRemoveTag('postStatus', tag)}
                              className="remove-tag-button"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  <div className="form-section">
                    <h3 className="form-section-title">Analytics</h3>
                    
                    <div className="form-row">
                      <div className="form-group">
                        <label>
                          <FaThumbsUp /> Likes
                        </label>
                        <input
                          type="number"
                          name="likes"
                          value={formData.analytics.likes}
                          onChange={handleAnalyticsChange}
                          placeholder="Number of likes"
                          min="0"
                        />
                      </div>
                      
                      <div className="form-group">
                        <label>
                          <FaShare /> Shares
                        </label>
                        <input
                          type="number"
                          name="shares"
                          value={formData.analytics.shares}
                          onChange={handleAnalyticsChange}
                          placeholder="Number of shares"
                          min="0"
                        />
                      </div>
                      
                      <div className="form-group">
                        <label>
                          <FaEye /> Views
                        </label>
                        <input
                          type="number"
                          name="views"
                          value={formData.analytics.views}
                          onChange={handleAnalyticsChange}
                          placeholder="Number of views"
                          min="0"
                        />
                      </div>
                    </div>
                  </div>
                  
                  <div className="form-actions">
                    <button type="button" onClick={() => setShowModal(false)} className="cancel-button">
                      Cancel
                    </button>
                    <button type="submit" className="save-button" disabled={loading}>
                      {loading ? 'Saving...' : 'Save Post'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SocialMedia;
import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import ChurchHeader from './ChurchHeader';
import './CourseAnalytics.css';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, PointElement, LineElement } from 'chart.js';
import { Bar, Pie, Line } from 'react-chartjs-2';

// Register ChartJS components
ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement, Title, Tooltip, Legend);

const CourseAnalytics = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [churchData, setChurchData] = useState(null);
  const [categoriesData, setCategoriesData] = useState([]);
  const [membersData, setMembersData] = useState([]);
  const [timeframe, setTimeframe] = useState('month'); // 'week', 'month', 'quarter', 'year'
  const [recommendations, setRecommendations] = useState([]);
  const [insights, setInsights] = useState([]);
  const [statsData, setStatsData] = useState({
    totalMembers: 0,
    totalCourses: 0,
    completedCourses: 0,
    inProgressCourses: 0,
    notStartedCourses: 0,
    completionRate: 0,
    totalCategories: 0,
  });

  useEffect(() => {
    const fetchChurchData = async () => {
      try {
        const churchDoc = await getDoc(doc(db, 'churches', id));
        if (churchDoc.exists()) {
          setChurchData(churchDoc.data());
        }
      } catch (error) {
        console.error('Error fetching church data:', error);
      }
    };

    fetchChurchData();
  }, [id]);

  useEffect(() => {
    const fetchAnalyticsData = async () => {
      if (!id) return;
      
      try {
        setLoading(true);
        
        // Fetch course categories data
        const categoriesQuery = query(
          collection(db, 'coursecategories'),
          where('churchId', '==', id)
        );
        const categoriesSnapshot = await getDocs(categoriesQuery);
        const categoriesData = categoriesSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setCategoriesData(categoriesData);
        
        // Fetch members data
        const membersQuery = query(
          collection(db, 'users'),
          where('churchId', '==', id)
        );
        const membersSnapshot = await getDocs(membersQuery);
        const membersData = membersSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setMembersData(membersData);
        
        // Calculate stats
        calculateStats(categoriesData, membersData);
        
        // Generate recommendations
        generateRecommendations(categoriesData, membersData);
        
        // Generate insights
        generateInsights(categoriesData, membersData);
        
        setLoading(false);
      } catch (error) {
        console.error('Error fetching analytics data:', error);
        setLoading(false);
      }
    };
    
    fetchAnalyticsData();
  }, [id]);

  const calculateStats = (categories, members) => {
    // Calculate total members
    const totalMembers = members.length;
    
    // Calculate total courses (subcategories)
    let totalCourses = 0;
    let completedCourses = 0;
    let inProgressCourses = 0;
    let notStartedCourses = 0;
    
    // Map to track unique subcategory assignments
    const memberCourseMap = new Map();
    
    // Process all members and their course assignments/completions
    members.forEach(member => {
      // Process completion logs
      const completionLogs = member.completionLogs || [];
      completionLogs.forEach(log => {
        const key = `${member.id}-${log.subcategoryId}`;
        memberCourseMap.set(key, 'completed');
      });
      
      // Process course assignments
      const courseAssignments = member.courseAssignments || [];
      courseAssignments.forEach(assignment => {
        const key = `${member.id}-${assignment.subcategoryId}`;
        if (!memberCourseMap.has(key)) {
          memberCourseMap.set(key, assignment.status === 'in-progress' ? 'in-progress' : 'assigned');
        }
      });
    });
    
    // Count total subcategories
    let totalSubcategories = 0;
    categories.forEach(category => {
      if (Array.isArray(category.subcategories)) {
        totalSubcategories += category.subcategories.length;
      }
    });
    
    // Count status totals
    for (const status of memberCourseMap.values()) {
      if (status === 'completed') completedCourses++;
      else if (status === 'in-progress') inProgressCourses++;
      else notStartedCourses++;
    }
    
    totalCourses = memberCourseMap.size;
    
    // Calculate completion rate
    const completionRate = totalCourses > 0 ? Math.round((completedCourses / totalCourses) * 100) : 0;
    
    setStatsData({
      totalMembers,
      totalCourses,
      completedCourses,
      inProgressCourses,
      notStartedCourses,
      completionRate,
      totalCategories: categories.length,
      totalSubcategories
    });
  };

  const generateRecommendations = (categories, members) => {
    const recommendations = [];
    
    // Find categories with low completion rates
    const categoryCompletionRates = {};
    const categoryAssignmentCounts = {};
    
    categories.forEach(category => {
      if (!Array.isArray(category.subcategories)) return;
      
      let totalAssignments = 0;
      let completedAssignments = 0;
      
      category.subcategories.forEach(subcategory => {
        const assignedUsers = subcategory.assignedUsers || [];
        totalAssignments += assignedUsers.length;
        
        // Count completions for this subcategory
        members.forEach(member => {
          const completionLogs = member.completionLogs || [];
          const hasCompleted = completionLogs.some(log => log.subcategoryId === subcategory.id);
          if (hasCompleted) completedAssignments++;
        });
      });
      
      categoryCompletionRates[category.id] = totalAssignments > 0 
        ? Math.round((completedAssignments / totalAssignments) * 100) 
        : 0;
      
      categoryAssignmentCounts[category.id] = totalAssignments;
    });
    
    // Recommend focusing on categories with low completion rates
    const lowCompletionCategories = Object.entries(categoryCompletionRates)
      .filter(([_, rate]) => rate < 30)
      .sort(([_, rateA], [__, rateB]) => rateA - rateB)
      .slice(0, 3)
      .map(([categoryId, rate]) => {
        const category = categories.find(c => c.id === categoryId);
        return {
          id: categoryId,
          name: category ? category.name : 'Unknown Category',
          completionRate: rate,
          assignmentCount: categoryAssignmentCounts[categoryId] || 0
        };
      });
    
    if (lowCompletionCategories.length > 0) {
      recommendations.push({
        type: 'low-completion',
        title: 'Focus on Low Completion Categories',
        description: 'These categories have low completion rates and may need additional support or communication.',
        items: lowCompletionCategories
      });
    }
    
    // Find members with stalled progress
    const stalledMembers = members
      .map(member => {
        const completionLogs = member.completionLogs || [];
        const assignments = member.courseAssignments || [];
        
        // Calculate completion percentage
        const assignmentCount = assignments.length;
        const completionCount = completionLogs.length;
        const completionRate = assignmentCount > 0 
          ? Math.round((completionCount / assignmentCount) * 100) 
          : 0;
        
        // Check if member has assignments but low completion rate
        const isStalled = assignmentCount > 3 && completionRate < 30;
        
        return {
          id: member.id,
          name: `${member.name || ''} ${member.lastName || ''}`.trim(),
          email: member.email,
          completionRate,
          assignmentCount,
          isStalled
        };
      })
      .filter(member => member.isStalled)
      .slice(0, 5);
    
    if (stalledMembers.length > 0) {
      recommendations.push({
        type: 'stalled-members',
        title: 'Reach Out to Members with Stalled Progress',
        description: 'These members have several assignments but low completion rates.',
        items: stalledMembers
      });
    }
    
    // Recommend unassigned subcategories that might be valuable
    const unassignedSubcategories = [];
    categories.forEach(category => {
      if (!Array.isArray(category.subcategories)) return;
      
      category.subcategories.forEach(subcategory => {
        const assignedUsers = subcategory.assignedUsers || [];
        if (assignedUsers.length < 5) {
          unassignedSubcategories.push({
            id: subcategory.id,
            name: subcategory.name,
            categoryId: category.id,
            categoryName: category.name,
            assignmentCount: assignedUsers.length
          });
        }
      });
    });
    
    if (unassignedSubcategories.length > 0) {
      recommendations.push({
        type: 'unassigned-courses',
        title: 'Courses with Few Assignments',
        description: 'These courses have fewer than 5 assignments and might benefit from more exposure.',
        items: unassignedSubcategories.slice(0, 5)
      });
    }
    
    setRecommendations(recommendations);
  };

  const generateInsights = (categories, members) => {
    const insights = [];
    
    // Calculate overall engagement metrics
    const totalAssignments = members.reduce((sum, member) => 
      sum + (member.courseAssignments?.length || 0), 0);
    
    const totalCompletions = members.reduce((sum, member) => 
      sum + (member.completionLogs?.length || 0), 0);
    
    // Calculate average time to completion (if data available)
    let avgCompletionDays = null;
    let completionTimeData = [];
    
    members.forEach(member => {
      const assignments = member.courseAssignments || [];
      const completions = member.completionLogs || [];
      
      completions.forEach(completion => {
        const matching = assignments.find(a => a.subcategoryId === completion.subcategoryId);
        if (matching && matching.assignedAt && completion.completedAt) {
          const assignedDate = new Date(matching.assignedAt);
          const completedDate = new Date(completion.completedAt);
          const daysDiff = Math.ceil(
            (completedDate.getTime() - assignedDate.getTime()) / (1000 * 60 * 60 * 24)
          );
          
          if (daysDiff >= 0) {
            completionTimeData.push(daysDiff);
          }
        }
      });
    });
    
    if (completionTimeData.length > 0) {
      avgCompletionDays = Math.round(
        completionTimeData.reduce((sum, days) => sum + days, 0) / completionTimeData.length
      );
      
      insights.push({
        title: `Average completion time is ${avgCompletionDays} days`,
        content: `Members typically take about ${avgCompletionDays} days to complete an assigned course.`
      });
    }
    
    // Identify most/least popular categories
    const categoryAssignmentCounts = {};
    const categoryCompletionRates = {};
    
    categories.forEach(category => {
      if (!Array.isArray(category.subcategories)) return;
      
      let categoryAssignments = 0;
      let categoryCompletions = 0;
      
      category.subcategories.forEach(subcategory => {
        const assignedCount = subcategory.assignedUsers?.length || 0;
        categoryAssignments += assignedCount;
        
        // Count completions
        members.forEach(member => {
          const completions = member.completionLogs || [];
          const isCompleted = completions.some(c => c.subcategoryId === subcategory.id);
          if (isCompleted) categoryCompletions++;
        });
      });
      
      categoryAssignmentCounts[category.id] = {
        id: category.id,
        name: category.name,
        count: categoryAssignments
      };
      
      categoryCompletionRates[category.id] = {
        id: category.id,
        name: category.name,
        rate: categoryAssignments > 0 
          ? Math.round((categoryCompletions / categoryAssignments) * 100) 
          : 0
      };
    });
    
    // Most popular category
    const mostPopular = Object.values(categoryAssignmentCounts)
      .sort((a, b) => b.count - a.count)[0];
    
    if (mostPopular && mostPopular.count > 0) {
      insights.push({
        title: `Most popular category: ${mostPopular.name}`,
        content: `This category has the highest number of assignments (${mostPopular.count}).`
      });
    }
    
    // Highest completion rate
    const highestCompletion = Object.values(categoryCompletionRates)
      .filter(c => c.rate > 0)
      .sort((a, b) => b.rate - a.rate)[0];
    
    if (highestCompletion && highestCompletion.rate > 0) {
      insights.push({
        title: `Highest completion rate: ${highestCompletion.name} (${highestCompletion.rate}%)`,
        content: `This category has the best completion rate among all categories.`
      });
    }
    
    // Recent activity trends
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    
    // Count recent completions (last 30 days)
    let recentCompletions = 0;
    
    members.forEach(member => {
      const completions = member.completionLogs || [];
      completions.forEach(completion => {
        if (completion.completedAt) {
          const completionDate = new Date(completion.completedAt);
          if (completionDate >= thirtyDaysAgo) {
            recentCompletions++;
          }
        }
      });
    });
    
    if (recentCompletions > 0) {
      insights.push({
        title: `${recentCompletions} completions in the last 30 days`,
        content: `Your congregation has completed ${recentCompletions} courses in the past month.`
      });
    }
    
    setInsights(insights);
  };

  const formatStatValue = (value) => {
    if (typeof value === 'number') {
      if (value >= 1000) {
        return `${(value / 1000).toFixed(1)}k`;
      }
      return value.toString();
    }
    return '0';
  };

  // Prepare chart data
  const getCompletionStatusData = () => {
    return {
      labels: ['Completed', 'In Progress', 'Not Started'],
      datasets: [
        {
          data: [
            statsData.completedCourses,
            statsData.inProgressCourses,
            statsData.notStartedCourses
          ],
          backgroundColor: [
            'rgba(16, 185, 129, 0.7)',  // green
            'rgba(245, 158, 11, 0.7)',  // amber
            'rgba(239, 68, 68, 0.7)',   // red
          ],
          borderColor: [
            'rgba(16, 185, 129, 1)',
            'rgba(245, 158, 11, 1)',
            'rgba(239, 68, 68, 1)',
          ],
          borderWidth: 1,
        },
      ],
    };
  };

  const getCategoryCompletionData = () => {
    const labels = categoriesData.map(category => category.name);
    const completedData = [];
    const inProgressData = [];
    const notStartedData = [];
    
    categoriesData.forEach(category => {
      let completed = 0;
      let inProgress = 0;
      let notStarted = 0;
      
      if (Array.isArray(category.subcategories)) {
        category.subcategories.forEach(subcategory => {
          const assignedUsers = subcategory.assignedUsers || [];
          
          assignedUsers.forEach(assignment => {
            const memberId = assignment.value;
            const member = membersData.find(m => m.id === memberId);
            
            if (member) {
              const completionLogs = member.completionLogs || [];
              const isCompleted = completionLogs.some(log => log.subcategoryId === subcategory.id);
              
              if (isCompleted) {
                completed++;
              } else {
                const courseAssignments = member.courseAssignments || [];
                const assignmentStatus = courseAssignments.find(a => a.subcategoryId === subcategory.id)?.status;
                
                if (assignmentStatus === 'in-progress') {
                  inProgress++;
                } else {
                  notStarted++;
                }
              }
            }
          });
        });
      }
      
      completedData.push(completed);
      inProgressData.push(inProgress);
      notStartedData.push(notStarted);
    });
    
    return {
      labels,
      datasets: [
        {
          label: 'Completed',
          data: completedData,
          backgroundColor: 'rgba(16, 185, 129, 0.7)',
          borderColor: 'rgba(16, 185, 129, 1)',
          borderWidth: 1,
        },
        {
          label: 'In Progress',
          data: inProgressData,
          backgroundColor: 'rgba(245, 158, 11, 0.7)',
          borderColor: 'rgba(245, 158, 11, 1)',
          borderWidth: 1,
        },
        {
          label: 'Not Started',
          data: notStartedData,
          backgroundColor: 'rgba(239, 68, 68, 0.7)',
          borderColor: 'rgba(239, 68, 68, 1)',
          borderWidth: 1,
        },
      ],
    };
  };

  const getCompletionTrendData = () => {
    // Mock trend data - in a real app, you would calculate this from actual data
    return {
      labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      datasets: [
        {
          label: 'Course Completions',
          data: [12, 19, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60],
          borderColor: 'rgba(79, 70, 229, 1)',
          backgroundColor: 'rgba(79, 70, 229, 0.1)',
          fill: true,
          tension: 0.4,
        },
      ],
    };
  };

  const handleRecommendationAction = (recommendation, item) => {
    // Handle recommendation actions based on type
    switch (recommendation.type) {
      case 'low-completion':
        navigate(`/church/${id}/course-admin`);
        break;
      case 'stalled-members':
        navigate(`/church/${id}/member/${item.id}`);
        break;
      case 'unassigned-courses':
        navigate(`/church/${id}/course/${item.categoryId}/subcategory/${item.id}`);
        break;
      default:
        console.log('Unknown recommendation type');
    }
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
      },
    },
  };

  const barChartOptions = {
    ...chartOptions,
    scales: {
      x: {
        stacked: true,
      },
      y: {
        stacked: true,
      },
    },
  };

  return (
    <div className="course-analytics-container">
      <div className="dashboard-container">
        <Link to={`/organization/${id}/mi-organizacion`} className="back-button">
          ← Back to Mi Organización
        </Link>
        
        <ChurchHeader id={id} />
        
        <div className="analytics-header">
          <h1>Course Analytics Dashboard</h1>
          <p>Comprehensive insights into your congregation's course progress and engagement</p>
        </div>
        
        <div className="filter-row">
          <div 
            className={`filter-item ${timeframe === 'week' ? 'active' : ''}`}
            onClick={() => setTimeframe('week')}
          >
            Last Week
          </div>
          <div 
            className={`filter-item ${timeframe === 'month' ? 'active' : ''}`}
            onClick={() => setTimeframe('month')}
          >
            Last Month
          </div>
          <div 
            className={`filter-item ${timeframe === 'quarter' ? 'active' : ''}`}
            onClick={() => setTimeframe('quarter')}
          >
            Last Quarter
          </div>
          <div 
            className={`filter-item ${timeframe === 'year' ? 'active' : ''}`}
            onClick={() => setTimeframe('year')}
          >
            Last Year
          </div>
        </div>
        
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
            <div className="loading-spinner"></div>
          </div>
        ) : (
          <>
            {/* Stats Grid */}
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value">{formatStatValue(statsData.totalMembers)}</div>
                <div className="stat-label">Total Members</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{formatStatValue(statsData.totalCourses)}</div>
                <div className="stat-label">Course Assignments</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{statsData.completionRate}%</div>
                <div className="stat-label">Completion Rate</div>
                <div className="stat-footer">
                  <span className={statsData.completionRate > 50 ? 'positive' : 'negative'}>
                    {statsData.completionRate > 50 ? '↑' : '↓'} {statsData.completedCourses} completed
                  </span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{formatStatValue(statsData.inProgressCourses)}</div>
                <div className="stat-label">In Progress</div>
              </div>
            </div>
            
            {/* Charts Grid */}
            <div className="charts-grid">
              <div className="chart-card">
                <div className="chart-header">
                  <div className="chart-title">Course Progress by Category</div>
                  <div className="date-filter">
                    {timeframe === 'week' ? 'Last 7 days' : 
                     timeframe === 'month' ? 'Last 30 days' : 
                     timeframe === 'quarter' ? 'Last 90 days' : 'Last 365 days'}
                  </div>
                </div>
                <div className="chart-container">
                  <Bar data={getCategoryCompletionData()} options={barChartOptions} />
                </div>
              </div>
              
              <div className="chart-card">
                <div className="chart-header">
                  <div className="chart-title">Completion Status</div>
                </div>
                <div className="chart-container">
                  <Pie data={getCompletionStatusData()} options={chartOptions} />
                </div>
              </div>
            </div>
            
            <div className="chart-card">
              <div className="chart-header">
                <div className="chart-title">Completion Trend</div>
                <div className="date-filter">
                  {timeframe === 'week' ? 'Last 7 days' : 
                   timeframe === 'month' ? 'Last 30 days' : 
                   timeframe === 'quarter' ? 'Last 90 days' : 'Last 365 days'}
                </div>
              </div>
              <div className="chart-container">
                <Line data={getCompletionTrendData()} options={chartOptions} />
              </div>
            </div>
            
            {/* Recommendations Section */}
            <div className="recommendations-section">
              <div className="tables-header">
                <h2>Recommendations</h2>
                <p>Actionable insights to improve engagement and completion rates</p>
              </div>
              
              {recommendations.length > 0 ? (
                recommendations.map((recommendation, index) => (
                  <div className="rec-card" key={index}>
                    <h3>{recommendation.title}</h3>
                    <p>{recommendation.description}</p>
                    
                    {recommendation.items.map((item, itemIndex) => (
                      <div key={itemIndex} style={{ 
                        marginBottom: '12px', 
                        padding: '8px', 
                        backgroundColor: '#f9fafb', 
                        borderRadius: '4px' 
                      }}>
                        <div style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          alignItems: 'center',
                          marginBottom: '8px'
                        }}>
                          <div style={{ fontWeight: '500' }}>
                            {item.name}
                          </div>
                          
                          {recommendation.type === 'low-completion' && (
                            <div className="status-badge not-started">
                              {item.completionRate}% Completion
                            </div>
                          )}
                          
                          {recommendation.type === 'stalled-members' && (
                            <div className="status-badge in-progress">
                              {item.completionRate}% Completion
                            </div>
                          )}
                          
                          {recommendation.type === 'unassigned-courses' && (
                            <div className="status-badge">
                              {item.assignmentCount} Assignments
                            </div>
                          )}
                        </div>
                        
                        {(recommendation.type === 'low-completion' || recommendation.type === 'stalled-members') && (
                          <div className="progress-bar">
                            <div 
                              className={`progress-fill ${
                                item.completionRate > 66 ? 'high' : 
                                item.completionRate > 33 ? 'medium' : 'low'
                              }`}
                              style={{ width: `${item.completionRate}%` }}
                            ></div>
                          </div>
                        )}
                        
                        <div className="rec-actions">
                          <button 
                            className="rec-button primary-button"
                            onClick={() => handleRecommendationAction(recommendation, item)}
                          >
                            {recommendation.type === 'low-completion' ? 'View Category' :
                             recommendation.type === 'stalled-members' ? 'View Member' :
                             'View Course'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              ) : (
                <div className="rec-card">
                  <h3>No recommendations available</h3>
                  <p>As more course data becomes available, personalized recommendations will appear here.</p>
                </div>
              )}
            </div>
            
            {/* Tables Section - Member Progress */}
            <div className="tables-section">
              <div className="tables-header">
                <h2>Members Progress Overview</h2>
                <p>Summary of member progress across all courses</p>
              </div>
              
              <div className="table-card">
                <div className="table-header">
                  <div className="table-title">Top Performing Members</div>
                </div>
                
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Assigned Courses</th>
                      <th>Completed</th>
                      <th>Completion Rate</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {membersData
                      .map(member => {
                        const assignments = member.courseAssignments || [];
                        const completions = member.completionLogs || [];
                        const completionRate = assignments.length > 0 
                          ? Math.round((completions.length / assignments.length) * 100) 
                          : 0;
                          
                        return {
                          id: member.id,
                          name: `${member.name || ''} ${member.lastName || ''}`.trim() || member.email,
                          assignedCount: assignments.length,
                          completedCount: completions.length,
                          completionRate
                        };
                      })
                      .filter(member => member.assignedCount > 0)
                      .sort((a, b) => b.completionRate - a.completionRate)
                      .slice(0, 5)
                      .map((member, index) => (
                        <tr key={index}>
                          <td>{member.name}</td>
                          <td>{member.assignedCount}</td>
                          <td>{member.completedCount}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {member.completionRate}%
                              <div className="progress-bar" style={{ flex: 1, margin: 0 }}>
                                <div 
                                  className={`progress-fill ${
                                    member.completionRate > 66 ? 'high' : 
                                    member.completionRate > 33 ? 'medium' : 'low'
                                  }`}
                                  style={{ width: `${member.completionRate}%` }}
                                ></div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <Link 
                              to={`/church/${id}/member/${member.id}`}
                              style={{ 
                                color: '#4f46e5', 
                                textDecoration: 'none',
                                fontWeight: '500'
                              }}
                            >
                              View Profile
                            </Link>
                          </td>
                        </tr>
                      ))
                    }
                    
                    {membersData.filter(m => (m.courseAssignments || []).length > 0).length === 0 && (
                      <tr>
                        <td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>
                          No member data available
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            
            {/* AI Insights Panel */}
            <div className="insights-panel">
              <div className="insights-header">
                <span>✨</span> AI-Generated Insights
              </div>
              
              {insights.length > 0 ? (
                insights.map((insight, index) => (
                  <div className="insight-item" key={index}>
                    <div className="insight-title">{insight.title}</div>
                    <div className="insight-content">{insight.content}</div>
                  </div>
                ))
              ) : (
                <div className="insight-item">
                  <div className="insight-title">Not enough data for insights</div>
                  <div className="insight-content">
                    As more course data becomes available, AI-generated insights will appear here to help you understand trends and opportunities.
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CourseAnalytics;
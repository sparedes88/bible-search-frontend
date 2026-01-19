import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, collection, query, where, getDocs, orderBy, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../contexts/AuthContext';
import ChurchHeader from './ChurchHeader';
import './AdminConnect.css';
import './MemberProfile.css';
import './MemberDashboard.css';
import { FaCalendarCheck, FaChartLine, FaBell, FaCheckCircle, FaExclamationCircle, 
  FaUserCheck, FaArrowCircleUp, FaTasks, FaChartPie, FaGraduationCap, FaStar, FaClock, 
  FaLightbulb, FaBrain } from 'react-icons/fa';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, 
  PointElement, LineElement, BarElement, Title, RadialLinearScale } from 'chart.js';
import { Doughnut, Line, Bar, Radar } from 'react-chartjs-2';
import 'react-loading-skeleton/dist/skeleton.css';
import MemberInsightsAnalysis from './MemberInsightsAnalysis';

// Register ChartJS components
ChartJS.register(
  ArcElement, 
  Tooltip, 
  Legend, 
  CategoryScale, 
  LinearScale, 
  PointElement, 
  LineElement, 
  BarElement, 
  Title,
  RadialLinearScale
);

const MemberDashboard = () => {
  const { id, profileId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [memberData, setMemberData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [courseData, setCourseData] = useState([]);
  const [upcomingEvents, setUpcomingEvents] = useState([]);
  const [memberStats, setMemberStats] = useState({
    totalRequired: 0,
    completedRequired: 0,
    totalEvents: 0,
    registeredEvents: 0,
    completedEvents: 0,
    nextDeadline: null,
    lastActivity: null,
    engagementScore: 0,
    nextSteps: [],
    completionByCategory: []
  });
  const [showActionPlan, setShowActionPlan] = useState(false);
  const [church, setChurch] = useState(null);
  const [activityData, setActivityData] = useState([]);
  const [growthMetrics, setGrowthMetrics] = useState([]);

  useEffect(() => {
    const fetchChurchData = async () => {
      try {
        const churchDoc = await getDoc(doc(db, 'churches', id));
        if (churchDoc.exists()) {
          setChurch(churchDoc.data());
        }
      } catch (error) {
        console.error('Error fetching church:', error);
      }
    };

    fetchChurchData();
  }, [id]);

  useEffect(() => {
    if (id && profileId) {
      fetchMemberData();
      fetchCourseDataWithEvents();
      fetchUpcomingEvents();
      generateActivityData();
      generateGrowthMetrics();
    }
  }, [id, profileId]);

  useEffect(() => {
    if (courseData.length > 0 && upcomingEvents.length > 0) {
      calculateMemberStats();
    }
  }, [courseData, upcomingEvents]);

  const fetchMemberData = async () => {
    try {
      setLoading(true);
      const userDoc = await getDoc(doc(db, 'users', profileId));
      
      if (!userDoc.exists()) {
        toast.error('Member not found');
        navigate(`/church/${id}/admin-connect`);
        return;
      }

      const userData = userDoc.data();
      
      // Process notes similar to MemberProfile.js
      let allNotes = [];
      
      if (userData.notes && Array.isArray(userData.notes)) {
        allNotes = [...userData.notes];
      } else {
        userData.notes = [];
      }

      // Handle migrated notes if they exist
      if (userData.migrationDetails?.notes && Array.isArray(userData.migrationDetails.notes)) {
        const migratedNotes = userData.migrationDetails.notes.map(note => ({
          ...note,
          isMigratedNote: true,
          timestamp: note.timestamp || userData.migrationDetails.migrationDate,
          tasks: note.tasks || []
        }));
        allNotes = [...allNotes, ...migratedNotes];
      }

      // Format notes consistently
      allNotes = allNotes.map(note => ({
        id: note.id || `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        text: note.text || '',
        timestamp: note.timestamp || new Date().toISOString(),
        addedBy: note.addedBy || 'Unknown',
        tasks: Array.isArray(note.tasks) ? note.tasks : [],
        isMigratedNote: note.isMigratedNote || false
      }));

      // Sort notes by timestamp (newest first)
      allNotes.sort((a, b) => {
        const dateA = new Date(a.timestamp);
        const dateB = new Date(b.timestamp);
        return dateB - dateA;
      });
      
      setMemberData({
        ...userData,
        id: userDoc.id,
        allNotes: allNotes,
        createdAt: userData.createdAt?.toDate?.()?.toLocaleString() || 'N/A'
      });
      
      setLoading(false);
    } catch (error) {
      console.error('Error fetching member data:', error);
      toast.error('Failed to load member data');
      setLoading(false);
    }
  };

  const fetchCourseDataWithEvents = async () => {
    try {
      const categoriesRef = collection(db, 'coursecategories');
      const categoriesQuery = query(categoriesRef, where('churchId', '==', id));
      const categoriesSnapshot = await getDocs(categoriesQuery);
      const categoriesData = categoriesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      const eventsRef = collection(db, 'eventInstances');
      const eventsQuery = query(eventsRef, where('churchId', '==', id));
      const eventsSnapshot = await getDocs(eventsQuery);
      const eventsData = eventsSnapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data(),
          title: doc.data().instanceTitle || doc.data().title
        }))
        .filter(event => !event.removed && !event.isDeleted);
      
      const eventsBySubcategory = {};
      eventsData.forEach(event => {
        if (event.subcategoryId) {
          if (!eventsBySubcategory[event.subcategoryId]) {
            eventsBySubcategory[event.subcategoryId] = [];
          }
          eventsBySubcategory[event.subcategoryId].push(event);
        }
      });
      
      const userRef = doc(db, 'users', profileId);
      const userDoc = await getDoc(userRef);
      const userData = userDoc.data();
      
      const completionMap = {};
      userData?.completionLogs?.forEach(log => {
        completionMap[log.subcategoryId] = {
          completed: true,
          completedAt: log.completedAt,
          completedAtFormatted: log.completedAtFormatted || new Date(log.completedAt).toLocaleString(),
          note: log.note
        };
      });
      
      const eventProgressMap = {};
      if (userData?.courseCompletions) {
        userData.courseCompletions.forEach(completion => {
          if (completion.eventId) {
            eventProgressMap[completion.eventId] = {
              status: completion.status || 'in-progress',
              completedAt: completion.completedAt,
              startedAt: completion.startedAt,
              instructorName: completion.instructorName
            };
          }
        });
      }
      
      const processedData = categoriesData.map(category => {
        const subcategories = (category.subcategories || []).map(sub => {
          const isAssigned = sub.assignedUsers?.some(u => u.value === profileId);
          const isCompleted = completionMap[sub.id] || false;
          const relatedEvents = eventsBySubcategory[sub.id] || [];
          
          const eventsWithProgress = relatedEvents.map(event => ({
            ...event,
            progressStatus: eventProgressMap[event.id] || null
          }));

          // Filter for unique events by order number
          const uniqueEvents = eventsWithProgress.filter((event, index, self) =>
            index === self.findIndex(e => e.order === event.order)
          );

          const completionPercentage = uniqueEvents.length > 0
            ? Math.round((uniqueEvents.filter(event => event.progressStatus?.status === 'completed').length / uniqueEvents.length) * 100)
            : 0;
          
          return {
            ...sub,
            isAssigned,
            isCompleted: !!isCompleted,
            completedAt: isCompleted.completedAt,
            completedAtFormatted: isCompleted.completedAtFormatted,
            completionNote: isCompleted.note,
            relatedEvents: uniqueEvents,
            required: sub.required === true,
            completionPercentage
          };
        });
        
        return {
          ...category,
          subcategories
        };
      });
      
      setCourseData(processedData);
    } catch (error) {
      console.error('Error fetching course data:', error);
      toast.error('Failed to load course data');
    }
  };

  const fetchUpcomingEvents = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const eventsRef = collection(db, 'eventInstances');
      const eventsQuery = query(
        eventsRef, 
        where('churchId', '==', id),
        where('startDate', '>=', today)
      );
      const eventsSnapshot = await getDocs(eventsQuery);
      
      const registrationsRef = collection(db, 'eventRegistrations');
      const registrationsQuery = query(
        registrationsRef,
        where('memberId', '==', profileId)
      );
      const registrationsSnapshot = await getDocs(registrationsQuery);
      
      const registeredEvents = {};
      registrationsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        let registeredAt = 'N/A';
        try {
          if (data.registeredAt) {
            registeredAt = data.registeredAt.toDate ? 
              data.registeredAt.toDate().toLocaleString() : 
              new Date(data.registeredAt).toLocaleString();
          }
        } catch (err) {
          console.warn("Could not format timestamp", err);
        }
        
        registeredEvents[data.eventId] = {
          id: doc.id,
          ...data,
          registeredAt
        };
      });
      
      const events = eventsSnapshot.docs
        .map(doc => {
          const eventData = doc.data();
          return {
            id: doc.id,
            name: eventData.title || eventData.instanceTitle,
            date: eventData.startDate,
            location: eventData.location || 'TBD',
            order: eventData.order,
            isRegistered: !!registeredEvents[doc.id],
            registrationDetails: registeredEvents[doc.id] || null
          };
        })
        .filter(event => !event.removed && !event.isDeleted)
        .sort((a, b) => {
          return a.date.localeCompare(b.date);
        });
        
      setUpcomingEvents(events);
    } catch (error) {
      console.error('Error fetching upcoming events:', error);
      console.error('Failed to load upcoming events');
    }
  };

  const calculateMemberStats = () => {
    // Calculate required courses stats
    const requiredSubcategories = courseData.flatMap(category => 
      category.subcategories.filter(sub => sub.required && sub.isAssigned)
    );
    
    const totalRequired = requiredSubcategories.length;
    const completedRequired = requiredSubcategories.filter(sub => sub.isCompleted).length;

    // Calculate event stats
    const uniqueEvents = upcomingEvents.filter((event, index, self) =>
      index === self.findIndex(e => e.order === event.order)
    );
    const totalEvents = uniqueEvents.length;
    const registeredEvents = uniqueEvents.filter(event => event.isRegistered).length;
    const completedEvents = uniqueEvents.filter(
      event => event.isRegistered && event.registrationDetails?.status === 'completed'
    ).length;

    // Calculate next deadline
    const incompleteEvents = uniqueEvents
      .filter(event => !event.isRegistered || event.registrationDetails?.status !== 'completed')
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const nextDeadline = incompleteEvents.length > 0 ? incompleteEvents[0] : null;

    // Calculate engagement score (0-100)
    const courseCompletion = totalRequired > 0 ? (completedRequired / totalRequired) * 50 : 0;
    const eventCompletion = totalEvents > 0 ? (registeredEvents / totalEvents) * 30 : 0;
    const activityScore = memberData?.lastActivity ? 20 : 0;
    const engagementScore = Math.round(courseCompletion + eventCompletion + activityScore);

    // Generate next steps
    const nextSteps = [];
    
    if (incompleteEvents.length > 0) {
      nextSteps.push({
        id: 'register-event',
        title: `Register for ${incompleteEvents[0].name}`,
        description: `Upcoming event on ${incompleteEvents[0].date}`,
        priority: 'high',
        icon: 'FaCalendarCheck'
      });
    }

    if (completedRequired < totalRequired) {
      const incompleteCourses = requiredSubcategories.filter(sub => !sub.isCompleted);
      if (incompleteCourses.length > 0) {
        nextSteps.push({
          id: 'complete-course',
          title: `Complete "${incompleteCourses[0].name}"`,
          description: 'Required for membership progression',
          priority: 'high',
          icon: 'FaGraduationCap'
        });
      }
    }

    // Add more contextual next steps
    if (memberData && !memberData.dateOfBirth) {
      nextSteps.push({
        id: 'update-profile',
        title: 'Complete your profile',
        description: 'Add missing personal information',
        priority: 'medium',
        icon: 'FaUserCheck'
      });
    }

    // Completion by category
    const completionByCategory = courseData.map(category => {
      const totalSubcategories = category.subcategories.filter(
        sub => sub.isAssigned
      ).length;
      
      const completedSubcategories = category.subcategories.filter(
        sub => sub.isAssigned && sub.isCompleted
      ).length;
      
      const percentage = totalSubcategories > 0 
        ? Math.round((completedSubcategories / totalSubcategories) * 100) 
        : 0;
      
      return {
        name: category.name,
        percentage,
        color: getRandomColor(category.name)
      };
    });

    setMemberStats({
      totalRequired,
      completedRequired,
      totalEvents,
      registeredEvents,
      completedEvents,
      nextDeadline,
      lastActivity: memberData?.lastActivity,
      engagementScore,
      nextSteps,
      completionByCategory
    });
  };

  const generateActivityData = () => {
    // Generate mock activity data for the last 8 weeks
    // In a real implementation, this would come from actual user activity logs
    const labels = [];
    const data = [];
    
    const today = new Date();
    for (let i = 7; i >= 0; i--) {
      const date = new Date();
      date.setDate(today.getDate() - (i * 7));
      labels.push(date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
      
      // Generate activity counts with an upward trend and some randomness
      const baseValue = 2 + Math.floor(i * 0.8);
      const randomVariation = Math.floor(Math.random() * 3);
      data.push(baseValue + randomVariation);
    }
    
    setActivityData({
      labels,
      datasets: [
        {
          label: 'Member Activity',
          data,
          fill: true,
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
          borderColor: 'rgba(75, 192, 192, 1)',
          borderWidth: 2,
          tension: 0.4
        }
      ]
    });
  };

  const generateGrowthMetrics = () => {
    // Mock growth metrics for the radar chart
    // These metrics would typically be derived from actual data analysis
    setGrowthMetrics({
      labels: ['Engagement', 'Attendance', 'Participation', 'Course Completion', 'Event Registration', 'Volunteering'],
      datasets: [
        {
          label: 'Current',
          data: [
            Math.floor(Math.random() * 40) + 60, // Engagement (60-100)
            Math.floor(Math.random() * 30) + 40, // Attendance (40-70)
            Math.floor(Math.random() * 20) + 60, // Participation (60-80)
            Math.floor(Math.random() * 40) + 40, // Course Completion (40-80)
            Math.floor(Math.random() * 30) + 50, // Event Registration (50-80)
            Math.floor(Math.random() * 60) + 30  // Volunteering (30-90)
          ],
          backgroundColor: 'rgba(54, 162, 235, 0.2)',
          borderColor: 'rgba(54, 162, 235, 1)',
          borderWidth: 2,
        },
        {
          label: 'Average',
          data: [50, 45, 55, 50, 45, 40],
          backgroundColor: 'rgba(255, 99, 132, 0.2)',
          borderColor: 'rgba(255, 99, 132, 1)',
          borderWidth: 2,
        }
      ]
    });
  };

  const getRandomColor = (seed) => {
    // Generate a deterministic color based on a string seed
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF)
      .toString(16)
      .toUpperCase()
      .padStart(6, '0');
    return `#${c}`;
  };

  const handleEventRegistration = async (eventId) => {
    try {
      const event = upcomingEvents.find(e => e.id === eventId);
      if (event?.isRegistered) {
        toast.info('Already registered for this event');
        return;
      }

      await addDoc(collection(db, "eventRegistrations"), {
        eventId,
        memberId: profileId,
        churchId: id,
        registeredAt: serverTimestamp(),
        status: "confirmed",
        memberName: `${memberData.name} ${memberData.lastName}`,
        memberEmail: memberData.email,
        memberPhone: memberData.phone
      });

      await fetchUpcomingEvents();
      toast.success('Successfully registered for the event!');
      
      // Recalculate stats after registration
      calculateMemberStats();
    } catch (error) {
      console.error('Error registering for event:', error);
      toast.error('Failed to register for the event');
    }
  };

  const renderCompletionChart = () => {
    if (!memberStats) return null;
    
    const requiredData = {
      labels: ['Completed', 'Remaining'],
      datasets: [
        {
          data: [
            memberStats.completedRequired, 
            Math.max(0, memberStats.totalRequired - memberStats.completedRequired)
          ],
          backgroundColor: ['#10B981', '#F3F4F6'],
          borderColor: ['#10B981', '#E5E7EB'],
          borderWidth: 1,
          cutout: '70%'
        }
      ]
    };
    
    const eventData = {
      labels: ['Registered', 'Not Registered'],
      datasets: [
        {
          data: [
            memberStats.registeredEvents, 
            Math.max(0, memberStats.totalEvents - memberStats.registeredEvents)
          ],
          backgroundColor: ['#3B82F6', '#F3F4F6'],
          borderColor: ['#3B82F6', '#E5E7EB'],
          borderWidth: 1,
          cutout: '70%'
        }
      ]
    };
    
    const completedEventData = {
      labels: ['Completed', 'In Progress'],
      datasets: [
        {
          data: [
            memberStats.completedEvents, 
            Math.max(0, memberStats.registeredEvents - memberStats.completedEvents)
          ],
          backgroundColor: ['#8B5CF6', '#F3F4F6'],
          borderColor: ['#8B5CF6', '#E5E7EB'],
          borderWidth: 1,
          cutout: '70%'
        }
      ]
    };
    
    const requiredOptions = {
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          enabled: true
        }
      },
      maintainAspectRatio: false,
    };
    
    return (
      <div className="dashboard-charts-container">
        <div className="chart-wrapper">
          <h3>Required Courses</h3>
          <div className="chart-inner">
            <Doughnut data={requiredData} options={requiredOptions} />
            <div className="chart-center-text">
              <div className="chart-percentage">
                {memberStats.totalRequired > 0 
                  ? Math.round((memberStats.completedRequired / memberStats.totalRequired) * 100) 
                  : 0}%
              </div>
              <div className="chart-label">
                {memberStats.completedRequired}/{memberStats.totalRequired}
              </div>
            </div>
          </div>
        </div>
        
        <div className="chart-wrapper">
          <h3>Event Registration</h3>
          <div className="chart-inner">
            <Doughnut data={eventData} options={requiredOptions} />
            <div className="chart-center-text">
              <div className="chart-percentage">
                {memberStats.totalEvents > 0 
                  ? Math.round((memberStats.registeredEvents / memberStats.totalEvents) * 100) 
                  : 0}%
              </div>
              <div className="chart-label">
                {memberStats.registeredEvents}/{memberStats.totalEvents}
              </div>
            </div>
          </div>
        </div>
        
        <div className="chart-wrapper">
          <h3>Event Completion</h3>
          <div className="chart-inner">
            <Doughnut data={completedEventData} options={requiredOptions} />
            <div className="chart-center-text">
              <div className="chart-percentage">
                {memberStats.registeredEvents > 0 
                  ? Math.round((memberStats.completedEvents / memberStats.registeredEvents) * 100) 
                  : 0}%
              </div>
              <div className="chart-label">
                {memberStats.completedEvents}/{memberStats.registeredEvents}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderNextActionItems = () => {
    if (!memberStats.nextSteps || memberStats.nextSteps.length === 0) {
      return (
        <div className="no-actions">
          <FaCheckCircle size={24} color="#10B981" />
          <p>All requirements complete! No actions needed.</p>
        </div>
      );
    }
    
    return (
      <div className="next-actions-container">
        {memberStats.nextSteps.map((step, index) => {
          let IconComponent;
          switch (step.icon) {
            case 'FaCalendarCheck': IconComponent = FaCalendarCheck; break;
            case 'FaUserCheck': IconComponent = FaUserCheck; break;
            case 'FaGraduationCap': IconComponent = FaGraduationCap; break;
            default: IconComponent = FaTasks;
          }
          
          return (
            <div 
              key={step.id || index} 
              className={`action-item priority-${step.priority}`}
            >
              <div className="action-icon">
                <IconComponent size={20} />
              </div>
              <div className="action-content">
                <h4>{step.title}</h4>
                <p>{step.description}</p>
              </div>
              <div className="action-priority">
                {step.priority === 'high' && <FaExclamationCircle color="#EF4444" title="High Priority" />}
                {step.priority === 'medium' && <FaExclamationCircle color="#F59E0B" title="Medium Priority" />}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderCourseCompletionTable = () => {
    if (!courseData.length) return <div className="no-data">No course data available</div>;
    
    // Flatten subcategories to create a clean view of all courses
    const allSubcategories = courseData.flatMap(category => 
      category.subcategories.map(sub => ({
        ...sub,
        categoryName: category.name
      }))
    ).filter(sub => sub.isAssigned);
    
    // Sort by required status (required first) and then by completion status
    allSubcategories.sort((a, b) => {
      if (a.required && !b.required) return -1;
      if (!a.required && b.required) return 1;
      if (a.isCompleted && !b.isCompleted) return 1;
      if (!a.isCompleted && b.isCompleted) return -1;
      return 0;
    });
    
    return (
      <div className="dashboard-table-container">
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Course</th>
              <th>Category</th>
              <th>Status</th>
              <th>Completion</th>
            </tr>
          </thead>
          <tbody>
            {allSubcategories.map(subcategory => (
              <tr 
                key={subcategory.id} 
                className={
                  subcategory.isCompleted 
                    ? 'completed-row' 
                    : (subcategory.required ? 'required-row' : '')
                }
              >
                <td>
                  <div className="subcategory-name">
                    {subcategory.name}
                    {subcategory.required && (
                      <span className="required-badge">Required</span>
                    )}
                  </div>
                </td>
                <td>{subcategory.categoryName}</td>
                <td>
                  <span className={`status-badge ${subcategory.isCompleted ? 'completed' : 'incomplete'}`}>
                    {subcategory.isCompleted ? 'Completed' : 'Incomplete'}
                  </span>
                </td>
                <td>
                  <div className="progress-bar-container">
                    <div 
                      className="progress-bar-fill" 
                      style={{ width: `${subcategory.completionPercentage}%` }}
                    ></div>
                    <span className="progress-text">{subcategory.completionPercentage}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderCompletionByCategory = () => {
    if (!memberStats.completionByCategory || memberStats.completionByCategory.length === 0) {
      return <div className="no-data">No category data available</div>;
    }
    
    const data = {
      labels: memberStats.completionByCategory.map(cat => cat.name),
      datasets: [
        {
          data: memberStats.completionByCategory.map(cat => cat.percentage),
          backgroundColor: memberStats.completionByCategory.map(cat => cat.color),
          borderWidth: 1
        }
      ]
    };
    
    const options = {
      plugins: {
        legend: {
          position: 'right',
          labels: {
            font: {
              size: 12
            }
          }
        }
      },
      maintainAspectRatio: false
    };
    
    return (
      <div className="category-chart-container">
        <Doughnut data={data} options={options} />
      </div>
    );
  };

  const renderRecommendedEvents = () => {
    // Get incomplete events
    const incompleteEvents = upcomingEvents
      .filter(event => !event.isRegistered)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 3); // Show top 3 upcoming events
    
    if (incompleteEvents.length === 0) {
      return (
        <div className="no-recommendations">
          <p>No upcoming events to recommend.</p>
        </div>
      );
    }
    
    return (
      <div className="recommended-events">
        {incompleteEvents.map(event => (
          <div key={event.id} className="recommended-event-card">
            <div className="event-info">
              <h4>{event.name}</h4>
              <div className="event-meta">
                <span className="event-date">
                  <FaCalendarCheck /> {event.date}
                </span>
                <span className="event-location">
                  📍 {event.location}
                </span>
              </div>
            </div>
            <button 
              className="register-event-button"
              onClick={() => handleEventRegistration(event.id)}
            >
              Register
            </button>
          </div>
        ))}
      </div>
    );
  };

  const renderEngagementScore = () => {
    if (!memberStats) return null;
    
    const getScoreColor = (score) => {
      if (score >= 80) return '#10B981'; // Green
      if (score >= 60) return '#22D3EE'; // Teal
      if (score >= 40) return '#F59E0B'; // Amber
      return '#EF4444'; // Red
    };
    
    const scoreColor = getScoreColor(memberStats.engagementScore);
    
    return (
      <div className="engagement-score-container">
        <div className="score-gauge">
          <svg viewBox="0 0 120 120" width="100%" height="100%">
            <circle 
              cx="60" 
              cy="60" 
              r="54" 
              fill="none" 
              stroke="#E5E7EB" 
              strokeWidth="12" 
            />
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke={scoreColor}
              strokeWidth="12"
              strokeDasharray={`${(memberStats.engagementScore / 100) * 339} 339`}
              strokeDashoffset="84.75"
              strokeLinecap="round"
              transform="rotate(-90 60 60)"
            />
          </svg>
          <div className="score-value">
            <span className="score-number">{memberStats.engagementScore}</span>
            <span className="score-label">Score</span>
          </div>
        </div>
        <div className="score-details">
          <div className="score-detail-item">
            <div className="detail-label">Required Courses</div>
            <div className="detail-value">
              {memberStats.completedRequired}/{memberStats.totalRequired} completed
            </div>
          </div>
          <div className="score-detail-item">
            <div className="detail-label">Event Participation</div>
            <div className="detail-value">
              {memberStats.registeredEvents}/{memberStats.totalEvents} registered
            </div>
          </div>
          <div className="score-detail-item">
            <div className="detail-label">Last Activity</div>
            <div className="detail-value">
              {memberStats.lastActivity 
                ? new Date(memberStats.lastActivity).toLocaleDateString() 
                : 'No recent activity'}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderActivityChart = () => {
    if (!activityData) return null;
    
    const options = {
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          enabled: true
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Activity Count'
          },
          ticks: {
            stepSize: 1
          }
        },
        x: {
          title: {
            display: true,
            text: 'Date'
          }
        }
      },
      maintainAspectRatio: false
    };
    
    return (
      <div className="activity-chart-container">
        <Line data={activityData} options={options} height={200} />
      </div>
    );
  };

  const renderGrowthRadar = () => {
    if (!growthMetrics) return null;
    
    const options = {
      plugins: {
        legend: {
          position: 'top',
        }
      },
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: {
            stepSize: 20
          }
        }
      },
      maintainAspectRatio: false
    };
    
    return (
      <div className="growth-radar-container">
        <Radar data={growthMetrics} options={options} height={250} />
      </div>
    );
  };

  const renderActionPlan = () => {
    return (
      <div className="action-plan-container">
        <h3>Personalized Action Plan for {memberData?.name} {memberData?.lastName}</h3>
        <div className="action-plan-steps">
          <div className="action-step">
            <div className="step-number">1</div>
            <div className="step-content">
              <h4>Complete required courses</h4>
              <p>Focus on completing the {memberStats.totalRequired - memberStats.completedRequired} remaining required courses.</p>
              {memberStats.completionByCategory
                .filter(cat => cat.percentage < 100)
                .slice(0, 1)
                .map(cat => (
                  <div key={cat.name} className="step-recommendation">
                    <strong>Start with:</strong> {cat.name} category ({cat.percentage}% complete)
                  </div>
                ))
              }
            </div>
          </div>
          
          <div className="action-step">
            <div className="step-number">2</div>
            <div className="step-content">
              <h4>Attend upcoming events</h4>
              <p>Register for the next upcoming event to stay engaged.</p>
              {memberStats.nextDeadline && (
                <div className="step-recommendation">
                  <strong>Next event:</strong> {memberStats.nextDeadline.name} on {memberStats.nextDeadline.date}
                </div>
              )}
            </div>
          </div>
          
          <div className="action-step">
            <div className="step-number">3</div>
            <div className="step-content">
              <h4>Increase engagement</h4>
              <p>Your current engagement score is {memberStats.engagementScore}/100.</p>
              <div className="step-recommendation">
                <strong>Suggestion:</strong> {memberStats.engagementScore < 60 
                  ? 'Participate more in church activities and complete required courses.'
                  : memberStats.engagementScore < 80
                    ? 'Continue your progress on required courses and event attendance.'
                    : 'Excellent engagement! Consider volunteering or mentoring other members.'
                }
              </div>
            </div>
          </div>
        </div>
        
        <div className="action-plan-date">
          <FaClock /> Generated on {new Date().toLocaleDateString()}
        </div>
      </div>
    );
  };

  if (loading) {
    return <div>Loading dashboard...</div>;
  }

  return (
    <div className="dashboard-container">
      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop={true}
        closeOnClick={true}
        rtl={false}
        pauseOnFocusLoss={false}
        draggable={true}
        pauseOnHover={true}
        theme="light"
        limit={3}
      />
      <div className="dashboard-navigation">
        <button
          onClick={() => navigate(`/church/${id}/member/${profileId}`)}
          className="back-button"
        >
          ← Back to Member Profile
        </button>
      </div>
      <ChurchHeader id={id} />
      <div className="dashboard-header">
        <h1>Member Intelligence Dashboard</h1>
        <div className="member-snapshot">
          <div className="member-info">
            <h2>{memberData?.name} {memberData?.lastName}</h2>
            <p>Member since: {memberData?.createdAt}</p>
          </div>
          <div className="dashboard-actions">
            <button 
              className="action-plan-button"
              onClick={() => setShowActionPlan(!showActionPlan)}
            >
              {showActionPlan ? 'Hide Action Plan' : 'View Action Plan'}
            </button>
          </div>
        </div>
      </div>
      
      {showActionPlan && renderActionPlan()}
      
      <div className="dashboard-grid">
        <div className="dashboard-card ai-insights full-width">
          <div className="card-header">
            <h3><FaBrain /> AI Member Insights</h3>
          </div>
          <div className="card-body">
            {memberData?.allNotes && memberData.allNotes.length > 0 ? (
              <MemberInsightsAnalysis memberData={memberData} notesData={memberData.allNotes} />
            ) : (
              <div className="no-notes-message">
                <FaLightbulb size={24} color="#F59E0B" />
                <h4>No member notes available for analysis</h4>
                <p>Add detailed notes about this member to generate AI-powered insights.</p>
                <button 
                  className="add-note-button"
                  onClick={() => navigate(`/church/${id}/member/${profileId}`)}
                >
                  Add Notes
                </button>
              </div>
            )}
          </div>
        </div>
        
        <div className="dashboard-card completion-overview">
          <div className="card-header">
            <h3><FaChartPie /> Completion Overview</h3>
          </div>
          <div className="card-body">
            {renderCompletionChart()}
          </div>
        </div>
        
        <div className="dashboard-card engagement-overview">
          <div className="card-header">
            <h3><FaChartLine /> Engagement Score</h3>
          </div>
          <div className="card-body">
            {renderEngagementScore()}
          </div>
        </div>
        
        <div className="dashboard-card next-actions">
          <div className="card-header">
            <h3><FaTasks /> Next Steps</h3>
          </div>
          <div className="card-body">
            {renderNextActionItems()}
          </div>
        </div>
        
        <div className="dashboard-card category-completion">
          <div className="card-header">
            <h3><FaGraduationCap /> Completion by Category</h3>
          </div>
          <div className="card-body">
            {renderCompletionByCategory()}
          </div>
        </div>
        
        <div className="dashboard-card activity-trends">
          <div className="card-header">
            <h3><FaUserCheck /> Activity Trends</h3>
          </div>
          <div className="card-body">
            {renderActivityChart()}
          </div>
        </div>
        
        <div className="dashboard-card growth-metrics">
          <div className="card-header">
            <h3><FaArrowCircleUp /> Growth Metrics</h3>
          </div>
          <div className="card-body">
            {renderGrowthRadar()}
          </div>
        </div>
        
        <div className="dashboard-card recommended-events">
          <div className="card-header">
            <h3><FaCalendarCheck /> Recommended Events</h3>
          </div>
          <div className="card-body">
            {renderRecommendedEvents()}
          </div>
        </div>
        
        <div className="dashboard-card course-status full-width">
          <div className="card-header">
            <h3><FaStar /> Course Completion Status</h3>
          </div>
          <div className="card-body">
            {renderCourseCompletionTable()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MemberDashboard;
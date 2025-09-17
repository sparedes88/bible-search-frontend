import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs, doc, getDoc, updateDoc, arrayRemove } from 'firebase/firestore';
import Skeleton from 'react-loading-skeleton';
import './UserCourseProgress.css';
import CourseProgressCard from './CourseProgressCard';

const UserCourseProgress = ({ churchId, onSubcategoryClick, profileId }) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState([]);
  const [userData, setUserData] = useState(null);
  const [completedSubcategories, setCompletedSubcategories] = useState([]);
  const [inProgressSubcategories, setInProgressSubcategories] = useState([]);
  const [unassignLoading, setUnassignLoading] = useState(false);
  const [recurringEventCounts, setRecurringEventCounts] = useState({});

  const calculateSubcategoryProgress = (subcategory, eventCompletions) => {
    const requiredEvents = (subcategory.events || [])
      .filter(event => event.status === 'required' && !event.isDeleted)
      .map(event => ({
        ...event,
        completionStatus: eventCompletions.find(c => c.eventId === event.id)?.status || 'not-started'
      }));
      
    const optionalEvents = (subcategory.events || [])
      .filter(event => event.status === 'optional' && !event.isDeleted)
      .map(event => ({
        ...event,
        completionStatus: eventCompletions.find(c => c.eventId === event.id)?.status || 'not-started'
      }));

    const totalRequired = requiredEvents.length;
    const completedCount = requiredEvents.filter(e => e.completionStatus === 'completed').length;
    const inProgressCount = requiredEvents.filter(e => e.completionStatus === 'in-progress').length;

    let status = 'unassigned';
    
    if (totalRequired > 0) {
      if (completedCount === totalRequired) {
        status = 'completed';
      } else if (inProgressCount > 0) {
        status = 'in-progress';
      } else if (completedCount > 0) {
        status = 'in-progress';
      } else {
        status = 'not-started';
      }
    }

    return {
      requiredEvents,
      optionalEvents,
      totalRequired,
      completedCount,
      inProgressCount,
      status
    };
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return '✓';
      case 'in-progress':
        return '↻';
      case 'not-started':
        return '✗';
      default:
        return '-';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return '#10B981';
      case 'in-progress':
        return '#FBBF24';
      case 'not-started':
        return '#EF4444';
      default:
        return '#6B7280';
    }
  };

  const handleUnassignEvent = async (eventId, categoryId, subcategoryId) => {
    if (!window.confirm('Are you sure you want to unassign this event?')) {
      return;
    }
    
    try {
      setUnassignLoading(true);
      const userId = profileId || user.uid;
      const userRef = doc(db, 'users', userId);
      
      const userDoc = await getDoc(userRef);
      if (!userDoc.exists()) {
        console.error('User document not found');
        return;
      }
      
      const userData = userDoc.data();
      
      const courseAssignments = userData.courseAssignments || [];
      const assignmentToRemove = courseAssignments.find(assignment => 
        assignment.categoryId === categoryId && 
        assignment.subcategoryId === subcategoryId && 
        (assignment.eventId === eventId || !assignment.eventId)
      );
      
      if (assignmentToRemove) {
        await updateDoc(userRef, {
          courseAssignments: arrayRemove(assignmentToRemove)
        });
        
        await fetchUserProgress();
      }
    } catch (error) {
      console.error('Error unassigning event:', error);
      alert('Failed to unassign event. Please try again.');
    } finally {
      setUnassignLoading(false);
    }
  };

  const fetchUserProgress = async () => {
    if (!user || !churchId) return;

    try {
      setLoading(true);
      const userId = profileId || user.uid;
      console.log('Fetching progress for user:', userId);
      
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (!userDoc.exists()) {
        console.error('User document not found for ID:', userId);
        setLoading(false);
        return;
      }
      
      const userDataFromDb = userDoc.data();
      setUserData(userDataFromDb);

      const eventCompletions = userDataFromDb?.courseCompletions || [];
      const courseAssignments = userDataFromDb?.courseAssignments || [];
      
      console.log('Course assignments:', courseAssignments.length);
      console.log('Event completions:', eventCompletions.length);

      const eventsQuery = query(
        collection(db, "eventInstances"),
        where("churchId", "==", churchId)
      );
      const eventsSnap = await getDocs(eventsQuery);
      const eventsMap = {};
      const recurringEvents = {};
      
      eventsSnap.docs.forEach(doc => {
        const eventData = doc.data();
        if (!eventData.isDeleted) {
          eventsMap[doc.id] = { ...eventData, id: doc.id };
          
          if (eventData.isRecurring && eventData.parentEventId) {
            if (!recurringEvents[eventData.parentEventId]) {
              recurringEvents[eventData.parentEventId] = 0;
            }
            recurringEvents[eventData.parentEventId]++;
          }
        }
      });
      
      setRecurringEventCounts(recurringEvents);

      const completionMap = {};
      userDataFromDb?.completionLogs?.forEach(log => {
        const key = log.subcategoryId;
        if (log.status === 'complete') {
          completionMap[key] = {
            completed: true,
            completedAt: log.completedAt,
            completedAtFormatted: log.completedAtFormatted,
            note: log.note
          };
        }
      });

      const userAssignments = {
        categories: userDataFromDb?.assignedCategories || [],
        subcategories: userDataFromDb?.assignedSubcategories || [],
        courseAssignments: courseAssignments
      };

      const categoriesQuery = query(
        collection(db, 'coursecategories'),
        where('churchId', '==', churchId)
      );
      
      const categoriesSnapshot = await getDocs(categoriesQuery);
      const categoriesData = categoriesSnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(category => {
          if (!Array.isArray(category.subcategories)) {
            console.log(`Category ${category.name} has no subcategories array`);
            return false;
          }
          return true;
        })
        .map(category => {
          const isCategoryAssigned = userAssignments.categories.includes(category.id) ||
                     (Array.isArray(category.assignedUsers) && 
                      category.assignedUsers.some(u => u.value === userId));
          
          return {
            id: category.id,
            name: category.name,
            description: category.description,
            order: category.order,
            isAssigned: isCategoryAssigned,
            subcategories: (category.subcategories || [])
              .sort((a, b) => (a.order || 0) - (b.order || 0))
              .map(sub => {
                const isDirectlyAssigned = userAssignments.subcategories.includes(sub.id) ||
                                         (Array.isArray(sub.assignedUsers) && 
                                          sub.assignedUsers.some(u => u.value === userId));
                
                const courseAssignment = userAssignments.courseAssignments.find(a => 
                  a.categoryId === category.id && a.subcategoryId === sub.id
                );
                
                const hasEventCompletions = eventCompletions.some(ec => {
                  const event = eventsMap[ec.eventId];
                  return event && event.subcategoryId === sub.id;
                });
                
                const isAssigned = isDirectlyAssigned || !!courseAssignment || hasEventCompletions;
                
                const progress = calculateSubcategoryProgress(sub, eventCompletions);
                
                return {
                  ...sub,
                  ...progress,
                  isAssigned,
                  assignmentInfo: courseAssignment,
                  isCompleted: !!completionMap[sub.id],
                  completedAt: completionMap[sub.id]?.completedAt,
                  completedAtFormatted: completionMap[sub.id]?.completedAtFormatted,
                  completionNote: completionMap[sub.id]?.note
                };
              })
              .filter(sub => sub.isAssigned || 
                             sub.completedCount > 0 || 
                             sub.inProgressCount > 0 ||
                             sub.isCompleted)
          };
        })
        .filter(category => category.subcategories.length > 0)
        .sort((a, b) => (a.order || 0) - (b.order || 0));

      console.log('Processed Categories:', categoriesData.length);
      setCategories(categoriesData);

    } catch (error) {
      console.error('Error fetching categories:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUserProgress();
  }, [user, churchId, profileId]);

  if (loading) {
    return <Skeleton count={5} height={100} className="mb-4" />;
  }

  return (
    <div className="course-progress-container">
      <div className="status-legend">
        <div className="legend-item">
          <div className="status-dot" style={{ backgroundColor: getStatusColor('completed') }}></div>
          <span>Completed</span>
        </div>
        <div className="legend-item">
          <div className="status-dot" style={{ backgroundColor: getStatusColor('in-progress') }}></div>
          <span>In Progress</span>
        </div>
        <div className="legend-item">
          <div className="status-dot" style={{ backgroundColor: getStatusColor('not-started') }}></div>
          <span>Assigned - Not Started</span>
        </div>
        <div className="legend-item">
          <div className="status-dot" style={{ backgroundColor: getStatusColor('unassigned') }}></div>
          <span>Unassigned</span>
        </div>
      </div>
      
      <div style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
        <CourseProgressCard 
          title="Completed Courses" 
          count={userData?.completionLogs?.filter(log => log.status === 'complete' && !log.isDeleted).length || 0}
          color="#10B981" 
          icon="✓" 
          showLegend={false}
        />
        
        <CourseProgressCard 
          title="Assigned Courses" 
          count={categories.reduce((total, category) => {
            return total + category.subcategories.filter(sub => 
              sub.isAssigned && !sub.isCompleted
            ).length;
          }, 0)}
          color="#FBBF24" 
          icon="↻" 
          events={categories.flatMap(category => 
            category.subcategories
              .filter(sub => sub.isAssigned && !sub.isCompleted)
              .slice(0, 3) 
              .map(sub => {
                const hasInProgressEvents = sub.inProgressCount > 0;
                return {
                  title: `${category.name}: ${sub.name}`,
                  status: hasInProgressEvents ? 'in-progress' : 'not-started'
                };
              })
          ).slice(0, 5)}
          showLegend={true}
        />
      </div>

      <div className="categories-grid">
        {categories.map(category => (
          <div key={category.id} className="category-card">
            <h3>{category.name}</h3>
            <div className="subcategories-list">
              {category.subcategories?.map(subcategory => {
                const progress = calculateSubcategoryProgress(
                  subcategory, 
                  userData?.courseCompletions || []
                );
                
                return (
                  <div 
                    key={subcategory.id} 
                    className={`subcategory-item ${progress.status}`}
                  >
                    <div className="subcategory-header">
                      <span className="subcategory-name">{subcategory.name}</span>
                      <div className="status-indicator" style={{
                        backgroundColor: getStatusColor(progress.status),
                      }}>
                        {getStatusIcon(progress.status)}
                      </div>
                    </div>

                    {(progress.requiredEvents.length > 0 || progress.optionalEvents.length > 0) && (
                      <div className="all-events-list">
                        {progress.requiredEvents.length > 0 && (
                          <div className="required-events-list">
                            <div className="progress-bar">
                              <div 
                                className="progress-fill"
                                style={{ width: `${(progress.completedCount / progress.totalRequired) * 100}%` }}
                              />
                            </div>
                            <span className="progress-text">
                              {progress.completedCount}/{progress.totalRequired} Required Events Completed
                            </span>
                            
                            <div className="events-table-container">
                              <h5 className="events-section-title">Required Events</h5>
                              <table className="events-table">
                                <thead>
                                  <tr>
                                    <th>Event</th>
                                    <th>Date</th>
                                    <th>Time</th>
                                    <th>Type</th>
                                    <th>Status</th>
                                    <th>Action</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {progress.requiredEvents.map(event => (
                                    <tr key={event.id} className={`event-row ${event.completionStatus}`}>
                                      <td className="event-title-cell">
                                        {event.title}
                                      </td>
                                      <td>{event.startDate}</td>
                                      <td>{event.startHour}</td>
                                      <td>
                                        {event.isRecurring && (
                                          <span className="event-recurring-tag">
                                            Recurring {recurringEventCounts[event.parentEventId] > 0 && 
                                              `(${recurringEventCounts[event.parentEventId]} total)`}
                                          </span>
                                        )}
                                        {!event.isRecurring && <span>Single Instance</span>}
                                      </td>
                                      <td>
                                        <span className={`event-status ${event.completionStatus}`}>
                                          {event.completionStatus === 'completed' ? 'Completed' :
                                          event.completionStatus === 'in-progress' ? 'In Progress' : 'Not Started'}
                                        </span>
                                      </td>
                                      <td>
                                        <button 
                                          onClick={() => handleUnassignEvent(event.id, category.id, subcategory.id)}
                                          disabled={unassignLoading || event.completionStatus === 'completed'}
                                          className="unassign-button"
                                          title={event.completionStatus === 'completed' ? 
                                            "Completed events cannot be unassigned" : 
                                            "Unassign this event"}
                                        >
                                          {unassignLoading ? "..." : "Unassign"}
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                        
                        {progress.optionalEvents.length > 0 && (
                          <div className="optional-events-list">
                            <h5 className="events-section-title">Optional Events</h5>
                            <table className="events-table">
                              <thead>
                                <tr>
                                  <th>Event</th>
                                  <th>Date</th>
                                  <th>Time</th>
                                  <th>Type</th>
                                  <th>Status</th>
                                  <th>Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {progress.optionalEvents.map(event => (
                                  <tr key={event.id} className={`event-row ${event.completionStatus}`}>
                                    <td className="event-title-cell">
                                      {event.title}
                                    </td>
                                    <td>{event.startDate}</td>
                                    <td>{event.startHour}</td>
                                    <td>
                                      {event.isRecurring && (
                                        <span className="event-recurring-tag">
                                          Recurring {recurringEventCounts[event.parentEventId] > 0 && 
                                            `(${recurringEventCounts[event.parentEventId]} total)`}
                                        </span>
                                      )}
                                      {!event.isRecurring && <span>Single Instance</span>}
                                    </td>
                                    <td>
                                      <span className={`event-status ${event.completionStatus}`}>
                                        {event.completionStatus === 'completed' ? 'Completed' :
                                        event.completionStatus === 'in-progress' ? 'In Progress' : 'Not Started'}
                                      </span>
                                    </td>
                                    <td>
                                      <button 
                                        onClick={() => handleUnassignEvent(event.id, category.id, subcategory.id)}
                                        disabled={unassignLoading || event.completionStatus === 'completed'}
                                        className="unassign-button"
                                        title={event.completionStatus === 'completed' ? 
                                          "Completed events cannot be unassigned" : 
                                          "Unassign this event"}
                                      >
                                        {unassignLoading ? "..." : "Unassign"}
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default UserCourseProgress;
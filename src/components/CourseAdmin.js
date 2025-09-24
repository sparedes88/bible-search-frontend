import React, { useState, useEffect } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { db, auth } from "../firebase";
import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where,
  limit,
  getDoc,
} from "firebase/firestore";
import { storage } from "../firebase";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import Skeleton from "react-loading-skeleton";
import ChurchHeader from "./ChurchHeader";
import { useAuth } from "../contexts/AuthContext";
import commonStyles from "../pages/commonStyles";
import "./tableStyles.css";

const getRandomColor = () => {
  const colors = ["#FF5733", "#33B5E5", "#FFBB33", "#99CC00", "#A633FF"];
  return colors[Math.floor(Math.random() * colors.length)];
};

const createDefaultCategories = async (churchId) => {
  try {
    console.log("Checking categories for church:", churchId);
    const existingCats = await getDocs(
      query(
        collection(db, "coursecategories"),
        where("churchId", "==", churchId)
      )
    );

    console.log("Existing categories:", existingCats.docs.length);

    if (existingCats.empty) {
      console.log("No categories found, creating defaults...");
      const defaultCategories = [
        {
          name: "Bible Studies",
          description: "In-depth studies of biblical books and topics",
          order: 1,
          churchId: churchId,
          subcategories: [
            {
              name: "Old Testament",
              description: "Studies from the Old Testament",
              order: 1,
            },
            {
              name: "New Testament",
              description: "Studies from the New Testament",
              order: 2,
            },
            {
              name: "Topical Studies",
              description: "Topic-based biblical studies",
              order: 3,
            },
          ],
        },
        {
          name: "Discipleship",
          description: "Courses for spiritual growth and discipleship",
          order: 2,
          churchId: churchId,
          subcategories: [
            {
              name: "New Believers",
              description: "Foundations for new Christians",
              order: 1,
            },
            {
              name: "Spiritual Disciplines",
              description: "Prayer, fasting, and spiritual practices",
              order: 2,
            },
            {
              name: "Leadership",
              description: "Christian leadership development",
              order: 3,
            },
          ],
        },
      ];

      for (const category of defaultCategories) {
        const docRef = await addDoc(collection(db, "coursecategories"), {
          ...category,
          createdAt: serverTimestamp(),
        });
        console.log("Created category with ID:", docRef.id);
      }
      console.log("Default categories created for church:", churchId);
    }
  } catch (error) {
    console.error("Error in createDefaultCategories:", error);
  }
};

const getPrerequisiteName = (prerequisiteId, categories) => {
  for (const category of categories) {
    const prereqSubcategory = category.subcategories.find(
      (sub) => sub.id === prerequisiteId
    );
    if (prereqSubcategory) {
      return `${category.name} - ${prereqSubcategory.name}`;
    }
  }
  return "Unknown";
};

const getCoursePrerequisiteName = (prerequisiteId, courses) => {
  const prereqCourse = courses.find((c) => c.id === prerequisiteId);
  return prereqCourse ? prereqCourse.title : "Unknown";
};

const formatDateString = (dateStr) => {
  try {
    // Firebase format is YYYY-MM-DD
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch (err) {
    console.error('Error formatting date:', dateStr, err);
    return dateStr;
  }
};

const UserCourseProgress = ({ churchId, onSubcategoryClick, upcomingEvents }) => {
  const [courses, setCourses] = useState([]);
  const [eventsBySubcategory, setEventsBySubcategory] = useState({});
  const [completionStatusMap, setCompletionStatusMap] = useState({});
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUserCourses = async () => {
      try {
        setLoading(true);
        
        // Fetch user data
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (!userDoc.exists()) {
          console.error("User document not found");
          setLoading(false);
          return;
        }

        const userData = userDoc.data();
        const courseAssignments = userData.courseAssignments || [];
        const courseCompletions = userData.courseCompletions || [];
        
        // Get both categories and events in parallel
        const [categoriesSnap, eventsSnap] = await Promise.all([
          getDocs(query(collection(db, "coursecategories"), where("churchId", "==", churchId))),
          getDocs(query(collection(db, "eventInstances"), where("churchId", "==", churchId)))
        ]);

        // Create events map by subcategory
        const eventsMap = {};
        eventsSnap.docs.forEach(doc => {
          const event = { id: doc.id, ...doc.data() };
          if (!event.isDeleted && event.subcategoryId) {
            if (!eventsMap[event.subcategoryId]) {
              eventsMap[event.subcategoryId] = [];
            }
            eventsMap[event.subcategoryId].push(event);
          }
        });
        setEventsBySubcategory(eventsMap);

        // Create completion status map
        const statusMap = {};
        courseCompletions.forEach(completion => {
          statusMap[completion.eventId] = {
            status: completion.status,
            startedAt: completion.startedAt,
            instructorName: completion.instructorName,
            notes: completion.notes,
            createdAt: completion.createdAt
          };
        });
        setCompletionStatusMap(statusMap);

        const categoriesData = [];
        
        categoriesSnap.forEach(doc => {
          const categoryData = doc.data();
          const category = {
            id: doc.id,
            name: categoryData.name,
            subcategories: {
              completed: [],
              inProgress: [],
              notStarted: []
            }
          };

          // Process subcategories
          (categoryData.subcategories || []).forEach(sub => {
            // Check if this subcategory is assigned to the user
            const assignment = courseAssignments.find(a => 
              a.categoryId === doc.id && a.subcategoryId === sub.id
            );
            
            // Only include if assigned
            if (assignment) {
              const subcategoryEvents = eventsMap[sub.id] || [];
              const requiredEvents = subcategoryEvents.filter(e => e.status === 'required' && !e.isDeleted);
              const completedRequiredEvents = requiredEvents.filter(event => {
                const completion = statusMap[event.id];
                return completion?.status === 'completed';
              });

              const inProgressEvents = requiredEvents.filter(event => {
                const completion = statusMap[event.id];
                return completion?.status === 'in-progress';
              });

              const subcategory = { 
                ...sub, 
                categoryId: doc.id,
                assignedAt: assignment.assignedAt,
                assignedBy: assignment.assignedBy,
                status: assignment.status,
                requiredTotal: requiredEvents.length,
                requiredCompleted: completedRequiredEvents.length,
                inProgressCount: inProgressEvents.length,
                lastActivity: inProgressEvents.length > 0 ? 
                  Math.max(...inProgressEvents.map(e => new Date(statusMap[e.id]?.startedAt || 0))) : 
                  null
              };

              // Determine status based on event completions
              if (requiredEvents.length === completedRequiredEvents.length && requiredEvents.length > 0) {
                category.subcategories.completed.push({
                  ...subcategory,
                  completedAt: new Date().toISOString(),
                  instructorName: completedRequiredEvents[0]?.instructorName,
                  notes: completedRequiredEvents[0]?.notes
                });
              } else if (inProgressEvents.length > 0 || completedRequiredEvents.length > 0) {
                category.subcategories.inProgress.push({
                  ...subcategory,
                  startedAt: subcategory.lastActivity,
                  instructorName: inProgressEvents[0]?.instructorName
                });
              } else {
                category.subcategories.notStarted.push(subcategory);
              }
            }
          });

          // Only include categories with subcategories
          if (Object.values(category.subcategories).some(arr => arr.length > 0)) {
            categoriesData.push(category);
          }
        });

        setCourses(categoriesData);
        setLoading(false);
      } catch (error) {
        console.error("Error fetching user courses:", error);
        setLoading(false);
      }
    };

    if (user && user.uid && churchId) {
      fetchUserCourses();
    }
  }, [churchId, user?.uid]);

  const getNextAvailableEvent = (missingEvents) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const availableEvents = upcomingEvents
      .filter(event => {
        const eventDate = new Date(event.startDate);
        // Check if this is an instance of any missing event
        const isMatchingEvent = missingEvents.some(required => 
          (event.isRecurring && required.title === event.title) ||
          (!event.isRecurring && required.title === event.title)
        );
        return isMatchingEvent && eventDate >= today;
      })
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

    return availableEvents[0];
  };

  const renderAssignmentInfo = (subcategory) => {
    return (
      <div className="assignment-info">
        {subcategory.assignedAt && (
          <small>
            Assigned: {new Date(subcategory.assignedAt).toLocaleDateString()}
            {subcategory.assignedBy && ` by ${subcategory.assignedBy}`}
          </small>
        )}
        {subcategory.instructorName && (
          <small className="instructor-info">
            Instructor: {subcategory.instructorName}
          </small>
        )}
        {subcategory.startedAt && (
          <small className="started-info">
            Started: {new Date(subcategory.startedAt).toLocaleDateString()}
          </small>
        )}
      </div>
    );
  };

  const renderRequiredProgress = (subcategory) => {
    if (subcategory.requiredTotal > 0) {
      const subcategoryEvents = eventsBySubcategory[subcategory.id] || [];
      // Sort events by date first
      const requiredEvents = subcategoryEvents
        .filter(event => event.status === 'required')
        .sort((a, b) => new Date(a.startDate) - new Date(b.startDate)); // Fixed missing parenthesis

      const completedEvents = requiredEvents.filter(event => 
        completionStatusMap[event.id]?.status === 'completed'
      );
      
      const inProgressEvents = requiredEvents.filter(event => 
        completionStatusMap[event.id]?.status === 'in-progress'
      );

      const missingEvents = requiredEvents.filter(event => 
        !completionStatusMap[event.id]?.status
      );

      // Reuse the same date formatting for all events
      const formatEventDate = (event) => {
        return `${formatDateString(event.startDate)} ${event.startHour}`;
      };

      return (
        <div className="required-progress">
          <small className="required-count">
            Required Events: {subcategory.requiredCompleted}/{subcategory.requiredTotal}
          </small>
          
          {requiredEvents.length > 0 && (
            <div className="required-events">
              {/* Show Completed Events */}
              {completedEvents.length > 0 && (
                <div className="completed-events">
                  <small style={{ color: '#10B981', display: 'block', marginTop: '4px' }}>
                    Completed events:
                  </small>
                  <ul style={{ fontSize: '12px', color: '#059669', marginTop: '2px', marginLeft: '12px', listStyle: 'disc' }}>
                    {completedEvents.map(event => (
                      <li key={event.id}>
                        {event.instanceTitle || event.title}
                        <small style={{ display: 'block', marginLeft: '8px', fontSize: '0.9em' }}>
                          Date: {formatEventDate(event)}
                        </small>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Show In Progress Events */}
              {inProgressEvents.length > 0 && (
                <div className="in-progress-events">
                  <small style={{ color: '#FBBF24', display: 'block', marginTop: '4px' }}>
                    In Progress events:
                  </small>
                  <ul style={{ fontSize: '12px', color: '#D97706', marginTop: '2px', marginLeft: '12px', listStyle: 'disc' }}>
                    {inProgressEvents.map(event => (
                      <li key={event.id}>
                        {event.instanceTitle || event.title}
                        <small style={{ display: 'block', marginLeft: '8px', fontSize: '0.9em' }}>
                          Event Date: {formatEventDate(event)}
                        </small>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Show Missing Events */}
              {missingEvents.length > 0 && (
                <div className="missing-events">
                  <small style={{ color: '#dc2626', display: 'block', marginTop: '4px' }}>
                    Required events remaining:
                  </small>
                  <ul style={{ fontSize: '12px', color: '#666', marginTop: '2px', marginLeft: '12px', listStyle: 'disc' }}>
                    {missingEvents.map(event => {
                      const nextEvent = getNextAvailableEvent([event]);
                      return (
                        <li key={event.id}>
                          {event.instanceTitle || event.title}
                          {event.instanceTitle !== event.title && event.isRecurring && (
                            <span style={{
                              fontSize: '0.9em',
                              color: '#666',
                              display: 'block',
                              marginLeft: '8px'
                            }}>
                              (Part of: {event.title})
                            </span>
                          )}
                          {nextEvent && nextEvent.startDate && (
                            <Link
                              to={`/church/${churchId}/event/${nextEvent.id}`}
                              style={{
                                display: 'block',
                                marginLeft: '8px',
                                marginTop: '4px',
                                fontSize: '0.9em',
                                color: '#2563eb',
                                textDecoration: 'none',
                                padding: '4px 8px',
                                backgroundColor: '#eff6ff',
                                borderRadius: '4px',
                                width: 'fit-content'
                              }}
                            >
                              Next available: {formatDateString(nextEvent.startDate)} {nextEvent.startHour}
                              <span style={{ marginLeft: '4px' }}>→</span>
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ 
                width: `${(subcategory.requiredCompleted / subcategory.requiredTotal) * 100}%`,
                backgroundColor: subcategory.requiredCompleted === subcategory.requiredTotal ? '#10B981' : '#FBBF24'
              }}
            />
          </div>
        </div>
      );
    }
    return null;
  };

  if (loading) return <Skeleton count={3} />;

  return (
    <div className="courses-grid">
      {courses.map(category => (
        <div key={category.id} className="category-section">
          <h3 className="category-title">{category.name}</h3>
          
          {category.subcategories.completed.length > 0 && (
            <div className="status-group completed">
              <h4>Completed</h4>
              <div className="cards-grid">
                {category.subcategories.completed.map(sub => (
                  <div 
                    key={sub.id}
                    className="course-card completed"
                    onClick={() => onSubcategoryClick(sub.categoryId, sub.id)}
                  >
                    <div className="card-content">
                      <div className="subcategory-header">
                        <span className="order-badge">#{sub.order || 1}</span>
                        <h3 className="subcategory-name">{sub.name}</h3>
                      </div>
                      <div className="card-details">
                        {renderRequiredProgress(sub)}
                        {renderAssignmentInfo(sub)}
                        {sub.completedAt && (
                          <small className="completion-date" style={{ color: 'rgba(255, 255, 255, 0.9)', marginTop: '0.5rem', display: 'block' }}>
                            Completed: {new Date(sub.completedAt).toLocaleDateString()}
                          </small>
                        )}
                      </div>
                    </div>
                    <div className="card-status-icon">✓</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {category.subcategories.inProgress.length > 0 && (
            <div className="status-group in-progress">
              <h4>In Progress</h4>
              <div className="cards-grid">
                {category.subcategories.inProgress.map(sub => (
                  <div 
                    key={sub.id}
                    className="course-card in-progress"
                    onClick={() => onSubcategoryClick(sub.categoryId, sub.id)}
                  >
                    <div className="card-content">
                      <div className="subcategory-header">
                        <span className="order-badge">#{sub.order || 1}</span>
                        <h3 className="subcategory-name">{sub.name}</h3>
                      </div>
                      <div className="card-details">
                        {renderRequiredProgress(sub)}
                        {renderAssignmentInfo(sub)}
                      </div>
                    </div>
                    <div className="card-status-icon">↻</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {category.subcategories.notStarted.length > 0 && (
            <div className="status-group not-started">
              <h4>Not Started</h4>
              <div className="cards-grid">
                {category.subcategories.notStarted.map(sub => (
                  <div 
                    key={sub.id}
                    className="course-card not-started"
                    onClick={() => onSubcategoryClick(sub.categoryId, sub.id)}
                  >
                    <div className="card-content">
                      <div className="subcategory-header">
                        <span className="order-badge">#{sub.order || 1}</span>
                        <h3 className="subcategory-name">{sub.name}</h3>
                      </div>
                      <div className="card-details">
                        {renderRequiredProgress(sub)}
                        {renderAssignmentInfo(sub)}
                      </div>
                    </div>
                    <div className="card-status-icon">○</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      {courses.length === 0 && (
        <div className="no-courses">
          <p>No courses available.</p>
        </div>
      )}
    </div>
  );
};

const CourseAdmin = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [categories, setCategories] = useState([]);
  const [upcomingEvents, setUpcomingEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [completionLogs, setCompletionLogs] = useState({});
  const [selectedImage, setSelectedImage] = useState(null);

  // Disable scroll when modal is open
  useEffect(() => {
    if (selectedImage) {
      document.body.style.overflow = "hidden"; // Disable scrolling
    } else {
      document.body.style.overflow = "auto"; // Restore scrolling
    }
    return () => {
      document.body.style.overflow = "auto";
    };
  }, [selectedImage]);

  const fetchCategories = async () => {
    try {
      console.log("Fetching categories for church:", id);
      const categoriesSnap = await getDocs(
        query(collection(db, "coursecategories"), where("churchId", "==", id))
      );
      const categoriesData = categoriesSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      console.log("Fetched categories:", categoriesData);
      setCategories(categoriesData);
    } catch (err) {
      console.error("Error fetching categories:", err);
    }
  };

  const fetchCompletionLogs = async (eventIds) => {
    try {
      // Get current user's document
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (!userDoc.exists()) {
        console.error("User document not found");
        return;
      }

      const userData = userDoc.data();
      const logsMap = {};

      eventIds.forEach(eventId => {
        // Check courseCompletions array for event status
        const courseCompletions = userData.courseCompletions || [];
        const eventCompletion = courseCompletions.find(c => c.eventId === eventId);

        let courseStatus = 'not-started';
        if (eventCompletion) {
          console.log('Found completion record:', eventCompletion);
          if (eventCompletion.status === 'completed' || eventCompletion.checkOutTime) {
            courseStatus = 'completed';
          } else if (eventCompletion.status === 'in-progress' || eventCompletion.checkInTime) {
            courseStatus = 'in-progress';
          }
        }

        console.log(`Final status for event ${eventId}:`, courseStatus);
        logsMap[eventId] = { courseStatus };
      });

      setCompletionLogs(logsMap);
    } catch (error) {
      console.error("Error fetching completion logs:", error);
      setCompletionLogs({});
    }
  };

  const fetchUpcomingEvents = async () => {
    try {
      setEventsLoading(true);
      const today = new Date()
        .toLocaleDateString("en-US", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        })
        .replace(/(\d+)\/(\d+)\/(\d+)/, "$1-$2-$3");

      const eventsQuery = query(
        collection(db, "eventInstances"),
        where("churchId", "==", id),
        where("startDate", ">=", today)
      );

      const eventsSnapshot = await getDocs(eventsQuery);

      if (eventsSnapshot.empty) {
        setUpcomingEvents([]);
        return;
      }

      const eventsData = eventsSnapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...doc.data(),
          categoryId: doc.data().categoryId || "",
          subcategoryId: doc.data().subcategoryId || "",
          startDate: doc.data().startDate,
          endDate: doc.data().endDate,
        }))
        // Filter out deleted events
        .filter(event => !event.isDeleted)
        .sort((a, b) => {
          const aDate = a.startDate.split("-").reverse().join("-");
          const bDate = b.startDate.split("-").reverse().join("-");
          const dateCompare = aDate.localeCompare(bDate);
          if (dateCompare !== 0) return dateCompare;
          return a.startHour.localeCompare(b.startHour);
        });

      setUpcomingEvents(eventsData);
      // Fetch completion logs for all events
      await fetchCompletionLogs(eventsData.map(e => e.id));
    } catch (error) {
      console.error("Error fetching events:", error);
      setError("Failed to load upcoming events");
    } finally {
      setEventsLoading(false);
    }
  };

  useEffect(() => {
    const initialize = async () => {
      if (!user) return;
      console.log("Initializing with church ID:", id);
      setLoading(true);
      try {
        await createDefaultCategories(id);
        await fetchCategories();
        await fetchUpcomingEvents();
      } catch (error) {
        console.error("Initialization error:", error);
        setError("Failed to initialize page");
      } finally {
        setLoading(false);
      }
    };

    initialize();
  }, [id, user]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (!user) {
        // Redirect to login if not authenticated
        navigate(`/church/${id}/login`);
      }
    });

    return () => unsubscribe();
  }, [id, navigate]);

  const handleSubcategoryClick = (categoryId, subcategoryId) => {
    // Store referrer information before navigating
    sessionStorage.setItem('courseCategoryReferrer', 'churchApp');
    navigate(`/church/${id}/course/${categoryId}/subcategory/${subcategoryId}`);
  };

  const openModal = (imageUrl) => {
    setSelectedImage(imageUrl);
  };

  // Function to close the modal
  const closeModal = () => {
    setSelectedImage(null);
  };

  const renderEventsTable = () => {
    if (eventsLoading) {
      return <Skeleton count={5} height={50} className="mb-2" />;
    }

    if (upcomingEvents.length === 0) {
      return (
        <div className="text-center py-8 bg-gray-50 rounded-lg">
          <p className="text-gray-500">No upcoming events scheduled.</p>
        </div>
      );
    }

    const getCategoryAndSubcategoryNames = (event) => {
      const category = categories.find((cat) => cat.id === event.categoryId);
      if (!category)
        return { categoryName: "Unknown", subcategoryName: "Unknown" };

      const subcategory = category.subcategories?.find(
        (sub) => sub.id === event.subcategoryId
      );
      return {
        categoryName: category.name || "Unknown",
        subcategoryName: subcategory?.name || "Unknown",
      };
    };

    return (
      <div className="custom-table-container">
        <table className="custom-table">
          <thead className="custom-table-header">
            <tr>
              <th>Title</th>
              <th>Image</th>
              <th>Category</th>
              <th>Subcategory</th>
              <th>Date</th>
              <th>Time</th>
              <th>Status</th>
              <th>Recurring</th>
              <th>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody className="custom-table-body">
            {upcomingEvents.map((event) => {
              const { categoryName, subcategoryName } =
                getCategoryAndSubcategoryNames(event);
              const firstLetter = subcategoryName.substring(0, 1).toUpperCase();
              const notesCount = completionLogs[event.id] || { courseStatus: 'not-started' };
              return (
                <tr key={event.id}>
                  <td>
                    {event.instanceTitle || event.title} {/* Show instanceTitle if it exists, otherwise show title */}
                    {event.instanceTitle !== event.title && event.isRecurring && (
                      <span style={{
                        fontSize: '0.8em',
                        color: '#666',
                        display: 'block'
                      }}>
                        (Part of: {event.title})
                      </span>
                    )}
                  </td>
                  <td>
                    {event.imageUrl ? (
                      <div
                        style={{
                          width: "60px",
                          height: "40px",
                          overflow: "hidden",
                          cursor: "pointer",
                        }}
                        onClick={() => openModal(event.imageUrl)}
                      >
                        <img
                          src={event.imageUrl}
                          style={{ width: "auto", height: "100%" }}
                        />
                      </div>
                    ) : (
                      <div
                        style={{
                          width: "60px",
                          height: "40px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: "#33B5E5",
                          color: "#fff",
                          fontWeight: "bold",
                          fontSize: "1.2rem",
                          textTransform: "uppercase",
                          cursor: "default",
                        }}
                      >
                        {firstLetter}
                      </div>
                    )}
                  </td>
                  <td>{categoryName}</td>
                  <td>
                    <span
                      className="text-primary"
                      onClick={() =>
                        handleSubcategoryClick(
                          event.categoryId,
                          event.subcategoryId
                        )
                      }
                    >
                      {subcategoryName}
                    </span>
                  </td>
                  <td>{formatDateString(event.startDate)}</td>
                  <td>
                    {event.startHour} - {event.endHour}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span className={`status-badge ${event.status || 'optional'}`}>
                        {event.status || 'optional'}
                      </span>                      <span className="order-badge" style={{
                        display: 'inline-block',
                        margin: '0 4px'
                      }}>
                        #{event.order || 1}
                      </span>
                    </div>
                  </td>
                  <td>
                    {event.isRecurring ? (
                      <span className="badge badge-green">
                        {event.recurrencePattern}
                      </span>
                    ) : (
                      <span className="badge badge-gray">One-time</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span style={{
                      backgroundColor: notesCount.courseStatus === 'completed' ? '#10B981' : 
                                      notesCount.courseStatus === 'in-progress' ? '#FBBF24' : '#EF4444',
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '0.8em',
                      display: 'inline-block'
                    }}>
                      {notesCount.courseStatus === 'completed' ? '✓ Course Completed' :
                      notesCount.courseStatus === 'in-progress' ? '↻ In Progress' : '✗ Not Started'}
                    </span>
                  </td>
                  <td>
                    <Link
                      to={`/church/${id}/event/${event.id}`}
                      className="text-primary"
                    >
                      View Details →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const handleBackClick = (id) => {
    navigate(`/organization/${id}/mi-organizacion`);
  };

  return (
    <div className={`page-container ${user ? `user-role-${user.role || 'member'}` : 'not-logged-in'}`}>
      <div className="nav-controls">
        <button
          onClick={() => handleBackClick(id)}
          style={{ ...commonStyles.backButtonLink }}
        >
          ← Back to Organization
        </button>
      </div>
      <ChurchHeader id={id} />
      <div className="page-header">
        <h1>Course Management</h1>
      </div>

      <div className="content-section">
        {user && (user.role === "global_admin" || user.role === "admin") && (
          <div className="admin-actions">
            <Link
              to={`/church/${id}/course-categories`}
              style={commonStyles.backButtonLink}
            >
              Manage Categories
            </Link>
            <Link
              to={`/church/${id}/course-manager`}
              style={commonStyles.backButtonLink}
            >
              Manage Courses
            </Link>
          </div>
        )}

        <div className="content-box">
          {error && <div className="alert alert-error">{error}</div>}

          {user && (
            <>
              <div className="user-progress-section">
                <h2 className="section-title">My Course Progress</h2>
                <UserCourseProgress
                  churchId={id}
                  onSubcategoryClick={handleSubcategoryClick}
                  upcomingEvents={upcomingEvents}
                />
              </div>

              <div className="upcoming-events-section">
                <div className="section-header">
                  <h2 className="section-title">Upcoming Events</h2>
                  <Link
                    to={`/church/${id}/all-events`}
                    style={{ ...commonStyles.backButtonLink }}
                    className="view-all-link"
                  >
                    View All Events →
                  </Link>
                </div>
                {renderEventsTable()}
              </div>
              
              {/* Image Modal with improved mobile responsiveness */}
              {selectedImage && (
                <div
                  className="modal-overlay"
                  onClick={closeModal}
                >
                  <div className="modal-content">
                    <div className="image-container">
                      <span
                        className="close-button"
                        onClick={closeModal}
                      >
                        &times;
                      </span>
                      <img
                        onClick={(e) => e.stopPropagation()}
                        src={selectedImage}
                        alt="Full Size"
                        className="modal-image"
                      />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const additionalStyles = `
.status-badge {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.8em;
  text-transform: capitalize;
}

.status-badge.required {
  background-color: #dc3545;
  color: white;
}

.status-badge.optional {
  background-color: #6c757d;
  color: white;
}

.courses-grid {
  display: grid;
  gap: 2rem;
  margin-top: 1rem;
}

.category-section {
  background: white;
  padding: 1.5rem;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.category-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #374151;
  margin-bottom: 1rem;
}

.status-group {
  margin-bottom: 1.5rem;
}

.status-group h4 {
  font-size: 1rem;
  font-weight: 500;
  color: #6B7280;
  margin-bottom: 0.5rem;
}

.course-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.course-item.completed {
  background-color: #D1FAE5;
  border: 1px solid #10B981;
}

.course-item.in-progress {
  background-color: #FEF3C7;
  border: 1px solid #FBBF24;
}

.course-item.not-started {
  background-color: #FEE2E2;
  border: 1px solid #EF4444;
}

.status-icon {
  font-weight: bold;
}

.course-item:hover {
  opacity: 0.8;
}

.no-courses {
  text-align: center;
  padding: 2rem;
  background: #F3F4F6;
  border-radius: 8px;
  color: #6B7280;
}

.course-info {
  display: flex;
  flex-direction: column;
}

.progress-info {
  font-size: 0.75rem;
  color: #6B7280;
  margin-top: 0.25rem;
}

.assignment-info {
  font-size: 0.75rem;
  color: #6B7280;
  margin-top: 0.25rem;
}

.completion-date {
  font-size: 0.75rem;
  color: #059669;
  margin-top: 0.25rem;
}

.required-progress {
  margin-top: 0.25rem;
}

.required-count {
  font-size: 0.75rem;
  color: #6B7280;
}

.progress-bar {
  height: 4px;
  background-color: #E5E7EB;
  border-radius: 2px;
  margin-top: 0.25rem;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  transition: width 0.3s ease;
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1rem;
}

.course-card {
  background: white;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.course-card.completed {
  border: 1px solid #10B981;
  background-color: rgba(16, 185, 129, 0.1);
}

.course-card.in-progress {
  border: 1px solid #FBBF24;
  background-color: rgba(251, 191, 36, 0.1);
}

.course-card.not-started {
  border: 1px solid #EF4444;
  background-color: rgba(239, 68, 68, 0.1);
}

.course-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
}

.card-content {
  flex-grow: 1;
}

/* Card title styling removed as we're using subcategory-name instead */

.card-details {
  font-size: 0.875rem;
  color: #6B7280;
}

.card-status-icon {
  font-size: 1.5rem;
  font-weight: bold;
  color: #6B7280;
  align-self: flex-end;
}

/* Dark mode specific styling */
@media (prefers-color-scheme: dark) {
  .course-card.completed {
    background-color: rgba(16, 185, 129, 0.2);
  }
  
  .course-card.in-progress {
    background-color: rgba(251, 191, 36, 0.2);
  }
  
  .course-card.not-started {
    background-color: rgba(239, 68, 68, 0.2);
  }
  
  .subcategory-name {
    color: #e5e7eb !important;
  }
  
  .subcategory-header .order-badge {
    background-color: rgba(79, 70, 229, 0.2);
    border-color: rgba(224, 231, 255, 0.3);
  }
}

.subcategory-header {
  display: flex !important;
  align-items: center !important;
  gap: 0.5rem !important;
  margin-bottom: 0.25rem !important;
}

.subcategory-header .order-badge {
  padding: 0.125rem 0.5rem;
  font-size: 0.75rem;
  background-color: #eef2ff;
  color: #4f46e5;
  border: 1px solid #e0e7ff;
  border-radius: 4px;
}

.subcategory-name {
  font-size: 1.25rem !important;
  font-weight: 600 !important;
  color: #374151 !important;
  margin: 0 !important;
}
`;

const styleSheet = document.createElement("style");
styleSheet.innerText = additionalStyles;
document.head.appendChild(styleSheet);

export default CourseAdmin;

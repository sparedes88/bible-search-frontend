import React, { useState, useEffect } from "react";
import { useNavigate, Link, useParams, useLocation } from "react-router-dom";
import { db, storage } from "../firebase";
import { 
  doc, 
  getDoc, 
  addDoc, 
  collection, 
  serverTimestamp, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  getDocs, 
  updateDoc, 
  deleteDoc, 
  arrayUnion
} from "firebase/firestore";
import { 
  ref, 
  uploadBytes, 
  getDownloadURL, 
  deleteObject 
} from "firebase/storage";
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from "html5-qrcode";
import Skeleton from "react-loading-skeleton";
import ChurchHeader from "./ChurchHeader";
import commonStyles from "../pages/commonStyles";
import { toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Select from "react-select";
import { QRCodeSVG } from "qrcode.react";
import QRCodeLabel from "./QRCodeLabel";
import { PDFDownloadLink } from "@react-pdf/renderer";
import ReactDOM from 'react-dom';
import { useAuth } from "../contexts/AuthContext";

const formatDate = (dateStr) => {
  if (!dateStr) return "";
  const parts = dateStr.includes('-') ? dateStr.split('-') : dateStr.split('/');
  if (parts[0].length === 4) {
    const [year, month, day] = parts;
    return `${month}/${day}/${year}`;
  }
  const [month, day, year] = parts;
  return `${month}/${day}/${year}`;
};

const formatRecurrenceInfo = (event) => {
  if (!event.isRecurring) return "";
  
  let info = `Recurring ${event.recurrencePattern}`;
  if (event.recurrenceEndDate) {
    info += ` until ${formatDate(event.recurrenceEndDate)}`;
  }
  return info;
};

const renderEventDetails = (event) => {
  if (!event) return null;

  return (
    <div style={{ marginBottom: '20px' }}>
      {(event.categoryName || event.subcategoryName) && (
        <div style={{ 
          display: 'flex', 
          gap: '8px', 
          marginBottom: '10px',
          fontSize: '14px',
          color: '#6B7280'
        }}>
          {event.categoryName && (
            <span style={{
              backgroundColor: '#EEF2FF',
              padding: '4px 12px',
              borderRadius: '16px',
              color: '#4F46E5'
            }}>
              {event.categoryName}
            </span>
          )}
          {event.subcategoryName && (
            <span style={{
              backgroundColor: '#F0FDF4',
              padding: '4px 12px',
              borderRadius: '16px',
              color: '#047857'
            }}>
              {event.subcategoryName}
            </span>
          )}
        </div>
      )}

      <div style={{ 
        marginBottom: '20px',
        padding: '15px', 
        backgroundColor: '#F9FAFB',
        borderRadius: '8px',
        fontSize: '16px'
      }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          marginBottom: '10px',
          color: '#1F2937' 
        }}>
          <span style={{ marginRight: '10px' }}>📅</span>
          <span>
            <strong>Date:</strong> {event.date || event.startDate || 'TBA'}
            {event.endDate && event.endDate !== event.startDate && ` - ${event.endDate}`}
          </span>
        </div>
        
        {(event.time || event.startTime) && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            marginBottom: '10px',
            color: '#1F2937' 
          }}>
            <span style={{ marginRight: '10px' }}>⏰</span>
            <span>
              <strong>Time:</strong> {event.time || event.startTime}
              {event.endTime && ` - ${event.endTime}`}
            </span>
          </div>
        )}
        
        {event.location && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center',
            marginBottom: '10px',
            color: '#1F2937' 
          }}>
            <span style={{ marginRight: '10px' }}>📍</span>
            <span>
              <strong>Location:</strong> {event.location}
            </span>
          </div>
        )}
        
        {event.isRecurring && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center',
            color: '#1F2937' 
          }}>
            <span style={{ marginRight: '10px' }}>🔄</span>
            <span>
              <strong>Recurring:</strong> {formatRecurrenceInfo(event)}
            </span>
          </div>
        )}
      </div>
      
      {event.description && (
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ 
            fontSize: '18px', 
            fontWeight: '600',
            marginBottom: '10px',
            color: '#1F2937'
          }}>
            Description
          </h3>
          <div style={{ 
            backgroundColor: 'white',
            padding: '15px',
            borderRadius: '8px',
            border: '1px solid #E5E7EB',
            fontSize: '16px',
            lineHeight: '1.6',
            color: '#4B5563',
            whiteSpace: 'pre-wrap'
          }}>
            {event.description}
          </div>
        </div>
      )}
    </div>
  );
};

const EventDetails = () => {
  const { id, eventId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [error, setError] = useState(null);
  const [categoryInfo, setCategoryInfo] = useState(null);
  const [showScanner, setShowScanner] = useState(false);
  const [scannerError, setScannerError] = useState(null);
  const [scanner, setScanner] = useState(null);
  const [scanLogs, setScanLogs] = useState([]);
  const [manualInput, setManualInput] = useState('');
  const [availableRooms, setAvailableRooms] = useState([]);
  const [selectedRooms, setSelectedRooms] = useState([]);
  const [isManagingRooms, setIsManagingRooms] = useState(false);
  const [eventImage, setEventImage] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [childCheckInForm, setChildCheckInForm] = useState({
    parentId: '',
    childName: '',
    age: '',
    allergies: '',
    roomId: '',
    notes: ''
  });
  const [showChildCheckIn, setShowChildCheckIn] = useState(false);
  const [childCheckInLogs, setChildCheckInLogs] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [hasChildren, setHasChildren] = useState(false);
  const [registrations, setRegistrations] = useState([]);
  const [registrationsLoading, setRegistrationsLoading] = useState(true);
  const [courseCompletionLogs, setCourseCompletionLogs] = useState([]);
  const [isExternalBrowser, setIsExternalBrowser] = useState(false);
  const [courseCompletionForm, setCourseCompletionForm] = useState({
    instructorName: '',
    notes: '',
    userId: '',
    firstName: '',
    lastName: ''
  });
  const [showCompletionForm, setShowCompletionForm] = useState(false);

  const [registrationForm, setRegistrationForm] = useState({
    name: '',
    lastName: '',
    email: '',
    phone: ''
  });
  const [submittingRegistration, setSubmittingRegistration] = useState(false);

  // Detect if coming from external source like Facebook
  useEffect(() => {
    // Check if this is likely opened from Facebook in-app browser
    const userAgent = navigator.userAgent || '';
    const isFacebookBrowser = userAgent.includes('FBAN') || userAgent.includes('FBAV') || document.referrer.includes('facebook');
    setIsExternalBrowser(isFacebookBrowser);
    
    if (isFacebookBrowser) {
      console.log("Facebook in-app browser detected");
      // Force reload assets that might be cached incorrectly
      const preconnect = document.createElement('link');
      preconnect.rel = 'preconnect';
      preconnect.href = 'https://firebasestorage.googleapis.com';
      document.head.appendChild(preconnect);
    }
  }, []);

  const fetchAllLogs = async () => {
    if (!user) return;
    
    try {
      // Fetch event registrations
      const registrationsRef = collection(db, 'eventRegistrations');
      const regQuery = query(registrationsRef, where('eventId', '==', eventId));
      const regSnap = await getDocs(regQuery);
      
      const attendanceLogs = regSnap.docs.map(doc => ({
        id: doc.id,
        userId: doc.data().userId,
        firstName: doc.data().name,
        lastName: doc.data().lastName,
        email: doc.data().email,
        phone: doc.data().phone,
        timestamp: doc.data().registeredAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        source: doc.data().source || 'unknown',
        ...doc.data()
      }));

      // Fetch child care logs from users collection
      const usersRef = collection(db, 'users');
      const usersSnap = await getDocs(usersRef);
      const childCareLogs = [];
      const completionLogs = [];

      usersSnap.docs.forEach(doc => {
        const userData = doc.data();
        
        if (userData.childCare) {
          userData.childCare
            .filter(log => log.eventId === eventId)
            .forEach(log => {
              childCareLogs.push({
                ...log,
                userId: doc.id,
                parentName: `${userData.name} ${userData.lastName}`
              });
            });
        }

        if (userData.courseCompletions) {
          userData.courseCompletions
            .filter(log => log.eventId === eventId)
            .forEach(log => {
              completionLogs.push({
                ...log,
                userId: doc.id,
                firstName: userData.name,
                lastName: userData.lastName
              });
            });
        }
      });

      setScanLogs(attendanceLogs.sort((a, b) => {
        const aTime = new Date(a.timestamp).getTime();
        const bTime = new Date(b.timestamp).getTime();
        return bTime - aTime;
      }));
      setChildCheckInLogs(childCareLogs.sort((a, b) => b.checkInTime - a.checkInTime));
      setCourseCompletionLogs(completionLogs.sort((a, b) => b.startedAt - a.startedAt));
    } catch (error) {
      console.error('Error fetching logs:', error);
      if (user) toast.error('Failed to fetch logs');
    }
  };

  const handleRemoveScan = async (scanId, userId) => {
    if (!window.confirm('Are you sure you want to remove this registration record?')) {
      return;
    }

    try {
      if (!scanId) {
        toast.error('Registration ID is required');
        return;
      }

      // Delete from eventRegistrations collection
      await deleteDoc(doc(db, 'eventRegistrations', scanId));

      await fetchAllLogs();
      toast.success('Registration record removed successfully');
    } catch (err) {
      console.error('Error removing registration:', err);
      toast.error('Failed to remove attendance record');
    }
  };

  useEffect(() => {
    const fetchEventDetails = async () => {
      if (!eventId) return;
      
      try {
        setLoading(true);
        let eventData = null;
        let eventDoc = null;

        // First try to get the event from eventInstances collection
        try {
          eventDoc = await getDoc(doc(db, "eventInstances", eventId));
          
          if (eventDoc.exists()) {
            eventData = eventDoc.data();
            setEvent({ id: eventDoc.id, ...eventData });
            
            // If the event has a category, fetch category details
            if (eventData.categoryId) {
              try {
                const categoryDoc = await getDoc(doc(db, "coursecategories", eventData.categoryId));
                if (categoryDoc.exists()) {
                  const category = categoryDoc.data();
                  const subcategory = category.subcategories?.find(sub => sub.id === eventData.subcategoryId);
                  setCategoryInfo({
                    categoryName: category.name,
                    subcategoryName: subcategory?.name
                  });
                }
              } catch (categoryErr) {
                console.log("Category details could not be loaded:", categoryErr);
              }
            }
            
            setLoading(false);
            return;
          }
        } catch (instanceErr) {
          console.log("Event not found in eventInstances:", instanceErr);
        }
        
        // If not found in eventInstances, try the events collection
        try {
          eventDoc = await getDoc(doc(db, "events", eventId));
          
          if (eventDoc.exists()) {
            eventData = eventDoc.data();
            setEvent({ id: eventDoc.id, ...eventData });
            setLoading(false);
            return;
          }
        } catch (eventErr) {
          console.log("Event not found in events collection:", eventErr);
        }

        // If still not found, try course categories as a last resort
        try {
          const courseEventsQuery = query(
            collection(db, "coursecategories"),
            where("subcategories", "array-contains", { events: [{ id: eventId }] })
          );
          const courseSnapshot = await getDocs(courseEventsQuery);
          
          if (!courseSnapshot.empty) {
            const categoryDoc = courseSnapshot.docs[0];
            const category = categoryDoc.data();
            const subcategory = category.subcategories.find(sub => 
              sub.events?.some(event => event.id === eventId)
            );
            eventData = subcategory.events.find(event => event.id === eventId);
            if (eventData) {
              setEvent({
                id: eventId,
                categoryId: categoryDoc.id,
                categoryName: category.name,
                subcategoryId: subcategory.id,
                subcategoryName: subcategory.name,
                ...eventData
              });
              setLoading(false);
              return;
            }
          }
        } catch (courseErr) {
          console.log("Event not found in course categories:", courseErr);
        }
        
        // If we get here, the event was not found in any collection
        setError('Event not found in any collection. It may have been deleted or you may not have permission to view it.');
        
      } catch (err) {
        console.error("Error details:", err);
        if (err.code === 'permission-denied') {
          setError('You do not have permission to view this event. Please log in or contact an administrator.');
        } else {
          setError(err.message || 'Error loading event details');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchEventDetails();
  }, [eventId, user]);

  useEffect(() => {
    const fetchRooms = async () => {
      if (!id || !user) return;
      
      try {
        const roomsRef = collection(db, `churches/${id}/rooms`);
        const snapshot = await getDocs(roomsRef);
        const rooms = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setAvailableRooms(rooms);
      } catch (err) {
        console.error('Error fetching rooms:', err);
        if (user) toast.error('Failed to load rooms');
      }
    };

    fetchRooms();
  }, [id, user]);

  useEffect(() => {
    if (!event?.rooms) return;
    setSelectedRooms(event.rooms);
  }, [event]);

  const handleUpdateRooms = async (selectedOptions) => {
    try {
      const eventRef = doc(db, "eventInstances", eventId);
      const updatedRooms = selectedOptions?.map(option => ({
        id: option.value,
        name: option.label
      })) || [];

      await updateDoc(eventRef, {
        rooms: updatedRooms
      });

      setSelectedRooms(updatedRooms);
      toast.success('Event rooms updated successfully');
    } catch (err) {
      console.error('Error updating event rooms:', err);
      toast.error('Failed to update event rooms');
    }
  };

  // Try to extract a userId from various QR payload formats
  const extractUserIdFromScan = (text) => {
    try {
      if (!text || typeof text !== 'string') return null;

      const trimmed = text.trim();

      // Case 1: JSON payload { uid: "..." } or { userId: "..." }
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
        try {
          const obj = JSON.parse(trimmed);
          const cand = obj.uid || obj.userId || obj.id;
          if (typeof cand === 'string' && cand.length >= 20) return cand;
        } catch (_) { /* ignore parse errors */ }
      }

      // Case 2: URL with uid/userId param or uid in path
      if (/^https?:\/\//i.test(trimmed)) {
        try {
          const u = new URL(trimmed);
          const cand = u.searchParams.get('uid') || u.searchParams.get('userId') || u.searchParams.get('id');
          if (cand && cand.length >= 20) return cand;
          // Try last path segment if it looks like an id
          const segs = u.pathname.split('/').filter(Boolean);
          const last = segs[segs.length - 1] || '';
          if (last.length >= 20) return last;
        } catch (_) { /* ignore URL errors */ }
      }

      // Case 3: Prefixed string like user:UID or uid:UID
      const prefixMatch = trimmed.match(/^(?:user|uid|id)[:=]([A-Za-z0-9_-]{20,})$/i);
      if (prefixMatch) return prefixMatch[1];

      // Case 4: Raw UID-looking string (Firebase UIDs are ~28 chars base64url-ish)
      if (/^[A-Za-z0-9_-]{20,}$/.test(trimmed)) return trimmed;

      return null;
    } catch (e) {
      return null;
    }
  };

  const startScanner = () => {
    try {
      const html5QrcodeScanner = new Html5QrcodeScanner(
        "qr-reader",
        { 
          fps: 10,
          qrbox: {
            width: 250,
            height: 250,
          },
          rememberLastUsedCamera: true,
          aspectRatio: 1,
          showTorchButtonIfSupported: true,
          formatsToSupport: [ Html5QrcodeSupportedFormats.QR_CODE ],
        }
      );

      let scanning = true;
      html5QrcodeScanner.render(
        async (decodedText) => {
          if (!scanning) return;
          scanning = false;
          await handleScanResult({ text: decodedText });
          scanning = true;
        }, 
        (errorMessage) => {
          if (errorMessage && 
              !errorMessage.includes("No MultiFormat Readers") && 
              !errorMessage.includes("No QR code found")) {
            console.error(errorMessage);
          }
        }
      );

      setScanner(html5QrcodeScanner);
    } catch (err) {
      console.error('Scanner initialization error:', err);
    }
  };

  const handleAttendanceRecord = async (userId, source = 'manual') => {
    try {
      userId = userId.trim();
      
      if (!userId) {
        setScannerError('Please enter a valid user ID');
        return false;
      }

      const userDoc = await getDoc(doc(db, 'users', userId));
      if (!userDoc.exists()) {
        setScannerError('User not found');
        return false;
      }

      const userData = userDoc.data();
      const firstName = userData.name || '';
      const lastName = userData.lastName || '';

      // Check if already registered
      const registrationsRef = collection(db, 'eventRegistrations');
      const existingQuery = query(
        registrationsRef,
        where('eventId', '==', eventId),
        where('userId', '==', userId)
      );
      const existingSnap = await getDocs(existingQuery);

      if (!existingSnap.empty) {
        toast.info(`${firstName} ${lastName} is already registered`);
        if (source === 'manual') setManualInput('');
        return true;
      }

      // Create event registration
      await addDoc(collection(db, 'eventRegistrations'), {
        eventId,
        churchId: id,
        userId,
        name: firstName,
        lastName: lastName || '',
        email: userData.email || '',
        phone: userData.phone || '',
        status: 'registered',
        registeredAt: serverTimestamp(),
        eventName: event?.title || '',
        eventDate: event?.startDate || '',
        source: source === 'scan' ? 'qr-scan' : 'manual-checkin'
      });

      await fetchAllLogs();

      if (source === 'manual') setManualInput('');
      toast.success(`${firstName} ${lastName} registered for event!`);
      setSelectedChild({ userId, firstName, lastName });
      setShowChildCheckIn(true);
      return true;

    } catch (error) {
      console.error('Error recording attendance:', error);
      setScannerError('Error recording attendance');
      toast.error('Error recording attendance');
      return false;
    }
  };

  const handleChildCheckIn = async (e) => {
    e.preventDefault();
    if (!childCheckInForm.childName) {
      toast.error('Child name is required');
      return;
    }

    const selectedRoom = selectedRooms.length === 1 
      ? selectedRooms[0] 
      : selectedRooms.find(room => room.id === childCheckInForm.roomId);

    if (!selectedRoom) {
      toast.error('No room available for check-in');
      return;
    }

    try {
      const timestamp = new Date();
      const checkInData = {
        id: Date.now().toString(),
        eventId,
        eventName: event.title,
        childName: childCheckInForm.childName,
        age: childCheckInForm.age,
        allergies: childCheckInForm.allergies,
        roomId: selectedRoom.id,
        roomName: selectedRoom.name,
        notes: childCheckInForm.notes,
        checkInTime: timestamp.toISOString(),
        status: 'checked-in',
        createdAt: timestamp.toISOString()
      };

      await updateDoc(doc(db, 'users', selectedChild.userId), {
        childCare: arrayUnion(checkInData)
      });

      await fetchAllLogs();

      setChildCheckInForm({
        parentId: '',
        childName: '',
        age: '',
        allergies: '',
        roomId: '',
        notes: ''
      });
      setShowChildCheckIn(false);
      toast.success('Child checked in successfully!');

    } catch (err) {
      console.error('Error checking in child:', err);
      toast.error('Failed to check in child');
    }
  };

  const handleCheckOutChild = async (checkInId) => {
    if (window.confirm('Are you sure you want to check out this child?')) {
      try {
        const userDoc = await getDoc(doc(db, 'users', selectedChild.userId));
        const userData = userDoc.data();
        const updatedChildCare = userData.childCare.map(record => {
          if (record.id === checkInId) {
            return {
              ...record,
              status: 'checked-out',
              checkOutTime: serverTimestamp()
            };
          }
          return record;
        });

        await updateDoc(doc(db, 'users', selectedChild.userId), {
          childCare: updatedChildCare
        });

        await fetchAllLogs();

        toast.success('Child checked out successfully');
      } catch (err) {
        console.error('Error checking out child:', err);
        toast.error('Failed to check out child');
      }
    }
  };

  const handleRemoveChildCheckIn = async (checkInId, userId) => {
    if (!window.confirm('Are you sure you want to remove this check-in record?')) {
      return;
    }

    try {
      if (!userId) {
        toast.error('User ID is required');
        return;
      }

      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        toast.error('User not found');
        return;
      }

      const userData = userDoc.data();
      const updatedChildCare = userData.childCare?.filter(record => record.id !== checkInId) || [];

      await updateDoc(userRef, {
        childCare: updatedChildCare,
        lastUpdated: serverTimestamp()
      });

      await fetchAllLogs();

      toast.success('Child check-in record removed successfully');
    } catch (err) {
      console.error('Error removing child check-in:', err);
      toast.error('Failed to remove child check-in record');
    }
  };

  const handleCourseCompletion = async (userId, firstName, lastName) => {
    try {
      if (!courseCompletionForm.instructorName) {
        toast.error('Instructor name is required');
        return;
      }

      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        toast.error('User not found');
        return;
      }

      const userData = userDoc.data();
      const courseCompletions = userData.courseCompletions || [];
      const timestamp = new Date();

      const existingCompletion = courseCompletions.find(c => c.eventId === eventId);
      
      if (existingCompletion) {
        const updatedCompletions = courseCompletions.map(completion => {
          if (completion.eventId === eventId) {
            return {
              ...completion,
              instructorName: courseCompletionForm.instructorName,
              notes: courseCompletionForm.notes,
              updatedAt: timestamp.toISOString(),
              status: 'in-progress'
            };
          }
          return completion;
        });

        await updateDoc(userRef, {
          courseCompletions: updatedCompletions
        });
      } else {
        const completionData = {
          id: Date.now().toString(),
          eventId,
          eventName: event.title,
          instructorName: courseCompletionForm.instructorName,
          notes: courseCompletionForm.notes,
          startedAt: timestamp.toISOString(),
          status: 'in-progress',
          createdAt: timestamp.toISOString(),
          categoryId: event.categoryId,
          subcategoryId: event.subcategoryId
        };

        await updateDoc(userRef, {
          courseCompletions: arrayUnion(completionData)
        });
      }

      if (event.categoryId && event.subcategoryId) {
        const courseAssignments = userData.courseAssignments || [];
        const existingAssignment = courseAssignments.find(
          a => a.categoryId === event.categoryId && a.subcategoryId === event.subcategoryId
        );

        if (!existingAssignment) {
          await updateDoc(userRef, {
            courseAssignments: arrayUnion({
              categoryId: event.categoryId,
              subcategoryId: event.subcategoryId,
              assignedAt: timestamp.toISOString(),
              status: 'in-progress',
              assignedBy: user.email
            })
          });
        }
      }

      toast.success(`Course started for ${firstName} ${lastName}`);
      setShowCompletionForm(false);
      setCourseCompletionForm({
        instructorName: '',
        notes: '',
        userId: '',
        firstName: '',
        lastName: ''
      });

      await fetchAllLogs();
    } catch (err) {
      console.error('Error starting course:', err);
      toast.error('Failed to start course');
    }
  };

  const handleCompleteCourse = async (logId) => {
    try {
      if (!user) {
        toast.error('User not authenticated');
        return;
      }

      const completionLog = courseCompletionLogs.find(log => log.id === logId);
      if (!completionLog) {
        toast.error('Completion record not found');
        return;
      }

      const userRef = doc(db, 'users', completionLog.userId);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        toast.error('User not found');
        return;
      }

      const userData = userDoc.data();
      const courseCompletions = userData.courseCompletions || [];

      const now = new Date();
      const completionTimestamp = now.toISOString();

      const updatedCompletions = courseCompletions.map(completion => {
        if (completion.id === logId) {
          return {
            ...completion,
            status: 'completed',
            completedAt: completionTimestamp,
            completedBy: user.email
          };
        }
        return completion;
      });

      await updateDoc(userRef, {
        courseCompletions: updatedCompletions
      });

      if (event.status === 'required' && event.subcategoryId) {
        const subcategoryEvents = await getDocs(
          query(
            collection(db, 'eventInstances'),
            where('subcategoryId', '==', event.subcategoryId),
            where('status', '==', 'required')
          )
        );

        const requiredEventIds = subcategoryEvents.docs.map(doc => doc.id);
        const completedRequired = updatedCompletions.filter(
          completion => requiredEventIds.includes(completion.eventId) && completion.status === 'completed'
        );

        if (completedRequired.length === requiredEventIds.length) {
          await updateDoc(userRef, {
            completionLogs: arrayUnion({
              subcategoryId: event.subcategoryId,
              completedAt: completionTimestamp,
              completedAtFormatted: now.toLocaleString(),
              note: `Completed all required events`,
              status: 'completed'
            })
          });
        }
      }

      await fetchAllLogs();
      toast.success('Course marked as complete successfully');
    } catch (error) {
      console.error('Error completing course:', error);
      toast.error('Failed to complete course');
    }
  };

  const handleRemoveCourseCompletion = async (logId) => {
    if (!window.confirm('Are you sure you want to remove this course completion?')) {
      return;
    }

    try {
      const completionLog = courseCompletionLogs.find(log => log.id === logId);
      if (!completionLog) {
        toast.error('Completion record not found');
        return;
      }

      const userRef = doc(db, 'users', completionLog.userId);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        toast.error('User not found');
        return;
      }

      const userData = userDoc.data();
      const updatedCompletions = userData.courseCompletions.filter(
        completion => completion.id !== logId
      );

      await updateDoc(userRef, {
        courseCompletions: updatedCompletions
      });

      if (event.status === 'required' && event.subcategoryId) {
        const updatedLogs = (userData.completionLogs || []).filter(
          log => log.subcategoryId !== event.subcategoryId
        );

        await updateDoc(userRef, {
          completionLogs: updatedLogs
        });
      }

      await fetchAllLogs();

      toast.success('Course completion removed successfully');
    } catch (error) {
      console.error('Error removing course completion:', error);
      toast.error('Failed to remove course completion');
    }
  };

  const handleScanResult = async (result) => {
    if (!result?.text || attendanceLoading) return;

    setAttendanceLoading(true);
    try {
      const scannedText = String(result.text || '').trim();
      const extractedUserId = extractUserIdFromScan(scannedText);
      if (!extractedUserId) {
        toast.error('Invalid QR code. Could not determine user ID.');
      } else {
        await handleAttendanceRecord(extractedUserId, 'scan');
      }
    } finally {
      // Always stop/close scanner after scan attempt
      if (scanner) {
        try {
          await scanner.clear();
        } catch (err) {
          console.error('Error clearing scanner:', err);
        }
        try {
          await scanner.stop();
        } catch (err) {
          // Some implementations throw if already stopped; ignore
        }
        setShowScanner(false);
        setScanner(null);
      }
      setAttendanceLoading(false);
    }
  };

  const handleUserLookupByPhone = async (phoneNumber) => {
    try {
      const cleanedPhone = phoneNumber.replace(/\D/g, '');
      
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('phone', '==', cleanedPhone));
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        const userDoc = querySnapshot.docs[0];
        return handleAttendanceRecord(userDoc.id, 'manual');
      }

      // If not found in members, check visitors under this organization
      const visitorsRef = collection(db, 'visitors', id, 'visitors');
      const vq = query(visitorsRef, where('phone', '==', cleanedPhone));
      const vSnap = await getDocs(vq);

      if (!vSnap.empty) {
        const vDoc = vSnap.docs[0];
        const v = vDoc.data();
        // Redirect to member signup with prefilled data and event context
        navigate(`/organization/${id}/member-signup?eventId=${encodeURIComponent(eventId)}&phone=${encodeURIComponent(cleanedPhone)}&firstName=${encodeURIComponent(v.name || '')}&lastName=${encodeURIComponent(v.lastName || '')}&email=${encodeURIComponent(v.email || '')}&visitorId=${encodeURIComponent(vDoc.id)}`);
        return false;
      }

      // Not found anywhere → send to member signup with phone prefilled
      navigate(`/organization/${id}/member-signup?eventId=${encodeURIComponent(eventId)}&phone=${encodeURIComponent(cleanedPhone)}`);
      return false;
    } catch (error) {
      console.error('Error looking up user by phone:', error);
      setScannerError('Error looking up user');
      return false;
    }
  };

  const handleUserLookupByEmail = async (email) => {
    try {
      const trimmed = (email || '').trim().toLowerCase();
      if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        setScannerError('Please enter a valid email');
        return false;
      }

      // Look in members
      const usersRef = collection(db, 'users');
      const uq = query(usersRef, where('email', '==', trimmed));
      const uSnap = await getDocs(uq);
      if (!uSnap.empty) {
        const userDoc = uSnap.docs[0];
        return handleAttendanceRecord(userDoc.id, 'manual');
      }

      // Look in visitors for prefill
      const visitorsRef = collection(db, 'visitors', id, 'visitors');
      const vq = query(visitorsRef, where('email', '==', trimmed));
      const vSnap = await getDocs(vq);
      if (!vSnap.empty) {
        const vDoc = vSnap.docs[0];
        const v = vDoc.data();
        navigate(`/organization/${id}/member-signup?eventId=${encodeURIComponent(eventId)}&email=${encodeURIComponent(trimmed)}&firstName=${encodeURIComponent(v.name || '')}&lastName=${encodeURIComponent(v.lastName || '')}&phone=${encodeURIComponent((v.phone || '').replace(/\D/g, ''))}&visitorId=${encodeURIComponent(vDoc.id)}`);
        return false;
      }

      // Not found → send to signup with email prefilled
      navigate(`/organization/${id}/member-signup?eventId=${encodeURIComponent(eventId)}&email=${encodeURIComponent(trimmed)}`);
      return false;
    } catch (error) {
      console.error('Error looking up user by email:', error);
      setScannerError('Error looking up user');
      return false;
    }
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    setAttendanceLoading(true);
    try {
      const val = manualInput.trim();
      let success = false;
      if (/^[\d\s\(\)\-\+]+$/.test(val)) {
        success = await handleUserLookupByPhone(val);
      } else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
        success = await handleUserLookupByEmail(val);
      } else {
        // Fallback: treat as QR/user id
        success = await handleAttendanceRecord(val, 'manual');
      }
      
      // Close scanner if it's open and submission was successful
      if (success && scanner && showScanner) {
        try {
          await scanner.clear();
          await scanner.stop();
        } catch (err) {
          console.error('Error stopping scanner:', err);
        }
        setShowScanner(false);
        setScanner(null);
      }
    } finally {
      setAttendanceLoading(false);
    }
  };

  // Auto check-in after signup flow redirects back with state
  useEffect(() => {
    if (location.state && location.state.autoCheckIn && user?.uid) {
      (async () => {
        const success = await handleAttendanceRecord(user.uid, 'manual');
        if (success) {
          navigate(location.pathname, { replace: true, state: {} });
        }
      })();
    }
  }, [location.state, user?.uid]);

  useEffect(() => {
    return () => {
      if (scanner) {
        scanner.clear().catch(console.error);
        if (scanner.stop) {
          try { scanner.stop(); } catch (_) {}
        }
      }
    };
  }, [scanner]);

  useEffect(() => {
    if (!eventId) return;
    fetchAllLogs();
  }, [eventId]);

  useEffect(() => {
    const fetchEventImage = async () => {
      if (!event || !event.imageUrl) return;
      
      try {
        if (typeof event.imageUrl === 'string' && event.imageUrl.startsWith('http')) {
          // Already a full URL
          setEventImage(event.imageUrl);
          return;
        }
        // Resolve Firebase Storage path via SDK using configured bucket
        const storagePath = String(event.imageUrl).replace(/^\//, '');
        if (!storage) {
          console.warn('Storage not initialized; cannot resolve image URL');
          return;
        }
        const fileRef = ref(storage, storagePath);
        const url = await getDownloadURL(fileRef);
        setEventImage(url);
      } catch (error) {
        console.error('Error fetching event image:', error);
        setEventImage(null);
      }
    };

    fetchEventImage();
  }, [event]);

  const handleImageFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size should be less than 5MB');
      return;
    }

    setImageFile(file);
    const previewUrl = URL.createObjectURL(file);
    setEventImage(previewUrl);
  };

  const handleImageUpload = async () => {
    if (!imageFile || !eventId) return;
    
    setUploadingImage(true);
    try {
      const timestamp = Date.now();
      const imagePath = `events/${id}/${eventId}/${timestamp}_${imageFile.name}`;
      const storageRef = ref(storage, imagePath);
      
      await uploadBytes(storageRef, imageFile);
      
      const downloadURL = await getDownloadURL(storageRef);
      
      const eventRef = doc(db, "eventInstances", eventId);
      await updateDoc(eventRef, {
        imageUrl: imagePath
      });

      setEventImage(downloadURL);
      toast.success('Event image updated successfully');
    } catch (error) {
      console.error('Error uploading image:', error);
      toast.error('Failed to upload image');
    } finally {
      setUploadingImage(false);
    }
  };

  const renderScanner = () => {
    if (!showScanner) return null;

    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.8)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}>
        <div style={{
          width: '400px',
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px'
        }}>
          <h3 style={{ marginBottom: '15px', textAlign: 'center' }}>
            {attendanceLoading ? 'Processing...' : 'Scan Attendance QR Code'}
          </h3>
          <div id="qr-reader" style={{ 
            width: '100%',
            opacity: attendanceLoading ? 0.5 : 1,
            pointerEvents: attendanceLoading ? 'none' : 'auto'
          }}></div>
          {scannerError && (
            <div style={{ color: 'red', marginTop: '10px', textAlign: 'center' }}>
              {scannerError}
            </div>
          )}
          <button
            onClick={async () => {
              if (scanner) {
                await scanner.clear();
                setScanner(null);
                setShowScanner(false);
              }
            }}
            style={{
              marginTop: '10px',
              padding: '8px 16px',
              backgroundColor: '#EF4444',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              width: '100%'
            }}
            disabled={attendanceLoading}
          >
            {attendanceLoading ? 'Processing...' : 'Close Scanner'}
          </button>
        </div>
      </div>
    );
  };

  const handleScanClick = () => {
    setShowScanner(true);
    setTimeout(() => {
      startScanner();
    }, 100);
  };

  const ScanLogsDisplay = () => {
    return (
      <div style={{
        marginTop: '20px',
        padding: '15px',
        backgroundColor: '#f3f4f6',
        borderRadius: '8px'
      }}>
        <div>
          <h3 style={{ marginBottom: '10px', fontSize: '16px', fontWeight: '600' }}>
            Attendance Logs ({scanLogs.length})
          </h3>
          {scanLogs.length === 0 ? (
            <p style={{ color: '#666' }}>No attendance records yet</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {scanLogs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    padding: '8px',
                    backgroundColor: '#ecfdf5',
                    borderRadius: '4px',
                    fontSize: '14px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div style={{ color: '#065f46', fontWeight: '500' }}>
                    ✅ {log.firstName || ''} {log.lastName || ''}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      {log.timestamp}
                    </div>
                    {selectedRooms.length > 0 && (
                      <button
                        onClick={() => {
                          setSelectedChild({
                            userId: log.userId,
                            firstName: log.firstName,
                            lastName: log.lastName
                          });
                          setShowChildCheckIn(true);
                        }}
                        style={{
                          backgroundColor: '#4F46E5',
                          color: 'white',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          border: 'none',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <span role="img" aria-label="child">👶</span> Child Check-in
                      </button>
                    )}
                    <button
                      onClick={() => {
                        const existingCompletion = courseCompletionLogs.find(
                          comp => comp.userId === log.userId
                        );
                        
                        setCourseCompletionForm({
                          ...courseCompletionForm,
                          userId: log.userId,
                          firstName: log.firstName,
                          lastName: log.lastName,
                          instructorName: existingCompletion?.instructorName || '',
                          notes: existingCompletion?.notes || ''
                        });
                        setShowCompletionForm(true);
                      }}
                      style={{
                        backgroundColor: '#10B981',
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <span role="img" aria-label="course">📚</span> Course Progress
                    </button>
                    <button
                      onClick={() => handleRemoveScan(log.id, log.userId)}
                      style={{
                        backgroundColor: '#EF4444',
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        border: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginTop: '20px' }}>
          <h3 style={{ marginBottom: '10px', fontSize: '16px', fontWeight: '600' }}>
            Child Check-in Logs ({childCheckInLogs.length})
          </h3>
          {childCheckInLogs.map((log) => (
            <div
              key={log.id}
              style={{
                padding: '8px',
                backgroundColor: '#fff',
                borderRadius: '4px',
                marginBottom: '8px',
                border: '1px solid #e5e7eb'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: '500' }}>
                  {log.childName} (Age: {log.age})
                  <span style={{
                    marginLeft: '8px',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    backgroundColor: log.status === 'checked-out' ? '#FEE2E2' : '#ECFDF5',
                    color: log.status === 'checked-out' ? '#991B1B' : '#065F46',
                    fontSize: '12px'
                  }}>
                    {log.status === 'checked-out' ? 'Checked Out' : 'Checked In'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {log.status !== 'checked-out' && (
                    <button
                      onClick={() => handleCheckOutChild(log.id)}
                      style={{
                        backgroundColor: '#10B981',
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        border: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      Check Out
                    </button>
                  )}
                  <button
                    onClick={() => handleRemoveChildCheckIn(log.id, log.userId)}
                    style={{
                      backgroundColor: '#EF4444',
                      color: 'white',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      border: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <div style={{ fontSize: '14px', color: '#666' }}>
                Parent: {log.parentName}
              </div>
              <div style={{ fontSize: '14px', color: '#666' }}>
                Room: {log.roomName}
              </div>
              <div style={{ fontSize: '12px', color: '#888' }}>
                Checked in: {log.checkInTime}
              </div>
              {log.checkOutTime && (
                <div style={{ fontSize: '12px', color: '#888' }}>
                  Checked out: {log.checkOutTime?.toDate?.().toLocaleString()}
                </div>
              )}
              {log.allergies && (
                <div style={{ fontSize: '14px', color: '#dc2626' }}>
                  Allergies: {log.allergies}
                </div>
              )}
              {log.notes && (
                <div style={{ fontSize: '14px', color: '#666' }}>
                  Notes: {log.notes}
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ marginTop: '20px' }}>
          <h3 style={{ marginBottom: '10px', fontSize: '16px', fontWeight: '600' }}>
            Course Completion Logs ({courseCompletionLogs.length})
          </h3>
          {courseCompletionLogs.map((log) => (
            <div
              key={log.id}
              style={{
                padding: '8px',
                backgroundColor: '#fff',
                borderRadius: '4px',
                marginBottom: '8px',
                border: '1px solid #e5e7eb'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: '500' }}>
                  {log.firstName} {log.lastName}
                  <span style={{
                    marginLeft: '8px',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    backgroundColor: log.status === 'completed' ? '#ECFDF5' : '#FEF3C7',
                    color: log.status === 'completed' ? '#065F46' : '#92400E',
                    fontSize: '12px'
                  }}>
                    {log.status === 'completed' ? 'Completed' : 'In Progress'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {log.status !== 'completed' && (
                    <button
                      onClick={() => handleCompleteCourse(log.id)}
                      style={{
                        backgroundColor: '#10B981',
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        border: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      Complete Course
                    </button>
                  )}
                  <button
                    onClick={() => handleRemoveCourseCompletion(log.id)}
                    style={{
                      backgroundColor: '#EF4444',
                      color: 'white',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      border: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <div style={{ fontSize: '14px', color: '#666' }}>
                Instructor: {log.instructorName}
              </div>
              {log.notes && (
                <div style={{ fontSize: '14px', color: '#666' }}>
                  Notes: {log.notes}
                </div>
              )}
              <div style={{ fontSize: '12px', color: '#888' }}>
                Started: {log.startedAt}
              </div>
              {log.completedAt && (
                <div style={{ fontSize: '12px', color: '#888' }}>
                  Completed: {log.completedAt}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  useEffect(() => {
    if (!eventId) return;

    const fetchRegistrations = query(
      collection(db, "eventRegistrations"),
      where("eventId", "==", eventId),
      orderBy("registeredAt", "desc")
    );

    const unsubscribe = onSnapshot(fetchRegistrations, (snapshot) => {
      const regs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        registeredAt: doc.data().registeredAt?.toDate?.().toLocaleString() || 'N/A'
      }));
      setRegistrations(regs);
      setRegistrationsLoading(false);
    });

    return () => unsubscribe();
  }, [eventId]);

  const handleRemoveRegistration = async (registrationId) => {
    if (window.confirm('Are you sure you want to remove this registration?')) {
      try {
        await deleteDoc(doc(db, "eventRegistrations", registrationId));
        toast.success('Registration removed successfully');
      } catch (err) {
        console.error('Error removing registration:', err);
        toast.error('Failed to remove registration');
      }
    }
  };

  const handleEditRegistration = async (registration) => {
    try {
      const newName = prompt('Enter new name:', registration.name);
      if (!newName) return;

      const newEmail = prompt('Enter new email:', registration.email);
      if (!newEmail) return;

      const newPhone = prompt('Enter new phone:', registration.phone);
      if (!newPhone) return;

      const newComments = prompt('Enter new comments:', registration.comments || '');
      await updateDoc(doc(db, "eventRegistrations", registration.id), {
        name: newName,
        email: newEmail,
        phone: newPhone,
        comments: newComments,
        updatedAt: serverTimestamp(),
      });

      toast.success('Registration updated successfully');
    } catch (err) {
      console.error('Error updating registration:', err);
      toast.error('Failed to update registration');
    }
  };

  const handleRegistrationSubmit = async (e) => {
    e.preventDefault();
    if (submittingRegistration) return;

    if (!registrationForm.name || !registrationForm.lastName) {
      toast.error('Name and Last Name are required');
      return;
    }

    setSubmittingRegistration(true);
    try {
      await addDoc(collection(db, 'eventRegistrations'), {
        eventId,
        churchId: id,
        userId: user?.uid || null,
        ...registrationForm,
        status: 'registered',
        registeredAt: serverTimestamp(),
        eventName: event?.title || '',
        eventDate: event?.startDate || ''
      });

      toast.success('Registration successful!');
      
      setRegistrationForm({
        name: '',
        lastName: '',
        email: '',
        phone: ''
      });
      
      const fetchRegistrations = query(
        collection(db, "eventRegistrations"),
        where("eventId", "==", eventId),
        orderBy("registeredAt", "desc")
      );

      onSnapshot(fetchRegistrations, (snapshot) => {
        const regs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          registeredAt: doc.data().registeredAt?.toDate?.().toLocaleString() || 'N/A'
        }));
        setRegistrations(regs);
        setRegistrationsLoading(false);
      });
    } catch (error) {
      console.error('Registration error:', error);
      toast.error('Failed to register for event');
    } finally {
      setSubmittingRegistration(false);
    }
  };

  const handleLoginClick = () => {
    sessionStorage.setItem('returnPath', window.location.pathname);
    navigate('/login');
  };

  const handleBackClick = (churchId) => {
  navigate(`/organization/${churchId}/all-events`);
  };

  const renderRoomsSection = () => {
    return (
      <div style={{
        marginTop: '20px',
        padding: '15px',
        backgroundColor: 'white',
        borderRadius: '8px',
        border: '1px solid #e5e7eb'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ margin: 0 }}>Event Rooms</h3>
          <button
            onClick={() => setIsManagingRooms(!isManagingRooms)}
            style={{
              backgroundColor: '#4F46E5',
              color: 'white',
              padding: '4px 12px',
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            {isManagingRooms ? 'Done' : 'Manage Rooms'}
          </button>
        </div>
        
        {isManagingRooms ? (
          <>
            <Select
              isMulti
              value={selectedRooms.map(room => ({
                value: room.id,
                label: room.name
              }))}
              onChange={handleUpdateRooms}
              options={availableRooms.map(room => ({
                value: room.id,
                label: room.name
              }))}
              placeholder="Select rooms for this event..."
              styles={{
                control: (base) => ({
                  ...base,
                  borderColor: '#d1d5db',
                  boxShadow: 'none',
                  '&:hover': {
                    borderColor: '#9CA3AF'
                  }
                }),
                multiValue: (base) => ({
                  ...base,
                  backgroundColor: '#EEF2FF',
                }),
                multiValueLabel: (base) => ({
                  ...base,
                  color: '#4F46E5'
                }),
                multiValueRemove: (base) => ({
                  ...base,
                  color: '#4F46E5',
                  '&:hover': {
                    backgroundColor: '#E0E7FF',
                    color: '#4338CA'
                  }
                })
              }}
            />
            <small style={{ color: '#666', marginTop: '8px', display: 'block' }}>
              These rooms will be available for child check-in during this event.
            </small>
          </>
        ) : (
          <div>
            {selectedRooms.length === 0 ? (
              <p style={{ color: '#666' }}>No rooms assigned to this event.</p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {selectedRooms.map(room => (
                  <div key={room.id} style={{
                    backgroundColor: '#EEF2FF',
                    color: '#4F46E5',
                    padding: '6px 12px',
                    borderRadius: '16px',
                    fontSize: '14px'
                  }}>
                    {room.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderRegistrationSection = () => {
    return (
      <div style={{
        marginTop: '20px',
        padding: '15px',
        backgroundColor: 'white',
        borderRadius: '8px',
        border: '1px solid #e5e7eb'
      }}>
        <h3 style={{ marginBottom: '15px', fontSize: '18px', fontWeight: '600' }}>
          Event Registrations
        </h3>

        {user && (user.role === 'admin' || user.role === 'global_admin') ? (
          <>
            <div style={{ marginBottom: '20px' }}>
              <h4 style={{ marginBottom: '10px', fontSize: '16px', fontWeight: '500' }}>
                Registrations ({registrations.length})
              </h4>
              {registrationsLoading ? (
                <p>Loading registrations...</p>
              ) : registrations.length === 0 ? (
                <p style={{ color: '#666' }}>No registrations yet</p>
              ) : (
                <div style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: '8px',
                  padding: '5px'
                }}>
                  {registrations.map(reg => (
                    <div 
                      key={reg.id}
                      style={{
                        padding: '10px',
                        backgroundColor: '#f9fafb',
                        borderRadius: '6px',
                        border: '1px solid #e5e7eb'
                      }}
                    >
                      <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <div>
                          <div style={{ fontWeight: '500' }}>
                            {reg.name} {reg.lastName}
                          </div>
                          <div style={{ fontSize: '14px', color: '#6b7280' }}>
                            {reg.email} | {reg.phone}
                          </div>
                          {reg.comments && (
                            <div style={{ fontSize: '14px', marginTop: '4px' }}>
                              <i>"{reg.comments}"</i>
                            </div>
                          )}
                          <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>
                            Registered at: {reg.registeredAt}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            onClick={() => handleEditRegistration(reg)}
                            style={{
                              backgroundColor: '#FCD34D',
                              color: '#92400E',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: '12px'
                            }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleRemoveRegistration(reg.id)}
                            style={{
                              backgroundColor: '#FEE2E2',
                              color: '#B91C1C',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: '12px'
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div style={{ marginTop: '20px' }}>
              <h4 style={{ marginBottom: '10px', fontSize: '16px', fontWeight: '500' }}>
                Add New Registration
              </h4>
              <form onSubmit={handleRegistrationSubmit}>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                  <input
                    type="text"
                    placeholder="First Name"
                    value={registrationForm.name}
                    onChange={(e) => setRegistrationForm(prev => ({ ...prev, name: e.target.value }))}
                    required
                    style={{ ...commonStyles.input, flex: 1 }}
                  />
                  <input
                    type="text"
                    placeholder="Last Name"
                    value={registrationForm.lastName}
                    onChange={(e) => setRegistrationForm(prev => ({ ...prev, lastName: e.target.value }))}
                    required
                    style={{ ...commonStyles.input, flex: 1 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                  <input
                    type="email"
                    placeholder="Email"
                    value={registrationForm.email}
                    onChange={(e) => setRegistrationForm(prev => ({ ...prev, email: e.target.value }))}
                    style={{ ...commonStyles.input, flex: 1 }}
                  />
                  <input
                    type="tel"
                    placeholder="Phone"
                    value={registrationForm.phone}
                    onChange={(e) => setRegistrationForm(prev => ({ ...prev, phone: e.target.value }))}
                    style={{ ...commonStyles.input, flex: 1 }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={submittingRegistration}
                  style={{
                    backgroundColor: '#10B981',
                    color: 'white',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: submittingRegistration ? 'not-allowed' : 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    width: '100%'
                  }}
                >
                  {submittingRegistration ? 'Submitting...' : 'Register for Event'}
                </button>
              </form>
            </div>
          </>
        ) : (
          <div>
            <p style={{ marginBottom: '15px' }}>
              Please register for this event using the form below:
            </p>
            <form onSubmit={handleRegistrationSubmit}>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                <input
                  type="text"
                  placeholder="First Name"
                  value={registrationForm.name}
                  onChange={(e) => setRegistrationForm(prev => ({ ...prev, name: e.target.value }))}
                  required
                  style={{ ...commonStyles.input, flex: 1 }}
                />
                <input
                  type="text"
                  placeholder="Last Name"
                  value={registrationForm.lastName}
                  onChange={(e) => setRegistrationForm(prev => ({ ...prev, lastName: e.target.value }))}
                  required
                  style={{ ...commonStyles.input, flex: 1 }}
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                <input
                  type="email"
                  placeholder="Email"
                  value={registrationForm.email}
                  onChange={(e) => setRegistrationForm(prev => ({ ...prev, email: e.target.value }))}
                  style={{ ...commonStyles.input, flex: 1 }}
                />
                <input
                  type="tel"
                  placeholder="Phone"
                  value={registrationForm.phone}
                  onChange={(e) => setRegistrationForm(prev => ({ ...prev, phone: e.target.value }))}
                  style={{ ...commonStyles.input, flex: 1 }}
                />
              </div>
              <button
                type="submit"
                disabled={submittingRegistration}
                style={{
                  backgroundColor: '#10B981',
                  color: 'white',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: submittingRegistration ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  width: '100%'
                }}
              >
                {submittingRegistration ? 'Submitting...' : 'Register for Event'}
              </button>
            </form>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="text-red-600 p-4">{error}</div>
    );
  }

  return (
    <div style={commonStyles.fullWidthContainer}>
      {!user && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginBottom: "20px",
          }}
        >
          <button
            onClick={() => navigate(`/organization/${id}/login`)}
            style={{
              ...commonStyles.backButton,
              width: "120px",
              backgroundColor: "#53bf49",
            }}
          >
            Log in →
          </button>
        </div>
      )}
      <button
        onClick={() => handleBackClick(id)}
        style={{ ...commonStyles.backButtonLink }}
      >
        ← Back
      </button>
      <ChurchHeader id={id} applyShadow={false} />
      
      {!loading && (
        <div style={{ 
          marginTop: '20px', 
          marginBottom: '20px',
          borderRadius: '8px',
          overflow: 'hidden',
          position: 'relative'
        }}>
          {eventImage ? (
            <div style={{
              width: '100%',
              maxHeight: '300px',
              overflow: 'hidden',
              borderRadius: '8px',
              position: 'relative'
            }}>
              <img 
                src={eventImage} 
                alt={event?.title || 'Event'} 
                style={{
                  width: '100%',
                  maxHeight: '300px',
                  objectFit: 'cover'
                }}
              />
              
              <div style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                padding: '15px 20px',
                background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                borderBottomLeftRadius: '8px',
                borderBottomRightRadius: '8px'
              }}>
                <h1 style={{
                  ...commonStyles.title,
                  color: 'white',
                  margin: 0,
                  textShadow: '0 2px 4px rgba(0,0,0,0.5)'
                }}>
                  {event?.title}
                </h1>
              </div>
            </div>
          ) : (
            <h1 style={{ ...commonStyles.title }}>
              {event?.title}
            </h1>
          )}
          
          {(user?.role === 'admin' || user?.role === 'global_admin') && (
            <div style={{
              position: eventImage ? 'absolute' : 'relative',
              top: eventImage ? '10px' : '0',
              right: eventImage ? '10px' : '0',
              zIndex: 5,
              display: 'flex',
              justifyContent: eventImage ? 'flex-end' : 'flex-start',
              marginBottom: eventImage ? '0' : '15px'
            }}>
              <div style={{
                backgroundColor: 'white',
                borderRadius: '8px',
                padding: '8px 12px',
                boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}>
                <label 
                  htmlFor="event-image-upload"
                  style={{
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 10px',
                    backgroundColor: '#4F46E5',
                    color: 'white',
                    borderRadius: '4px',
                    fontSize: '14px'
                  }}
                >
                  <span role="img" aria-label="upload">{eventImage ? '🔄' : '📸'}</span>
                  {eventImage ? 'Change Image' : 'Add Card Image'}
                </label>
                <input
                  id="event-image-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleImageFileChange}
                  style={{ display: 'none' }}
                />
                
                {imageFile && (
                  <button
                    onClick={handleImageUpload}
                    disabled={uploadingImage}
                    style={{
                      backgroundColor: uploadingImage ? '#9CA3AF' : '#10B981',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '6px 10px',
                      cursor: uploadingImage ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <span role="img" aria-label="save">💾</span>
                    {uploadingImage ? 'Saving...' : 'Save Image'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      
      {!loading && event && (
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          marginBottom: '20px',
          cursor: 'pointer' 
        }}
          onClick={() => {
            const url = window.location.href;
            navigator.clipboard.writeText(url)
              .then(() => toast.success('Event link copied to clipboard!'))
              .catch(err => toast.error('Failed to copy link'));
          }}
          title="Click to copy event link"
        >
          <div style={{ 
            padding: '15px', 
            backgroundColor: 'white', 
            borderRadius: '8px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)', 
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            transition: 'transform 0.2s',
            ':hover': { transform: 'scale(1.02)' }
          }}>
            <QRCodeSVG value={window.location.href} size={150} level="H" />
            <div style={{ 
              marginTop: '10px', 
              fontSize: '14px', 
              color: '#4b5563',
              textAlign: 'center' 
            }}>
              Click to copy event link
            </div>
          </div>
        </div>
      )}
      
      <div>
        {loading ? (
          <Skeleton count={1} />
        ) : (
          <div className="p-4">
            {renderEventDetails(event)}
            
            {user ? (
              <>
                {(user.role === 'admin' || user.role === 'global_admin') && renderRoomsSection()}
                
                <button
                  onClick={handleScanClick}
                  style={{
                    backgroundColor: '#4F46E5',
                    color: 'white',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    marginTop: '20px'
                  }}
                >
                  Scan Attendance QR
                </button>
                <div style={{
                  marginTop: '20px',
                  padding: '15px',
                  backgroundColor: '#f3f4f6',
                  borderRadius: '8px',
                }}>
                  <h3 style={{ marginBottom: '10px', fontSize: '16px', fontWeight: '600' }}>
                    Manual Input
                  </h3>
                  <form onSubmit={handleManualSubmit} style={{ display: 'flex', gap: '10px' }}>
                    <input
                      type="text"
                      value={manualInput}
                      onChange={(e) => setManualInput(e.target.value)}
                      placeholder="Enter QR code ID or phone number"
                      style={{
                        flex: 1,
                        padding: '8px',
                        borderRadius: '4px',
                        border: '1px solid #d1d5db',
                        fontSize: '14px'
                      }}
                    />
                    <button
                      type="submit"
                      style={{
                        backgroundColor: '#4F46E5',
                        color: 'white',
                        padding: '8px 16px',
                        borderRadius: '6px',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: '500'
                      }}
                      disabled={attendanceLoading}
                    >
                      {attendanceLoading ? "Processing..." : "Submit"}
                    </button>
                  </form>
                  <small style={{ color: '#666', marginTop: '8px', display: 'block' }}>
                    You can enter either a QR code ID or a phone number (e.g. (123) 456-7890)
                  </small>
                  {scannerError && (
                    <div style={{ color: 'red', marginTop: '10px', fontSize: '14px' }}>
                      {scannerError}
                    </div>
                  )}
                </div>
                <ScanLogsDisplay />
                
                {showChildCheckIn && (
                  <div style={{
                    marginTop: '20px',
                    padding: '15px',
                    backgroundColor: 'white',
                    borderRadius: '8px',
                    border: '1px solid #e5e7eb'
                  }}>
                    <h3 style={{ marginBottom: '15px' }}>
                      Child Check-in for {selectedChild?.firstName} {selectedChild?.lastName}
                    </h3>
                    <form onSubmit={handleChildCheckIn}>
                      <div style={{ marginBottom: '10px' }}>
                        <input
                          type="text"
                          placeholder="Child's Name"
                          value={childCheckInForm.childName}
                          onChange={e => setChildCheckInForm(prev => ({ ...prev, childName: e.target.value }))}
                          required
                          style={commonStyles.input}
                        />
                      </div>
                      <div style={{ marginBottom: '10px' }}>
                        <input
                          type="number"
                          placeholder="Age"
                          value={childCheckInForm.age}
                          onChange={e => setChildCheckInForm(prev => ({ ...prev, age: e.target.value }))}
                          required
                          style={commonStyles.input}
                        />
                      </div>
                      {selectedRooms.length > 1 && (
                        <div style={{ marginBottom: '10px' }}>
                          <select
                            value={childCheckInForm.roomId}
                            onChange={e => setChildCheckInForm(prev => ({ ...prev, roomId: e.target.value }))}
                            required
                            style={{
                              ...commonStyles.input,
                              appearance: 'none',
                              backgroundImage: 'url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3e%3cpolyline points=\'6 9 12 15 18 9\'%3e%3c/polyline%3e%3c/svg%3e")',
                              backgroundRepeat: 'no-repeat',
                              backgroundPosition: 'right 0.5rem center',
                              backgroundSize: '1.5em 1.5em',
                              paddingRight: '2.5rem'
                            }}
                          >
                            <option value="">Select a Room</option>
                            {selectedRooms.map(room => (
                              <option key={room.id} value={room.id}>
                                {room.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div style={{ marginBottom: '10px' }}>
                        <textarea
                          placeholder="Allergies (if any)"
                          value={childCheckInForm.allergies}
                          onChange={e => setChildCheckInForm(prev => ({ ...prev, allergies: e.target.value }))}
                          style={{ ...commonStyles.input, minHeight: '60px' }}
                        />
                      </div>
                      <div style={{ marginBottom: '10px' }}>
                        <textarea
                          placeholder="Additional Notes"
                          value={childCheckInForm.notes}
                          onChange={e => setChildCheckInForm(prev => ({ ...prev, notes: e.target.value }))}
                          style={{ ...commonStyles.input, minHeight: '60px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <button type="submit" style={commonStyles.indigoButton}>
                          Check In Child
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowChildCheckIn(false)}
                          style={commonStyles.redButton}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}
                {showCompletionForm && (
                  <div style={{
                    marginTop: '20px',
                    padding: '15px',
                    backgroundColor: 'white',
                    borderRadius: '8px',
                    border: '1px solid #e5e7eb'
                  }}>
                    <h3 style={{ marginBottom: '15px' }}>
                      Complete Course for {courseCompletionForm.firstName} {courseCompletionForm.lastName}
                    </h3>
                    <form onSubmit={(e) => {
                      e.preventDefault();
                      handleCourseCompletion(
                        courseCompletionForm.userId,
                        courseCompletionForm.firstName,
                        courseCompletionForm.lastName
                      );
                    }}>
                      <div style={{ marginBottom: '15px' }}>
                        <input
                          type="text"
                          placeholder="Instructor Name *"
                          value={courseCompletionForm.instructorName}
                          onChange={(e) => setCourseCompletionForm(prev => ({
                            ...prev,
                            instructorName: e.target.value
                          }))}
                          required
                          style={commonStyles.input}
                        />
                      </div>
                      <div style={{ marginBottom: '15px' }}>
                        <textarea
                          placeholder="Notes (optional)"
                          value={courseCompletionForm.notes}
                          onChange={(e) => setCourseCompletionForm(prev => ({
                            ...prev,
                            notes: e.target.value
                          }))}
                          style={{ ...commonStyles.input, minHeight: '100px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <button type="submit" style={commonStyles.indigoButton}>
                          Complete Course
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowCompletionForm(false)}
                          style={commonStyles.redButton}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}
                
                <div style={{ 
                  display: 'flex', 
                  gap: '10px',
                  marginTop: '20px',
                  flexWrap: 'wrap'
                }}>
                  <button
                    onClick={() => navigate(`/organization/${id}/event/${eventId}/coordination`)} 
                    style={{
                      backgroundColor: '#8B5CF6',
                      color: 'white',
                      padding: '12px 24px',
                      borderRadius: '6px',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '16px',
                      fontWeight: '500',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    <span>📋</span> Coordinación
                  </button>
                  
                  <button
                    onClick={() => navigate(`/organization/${id}/event/${eventId}/registrations`)} 
                    style={{
                      backgroundColor: '#10B981',
                      color: 'white',
                      padding: '12px 24px',
                      borderRadius: '6px',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '16px',
                      fontWeight: '500',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    <span>📝</span> Manage Registration
                  </button>
                </div>
              </>
            ) : (
              <div style={{ marginTop: '20px' }}>
                <p style={{ marginBottom: '15px' }}>
                  Please log in to access more features or register for this event using the form below.
                </p>
              </div>
            )}
            
            {renderRegistrationSection()}
          </div>
        )}
      </div>
      {renderScanner()}
    </div>
  );
};

export default EventDetails;

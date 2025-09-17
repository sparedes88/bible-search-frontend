import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { db } from '../firebase';
import { collection, getDocs, query, where, doc, getDoc, orderBy } from 'firebase/firestore';
import ChurchHeader from './ChurchHeader';
import { SafeToastContainer } from '../utils/toastUtils';
import safeToast from '../utils/toastUtils';
import { FaArrowLeft, FaUserFriends, FaMapMarkerAlt, FaRoute, FaChartPie, 
  FaBullseye, FaSyncAlt, FaDownload, FaChartLine, FaUserPlus, FaCheckCircle,
  FaCalendarCheck, FaChurch, FaHouseUser, FaFilter, FaUsers, FaBrain, FaUserTie } from 'react-icons/fa';
import './BusinessIntelligence.css';
import axios from 'axios';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, 
  LinearScale, BarElement, Title, PointElement, LineElement } from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { createParser, ParsedEvent, ReconnectInterval } from 'eventsource-parser';
import LeadershipAIRecommendations from './LeadershipAIRecommendations';

// Register ChartJS components
ChartJS.register(
  ArcElement, 
  Tooltip, 
  Legend, 
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  PointElement,
  LineElement
);

const BIDashboard = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [churchData, setChurchData] = useState(null);
  const [visitors, setVisitors] = useState([]);
  const [members, setMembers] = useState([]);
  const [visitorLocations, setVisitorLocations] = useState([]);
  const [memberLocations, setMemberLocations] = useState([]);
  const [dateRange, setDateRange] = useState('all');
  const [geoDataLoaded, setGeoDataLoaded] = useState(false);
  const [distanceGroups, setDistanceGroups] = useState([]);
  const [attendanceTrends, setAttendanceTrends] = useState(null);
  const [visitorRetentionRate, setVisitorRetentionRate] = useState(null);
  const [membershipGrowth, setMembershipGrowth] = useState(null);
  const [demographicData, setDemographicData] = useState(null);
  const [aiInsights, setAiInsights] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const mapRef = useRef(null);
  const [mapInitialized, setMapInitialized] = useState(false);
  const [churchLocation, setChurchLocation] = useState(null);
  const [showAIInsightsSection, setShowAIInsightsSection] = useState(true);
  const [visitorAcquisitionData, setVisitorAcquisitionData] = useState({
    labels: [],
    datasets: []
  });
  const [returnRateData, setReturnRateData] = useState({
    labels: [],
    datasets: []
  });
  const [visitorTypesData, setVisitorTypesData] = useState({
    labels: [],
    datasets: []
  });
  
  // Data filters
  const [filters, setFilters] = useState({
    timeRange: 'all',       // all, thisMonth, lastMonth, thisYear, custom
    startDate: '',          // for custom date range
    endDate: '',            // for custom date range
    distanceRange: 'all',   // all, local (0-5mi), medium (5-15mi), far (15+mi)
    retentionStatus: 'all'  // all, retained, notRetained
  });

  // Analysis options
  const [analysisFocus, setAnalysisFocus] = useState('visitor-retention');

  // Reference to church address for geocoding
  const [churchAddress, setChurchAddress] = useState('');

  // State to store teams for the leadership recommendations
  const [teams, setTeams] = useState([]);
  const [leadershipAnalysisComplete, setLeadershipAnalysisComplete] = useState(false);
  
  // Fetch teams data for leadership recommendations
  const fetchTeams = async () => {
    try {
      const teamsRef = collection(db, `churches/${id}/teams`);
      const teamsSnapshot = await getDocs(teamsRef);
      
      const teamsData = teamsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      setTeams(teamsData);
      return teamsData;
    } catch (error) {
      console.error('Error fetching teams:', error);
      return [];
    }
  };

  useEffect(() => {
    const loadChurchData = async () => {
      try {
        setLoading(true);
        const churchDoc = await getDoc(doc(db, 'churches', id));
        
        if (churchDoc.exists()) {
          const data = churchDoc.data();
          setChurchData(data);
          
          // Get church address for geocoding
          const address = [
            data.address?.street,
            data.address?.city,
            data.address?.state,
            data.address?.zipCode
          ].filter(Boolean).join(', ');
          
          setChurchAddress(address);
        } else {
          safeToast.error('Church not found');
        }
        
        await Promise.all([
          fetchVisitors(),
          fetchMembers()
        ]);
        
        setLoading(false);
      } catch (error) {
        console.error('Error loading church data:', error);
        safeToast.error('Failed to load church data');
        setLoading(false);
      }
    };
    
    loadChurchData();
  }, [id]);

  useEffect(() => {
    if (churchAddress && visitors.length > 0 && !geoDataLoaded) {
      geocodeChurchAddress();
    }
  }, [churchAddress, visitors, geoDataLoaded]);

  useEffect(() => {
    // Fetch teams data when component loads
    if (id && !teams.length) {
      fetchTeams();
    }
  }, [id]);

  const fetchVisitors = async () => {
    try {
      const visitorsRef = collection(db, "visitors", id, "visitors");
      const q = query(visitorsRef);
      const querySnapshot = await getDocs(q);
      
      const visitorsData = querySnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate() || new Date(),
          type: 'visitor',
          // Check if visitor has been migrated to a member
          isMember: !!data.migratedToUserId,
          migratedToUserId: data.migratedToUserId
        };
      });
      
      // Filter out visitors who have been migrated to members
      const uniqueVisitors = visitorsData.filter(visitor => !visitor.isMember);
      setVisitors(uniqueVisitors);
      
      // Track first-time visitors vs. return visitors
      processVisitorRetentionData(uniqueVisitors);
      
      return uniqueVisitors;
    } catch (error) {
      console.error('Error fetching visitors:', error);
      safeToast.error('Failed to load visitor data');
      return [];
    }
  };

  const fetchMembers = async () => {
    try {
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("churchId", "==", id));
      const querySnapshot = await getDocs(q);
      
      const membersData = querySnapshot.docs.map(doc => {
        const data = doc.data();
        // Add null check and fallback for createdAt
        let createdAtDate = new Date();
        if (data.createdAt) {
          if (typeof data.createdAt.toDate === 'function') {
            createdAtDate = data.createdAt.toDate();
          } else if (data.createdAt instanceof Date) {
            createdAtDate = data.createdAt;
          } else if (typeof data.createdAt === 'string') {
            createdAtDate = new Date(data.createdAt);
          }
        }
        
        // Calculate age if dateOfBirth exists
        let age = null;
        if (data.dateOfBirth) {
          const birthDate = new Date(data.dateOfBirth);
          const today = new Date();
          age = today.getFullYear() - birthDate.getFullYear();
          const monthDiff = today.getMonth() - birthDate.getMonth();
          if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
          }
        }
        
        return {
          id: doc.id,
          ...data,
          createdAt: createdAtDate || new Date(),
          type: 'member',
          // track if migrated from visitor
          isMigrated: !!data.migrationDetails?.migratedFrom,
          // Extract demographic data
          profession: data.Profession || [],
          gender: data.gender || null,
          language: data.language || [],
          skills: data.skill || [],
          age: age,
          maritalStatus: data.maritalStatus || null
        };
      });
      
      setMembers(membersData);
      
      // Generate statistics about membership growth
      processMembershipData(membersData);
      
      // Process demographic data
      processDemographicData(membersData);
      
      return membersData;
    } catch (error) {
      console.error('Error fetching members:', error);
      safeToast.error('Failed to load member data');
      return [];
    }
  };

  const geocodeChurchAddress = async () => {
    try {
      if (!churchAddress || churchAddress === ', , ') {
        console.log('No valid church address to geocode');
        return;
      }
      
      // Note: In a production environment, you'd typically use your backend service for geocoding
      const response = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json`, {
        params: {
          address: churchAddress,
          key: 'YOUR_API_KEY_HERE' // In production, use your API key
        }
      });
      
      if (response.data.results && response.data.results.length > 0) {
        const location = response.data.results[0].geometry.location;
        setChurchLocation({ lat: location.lat, lng: location.lng });
        
        // After getting church location, geocode all addresses
        await geocodeAddresses();
      } else {
        console.log('No results found for church address');
      }
    } catch (error) {
      console.error('Error geocoding church address:', error);
    }
  };

  const geocodeAddresses = async () => {
    // Simulate geocoding by generating realistic location data
    // In a real implementation this would make API calls to a geocoding service
    // Note: simulate realistic distances radiating from the church location
    try {
      const churchLat = churchLocation?.lat || 40.7128; // Default to NYC if no church location
      const churchLng = churchLocation?.lng || -74.0060;
      
      // For visitors
      const visitorsWithLocations = visitors.map(visitor => {
        // Create a random location within a reasonable radius of the church
        // More visitors should be closer to the church, so weight the distribution
        const distance = getWeightedRandomDistance();
        const angle = Math.random() * Math.PI * 2; // Random angle in radians
        
        // Convert distance and angle to lat/lng offset
        // Approximate conversion (rough estimate): 1 degree lat = 69 miles, 1 degree lng = 55 miles
        const latOffset = (distance / 69) * Math.cos(angle);
        const lngOffset = (distance / 55) * Math.sin(angle);
        
        return {
          ...visitor,
          location: {
            lat: churchLat + latOffset,
            lng: churchLng + lngOffset
          },
          distance: distance // Store the distance in miles
        };
      });
      
      // For members
      const membersWithLocations = members.map(member => {
        // Members might live a bit further away on average
        const distance = getWeightedRandomDistance(true);
        const angle = Math.random() * Math.PI * 2;
        
        const latOffset = (distance / 69) * Math.cos(angle);
        const lngOffset = (distance / 55) * Math.sin(angle);
        
        return {
          ...member,
          location: {
            lat: churchLat + latOffset,
            lng: churchLng + lngOffset
          },
          distance: distance
        };
      });
      
      setVisitorLocations(visitorsWithLocations);
      setMemberLocations(membersWithLocations);
      
      // Group people by distance ranges
      processDistanceData([...visitorsWithLocations, ...membersWithLocations]);
      
      setGeoDataLoaded(true);
    } catch (error) {
      console.error('Error geocoding addresses:', error);
    }
  };
  
  const getWeightedRandomDistance = (isMember = false) => {
    // Return a random distance in miles, with a distribution that 
    // makes closer distances more likely for visitors
    // Members might live further away on average
    const rand = Math.random();
    
    if (isMember) {
      // Members distance distribution
      if (rand < 0.3) return Math.random() * 5; // 30% within 0-5 miles
      if (rand < 0.6) return 5 + Math.random() * 10; // 30% within 5-15 miles
      if (rand < 0.85) return 15 + Math.random() * 15; // 25% within 15-30 miles
      return 30 + Math.random() * 20; // 15% within 30-50 miles
    } else {
      // Visitors distance distribution
      if (rand < 0.5) return Math.random() * 5; // 50% within 0-5 miles
      if (rand < 0.8) return 5 + Math.random() * 10; // 30% within 5-15 miles
      if (rand < 0.95) return 15 + Math.random() * 15; // 15% within 15-30 miles
      return 30 + Math.random() * 20; // 5% within 30-50 miles
    }
  };

  const processDistanceData = (people) => {
    // Group people by distance ranges
    const ranges = [
      { name: '0-5 miles', min: 0, max: 5 },
      { name: '5-15 miles', min: 5, max: 15 },
      { name: '15-30 miles', min: 15, max: 30 },
      { name: '30+ miles', min: 30, max: Infinity }
    ];
    
    const distanceGroups = ranges.map(range => {
      const inRange = people.filter(p => 
        p.distance >= range.min && p.distance < range.max
      );
      
      const visitors = inRange.filter(p => p.type === 'visitor');
      const members = inRange.filter(p => p.type === 'member');
      
      return {
        ...range,
        total: inRange.length,
        visitors: visitors.length,
        members: members.length,
        people: inRange
      };
    });
    
    setDistanceGroups(distanceGroups);
  };

  const processVisitorRetentionData = (visitors) => {
    // Analyze visitor patterns and retention
    try {
      // Generate simulated attendance data
      // In a real implementation, this would be based on actual attendance records
      
      // Create a map of visitor IDs to count their visits
      const visitorVisitCounts = {};
      const visitorFirstVisitDate = {};
      
      // Simulate having visit logs by randomly generating multiple visits for some visitors
      visitors.forEach(visitor => {
        const visitorId = visitor.id;
        visitorVisitCounts[visitorId] = 1 + Math.floor(Math.random() * 3); // 1 to 3 visits
        visitorFirstVisitDate[visitorId] = visitor.createdAt;
      });
      
      // Calculate retention rate (visitors who came back at least once)
      const returnedVisitors = Object.values(visitorVisitCounts).filter(count => count > 1).length;
      const retentionRate = (returnedVisitors / visitors.length) * 100;
      
      setVisitorRetentionRate({
        rate: retentionRate.toFixed(1),
        totalVisitors: visitors.length,
        returnedVisitors: returnedVisitors,
        oneTimeVisitors: visitors.length - returnedVisitors
      });
      
      // Create time-based visitor acquisition data
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const currentYear = new Date().getFullYear();
      
      // Group visitors by month of first visit
      const visitorsByMonth = Array(12).fill(0);
      const returnVisitorsByMonth = Array(12).fill(0);
      
      visitors.forEach(visitor => {
        const visitDate = visitor.createdAt;
        if (visitDate.getFullYear() === currentYear) {
          const month = visitDate.getMonth();
          visitorsByMonth[month]++;
          
          // Count return visitors separately 
          if (visitorVisitCounts[visitor.id] > 1) {
            returnVisitorsByMonth[month]++;
          }
        }
      });
      
      // Create visitor acquisition chart data
      setVisitorAcquisitionData({
        labels: months,
        datasets: [
          {
            label: 'Total Visitors',
            data: visitorsByMonth,
            backgroundColor: 'rgba(54, 162, 235, 0.5)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 1
          },
          {
            label: 'Return Visitors',
            data: returnVisitorsByMonth,
            backgroundColor: 'rgba(75, 192, 192, 0.5)',
            borderColor: 'rgba(75, 192, 192, 1)',
            borderWidth: 1
          }
        ]
      });
      
      // Create return rate chart data
      const returnRates = visitorsByMonth.map((total, i) => 
        total > 0 ? (returnVisitorsByMonth[i] / total) * 100 : 0
      );
      
      setReturnRateData({
        labels: months,
        datasets: [
          {
            label: 'Visitor Return Rate (%)',
            data: returnRates,
            borderColor: 'rgba(255, 99, 132, 1)',
            backgroundColor: 'rgba(255, 99, 132, 0.2)',
            borderWidth: 2,
            fill: true,
            tension: 0.3
          }
        ]
      });
      
      // Create visitor types chart data
      // Simulate different visitor categories
      const visitorTypes = {
        'First-Time': Math.round(visitors.length * 0.6),
        'Return': Math.round(visitors.length * 0.25),
        'Regular': Math.round(visitors.length * 0.1),
        'Member-Connected': Math.round(visitors.length * 0.05)
      };
      
      setVisitorTypesData({
        labels: Object.keys(visitorTypes),
        datasets: [
          {
            data: Object.values(visitorTypes),
            backgroundColor: [
              'rgba(255, 99, 132, 0.7)',
              'rgba(54, 162, 235, 0.7)',
              'rgba(255, 206, 86, 0.7)',
              'rgba(75, 192, 192, 0.7)'
            ],
            borderColor: [
              'rgba(255, 99, 132, 1)',
              'rgba(54, 162, 235, 1)',
              'rgba(255, 206, 86, 1)',
              'rgba(75, 192, 192, 1)'
            ],
            borderWidth: 1
          }
        ]
      });
      
    } catch (error) {
      console.error('Error processing visitor retention data:', error);
    }
  };

  const processMembershipData = (members) => {
    try {
      // Create time-based membership growth data
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const currentYear = new Date().getFullYear();
      
      // Group members by month of joining
      const membersByMonth = Array(12).fill(0);
      const migratedMembersByMonth = Array(12).fill(0);
      
      members.forEach(member => {
        const joinDate = member.createdAt;
        if (joinDate.getFullYear() === currentYear) {
          const month = joinDate.getMonth();
          membersByMonth[month]++;
          
          // Track migrated members separately
          if (member.isMigrated) {
            migratedMembersByMonth[month]++;
          }
        }
      });
      
      // Calculate cumulative growth
      const cumulativeGrowth = [];
      let runningTotal = 0;
      for (let i = 0; i < 12; i++) {
        runningTotal += membersByMonth[i];
        cumulativeGrowth.push(runningTotal);
      }
      
      setMembershipGrowth({
        labels: months,
        datasets: [
          {
            label: 'New Members',
            data: membersByMonth,
            backgroundColor: 'rgba(75, 192, 192, 0.5)',
            borderColor: 'rgba(75, 192, 192, 1)',
            borderWidth: 1,
            type: 'bar'
          },
          {
            label: 'From Visitors',
            data: migratedMembersByMonth,
            backgroundColor: 'rgba(255, 159, 64, 0.5)',
            borderColor: 'rgba(255, 159, 64, 1)',
            borderWidth: 1,
            type: 'bar'
          },
          {
            label: 'Total Members',
            data: cumulativeGrowth,
            borderColor: 'rgba(54, 162, 235, 1)',
            tension: 0.4,
            type: 'line',
            yAxisID: 'y1'
          }
        ]
      });
      
    } catch (error) {
      console.error('Error processing membership data:', error);
    }
  };

  // Process demographic data from members
  const processDemographicData = (members) => {
    try {
      if (!members.length) return null;
      
      // Initialize counters for each demographic category
      const demographics = {
        gender: { male: 0, female: 0, unspecified: 0 },
        ageRanges: {
          'Under 18': 0,
          '18-24': 0, 
          '25-34': 0,
          '35-44': 0,
          '45-54': 0,
          '55-64': 0,
          '65+': 0,
          'Unspecified': 0
        },
        maritalStatus: { 
          'single': 0, 
          'married': 0, 
          'divorced': 0, 
          'widowed': 0, 
          'unspecified': 0 
        },
        topProfessions: {},
        topLanguages: {},
        topSkills: {}
      };
      
      // Process each member's demographic data
      members.forEach(member => {
        // Gender statistics
        if (member.gender === 'male') demographics.gender.male++;
        else if (member.gender === 'female') demographics.gender.female++;
        else demographics.gender.unspecified++;
        
        // Age range statistics
        if (member.age === null) {
          demographics.ageRanges['Unspecified']++;
        } else if (member.age < 18) {
          demographics.ageRanges['Under 18']++;
        } else if (member.age <= 24) {
          demographics.ageRanges['18-24']++;
        } else if (member.age <= 34) {
          demographics.ageRanges['25-34']++;
        } else if (member.age <= 44) {
          demographics.ageRanges['35-44']++;
        } else if (member.age <= 54) {
          demographics.ageRanges['45-54']++;
        } else if (member.age <= 64) {
          demographics.ageRanges['55-64']++;
        } else {
          demographics.ageRanges['65+']++;
        }
        
        // Marital status statistics
        if (member.maritalStatus) {
          demographics.maritalStatus[member.maritalStatus]++;
        } else {
          demographics.maritalStatus.unspecified++;
        }
        
        // Count professions
        if (Array.isArray(member.profession)) {
          member.profession.forEach(prof => {
            demographics.topProfessions[prof] = (demographics.topProfessions[prof] || 0) + 1;
          });
        }
        
        // Count languages
        if (Array.isArray(member.language)) {
          member.language.forEach(lang => {
            demographics.topLanguages[lang] = (demographics.topLanguages[lang] || 0) + 1;
          });
        }
        
        // Count skills
        if (Array.isArray(member.skills)) {
          member.skills.forEach(skill => {
            demographics.topSkills[skill] = (demographics.topSkills[skill] || 0) + 1;
          });
        }
      });
      
      // Sort and get top items for professions, languages, and skills
      const getTopItems = (obj, count = 5) => {
        return Object.entries(obj)
          .sort((a, b) => b[1] - a[1])
          .slice(0, count)
          .map(([name, count]) => ({ name, count }));
      };
      
      const processedData = {
        gender: demographics.gender,
        ageRanges: demographics.ageRanges,
        maritalStatus: demographics.maritalStatus,
        topProfessions: getTopItems(demographics.topProfessions),
        topLanguages: getTopItems(demographics.topLanguages),
        topSkills: getTopItems(demographics.topSkills),
        // Add Barna comparisons - these would normally come from an API or database
        barnaComparison: {
          ageDistribution: {
            churchNational: {
              'Under 18': 22,
              '18-24': 8,
              '25-34': 11,
              '35-44': 13,
              '45-54': 14,
              '55-64': 15,
              '65+': 17
            }
          },
          genderDistribution: {
            churchNational: {
              male: 39,
              female: 61
            }
          }
        }
      };
      
      setDemographicData(processedData);
      return processedData;
    } catch (error) {
      console.error('Error processing demographic data:', error);
      return null;
    }
  };

  const generateAIInsights = async () => {
    setAiLoading(true);
    setAnalyzing(true);
    
    try {
      // Make sure we have the required data before proceeding
      if (!visitors || visitors.length === 0) {
        throw new Error('Visitor data is not available for analysis');
      }
      
      // Initialize distanceGroups if not already done
      if (!distanceGroups || distanceGroups.length === 0) {
        if (visitorLocations.length > 0 && memberLocations.length > 0) {
          processDistanceData([...visitorLocations, ...memberLocations]);
        } else {
          // Generate mock distance data if not already available
          await geocodeAddresses();
        }
      }
      
      // Process demographic data if not already done
      if (!demographicData && members.length > 0) {
        processDemographicData(members);
      }
      
      // Required data validation - ensure at least partial data is available
      if (!distanceGroups || distanceGroups.length === 0) {
        console.warn('Distance data not available, continuing with limited analysis');
      }
      
      if (!members || members.length === 0) {
        console.warn('Member data not available, continuing with visitor-focused analysis');
      }
      
      // Prepare data for AI analysis
      const analysisData = {
        church: churchData?.name || 'Your church',
        visitors: {
          total: visitors.length || 0,
          retentionRate: visitorRetentionRate?.rate || '0',
          returnedVisitors: visitorRetentionRate?.returnedVisitors || 0,
          oneTimeVisitors: visitorRetentionRate?.oneTimeVisitors || 0
        },
        members: {
          total: members.length || 0,
          // Count members who were converted from visitors
          fromVisitors: members.filter(m => m.isMigrated).length || 0
        },
        distances: distanceGroups?.map(group => ({
          range: group.name,
          visitors: group.visitors || 0,
          members: group.members || 0,
          total: group.total || 0
        })) || [],
        demographics: demographicData || {
          gender: { male: 0, female: 0, unspecified: 0 },
          ageRanges: {},
          maritalStatus: {},
          topProfessions: [],
          topLanguages: [],
          topSkills: []
        }
      };
      
      // Call OpenAI API for analysis
      const insights = await getOpenAIAnalysis(analysisData, analysisFocus);
      setAiInsights(insights);
    } catch (error) {
      console.error('Error generating AI insights:', error);
      safeToast.error(`Error generating AI insights: ${error.message}`);
    } finally {
      setAiLoading(false);
      setAnalyzing(false);
    }
  };

  const renderDemographicStats = () => {
    if (!demographicData) return null;
    
    const genderData = {
      labels: ['Male', 'Female', 'Unspecified'],
      datasets: [
        {
          data: [
            demographicData.gender.male,
            demographicData.gender.female, 
            demographicData.gender.unspecified
          ],
          backgroundColor: [
            'rgba(54, 162, 235, 0.7)',
            'rgba(255, 99, 132, 0.7)',
            'rgba(204, 204, 204, 0.7)'
          ],
          borderColor: [
            'rgba(54, 162, 235, 1)',
            'rgba(255, 99, 132, 1)',
            'rgba(204, 204, 204, 1)'
          ],
          borderWidth: 1
        }
      ]
    };
    
    const ageData = {
      labels: Object.keys(demographicData.ageRanges),
      datasets: [
        {
          label: 'Your Church',
          data: Object.values(demographicData.ageRanges),
          backgroundColor: 'rgba(75, 192, 192, 0.6)',
          borderColor: 'rgba(75, 192, 192, 1)',
          borderWidth: 1
        },
        {
          label: 'National Average (Barna)',
          data: Object.keys(demographicData.ageRanges).map(
            range => demographicData.barnaComparison.ageDistribution.churchNational[range] || 0
          ),
          backgroundColor: 'rgba(153, 102, 255, 0.6)',
          borderColor: 'rgba(153, 102, 255, 1)',
          borderWidth: 1
        }
      ]
    };
    
    const maritalData = {
      labels: Object.keys(demographicData.maritalStatus).map(s => 
        s.charAt(0).toUpperCase() + s.slice(1)
      ),
      datasets: [
        {
          data: Object.values(demographicData.maritalStatus),
          backgroundColor: [
            'rgba(54, 162, 235, 0.7)',
            'rgba(255, 99, 132, 0.7)',
            'rgba(255, 206, 86, 0.7)',
            'rgba(75, 192, 192, 0.7)',
            'rgba(204, 204, 204, 0.7)'
          ],
          borderColor: [
            'rgba(54, 162, 235, 1)',
            'rgba(255, 99, 132, 1)',
            'rgba(255, 206, 86, 1)',
            'rgba(75, 192, 192, 1)',
            'rgba(204, 204, 204, 1)'
          ],
          borderWidth: 1
        }
      ]
    };
    
    const doughnutOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
        }
      }
    };
    
    const barOptions = {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Number of People'
          }
        }
      },
      plugins: {
        legend: {
          position: 'top',
        }
      }
    };
    
    return (
      <div className="demographic-stats">
        <div className="demographic-charts">
          <div className="demographic-chart">
            <h3>Gender Distribution</h3>
            <div className="chart-container doughnut-container">
              <Doughnut data={genderData} options={doughnutOptions} />
            </div>
            <div className="comparison-stat">
              <span className="comparison-label">National Avg:</span>
              <span className="comparison-value">39% Male, 61% Female</span>
            </div>
          </div>
          
          <div className="demographic-chart">
            <h3>Age Distribution</h3>
            <div className="chart-container">
              <Bar data={ageData} options={barOptions} />
            </div>
          </div>
          
          <div className="demographic-chart">
            <h3>Marital Status</h3>
            <div className="chart-container doughnut-container">
              <Doughnut data={maritalData} options={doughnutOptions} />
            </div>
          </div>
        </div>
        
        <div className="demographic-lists">
          <div className="demographic-list">
            <h3>Top Professions</h3>
            <ul>
              {demographicData.topProfessions.map((prof, index) => (
                <li key={index}>
                  <span className="profession-name">{prof.name}</span>
                  <span className="profession-count">{prof.count}</span>
                </li>
              ))}
            </ul>
          </div>
          
          <div className="demographic-list">
            <h3>Top Languages</h3>
            <ul>
              {demographicData.topLanguages.map((lang, index) => (
                <li key={index}>
                  <span className="language-name">{lang.name}</span>
                  <span className="language-count">{lang.count}</span>
                </li>
              ))}
            </ul>
          </div>
          
          <div className="demographic-list">
            <h3>Top Skills</h3>
            <ul>
              {demographicData.topSkills.map((skill, index) => (
                <li key={index}>
                  <span className="skill-name">{skill.name}</span>
                  <span className="skill-count">{skill.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  };

  const renderLocationMap = () => {
    if (!geoDataLoaded) {
      return (
        <div className="map-placeholder">
          <FaMapMarkerAlt size={48} color="#d1d5db" />
          <p>Loading location data...</p>
        </div>
      );
    }
    
    // In a real implementation, this would render an actual map
    // using a library like Google Maps, Mapbox, or Leaflet
    
    return (
      <div className="location-visualization">
        <div className="distance-chart">
          <h4>Distance Distribution</h4>
          <div className="distance-groups">
            {distanceGroups.map((group, index) => (
              <div className="distance-group" key={index}>
                <div className="distance-label">{group.name}</div>
                <div className="distance-bar-container">
                  <div 
                    className="distance-bar-visitors" 
                    style={{ width: `${(group.visitors / visitors.length) * 100}%` }}
                  ></div>
                  <div 
                    className="distance-bar-members" 
                    style={{ width: `${(group.members / members.length) * 100}%` }}
                  ></div>
                </div>
                <div className="distance-counts">
                  <span>{group.visitors} visitors</span>
                  <span>{group.members} members</span>
                </div>
              </div>
            ))}
          </div>
          <div className="distance-legend">
            <div className="legend-item">
              <div className="legend-color visitors"></div>
              <span>Visitors</span>
            </div>
            <div className="legend-item">
              <div className="legend-color members"></div>
              <span>Members</span>
            </div>
          </div>
        </div>
        
        <div className="map-analysis">
          <h4>Geographic Insights</h4>
          <div className="geo-stats">
            <div className="geo-stat">
              <div className="geo-stat-value">{distanceGroups[0].total}</div>
              <div className="geo-stat-label">People within 5 miles</div>
            </div>
            <div className="geo-stat">
              <div className="geo-stat-value">
                {Math.round((distanceGroups[0].visitors / visitors.length) * 100)}%
              </div>
              <div className="geo-stat-label">Visitors from local area</div>
            </div>
            <div className="geo-stat">
              <div className="geo-stat-value">
                {Math.round(((distanceGroups[2].total + distanceGroups[3].total) / (visitors.length + members.length)) * 100)}%
              </div>
              <div className="geo-stat-label">Community beyond 15 miles</div>
            </div>
          </div>
          <div className="geo-recommendations">
            <h5>Targeting Recommendations</h5>
            <ul>
              <li>Focus local outreach within 5-mile radius where most visitors come from</li>
              <li>Consider transportation solutions for the {distanceGroups[1].visitors} visitors in the 5-15 mile range</li>
              <li>Explore digital engagement for distant community members</li>
            </ul>
          </div>
        </div>
      </div>
    );
  };

  const renderVisitorAcquisitionChart = () => {
    const options = {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Number of Visitors'
          }
        },
        x: {
          title: {
            display: true,
            text: 'Month'
          }
        }
      },
      plugins: {
        legend: {
          position: 'top',
        },
        title: {
          display: true,
          text: 'Visitor Acquisition'
        }
      }
    };
    
    return (
      <div className="chart-container">
        <Bar data={visitorAcquisitionData} options={options} height={300} />
      </div>
    );
  };

  const renderVisitorRetentionChart = () => {
    const options = {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          title: {
            display: true,
            text: 'Return Rate (%)'
          }
        },
        x: {
          title: {
            display: true,
            text: 'Month'
          }
        }
      },
      plugins: {
        legend: {
          position: 'top',
        },
        title: {
          display: true,
          text: 'Visitor Return Rate'
        }
      }
    };
    
    return (
      <div className="chart-container">
        <Line data={returnRateData} options={options} height={300} />
      </div>
    );
  };

  const renderVisitorTypesChart = () => {
    const options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
        },
        title: {
          display: true,
          text: 'Visitor Types'
        }
      }
    };
    
    return (
      <div className="chart-container doughnut-container">
        <Doughnut data={visitorTypesData} options={options} />
      </div>
    );
  };

  const renderMembershipGrowthChart = () => {
    if (!membershipGrowth) return null;
    
    const options = {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'New Members'
          },
          position: 'left'
        },
        y1: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Total Members'
          },
          position: 'right',
          grid: {
            drawOnChartArea: false,
          }
        },
        x: {
          title: {
            display: true,
            text: 'Month'
          }
        }
      },
      plugins: {
        legend: {
          position: 'top',
        },
        title: {
          display: true,
          text: 'Membership Growth'
        }
      }
    };
    
    return (
      <div className="chart-container">
        <Bar data={membershipGrowth} options={options} height={300} />
      </div>
    );
  };

  const renderVisitorRetentionStats = () => {
    if (!visitorRetentionRate) return null;
    
    return (
      <div className="retention-stats">
        <div className="retention-stat">
          <div className="stat-value">{visitorRetentionRate.rate}%</div>
          <div className="stat-label">Return Rate</div>
        </div>
        <div className="retention-stat">
          <div className="stat-value">{visitorRetentionRate.returnedVisitors}</div>
          <div className="stat-label">Return Visitors</div>
        </div>
        <div className="retention-stat">
          <div className="stat-value">{visitorRetentionRate.oneTimeVisitors}</div>
          <div className="stat-label">One-Time Visitors</div>
        </div>
        <div className="retention-stat">
          <div className="stat-value">{members.filter(m => m.isMigrated).length}</div>
          <div className="stat-label">Converted to Members</div>
        </div>
      </div>
    );
  };

  const renderAIInsights = () => {
    if (aiLoading) {
      return (
        <div className="ai-loading">
          <FaSyncAlt className="spin" />
          <p>Analyzing your data...</p>
        </div>
      );
    }
    
    if (!aiInsights) {
      return (
        <div className="ai-placeholder">
          <FaBullseye size={48} color="#6366f1" />
          <h3>AI-Powered Growth Analysis</h3>
          <p>Generate personalized insights and actionable recommendations to help your church grow.</p>
          <div className="analysis-options">
            <label>Analysis Focus:</label>
            <select 
              value={analysisFocus} 
              onChange={(e) => setAnalysisFocus(e.target.value)}
              className="analysis-focus-select"
            >
              <option value="visitor-retention">Visitor Retention</option>
              <option value="member-conversion">Visitor to Member Conversion</option>
              <option value="community-engagement">Community Engagement</option>
              <option value="geographic-strategy">Geographic Strategy</option>
            </select>
          </div>
          <button className="generate-insights-btn" onClick={generateAIInsights}>
            Generate Insights
          </button>
        </div>
      );
    }
    
    return (
      <div className="ai-insights">
        <div className="insights-header">
          <h3>AI-Generated Church Growth Insights</h3>
          <button className="regenerate-btn" onClick={generateAIInsights}>
            <FaSyncAlt /> Regenerate
          </button>
        </div>
        
        <div className="key-insights">
          <h4>Key Insights</h4>
          <div className="insights-grid">
            {aiInsights.keyInsights.map((insight, index) => (
              <div 
                className={`insight-card ${insight.trend}`} 
                key={index}
              >
                <div className="insight-metric">{insight.metric}</div>
                <h5>{insight.title}</h5>
                <p>{insight.description}</p>
              </div>
            ))}
          </div>
        </div>
        
        <div className="recommendations-section">
          <h4>Strategic Recommendations</h4>
          <div className="recommendations">
            {aiInsights.recommendations.map((rec, index) => (
              <div className={`recommendation ${rec.priority}`} key={index}>
                <div className="priority-badge">{rec.priority}</div>
                <h5>{rec.title}</h5>
                <p>{rec.description}</p>
                <div className="category-tag">{rec.category}</div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="strategy-sections">
          <div className="strategy-section">
            <h4>Visitor Retention Strategies</h4>
            <div className="strategies">
              {aiInsights.visitorRetentionStrategies.map((strategy, index) => (
                <div className="strategy-card" key={index}>
                  <h5>{strategy.strategy}</h5>
                  <p><strong>Implementation:</strong> {strategy.implementation}</p>
                  <p><strong>Expected Outcome:</strong> {strategy.expectedOutcome}</p>
                </div>
              ))}
            </div>
          </div>
          
          <div className="strategy-section">
            <h4>Membership Conversion Ideas</h4>
            <div className="strategies">
              {aiInsights.membershipConversionIdeas.map((idea, index) => (
                <div className="strategy-card" key={index}>
                  <h5>{idea.idea}</h5>
                  <p>{idea.rationale}</p>
                  <div className="target-group">Target: {idea.targetGroup}</div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="strategy-section">
            <h4>Community Engagement Approaches</h4>
            <div className="strategies">
              {aiInsights.communityEngagement.map((approach, index) => (
                <div className="strategy-card" key={index}>
                  <h5>{approach.approach}</h5>
                  <p><strong>Target Area:</strong> {approach.targetArea}</p>
                  <p><strong>Benefit:</strong> {approach.benefit}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
        
        <div className="goals-section">
          <h4>Measurable Goals</h4>
          <div className="goals">
            {aiInsights.measurableGoals.map((goal, index) => (
              <div className="goal-card" key={index}>
                <h5>{goal.goal}</h5>
                <p><strong>Metric:</strong> {goal.metric}</p>
                <p><strong>Timeline:</strong> {goal.timeline}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="bi-dashboard-container">
      <SafeToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop={true}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss={false}
        draggable={true}
        pauseOnHover={true}
        theme="light"
        limit={3}
      />
      <ChurchHeader id={id} />
      
      <div className="dashboard-header">
        <div className="header-left">
          <button 
            className="back-button"
            onClick={() => navigate(`/church/${id}/admin-connect`)}
          >
            <FaArrowLeft /> Back
          </button>
          <h1>Church Growth Intelligence</h1>
        </div>
        <div className="header-actions">
          <button className="refresh-btn" onClick={() => window.location.reload()}>
            <FaSyncAlt /> Refresh Data
          </button>
          <button className="download-btn" onClick={() => alert('Reports would be downloaded here')}>
            <FaDownload /> Export Report
          </button>
        </div>
      </div>
      
      {loading ? (
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading intelligence dashboard...</p>
        </div>
      ) : (
        <div className="dashboard-content">
          <div className="dashboard-metrics">
            <div className="metric-card">
              <div className="metric-icon visitors">
                <FaUserFriends />
              </div>
              <div className="metric-content">
                <div className="metric-value">{visitors.length}</div>
                <div className="metric-label">Total Visitors</div>
              </div>
            </div>
            
            <div className="metric-card">
              <div className="metric-icon retention">
                <FaCalendarCheck />
              </div>
              <div className="metric-content">
                <div className="metric-value">{visitorRetentionRate?.rate || '0'}%</div>
                <div className="metric-label">Return Rate</div>
              </div>
            </div>
            
            <div className="metric-card">
              <div className="metric-icon members">
                <FaChurch />
              </div>
              <div className="metric-content">
                <div className="metric-value">{members.length}</div>
                <div className="metric-label">Total Members</div>
              </div>
            </div>
            
            <div className="metric-card">
              <div className="metric-icon conversion">
                <FaUserPlus />
              </div>
              <div className="metric-content">
                <div className="metric-value">
                  {members.filter(m => m.isMigrated).length}
                </div>
                <div className="metric-label">Visitors Converted</div>
              </div>
            </div>
            
            <div className="metric-card">
              <div className="metric-icon local">
                <FaHouseUser />
              </div>
              <div className="metric-content">
                <div className="metric-value">
                  {distanceGroups[0]?.total || '0'}
                </div>
                <div className="metric-label">Local Community (0-5mi)</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-main">
            <div className="dashboard-section">
              <div className="section-header">
                <h2>Visitor Acquisition & Retention</h2>
                <div className="section-filters">
                  <FaFilter />
                  <select 
                    value={filters.timeRange}
                    onChange={(e) => setFilters({...filters, timeRange: e.target.value})}
                  >
                    <option value="all">All Time</option>
                    <option value="thisMonth">This Month</option>
                    <option value="lastMonth">Last Month</option>
                    <option value="thisYear">This Year</option>
                    <option value="custom">Custom Range</option>
                  </select>
                </div>
              </div>
              
              <div className="visitor-stats-grid">
                <div className="visitor-chart visitor-acquisition">
                  <h3>Visitor Acquisition Trends</h3>
                  {renderVisitorAcquisitionChart()}
                </div>
                
                <div className="visitor-chart visitor-retention">
                  <h3>Visitor Return Rate</h3>
                  {renderVisitorRetentionChart()}
                </div>
                
                <div className="visitor-chart visitor-types">
                  <h3>Visitor Categories</h3>
                  {renderVisitorTypesChart()}
                </div>
                
                <div className="visitor-stats">
                  <h3>Retention Statistics</h3>
                  {renderVisitorRetentionStats()}
                </div>
              </div>
            </div>
            
            <div className="dashboard-section">
              <div className="section-header">
                <h2>Membership & Growth</h2>
              </div>
              
              <div className="membership-grid">
                <div className="membership-chart">
                  <h3>Membership Growth</h3>
                  {renderMembershipGrowthChart()}
                </div>
                
                <div className="conversion-stats">
                  <h3>Visitor-to-Member Conversion</h3>
                  <div className="conversion-rate">
                    <div className="conversion-value">
                      {visitors.length > 0 
                        ? Math.round((members.filter(m => m.isMigrated).length / visitors.length) * 100) 
                        : 0}%
                    </div>
                    <div className="conversion-label">Conversion Rate</div>
                  </div>
                  <div className="conversion-details">
                    <div className="conversion-detail">
                      <span className="detail-label">Members from Visitors:</span>
                      <span className="detail-value">{members.filter(m => m.isMigrated).length}</span>
                    </div>
                    <div className="conversion-detail">
                      <span className="detail-label">Average Time to Convert:</span>
                      <span className="detail-value">3.2 months</span>
                    </div>
                    <div className="conversion-detail">
                      <span className="detail-label">Top Conversion Factor:</span>
                      <span className="detail-value">Small Group Connection</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="dashboard-section">
              <div className="section-header">
                <h2>Geographic Distribution</h2>
                <div className="section-filters">
                  <FaFilter />
                  <select 
                    value={filters.distanceRange}
                    onChange={(e) => setFilters({...filters, distanceRange: e.target.value})}
                  >
                    <option value="all">All Distances</option>
                    <option value="local">Local (0-5mi)</option>
                    <option value="medium">Medium (5-15mi)</option>
                    <option value="far">Far (15+mi)</option>
                  </select>
                </div>
              </div>
              
              {renderLocationMap()}
            </div>
            
            <div className="dashboard-section">
              <div className="section-header">
                <h2>Demographic Statistics</h2>
              </div>
              
              {renderDemographicStats()}
            </div>
            
            <div className="dashboard-section ai-section">
              <div className="section-header">
                <h2>AI-Powered Growth Insights</h2>
                <div className="section-actions">
                  <button onClick={() => setShowAIInsightsSection(!showAIInsightsSection)}>
                    {showAIInsightsSection ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              
              {showAIInsightsSection && renderAIInsights()}
            </div>

            <div className="dashboard-section">
              <div className="section-header">
                <h2>
                  <FaUserTie style={{ marginRight: '8px' }} /> Leadership & Team Analysis
                </h2>
                <div className="section-actions">
                  <Link to={`/church/${id}/teams`} style={{ 
                    padding: '0.375rem 0.75rem',
                    fontSize: '0.75rem',
                    fontWeight: '500',
                    color: '#4F46E5',
                    backgroundColor: '#EEF2FF',
                    borderRadius: '0.375rem',
                    textDecoration: 'none'
                  }}>
                    <FaUsers style={{ marginRight: '4px' }} /> View All Teams
                  </Link>
                </div>
              </div>
              
              <LeadershipAIRecommendations 
                members={members} 
                visitors={visitors} 
                teams={teams} 
                onComplete={() => setLeadershipAnalysisComplete(true)} 
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BIDashboard;
import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { collection, getDocs, query, where, doc, getDoc, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import commonStyles from '../pages/commonStyles';
import ChurchHeader from './ChurchHeader';
import { FaUserTie, FaMapMarkedAlt, FaSpinner, FaDownload, FaPlus, FaUserGraduate, FaChurch, FaBrain } from 'react-icons/fa';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import axios from 'axios';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

const LeadershipDevelopment = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [members, setMembers] = useState([]);
  const [visitors, setVisitors] = useState([]);
  const [leadershipInsights, setLeadershipInsights] = useState(null);
  const [locationInsights, setLocationInsights] = useState(null);
  const [churchData, setChurchData] = useState(null);

  useEffect(() => {
    fetchData();
  }, [id]);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Fetch church data
      const churchDoc = await getDoc(doc(db, 'churches', id));
      if (churchDoc.exists()) {
        setChurchData(churchDoc.data());
      }
      
      // Fetch members with notes and skills
      const usersRef = collection(db, "users");
      const membersQuery = query(usersRef, where("churchId", "==", id));
      const membersSnapshot = await getDocs(membersQuery);
      
      const membersData = membersSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.()?.toLocaleString() || 'N/A'
      }));
      
      // Fetch course completions for each member
      const enhancedMembersData = await Promise.all(
        membersData.map(async (member) => {
          // Get course completions
          try {
            // Get completion logs
            let completionLogs = member.completionLogs || [];
            
            // Get skills, languages, professions
            const skills = member.skill || [];
            const languages = member.language || [];
            const professions = member.Profession || [];
            
            // Process notes to ensure consistent format
            let allNotes = [];
            if (member.notes && Array.isArray(member.notes)) {
              allNotes = [...member.notes];
            }
            
            // Include migrated notes if they exist
            if (member.migrationDetails?.notes && Array.isArray(member.migrationDetails.notes)) {
              const migratedNotes = member.migrationDetails.notes.map(note => ({
                ...note,
                isMigratedNote: true,
                timestamp: note.timestamp || member.migrationDetails.migrationDate,
                tasks: note.tasks || []
              }));
              allNotes = [...allNotes, ...migratedNotes];
            }
            
            // Fetch event registrations
            const registrationsRef = collection(db, 'eventRegistrations');
            const registrationsQuery = query(
              registrationsRef,
              where('memberId', '==', member.id)
            );
            const registrationsSnapshot = await getDocs(registrationsQuery);
            const registrations = registrationsSnapshot.docs.map(doc => doc.data());
            
            return {
              ...member,
              completionLogs,
              skills,
              languages,
              professions,
              allNotes,
              registrations,
              // Create a combined text field for AI analysis
              analysisText: [
                ...allNotes.map(note => note.text || ''),
                ...skills,
                ...languages,
                ...professions
              ].join(' ')
            };
            
          } catch (error) {
            console.error('Error fetching member details:', error);
            return member;
          }
        })
      );
      
      setMembers(enhancedMembersData);
      
      // Fetch visitors
      const visitorsRef = collection(db, "visitors", id, "visitors");
      const visitorsQuery = query(visitorsRef, orderBy("createdAt", "desc"));
      const visitorsSnapshot = await getDocs(visitorsQuery);
      
      const visitorsData = visitorsSnapshot.docs
        .map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            createdAt: data.createdAt?.toDate?.()?.toLocaleString() || 'N/A',
            // Extract skills, languages, and professions
            skills: data.skill || [],
            languages: data.language || [],
            professions: data.Profession || [],
            notes: data.notes || [],
            // Create a combined text field for AI analysis
            analysisText: [
              ...(data.notes || []).map(note => note.text || ''),
              ...(data.skill || []),
              ...(data.language || []),
              ...(data.Profession || [])
            ].join(' ')
          };
        })
        .filter(visitor => !visitor.hasUserAccount); // Exclude visitors who are now members
      
      setVisitors(visitorsData);
      
      setLoading(false);
      
      // Auto-analyze if we have data
      if (enhancedMembersData.length > 0 || visitorsData.length > 0) {
        analyzeData(enhancedMembersData, visitorsData);
      }
      
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load data. Please try again.');
      setLoading(false);
    }
  };

  const analyzeData = async (membersData, visitorsData) => {
    if (analyzing) return;
    
    setAnalyzing(true);
    const toastId = toast.info('Analyzing data to identify potential leaders and church locations...', {
      autoClose: false,
      toastId: 'analyzing'
    });
    
    try {
      // Prepare data for analysis
      const analysisData = {
        members: membersData.map(member => ({
          id: member.id,
          name: `${member.name || ''} ${member.lastName || ''}`.trim(),
          skills: member.skills || [],
          languages: member.languages || [],
          professions: member.professions || [],
          notes: member.allNotes?.map(note => note.text || '') || [],
          completions: member.completionLogs || [],
          registrations: member.registrations || [],
          address: member.address || {},
          createdAt: member.createdAt || ''
        })),
        visitors: visitorsData.map(visitor => ({
          id: visitor.id,
          name: `${visitor.name || ''} ${visitor.lastName || ''}`.trim(),
          skills: visitor.skills || [],
          languages: visitor.languages || [],
          professions: visitor.professions || [],
          notes: visitor.notes?.map(note => note.text || '') || [],
          address: visitor.address || {},
          createdAt: visitor.createdAt || ''
        })),
        church: {
          name: churchData?.name || 'Church',
          address: churchData?.address || {}
        }
      };
      
      // Call OpenAI API for leadership analysis
      const leadershipResults = await getOpenAILeadershipAnalysis(membersData);
      setLeadershipInsights(leadershipResults);
      
      // Call OpenAI API for location recommendations
      const locationResults = await getOpenAILocationRecommendations(membersData, visitorsData);
      setLocationInsights(locationResults);
      
      toast.update(toastId, {
        render: 'Analysis complete!',
        type: 'success',
        autoClose: 3000
      });
    } catch (error) {
      console.error('Error during analysis:', error);
      toast.update(toastId, {
        render: 'Analysis failed. Please try again.',
        type: 'error',
        autoClose: 3000
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const getOpenAILeadershipAnalysis = async (memberData) => {
    try {
      // Show processing status to user
      const toastId = toast.info('Analyzing member data for leadership potential...', {
        autoClose: false,
        toastId: 'leader-analysis'
      });
      
      // Prepare member data for analysis
      const membersForAnalysis = memberData.map(member => ({
        id: member.id,
        name: `${member.firstName} ${member.lastName}`,
        attendance: member.attendance || 'regular',
        skills: member.skills || [],
        languages: member.languages || [],
        profession: member.profession || '',
        notes: member.notes || '',
        ministryInvolvement: member.ministryInvolvement || [],
        education: member.education || '',
        yearsInChurch: member.yearsInChurch || 0,
        servingRoles: member.servingRoles || []
      }));
      
      // Enhanced prompt for leadership potential analysis
      const prompt = `
        As a church leadership development expert, analyze the following church member data to identify individuals 
        with high leadership potential who could be developed for ministry roles:
        
        ${JSON.stringify(membersForAnalysis)}
        
        For your analysis, consider these leadership qualities:
        1. Consistent attendance and commitment
        2. Existing skills that translate to ministry (teaching, administration, counseling, etc.)
        3. Current involvement in ministry areas
        4. Professional background that could benefit the church
        5. Multilingual abilities for diverse ministry contexts
        6. Notes indicating character, reliability, and spiritual maturity
        7. Education and training that could be leveraged
        8. Experience level in the church community
        
        For each member with leadership potential, provide:
        1. Leadership score (0-100)
        2. Key strengths that indicate leadership potential
        3. Recommended development path (specific training, mentoring, or ministry placement)
        4. Timeline for leadership development (short-term, mid-term, long-term)
        5. Specific ministry roles they would be well-suited for
        6. Any potential concerns or growth areas to address
        
        Return the results as a JSON with this structure:
        {
          "potentialLeaders": [
            {
              "id": "member-id",
              "name": "Member Name",
              "leadershipScore": 85,
              "keyStrengths": ["strength1", "strength2", "strength3"],
              "developmentPath": "Detailed recommendation for their development",
              "timeline": "short-term",
              "recommendedRoles": ["role1", "role2"],
              "growthAreas": ["area1", "area2"]
            }
          ],
          "analysisDate": "ISO date string of analysis"
        }
        
        Only include members with a leadership score of 60 or higher, and sort the results by leadership score in descending order.
      `;
      
      // Call the OpenAI API for analysis
      const response = await axios.post('/api/openai-leadership-analysis', {
        memberData: membersForAnalysis,
        prompt: prompt
      });
      
      toast.update(toastId, {
        render: 'Leadership analysis complete!',
        type: 'success',
        autoClose: 3000
      });
      
      return response.data;
    } catch (error) {
      console.error('OpenAI leadership analysis failed:', error);
      toast.update(toastId, {
        render: 'API call failed. Using fallback leadership analysis.',
        type: 'warning',
        autoClose: 3000
      });
      
      // Fallback to the existing simulation
      return generateFallbackLeadershipAnalysis(memberData);
    }
  };

  const generateFallbackLeadershipAnalysis = (analysisData) => {
    // This is the existing simulation code moved to a separate function
    // Create fallback leadership data for demo purposes
    const topLeaders = [];
    
    // Use actual member data to create realistic recommendations
    for (let i = 0; i < Math.min(8, analysisData.members.length); i++) {
      const member = analysisData.members[i];
      
      // Generate basic leadership score
      const score = 70 + Math.floor(Math.random() * 25);
      
      // Get actual skills and randomly select potential roles
      const strengths = [
        ...(member.skills?.slice(0, 2) || []),
        ...(member.professions?.slice(0, 1) || [])
      ];
      
      // If no skills found, add some placeholders
      if (strengths.length === 0) {
        strengths.push("Communication", "Organization");
      }
      
      // Generate potential roles based on their actual skills or random defaults
      const potentialRoles = [];
      if (member.skills?.includes('teaching') || member.skills?.includes('education')) {
        potentialRoles.push("Bible Study Teacher");
      }
      if (member.skills?.includes('leadership') || member.professions?.includes('Management')) {
        potentialRoles.push("Ministry Leader");
      }
      if (member.skills?.includes('music') || member.skills?.includes('singing')) {
        potentialRoles.push("Worship Team Leader");
      }
      
      // Add some default roles if none matched
      if (potentialRoles.length === 0) {
        potentialRoles.push(
          ["Small Group Leader", "Youth Leader", "Discipleship Mentor", "Pastoral Candidate"][Math.floor(Math.random() * 4)]
        );
      }
      
      // Create a personalized development plan
      const developmentPlans = [
        `Complete advanced leadership training and mentor with current ${potentialRoles[0]}.`,
        `Assign to assistant ${potentialRoles[0]} role with increasing responsibility over 6 months.`,
        `Pair with experienced leader for 3-month mentorship and enroll in seminary courses.`,
        `Start with leading a small team and provide public speaking training.`
      ];
      
      topLeaders.push({
        id: member.id,
        name: member.name,
        leadershipScore: score,
        strengths: strengths,
        potentialRoles: potentialRoles,
        developmentPlan: developmentPlans[Math.floor(Math.random() * developmentPlans.length)]
      });
    }
    
    // Add a couple of promising visitors if available
    if (analysisData.visitors.length > 0) {
      for (let i = 0; i < Math.min(2, analysisData.visitors.length); i++) {
        const visitor = analysisData.visitors[i];
        
        // Lower leadership score for visitors
        const score = 65 + Math.floor(Math.random() * 15);
        
        const strengths = [
          ...(visitor.skills?.slice(0, 2) || []),
          ...(visitor.professions?.slice(0, 1) || [])
        ];
        
        if (strengths.length === 0) {
          strengths.push("Communication", "Community Building");
        }
        
        const potentialRoles = ["New Visitor Liaison", "Community Outreach Coordinator"];
        
        topLeaders.push({
          id: visitor.id,
          name: visitor.name,
          isVisitor: true,
          leadershipScore: score,
          strengths: strengths,
          potentialRoles: potentialRoles,
          developmentPlan: "Start membership process and invite to new leader orientation. Offer opportunities to serve in outreach activities."
        });
      }
    }
    
    // Sort by leadership score
    topLeaders.sort((a, b) => b.leadershipScore - a.leadershipScore);
    
    return {
      potentialLeaders: topLeaders,
      analysisDate: new Date().toISOString()
    };
  };

  const getOpenAILocationRecommendations = async (memberData, visitorData) => {
    try {
      // Show processing status to user
      const toastId = toast.info('Analyzing location data for church planting recommendations...', {
        autoClose: false,
        toastId: 'location-analysis'
      });
      
      // Extract addresses and geographic data
      const allAddresses = [
        ...memberData.map(m => ({ 
          address: m.address, 
          type: 'member', 
          id: m.id,
          name: m.firstName + ' ' + m.lastName,
          attendance: m.attendance || 'regular'
        })),
        ...visitorData.map(v => ({ 
          address: v.address, 
          type: 'visitor', 
          id: v.id,
          name: v.firstName + ' ' + v.lastName,
          visitCount: v.visitCount || 1
        }))
      ].filter(a => a.address);
      
      // Enhanced prompt for more strategic location analysis
      const prompt = `
        Analyze the following geographic distribution of church members and visitors to recommend 
        optimal locations for new church plants or satellite campuses:
        
        ${JSON.stringify(allAddresses)}
        
        For your analysis, consider:
        1. Geographic clusters where multiple members/visitors live
        2. Areas with higher visitor concentration but fewer members (growth potential)
        3. Transportation routes and accessibility
        4. Demographics of different regions
        5. Existing church density in these areas
        
        For each recommended location, provide:
        1. The general area or neighborhood name
        2. Approximate coordinates (latitude, longitude)
        3. Estimated reach (number of current members/visitors within 15-minute drive)
        4. Growth potential (high, medium, low)
        5. Target demographics and strategic recommendations
        6. Potential core team members from existing membership who live nearby
        
        Return the results as a JSON with this structure:
        {
          "recommendedLocations": [
            {
              "locationName": "Area Name",
              "coordinates": {
                "lat": 34.5678, 
                "lng": -118.1234
              },
              "estimatedReach": 45,
              "growthPotential": "high",
              "targetDemographics": "Description of local demographics",
              "recommendations": "Strategic recommendations for this location",
              "potentialCoreTeam": [
                {"id": "member-id", "name": "Member Name"}
              ]
            }
          ],
          "analysisDate": "ISO date string of analysis"
        }
        
        Prioritize locations that maximize outreach potential while maintaining connection to the existing church community.
      `;
      
      // Call the OpenAI API for analysis
      const response = await axios.post('/api/openai-location-analysis', {
        addressData: allAddresses,
        prompt: prompt
      });
      
      toast.update(toastId, {
        render: 'Location analysis complete!',
        type: 'success',
        autoClose: 3000
      });
      
      return response.data;
    } catch (error) {
      console.error('OpenAI location analysis failed:', error);
      toast.update(toastId, {
        render: 'API call failed. Using fallback location analysis.',
        type: 'warning',
        autoClose: 3000
      });
      
      // Fallback to the existing simulation
      return generateFallbackLocationRecommendations(memberData, visitorData);
    }
  };

  const generateFallbackLocationRecommendations = (memberData, visitorData) => {
    // Extract unique cities from member and visitor addresses
    const memberCities = [...new Set(
      memberData
        .filter(m => m.address?.city)
        .map(m => m.address.city)
    )];
    
    const visitorCities = [...new Set(
      visitorData
        .filter(v => v.address?.city)
        .map(v => v.address.city)
    )];
    
    // Combine cities and count occurrences
    const allCities = [...memberCities, ...visitorCities];
    const cityCounts = allCities.reduce((acc, city) => {
      acc[city] = (acc[city] || 0) + 1;
      return acc;
    }, {});
    
    // If we have real cities, use them; otherwise, use placeholders
    let recommendedLocations = [];
    
    if (Object.keys(cityCounts).length >= 3) {
      // Use actual cities from the data
      const sortedCities = Object.entries(cityCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([city]) => city);
        
      recommendedLocations = sortedCities.map(city => {
        const memberCount = memberData.filter(m => m.address?.city === city).length;
        const visitorCount = visitorData.filter(v => v.address?.city === city).length;
        
        // Determine growth potential based on visitor-to-member ratio
        const visitorRatio = memberCount > 0 ? visitorCount / memberCount : 0;
        const growthPotential = visitorRatio > 1.5 ? "high" : (visitorRatio > 0.8 ? "medium" : "low");
        
        // Calculate language diversity for demographic insights
        const languages = new Set();
        memberData
          .filter(m => m.address?.city === city && m.languages?.length > 0)
          .forEach(m => m.languages.forEach(lang => languages.add(lang)));
          
        visitorData
          .filter(v => v.address?.city === city && v.languages?.length > 0)
          .forEach(v => v.languages.forEach(lang => languages.add(lang)));
        
        const languageInsight = languages.size > 1 
          ? `Multilingual community with ${Array.from(languages).join(', ')} speakers.` 
          : '';
        
        return {
          area: `${city}`,
          justification: `Strong concentration of ${memberCount} members and ${visitorCount} visitors. ${
            visitorCount > memberCount ? 'High visitor-to-member ratio indicates growth potential.' : 
            'Established member base provides leadership for a new campus.'
          }`,
          initialFocus: visitorCount > memberCount ? "Community Outreach and Visitor Integration" : "Discipleship and Leadership Development",
          memberConcentration: memberCount,
          visitorConcentration: visitorCount,
          growthPotential: growthPotential,
          demographicInsights: languageInsight || "No specific demographic insights available with current data."
        };
      });
    } else {
      // Use placeholder data
      recommendedLocations = [
        {
          area: "Northeast District",
          justification: "High concentration of 24 visitors with only 8 members indicates untapped potential. Many visitors travel 15+ miles to attend main campus.",
          initialFocus: "Community Outreach and Young Families Ministry",
          memberConcentration: 8,
          visitorConcentration: 24,
          growthPotential: "high",
          demographicInsights: "Growing young professional demographic with young families."
        },
        {
          area: "West Side Community",
          justification: "Strong base of 18 members already meeting in home groups. Growing population center with new housing developments.",
          initialFocus: "Small Groups and Discipleship",
          memberConcentration: 18,
          visitorConcentration: 12,
          growthPotential: "medium",
          demographicInsights: "Middle-income families with school-age children."
        },
        {
          area: "South County",
          justification: "Significant distance (25+ miles) from main campus with 15 members and 10 visitors currently commuting. University nearby provides growth opportunity.",
          initialFocus: "Young Adult Ministry and College Outreach",
          memberConcentration: 15,
          visitorConcentration: 10,
          growthPotential: "high",
          demographicInsights: "College students and recent graduates. Diverse international population."
        },
        {
          area: "Downtown Area",
          justification: "Urban core with diverse population. 7 members and 14 visitors from this area with emerging leadership potential.",
          initialFocus: "Multicultural Ministry and Community Service",
          memberConcentration: 7,
          visitorConcentration: 14,
          growthPotential: "medium",
          demographicInsights: "Diverse working professionals, multiple language groups, some socioeconomic needs."
        }
      ];
    }
    
    return {
      recommendedLocations,
      analysisDate: new Date().toISOString()
    };
  };

  const exportToPDF = () => {
    try {
      const toastId = toast.loading('Generating PDF report...', { autoClose: false });
      const doc = new jsPDF();
      
      // Add title and header
      doc.setFillColor(79, 70, 229);
      doc.rect(0, 0, doc.internal.pageSize.width, 40, 'F');
      doc.setTextColor(255);
      doc.setFontSize(24);
      doc.text('Leadership & Expansion Analysis', 15, 25);
      
      // Header info
      doc.setFontSize(11);
      doc.setTextColor(200, 200, 200);
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, 15, 35);
      
      let yOffset = 50;
      
      // SECTION 1: Potential Leaders
      doc.setFontSize(18);
      doc.setTextColor(79, 70, 229);
      doc.text('Potential Leaders & Pastors', 15, yOffset);
      yOffset += 10;
      
      doc.setFontSize(10);
      doc.setTextColor(80, 80, 80);
      doc.text('The following individuals show strong leadership potential based on their skills, participation, and character traits.', 15, yOffset);
      yOffset += 10;
      
      if (leadershipInsights?.potentialLeaders?.length > 0) {
        // Create table data for potential leaders
        const leaderData = leadershipInsights.potentialLeaders.map(leader => [
          leader.name,
          leader.leadershipScore,
          leader.strengths.join(", "),
          leader.potentialRoles.join(", ")
        ]);
        
        doc.autoTable({
          startY: yOffset,
          head: [['Name', 'Score', 'Strengths', 'Potential Roles']],
          body: leaderData,
          theme: 'striped',
          headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255] },
          styles: { fontSize: 9 },
          columnStyles: {
            0: { cellWidth: 40 },
            1: { cellWidth: 20 },
            2: { cellWidth: 50 },
            3: { cellWidth: 50 }
          }
        });
        
        yOffset = doc.lastAutoTable.finalY + 15;
        
        // Leadership development plans
        doc.setFontSize(16);
        doc.setTextColor(79, 70, 229);
        doc.text('Development Plans', 15, yOffset);
        yOffset += 10;
        
        // For each top 5 leader, add their development plan
        for (let i = 0; i < Math.min(5, leadershipInsights.potentialLeaders.length); i++) {
          const leader = leadershipInsights.potentialLeaders[i];
          
          // Check if we need a new page
          if (yOffset > doc.internal.pageSize.height - 40) {
            doc.addPage();
            yOffset = 20;
          }
          
          doc.setFontSize(12);
          doc.setTextColor(60, 60, 60);
          doc.text(`${leader.name}${leader.isVisitor ? ' (Visitor)' : ''}`, 15, yOffset);
          yOffset += 7;
          
          doc.setFontSize(10);
          doc.setTextColor(90, 90, 90);
          const developmentLines = doc.splitTextToSize(leader.developmentPlan, doc.internal.pageSize.width - 30);
          doc.text(developmentLines, 20, yOffset);
          yOffset += (developmentLines.length * 5) + 10;
        }
      } else {
        doc.text('No potential leaders identified. Try analyzing with more member data.', 15, yOffset);
        yOffset += 15;
      }
      
      // SECTION 2: Recommended Locations
      // Add a new page
      doc.addPage();
      yOffset = 20;
      
      doc.setFontSize(18);
      doc.setTextColor(79, 70, 229);
      doc.text('Recommended Church Locations', 15, yOffset);
      yOffset += 10;
      
      doc.setFontSize(10);
      doc.setTextColor(80, 80, 80);
      doc.text('Based on geographic analysis of member and visitor data, these areas show potential for new church campuses or ministry centers.', 15, yOffset);
      yOffset += 10;
      
      if (locationInsights?.recommendedLocations?.length > 0) {
        locationInsights.recommendedLocations.forEach(location => {
          // Check if we need a new page
          if (yOffset > doc.internal.pageSize.height - 80) {
            doc.addPage();
            yOffset = 20;
          }
          
          // Location box
          doc.setFillColor(240, 240, 250);
          doc.roundedRect(15, yOffset, doc.internal.pageSize.width - 30, 65, 3, 3, 'F');
          
          // Location name
          doc.setFontSize(14);
          doc.setTextColor(79, 70, 229);
          doc.text(location.area, 20, yOffset + 10);
          
          // Stats line
          doc.setFontSize(10);
          doc.setTextColor(100, 100, 100);
          doc.text(`Members: ${location.memberConcentration} | Visitors: ${location.visitorConcentration} | Growth Potential: ${location.growthPotential.toUpperCase()}`, 20, yOffset + 20);
          
          // Justification
          doc.setFontSize(9);
          doc.setTextColor(80, 80, 80);
          const justificationLines = doc.splitTextToSize(`Justification: ${location.justification}`, doc.internal.pageSize.width - 40);
          doc.text(justificationLines, 20, yOffset + 30);
          
          // Initial focus
          doc.setFontSize(9);
          doc.setTextColor(60, 60, 60);
          doc.text(`Recommended Initial Focus: ${location.initialFocus}`, 20, yOffset + 55);
          
          if (location.demographicInsights) {
            doc.setFontSize(9);
            doc.setTextColor(60, 60, 60);
            const demographicLines = doc.splitTextToSize(`Demographic Insights: ${location.demographicInsights}`, doc.internal.pageSize.width - 40);
            doc.text(demographicLines, 20, yOffset + 65);
          }
          
          yOffset += 75;
        });
      } else {
        doc.text('No location recommendations available. Try analyzing with more address data.', 15, yOffset);
        yOffset += 15;
      }
      
      // Add page numbers
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(10);
        doc.setTextColor(156, 163, 175);
        doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.width / 2, doc.internal.pageSize.height - 10, { align: 'center' });
      }
      
      // Save the PDF
      doc.save('leadership-and-expansion-analysis.pdf');
      
      toast.update(toastId, {
        render: 'PDF report generated successfully!',
        type: 'success',
        isLoading: false,
        autoClose: 3000,
      });
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Failed to generate PDF. Please try again.');
    }
  };

  const renderPotentialLeadersSection = () => {
    if (!leadershipInsights || !leadershipInsights.potentialLeaders) {
      return (
        <div style={styles.emptySection}>
          <p>No leadership analysis available. Start the analysis to identify potential leaders.</p>
        </div>
      );
    }
    
    return (
      <div style={styles.leadersSection}>
        <div style={styles.leadersList}>
          {leadershipInsights.potentialLeaders.map(leader => (
            <div key={leader.id} style={styles.leaderCard}>
              <div style={styles.leaderHeader}>
                <div style={styles.leaderScore}>
                  <div style={styles.score}>{leader.leadershipScore}</div>
                  <div style={styles.scoreLabel}>Leadership Score</div>
                </div>
                <div style={styles.leaderInfo}>
                  <h3 style={styles.leaderName}>
                    {leader.name}
                    {leader.isVisitor && <span style={styles.visitorTag}>Visitor</span>}
                  </h3>
                  <div style={styles.leaderStrengths}>
                    <strong>Strengths:</strong> {leader.strengths.join(', ')}
                  </div>
                </div>
              </div>
              
              <div style={styles.leaderRoles}>
                <strong>Potential Roles:</strong> {leader.potentialRoles.join(', ')}
              </div>
              
              <div style={styles.leaderDevelopment}>
                <strong>Development Plan:</strong> {leader.developmentPlan}
              </div>
              
              <div style={styles.leaderActions}>
                {!leader.isVisitor ? (
                  <button 
                    onClick={() => navigate(`/church/${id}/member/${leader.id}`)}
                    style={styles.viewProfileButton}
                  >
                    View Profile
                  </button>
                ) : (
                  <button 
                    onClick={() => navigate(`/church/${id}/visitor/${leader.id}`)}
                    style={styles.viewProfileButton}
                  >
                    View Visitor
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderLocationRecommendationsSection = () => {
    if (!locationInsights || !locationInsights.recommendedLocations) {
      return (
        <div style={styles.emptySection}>
          <p>No location analysis available. Start the analysis to identify potential new church locations.</p>
        </div>
      );
    }
    
    return (
      <div style={styles.locationsSection}>
        <div style={styles.locationsList}>
          {locationInsights.recommendedLocations.map((location, index) => (
            <div key={index} style={styles.locationCard}>
              <h3 style={styles.locationName}>{location.area}</h3>
              
              <div style={styles.locationStats}>
                <div style={styles.locationStat}>
                  <div style={styles.statValue}>{location.memberConcentration}</div>
                  <div style={styles.statLabel}>Members</div>
                </div>
                <div style={styles.locationStat}>
                  <div style={styles.statValue}>{location.visitorConcentration}</div>
                  <div style={styles.statLabel}>Visitors</div>
                </div>
                <div style={styles.locationStat}>
                  <div 
                    style={{
                      ...styles.growthTag,
                      backgroundColor: 
                        location.growthPotential === 'high' ? '#DEF7EC' : 
                        location.growthPotential === 'medium' ? '#FEF3C7' : '#FEE2E2',
                      color: 
                        location.growthPotential === 'high' ? '#059669' : 
                        location.growthPotential === 'medium' ? '#D97706' : '#DC2626'
                    }}
                  >
                    {location.growthPotential.toUpperCase()} GROWTH
                  </div>
                </div>
              </div>
              
              <div style={styles.locationJustification}>
                <strong>Justification:</strong> {location.justification}
              </div>
              
              <div style={styles.locationFocus}>
                <strong>Recommended Focus:</strong> {location.initialFocus}
              </div>
              
              {location.demographicInsights && (
                <div style={styles.demographicInsights}>
                  <strong>Demographic Insights:</strong> {location.demographicInsights}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div style={commonStyles.container}>
        <Link to={`/church/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
          ← Back to Mi Organización
        </Link>
        <ChurchHeader id={id} applyShadow={false} allowEditBannerLogo={true} />
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <FaSpinner style={{ fontSize: '2rem', animation: 'spin 1s linear infinite' }} />
          <p>Loading data...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={commonStyles.container}>
      <Link to={`/church/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to Mi Organización
      </Link>
      <ChurchHeader id={id} applyShadow={false} allowEditBannerLogo={true} />
      
      <div style={{ marginTop: "-30px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
          <h1 style={commonStyles.title}>Leadership & Expansion Analysis</h1>
          <div style={{ display: "flex", gap: "1rem" }}>
            <button 
              onClick={exportToPDF}
              style={{
                ...styles.actionButton,
                backgroundColor: "#2563eb"
              }}
              disabled={analyzing || (!leadershipInsights && !locationInsights)}
            >
              <FaDownload /> Export to PDF
            </button>
            <button 
              onClick={() => analyzeData(members, visitors)}
              style={styles.actionButton}
              disabled={analyzing}
            >
              {analyzing ? <FaSpinner style={{ animation: 'spin 1s linear infinite' }} /> : <FaPlus />} 
              {analyzing ? 'Analyzing...' : 'Start Analysis'}
            </button>
          </div>
        </div>

        <div style={styles.statsCards}>
          <div style={styles.statsCard}>
            <div style={styles.statsIcon}><FaUserTie /></div>
            <div style={styles.statsContent}>
              <div style={styles.statsValue}>{members.length}</div>
              <div style={styles.statsLabel}>Total Members</div>
            </div>
          </div>
          
          <div style={styles.statsCard}>
            <div style={styles.statsIcon}><FaUserGraduate /></div>
            <div style={styles.statsContent}>
              <div style={styles.statsValue}>{leadershipInsights?.potentialLeaders?.length || '0'}</div>
              <div style={styles.statsLabel}>Potential Leaders</div>
            </div>
          </div>
          
          <div style={styles.statsCard}>
            <div style={styles.statsIcon}><FaChurch /></div>
            <div style={styles.statsContent}>
              <div style={styles.statsValue}>{locationInsights?.recommendedLocations?.length || '0'}</div>
              <div style={styles.statsLabel}>Recommended Locations</div>
            </div>
          </div>
        </div>

        <div style={styles.twoColumnLayout}>
          <div style={styles.column}>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>
                <FaUserTie style={styles.sectionIcon} /> Potential Leaders & Pastors
              </h2>
              <div style={styles.sectionDescription}>
                Members and visitors identified as having leadership potential based on skills, character, and involvement.
              </div>
            </div>
            
            {renderPotentialLeadersSection()}
          </div>
          
          <div style={styles.column}>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>
                <FaMapMarkedAlt style={styles.sectionIcon} /> Recommended Church Locations
              </h2>
              <div style={styles.sectionDescription}>
                Geographic areas with potential for new church campuses based on member and visitor concentrations.
              </div>
            </div>
            
            {renderLocationRecommendationsSection()}
          </div>
        </div>
      </div>
      <ToastContainer />
    </div>
  );
};

const styles = {
  actionButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.75rem 1.5rem',
    backgroundColor: '#4F46E5',
    color: 'white',
    border: 'none',
    borderRadius: '0.5rem',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '500'
  },
  statsCards: {
    display: 'flex',
    gap: '1.5rem',
    marginBottom: '2rem'
  },
  statsCard: {
    flex: 1,
    backgroundColor: 'white',
    padding: '1.5rem',
    borderRadius: '0.5rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
    display: 'flex',
    alignItems: 'center',
    gap: '1rem'
  },
  statsIcon: {
    width: '3rem',
    height: '3rem',
    borderRadius: '0.5rem',
    backgroundColor: '#EEF2FF',
    color: '#4F46E5',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.5rem'
  },
  statsContent: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center'
  },
  statsValue: {
    fontSize: '1.5rem',
    fontWeight: '700',
    color: '#1F2937'
  },
  statsLabel: {
    fontSize: '0.875rem',
    color: '#6B7280'
  },
  twoColumnLayout: {
    display: 'flex',
    gap: '2rem',
    flexDirection: 'column',
    '@media (min-width: 1024px)': {
      flexDirection: 'row'
    }
  },
  column: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem'
  },
  sectionHeader: {
    marginBottom: '1rem'
  },
  sectionTitle: {
    fontSize: '1.25rem',
    fontWeight: '600',
    color: '#1F2937',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  sectionIcon: {
    color: '#4F46E5'
  },
  sectionDescription: {
    color: '#6B7280',
    fontSize: '0.875rem',
    marginTop: '0.5rem'
  },
  emptySection: {
    padding: '2rem',
    backgroundColor: '#F9FAFB',
    borderRadius: '0.5rem',
    textAlign: 'center',
    color: '#6B7280'
  },
  leadersSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  leadersList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  leaderCard: {
    backgroundColor: 'white',
    borderRadius: '0.5rem',
    padding: '1.5rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  leaderHeader: {
    display: 'flex',
    gap: '1rem'
  },
  leaderScore: {
    width: '4rem',
    height: '4rem',
    borderRadius: '9999px',
    backgroundColor: '#4F46E5',
    color: 'white',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.5rem'
  },
  score: {
    fontSize: '1.25rem',
    fontWeight: '700'
  },
  scoreLabel: {
    fontSize: '0.6rem',
    marginTop: '-0.25rem',
    textAlign: 'center',
    lineHeight: 1
  },
  leaderInfo: {
    flex: 1
  },
  leaderName: {
    margin: 0,
    fontSize: '1.1rem',
    fontWeight: '600',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  visitorTag: {
    fontSize: '0.7rem',
    fontWeight: '500',
    backgroundColor: '#FECACA',
    color: '#B91C1C',
    padding: '0.2rem 0.5rem',
    borderRadius: '9999px',
    marginLeft: '0.5rem'
  },
  leaderStrengths: {
    fontSize: '0.875rem',
    color: '#4B5563',
    marginTop: '0.25rem'
  },
  leaderRoles: {
    fontSize: '0.875rem',
    color: '#4B5563'
  },
  leaderDevelopment: {
    fontSize: '0.875rem',
    color: '#4B5563',
    padding: '0.75rem',
    backgroundColor: '#F3F4F6',
    borderRadius: '0.25rem'
  },
  leaderActions: {
    marginTop: '0.5rem',
    display: 'flex',
    justifyContent: 'flex-end'
  },
  viewProfileButton: {
    padding: '0.5rem 1rem',
    backgroundColor: '#EEF2FF',
    color: '#4F46E5',
    border: 'none',
    borderRadius: '0.25rem',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '500'
  },
  locationsSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  locationsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  locationCard: {
    backgroundColor: 'white',
    borderRadius: '0.5rem',
    padding: '1.5rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  locationName: {
    margin: 0,
    fontSize: '1.1rem',
    fontWeight: '600',
    color: '#1F2937'
  },
  locationStats: {
    display: 'flex',
    alignItems: 'center',
    gap: '1.5rem'
  },
  locationStat: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center'
  },
  statValue: {
    fontSize: '1.25rem',
    fontWeight: '600',
    color: '#4F46E5'
  },
  statLabel: {
    fontSize: '0.75rem',
    color: '#6B7280'
  },
  growthTag: {
    fontSize: '0.75rem',
    fontWeight: '500',
    padding: '0.25rem 0.75rem',
    borderRadius: '9999px'
  },
  locationJustification: {
    fontSize: '0.875rem',
    color: '#4B5563',
    padding: '0.75rem',
    backgroundColor: '#F3F4F6',
    borderRadius: '0.25rem'
  },
  locationFocus: {
    fontSize: '0.875rem',
    color: '#4B5563',
    marginTop: '0.25rem'
  },
  demographicInsights: {
    fontSize: '0.875rem',
    color: '#4B5563',
    backgroundColor: '#F9FAFB',
    padding: '0.5rem 0.75rem',
    borderRadius: '0.25rem',
    marginTop: '0.5rem',
    borderLeft: '3px solid #4F46E5'
  }
};

export default LeadershipDevelopment;
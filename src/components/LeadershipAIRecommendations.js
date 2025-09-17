import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { FaUserTie, FaChurch, FaUsers, FaBrain, FaSpinner, FaClipboardList } from 'react-icons/fa';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import axios from 'axios';
import './BusinessIntelligence.css';

const LeadershipAIRecommendations = ({ members, visitors, teams, onComplete }) => {
  const { id } = useParams();
  const [analyzing, setAnalyzing] = useState(false);
  const [leadershipRecommendations, setLeadershipRecommendations] = useState(null);
  const [teamRecommendations, setTeamRecommendations] = useState(null);
  const [churchData, setChurchData] = useState(null);

  useEffect(() => {
    const fetchChurchData = async () => {
      const churchDoc = await getDoc(doc(db, 'churches', id));
      if (churchDoc.exists()) {
        setChurchData(churchDoc.data());
      }
    };

    fetchChurchData();
  }, [id]);

  const analyzeLeadershipPotential = async () => {
    if (analyzing) return;
    if (!members || members.length === 0) {
      toast.error('No member data available for analysis');
      return;
    }

    setAnalyzing(true);
    toast.info('Analyzing leadership potential...', { autoClose: false, toastId: 'leadership-analysis' });

    try {
      // Prepare data for analysis - enriching with notes and messages
      const enrichedMembers = await Promise.all(
        members.map(async (member) => {
          // Get messages if they exist
          let messages = [];
          try {
            const messagesRef = collection(db, `users/${member.id}/messages`);
            const messagesSnapshot = await getDocs(messagesRef);
            messages = messagesSnapshot.docs.map(doc => doc.data().message || doc.data().text || '');
          } catch (error) {
            console.log('No messages found for member');
          }

          return {
            id: member.id,
            name: `${member.name || ''} ${member.lastName || ''}`.trim(),
            age: member.age,
            gender: member.gender,
            profession: member.profession || [],
            skills: member.skills || [],
            language: member.language || [],
            notes: member.allNotes?.map(note => note.text || '') || [],
            messages: messages,
            completions: member.completionLogs || [],
            tags: member.tags || [],
            createdAt: member.createdAt || new Date().toString()
          };
        })
      );

      // Prepare OpenAI prompt for leadership analysis
      const prompt = `
        Analyze the following church member data to identify individuals with potential for leadership roles:
        
        ${JSON.stringify(enrichedMembers)}
        
        Based on this analysis, identify:
        
        1. Pastoral Leadership Candidates: Members who show traits suitable for pastoral roles (caring, teaching ability, spiritual maturity)
        2. Administrative Leaders: Members with organizational, planning, or management skills
        3. Ministry Team Leaders: Members with specific gifts in areas like worship, children's ministry, outreach, etc.
        4. Church Planters: Members who show entrepreneurial spirit, vision-casting ability, and missionary mindset
        
        For each person identified, provide:
        - Their name and ID
        - Their primary leadership category (Pastoral, Administrative, Ministry Team, Church Planter)
        - Key strengths relevant to their leadership potential
        - Specific ministry areas they would excel in
        - Recommended development steps
        
        Also, summarize the overall leadership landscape in the church by identifying:
        - Current leadership strengths
        - Leadership gaps that need development
        - Recommendations for leadership development strategy
        
        Return the results as a JSON object with this structure:
        {
          "pastoralCandidates": [
            {
              "id": "member-id",
              "name": "Member Name",
              "strengths": ["strength1", "strength2"],
              "ministryFit": ["area1", "area2"],
              "developmentSteps": "Steps for development",
              "leadershipScore": 85
            }
          ],
          "administrativeLeaders": [ similar structure ],
          "ministryTeamLeaders": [ similar structure ],
          "churchPlanters": [ similar structure ],
          "leadershipSummary": {
            "strengths": ["strength1", "strength2"],
            "gaps": ["gap1", "gap2"],
            "recommendations": ["rec1", "rec2"]
          }
        }
      `;

      // Call OpenAI API
      const response = await axios.post('/api/openai-leadership-analysis', {
        prompt,
        temperature: 0.7,
        max_tokens: 2500
      });

      // Process the response
      setLeadershipRecommendations(response.data);
      
      // Now analyze team recommendations
      await analyzeTeamRecommendations(enrichedMembers);

      toast.update('leadership-analysis', {
        render: 'Leadership analysis complete!',
        type: 'success',
        autoClose: 3000
      });
    } catch (error) {
      console.error('Error analyzing leadership potential:', error);
      toast.update('leadership-analysis', {
        render: 'Analysis failed. Using fallback data.',
        type: 'warning',
        autoClose: 3000
      });
      
      // Use fallback data
      setLeadershipRecommendations(generateFallbackLeadershipData(members));
      await analyzeTeamRecommendations(members);
    } finally {
      setAnalyzing(false);
      if (onComplete) onComplete();
    }
  };

  const analyzeTeamRecommendations = async (enrichedMembers) => {
    try {
      toast.info('Analyzing team recommendations...', { autoClose: false, toastId: 'team-analysis' });

      // Get existing teams structure
      const existingTeams = teams || [];
      
      // Create the prompt for team recommendations
      const prompt = `
        Analyze these church members and existing teams to recommend optimal team assignments:
        
        MEMBERS:
        ${JSON.stringify(enrichedMembers)}
        
        EXISTING TEAMS:
        ${JSON.stringify(existingTeams)}
        
        Based on this analysis:
        1. For each existing team, recommend the top 3-5 members who would be good fits based on their skills, languages, professions, and notes
        2. Suggest 2-3 entirely new teams that could be formed based on member gifting patterns and church needs
        3. Identify any current teams that could benefit from merging or restructuring
        
        Return the results as a JSON object with this structure:
        {
          "existingTeamRecommendations": [
            {
              "teamId": "team-id",
              "teamName": "Team Name",
              "recommendedMembers": [
                {
                  "id": "member-id",
                  "name": "Member Name",
                  "fit": "High/Medium/Low",
                  "reason": "Reason they're a good fit"
                }
              ]
            }
          ],
          "newTeamSuggestions": [
            {
              "proposedName": "Suggested Team Name",
              "purpose": "Team purpose description",
              "recommendedMembers": [
                {
                  "id": "member-id",
                  "name": "Member Name",
                  "reason": "Reason they're a good fit"
                }
              ],
              "requiresLeader": true/false
            }
          ],
          "restructuringRecommendations": [
            {
              "recommendation": "Description of restructuring recommendation",
              "teamsInvolved": ["team1-id", "team2-id"],
              "reason": "Reasoning behind recommendation"
            }
          ]
        }
      `;

      // Call OpenAI API
      const response = await axios.post('/api/openai-team-analysis', {
        prompt,
        temperature: 0.7,
        max_tokens: 2500
      });

      // Process the response
      setTeamRecommendations(response.data);
      
      toast.update('team-analysis', {
        render: 'Team analysis complete!',
        type: 'success',
        autoClose: 3000
      });
    } catch (error) {
      console.error('Error analyzing team recommendations:', error);
      toast.update('team-analysis', {
        render: 'Team analysis failed. Using fallback data.',
        type: 'warning',
        autoClose: 3000
      });
      
      // Use fallback data
      setTeamRecommendations(generateFallbackTeamRecommendations(members, teams));
    }
  };

  const generateFallbackLeadershipData = (members) => {
    // Create realistic fallback data when API fails
    const fallbackData = {
      pastoralCandidates: [],
      administrativeLeaders: [],
      ministryTeamLeaders: [],
      churchPlanters: [],
      leadershipSummary: {
        strengths: [
          "Diverse skill sets across membership",
          "Strong administrative capabilities",
          "Several members with teaching experience"
        ],
        gaps: [
          "Limited pastoral leadership candidates",
          "Few members with church planting experience",
          "Need more youth ministry leaders"
        ],
        recommendations: [
          "Implement leadership development program",
          "Identify and mentor potential pastoral candidates",
          "Provide church planting training to entrepreneurial members"
        ]
      }
    };

    // Distribute members across leadership categories
    members.forEach((member, index) => {
      // Extract the most relevant information
      const name = `${member.name || ''} ${member.lastName || ''}`.trim();
      const strengths = [];
      
      if (member.skill && member.skill.length > 0) {
        strengths.push(...member.skill.slice(0, 2));
      }
      
      if (member.Profession && member.Profession.length > 0) {
        strengths.push(...member.Profession.slice(0, 1));
      }
      
      if (strengths.length === 0) {
        strengths.push("Communication", "Organization");
      }
      
      // Assign to categories based on index (for variety)
      const leadershipScore = 65 + Math.floor(Math.random() * 25);
      const leadershipData = {
        id: member.id,
        name: name,
        strengths: strengths,
        ministryFit: [],
        developmentSteps: "Personalized leadership development plan",
        leadershipScore: leadershipScore
      };
      
      // Assign ministry fit based on skills
      if (member.skill?.includes('teaching') || member.skill?.includes('education')) {
        leadershipData.ministryFit.push("Bible Study");
      }
      if (member.skill?.includes('music') || member.skill?.includes('singing')) {
        leadershipData.ministryFit.push("Worship Team");
      }
      if (member.skill?.includes('administration') || member.Profession?.includes('Management')) {
        leadershipData.ministryFit.push("Administrative Council");
      }
      
      if (leadershipData.ministryFit.length === 0) {
        leadershipData.ministryFit.push("General Ministry");
      }
      
      // Distribute across categories
      if (index % 4 === 0) {
        fallbackData.pastoralCandidates.push(leadershipData);
      } else if (index % 4 === 1) {
        fallbackData.administrativeLeaders.push(leadershipData);
      } else if (index % 4 === 2) {
        fallbackData.ministryTeamLeaders.push(leadershipData);
      } else {
        fallbackData.churchPlanters.push(leadershipData);
      }
    });
    
    return fallbackData;
  };

  const generateFallbackTeamRecommendations = (members, teams) => {
    const fallbackData = {
      existingTeamRecommendations: [],
      newTeamSuggestions: [
        {
          proposedName: "Young Adults Ministry",
          purpose: "Engage and disciple the 18-30 age group through targeted programs and events",
          recommendedMembers: [],
          requiresLeader: true
        },
        {
          proposedName: "Digital Outreach Team",
          purpose: "Leverage technology and social media to extend the church's reach online",
          recommendedMembers: [],
          requiresLeader: true
        }
      ],
      restructuringRecommendations: []
    };
    
    // Generate recommendations for existing teams
    if (teams && teams.length > 0) {
      teams.forEach(team => {
        const teamRec = {
          teamId: team.id,
          teamName: team.name,
          recommendedMembers: []
        };
        
        // Find members that might fit this team
        const potentialMembers = members.filter(member => {
          // Check for skill matches
          const skillMatch = team.requirements?.skills?.some(skill => 
            member.skill?.includes(skill.value)
          );
          
          // Check for language matches
          const languageMatch = team.requirements?.languages?.some(lang => 
            member.language?.includes(lang.value)
          );
          
          // Check for profession matches
          const professionMatch = team.requirements?.professions?.some(prof => 
            member.Profession?.includes(prof.value)
          );
          
          return skillMatch || languageMatch || professionMatch;
        });
        
        // Add the top matches to recommendations
        teamRec.recommendedMembers = potentialMembers.slice(0, 5).map(member => ({
          id: member.id,
          name: `${member.name || ''} ${member.lastName || ''}`.trim(),
          fit: "Medium",
          reason: "Skills and experience align with team requirements"
        }));
        
        fallbackData.existingTeamRecommendations.push(teamRec);
      });
    }
    
    // Add some members to the suggested new teams
    const youngAdultMembers = members.filter(m => m.age && m.age >= 18 && m.age <= 30).slice(0, 4);
    const techSavvyMembers = members.filter(m => 
      m.skill?.includes('technology') || 
      m.skill?.includes('social media') ||
      m.Profession?.includes('IT') ||
      m.Profession?.includes('Marketing')
    ).slice(0, 4);
    
    fallbackData.newTeamSuggestions[0].recommendedMembers = youngAdultMembers.map(member => ({
      id: member.id,
      name: `${member.name || ''} ${member.lastName || ''}`.trim(),
      reason: "Age group aligns with team focus"
    }));
    
    fallbackData.newTeamSuggestions[1].recommendedMembers = techSavvyMembers.map(member => ({
      id: member.id,
      name: `${member.name || ''} ${member.lastName || ''}`.trim(),
      reason: "Technical skills match team requirements"
    }));
    
    return fallbackData;
  };

  const renderLeadershipRecommendations = () => {
    if (!leadershipRecommendations) {
      return (
        <div className="ai-placeholder">
          <FaBrain size={48} color="#6366f1" />
          <h3>Leadership Potential Analysis</h3>
          <p>Click "Analyze Leadership" to identify potential leaders in your church.</p>
        </div>
      );
    }
    
    return (
      <div className="ai-leadership-recommendations">
        <div className="leadership-categories">
          <div className="leadership-category">
            <h3><FaChurch /> Pastoral Candidates</h3>
            <div className="leaders-list">
              {leadershipRecommendations.pastoralCandidates.length > 0 ? (
                leadershipRecommendations.pastoralCandidates.map(leader => (
                  <div className="leader-card" key={leader.id}>
                    <div className="leader-header">
                      <div className="leader-score">{leader.leadershipScore}</div>
                      <div className="leader-name">{leader.name}</div>
                    </div>
                    <div className="leader-strengths">
                      <strong>Strengths:</strong> {leader.strengths.join(', ')}
                    </div>
                    <div className="leader-ministry">
                      <strong>Ministry Fit:</strong> {leader.ministryFit.join(', ')}
                    </div>
                    <div className="leader-development">
                      {leader.developmentSteps}
                    </div>
                    <Link to={`/church/${id}/member/${leader.id}`} className="view-profile">
                      View Profile
                    </Link>
                  </div>
                ))
              ) : (
                <p className="no-candidates">No pastoral candidates identified</p>
              )}
            </div>
          </div>
          
          <div className="leadership-category">
            <h3><FaUsers /> Ministry Team Leaders</h3>
            <div className="leaders-list">
              {leadershipRecommendations.ministryTeamLeaders.length > 0 ? (
                leadershipRecommendations.ministryTeamLeaders.map(leader => (
                  <div className="leader-card" key={leader.id}>
                    <div className="leader-header">
                      <div className="leader-score">{leader.leadershipScore}</div>
                      <div className="leader-name">{leader.name}</div>
                    </div>
                    <div className="leader-strengths">
                      <strong>Strengths:</strong> {leader.strengths.join(', ')}
                    </div>
                    <div className="leader-ministry">
                      <strong>Ministry Fit:</strong> {leader.ministryFit.join(', ')}
                    </div>
                    <div className="leader-development">
                      {leader.developmentSteps}
                    </div>
                    <Link to={`/church/${id}/member/${leader.id}`} className="view-profile">
                      View Profile
                    </Link>
                  </div>
                ))
              ) : (
                <p className="no-candidates">No ministry team leaders identified</p>
              )}
            </div>
          </div>
          
          <div className="leadership-category">
            <h3><FaClipboardList /> Administrative Leaders</h3>
            <div className="leaders-list">
              {leadershipRecommendations.administrativeLeaders.length > 0 ? (
                leadershipRecommendations.administrativeLeaders.map(leader => (
                  <div className="leader-card" key={leader.id}>
                    <div className="leader-header">
                      <div className="leader-score">{leader.leadershipScore}</div>
                      <div className="leader-name">{leader.name}</div>
                    </div>
                    <div className="leader-strengths">
                      <strong>Strengths:</strong> {leader.strengths.join(', ')}
                    </div>
                    <div className="leader-ministry">
                      <strong>Ministry Fit:</strong> {leader.ministryFit.join(', ')}
                    </div>
                    <div className="leader-development">
                      {leader.developmentSteps}
                    </div>
                    <Link to={`/church/${id}/member/${leader.id}`} className="view-profile">
                      View Profile
                    </Link>
                  </div>
                ))
              ) : (
                <p className="no-candidates">No administrative leaders identified</p>
              )}
            </div>
          </div>
          
          <div className="leadership-category">
            <h3><FaUserTie /> Church Planters</h3>
            <div className="leaders-list">
              {leadershipRecommendations.churchPlanters.length > 0 ? (
                leadershipRecommendations.churchPlanters.map(leader => (
                  <div className="leader-card" key={leader.id}>
                    <div className="leader-header">
                      <div className="leader-score">{leader.leadershipScore}</div>
                      <div className="leader-name">{leader.name}</div>
                    </div>
                    <div className="leader-strengths">
                      <strong>Strengths:</strong> {leader.strengths.join(', ')}
                    </div>
                    <div className="leader-ministry">
                      <strong>Ministry Fit:</strong> {leader.ministryFit.join(', ')}
                    </div>
                    <div className="leader-development">
                      {leader.developmentSteps}
                    </div>
                    <Link to={`/church/${id}/member/${leader.id}`} className="view-profile">
                      View Profile
                    </Link>
                  </div>
                ))
              ) : (
                <p className="no-candidates">No church planter candidates identified</p>
              )}
            </div>
          </div>
        </div>
        
        <div className="leadership-summary">
          <h3>Leadership Landscape Summary</h3>
          <div className="summary-content">
            <div className="summary-section">
              <h4>Leadership Strengths</h4>
              <ul>
                {leadershipRecommendations.leadershipSummary.strengths.map((strength, idx) => (
                  <li key={idx}>{strength}</li>
                ))}
              </ul>
            </div>
            
            <div className="summary-section">
              <h4>Leadership Gaps</h4>
              <ul>
                {leadershipRecommendations.leadershipSummary.gaps.map((gap, idx) => (
                  <li key={idx}>{gap}</li>
                ))}
              </ul>
            </div>
            
            <div className="summary-section">
              <h4>Recommendations</h4>
              <ul>
                {leadershipRecommendations.leadershipSummary.recommendations.map((rec, idx) => (
                  <li key={idx}>{rec}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderTeamRecommendations = () => {
    if (!teamRecommendations) {
      return (
        <div className="ai-placeholder">
          <FaUsers size={48} color="#6366f1" />
          <h3>Team Formation Recommendations</h3>
          <p>Click "Analyze Leadership" to receive team suggestions.</p>
        </div>
      );
    }
    
    return (
      <div className="ai-team-recommendations">
        <div className="team-recommendations-section">
          <h3>Recommendations for Existing Teams</h3>
          {teamRecommendations.existingTeamRecommendations.length > 0 ? (
            <div className="existing-teams-grid">
              {teamRecommendations.existingTeamRecommendations.map((teamRec) => (
                <div className="team-recommendation-card" key={teamRec.teamId}>
                  <h4>{teamRec.teamName}</h4>
                  <div className="recommended-members">
                    <h5>Recommended Members:</h5>
                    {teamRec.recommendedMembers.length > 0 ? (
                      <ul>
                        {teamRec.recommendedMembers.map((member, idx) => (
                          <li key={idx} className={`fit-${member.fit.toLowerCase()}`}>
                            <span>{member.name}</span>
                            <span className="fit-tag">{member.fit}</span>
                            <p className="reason">{member.reason}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No specific recommendations</p>
                    )}
                  </div>
                  <Link to={`/church/${id}/teams/${teamRec.teamId}`} className="view-team">
                    View Team
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <p className="no-recommendations">No recommendations for existing teams</p>
          )}
        </div>
        
        <div className="team-recommendations-section">
          <h3>Suggested New Teams</h3>
          {teamRecommendations.newTeamSuggestions.length > 0 ? (
            <div className="new-teams-grid">
              {teamRecommendations.newTeamSuggestions.map((teamSuggestion, idx) => (
                <div className="team-suggestion-card" key={idx}>
                  <h4>{teamSuggestion.proposedName}</h4>
                  <p className="team-purpose">{teamSuggestion.purpose}</p>
                  
                  <div className="recommended-members">
                    <h5>Suggested Members:</h5>
                    {teamSuggestion.recommendedMembers.length > 0 ? (
                      <ul>
                        {teamSuggestion.recommendedMembers.map((member, memberIdx) => (
                          <li key={memberIdx}>
                            <span>{member.name}</span>
                            <p className="reason">{member.reason}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No specific member recommendations</p>
                    )}
                  </div>
                  
                  {teamSuggestion.requiresLeader && (
                    <div className="needs-leader">
                      Requires a dedicated leader
                    </div>
                  )}
                  
                  <Link to={`/church/${id}/teams/create`} className="create-team-link">
                    Create This Team
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <p className="no-recommendations">No new team suggestions</p>
          )}
        </div>
        
        {teamRecommendations.restructuringRecommendations && 
         teamRecommendations.restructuringRecommendations.length > 0 && (
          <div className="team-recommendations-section">
            <h3>Team Restructuring Recommendations</h3>
            <div className="restructuring-recommendations">
              {teamRecommendations.restructuringRecommendations.map((rec, idx) => (
                <div className="restructuring-card" key={idx}>
                  <h4>Recommendation</h4>
                  <p>{rec.recommendation}</p>
                  <p><strong>Teams involved:</strong> {rec.teamsInvolved.join(', ')}</p>
                  <p><strong>Reason:</strong> {rec.reason}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="leadership-ai-recommendations">
      <div className="action-buttons">
        <button 
          className="analyze-button"
          onClick={analyzeLeadershipPotential}
          disabled={analyzing}
        >
          {analyzing ? <FaSpinner className="spinner" /> : <FaBrain />}
          {analyzing ? 'Analyzing Leadership Potential...' : 'Analyze Leadership'}
        </button>
      </div>
      
      <div className="recommendations-container">
        <div className="recommendations-section">
          <h2 className="section-title">Leadership & Pastoral Candidates</h2>
          {renderLeadershipRecommendations()}
        </div>
        
        <div className="recommendations-section">
          <h2 className="section-title">Team Formation Recommendations</h2>
          {renderTeamRecommendations()}
        </div>
      </div>
      <ToastContainer />
    </div>
  );
};

export default LeadershipAIRecommendations;
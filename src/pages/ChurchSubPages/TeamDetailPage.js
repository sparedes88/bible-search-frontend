import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';  // Add this import
import { doc, getDoc, collection, getDocs, updateDoc, Timestamp, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import commonStyles from '../../pages/commonStyles';
import ChurchHeader from '../../components/ChurchHeader';
import Skeleton from 'react-loading-skeleton';
import { FaUserPlus, FaCheckCircle, FaTimes, FaEdit, FaUserMinus, FaSearch, FaFilter } from 'react-icons/fa';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Select from 'react-select';
import CreatableSelect from 'react-select/creatable';
import ocupaciones from '../../components/ocupaciones';
import idiomas from '../../components/idiomas';
import habilidades from '../../components/habilidades';

const TeamDetailPage = () => {
  const { id, teamId } = useParams();
  const { user } = useAuth();  // Add this line
  const navigate = useNavigate();
  const [team, setTeam] = useState(null);
  const [potentialMembers, setPotentialMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [availableUsers, setAvailableUsers] = useState([]);
  const [editedTeam, setEditedTeam] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [skillFilter, setSkillFilter] = useState(null);
  const [languageFilter, setLanguageFilter] = useState(null);
  const [professionFilter, setProfessionFilter] = useState(null);
  const [matchScoreFilter, setMatchScoreFilter] = useState(0);
  const [showMissingRequirements, setShowMissingRequirements] = useState(false);
  const [ageFilter, setAgeFilter] = useState({ min: 0, max: 100 });
  const [genderFilter, setGenderFilter] = useState(null);
  const itemsPerPage = 6;

  useEffect(() => {
    fetchTeamData();
  }, [teamId]);

  useEffect(() => {
    if (team) {
      setEditedTeam({
        ...team,
        requirements: {
          languages: team.requirements?.languages?.map(lang => ({ value: lang.value, label: lang.label })) || [],
          skills: team.requirements?.skills?.map(skill => ({ value: skill.value, label: skill.label })) || [],
          professions: team.requirements?.professions?.map(prof => ({ value: prof.value, label: prof.label })) || []
        }
      });
    }
  }, [team]);

  const fetchTeamData = async () => {
    try {
      const teamDoc = await getDoc(doc(db, `churches/${id}/teams/${teamId}`));
      if (teamDoc.exists()) {
        setTeam(teamDoc.data());
        await findPotentialMembers(teamDoc.data());
        await fetchAvailableUsers();
      }
    } catch (error) {
      console.error('Error fetching team:', error);
    } finally {
      setLoading(false);
    }
  };

  const findPotentialMembers = async (teamData) => {
    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      const users = usersSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      const matches = users.map(user => {
        const matchingSkills = teamData.requirements?.skills?.filter(
          skill => user.skill?.includes(skill.value)
        ) || [];
        const matchingLanguages = teamData.requirements?.languages?.filter(
          lang => user.language?.includes(lang.value)
        ) || [];
        const matchingProfessions = teamData.requirements?.professions?.filter(
          prof => user.Profession?.includes(prof.value)
        ) || [];

        return {
          user,
          matches: {
            skills: matchingSkills,
            languages: matchingLanguages,
            professions: matchingProfessions
          },
          matchScore: (matchingSkills.length + matchingLanguages.length + matchingProfessions.length) / 
            (teamData.requirements?.skills?.length + 
             teamData.requirements?.languages?.length + 
             teamData.requirements?.professions?.length) * 100 || 0
        };
      });

      setPotentialMembers(matches.filter(m => m.matchScore > 0)
                               .sort((a, b) => b.matchScore - a.matchScore));
    } catch (error) {
      console.error('Error finding potential members:', error);
    }
  };

  const fetchAvailableUsers = async () => {
    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      const users = usersSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setAvailableUsers(users);
    } catch (error) {
      console.error('Error fetching available users:', error);
    }
  };

  const addMemberToTeam = async (userId) => {
    try {
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (!userDoc.exists()) return;

      const userData = userDoc.data();
      const teamRef = doc(db, `churches/${id}/teams/${teamId}`);
      
      await updateDoc(teamRef, {
        members: [...(team.members || []), {
          userId,
          email: userData.email,
          name: userData.name,
          status: 'pending',
          addedAt: Timestamp.now()
        }]
      });

      toast.success('Member invited to team');
      fetchTeamData();
    } catch (error) {
      console.error('Error adding member:', error);
      toast.error('Failed to add member');
    }
  };

  const removeMemberFromTeam = async (userId) => {
    if (!window.confirm('Are you sure you want to remove this member from the team?')) {
      return;
    }

    try {
      const teamRef = doc(db, `churches/${id}/teams/${teamId}`);
      await updateDoc(teamRef, {
        members: team.members.filter(m => m.userId !== userId)
      });
      toast.success('Member removed from team');
      fetchTeamData();
    } catch (error) {
      console.error('Error removing member:', error);
      toast.error('Failed to remove member');
    }
  };

  const handleLeaderChange = async (selectedLeader) => {
    try {
      const teamRef = doc(db, `churches/${id}/teams/${teamId}`);
      await updateDoc(teamRef, {
        leader: {
          userId: selectedLeader.value,
          email: selectedLeader.email,
          name: selectedLeader.label
        }
      });
      
      setTeam(prev => ({
        ...prev,
        leader: {
          userId: selectedLeader.value,
          email: selectedLeader.email,
          name: selectedLeader.label
        }
      }));
      
      toast.success('Team leader updated successfully');
    } catch (error) {
      console.error('Error updating team leader:', error);
      toast.error('Failed to update team leader');
    }
  };

  const handleRequirementChange = (type, selectedOptions) => {
    setEditedTeam(prev => ({
      ...prev,
      requirements: {
        ...prev.requirements,
        [type]: selectedOptions.map(option => ({
          value: option.value,
          label: option.label
        }))
      }
    }));
  };

  const createOption = (label) => ({
    label,
    value: label
  });

  const handleCreateOption = (type, inputValue) => {
    const newOption = createOption(inputValue);
    setEditedTeam(prev => ({
      ...prev,
      requirements: {
        ...prev.requirements,
        [type]: [...(prev.requirements[type] || []), newOption]
      }
    }));
    toast.success(`Added new ${type.slice(0, -1)}: ${inputValue}`);
  };

  const handleSaveChanges = async () => {
    try {
      const teamRef = doc(db, `churches/${id}/teams/${teamId}`);
      await updateDoc(teamRef, {
        ...editedTeam,
        updatedAt: Timestamp.now()
      });
      setTeam(editedTeam);
      setIsEditing(false);
      toast.success('Team updated successfully');
      fetchTeamData();
    } catch (error) {
      console.error('Error updating team:', error);
      toast.error('Failed to update team');
    }
  };

  const getFilteredMembers = () => {
    return potentialMembers.filter(({ user, matches, matchScore }) => {
      const matchesSearch = user.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          user.email?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesSkill = !skillFilter || 
        (showMissingRequirements ? 
          !user.skill?.includes(skillFilter.value) :
          matches.skills.some(s => s.value === skillFilter.value));
      
      const matchesLanguage = !languageFilter || 
        (showMissingRequirements ? 
          !user.language?.includes(languageFilter.value) :
          matches.languages.some(l => l.value === languageFilter.value));
      
      const matchesProfession = !professionFilter || 
        (showMissingRequirements ? 
          !user.Profession?.includes(professionFilter.value) :
          matches.professions.some(p => p.value === professionFilter.value));

      const matchesScore = showMissingRequirements ? true : matchScore >= matchScoreFilter;
      
      const age = user.age || 0;
      const matchesAge = age >= ageFilter.min && age <= ageFilter.max;
      
      const matchesGender = !genderFilter || user.gender === genderFilter.value;

      return matchesSearch && matchesSkill && matchesLanguage && 
             matchesProfession && matchesScore && matchesAge && matchesGender;
    });
  };

  const filteredMembers = getFilteredMembers();
  const totalPages = Math.ceil(filteredMembers.length / itemsPerPage);
  const currentMembers = filteredMembers.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  if (loading) {
    return <Skeleton count={5} />;
  }

  return (
    <div style={commonStyles.container}>
      <Link to={`/church/${id}/teams`} style={commonStyles.backButtonLink}>
        ← Back to Teams
      </Link>
      <ChurchHeader id={id} applyShadow={false} />
      
      <h1 style={commonStyles.title}>{team?.name}</h1>
      
      {/* Team details section */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2>Team Details</h2>
          {(user.role === 'admin' || user.role === 'global_admin') && (
            <div style={styles.actionButtons}>
              {isEditing ? (
                <>
                  <button 
                    onClick={handleSaveChanges}
                    style={styles.saveButton}
                  >
                    <FaCheckCircle style={styles.buttonIcon} />
                    Save Changes
                  </button>
                  <button 
                    onClick={() => {
                      setIsEditing(false);
                      setEditedTeam(team);
                    }}
                    style={styles.cancelButton}
                  >
                    <FaTimes style={styles.buttonIcon} />
                    Cancel
                  </button>
                </>
              ) : (
                <button 
                  onClick={() => setIsEditing(true)}
                  style={styles.editButton}
                >
                  <FaEdit style={styles.buttonIcon} />
                  Edit Team Details
                </button>
              )}
            </div>
          )}
        </div>

        {isEditing ? (
          <div style={styles.editForm}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Team Name:</label>
              <input
                type="text"
                value={editedTeam?.name || ''}
                onChange={(e) => setEditedTeam(prev => ({ ...prev, name: e.target.value }))}
                style={styles.input}
              />
            </div>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Description:</label>
              <textarea
                value={editedTeam?.description || ''}
                onChange={(e) => setEditedTeam(prev => ({ ...prev, description: e.target.value }))}
                style={{ ...styles.input, minHeight: '100px' }}
                placeholder="Enter team description..."
              />
            </div>
          </div>
        ) : (
          <>
            <h3 style={styles.teamName}>{team?.name}</h3>
            <p style={styles.description}>{team?.description || 'No description provided.'}</p>
          </>
        )}

        <div style={styles.sectionDivider} />
        
        <div style={styles.leaderSection}>
          <h3>Team Leader</h3>
          {isEditing ? (
            <Select
              value={editedTeam?.leader ? {
                value: editedTeam.leader.userId,
                label: editedTeam.leader.name
              } : null}
              onChange={(selected) => setEditedTeam(prev => ({
                ...prev,
                leader: selected ? {
                  userId: selected.value,
                  name: selected.label,
                  email: selected.email
                } : null
              }))}
              options={availableUsers.map(user => ({
                value: user.id,
                label: `${user.name} ${user.lastName || ''} (${user.email})`,
                email: user.email
              }))}
              styles={selectStyles}
              placeholder="Select a team leader..."
            />
          ) : (
            <div style={styles.leaderInfo}>
              {team?.leader ? (
                <>
                  <span>{team.leader.name}</span>
                  <span style={styles.leaderEmail}>({team.leader.email})</span>
                </>
              ) : (
                <span style={styles.noLeader}>No leader assigned</span>
              )}
            </div>
          )}
        </div>

        {/* Requirements section */}
        <div style={styles.requirements}>
          <h3>Team Requirements</h3>
          {isEditing ? (
            <div style={styles.requirementsForm}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Languages:</label>
                <CreatableSelect
                  isMulti
                  value={editedTeam?.requirements?.languages || []}
                  onChange={(selected) => handleRequirementChange('languages', selected)}
                  options={idiomas.map(lang => ({ value: lang, label: lang }))}
                  onCreateOption={(inputValue) => handleCreateOption('languages', inputValue)}
                  placeholder="Select or create languages..."
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Skills:</label>
                <CreatableSelect
                  isMulti
                  value={editedTeam?.requirements?.skills || []}
                  onChange={(selected) => handleRequirementChange('skills', selected)}
                  options={Object.values(habilidades).flat().map(skill => ({
                    value: skill,
                    label: skill
                  }))}
                  onCreateOption={(inputValue) => handleCreateOption('skills', inputValue)}
                  placeholder="Select or create skills..."
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Professions:</label>
                <CreatableSelect
                  isMulti
                  value={editedTeam?.requirements?.professions || []}
                  onChange={(selected) => handleRequirementChange('professions', selected)}
                  options={ocupaciones.map(prof => ({ value: prof, label: prof }))}
                  onCreateOption={(inputValue) => handleCreateOption('professions', inputValue)}
                  placeholder="Select or create professions..."
                />
              </div>
            </div>
          ) : (
            <div style={styles.requirementsList}>
              {team?.requirements?.languages?.length > 0 && (
                <div style={styles.requirementGroup}>
                  <h4>Languages Needed:</h4>
                  <div style={styles.tags}>
                    {team.requirements.languages.map((lang, i) => (
                      <span key={i} style={styles.tag}>{lang.label}</span>
                    ))}
                  </div>
                </div>
              )}
              {team?.requirements?.skills?.length > 0 && (
                <div style={styles.requirementGroup}>
                  <h4>Skills Needed:</h4>
                  <div style={styles.tags}>
                    {team.requirements.skills.map((skill, i) => (
                      <span key={i} style={styles.tag}>{skill.label}</span>
                    ))}
                  </div>
                </div>
              )}
              {team?.requirements?.professions?.length > 0 && (
                <div style={styles.requirementGroup}>
                  <h4>Professions Needed:</h4>
                  <div style={styles.tags}>
                    {team.requirements.professions.map((prof, i) => (
                      <span key={i} style={styles.tag}>{prof.label}</span>
                    ))}
                  </div>
                </div>
              )}
              {(!team?.requirements?.languages?.length && 
                !team?.requirements?.skills?.length && 
                !team?.requirements?.professions?.length) && (
                <div style={styles.emptyState}>
                  No requirements specified for this team.
                </div>
              )}
            </div>
          )}
        </div>
        
        <div style={styles.sectionDivider} />
        <div style={styles.members}>
          <h3>Current Members</h3>
          {team?.members?.length > 0 ? (
            <div style={styles.membersGrid}>
              {team.members.map(member => (
                <div key={member.userId} style={styles.memberCard}>
                  <div style={styles.memberHeader}>
                    <img 
                      src={'https://ui-avatars.com/api/?name=' + encodeURIComponent(member.name)}
                      alt={member.name}
                      style={styles.memberAvatar}
                    />
                    <div style={styles.memberInfo}>
                      <h4>{member.name}</h4>
                      <span style={styles.memberEmail}>{member.email}</span>
                      <span style={{
                        ...styles.memberStatus,
                        backgroundColor: member.status === 'approved' ? '#10B981' : '#F59E0B',
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: '9999px',
                        fontSize: '0.75rem',
                      }}>
                        {member.status}
                      </span>
                    </div>
                  </div>
                  {(user.role === 'admin' || user.role === 'global_admin') && (
                    <button
                      onClick={() => removeMemberFromTeam(member.userId)}
                      style={styles.removeButton}
                    >
                      <FaUserMinus /> Remove Member
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={styles.emptyState}>
              No members have been added to this team yet.
            </div>
          )}
        </div>
        <div style={styles.sectionDivider} />
        
        {/* Potential matches section */}
        <div style={styles.matchingSection}>
          <h3>Potential Team Members</h3>
          
          <div style={styles.filterSection}>
            <div style={styles.searchBox}>
              <FaSearch style={styles.searchIcon} />
              <input
                type="text"
                placeholder="Search members..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={styles.searchInput}
              />
            </div>

            <div style={styles.filters}>
              <Select
                isClearable
                placeholder="Filter by skill"
                value={skillFilter}
                onChange={setSkillFilter}
                options={team?.requirements?.skills || []}
                styles={selectStyles}
              />
              <Select
                isClearable
                placeholder="Filter by language"
                value={languageFilter}
                onChange={setLanguageFilter}
                options={team?.requirements?.languages || []}
                styles={selectStyles}
              />
              <Select
                isClearable
                placeholder="Filter by profession"
                value={professionFilter}
                onChange={setProfessionFilter}
                options={team?.requirements?.professions || []}
                styles={selectStyles}
              />
              <div style={styles.scoreFilter}>
                <label>Min. Match Score:</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={matchScoreFilter}
                  onChange={(e) => setMatchScoreFilter(Number(e.target.value))}
                />
                <span>{matchScoreFilter}%</span>
              </div>
              <div style={styles.filterGroup}>
                <label style={styles.filterLabel}>Age Range:</label>
                <div style={styles.ageInputs}>
                  <input
                    type="number"
                    value={ageFilter.min}
                    onChange={(e) => setAgeFilter(prev => ({ ...prev, min: parseInt(e.target.value) || 0 }))}
                    style={styles.ageInput}
                    placeholder="Min"
                  />
                  <span>-</span>
                  <input
                    type="number"
                    value={ageFilter.max}
                    onChange={(e) => setAgeFilter(prev => ({ ...prev, max: parseInt(e.target.value) || 100 }))}
                    style={styles.ageInput}
                    placeholder="Max"
                  />
                </div>
              </div>
              <Select
                isClearable
                placeholder="Filter by gender"
                value={genderFilter}
                onChange={setGenderFilter}
                options={[
                  { value: 'male', label: 'Male' },
                  { value: 'female', label: 'Female' }
                ]}
                styles={selectStyles}
              />
              <div style={styles.switchContainer}>
                <label style={styles.switchLabel}>
                  <input
                    type="checkbox"
                    checked={showMissingRequirements}
                    onChange={(e) => setShowMissingRequirements(e.target.checked)}
                    style={styles.switchInput}
                  />
                  Show users missing requirements
                </label>
              </div>
            </div>
          </div>

          <div style={styles.membersGrid}>
            {currentMembers.map(({ user, matches, matchScore }) => (
              <div key={user.id} style={styles.memberCard}>
                <div style={styles.memberHeader}>
                  <img 
                    src={user.profileImg || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.name)}
                    alt={user.name}
                    onError={(e) => {
                      e.target.src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.name);
                    }}
                    style={styles.memberAvatar}
                  />
                  <div style={styles.memberInfo}>
                    <h4>{user.name} {user.lastName}</h4>
                    <span style={styles.matchScore}>
                      {matchScore.toFixed(0)}% match
                    </span>
                  </div>
                </div>

                <div style={styles.matchDetails}>
                  {matches.languages.length > 0 && (
                    <div style={styles.matchGroup}>
                      <span>Languages:</span>
                      {matches.languages.map((lang, i) => (
                        <span key={i} style={styles.matchTag}>{lang.label}</span>
                      ))}
                    </div>
                  )}
                  {/* Similar sections for skills and professions */}
                </div>

                {!team.members?.some(m => m.userId === user.id) && (
                  <button
                    onClick={() => addMemberToTeam(user.id)}
                    style={styles.addButton}
                  >
                    <FaUserPlus /> Add to Team
                  </button>
                )}
              </div>
            ))}
          </div>

          {filteredMembers.length > itemsPerPage && (
            <div style={styles.pagination}>
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                style={styles.paginationButton}
              >
                Previous
              </button>
              <span style={styles.pageInfo}>
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                style={styles.paginationButton}
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
      <ToastContainer />
    </div>
  );
};

const styles = {
  requirements: {
    marginTop: '2rem',
    padding: '1rem',
    backgroundColor: '#f9fafb',
    borderRadius: '0.5rem',
  },
  requirementsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  requirementsForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    marginTop: '1rem'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  label: {
    fontWeight: '500',
    fontSize: '0.875rem',
    color: '#374151'
  },
  requirementGroup: {
    marginBottom: '1rem',
  },
  tags: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.5rem',
  },
  tag: {
    backgroundColor: '#e5e7eb',
    padding: '0.25rem 0.75rem',
    borderRadius: '9999px',
    fontSize: '0.875rem',
  },
  matchingSection: {
    marginTop: '2rem',
  },
  membersGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '1rem',
    marginTop: '1rem',
  },
  memberCard: {
    padding: '1rem',
    backgroundColor: 'white',
    borderRadius: '0.5rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  memberHeader: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: '1rem',
  },
  memberAvatar: {
    width: '50px',
    height: '50px',
    borderRadius: '50%',
    marginRight: '1rem',
  },
  memberInfo: {
    display: 'flex',
    flexDirection: 'column',
  },
  matchScore: {
    fontSize: '0.875rem',
    color: '#6b7280',
  },
  matchDetails: {
    marginTop: '1rem',
  },
  matchGroup: {
    marginBottom: '0.5rem',
  },
  matchTag: {
    backgroundColor: '#d1fae5',
    padding: '0.25rem 0.75rem',
    borderRadius: '9999px',
    fontSize: '0.875rem',
    marginRight: '0.5rem',
  },
  addButton: {
    marginTop: '1rem',
    padding: '0.5rem 1rem',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '0.5rem',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  removeButton: {
    marginTop: '1rem',
    padding: '0.5rem 1rem',
    backgroundColor: '#EF4444',
    color: 'white',
    border: 'none',
    borderRadius: '0.5rem',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.875rem',
    '&:hover': {
      backgroundColor: '#DC2626'
    }
  },
  leaderSection: {
    marginBottom: '2rem',
    padding: '1rem',
    backgroundColor: '#f8fafc',
    borderRadius: '0.5rem'
  },
  leaderInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  leaderEmail: {
    color: '#6b7280',
    fontSize: '0.875rem'
  },
  noLeader: {
    color: '#ef4444',
    fontStyle: 'italic'
  },
  actionButtons: {
    display: 'flex',
    gap: '1rem',
  },
  saveButton: {
    backgroundColor: '#059669',
    color: 'white',
    padding: '0.5rem 1rem',
    borderRadius: '0.375rem',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '500',
    display: 'flex',
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#9CA3AF',
    color: 'white',
    padding: '0.5rem 1rem',
    borderRadius: '0.375rem',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '500',
    display: 'flex',
    alignItems: 'center',
  },
  editButton: {
    backgroundColor: '#3b82f6',
    color: 'white',
    padding: '0.5rem 1.5rem',
    borderRadius: '0.375rem',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '500',
    display: 'flex',
    alignItems: 'center',
    transition: 'background-color 0.2s',
    '&:hover': {
      backgroundColor: '#2563eb'
    }
  },
  buttonIcon: {
    marginRight: '0.5rem',
  },
  section: {
    backgroundColor: 'white',
    borderRadius: '0.5rem',
    padding: '2rem',
    marginBottom: '2rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  sectionDivider: {
    height: '1px',
    backgroundColor: '#e5e7eb',
    margin: '2rem 0',
  },
  emptyState: {
    textAlign: 'center',
    padding: '2rem',
    color: '#6b7280',
    backgroundColor: '#f9fafb',
    borderRadius: '0.5rem',
    margin: '1rem 0',
  },
  editForm: {
    marginBottom: '2rem',
  },
  input: {
    width: '100%',
    padding: '0.5rem',
    border: '1px solid #E5E7EB',
    borderRadius: '0.375rem',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    '&:focus': {
      outline: 'none',
      borderColor: '#3B82F6',
      boxShadow: '0 0 0 1px #3B82F6',
    },
  },
  teamName: {
    fontSize: '1.5rem',
    fontWeight: '600',
    color: '#111827',
    marginBottom: '0.5rem',
  },
  description: {
    color: '#4B5563',
    fontSize: '0.875rem',
    lineHeight: '1.5rem',
    marginBottom: '1rem',
  },
  filterSection: {
    marginBottom: '1.5rem',
  },
  searchBox: {
    position: 'relative',
    marginBottom: '1rem',
  },
  searchIcon: {
    position: 'absolute',
    left: '0.75rem',
    top: '50%',
    transform: 'translateY(-50%)',
    color: '#6B7280',
  },
  searchInput: {
    width: '100%',
    padding: '0.5rem 0.75rem 0.5rem 2.5rem',
    borderRadius: '0.375rem',
    border: '1px solid #E5E7EB',
    fontSize: '0.875rem',
  },
  filters: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '1rem',
    marginBottom: '1rem',
  },
  scoreFilter: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.875rem',
  },
  filterGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  filterLabel: {
    fontSize: '0.875rem',
    color: '#374151',
  },
  ageInputs: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  ageInput: {
    width: '80px',
    padding: '0.5rem',
    border: '1px solid #E5E7EB',
    borderRadius: '0.375rem',
    fontSize: '0.875rem',
  },
  switchContainer: {
    display: 'flex',
    alignItems: 'center',
  },
  switchLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.875rem',
    color: '#374151',
    cursor: 'pointer',
  },
  switchInput: {
    width: '1rem',
    height: '1rem',
  },
  pagination: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '1rem',
    marginTop: '2rem',
  },
  paginationButton: {
    padding: '0.5rem 1rem',
    backgroundColor: '#3B82F6',
    color: 'white',
    border: 'none',
    borderRadius: '0.375rem',
    cursor: 'pointer',
    '&:disabled': {
      backgroundColor: '#9CA3AF',
      cursor: 'not-allowed',
    },
  },
  pageInfo: {
    fontSize: '0.875rem',
    color: '#4B5563',
  },
};

const selectStyles = {
  control: (base) => ({
    ...base,
    minHeight: '38px',
    borderColor: '#E5E7EB',
    borderRadius: '0.375rem',
    boxShadow: 'none',
    '&:hover': {
      borderColor: '#9CA3AF'
    }
  }),
  menu: (base) => ({
    ...base,
    zIndex: 9999
  })
};

export default TeamDetailPage;

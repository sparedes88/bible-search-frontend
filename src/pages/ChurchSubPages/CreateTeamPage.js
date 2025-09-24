import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { addDoc, collection, serverTimestamp, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import commonStyles from '../../pages/commonStyles';
import ChurchHeader from '../../components/ChurchHeader';
import Select from 'react-select';
import CreatableSelect from 'react-select/creatable';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import ocupaciones from '../../components/ocupaciones';
import idiomas from '../../components/idiomas';
import habilidades from '../../components/habilidades';

const CreateTeamPage = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newTeam, setNewTeam] = useState({
    name: '',
    description: '',
    members: [],
    requirements: {
      languages: [],
      skills: [],
      professions: []
    }
  });

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      const usersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setUsers(usersData);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Failed to load users');
    }
  };

  const handleRequirementChange = (type, selectedOptions) => {
    setNewTeam(prev => ({
      ...prev,
      requirements: {
        ...prev.requirements,
        [type]: selectedOptions || []
      }
    }));
  };

  const handleCreateTeam = async (e) => {
    e.preventDefault();

    setLoading(true);
    try {
      const teamData = {
        ...newTeam,
        createdAt: serverTimestamp(),
        createdBy: user.uid
      };

      const teamRef = await addDoc(collection(db, `churches/${id}/teams`), teamData);
      toast.success('Team created successfully');
      navigate(`/organization/${id}/teams/${teamRef.id}`);
    } catch (error) {
      console.error('Error creating team:', error);
      toast.error('Failed to create team');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={commonStyles.container}>
      <Link to={`/organization/${id}/teams`} style={commonStyles.backButtonLink}>
        ← Back to Teams
      </Link>
      <ChurchHeader id={id} applyShadow={false} allowEditBannerLogo={true} />
      <div style={{ marginTop: "-30px" }}>
        <h1 style={commonStyles.title}>Create New Team</h1>

        <form onSubmit={handleCreateTeam} style={styles.form}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Team Name *</label>
            <input
              type="text"
              value={newTeam.name}
              onChange={(e) => setNewTeam({...newTeam, name: e.target.value})}
              required
              style={styles.input}
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Description</label>
            <textarea
              value={newTeam.description}
              onChange={(e) => setNewTeam({...newTeam, description: e.target.value})}
              style={styles.textarea}
            />
          </div>

          <div style={styles.requirementsSection}>
            <h3>Team Requirements</h3>
            
            <div style={styles.formGroup}>
              <label>Required Languages</label>
              <Select
                isMulti
                options={idiomas.map(lang => ({ value: lang, label: lang }))}
                onChange={(selected) => handleRequirementChange('languages', selected)}
                value={newTeam.requirements.languages}
              />
            </div>

            <div style={styles.formGroup}>
              <label>Required Skills</label>
              <Select
                isMulti
                options={Object.values(habilidades).flat().map(skill => ({
                  value: skill,
                  label: skill
                }))}
                onChange={(selected) => handleRequirementChange('skills', selected)}
                value={newTeam.requirements.skills}
              />
            </div>

            <div style={styles.formGroup}>
              <label>Required Professions</label>
              <Select
                isMulti
                options={ocupaciones.map(prof => ({ value: prof, label: prof }))}
                onChange={(selected) => handleRequirementChange('professions', selected)}
                value={newTeam.requirements.professions}
              />
            </div>
          </div>

          <button type="submit" style={styles.submitButton} disabled={loading}>
            {loading ? 'Creating...' : 'Create Team'}
          </button>
        </form>
      </div>
      <ToastContainer />
    </div>
  );
};

const styles = {
  form: {
    maxWidth: '600px',
    margin: '0 auto',
    padding: '20px'
  },
  formGroup: {
    marginBottom: '20px'
  },
  label: {
    display: 'block',
    marginBottom: '8px',
    fontWeight: '500'
  },
  input: {
    width: '100%',
    padding: '8px',
    borderRadius: '4px',
    border: '1px solid #ddd'
  },
  textarea: {
    width: '100%',
    padding: '8px',
    borderRadius: '4px',
    border: '1px solid #ddd',
    minHeight: '100px'
  },
  submitButton: {
    backgroundColor: '#4F46E5',
    color: 'white',
    padding: '10px 20px',
    borderRadius: '8px',
    border: 'none',
    cursor: 'pointer',
    width: '100%'
  },
  requirementsSection: {
    marginTop: '30px'
  }
};

const selectStyles = {
  control: (base) => ({
    ...base,
    borderColor: '#ddd',
    borderRadius: '4px'
  }),
  menu: (base) => ({
    ...base,
    zIndex: 9999
  })
};

export default CreateTeamPage;

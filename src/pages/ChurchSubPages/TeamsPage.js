import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { collection, getDocs, query, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../../firebase';
import commonStyles from '../../pages/commonStyles';
import ChurchHeader from '../../components/ChurchHeader';
import { FaPlus, FaUsers, FaCheckCircle, FaTrash, FaFilePdf } from 'react-icons/fa';
import Skeleton from 'react-loading-skeleton';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { jsPDF } from 'jspdf';

const TeamsPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTeams();
  }, [id]);

  const fetchTeams = async () => {
    try {
      const q = query(
        collection(db, `churches/${id}/teams`),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(q);
      const teamsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setTeams(teamsData);
    } catch (error) {
      console.error('Error fetching teams:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTeam = async (e, teamId) => {
    e.stopPropagation(); // Prevent navigation when clicking delete
    
    if (!window.confirm('Are you sure you want to delete this team?')) {
      return;
    }

    try {
      await deleteDoc(doc(db, `churches/${id}/teams`, teamId));
      toast.success('Team deleted successfully');
      fetchTeams(); // Refresh the list
    } catch (error) {
      console.error('Error deleting team:', error);
      toast.error('Failed to delete team');
    }
  };

  const exportToPDF = async () => {
    try {
      const toastId = toast.loading('Preparing PDF...', { autoClose: false });
      const doc = new jsPDF();
      
      // Add title and header with branded color
      doc.setFillColor(79, 70, 229);
      doc.rect(0, 0, doc.internal.pageSize.width, 40, 'F');
      doc.setTextColor(255);
      doc.setFontSize(24);
      doc.text('Teams Management Report', 15, 25);
      
      // Header info
      doc.setFontSize(11);
      doc.setTextColor(200, 200, 200);
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, 15, 35);
      doc.text(`Total Teams: ${teams.length}`, doc.internal.pageSize.width - 60, 35);
      
      let yOffset = 50;

      // Process each team
      for (const team of teams) {
        // Check if we need a new page
        if (yOffset > doc.internal.pageSize.height - 60) {
          doc.addPage();
          yOffset = 20;
        }

        // Team header
        doc.setFillColor(243, 244, 246);
        doc.rect(15, yOffset, doc.internal.pageSize.width - 30, 40, 'F');
        
        // Team name
        doc.setFontSize(16);
        doc.setTextColor(31, 41, 55);
        doc.text(team.name, 20, yOffset + 15);

        // Team stats
        doc.setFontSize(10);
        doc.setTextColor(107, 114, 128);
        const stats = [
          `Members: ${team.members?.length || 0}`,
          `Requirements: ${(team.requirements?.languages?.length || 0) + 
            (team.requirements?.skills?.length || 0) + 
            (team.requirements?.professions?.length || 0)}`,
          team.leader ? 'Has Leader' : 'No Leader'
        ];
        doc.text(stats.join(' | '), 20, yOffset + 30);

        yOffset += 50;

        // Team description
        if (team.description) {
          const descriptionLines = doc.splitTextToSize(team.description, doc.internal.pageSize.width - 45);
          doc.setTextColor(75, 85, 99);
          doc.text(descriptionLines, 20, yOffset);
          yOffset += (descriptionLines.length * 7) + 10;
        }

        // Requirements section
        if (team.requirements) {
          doc.setFontSize(12);
          doc.setTextColor(31, 41, 55);
          yOffset += 10;
          doc.text('Requirements:', 20, yOffset);
          yOffset += 10;

          doc.setFontSize(10);
          doc.setTextColor(107, 114, 128);

          if (team.requirements.languages?.length) {
            doc.text('Languages:', 25, yOffset);
            doc.text(team.requirements.languages.join(', '), 80, yOffset);
            yOffset += 10;
          }

          if (team.requirements.skills?.length) {
            doc.text('Skills:', 25, yOffset);
            doc.text(team.requirements.skills.join(', '), 80, yOffset);
            yOffset += 10;
          }

          if (team.requirements.professions?.length) {
            doc.text('Professions:', 25, yOffset);
            doc.text(team.requirements.professions.join(', '), 80, yOffset);
            yOffset += 10;
          }
        }

        // Add some spacing between teams
        yOffset += 20;
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
      doc.save('teams-management-report.pdf');
      
      toast.update(toastId, {
        render: 'PDF generated successfully!',
        type: 'success',
        isLoading: false,
        autoClose: 3000,
      });
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Failed to generate PDF. Please try again.');
    }
  };

  return (
    <div style={commonStyles.container}>
      <Link to={`/organization/${id}/mi-organizacion`} style={commonStyles.backButtonLink}>
        ← Back to Mi Organización
      </Link>
      <ChurchHeader id={id} applyShadow={false} allowEditBannerLogo={true} />
      <div style={{ marginTop: "-30px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
          <h1 style={commonStyles.title}>Teams Management</h1>
          <div style={{ display: "flex", gap: "1rem" }}>
            <button 
              onClick={exportToPDF}
              style={{
                ...styles.addButton,
                backgroundColor: "#2563eb"
              }}
            >
              <FaFilePdf /> Export to PDF
            </button>
            <button 
              onClick={() => navigate(`/organization/${id}/teams/create`)} 
              style={styles.addButton}
            >
              <FaPlus /> Create New Team
            </button>
          </div>
        </div>

        <div style={styles.teamsGrid}>
          {loading ? (
            <Skeleton count={4} height={200} className="mb-4" />
          ) : teams.length === 0 ? (
            <p>No teams available</p>
          ) : (
            teams.map((team) => (
              <div 
                key={team.id} 
                style={styles.teamCard}
                onClick={() => navigate(`/organization/${id}/teams/${team.id}`)}
              >
                <div style={styles.teamHeader}>
                  <FaUsers size={24} color="#4F46E5" />
                  <h3 style={styles.teamName}>{team.name}</h3>
                  <button
                    onClick={(e) => handleDeleteTeam(e, team.id)}
                    style={styles.deleteButton}
                    title="Delete Team"
                  >
                    <FaTrash />
                  </button>
                </div>
                
                <p style={styles.teamDescription}>{team.description}</p>
                
                <div style={styles.teamStats}>
                  <div style={styles.statItem}>
                    <span style={styles.statLabel}>Members:</span>
                    <span>{team.members?.length || 0}</span>
                  </div>
                  <div style={styles.statItem}>
                    <span style={styles.statLabel}>Requirements:</span>
                    <span>
                      {(team.requirements?.languages?.length || 0) +
                       (team.requirements?.skills?.length || 0) +
                       (team.requirements?.professions?.length || 0)}
                    </span>
                  </div>
                  {team.leader && (
                    <div style={styles.leaderBadge}>
                      <FaCheckCircle size={12} />
                      <span>Has Leader</span>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <ToastContainer />
    </div>
  );
};

const styles = {
  addButton: {
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
  teamsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '1.5rem',
    marginTop: '2rem'
  },
  teamCard: {
    backgroundColor: 'white',
    borderRadius: '0.5rem',
    padding: '1.5rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    cursor: 'pointer',
    transition: 'transform 0.2s',
    ':hover': {
      transform: 'translateY(-2px)'
    }
  },
  teamHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    marginBottom: '1rem',
    position: 'relative'
  },
  teamName: {
    margin: 0,
    fontSize: '1.25rem',
    fontWeight: '600'
  },
  deleteButton: {
    position: 'absolute',
    right: 0,
    top: '50%',
    transform: 'translateY(-50%)',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#EF4444',
    cursor: 'pointer',
    padding: '0.5rem',
    borderRadius: '0.25rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    ':hover': {
      backgroundColor: '#FEE2E2'
    }
  },
  teamDescription: {
    color: '#6B7280',
    fontSize: '0.875rem',
    marginBottom: '1rem'
  },
  teamStats: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    flexWrap: 'wrap'
  },
  statItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  statLabel: {
    color: '#6B7280',
    fontSize: '0.875rem'
  },
  leaderBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
    backgroundColor: '#DEF7EC',
    color: '#059669',
    padding: '0.25rem 0.5rem',
    borderRadius: '9999px',
    fontSize: '0.75rem'
  }
};

export default TeamsPage;

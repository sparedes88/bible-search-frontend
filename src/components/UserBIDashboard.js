import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getFirestore, collection, query, where, getDocs, limit } from 'firebase/firestore';
import { Bar, Line } from 'react-chartjs-2';
import { Chart, registerables } from 'chart.js';
import { FaUsers, FaCalendarAlt, FaBook, FaChartLine, FaLightbulb, FaArrowUp, FaArrowDown } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import './UserBIDashboard.css';

// Register Chart.js components
Chart.register(...registerables);

const UserBIDashboard = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);
  const [metrics, setMetrics] = useState({
    eventsAttended: 0,
    coursesCompleted: 0,
    groupsJoined: 0,
    donationsCount: 0
  });
  const [attendanceData, setAttendanceData] = useState({
    labels: [],
    datasets: []
  });
  const [courseProgressData, setCourseProgressData] = useState({
    labels: [],
    datasets: []
  });
  const [insights, setInsights] = useState([]);

  useEffect(() => {
    const fetchUserData = async () => {
      if (!currentUser) return;
      
      try {
        const db = getFirestore();
        
        // Fetch user profile data
        const userRef = query(collection(db, "users"), where("uid", "==", currentUser.uid));
        const userSnapshot = await getDocs(userRef);
        
        if (!userSnapshot.empty) {
          setUserData(userSnapshot.docs[0].data());
        }
        
        // Fetch event attendance
        const attendanceRef = query(
          collection(db, "eventAttendance"),
          where("userId", "==", currentUser.uid),
          limit(50)
        );
        const attendanceSnapshot = await getDocs(attendanceRef);
        const attendanceCount = attendanceSnapshot.size;
        
        // Fetch completed courses
        const coursesRef = query(
          collection(db, "courseProgress"),
          where("userId", "==", currentUser.uid),
          where("completed", "==", true)
        );
        const coursesSnapshot = await getDocs(coursesRef);
        const coursesCount = coursesSnapshot.size;
        
        // Fetch groups user is part of
        const groupsRef = query(
          collection(db, "groupMembers"),
          where("userId", "==", currentUser.uid)
        );
        const groupsSnapshot = await getDocs(groupsRef);
        const groupsCount = groupsSnapshot.size;
        
        // Fetch donations
        const donationsRef = query(
          collection(db, "donations"),
          where("userId", "==", currentUser.uid)
        );
        const donationsSnapshot = await getDocs(donationsRef);
        const donationsCount = donationsSnapshot.size;
        
        setMetrics({
          eventsAttended: attendanceCount,
          coursesCompleted: coursesCount,
          groupsJoined: groupsCount,
          donationsCount: donationsCount
        });
        
        // Prepare attendance data for chart
        const last6Months = getLast6Months();
        const attendanceByMonth = {};
        last6Months.forEach(month => {
          attendanceByMonth[month] = 0;
        });
        
        attendanceSnapshot.forEach(doc => {
          const data = doc.data();
          if (data.date) {
            const date = data.date.toDate ? data.date.toDate() : new Date(data.date);
            const monthYear = `${date.getMonth() + 1}/${date.getFullYear()}`;
            if (attendanceByMonth[monthYear] !== undefined) {
              attendanceByMonth[monthYear]++;
            }
          }
        });
        
        setAttendanceData({
          labels: Object.keys(attendanceByMonth).map(formatMonthLabel),
          datasets: [
            {
              label: 'Asistencia a Eventos',
              data: Object.values(attendanceByMonth),
              backgroundColor: 'rgba(79, 70, 229, 0.6)',
              borderColor: 'rgba(79, 70, 229, 1)',
              borderWidth: 1,
            },
          ],
        });
        
        // Prepare course progress data
        const courseProgress = {};
        const courseProgressSnapshot = await getDocs(
          query(collection(db, "courseProgress"), where("userId", "==", currentUser.uid))
        );
        
        courseProgressSnapshot.forEach(doc => {
          const data = doc.data();
          if (data.courseId && data.progress) {
            courseProgress[data.courseName || `Curso ${Object.keys(courseProgress).length + 1}`] = data.progress;
          }
        });
        
        const courseLabels = Object.keys(courseProgress).slice(0, 5);
        const courseValues = courseLabels.map(label => courseProgress[label]);
        
        setCourseProgressData({
          labels: courseLabels,
          datasets: [
            {
              label: 'Progreso de Cursos (%)',
              data: courseValues,
              backgroundColor: 'rgba(16, 185, 129, 0.6)',
              borderColor: 'rgba(16, 185, 129, 1)',
              borderWidth: 1,
            },
          ],
        });
        
        // Generate insights
        const userInsights = [];
        
        if (attendanceCount === 0) {
          userInsights.push({
            icon: <FaCalendarAlt />,
            text: 'Aún no has asistido a ningún evento. ¡Explora los próximos eventos y participa!',
            action: 'Ver Eventos',
            link: '/events'
          });
        }
        
        if (coursesCount === 0) {
          userInsights.push({
            icon: <FaBook />,
            text: 'No has completado ningún curso. Los cursos te ayudarán a crecer en tu fe y conocimiento.',
            action: 'Explorar Cursos',
            link: '/courses'
          });
        }
        
        if (groupsCount === 0) {
          userInsights.push({
            icon: <FaUsers />,
            text: 'Únete a un grupo para conectar con otros miembros y crecer juntos.',
            action: 'Ver Grupos',
            link: '/groups'
          });
        }
        
        // Add personalized insights based on activity
        if (attendanceCount > 0 && coursesCount > 0) {
          userInsights.push({
            icon: <FaLightbulb />,
            text: 'Estás progresando bien en tu participación. Considera invitar a un amigo al próximo evento.',
            action: 'Invitar',
            link: '/invite'
          });
        }
        
        setInsights(userInsights);
        setLoading(false);
      } catch (error) {
        console.error("Error fetching user data:", error);
        setLoading(false);
      }
    };
    
    fetchUserData();
  }, [currentUser]);
  
  const getLast6Months = () => {
    const months = [];
    const now = new Date();
    
    for (let i = 5; i >= 0; i--) {
      const month = new Date(now);
      month.setMonth(now.getMonth() - i);
      months.push(`${month.getMonth() + 1}/${month.getFullYear()}`);
    }
    
    return months;
  };
  
  const formatMonthLabel = (monthYear) => {
    const [month, year] = monthYear.split('/');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
  };
  
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
      },
    },
  };
  
  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Cargando...</span>
        </div>
      </div>
    );
  }
  
  return (
    <div className="user-dashboard-container">
      <div className="dashboard-header">
        <h1 className="dashboard-title">Tu Dashboard Personal</h1>
        <p className="dashboard-subtitle">
          Bienvenido {userData?.displayName || 'Miembro'}. Aquí puedes ver un resumen de tu participación y actividades.
        </p>
      </div>
      
      <div className="dashboard-cards">
        <div className="dashboard-card">
          <div className="card-header">
            <div className="card-icon"><FaCalendarAlt /></div>
            <div className="card-title">Eventos Asistidos</div>
          </div>
          <div className="card-value">{metrics.eventsAttended}</div>
          <p className="card-description">Total de eventos a los que has asistido</p>
        </div>
        
        <div className="dashboard-card">
          <div className="card-header">
            <div className="card-icon"><FaBook /></div>
            <div className="card-title">Cursos Completados</div>
          </div>
          <div className="card-value">{metrics.coursesCompleted}</div>
          <p className="card-description">Total de cursos que has completado</p>
        </div>
        
        <div className="dashboard-card">
          <div className="card-header">
            <div className="card-icon"><FaUsers /></div>
            <div className="card-title">Grupos</div>
          </div>
          <div className="card-value">{metrics.groupsJoined}</div>
          <p className="card-description">Grupos a los que perteneces</p>
        </div>
        
        <div className="dashboard-card">
          <div className="card-header">
            <div className="card-icon"><FaChartLine /></div>
            <div className="card-title">Participación</div>
          </div>
          <div className="card-value">
            {metrics.eventsAttended + metrics.coursesCompleted * 2 + metrics.groupsJoined * 3}
          </div>
          <p className="card-description">Tu nivel de participación en la organización</p>
        </div>
      </div>
      
      <div className="chart-container">
        <h2 className="chart-title">Tu Asistencia a Eventos</h2>
        <p className="chart-description">Histórico de asistencia a eventos en los últimos 6 meses</p>
        <div style={{ height: '300px' }}>
          <Bar data={attendanceData} options={chartOptions} />
        </div>
      </div>
      
      {courseProgressData.labels.length > 0 && (
        <div className="chart-container">
          <h2 className="chart-title">Progreso en Cursos</h2>
          <p className="chart-description">Tu avance en los cursos actuales</p>
          <div style={{ height: '300px' }}>
            <Bar data={courseProgressData} options={chartOptions} />
          </div>
        </div>
      )}
      
      {insights.length > 0 && (
        <div className="insights-section">
          <h2 className="insights-title">Recomendaciones Personalizadas</h2>
          {insights.map((insight, index) => (
            <div className="insight-item" key={index}>
              <div className="insight-icon">{insight.icon}</div>
              <div className="insight-content">
                <p className="insight-text">{insight.text}</p>
                <a href={insight.link} className="insight-action">{insight.action}</a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default UserBIDashboard;
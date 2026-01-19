import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, getDocs } from 'firebase/firestore';
import { useParams, useNavigate } from 'react-router-dom';
import ChurchHeader from './ChurchHeader';
import { CostDashboard } from './CostDashboard';

const CostAnalytics = () => {
  const { user } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics();
  }, [user, id]);

  const fetchAnalytics = async () => {
    try {
      const q = query(
        collection(db, `churches/${id}/users/${user.uid}/conversations`)
      );
      const snapshot = await getDocs(q);
      const conversationsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setConversations(conversationsData);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching analytics:', error);
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <button
        onClick={() => navigate(`/church/${id}/asistente-pastoral`)}
        className="mb-4 flex items-center text-gray-600 hover:text-gray-900"
      >
        ← Volver al Asistente
      </button>
      
      <ChurchHeader id={id} applyShadow={false} />
      
      <div className="mt-8 bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800">Análisis de Costos - Asistente Pastoral</h2>
        </div>
        
        {loading ? (
          <div className="p-6">Cargando análisis...</div>
        ) : (
          <div className="p-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-indigo-50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-indigo-800">Costo Total</h3>
                <p className="mt-2 text-2xl font-semibold text-indigo-600">
                  ${conversations.reduce((acc, convo) => acc + (convo.totalCost || 0), 0).toFixed(4)}
                </p>
              </div>
              <div className="bg-green-50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-green-800">Conversaciones</h3>
                <p className="mt-2 text-2xl font-semibold text-green-600">
                  {conversations.length}
                </p>
              </div>
              <div className="bg-blue-50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-blue-800">Leads Prioritarios</h3>
                <p className="mt-2 text-2xl font-semibold text-blue-600">
                  {conversations.filter(convo => convo.isPriority).length}
                </p>
              </div>
              <div className="bg-purple-50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-purple-800">Tokens Totales</h3>
                <p className="mt-2 text-2xl font-semibold text-purple-600">
                  {conversations.reduce((acc, convo) => acc + ((convo.inputTokens || 0) + (convo.outputTokens || 0)), 0).toLocaleString()}
                </p>
              </div>
            </div>

            {/* Priority Leads */}
            <div className="mt-8">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Leads Prioritarios</h3>
              <div className="space-y-4">
                {conversations
                  .filter(convo => convo.isPriority)
                  .map(convo => (
                    <div key={convo.id} className="bg-yellow-50 rounded-lg p-4">
                      <div className="font-medium text-yellow-800">{convo.tema}</div>
                      <div className="text-sm text-yellow-600 mt-1">"{convo.lastResponse}"</div>
                      <div className="text-xs text-yellow-500 mt-2">
                        {new Date(convo.lastUpdated?.toDate()).toLocaleDateString()}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CostAnalytics;
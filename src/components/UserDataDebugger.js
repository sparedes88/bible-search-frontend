import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { db } from '../firebase';
import { 
  collection, 
  getDocs, 
  query, 
  where,
  doc,
  getDoc
} from 'firebase/firestore';

/**
 * Debug component to help identify user data structure
 */
const UserDataDebugger = () => {
  const { id: churchId } = useParams();
  const [debugInfo, setDebugInfo] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (churchId) {
      debugUserCollections();
    }
  }, [churchId]);

  const debugUserCollections = async () => {
    try {
      setLoading(true);
      const results = [];

      // Test Pattern 1: users collection with churchId
      try {
        const usersQuery = query(
          collection(db, 'users'),
          where('churchId', '==', churchId)
        );
        const usersSnapshot = await getDocs(usersQuery);
        results.push({
          collection: 'users (with churchId filter)',
          count: usersSnapshot.docs.length,
          sampleData: usersSnapshot.docs.slice(0, 2).map(doc => ({
            id: doc.id,
            ...doc.data()
          })),
          status: 'success'
        });
      } catch (error) {
        results.push({
          collection: 'users (with churchId filter)',
          count: 0,
          error: error.message,
          status: 'error'
        });
      }

      // Test Pattern 2: members collection with churchId
      try {
        const membersQuery = query(
          collection(db, 'members'),
          where('churchId', '==', churchId)
        );
        const membersSnapshot = await getDocs(membersQuery);
        results.push({
          collection: 'members (with churchId filter)',
          count: membersSnapshot.docs.length,
          sampleData: membersSnapshot.docs.slice(0, 2).map(doc => ({
            id: doc.id,
            ...doc.data()
          })),
          status: 'success'
        });
      } catch (error) {
        results.push({
          collection: 'members (with churchId filter)',
          count: 0,
          error: error.message,
          status: 'error'
        });
      }

      // Test Pattern 3: church subcollection users
      try {
        const churchUsersQuery = collection(db, `churches/${churchId}/users`);
        const churchUsersSnapshot = await getDocs(churchUsersQuery);
        results.push({
          collection: `churches/${churchId}/users`,
          count: churchUsersSnapshot.docs.length,
          sampleData: churchUsersSnapshot.docs.slice(0, 2).map(doc => ({
            id: doc.id,
            ...doc.data()
          })),
          status: 'success'
        });
      } catch (error) {
        results.push({
          collection: `churches/${churchId}/users`,
          count: 0,
          error: error.message,
          status: 'error'
        });
      }

      // Test Pattern 4: userassignments collection
      try {
        const assignmentsQuery = query(
          collection(db, 'userassignments'),
          where('churchId', '==', churchId)
        );
        const assignmentsSnapshot = await getDocs(assignmentsQuery);
        const userIds = [...new Set(assignmentsSnapshot.docs.map(doc => doc.data().userId))];
        
        results.push({
          collection: 'userassignments (user IDs)',
          count: assignmentsSnapshot.docs.length,
          userIds: userIds.slice(0, 5),
          sampleData: assignmentsSnapshot.docs.slice(0, 2).map(doc => ({
            id: doc.id,
            ...doc.data()
          })),
          status: 'success'
        });
      } catch (error) {
        results.push({
          collection: 'userassignments',
          count: 0,
          error: error.message,
          status: 'error'
        });
      }

      // Test Pattern 5: all users collection (no filter)
      try {
        const allUsersQuery = collection(db, 'users');
        const allUsersSnapshot = await getDocs(allUsersQuery);
        const churchUsers = allUsersSnapshot.docs.filter(doc => 
          doc.data().churchId === churchId || 
          doc.data().iglesia === churchId ||
          doc.data().church === churchId
        );
        
        results.push({
          collection: 'users (all, filtered client-side)',
          count: churchUsers.length,
          totalUsers: allUsersSnapshot.docs.length,
          sampleData: churchUsers.slice(0, 2).map(doc => ({
            id: doc.id,
            ...doc.data()
          })),
          status: 'success'
        });
      } catch (error) {
        results.push({
          collection: 'users (all)',
          count: 0,
          error: error.message,
          status: 'error'
        });
      }

      setDebugInfo(results);
    } catch (error) {
      console.error('Debug error:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div>Loading debug info...</div>;
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h2>User Data Debug Information</h2>
      <p><strong>Church ID:</strong> {churchId}</p>
      
      {debugInfo.map((info, index) => (
        <div key={index} style={{ 
          margin: '20px 0', 
          padding: '16px', 
          border: '1px solid #ddd', 
          borderRadius: '8px',
          backgroundColor: info.status === 'error' ? '#ffe6e6' : '#e6ffe6'
        }}>
          <h3>{info.collection}</h3>
          <p><strong>Status:</strong> {info.status}</p>
          <p><strong>Count:</strong> {info.count}</p>
          
          {info.totalUsers && (
            <p><strong>Total Users in Collection:</strong> {info.totalUsers}</p>
          )}
          
          {info.userIds && (
            <div>
              <p><strong>Sample User IDs:</strong></p>
              <ul>
                {info.userIds.map(uid => <li key={uid}>{uid}</li>)}
              </ul>
            </div>
          )}
          
          {info.error && (
            <p style={{ color: 'red' }}><strong>Error:</strong> {info.error}</p>
          )}
          
          {info.sampleData && info.sampleData.length > 0 && (
            <div>
              <p><strong>Sample Data:</strong></p>
              <pre style={{ 
                background: '#f5f5f5', 
                padding: '10px', 
                borderRadius: '4px',
                overflow: 'auto',
                fontSize: '12px'
              }}>
                {JSON.stringify(info.sampleData, null, 2)}
              </pre>
            </div>
          )}
        </div>
      ))}
      
      <div style={{ marginTop: '20px', padding: '16px', background: '#f0f8ff', borderRadius: '8px' }}>
        <h3>Next Steps:</h3>
        <ol>
          <li>Look for the collection with the highest user count</li>
          <li>Check the sample data structure to understand the user fields</li>
          <li>Note which fields contain the user's name, email, and role</li>
          <li>If no users are found, check your Firestore security rules</li>
        </ol>
      </div>
    </div>
  );
};

export default UserDataDebugger;

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
 * Simple test component to find where users are stored
 */
const FindUsersTest = () => {
  const { id: churchId } = useParams();
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const testUserCollections = async () => {
    setLoading(true);
    const testResults = [];

    console.log('🔍 Testing user collections for church ID:', churchId);

    // Test 1: Check users collection
    try {
      console.log('📝 Testing: users collection');
      const usersRef = collection(db, 'users');
      const usersSnapshot = await getDocs(usersRef);
      console.log('Total users in collection:', usersSnapshot.docs.length);
      
      const churchUsers = usersSnapshot.docs.filter(doc => {
        const data = doc.data();
        return data.churchId === churchId || 
               data.iglesia === churchId || 
               data.church === churchId ||
               data.idIglesia === churchId;
      });
      
      testResults.push({
        name: 'users collection (all docs, filtered)',
        total: usersSnapshot.docs.length,
        filtered: churchUsers.length,
        sample: churchUsers.slice(0, 3).map(doc => ({
          id: doc.id,
          displayName: doc.data().displayName,
          email: doc.data().email,
          churchId: doc.data().churchId,
          iglesia: doc.data().iglesia,
          role: doc.data().role
        }))
      });
    } catch (error) {
      console.error('Error testing users collection:', error);
      testResults.push({
        name: 'users collection',
        error: error.message
      });
    }

    // Test 2: Check members collection  
    try {
      console.log('📝 Testing: members collection');
      const membersRef = collection(db, 'members');
      const membersSnapshot = await getDocs(membersRef);
      console.log('Total members in collection:', membersSnapshot.docs.length);
      
      const churchMembers = membersSnapshot.docs.filter(doc => {
        const data = doc.data();
        return data.churchId === churchId || 
               data.iglesia === churchId || 
               data.church === churchId ||
               data.idIglesia === churchId;
      });
      
      testResults.push({
        name: 'members collection (all docs, filtered)',
        total: membersSnapshot.docs.length,
        filtered: churchMembers.length,
        sample: churchMembers.slice(0, 3).map(doc => ({
          id: doc.id,
          name: doc.data().name,
          displayName: doc.data().displayName,
          email: doc.data().email,
          churchId: doc.data().churchId,
          iglesia: doc.data().iglesia,
          role: doc.data().role
        }))
      });
    } catch (error) {
      console.error('Error testing members collection:', error);
      testResults.push({
        name: 'members collection',
        error: error.message
      });
    }

    // Test 3: Check userassignments
    try {
      console.log('📝 Testing: userassignments collection');
      const assignmentsRef = collection(db, 'userassignments');
      const assignmentsSnapshot = await getDocs(assignmentsRef);
      console.log('Total assignments in collection:', assignmentsSnapshot.docs.length);
      
      const churchAssignments = assignmentsSnapshot.docs.filter(doc => {
        const data = doc.data();
        return data.churchId === churchId || 
               data.iglesia === churchId || 
               data.church === churchId ||
               data.idIglesia === churchId;
      });
      
      testResults.push({
        name: 'userassignments collection (all docs, filtered)',
        total: assignmentsSnapshot.docs.length,
        filtered: churchAssignments.length,
        sample: churchAssignments.slice(0, 3).map(doc => ({
          id: doc.id,
          userId: doc.data().userId,
          churchId: doc.data().churchId,
          iglesia: doc.data().iglesia,
          role: doc.data().role,
          data: doc.data()
        }))
      });
    } catch (error) {
      console.error('Error testing userassignments collection:', error);
      testResults.push({
        name: 'userassignments collection',
        error: error.message
      });
    }

    // Test 4: Check church subcollection
    try {
      console.log('📝 Testing: church subcollection users');
      const churchUsersRef = collection(db, `churches/${churchId}/users`);
      const churchUsersSnapshot = await getDocs(churchUsersRef);
      console.log('Users in church subcollection:', churchUsersSnapshot.docs.length);
      
      testResults.push({
        name: `churches/${churchId}/users subcollection`,
        total: churchUsersSnapshot.docs.length,
        filtered: churchUsersSnapshot.docs.length,
        sample: churchUsersSnapshot.docs.slice(0, 3).map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
      });
    } catch (error) {
      console.error('Error testing church users subcollection:', error);
      testResults.push({
        name: `churches/${churchId}/users subcollection`,
        error: error.message
      });
    }

    console.log('🎯 Test Results:', testResults);
    setResults(testResults);
    setLoading(false);
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h2>🔍 Find Users Test</h2>
      <p><strong>Church ID:</strong> {churchId}</p>
      
      <button 
        onClick={testUserCollections}
        disabled={loading}
        style={{
          padding: '12px 24px',
          background: loading ? '#ccc' : '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          fontSize: '16px',
          cursor: loading ? 'not-allowed' : 'pointer',
          marginBottom: '20px'
        }}
      >
        {loading ? '🔄 Testing...' : '🧪 Test All User Collections'}
      </button>

      {results.length > 0 && (
        <div>
          <h3>📊 Results:</h3>
          {results.map((result, index) => (
            <div key={index} style={{
              border: '1px solid #ddd',
              borderRadius: '8px',
              padding: '16px',
              margin: '10px 0',
              backgroundColor: result.error ? '#ffe6e6' : result.filtered > 0 ? '#e6ffe6' : '#fff3cd'
            }}>
              <h4>{result.name}</h4>
              
              {result.error ? (
                <p style={{ color: 'red' }}>❌ Error: {result.error}</p>
              ) : (
                <>
                  <p>📋 Total documents: {result.total}</p>
                  <p>🎯 Matching church: {result.filtered}</p>
                  
                  {result.sample && result.sample.length > 0 && (
                    <div>
                      <p><strong>📝 Sample data:</strong></p>
                      <pre style={{
                        background: '#f5f5f5',
                        padding: '10px',
                        borderRadius: '4px',
                        overflow: 'auto',
                        fontSize: '12px'
                      }}>
                        {JSON.stringify(result.sample, null, 2)}
                      </pre>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
          
          <div style={{
            background: '#e7f3ff',
            padding: '16px',
            borderRadius: '8px',
            marginTop: '20px'
          }}>
            <h4>💡 What to do next:</h4>
            <ol>
              <li>Look for results with "Matching church" &gt; 0</li>
              <li>Check the sample data to see the user structure</li>
              <li>Note which collection has your users</li>
              <li>Check browser console for detailed logs</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
};

export default FindUsersTest;
